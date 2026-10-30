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
   only when its own Save is pressed. Archive and Delete are Dr. A's.
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
/* photos: a small one for lists (and the drawer) and a big one — WebP where the browser can make it, else JPEG — each made to
   fit its photo record. Safari (iPhone, iPad, Mac) can't make WebP: asked for one, it handed back a PNG of the whole photo,
   several times what a photo record holds (Amir, 21 Oct 2026: "says this photo is too big to save....I just took it with my
   phone"). And a very detailed photo can be too big even as WebP: then it's saved a little softer, then a little smaller,
   until it fits. */
const IMG_THUMB_MAX = 800, IMG_FULL_MAX = 1600, IMG_QUALITY = 0.85;   // the grid's photos are big: thumbs as sharp as the old app's (800)
const IMG_FIT = 900000;   // a photo's base64 at most (a photo record holds 990,000: PIC_MAX)
let canWebpCache = null;
function canWebp() {
  if (canWebpCache == null) { try { const c = document.createElement('canvas'); c.width = c.height = 2; canWebpCache = /^data:image\/webp/.test(c.toDataURL('image/webp', 0.8)); } catch (e) { canWebpCache = false; } }
  return canWebpCache;
}
function encodePhoto(img, w, h, q) {
  const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h; const g = cvs.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  if (canWebp()) return cvs.toDataURL('image/webp', q);
  g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);   // a JPEG has no see-through: white behind
  return cvs.toDataURL('image/jpeg', q);
}
function resizeToWebp(srcDataUrl, maxDim, quality) {
  return new Promise(resolve => {
    if (!srcDataUrl) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        let dim = Math.min(maxDim, Math.max(img.width, img.height)), d = null;
        for (let pass = 0; pass < 8; pass++) {
          const ratio = Math.min(dim / img.width, dim / img.height, 1), w = Math.max(1, Math.round(img.width * ratio)), h = Math.max(1, Math.round(img.height * ratio));
          for (const q of [quality, 0.72, 0.6]) {
            if (q > quality) continue;
            d = encodePhoto(img, w, h, q);
            if (d.length - d.indexOf(',') - 1 <= IMG_FIT) return resolve(d);
          }
          dim = Math.max(1, Math.round(dim * 0.8));
        }
        resolve(d);
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
    .map(s => ({ key: 'k' + uid(), vendor: s.vendor || '', sku: s.sku || '', price: countPrice(s) != null ? (countPrice(s) * per).toFixed(2) : '', src: s.src || '', lastDate: s.lastDate || '' }));
  /* one size of a product (families.js): its name is the product's with its own choices, typed here */
  const join = prefill && prefill.famJoin, mem = it && famId(it) ? { fid: it.fam, name: it.famName || '', opts: famOptsOf(it), vals: famValsOf(it) }
    : join ? { fid: join.fid, name: join.name, opts: join.opts.slice(), vals: join.opts.map(() => ''), isNew: true } : null;
  if (mem && !mem.opts.length) mem.opts = ['Size'];
  S.ui.ed = {
    id: it ? it.id : null, copyOf: (prefill && prefill.copyOf) || null, mem, fam: null,
    f: {
      name: base.name || '', cat: base.cat || 'misc', group: base.group || '', manufacturer: base.manufacturer || '', sku: base.sku || '', tags: listOf(base.tags).join(', '), location: base.location || '', note: base.note || '', exp: base.exp || '',
      unit: countUnit(base), big: per > 1, buyUnit: per > 1 ? (base.buyUnit || 'case') : 'case', perBuy: per > 1 ? String(per) : '10',
      pieces: Number(base.baseUnitsPerOrderUnit) > 1 ? String(base.baseUnitsPerOrderUnit) : '', piece: base.baseUnitName && base.baseUnitName !== 'Unit' ? base.baseUnitName : '',
      min: base.min != null && base.min !== '' ? String(base.min) : '', qty: it ? '' : (base.qty != null && base.qty !== '' ? String(base.qty) : '')
    },
    sources: srcs.length ? srcs : [{ key: 'k' + uid(), vendor: '', sku: '', price: '', src: '', lastDate: '' }],
    /* shown/shownFull: the photo the supply shows today, wherever it's kept (img, a full-size one only, an older photo's address,
       a built-in one) — the editor offers Change, Remove and the AI clean-up for any of them */
    photo: { img: base.img || null, imgFull: base.imgFull || null, shown: photoOf(base) || null, shownFull: photoOf(base, true) || null, thumb: null, full: null, changed: false, ai: false },
    dirty: !!(prefill && prefill.copyOf), busy: '', ai: null
  };
  if (prefill && prefill.photo) Object.assign(S.ui.ed.photo, prefill.photo);
  renderEditor(); edLoadAi();
}
/* the AI keys (label reader, photo clean-up) arrive after the editor opens */
function edLoadAi() { const E = S.ui.ed; aiKeys().then(k => { if (!S.ui.ed || S.ui.ed !== E) return; E.ai = k; const r = $('#edAiRow'); if (r) r.outerHTML = edAiRowHTML(); const p = $('#edPhotoRow'); if (p) { p.outerHTML = edPhotoHTML(); hydrateImages($('#modalWrap')); } }).catch(() => { }); }
function edAiRowHTML() {
  const E = S.ui.ed, k = E && E.ai, can = !!(k && (k.gemini || k.proxy));
  return '<div id="edAiRow">' + (can ? '<div class="aiFill">' + ic('spark', 18) + '<div class="grow"><b>Read a label</b><span>Take a photo of the box or label and the AI fills in what it can.</span></div><button class="btn btn-sec btn-sm" data-act="edLabel"' + (E.busy ? ' disabled' : '') + '>' + (E.busy === 'label' ? 'Reading…' : ic('camera', 15) + 'Scan the label') + '</button></div>' : '') + '</div>';
}
function edPhotoHTML() {
  const E = S.ui.ed, P = E.photo, src = P.thumb || P.shown || P.img, k = E.ai, canAi = !!(k && resolveOpenAIKey(k.openai, ''));
  /* without the OpenAI key the AI button isn't there at all, so Dr. A is told why (Amir, 21 Oct 2026: "photo AI enhancer …
     is not working anymore"); the others can't set keys, so nothing changes for them */
  const noKey = !!(src && k && !canAi && !P.ai && isOwnerAccount());
  return '<div id="edPhotoRow" class="photoEd">' + (src ? '<img alt="" data-src="' + esc(src) + '">' : '<span class="ph">' + ic('camera', 22) + '</span>') +
    '<div class="grow"><b>Photo</b><span>' + (src ? (P.ai ? 'Cleaned up by AI — saved with the supply' : P.changed ? 'New photo — saved with the supply' : 'Shown in the list and on labels') : 'A photo helps people find the right box.') + '</span>' +
    '<div class="btnRow" style="margin-top:6px"><button class="btn btn-sec btn-sm" data-act="edPhoto">' + ic('upload', 14) + (src ? 'Change' : 'Add a photo') + '</button>' + (src ? '<button class="btn btn-ghost btn-sm" data-act="edPhotoOff">Remove</button>' : '') +
    (src && canAi && !P.ai ? '<button class="btn btn-ghost btn-sm" data-act="edPhotoAi"' + (E.busy ? ' disabled' : '') + '>' + ic('spark', 14) + (E.busy === 'photo' ? 'Working… (up to 2 minutes)' : 'Clean it up with AI') + '</button>' : '') + '</div>' +
    (noKey ? '<div class="hint" id="edPhotoNoKey">“Clean it up with AI” needs the OpenAI key: Settings → AI.</div>' : '') +
    (E.fam && E.fam.on && E.fam.mode === 'edit' ? famOwnPicsHint(E) : '') + '</div></div>';
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
  /* a product in sizes (FM: made here, or the product's own Edit) or one of its sizes (M) — families.js */
  const FM = E.fam && E.fam.on ? E.fam : null, M = E.mem, famEdit = !!(FM && FM.mode === 'edit'), nSizes = FM ? famLiveRows(E).length : 0;
  let h = '<h3>' + (famEdit ? 'Edit product' : FM ? 'New product in sizes' : E.id ? (M ? 'Edit this size' : 'Edit supply') : M ? 'New size of ' + esc(M.name) : E.copyOf ? 'New supply (a copy)' : 'New supply') + '</h3><div class="lsub">' +
    (famEdit ? esc(F.name) + ' · ' + esc(plural(nSizes, 'size')) + ' · what you change here changes every size; the table is each size’s own' : E.id ? esc(it ? it.name : '') + ' · changes are saved with your name and the time' : 'It shows up for everyone as soon as it’s saved.') + '</div>' + edAiRowHTML();
  /* what it is */
  const nameField = M ? '<input type="hidden" id="edName" value="' + esc(F.name) + '">' +
      '<div class="notice info famMemNote">' + ic('layers', 14) + ' ' + (M.isNew ? 'A new size of' : 'One size of') + ' <b>' + esc(M.name) + '</b>' + (M.fid ? ' (' + esc(plural(famMembers(M.fid, true).length, 'size')) + ')' : '') + '. Its name is the product’s with its own ' + esc(M.opts.map(o => o.toLowerCase()).join(' and ')) + '.' +
      (M.fid && !M.isNew ? ' To change the name, photo, vendors or price of every size at once: <button class="linkBtn" data-act="famEdit" data-fam="' + esc(M.fid) + '">Edit the product</button>' : '') + '</div>' +
      '<div class="grid' + Math.min(3, M.opts.length + 1) + '">' + M.opts.map((o, k) => field(o || 'Choice', '<input data-mv="' + k + '" value="' + esc(M.vals[k] || '') + '" data-inp="edMemInp" autocomplete="off"' + (k === 0 ? ' id="edMv0"' : '') + '>')).join('') + '</div>' +
      '<div class="hint" style="margin:-4px 0 12px">Its name: <b id="edMemName">' + esc(famFullName(M.name, M.vals)) + '</b></div>'
    : field(FM ? 'Product name (every size has it)' : 'Name', '<input id="edName" value="' + esc(F.name) + '" placeholder="' + (FM ? 'e.g. tomas-pin mini screw' : 'e.g. Gloves Pulse Nitrile — SM') + '" autocomplete="off"' + (FM ? ' data-inp="famNameInp"' : '') + '>');
  h += '<div class="edSec"><h5>What it is</h5>' + nameField +
    (!E.id && !M && !famEdit ? '<label class="chk famOn"><input type="checkbox" id="edFamOn" data-chg="edFamOn"' + (FM ? ' checked' : '') + '> ' + ic('layers', 15) + ' <span>It comes in different sizes or types <span class="muted">— one card, and each size has its own count, item # and price</span></span></label>' : '') +
    '<div class="grid2">' + field('Category', '<select id="edCat" data-chg="edCat">' + CATEGORIES.map(c => '<option value="' + c.id + '"' + (c.id === F.cat ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') + '</select>') +
    field('Group', '<input id="edGroup" list="edGroups" value="' + esc(F.group) + '" placeholder="' + esc(groups[0] ? 'e.g. ' + groups[0] : 'optional') + '">' + dl('edGroups', groups)) + '</div>' +
    '<div class="grid2">' + field('Made by', '<input id="edMfr" list="edMfrs" value="' + esc(F.manufacturer) + '" placeholder="e.g. 3M, Ormco (optional)">' + dl('edMfrs', mfrs)) +
    (FM ? '<div class="field"><label>Item #</label><div class="stockNow muted">One for each size, in the table below</div></div>' : field('Maker’s part #', '<input id="edSku" value="' + esc(F.sku) + '" placeholder="optional" autocomplete="off">')) + '</div>' +
    '<div class="grid2">' + field('Kept in', '<select id="edLoc"><option value="">—</option>' + locs.map(l => '<option' + (l === F.location ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + (F.location && !locs.includes(F.location) ? '<option selected value="' + esc(F.location) + '">' + esc(F.location) + ' (not on the list)</option>' : '') + '</select>', locs.length ? '' : 'Storage places are added under Settings.') +
    field('Expires', '<input id="edExp" type="date" value="' + esc(/^\d{4}-\d{2}-\d{2}$/.test(F.exp) ? F.exp : '') + '">', F.exp && !/^\d{4}-\d{2}-\d{2}$/.test(F.exp) ? 'Saved as “' + esc(F.exp) + '”' : '') + '</div>' +
    field('Search words', '<input id="edTags" list="edTagList" value="' + esc(F.tags) + '" placeholder="e.g. hve, suction, chairside (commas between)">' + dl('edTagList', tagsAll)) +
    field('Notes', '<textarea id="edNote" rows="2" placeholder="Shade, size, which patients, how to order…">' + esc(F.note) + '</textarea>') + edPhotoHTML() + '</div>';
  /* its sizes and types */
  if (FM) h += famEdSecHTML(E);
  /* counting and buying */
  h += '<div class="edSec"><h5>Counting and buying</h5><div class="grid3">' +
    field('Counted on the shelf in', '<input id="edUnit" list="edUnits" value="' + esc(F.unit) + '" data-inp="edUnitInp" autocomplete="off">' + dl('edUnits', COUNT_UNITS)) +
    field(FM ? 'Reorder below (each size)' : 'Reorder below', '<input id="edMin" type="number" inputmode="numeric" min="0" step="1" value="' + esc(F.min) + '" placeholder="0"' + (FM ? ' data-inp="famMinInp"' : '') + '>', 'in ' + esc(unitWord(F.unit || 'unit', 2)) + (FM ? ' — a size can have its own in the table' : '')) +
    (FM ? '<div class="field"><label>On hand</label><div class="stockNow muted">' + (famEdit ? 'Counted size by size (Count on the product)' : 'Typed for each size in the table') + '</div></div>' :
    E.id ? '<div class="field"><label>On hand</label><div class="stockNow"><b>' + esc(qtyFmt((it && it.qty) || 0)) + '</b> ' + esc(unitWord(F.unit || 'unit', it && it.qty)) + ' · <button class="linkBtn" data-act="stockOpen" data-id="' + esc(E.id) + '">count it</button></div></div>' :
      field('On hand now', '<input id="edQty" type="number" inputmode="decimal" min="0" step="any" value="' + esc(F.qty) + '" placeholder="0">', 'in ' + esc(unitWord(F.unit || 'unit', 2)))) + '</div>' +
    '<label class="chk" style="margin:4px 0 8px"><input type="checkbox" id="edBig" data-chg="edBig"' + (F.big ? ' checked' : '') + '> We buy it by a bigger package (like a case of boxes)</label>' +
    (F.big ? '<div class="bigRow">Bought by the <input id="edBuyU" list="edBuyUnits" value="' + esc(F.buyUnit) + '" data-inp="edUnitInp" class="sm" aria-label="Package">' + dl('edBuyUnits', BUY_UNITS) + ' of <input id="edPer" type="number" inputmode="numeric" min="2" step="1" value="' + esc(F.perBuy) + '" data-inp="edUnitInp" class="xs" aria-label="How many in one"> <span id="edPerU">' + esc(unitWord(F.unit || 'unit', 2)) + '</span></div>' +
      '<div class="hint" id="edBigHint">The cart and orders go by the ' + esc(F.buyUnit || 'case') + '; receiving 1 ' + esc(F.buyUnit || 'case') + ' adds ' + per + ' ' + esc(unitWord(F.unit || 'unit', per)) + ' to the count.</div>' : '') +
    '<div class="grid2" style="margin-top:8px">' + field('Pieces in one ' + (F.unit || 'unit') + ' (optional)', '<div class="inRow"><input id="edPcs" type="number" inputmode="decimal" min="0" step="any" value="' + esc(F.pieces) + '" placeholder="e.g. 100" class="xs" aria-label="How many pieces"><input id="edPc" list="edPieces" value="' + esc(F.piece) + '" placeholder="gloves" aria-label="Piece">' + dl('edPieces', BASE_UNITS) + '</div>', 'Only for the price per piece; it never changes a count.') + '</div></div>';
  /* where it's bought */
  h += '<div class="edSec"><h5>Where it’s bought</h5><div class="hint" style="margin:-4px 0 10px">The first one is the usual vendor. Prices are per <b id="edPu">' + esc(priceUnit) + '</b>' + (FM ? ' — for every size; a size with its own price has it in the table, and its item # is there too' : '') + '.</div>' +
    E.sources.map((s, k) => {
      const p = num(s.price), each = F.big && p > 0 ? '= ' + money(p / per) + ' a ' + esc(F.unit || 'unit') : '';
      return '<div class="srcEd"><div class="srcTop">' + (k === 0 ? '<span class="pill usual">Usual vendor</span>' : '<button class="linkBtn" data-act="edSrcTop" data-k="' + k + '">Make this the usual vendor</button>') + '<span style="flex:1"></span>' +
        (E.sources.length > 1 ? '<button class="iconBtn" data-act="edSrcDel" data-k="' + k + '" aria-label="Remove this vendor">' + ic('trash', 15) + '</button>' : '') + '</div>' +
        '<div class="grid' + (FM ? 3 : 4) + '">' + field('Vendor', '<input data-ed="vendor" data-k="' + k + '" list="edVendors" value="' + esc(s.vendor) + '" placeholder="Pick or type"' + (FM && k === 0 ? ' data-inp="famVendorInp"' : '') + '>') + (FM ? '' : field('Their SKU', '<input data-ed="sku" data-k="' + k + '" value="' + esc(s.sku) + '" autocomplete="off">')) +
        field((FM ? 'Price per ' + priceUnit + (k === 0 ? ', each size' : '') : 'Price per ' + priceUnit), '<input data-ed="price" data-k="' + k + '" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(s.price) + '" data-inp="edPriceInp">', '<span id="edEach' + k + '">' + each + '</span>') +
        field('Product link', '<input data-ed="src" data-k="' + k + '" value="' + esc(s.src) + '" placeholder="https:// (optional)">') + '</div></div>';
    }).join('') + dl('edVendors', vnames) +
    '<button class="btn btn-ghost btn-sm" data-act="edSrcAdd">' + ic('plus', 14) + 'Another vendor</button></div>';
  h += '<div class="mFt">' + (E.id && !FM ? '<button class="btn btn-ghost" data-act="edCopy" style="margin-right:auto">' + ic('copy', 15) + (M ? 'Another size like this' : 'Make a copy') + '</button>' : FM && !famEdit ? '<span class="muted small" id="famSaveHint" style="margin-right:auto;align-self:center">' + esc(famSaveHint(E)) + '</span>' : '<span style="margin-right:auto"></span>') +
    '<button class="btn btn-sec" data-act="edClose">Cancel</button><button class="btn btn-pri" data-act="edSave" id="edSaveBtn"' + (E.busy ? ' disabled' : '') + '>' + (famEdit ? 'Save the product' : FM ? famSaveLabel(E) : E.id ? 'Save changes' : M ? 'Add the size' : 'Add the supply') + '</button></div>';
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
  if (E.mem) $$('[data-mv]').forEach(i => { E.mem.vals[Number(i.dataset.mv)] = i.value; });
  famEdKeep(E);
}
CHG.edCat = () => { edKeep(); S.ui.ed.dirty = true; renderEditor(); };
CHG.edBig = () => {
  const E = S.ui.ed, was = E.f.big; edKeep(); E.dirty = true;
  /* the typed prices follow the unit they're typed in: per box <-> per case */
  const per = Math.max(2, Math.round(num(E.f.perBuy) || 10)), conv = p => (E.f.big && !was ? p * per : !E.f.big && was ? p / per : p).toFixed(2);
  E.sources.forEach(s => { const p = num(s.price); if (p > 0) s.price = conv(p); });
  /* (and each size's own price in the table) */
  if (E.fam) E.fam.rows.forEach(r => Object.keys(r.pr).forEach(k => { const p = num(r.pr[k]); if (p > 0) r.pr[k] = conv(p); }));
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
  /* (a product's sizes without a price of their own show the usual vendor's) */
  const p0 = $('[data-ed="price"][data-k="0"]'); $$('[data-fr="price"]').forEach(i => { i.placeholder = (p0 && p0.value) || '0.00'; });
};
ACT.edSrcAdd = () => { edKeep(); S.ui.ed.sources.push({ key: 'k' + uid(), vendor: '', sku: '', price: '', src: '', lastDate: '' }); S.ui.ed.dirty = true; renderEditor(); };
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
  /* a copy of one size of a product is another size of it (families.js) */
  if (E.mem && E.mem.fid) pre.famJoin = { fid: E.mem.fid, name: E.mem.name, opts: E.mem.opts };
  closeModal(true); openEditor(null, pre); toast(pre.famJoin ? 'Another size of ' + plainText(E.mem.name, 40) + ' — type what makes it different, then save it.' : 'A copy — give it its own name, then save it.');
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
ACT.edPhotoOff = () => { edKeep(); Object.assign(S.ui.ed.photo, { img: null, imgFull: null, shown: null, shownFull: null, thumb: null, full: null, changed: true, ai: false }); S.ui.ed.dirty = true; renderEditor(); };
ACT.edPhotoAi = async () => {
  const E = S.ui.ed, key = resolveOpenAIKey(E.ai && E.ai.openai, ''); if (!key) return toast('The photo clean-up needs the OpenAI key (Settings → AI).', { bad: true });
  edKeep();
  let src = E.photo.full || E.photo.thumb || E.photo.shownFull || E.photo.shown || E.photo.imgFull || E.photo.img;
  E.busy = 'photo'; renderEditor();
  try {
    if (src && !/^data:/.test(src)) src = await urlToDataUrl(src);
    const out = await aiGenerateProductPhoto(src, E.f.name || 'dental supply product', key);
    if (!out || !/^data:image\//.test(out)) throw new Error('The AI didn’t send a picture back. Try again.');
    const r = await makeThumbAndFull(out);
    Object.assign(E.photo, { thumb: r.thumb || out, full: r.full || out, changed: true, ai: true }); E.dirty = true;
  } catch (e) { toast('Photo clean-up: ' + (e && e.ai ? e.message : errText(e)), { bad: true, ms: e && e.ai ? 12000 : 0 }); }
  E.busy = ''; if (S.ui.ed === E && $('#edName')) { edKeep(); renderEditor(); }   // (what was typed while it worked stays)
};
/* a saved photo (Cloud Storage, or one just picked) as a data URL, for the AI */
async function urlToDataUrl(u) {
  if (/^pic:/.test(u)) { const d = await B.pic(u); if (d) return d; throw new Error('The saved photo couldn’t be loaded.'); }
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
    if (S.ui.ed === E && $('#edName')) edKeep();   // (what was typed while it read)
    const s = v => (v == null ? '' : String(v).trim());
    if (s(r.name)) { F.name = s(r.name); got.push('name'); }
    if (s(r.sku)) { F.sku = s(r.sku); got.push('part #'); }
    if (s(r.vendor)) { F.manufacturer = s(r.vendor); got.push('maker'); }
    const pk = _canonical(s(r.packaging), ORDER_UNITS); if (pk && pk.toLowerCase() !== 'case') { F.unit = pk.toLowerCase(); got.push('unit'); }
    const pc = _canonical(s(r.unit), BASE_UNITS); if (pc && pc.toLowerCase() !== F.unit) F.piece = pc;
    if (Number(r.unitsPerPkg) > 1) { F.pieces = String(Number(r.unitsPerPkg)); got.push('pieces'); }
    if (Number(r.pkgsPerCase) > 1 && !F.big) {
      F.big = true; F.buyUnit = 'case'; F.perBuy = String(Math.round(Number(r.pkgsPerCase))); E.sources.forEach(x => { const p = num(x.price); if (p > 0) x.price = String(round2(p * Number(F.perBuy))); });
      if (E.fam) E.fam.rows.forEach(row => Object.keys(row.pr).forEach(k => { const p = num(row.pr[k]); if (p > 0) row.pr[k] = String(round2(p * Number(F.perBuy))); }));
      got.push('case size');
    }
    if (s(r.note)) { F.note = F.note ? F.note + (F.note.includes(s(r.note)) ? '' : ' · ' + s(r.note)) : s(r.note); got.push('notes'); }
    /* the label's photo is a fine first photo */
    if (!E.photo.thumb && !E.photo.shown && !E.photo.img) { const ph = await makeThumbAndFull(d); if (ph.thumb) Object.assign(E.photo, { thumb: ph.thumb, full: ph.full || ph.thumb, changed: true }); }
    E.dirty = true; toast(got.length ? 'Filled in: ' + got.join(', ') + '. Check it before saving.' : 'The AI couldn’t read much from that photo.', got.length ? {} : { bad: true });
  } catch (e) { if (S.ui.ed === E && $('#edName')) edKeep(); toast('Label: ' + errText(e), { bad: true }); }
  E.busy = ''; if (S.ui.ed === E && $('#edName')) renderEditor();
};
/* save */
ACT.edSave = t => {
  edKeep(); const E = S.ui.ed, F = E.f;
  /* a product in sizes: every size in one save (families.js) */
  if (E.fam && E.fam.on) return famEdSave(t);
  /* one size of a product: its name is the product's with its choices */
  const M = E.mem;
  if (M) {
    M.vals = M.opts.map((o, k) => String(M.vals[k] || '').trim());
    if (!M.vals.some(Boolean)) { toast('Type what makes this size different (its ' + (M.opts[0] || 'size').toLowerCase() + ').', { bad: true }); const v = $('#edMv0'); if (v) v.focus(); return; }
    const twin = famMembers(M.fid, true).find(m => m.id !== E.id && famValsOf(m).join('\u0001').toLowerCase() === M.vals.join('\u0001').toLowerCase());
    if (twin) return toast('“' + M.name + '” already has ' + famLabel(twin) + '.', { bad: true });
    F.name = famFullName(M.name, M.vals);
  }
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
  if (M) {
    rec.famVals = M.vals;
    if (M.isNew) { const sib = famMembers(M.fid, true); Object.assign(rec, { fam: M.fid, famName: M.name, famOpts: M.opts, famPos: sib.reduce((a, m) => Math.max(a, Number(m.famPos) || 0), -1) + 1 }); }
  }
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
        /* the new photo (or none) is the one shown: an older photo's address or a built-in one would come first otherwise */
        rec.imgUrl = null; rec.imgFullUrl = null; rec.imgKey = null;
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

/* ---------- a product in sizes and types: the editor's part (families.js has the rest) ----------
   New supply → "It comes in different sizes or types": what tells them apart (up to three: Type, Length…) and the choices of
   each, commas between; every combination is a row — untick one that isn't made — with its own item # (at the usual
   vendor), price (blank: the usual vendor's price above), count and minimum (blank: the one above). Saving makes every size
   at once, in one save. Edit on the product opens the same form on its sizes: what's changed above goes to every size (only
   what was changed — a size's own notes or link stay unless that field is changed here); the table is each size's own;
   new choices + Add make new sizes; × takes a size out of the product (it stays a supply of its own). */
function famSplitVals(s) { const out = []; String(s || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).forEach(x => { if (!out.some(y => y.toLowerCase() === x.toLowerCase())) out.push(x); }); return out.slice(0, 30); }
function famRowKey(vals) { return listOf(vals).map(v => String(v || '').trim().toLowerCase()).join('\u0001'); }
function famNewRow(vals) { return { key: 'r' + uid(), id: null, vals, on: true, sk: {}, pr: {}, qty: '', min: '', out: false }; }
function famNewState() { return { on: true, mode: 'new', fid: null, opts: [{ n: 'Size', v: '' }], rows: [], over: 0 }; }
function famLiveRows(E) { const FM = E && E.fam; if (!FM) return []; return FM.mode === 'edit' ? FM.rows.filter(r => !r.out) : FM.rows.filter(r => r.on); }
function famSaveLabel(E) { const n = famLiveRows(E).length; return n ? 'Add ' + plural(n, 'size') : 'Add the sizes'; }
function famSaveHint(E) { const n = famLiveRows(E).length; return n ? 'Each with its own count, item # and price' : ''; }
/* New: every combination of the choices typed, each keeping what was typed into its row */
function famGen(E) {
  const FM = E.fam; if (!FM || FM.mode !== 'new') return;
  const lists = FM.opts.map(o => famSplitVals(o.v));
  let combos = [];
  if (lists.some(l => l.length)) { combos = [[]]; lists.forEach(l => { const ls = l.length ? l : [''], next = []; combos.forEach(c => ls.forEach(v => next.push(c.concat([v])))); combos = next; }); }
  const old = new Map(FM.rows.map(r => [famRowKey(r.vals), r])), used = new Set();
  FM.over = combos.length > FAM_MAX ? combos.length : 0;
  const next = combos.slice(0, FAM_MAX), hit = next.map(vals => { const r = old.get(famRowKey(vals)); if (r) used.add(r); return r || null; });
  /* (a choice's spelling fixed — "6mm" to "6 mm" — keeps that row's item #, price and count: the row in the same place, when
     the number of sizes didn't change and nothing else took it) */
  FM.rows = next.map((vals, i) => { let r = hit[i]; if (!r && next.length === FM.rows.length && FM.rows[i] && !used.has(FM.rows[i])) { r = FM.rows[i]; used.add(r); } return r ? Object.assign(r, { vals }) : famNewRow(vals); });
}
function famEdSecHTML(E) {
  const FM = E.fam, edit = FM.mode === 'edit';
  let h = '<div class="edSec famSec"><h5>' + ic('layers', 13) + ' Sizes and types</h5><div class="hint" style="margin:-4px 0 10px">' +
    (edit ? 'Change a size in the table, or type new choices and press Add to make new sizes. A size you take out stays a supply of its own.' : 'Say what tells them apart and type the choices — every combination is listed below. Untick one that isn’t made.') + '</div>';
  h += FM.opts.map((o, k) => '<div class="famOpt"><input class="fon" data-fo="n" data-k="' + k + '" list="famOptNames" value="' + esc(o.n) + '" placeholder="' + (k ? 'e.g. Type' : 'e.g. Length') + '" aria-label="What differs" data-inp="famOptInp" autocomplete="off">' +
    '<input class="fov" data-fo="v" data-k="' + k + '" value="' + esc(o.v) + '" placeholder="' + esc(edit ? 'New choices, e.g. 12 mm' : k ? 'e.g. EP, SD' : 'e.g. 6 mm, 8 mm, 10 mm') + '" aria-label="' + esc((o.n || 'The choices') + ', commas between') + '" data-inp="famOptInp" autocomplete="off"' + (edit ? ' data-enter="#famAdd' + k + '"' : '') + '>' +
    (edit ? '<button class="btn btn-sec btn-sm" id="famAdd' + k + '" data-act="famAddVals" data-k="' + k + '">' + ic('plus', 14) + 'Add</button>' : '') +
    (FM.opts.length > 1 ? '<button class="iconBtn" data-act="famOptDel" data-k="' + k + '" aria-label="Remove this difference" title="Remove this difference">' + ic('x', 15) + '</button>' : '') + '</div>').join('') +
    '<datalist id="famOptNames">' + FAM_OPT_NAMES.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
    '<div class="famOptBtns">' + (FM.opts.length < 3 ? '<button class="linkBtn" data-act="famOptAdd">+ Another difference (like Type or Color)</button>' : '') + (FM.opts.length > 1 ? '<button class="linkBtn" data-act="famOptSwap">⇅ Swap the order</button>' : '') + '</div>';
  if (edit && FM.odd) h += '<div class="notice" style="margin:4px 0 10px">' + plural(FM.odd, 'size is', 'sizes are') + ' counted or bought differently from the first one, so ' + (FM.odd === 1 ? 'its price is' : 'their prices are') + ' kept as ' + (FM.odd === 1 ? 'it is' : 'they are') + ' here — change ' + (FM.odd === 1 ? 'it' : 'them') + ' on the size’s own page.</div>';
  h += '<div id="famRows">' + famRowsEdHTML(E) + '</div>';
  if (edit) h += '<button class="btn btn-ghost btn-sm" data-act="famRowAdd" style="margin-top:8px">' + ic('plus', 14) + 'One more size</button>';
  return h + '</div>';
}
function famRowsEdHTML(E) {
  const FM = E.fam, F = E.f, edit = FM.mode === 'edit', s0 = E.sources[0] || {}, key = s0.key || '', vn = String(s0.vendor || '').trim();
  const pu = F.big ? (F.buyUnit || 'case') : (F.unit || 'unit');
  if (!FM.rows.length) return '<div class="famEmpty">' + ic('layers', 18) + '<span>Type the choices above and each size shows up here, ready for its item #, price and count.</span></div>';
  let h = '<div class="famTbl" style="--fcols:' + FM.opts.length + '"><div class="fth"><span></span>' + FM.opts.map(o => '<span>' + esc(o.n || 'Choice') + '</span>').join('') +
    '<span id="famSkuH">' + esc(vn ? vn + ' item #' : 'Item #') + '</span><span>Price per ' + esc(pu) + '</span><span>On hand</span><span>Reorder below</span></div>';
  FM.rows.forEach((r, i) => {
    const m = r.id ? itemById(r.id) : null;
    if (r.out) { h += '<div class="ftr out"><span></span><span class="fout">' + ic('grid', 13) + ' <b>' + esc(r.vals.filter(Boolean).join(FAM_VSEP) || (m && m.name) || '') + '</b> will be taken out of the product — it stays a supply of its own. <button class="linkBtn" data-act="famRowBack" data-r="' + i + '">Keep it</button></span></div>'; return; }
    const first = edit ? (r.id ? '<button class="iconBtn" data-act="famRowOut" data-r="' + i + '" title="Take it out of the product (it stays a supply of its own)" aria-label="Take it out">' + ic('x', 15) + '</button>'
      : '<button class="iconBtn" data-act="famRowDel" data-r="' + i + '" title="Don’t make this one" aria-label="Don’t make this one">' + ic('trash', 15) + '</button>')
      : '<label class="fck"><input type="checkbox" data-fr="on" data-r="' + i + '"' + (r.on ? ' checked' : '') + ' data-chg="famRowOn" aria-label="Make this size"></label>';
    h += '<div class="ftr' + (!edit && !r.on ? ' off' : '') + (edit && !r.id ? ' new' : '') + '">' + first +
      FM.opts.map((o, k) => edit ? '<input data-fr="v" data-r="' + i + '" data-k="' + k + '" value="' + esc(r.vals[k] || '') + '" aria-label="' + esc(o.n || 'Choice') + '" placeholder="' + esc(o.n || '') + '" autocomplete="off">' : '<span class="fv">' + esc(r.vals[k] || '—') + '</span>').join('') +
      '<input data-fr="sku" data-r="' + i + '" value="' + esc(r.sk[key] || '') + '" placeholder="#" aria-label="Item #" autocomplete="off">' +
      (r.lock ? '<span class="fq" title="Counted or bought differently from the first size: change its price on its own page">' + esc(r.pr[key] || '—') + '</span>' : '<input data-fr="price" data-r="' + i + '" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(r.pr[key] || '') + '" placeholder="' + esc(s0.price || '0.00') + '" aria-label="Price">') +
      (m ? '<span class="fq" title="Counted with Count on the product">' + esc(qtyFmt(m.qty || 0)) + '</span>' : '<input data-fr="qty" data-r="' + i + '" type="number" inputmode="decimal" min="0" step="any" value="' + esc(r.qty) + '" placeholder="0" aria-label="On hand now">') +
      '<input data-fr="min" data-r="' + i + '" type="number" inputmode="numeric" min="0" step="1" value="' + esc(r.min) + '" placeholder="' + esc(F.min || '0') + '" aria-label="Reorder below"></div>';
  });
  h += '</div>';
  if (FM.over) h += '<div class="notice bad" style="margin-top:8px">That makes ' + FM.over + ' sizes — one product holds ' + FAM_MAX + ' at most. Fewer choices, or two products.</div>';
  else if (!edit) { const n = famLiveRows(E).length; h += '<div class="hint">' + plural(n, 'size') + ' will be added' + (FM.rows.length > n ? ' (' + (FM.rows.length - n) + ' unticked)' : '') + '. A size with no price of its own has the usual vendor’s (under Where it’s bought).</div>'; }
  return h;
}
/* the table and the choices go back into the editor's state (edKeep calls this) */
function famEdKeep(E) {
  const FM = E && E.fam; if (!FM || !$('#famRows')) return;
  $$('[data-fo]').forEach(i => { const o = FM.opts[Number(i.dataset.k)]; if (o) o[i.dataset.fo] = i.value; });
  const key = (E.sources[0] || {}).key || '';
  $$('[data-fr]').forEach(i => {
    const r = FM.rows[Number(i.dataset.r)], f = i.dataset.fr; if (!r) return;
    if (f === 'on') r.on = i.checked; else if (f === 'v') r.vals[Number(i.dataset.k)] = i.value; else if (f === 'sku') r.sk[key] = i.value; else if (f === 'price') r.pr[key] = i.value; else r[f] = i.value;
  });
}
function famRefreshRows() {
  const E = S.ui.ed, el = $('#famRows'); if (!E || !E.fam || !el) return;
  el.innerHTML = famRowsEdHTML(E);
  const b = $('#edSaveBtn'); if (b && E.fam.mode === 'new' && !E.busy) b.textContent = famSaveLabel(E);
  const hn = $('#famSaveHint'); if (hn) hn.textContent = famSaveHint(E);
}
CHG.edFamOn = t => {
  const E = S.ui.ed; edKeep(); E.dirty = true;
  if (t.checked) { if (!E.fam) E.fam = famNewState(); E.fam.on = true; famGen(E); } else if (E.fam) E.fam.on = false;
  renderEditor();
  if (t.checked) setTimeout(() => { const i = $('[data-fo="v"][data-k="0"]'); if (i) i.focus(); }, 40);
};
CHG.famRowOn = () => { famEdKeep(S.ui.ed); famRefreshRows(); };
INP.famOptInp = () => { const E = S.ui.ed; if (!E || !E.fam) return; famEdKeep(E); famGen(E); famRefreshRows(); };
INP.famNameInp = () => { };
INP.famMinInp = () => { const E = S.ui.ed; if (!E || !E.fam) return; E.f.min = val('edMin'); $$('[data-fr="min"]').forEach(i => { i.placeholder = E.f.min || '0'; }); };
INP.famVendorInp = t => { const h = $('#famSkuH'); if (h) h.textContent = t.value.trim() ? t.value.trim() + ' item #' : 'Item #'; };
INP.edMemInp = () => { const E = S.ui.ed; if (!E || !E.mem) return; $$('[data-mv]').forEach(i => { E.mem.vals[Number(i.dataset.mv)] = i.value; }); const n = $('#edMemName'); if (n) n.textContent = famFullName(E.mem.name, E.mem.vals); };
ACT.famOptAdd = () => {
  const E = S.ui.ed; edKeep(); const FM = E.fam; if (!FM || FM.opts.length >= 3) return;
  const has = re => FM.opts.some(o => re.test(o.n));
  FM.opts.push({ n: !has(/type/i) ? 'Type' : !has(/size|length/i) ? 'Size' : 'Color', v: '' });
  FM.rows.forEach(r => r.vals.push('')); famGen(E); E.dirty = true; renderEditor();
};
ACT.famOptDel = t => { const E = S.ui.ed; edKeep(); const FM = E.fam, k = Number(t.dataset.k); if (!FM || FM.opts.length < 2) return; FM.opts.splice(k, 1); FM.rows.forEach(r => r.vals.splice(k, 1)); famGen(E); E.dirty = true; renderEditor(); };
ACT.famOptSwap = () => {
  const E = S.ui.ed; edKeep(); const FM = E.fam; if (!FM || FM.opts.length < 2) return;
  [FM.opts[0], FM.opts[1]] = [FM.opts[1], FM.opts[0]]; FM.rows.forEach(r => { [r.vals[0], r.vals[1]] = [r.vals[1], r.vals[0]]; });
  if (FM.mode === 'new') famGen(E);
  else { const order = []; FM.rows.forEach(r => { if (!order.includes(r.vals[0])) order.push(r.vals[0]); }); FM.rows = FM.rows.map((r, i) => [r, i]).sort((a, b) => order.indexOf(a[0].vals[0]) - order.indexOf(b[0].vals[0]) || a[1] - b[1]).map(x => x[0]); }
  E.dirty = true; renderEditor();
};
/* Edit: new choices of one difference make new sizes — with each combination of the others already there — placed after the
   sizes they go with ("12 mm" after each type's 10 mm) */
ACT.famAddVals = t => {
  const E = S.ui.ed; edKeep(); const FM = E.fam, k = Number(t.dataset.k); if (!FM || !FM.opts[k]) return;
  const add = famSplitVals(FM.opts[k].v); if (!add.length) return toast('Type the new choices first (commas between).', { bad: true });
  const others = [], seen = new Set();
  FM.rows.filter(r => !r.out).forEach(r => { const o = r.vals.map((v, j) => j === k ? null : v || ''), s = JSON.stringify(o); if (!seen.has(s)) { seen.add(s); others.push(o); } });
  if (!others.length) others.push(FM.opts.map(() => ''));
  let n = 0;
  add.forEach(v => others.forEach(o => {
    const vals = o.map((x, j) => j === k ? v : x || ''); if (FM.rows.some(r => !r.out && famRowKey(r.vals) === famRowKey(vals))) return;
    const row = famNewRow(vals);
    let at = -1; if (k > 0) FM.rows.forEach((r, i) => { if (!r.out && String(r.vals[0] || '').toLowerCase() === String(vals[0] || '').toLowerCase()) at = i; });
    if (at >= 0) FM.rows.splice(at + 1, 0, row); else FM.rows.push(row); n++;
  }));
  FM.opts[k].v = ''; E.dirty = true; renderEditor();
  toast(n ? 'Added ' + plural(n, 'new size') + ' — give each its item # (and its price, if it’s different).' : 'Those sizes are already there.');
};
ACT.famRowAdd = () => { const E = S.ui.ed; edKeep(); const FM = E.fam; if (!FM) return; FM.rows.push(famNewRow(FM.opts.map(() => ''))); E.dirty = true; renderEditor(); setTimeout(() => { const i = $$('[data-fr="v"][data-k="0"]').pop(); if (i) i.focus(); }, 40); };
ACT.famRowDel = t => { const E = S.ui.ed; edKeep(); E.fam.rows.splice(Number(t.dataset.r), 1); E.dirty = true; famRefreshRows(); };
ACT.famRowOut = t => { const E = S.ui.ed; edKeep(); const r = E.fam.rows[Number(t.dataset.r)]; if (r) r.out = true; E.dirty = true; famRefreshRows(); };
ACT.famRowBack = t => { const E = S.ui.ed; edKeep(); const r = E.fam.rows[Number(t.dataset.r)]; if (r) r.out = false; famRefreshRows(); };
/* the product's Edit: the form, filled in from its sizes — each vendor any size is bought from (the first size's first; a supply
   still in the 3.x shape, its price and link on itself with a vendor the app can't name, is a row with no vendor), with the price
   most sizes have; the minimum most sizes have; each size's own item # and, when it's different, its own price. A size counted
   or bought differently from the first one keeps its own price (its row's price is locked: change it on that size's own page). */
/* (in the product's Edit: sizes with a photo of their own keep it when the product's photo changes) */
function famOwnPicsHint(E) {
  const own = famMembers(E.fam.fid).filter(m => photoOf(m) && photoOf(m) !== E.fam.pic0).length;
  return '<div class="hint">' + (own ? 'Every size shows it, except ' + plural(own, 'size') + ' with a photo of ' + (own === 1 ? 'its' : 'their') + ' own.' : 'Every size shows it.') + '</div>';
}
function famSrcSig(srcs) { return JSON.stringify(listOf(srcs).map(s => [String(s.vendor || '').trim(), String(s.price || ''), String(s.src || '').trim()])); }
function famSrcOf(m, v) { return allSources(m).find(x => x && String(x.vendor || '') === v) || null; }
function openFamEditor(fid) {
  const ms = famMembers(fid);
  if (!ms.length) return toast(famMembers(fid, true).length ? 'Every size of it is archived — bring one back first (Supplies → Archived).' : 'That product isn’t there any more.', { bad: true });
  const lead = ms[0], per = perBuy(lead), pic = famPhotoItem(ms) || lead, opts = famOptsOf(lead);
  const most = arr => { const c = {}; let best = null; arr.forEach(x => { c[x] = (c[x] || 0) + 1; if (best == null || c[x] > c[best]) best = x; }); return best; };
  const odd = m => countUnit(m).toLowerCase() !== countUnit(lead).toLowerCase() || perBuy(m) !== per;
  const priceOf = (m, v) => { const s = famSrcOf(m, v); return s && countPrice(s) != null ? (countPrice(s) * per).toFixed(2) : null; };
  const vnames = []; ms.forEach(m => allSources(m).forEach(s => { const v = s ? String(s.vendor || '') : null; if (v != null && (v || countPrice(s) != null || s.src || s.sku) && !vnames.includes(v)) vnames.push(v); }));
  const sources = vnames.map(v => {
    const p = most(ms.filter(m => !odd(m)).map(m => priceOf(m, v)).filter(Boolean)) || '', ls = famSrcOf(lead, v) || ms.map(m => famSrcOf(m, v)).find(Boolean) || {};
    return { key: 'k' + uid(), vendor: v, v0: v, sku: '', price: p, p0: p, src: ls.src || '', s0: ls.src || '', lastDate: '' };
  });
  /* (the vendors with a name first: the usual one is a vendor whenever any size has one) */
  sources.sort((x, y) => (x.vendor ? 0 : 1) - (y.vendor ? 0 : 1));
  if (!sources.length) sources.push({ key: 'k' + uid(), vendor: '', sku: '', price: '', src: '', lastDate: '' });
  const minDef = most(ms.map(m => String(Math.max(0, Math.round(Number(m.min) || 0))))) || '0';
  const f = { name: lead.famName || lead.name || '', cat: lead.cat || 'misc', group: lead.group || '', manufacturer: lead.manufacturer || '', sku: '', tags: listOf(lead.tags).join(', '), location: lead.location || '', note: lead.note || '', exp: lead.exp || '',
    unit: countUnit(lead), big: per > 1, buyUnit: per > 1 ? (lead.buyUnit || 'case') : 'case', perBuy: per > 1 ? String(per) : '10',
    pieces: Number(lead.baseUnitsPerOrderUnit) > 1 ? String(lead.baseUnitsPerOrderUnit) : '', piece: lead.baseUnitName && lead.baseUnitName !== 'Unit' ? lead.baseUnitName : '', min: minDef, qty: '' };
  const n = Math.max(1, opts.length), key0 = sources[0].key;
  const rows = ms.map(m => {
    const r = { key: 'r' + m.id, id: m.id, vals: Array.from({ length: n }, (x, k) => famValsOf(m)[k] || ''), on: true, sk: {}, pr: {}, qty: '', min: '', out: false, lock: odd(m) };
    sources.forEach(s => { const src = famSrcOf(m, s.vendor); if (!src) return; r.sk[s.key] = src.sku || ''; const p = priceOf(m, s.vendor); if (p != null && (r.lock || p !== s.price)) r.pr[s.key] = p; });
    /* (no vendor at all: the item # in the table is the supply's own part #) */
    if (!sources[0].vendor && r.sk[key0] == null) r.sk[key0] = m.sku || '';
    const mn = String(Math.max(0, Math.round(Number(m.min) || 0))); if (mn !== minDef) r.min = mn;
    r.sk0 = JSON.stringify(r.sk); r.pr0 = JSON.stringify(r.pr);
    return r;
  });
  S.ui.ed = {
    id: null, copyOf: null, mem: null, f, sources,
    fam: { on: true, mode: 'edit', fid, opts: (opts.length ? opts : ['Size']).map((x, k) => ({ n: x, v: '', o0: k })), rows, over: 0, f0: JSON.parse(JSON.stringify(f)), sig0: famSrcSig(sources), name0: f.name, opts0: JSON.stringify(opts),
      pic0: photoOf(pic) || '', odd: ms.filter(odd).length },
    photo: { img: pic.img || null, imgFull: pic.imgFull || null, shown: photoOf(pic) || null, shownFull: photoOf(pic, true) || null, thumb: null, full: null, changed: false, ai: false },
    dirty: false, busy: '', ai: null
  };
  renderEditor(); edLoadAi();
}
/* the fields every size shares, as a supply keeps them */
function edShared(F) {
  const unit = String(F.unit || 'unit').trim().toLowerCase(), big = F.big && Math.round(num(F.perBuy)) > 1, per = big ? Math.round(num(F.perBuy)) : 1, pieces = num(F.pieces);
  return { cat: F.cat || 'misc', group: String(F.group || '').trim() || null, manufacturer: String(F.manufacturer || '').trim() || null, tags: tagsOf(F.tags).length ? tagsOf(F.tags) : null,
    location: F.location || null, note: String(F.note || '').trim() || null, exp: F.exp || '', unit, orderUnitName: cap1(unit), buyUnit: big ? String(F.buyUnit || 'case').trim().toLowerCase() : null, perBuy: big ? per : null,
    baseUnitName: pieces > 1 ? (F.piece || 'Unit') : null, baseUnitsPerOrderUnit: pieces > 1 ? pieces : 1 };
}
/* a size's vendors, from the product's: all — the product's vendors changed, or its case size (or it's a new size): the
   product's vendors this size is bought from (and any vendor added here; a new size gets them all), each with the size's own
   item # and its own price when it has one (else the vendor's price above), its own link unless the link was changed here;
   otherwise only the cells of this size's row that changed, vendor by vendor. Prices are typed per what's bought and kept per
   what's counted. A vendor row with no name is a 3.x supply's own price and link, kept as they were. */
function famMemberSources(E, m, r, per, all) {
  const old = m ? allSources(m) : [], was = s => s.v0 != null ? s.v0 : String(s.vendor || '').trim();
  const prevOf = s => old.find(o => o && String(o.vendor || '') === was(s)) || null;
  let list = E.sources.filter(s => String(s.vendor || '').trim() || s.v0 === '');
  if (m) list = list.filter(s => s.v0 == null || prevOf(s));
  const priceOf = s => { const typed = String(r.pr[s.key] == null ? '' : r.pr[s.key]).trim(), p = typed !== '' ? num(typed) : num(s.price); return p > 0 ? Math.round(p / per * 10000) / 10000 : null; };
  if (!all) {
    const sk0 = JSON.parse(r.sk0 || '{}'), pr0 = JSON.parse(r.pr0 || '{}'), out = old.map(x => Object.assign({}, x));
    list.forEach(s => {
      const cs = String(r.sk[s.key] || '') !== String(sk0[s.key] || ''), cp = String(r.pr[s.key] || '') !== String(pr0[s.key] || ''); if (!cs && !cp) return;
      let x = out.find(o => o && String(o.vendor || '') === was(s));
      if (!x) { x = { vendor: String(s.vendor || '').trim() || null, sku: '', price: priceOf(s), src: String(s.src || '').trim(), lastDate: '' }; out.push(x); }
      if (cs) x.sku = String(r.sk[s.key] || '').trim();
      if (cp) x.price = priceOf(s);
    });
    return out;
  }
  return list.map(s => {
    const prev = prevOf(s);
    let src = String(s.src || '').trim(); if (s.s0 != null && src === String(s.s0 || '').trim() && prev && prev.src) src = prev.src;   // (a size's own link stays unless the link was changed here)
    if (src && !/^https?:\/\//i.test(src)) src = 'https://' + src;
    return Object.assign({}, prev || {}, { vendor: String(s.vendor || '').trim() || null, sku: r.sk[s.key] != null ? String(r.sk[s.key]).trim() : (prev && prev.sku) || '', price: priceOf(s), src, lastDate: (prev && prev.lastDate) || '' });
  });
}
/* save the product: every size in one save (new sizes, changes to the ones there, the ones taken out). A new product's ids are
   fixed the first time Save is pressed, so pressing it again after an error saves the same sizes, not a second product. */
function famEdSave(t) {
  const E = S.ui.ed, F = E.f, FM = E.fam, edit = FM.mode === 'edit';
  const name = String(F.name || '').trim(); if (!name) { toast('The product needs a name.', { bad: true }); const n = $('#edName'); if (n) n.focus(); return; }
  const optNames = FM.opts.map((o, k) => String(o.n || '').trim() || 'Choice ' + (k + 1));
  if (new Set(optNames.map(x => x.toLowerCase())).size !== optNames.length) return toast('Each difference needs a name of its own.', { bad: true });
  const live = famLiveRows(E), gone = edit ? famMembers(FM.fid, true).filter(m => m.archived) : [];
  if (FM.over || live.length > FAM_MAX) return toast('One product holds ' + FAM_MAX + ' sizes at most.', { bad: true });
  if (live.length < 2 && !(edit && live.length && gone.length)) return toast(edit ? 'A product keeps at least two sizes — to make them separate supplies, use Split on the product’s page.' : 'Type the choices so there are at least two sizes (for just one, untick “It comes in different sizes or types”).', { bad: true });
  const vals = live.map(r => optNames.map((o, k) => String(r.vals[k] || '').trim()));
  if (vals.some(v => !v.some(Boolean))) return toast('A size in the table has no ' + optNames[0].toLowerCase() + ' — type it, or take that row out.', { bad: true });
  const seen = {}; for (const v of vals) { const k = famRowKey(v); if (seen[k]) return toast('Two sizes are both “' + v.filter(Boolean).join(FAM_VSEP) + '”.', { bad: true }); seen[k] = 1; }
  const unit = String(F.unit || 'unit').trim().toLowerCase(), big = F.big && Math.round(num(F.perBuy)) > 1, per = big ? Math.round(num(F.perBuy)) : 1;
  if (F.big && !big) return toast('How many ' + unitWord(unit, 2) + ' are in one ' + (F.buyUnit || 'case') + '?', { bad: true });
  if (big && String(F.buyUnit || 'case').trim().toLowerCase() === unit) return toast('The bigger package needs its own name (like “case”).', { bad: true });
  /* a price or link needs a vendor — unless it's a 3.x supply's own, left as it was */
  const kept = s => s.v0 === '' && String(s.price || '') === String(s.p0 || '') && String(s.src || '').trim() === String(s.s0 || '').trim();
  if (E.sources.some(s => !String(s.vendor || '').trim() && (num(s.price) > 0 || String(s.src || '').trim()) && !kept(s))) return toast('Each price needs a vendor (or clear that row).', { bad: true });
  const key0 = (E.sources[0] || {}).key, noVendor = !String((E.sources[0] || {}).vendor || '').trim();
  if (noVendor && live.some(r => !r.lock && String(r.pr[key0] || '') !== String((r.pr0 ? JSON.parse(r.pr0) : {})[key0] || '') && num(r.pr[key0]) > 0)) return toast('A size’s price needs a vendor — name it under Where it’s bought.', { bad: true });
  const shared = edShared(F), shared0 = edit ? edShared(FM.f0) : null;
  const changed = edit ? Object.keys(shared).filter(k => JSON.stringify(shared[k]) !== JSON.stringify(shared0[k])) : Object.keys(shared);
  const minDef = String(F.min).trim() === '' ? 0 : Math.max(0, Math.round(num(F.min)));
  /* the prices are typed per what's bought: another package size re-reads them, as one supply's editor does */
  const perChanged = edit && (shared.perBuy !== shared0.perBuy || shared.buyUnit !== shared0.buyUnit);
  const sigChanged = edit && famSrcSig(E.sources) !== FM.sig0;
  if (!edit) FM.newFid = FM.newFid || 'fam-' + uid();
  live.forEach(r => { if (!r.id) r.newId = r.newId || 'custom-' + uid(); });
  withWho(async () => {
    busyBtn(t, true, 'Saving…'); E.busy = 'save';
    try {
      const s = stamp(), fid = FM.fid || FM.newFid, puts = [], patches = [], log = [], ids = live.map(r => r.id || r.newId);
      /* a new photo: saved once; shown by every size that showed the product's photo or had none (a size with a photo of its own
         keeps it); a new product's photo (a copy's too) by every size */
      let pic = null;
      if (E.photo.changed) {
        if (E.photo.thumb) {
          const a = await B.uploadPhoto(ids[0], dataUrlToBlob(E.photo.thumb), 'thumb');
          const b = E.photo.full && E.photo.full !== E.photo.thumb ? await B.uploadPhoto(ids[0], dataUrlToBlob(E.photo.full), 'full') : a;
          pic = { img: a.url, imgFull: b.url };
        } else pic = { img: E.photo.img || null, imgFull: E.photo.imgFull || null };
        Object.assign(pic, { imgUrl: null, imgFullUrl: null, imgKey: null });
      } else if (!edit && (E.photo.img || E.photo.imgFull)) pic = { img: E.photo.img || null, imgFull: E.photo.imgFull || null };
      const has = edit && !pic ? famPhotoItem(famMembers(fid)) : null;
      const ownPic = has ? { img: has.img || null, imgFull: has.imgFull || null, imgUrl: has.imgUrl || null, imgFullUrl: has.imgFullUrl || null, imgKey: has.imgKey || null } : null;
      live.forEach((r, k) => {
        const v = vals[k], nm = famFullName(name, v), m = r.id ? itemById(r.id) : null;
        const minR = String(r.min).trim() !== '' ? Math.max(0, Math.round(num(r.min))) : minDef;
        const fam = { fam: fid, famName: name, famOpts: optNames, famVals: v, famPos: k, name: nm };
        if (m) {
          const p = Object.assign({}, fam);
          changed.forEach(key => { p[key] = shared[key]; });
          if (minR !== (Number(m.min) || 0)) p.min = minR;
          const rowChanged = JSON.stringify(r.sk) !== r.sk0 || JSON.stringify(r.pr) !== r.pr0;
          if (sigChanged || perChanged || rowChanged) { const ns = famMemberSources(E, m, r, per, sigChanged || perChanged); p.sources = ns; p.vendorOrderPrice = ns[0] && ns[0].price != null ? round2(ns[0].price) : null; }
          /* (no vendor at all: the table's item # is the supply's own part #) */
          if (noVendor && String(r.sk[key0] || '') !== String(JSON.parse(r.sk0 || '{}')[key0] || '')) p.sku = String(r.sk[key0] || '').trim();
          if (pic && (!photoOf(m) || photoOf(m) === FM.pic0)) Object.assign(p, pic);
          p.updatedBy = s.by; p.updatedAt = s.at;
          patches.push([m.id, p]);
        } else {
          const q = num(r.qty), ns = famMemberSources(E, null, r, per, true);
          const rec = Object.assign({ id: ids[k] }, shared, fam, { sku: noVendor ? String(r.sk[key0] || '').trim() : '', min: minR, qty: q > 0 ? q : 0, chk: q > 0 ? s.at : null, tag: null, baseUnitQty: null,
            sources: ns, vendorOrderPrice: ns[0] && ns[0].price != null ? round2(ns[0].price) : null, createdBy: s.by, createdAt: s.at }, pic || ownPic || {});
          puts.push(rec);
          if (q > 0) log.push(logEntry({ itemId: rec.id, itemName: nm, delta: q, note: 'Starting count', type: 'count' }, s));
        }
      });
      if (edit) {
        FM.rows.filter(r => r.out && r.id).forEach(r => { const m = itemById(r.id); if (m) patches.push([m.id, famOffPatch(m, s)]); });
        /* its archived sizes keep up with a new name, and their choices stay under the right differences (o0: where each
           difference was when the editor opened) */
        if (name !== FM.name0 || JSON.stringify(optNames) !== FM.opts0) gone.forEach(m => { const ov = famValsOf(m), v = FM.opts.map(o => o.o0 != null ? ov[o.o0] || '' : ''); patches.push([m.id, { famName: name, famOpts: optNames, famVals: v, name: famFullName(name, v), updatedBy: s.by, updatedAt: s.at }]); });
      }
      await B.famSave(puts, patches);
      S.ui.ed = null; closeModal(true);
      ensureVendors(E.sources.map(x => x.vendor));
      let logNote = '';
      if (log.length) { try { await B.addLog(log); } catch (e) { logNote = ' (The starting counts weren’t written to the activity list: ' + errText(e) + ')'; } }
      toast((edit ? 'Saved ' + plainText(name, 50) + '.' : 'Added ' + plural(live.length, 'size') + ' of ' + plainText(name, 40) + '.') + logNote, logNote ? { bad: true, ms: 9000 } : {});
      openDrawer('fam', fid);
    } catch (e) { E.busy = ''; busyBtn(t, false); toast(errText(e), { bad: true }); }
  });
}
