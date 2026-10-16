/* =====================================================================
   Scan a packing slip (or invoice) — photos or PDFs.
   1. Pages: take photos (several pages) or pick files; digital PDFs are
      read from their text, which is faster and exact.
   2. The AI (Gemini, through the office's key or service) reads the
      lines and suggests which supply each one is. Only a unique exact SKU
      is trusted; every other match must be confirmed (one tap).
   3. Review: fix what it read — the supply, what came (2 cases × 10 =
      20 boxes), the price on the slip, discounts, tax and shipping.
   4. It's then filed in one of three ways:
      - against an OPEN order (found by order #, shared lines, or the only
        open order from that vendor; or picked by hand): received the same
        way as the Receive button — stock, dollars, a backorder for what
        didn't come, the price per box remembered — stamped with who did
        it. Lines that weren't on the order are added to it.
      - against an order ALREADY RECEIVED in the last 120 days (the paper
        invoice came later): prices, invoice #, tax and shipping only —
        never stock again.
      - no order: it's logged as a received order of its own.
   Spending follows the slip's own line totals. Shipping and tax are
   booked once per order. Built from the old app's scanner (Spec B),
   with its known faults fixed (the slip photo is kept, "No — add stock"
   stays chosen, the vendor can be corrected, receipts carry their order).
   ===================================================================== */
const SLIP_SYSTEM_PROMPT = "You extract data from dental/orthodontic supply invoices and packing slips. You may be given page IMAGES, extracted PDF TEXT, or both — treat them as the same single document. Return ONLY valid JSON, no markdown — a single object with exactly two keys: \"document\" and \"items\". The \"document\" object describes the whole invoice/slip; use null for anything not present. Its fields are: invoiceNumber (the invoice number as printed), invoiceDate (a short date string like 'Mar 2026'), orderNumber (the purchase order, sales order, or web order number), accountId (the customer/account number that identifies the BUYER on this vendor's system — labels like 'Account #', 'Account No', 'Customer #', 'Customer ID', 'Ship-to #'), vendorName (the supplier that issued this document), vendorAddress (the vendor's mailing address on one line). Do NOT confuse accountId (identifies the buyer) with invoiceNumber or orderNumber. The \"items\" array contains one object per line item with these EXACT field names: name (product name as printed), sku (part/catalog number), vendor (the SUPPLIER that issued this document — the same company as the document's vendorName — NOT the manufacturer or brand. Distributor slips such as Patterson and Henry Schein print a short manufacturer code beside each line, often truncated to about six letters, e.g. 'CETYLI' for Cetylite, 'PLASDE' for Plasdent, 'BUTLER' for Sunstar Butler. NEVER put such a code here: repeat the document's supplier for every line instead), price (unit price as number), qty (quantity as integer — the number of units shipped; use the SHIPPED column when shipped and ordered differ), slipUnit (the unit of measure on the slip, e.g. 'case', 'box', 'pack', 'ea', 'bag'), packQty (if the slip says something like '2 cases of 10 boxes', packQty is 10 — the number of smaller units per shipping unit; otherwise null), date (invoice date as short string like 'Mar 2026'), matchItemId (string or null — see below), matchConfidence ('high' or 'low'). MATCHING: You are given the practice's inventory list; each inventory line ends with an ID in the form [... ID: xyz]. For each invoice line, set matchItemId to the ID of the inventory item that IS this product, or null if none clearly is. The same product is often worded differently on the slip than in the inventory (abbreviations, word order, plural, size written as .019 vs 019, brand vs generic name) — match on product identity: brand, product type, size/spec, color/shade. Prefer SKU equality when SKUs are present. If several inventory items are plausible variants (different sizes, shades, colors, packaging) and the line does not clearly specify which one, set matchItemId to null instead of guessing. Set matchConfidence to 'high' only when the SKU matches or the identity is unmistakable. Copy the ID EXACTLY as printed after 'ID:' — never invent IDs. IMPORTANT: Use EXACTLY these field names: name, sku, vendor, price, qty, slipUnit, packQty, date, matchItemId, matchConfidence. PAY ATTENTION TO UNITS: distinguish between cases, boxes, packs, and individual items. If the slip says '2 CS' that means 2 cases, not 2 boxes. The inventory list shows how each item is tracked (Unit field). If the slip unit differs from the tracked unit, still report the slip values and packQty so the user can convert. Extract every line item you can read; skip pure charge lines like shipping, tax, fuel surcharge, or discounts (report those nowhere). If given multiple pages, they are pages of the SAME document — merge their line items into a single array and do not duplicate a line continued across pages. If the input is NOT an invoice or packing slip, return {\"document\":{},\"items\":[]}.";
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ---------- opening ---------- */
ACT.slipFor = t => openSlipScanner(t.dataset.id);
ACT.slipNew = () => openSlipScanner(null);
function openSlipScanner(orderId) {
  const o = orderId ? orderById(orderId) : null;
  if (o && o.status === 'received') return toast('That order was already received' + (o.receivedBy ? ' by ' + o.receivedBy : '') + '.', { bad: true });
  closeDrawer();
  S.ui.slip = { step: 'pages', pages: [], preset: o ? o.id : null, status: '', err: '', doc: {}, vendor: o ? o.vendor || '' : '', rows: [], tax: '', taxMode: '$', ship: '',
    match: { orderId: o ? o.id : null, choice: o ? 'picked' : '', recvId: null, recvChoice: '' }, ai: null, cam: false, busy: false };
  renderSlip();
  aiKeys().then(k => { const U = S.ui.slip; if (!U) return; U.ai = k; if (U.step === 'pages') renderSlip(); }).catch(() => { });
}
function slipAiReady(U) { return S.demo || !!(U.ai && (U.ai.gemini || U.ai.proxy)); }
function stopSlipCam() { const v = $('#slVid'); if (S.slipStream) { S.slipStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); S.slipStream = null; } if (v) v.srcObject = null; if (S.ui.slip) S.ui.slip.cam = false; }

/* ---------- step 1: pages ---------- */
function slipPagesHTML(U) {
  const o = U.preset ? orderById(U.preset) : null;
  let h = '<h3>Scan a packing slip</h3><div class="lsub">' + (o ? 'For the <b>' + esc(o.vendor || '') + '</b> order placed ' + esc(fmtWhen(o.orderedAt || o.dateOrdered)) + '. ' : '') + 'Photos of each page, or the PDF the vendor emailed.</div>';
  if (U.ai && !slipAiReady(U)) h += '<div class="notice">The AI reader isn’t set up yet (Dr. A turns it on under Settings → AI). You can still type the slip in by hand.</div>';
  h += '<div id="slCam" class="slCam' + (U.cam ? '' : ' hidden') + '"><video id="slVid" playsinline muted autoplay></video><div class="btnRow" style="justify-content:center"><button class="btn btn-act" data-act="slSnap">' + ic('camera', 16) + 'Take this page</button><button class="btn btn-sec" data-act="slCamOff">Done</button></div></div>';
  h += '<div class="slThumbs" id="slThumbs">' + slipThumbsHTML(U) + '</div>';
  h += '<div class="btnRow"><button class="btn btn-sec" data-act="slCamOn"' + (U.cam ? ' disabled' : '') + '>' + ic('camera', 16) + 'Take photos</button><button class="btn btn-sec" data-act="slFiles">' + ic('upload', 16) + 'Choose photos or PDFs</button>' +
    '<span style="flex:1"></span>' + (S.demo ? '<button class="linkBtn" data-act="slSample">Try a made-up slip</button>' : '') + '<button class="linkBtn" data-act="slManual">Type it in by hand</button></div>';
  h += '<div class="hint" id="slLoad">' + esc(U.status || '') + '</div>';
  h += '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="slRead" id="slReadBtn"' + (!U.pages.length || !slipAiReady(U) ? ' disabled' : '') + '>' + ic('spark', 16) + 'Read ' + (U.pages.length ? U.pages.length + ' page' + (U.pages.length === 1 ? '' : 's') : 'it') + '</button></div>';
  return h;
}
function slipThumbsHTML(U) {
  if (!U.pages.length) return '<div class="empty" style="padding:14px">No pages yet.</div>';
  return U.pages.map((p, k) => '<div class="slThumb"><img alt="" data-src="' + esc(p.url) + '"><span class="n">' + (k + 1) + '</span>' + (p.text && p.text.length >= 120 ? '<span class="txt" title="A digital PDF: its text is read directly (fast and exact)">TXT</span>' : '') + '<button class="x" data-act="slDropPage" data-k="' + k + '" aria-label="Remove page ' + (k + 1) + '">' + ic('x', 13) + '</button></div>').join('');
}
function renderSlip() {
  const U = S.ui.slip; if (!U) return;
  if (U.step === 'pages') {
    /* the camera, when on, keeps running: only the page list and the button are redrawn */
    if (U.cam && $('#slVid')) { $('#slThumbs').innerHTML = slipThumbsHTML(U); const b = $('#slReadBtn'); if (b) { b.disabled = !U.pages.length || !slipAiReady(U); b.innerHTML = ic('spark', 16) + 'Read ' + (U.pages.length ? U.pages.length + ' page' + (U.pages.length === 1 ? '' : 's') : 'it'); } return; }
    openModal(slipPagesHTML(U), { cls: 'wide', noFocus: true, cleanup: stopSlipCam });
  } else if (U.step === 'reading') {
    openModal('<h3>Reading the slip</h3><div class="slWait"><span class="spin"></span><div id="slStatus">' + esc(U.status || 'Reading…') + '</div><div class="hint">This usually takes 5–20 seconds.</div></div>', { cls: 'mid', noFocus: true, sticky: true });
  } else renderSlipReview();
}
ACT.slCamOn = async () => {
  const U = S.ui.slip;
  /* ask for the camera straight from the tap (phones require it) */
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } }); }
  catch (e) { return toast(/NotAllowed|Permission/i.test(e && e.name || '') ? 'The camera isn’t allowed for this site. Allow it in the browser’s settings, or choose photos instead.' : 'The camera couldn’t open: ' + (e.message || e), { bad: true }); }
  S.slipStream = stream; U.cam = true;
  const box = $('#slCam'); if (box) box.classList.remove('hidden');
  const b = $('[data-act="slCamOn"]'); if (b) b.disabled = true;
  const v = $('#slVid'); if (v) { v.srcObject = stream; try { await v.play(); } catch (e) { } }
};
ACT.slCamOff = () => { stopSlipCam(); const box = $('#slCam'); if (box) box.classList.add('hidden'); const b = $('[data-act="slCamOn"]'); if (b) b.disabled = false; };
ACT.slSnap = async () => {
  const U = S.ui.slip, v = $('#slVid'); if (!v || v.readyState < 2) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  const url = await downscaleDataUrl(c.toDataURL('image/jpeg', 0.9), 1800, 0.82);
  U.pages.push({ url, text: '' }); beep(true); renderSlip();
};
ACT.slDropPage = t => { const U = S.ui.slip; U.pages.splice(Number(t.dataset.k), 1); renderSlip(); };
ACT.slFiles = async () => {
  const U = S.ui.slip;
  const files = await new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,.pdf,application/pdf'; i.multiple = true; i.style.display = 'none'; i.onchange = () => { const f = Array.from(i.files || []); i.remove(); res(f); }; document.body.appendChild(i); i.click(); });
  if (!files.length || S.ui.slip !== U) return;
  const st = $('#slLoad'); if (st) st.textContent = 'Loading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…';
  let bad = 0;
  for (const f of files) { try { const ps = await readFileToPages(f); if (!ps.length) bad++; U.pages.push(...ps); } catch (e) { console.warn(e); bad++; } }
  if (st) st.textContent = '';
  if (bad) toast(bad + ' file' + (bad === 1 ? '' : 's') + ' couldn’t be opened.', { bad: true });
  renderSlip();
};
async function readFileToPages(f) {
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
  if (!isPdf) { const d = await readFileAsDataUrl(f); return [{ url: await downscaleDataUrl(await ensureJpeg(d), 1800, 0.82), text: '' }]; }
  await loadLib('pdf');
  if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise, out = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 12); p++) {
    const page = await pdf.getPage(p), vp1 = page.getViewport({ scale: 1 }), scale = Math.max(1, Math.min(2, 1800 / Math.max(vp1.width, vp1.height))), vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push({ url: c.toDataURL('image/jpeg', 0.85), text: await extractPdfPageText(page) });
  }
  return out;
}
/* the PDF's own text, line by line (4-point bands), left to right */
async function extractPdfPageText(page) {
  try {
    const tc = await page.getTextContent(), rows = {};
    (tc.items || []).forEach(t => { if (!t || typeof t.str !== 'string' || !t.str.trim()) return; const y = Math.round(((t.transform && t.transform[5]) || 0) / 4) * 4; (rows[y] = rows[y] || []).push({ x: (t.transform && t.transform[4]) || 0, s: t.str }); });
    return Object.keys(rows).map(Number).sort((a, b) => b - a).map(y => rows[y].sort((a, b) => a.x - b.x).map(c => c.s).join(' ').replace(/\s{3,}/g, '  ').trim()).filter(Boolean).join('\n');
  } catch (e) { return ''; }
}
/* the demo: a made-up slip drawn on the spot */
ACT.slSample = () => {
  const c = document.createElement('canvas'); c.width = 850; c.height = 1100; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#1B2F4C'; g.font = 'bold 34px Arial'; g.fillText('SunSurgical — Packing Slip', 50, 80);
  g.font = '18px Arial'; g.fillStyle = '#333'; ['Invoice INV-20931 · Order SS-48211 · Oct 2026', 'Ship to: Next Level Orthodontics'].forEach((t, i) => g.fillText(t, 50, 130 + i * 30));
  g.font = 'bold 16px Arial'; ['QTY', 'UOM', 'ITEM', 'DESCRIPTION', 'PRICE'].forEach((t, i) => g.fillText(t, [50, 110, 180, 300, 700][i], 230));
  g.font = '16px Arial'; [['2', 'CS', '177102', 'PULSE NITRILE GLOVE SM DK BLUE', '91.30'], ['2', 'PK', 'MRA400', 'Microbrush Rect Fine 100/pk', '90.31'], ['3', 'PK', '22-2000', 'Gauze Sponge 2x2 Non-Sterile', '6.20']].forEach((r, j) => r.forEach((t, i) => g.fillText(t, [50, 110, 180, 300, 700][i], 270 + j * 34)));
  S.ui.slip.pages.push({ url: c.toDataURL('image/jpeg', 0.85), text: '' }); renderSlip();
};
ACT.slManual = () => { const U = S.ui.slip; stopSlipCam(); U.step = 'review'; U.rows = [slipEmptyRow()]; renderSlip(); };

/* ---------- step 2: the AI ---------- */
ACT.slRead = async () => {
  const U = S.ui.slip; if (!U.pages.length) return;
  stopSlipCam(); U.step = 'reading'; U.status = 'Getting the pages ready…'; U.err = ''; renderSlip();
  const say = m => { U.status = m; const e = $('#slStatus'); if (e) e.textContent = m; };
  try {
    const res = S.demo ? await slipDemoRead() : await slipAiRead(U.pages, U.ai, say);
    if (S.ui.slip !== U) return;
    say('Matching the lines to your supplies…');
    U.doc = res.doc; U.vendor = U.vendor || res.doc.vendorName || (res.rows.find(r => r.vendor) || {}).vendor || '';
    U.rows = slipBuildRows(res.rows);
    if (!U.rows.length) { U.rows = [slipEmptyRow()]; U.err = 'The AI didn’t find any lines on that. Check it’s a clear photo of a packing slip or invoice, or type the lines in below.'; }
    U.step = 'review';
    if (!U.match.choice) slipMatchOrders(U);
  } catch (e) {
    if (S.ui.slip !== U) return;
    U.err = errText(e); U.step = 'review'; if (!U.rows.length) U.rows = [slipEmptyRow()];
  }
  renderSlip();
};
async function slipAiRead(pagesIn, keys, say) {
  if (!keys || (!keys.gemini && !keys.proxy)) throw new Error('The AI reader isn’t set up (Settings → AI).');
  const pages = [];
  for (const p of pagesIn) { let u = p.url; if (!/^data:image\/(jpeg|png)/.test(u)) u = await ensureJpeg(u); pages.push({ url: await downscaleDataUrl(u, 1800, 0.82), text: p.text || '' }); }
  const multi = pages.length > 1;
  const inv = activeItems().map(i => i.name + ' [SKU: ' + (i.sku || (primarySource(i) || {}).sku || '-') + ', Unit: ' + countUnit(i) + ', ID: ' + i.id + ']').join('\n');
  const run = async textMode => {
    const parts = [], texts = [];
    pages.forEach((p, i) => { if (textMode && p.text.length >= 120) texts.push('--- PAGE ' + (i + 1) + ' ---\n' + p.text); else parts.push({ inline_data: { mime_type: dataUrlMime(p.url), data: dataUrlToBase64(p.url) } }); });
    const userText = 'Extract the document details (invoice number, invoice date, order number, account/customer ID, vendor name and address) and all line items from this invoice/packing slip, and match each line to my inventory where possible.' +
      (multi ? ' The content covers ' + pages.length + ' consecutive pages of the SAME document — combine all line items into one list and report one document object.' : '') +
      '\n\nHere is my current inventory with tracked units and IDs:\n' + inv + (texts.length ? '\n\nText extracted from the PDF (layout preserved, columns separated by spaces):\n' + texts.join('\n\n') : '');
    const kb = Math.round(parts.reduce((a, p) => a + p.inline_data.data.length * 0.75, 0) / 1024);
    say(parts.length ? 'Reading ' + (pages.length > 1 ? pages.length + ' pages' : 'the slip') + ' (' + (kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB') + ')…' : 'Reading the slip’s text (fast)…');
    const data = await callGeminiGenerateContent({ system_instruction: { parts: [{ text: SLIP_SYSTEM_PROMPT }] }, contents: [{ parts: [{ text: userText }].concat(parts) }], generationConfig: { responseMimeType: 'application/json', temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }, keys.gemini, keys.proxy, { onStatus: say });
    if (!data || !data.candidates) throw new Error('The AI sent back nothing. Try again with a clearer photo.');
    const text = geminiResponseText(data);
    if (!text) throw new Error('The AI sent back no text. Try again with a clearer photo.');
    return slipParseReply(text);
  };
  const canText = pages.some(p => p.text.length >= 120);
  if (canText) {
    try { const r = await run(true); if (r.rows.length) return r; say('The text had no lines — reading the pages as pictures…'); }
    catch (e) { say('Reading the text didn’t work — reading the pages as pictures…'); }
  }
  return run(false);
}
/* the AI's answer → { doc, rows } (it doesn't always use the exact field names) */
function slipParseReply(text) {
  const parsed = extractJsonBlock(text); if (parsed == null) throw new Error('The AI’s answer couldn’t be read. Try again, or type the lines in.');
  let doc = {}, rows;
  if (Array.isArray(parsed)) rows = parsed;
  else { doc = parsed.document || parsed.header || parsed.documentInfo || parsed.invoice || {}; rows = parsed.items || parsed.line_items || parsed.lineItems || parsed.lines; if (!Array.isArray(rows)) rows = Object.keys(doc).length ? [] : [parsed]; }
  const pick = (o, ks) => { for (const k of ks) { if (o && o[k] != null && o[k] !== '') return o[k]; } return null; };
  const d = { invoiceNumber: pick(doc, ['invoiceNumber', 'invoice_number', 'invoiceNo', 'invoice_no', 'invoice']) || '', invoiceDate: pick(doc, ['invoiceDate', 'invoice_date', 'date']) || '', orderNumber: pick(doc, ['orderNumber', 'order_number', 'orderNo', 'poNumber', 'po_number', 'po', 'salesOrder', 'sales_order']) || '',
    accountId: pick(doc, ['accountId', 'account_id', 'accountNumber', 'account_number', 'accountNo', 'customerId', 'customer_id', 'customerNumber', 'customer_number', 'acct']) || '', vendorName: pick(doc, ['vendorName', 'vendor_name', 'vendor', 'supplier']) || '', vendorAddress: pick(doc, ['vendorAddress', 'vendor_address', 'address']) || '' };
  Object.keys(d).forEach(k => { d[k] = String(d[k]).trim(); });
  const out = (rows || []).filter(r => r && typeof r === 'object' && (pick(r, ['name', 'product', 'item', 'description', 'product_name', 'item_name']) || pick(r, ['sku', 'SKU', 'part_number', 'partNumber', 'catalog_number', 'catalogNumber', 'item_number']) || pick(r, ['qty', 'quantity', 'shipped', 'received', 'count'])))
    .map(r => ({ name: String(pick(r, ['name', 'product', 'item', 'description', 'product_name', 'item_name']) || ''), sku: String(pick(r, ['sku', 'SKU', 'part_number', 'partNumber', 'catalog_number', 'catalogNumber', 'item_number', 'itemNumber', 'product_code']) || ''),
      vendor: String(pick(r, ['vendor', 'supplier', 'company', 'from']) || ''), price: pick(r, ['price', 'unit_price', 'unitPrice', 'cost', 'amount']), qty: pick(r, ['qty', 'quantity', 'shipped', 'received', 'count', 'units']) || 0,
      date: String(pick(r, ['date', 'invoice_date', 'invoiceDate', 'ship_date', 'shipDate', 'order_date']) || ''), slipUnit: String(pick(r, ['slipUnit', 'slip_unit', 'unit', 'uom', 'UOM']) || ''), packQty: pick(r, ['packQty', 'pack_qty', 'per_unit']), matchItemId: pick(r, ['matchItemId', 'match_item_id', 'matchedItemId', 'matched_item_id']) }));
  return { doc: d, rows: out };
}
/* the demo has no AI: a made-up slip, read as if by the AI */
function slipDemoRead() {
  return new Promise(res => setTimeout(() => res({ doc: { invoiceNumber: 'INV-20931', invoiceDate: 'Oct 2026', orderNumber: 'SS-48211', accountId: '', vendorName: 'SunSurgical', vendorAddress: '' },
    rows: [{ name: 'PULSE NITRILE GLOVE SM DK BLUE', sku: '177102', vendor: 'SunSurgical', price: 91.3, qty: 2, slipUnit: 'CS', packQty: 10, matchItemId: null },
      { name: 'Microbrush Rect Fine 100/pk', sku: 'MRA400', vendor: 'SunSurgical', price: 90.31, qty: 2, slipUnit: 'PK', packQty: null, matchItemId: null },
      { name: 'Gauze Sponge 2x2 Non-Sterile', sku: '22-2000', vendor: 'SunSurgical', price: 6.2, qty: 3, slipUnit: 'PK', packQty: null, matchItemId: null }] }), 1400));
}
/* units on a slip, compared loosely: "CS" = case, "BX" = box */
function unitKey(u) { const s = String(u || '').trim().toLowerCase().replace(/\.$/, ''); const map = { cs: 'case', cases: 'case', case: 'case', bx: 'box', box: 'box', boxes: 'box', pk: 'pack', pkg: 'pack', pack: 'pack', packs: 'pack', pkgs: 'pack', ea: 'each', each: 'each', bg: 'bag', bag: 'bag', bags: 'bag', ct: 'carton', ctn: 'carton', carton: 'carton', bt: 'bottle', btl: 'bottle', bottle: 'bottle' }; return map[s] || s.replace(/s$/, ''); }
function slipEmptyRow() { return { key: uid(), itemId: '', matchType: '', reviewed: false, isNew: false, newName: '', aiName: '', sku: '', slipUnit: '', slipQty: '', packQty: '', qty: '', price: '', discount: '', date: '', unit: 'ea', suggestions: [], vendor: '' }; }
function slipBuildRows(raw) {
  const its = activeItems(), idx = buildInventoryMatchIndex(its);
  return raw.map(r => {
    const m = matchRowToItem(r, its, idx), it = m.itemId ? itemById(m.itemId) : null;
    let pq = Number(r.packQty); pq = isFinite(pq) && pq > 0 ? pq : null;
    let sq = Number(r.qty); sq = isFinite(sq) && sq >= 0 ? sq : 0;
    /* the slip says cases and the supply is bought by the case: a case holds what the supply says, when the slip doesn't */
    if (!pq && it && buysBigger(it) && unitKey(r.slipUnit) === unitKey(buyUnit(it))) pq = perBuy(it);
    const row = Object.assign(slipEmptyRow(), { itemId: m.itemId || '', matchType: m.matchType || '', isNew: !m.itemId, newName: m.itemId ? '' : r.name, aiName: r.name, sku: r.sku || '', vendor: r.vendor || '',
      slipUnit: r.slipUnit || '', slipQty: sq > 0 ? String(sq) : '', packQty: pq && pq > 1 ? String(pq) : '', price: isFinite(parseFloat(r.price)) ? String(r.price) : '', date: r.date || '', unit: it ? countUnit(it) : (_canonical(r.slipUnit, ORDER_UNITS) || 'each').toLowerCase(), suggestions: m.suggestions || [] });
    row.qty = String(slipFinal(row));
    return row;
  });
}
/* the math (per row): what's counted = slip qty × per; the cost per counted unit = slip price ÷ per; the line = slip price × slip qty − discount */
function slipPer(r) { const p = num(r.packQty); return p > 1 ? p : 1; }
function slipFinal(r) { return round2((num(r.slipQty) || 0) * slipPer(r)); }
function slipLineTotal(r) { return Math.max(0, round2((num(r.price) || 0) * (num(r.slipQty) || (num(r.qty) / slipPer(r)) || 0) - (num(r.discount) || 0))); }
function slipTrackedPrice(r) { const p = parseFloat(r.price); if (!isFinite(p)) return null; return Math.round(p / slipPer(r) * 10000) / 10000; }
function slipApplied(r) { return (r.itemId && !r.isNew) || (r.isNew && String(r.newName).trim()); }
function slipNeedsLook(r) { return !!(r.itemId && !r.isNew && r.matchType === 'fuzzy' && !r.reviewed); }
function slipTax(U, sub) { const v = num(U.tax) || 0; return U.taxMode === '%' ? round2(sub * v / 100) : round2(v); }

/* ---------- which order is this? ---------- */
function slipOrderPool(statuses) { return S.D.orders.filter(o => statuses.includes(o.status)); }
function slipMatchOrders(U) {
  const vendor = U.vendor || '', num = U.doc.orderNumber || '';
  const open = slipOrderPool(['open', 'backordered']);
  U.match.orderId = null;
  if (open.length) {
    /* the order # decides; else the same supplies (an exact supply on both, or similar lines from the same vendor) */
    const ids = new Set(U.rows.filter(r => r.itemId && !r.isNew).map(r => r.itemId));
    const scored = open.map(o => { const s = scoreOrderAgainstScan(o, U.rows, vendor, num); s.idHits = o.items.filter(l => l.itemId && ids.has(l.itemId)).length; return { o, s }; })
      .filter(x => x.s.numHit || (x.s.idHits > 0 && (x.s.vendorHit || !vendor)) || (x.s.itemHits > 0 && x.s.vendorHit)).sort((a, b) => b.s.score - a.s.score);
    const best = scored[0];
    if (best) { U.match.orderId = best.o.id; U.match.recvId = null; return; }
    const sameVendor = open.filter(o => vendor && vendorNamesSimilar(o.vendor, vendor));
    if (sameVendor.length === 1) { U.match.orderId = sameVendor[0].id; U.match.recvId = null; return; }
  }
  /* an order already received (in the last 120 days): only when it's clearly the same one */
  if (U.match.recvChoice === 'dismissed') return;
  const since = Date.now() - 120 * 864e5;
  const recv = slipOrderPool(['received']).filter(o => msOf(o.dateReceived) >= since);
  const best = recv.map(o => ({ o, s: scoreOrderAgainstScan(o, U.rows, vendor, num) })).sort((a, b) => b.s.score - a.s.score)[0];
  U.match.recvId = best && (best.s.numHit || (best.s.itemHits > 0 && best.s.vendorHit)) ? best.o.id : null;
}
function slipOrderLabel(o) { return (o.vendor || 'Order') + ' — ordered ' + (o.orderedAt || o.dateOrdered ? fmtDate(o.orderedAt || o.dateOrdered) : '?') + (o.orderNumber ? ' · #' + o.orderNumber : '') + ' — ' + o.items.slice(0, 3).map(l => l.name).join(', ') + (o.items.length > 3 ? '…' : ''); }

/* ---------- step 3: review ---------- */
function renderSlipReview() {
  const U = S.ui.slip, rows = U.rows;
  const applied = rows.filter(slipApplied), sub = round2(applied.reduce((a, r) => a + slipLineTotal(r), 0)), tax = slipTax(U, sub), ship = round2(num(U.ship) || 0);
  const o = U.match.orderId ? orderById(U.match.orderId) : null, rcv = !o && U.match.recvId ? orderById(U.match.recvId) : null;
  const vnames = Array.from(new Set(S.D.vendors.map(v => v.name).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  let h = '<h3>Check the slip</h3><div class="lsub">' + applied.length + ' of ' + rows.length + ' line' + (rows.length === 1 ? '' : 's') + ' will be filed' + (rows.some(slipNeedsLook) ? ' · <b style="color:var(--amber-700)">' + rows.filter(slipNeedsLook).length + ' to confirm</b>' : '') + '</div>';
  if (U.err) h += '<div class="notice bad">' + esc(U.err) + '</div>';
  /* the vendor and the paper's numbers */
  h += '<div class="grid4 slDoc">' + field('Vendor', '<input id="slVendor" list="slVendors" value="' + esc(U.vendor) + '" data-chg="slVendor" placeholder="Who sent it">' + '<datalist id="slVendors">' + vnames.map(n => '<option value="' + esc(n) + '">').join('') + '</datalist>') +
    field('Invoice #', '<input id="slInv" value="' + esc(U.doc.invoiceNumber || '') + '" data-inp="slDoc" data-f="invoiceNumber">') + field('Order #', '<input id="slOrd" value="' + esc(U.doc.orderNumber || '') + '" data-chg="slOrdNum">') +
    field('Account # on the slip', '<input id="slAcct" value="' + esc(U.doc.accountId || '') + '" data-inp="slDoc" data-f="accountId">', slipAcctHint(U)) + '</div>';
  /* which order */
  const pool = slipOrderPool(['open', 'backordered']), near = pool.filter(x => U.vendor && vendorNamesSimilar(x.vendor, U.vendor)), list = near.length ? near : pool;
  if (o) h += '<div class="slOrder ok">' + ic('truck', 18) + '<div class="grow"><b>Receiving the ' + esc(o.vendor || '') + ' order</b><span>Ordered by ' + esc(o.orderedBy || '—') + ', ' + esc(fmtWhen(o.orderedAt || o.dateOrdered)) + ' · ' + o.items.length + ' line' + (o.items.length === 1 ? '' : 's') + '. What didn’t come stays on order (a backorder).</span>' +
    (list.length > 1 || U.match.choice ? '<select data-chg="slPick" aria-label="Which order">' + list.map(x => '<option value="' + esc(x.id) + '"' + (x.id === o.id ? ' selected' : '') + '>' + esc(slipOrderLabel(x)) + '</option>').join('') + '<option value="">None — not for an open order</option></select>' : '') + '</div><button class="btn btn-ghost btn-sm" data-act="slNoOrder">Not this order</button></div>';
  else if (rcv) h += '<div class="slOrder recv">' + ic('receive', 18) + '<div class="grow"><b>This is for an order already received</b><span>' + esc(rcv.vendor || '') + ', received ' + esc(fmtWhen(rcv.dateReceived)) + (rcv.receivedBy ? ' by ' + esc(rcv.receivedBy) : '') + '. Prices, invoice #, tax and shipping are updated — <b>stock is not counted again</b>.</span></div><button class="btn btn-sec btn-sm" data-act="slRecvNo">No — it’s a new delivery</button></div>';
  else h += '<div class="slOrder none">' + ic('doc', 18) + '<div class="grow"><b>Not for an open order</b><span>It’s filed as a received order of its own.' + (list.length ? '' : '') + '</span>' + (list.length ? '<select data-chg="slPick" aria-label="Pick an open order"><option value="">Is it for one of these open orders?</option>' + list.map(x => '<option value="' + esc(x.id) + '">' + esc(slipOrderLabel(x)) + '</option>').join('') + '</select>' : '') + '</div></div>';
  /* the lines */
  const names = activeItems().map(i => i.name).sort((a, b) => a.localeCompare(b));
  h += '<datalist id="slItems">' + names.map(n => '<option value="' + esc(n) + '">').join('') + '</datalist>';
  h += rows.map((r, k) => slipRowHTML(r, k)).join('') + '<button class="btn btn-ghost btn-sm" data-act="slAddRow" style="margin-top:6px">' + ic('plus', 14) + 'Add a line</button>';
  /* money */
  h += '<div class="slMoney"><div><span>Lines</span><b id="slSub">' + money(sub) + '</b></div>' +
    '<div><span>Tax</span><span class="inRow"><input id="slTax" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(U.tax) + '" data-inp="slMoneyInp" placeholder="0.00" class="xs"><span class="seg mini"><button data-act="slTaxMode" data-m="$" aria-pressed="' + (U.taxMode === '$') + '">$</button><button data-act="slTaxMode" data-m="%" aria-pressed="' + (U.taxMode === '%') + '">%</button></span></span><b id="slTaxAmt">' + (U.taxMode === '%' ? money(tax) : '') + '</b></div>' +
    '<div><span>Shipping</span><input id="slShip" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(U.ship) + '" data-inp="slMoneyInp" placeholder="0.00" class="xs"></div>' +
    '<div class="tot"><span>Total</span><b id="slTot">' + money(sub + tax + ship) + '</b></div></div>';
  if (U.pages.length) h += '<details class="slPeek"><summary>See the slip</summary>' + U.pages.map(p => '<img alt="" data-src="' + esc(p.url) + '">').join('') + '</details>';
  h += '<div class="mFt"><button class="btn btn-ghost" data-act="slBack" style="margin-right:auto">' + ic('back', 15) + 'Pages</button><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="slGo"' + (applied.length && !U.busy ? '' : ' disabled') + '>' + ic('check', 16) + (o ? 'Receive it' : rcv ? 'Update the order' : 'File it') + '</button></div>';
  const y = $('#modalWrap') ? $('#modalWrap').scrollTop : 0, my = $('#modalWrap .modal') ? $('#modalWrap .modal').scrollTop : 0;
  const w = openModal(h, { cls: 'wide slModal', noFocus: true, confirmClose: 'Close without filing this slip?' });
  if (y) w.scrollTop = y; const m = $('.modal', w); if (m && my) m.scrollTop = my;
}
function slipAcctHint(U) {
  const v = vendorByName(U.vendor), a = String(U.doc.accountId || '').trim();
  if (!v || !a) return '';
  if (v.acct && v.acct.replace(/\s/g, '').toLowerCase() !== a.replace(/\s/g, '').toLowerCase()) return esc(v.name) + ' has #' + esc(v.acct) + ' on file — keeping it.';
  return v.acct ? '' : 'Saved to ' + esc(v.name) + ' (it has none yet).';
}
function slipRowHTML(r, k) {
  const it = r.itemId && !r.isNew ? itemById(r.itemId) : null, look = slipNeedsLook(r), per = slipPer(r);
  const state = r.isNew ? 'new' : it ? (look ? 'look' : 'ok') : 'skip';
  const unit = it ? countUnit(it) : (r.unit || 'each');
  const tp = slipTrackedPrice(r);
  let h = '<div class="slRow ' + state + '"><div class="slHd"><span class="n">' + (k + 1) + '</span><span class="st">' + (state === 'ok' ? ic('check', 13) + 'Matched' : state === 'look' ? ic('warn', 13) + 'Check this match' : state === 'new' ? ic('plus', 13) + 'New supply' : 'Skipped') + '</span>' +
    (r.aiName ? '<span class="ai" title="As printed on the slip">“' + esc(r.aiName) + '”</span>' : '') + '<span style="flex:1"></span><span class="lt" id="slLt' + k + '">' + (slipLineTotal(r) ? money(slipLineTotal(r)) : '') + '</span><button class="iconBtn" data-act="slDelRow" data-k="' + k + '" aria-label="Remove this line">' + ic('trash', 15) + '</button></div>';
  if (look) h += '<div class="slLook">The AI guessed this one. <button class="btn btn-sec btn-sm" data-act="slOk" data-k="' + k + '">' + ic('check', 14) + 'It’s right</button></div>';
  const sugg = (r.suggestions || []).filter(id => id !== r.itemId && itemById(id)).slice(0, 3);
  if (sugg.length && (look || r.isNew || !it)) h += '<div class="chips slSugg">' + sugg.map(id => '<button class="chip" data-act="slUse" data-k="' + k + '" data-id="' + esc(id) + '">' + (look ? '→ ' : 'Match: ') + esc(itemById(id).name) + '</button>').join('') + '</div>';
  h += '<div class="slGrid">';
  if (r.isNew) h += field('New supply', '<div class="inRow"><input value="' + esc(r.newName) + '" data-inp="slInp" data-k="' + k + '" data-f="newName" placeholder="Name"><input value="' + esc(r.unit) + '" data-inp="slInp" data-k="' + k + '" data-f="unit" class="xs" list="edUnitsSl" aria-label="Counted in"></div><datalist id="edUnitsSl">' + COUNT_UNITS.map(u => '<option value="' + u + '">').join('') + '</datalist>', '<button class="linkBtn" data-act="slMatchMode" data-k="' + k + '">It’s one we have</button>');
  else h += field('Supply', '<input value="' + esc(it ? it.name : '') + '" list="slItems" data-chg="slPickItem" data-k="' + k + '" placeholder="Type to find it">', it ? 'Counted in ' + esc(unitWord(unit, 2)) + (buysBigger(it) ? ' · bought by the ' + esc(buyUnit(it)) + ' of ' + perBuy(it) : '') + ' · <button class="linkBtn" data-act="slNewMode" data-k="' + k + '">New supply instead</button>' : '<button class="linkBtn" data-act="slNewMode" data-k="' + k + '">Add it as a new supply</button>');
  h += field('SKU', '<input value="' + esc(r.sku) + '" data-inp="slInp" data-k="' + k + '" data-f="sku">') + '</div>';
  h += '<div class="slGrid q"><div class="field"><label>Came</label><div class="inRow"><input type="number" inputmode="decimal" min="0" step="any" value="' + esc(r.slipQty) + '" data-inp="slInp" data-k="' + k + '" data-f="slipQty" class="xs" aria-label="How many on the slip"><input value="' + esc(r.slipUnit) + '" data-inp="slInp" data-k="' + k + '" data-f="slipUnit" class="xs" placeholder="unit" aria-label="Unit on the slip"></div></div>' +
    '<div class="field"><label>× each holds</label><input type="number" inputmode="decimal" min="1" step="any" value="' + esc(r.packQty) + '" data-inp="slInp" data-k="' + k + '" data-f="packQty" placeholder="1" aria-label="How many in each"></div>' +
    '<div class="field"><label>= Adds to stock</label><div class="slFinal" id="slFin' + k + '"><b>' + esc(qtyFmt(num(r.qty) || 0)) + '</b> ' + esc(unitWord(unit, num(r.qty))) + '</div></div>' +
    '<div class="field"><label>Price on the slip</label><input type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(r.price) + '" data-inp="slInp" data-k="' + k + '" data-f="price" aria-label="Price each"><div class="hint" id="slPp' + k + '">' + (per > 1 && tp != null ? '= ' + money(tp) + ' a ' + esc(unit) : r.slipUnit ? 'per ' + esc(r.slipUnit) : '') + '</div></div>' +
    '<div class="field"><label>Line discount</label><input type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(r.discount) + '" data-inp="slInp" data-k="' + k + '" data-f="discount" placeholder="0.00"></div></div>';
  return h + '</div>';
}
/* typing in a line: only the numbers that depend on it are redrawn */
INP.slInp = t => {
  const U = S.ui.slip, k = Number(t.dataset.k), r = U.rows[k], f = t.dataset.f; if (!r) return;
  r[f] = t.value;
  if (f === 'slipQty' || f === 'packQty') r.qty = String(slipFinal(r));
  const it = r.itemId && !r.isNew ? itemById(r.itemId) : null, unit = it ? countUnit(it) : (r.unit || 'each');
  const fin = $('#slFin' + k); if (fin) fin.innerHTML = '<b>' + esc(qtyFmt(num(r.qty) || 0)) + '</b> ' + esc(unitWord(unit, num(r.qty)));
  const lt = $('#slLt' + k); if (lt) lt.textContent = slipLineTotal(r) ? money(slipLineTotal(r)) : '';
  const pp = $('#slPp' + k), tp = slipTrackedPrice(r); if (pp) pp.textContent = slipPer(r) > 1 && tp != null ? '= ' + money(tp) + ' a ' + unit : r.slipUnit ? 'per ' + r.slipUnit : '';
  const go = $('[data-act="slGo"]'); if (go) go.disabled = !U.rows.some(slipApplied) || U.busy;
  INP.slMoneyInp();
};
INP.slMoneyInp = () => {
  const U = S.ui.slip; U.tax = val('slTax'); U.ship = val('slShip');
  const sub = round2(U.rows.filter(slipApplied).reduce((a, r) => a + slipLineTotal(r), 0)), tax = slipTax(U, sub), ship = round2(num(U.ship) || 0);
  const a = $('#slSub'); if (a) a.textContent = money(sub); const b = $('#slTaxAmt'); if (b) b.textContent = U.taxMode === '%' ? money(tax) : ''; const c = $('#slTot'); if (c) c.textContent = money(sub + tax + ship);
};
INP.slDoc = t => { S.ui.slip.doc[t.dataset.f] = t.value; };
function slipKeep() { const U = S.ui.slip; if (!U || !$('#slVendor')) return; U.vendor = val('slVendor').trim(); U.doc.invoiceNumber = val('slInv'); U.doc.orderNumber = val('slOrd'); U.doc.accountId = val('slAcct'); U.tax = val('slTax'); U.ship = val('slShip'); }
CHG.slVendor = () => { slipKeep(); const U = S.ui.slip; if (!U.match.choice) slipMatchOrders(U); renderSlip(); };
CHG.slOrdNum = () => { slipKeep(); const U = S.ui.slip; if (!U.match.choice) slipMatchOrders(U); renderSlip(); };
CHG.slPick = t => { slipKeep(); const U = S.ui.slip; U.match.orderId = t.value || null; U.match.choice = t.value ? 'picked' : 'dismissed'; if (t.value) U.match.recvId = null; renderSlip(); };
ACT.slNoOrder = () => { slipKeep(); const U = S.ui.slip; U.match.orderId = null; U.match.choice = 'dismissed'; renderSlip(); };
ACT.slRecvNo = () => { slipKeep(); const U = S.ui.slip; U.match.recvId = null; U.match.recvChoice = 'dismissed'; renderSlip(); };
CHG.slPickItem = t => {
  slipKeep(); const U = S.ui.slip, r = U.rows[Number(t.dataset.k)]; if (!r) return;
  const v = t.value.trim().toLowerCase(), it = activeItems().find(i => String(i.name || '').toLowerCase() === v);
  if (!it) { toast('Pick a supply from the list (or add it as a new one).', { bad: true }); return renderSlip(); }
  slipSetItem(U, r, it.id);
};
function slipSetItem(U, r, id) {
  const it = itemById(id); if (!it) return;
  Object.assign(r, { itemId: id, matchType: 'manual', reviewed: true, isNew: false, newName: '', unit: countUnit(it) });
  if (!num(r.packQty) && buysBigger(it) && unitKey(r.slipUnit) === unitKey(buyUnit(it))) r.packQty = String(perBuy(it));
  r.qty = String(slipFinal(r));
  if (!U.match.choice) slipMatchOrders(U);
  renderSlip();
}
ACT.slUse = t => { slipKeep(); const U = S.ui.slip; slipSetItem(U, U.rows[Number(t.dataset.k)], t.dataset.id); };
ACT.slOk = t => { slipKeep(); const U = S.ui.slip, r = U.rows[Number(t.dataset.k)]; if (r) r.reviewed = true; if (!U.match.choice) slipMatchOrders(U); renderSlip(); };
ACT.slNewMode = t => { slipKeep(); const r = S.ui.slip.rows[Number(t.dataset.k)]; if (!r) return; Object.assign(r, { isNew: true, itemId: '', newName: r.newName || r.aiName || '' }); renderSlip(); };
ACT.slMatchMode = t => { slipKeep(); const r = S.ui.slip.rows[Number(t.dataset.k)]; if (!r) return; Object.assign(r, { isNew: false, itemId: '', newName: '' }); renderSlip(); };
ACT.slDelRow = t => { slipKeep(); S.ui.slip.rows.splice(Number(t.dataset.k), 1); renderSlip(); };
ACT.slAddRow = () => { slipKeep(); const r = slipEmptyRow(); r.isNew = false; S.ui.slip.rows.push(r); renderSlip(); };
ACT.slTaxMode = t => { slipKeep(); S.ui.slip.taxMode = t.dataset.m; renderSlip(); };
ACT.slBack = () => { slipKeep(); const U = S.ui.slip; U.step = 'pages'; U.err = ''; renderSlip(); };

/* ---------- step 4: filing it ---------- */
ACT.slGo = async t => {
  slipKeep(); const U = S.ui.slip;
  const rows = U.rows.filter(slipApplied); if (!rows.length) return toast('Match at least one line, or add it as a new supply.', { bad: true });
  if (rows.some(r => !(slipFinal(r) > 0) && !(num(r.qty) > 0))) return toast('Every line needs how many came.', { bad: true });
  const unsure = rows.filter(slipNeedsLook);
  if (unsure.length && !await confirmBox('Are these matches right?', unsure.map(r => '• “' + (r.aiName || r.sku || 'a line') + '” → ' + ((itemById(r.itemId) || {}).name || '?') + ' (adds ' + qtyFmt(num(r.qty)) + ')').join('\n') + '\n\nThe numbers are added to the supply on the right.', 'Yes, file it')) return renderSlip();
  withWho(async () => {
    U.busy = true; busyBtn(t, true, 'Filing…');
    try { const msg = await slipApply(U); S.ui.slip = null; closeModal(true); toast(msg, { action: 'Show', onAction: () => go('orders') }); }
    catch (e) { console.error(e); U.busy = false; toast(errText(e), { bad: true }); if (S.ui.slip === U) renderSlip(); }
  }, 'Who’s filing this slip?');
};
async function slipApply(U) {
  const s = stamp(), rows = U.rows.filter(slipApplied);
  let o = U.match.orderId ? orderById(U.match.orderId) : null; const rcv = !o && U.match.recvId ? orderById(U.match.recvId) : null;
  const supplier = (U.vendor || (o && o.vendor) || (rows.find(r => r.vendor) || {}).vendor || '').trim();
  const sub = round2(rows.reduce((a, r) => a + slipLineTotal(r), 0)), tax = slipTax(U, sub), ship = round2(num(U.ship) || 0), day = todayISO();
  /* 1. the slip's first page is kept with the order (in cloud storage) */
  let slipUrl = null;
  if (U.pages.length) { try { const ph = await downscaleDataUrl(U.pages[0].url, 1600, 0.8); slipUrl = (await B.uploadPhoto('slip-' + (o || rcv ? (o || rcv).id : 'new'), dataUrlToBlob(ph), 'full')).url; } catch (e) { console.warn('slip photo', e); } }
  /* 2. new supplies (their stock comes in with the order like any line) */
  const newIds = [];
  for (const r of rows.filter(r => r.isNew)) {
    const id = 'custom-' + uid(), tp = slipTrackedPrice(r), unit = String(r.unit || 'each').trim().toLowerCase();
    await saveItem({ id, name: r.newName.trim(), sku: r.sku || '', cat: 'misc', group: null, unit, orderUnitName: cap1(unit), qty: 0, min: 0, chk: null, exp: '', tag: null,
      sources: supplier ? [{ vendor: supplier, sku: r.sku || '', price: tp && tp > 0 ? tp : null, src: '', lastDate: day }] : [], note: r.aiName && r.aiName !== r.newName.trim() ? 'From a packing slip: ' + r.aiName : null }, true);
    r.itemId = id; r.isNew = false; r.unit = unit; r.madeNew = true; newIds.push(id);
  }
  const lineFor = r => { const it = itemById(r.itemId); const l = { itemId: r.itemId, name: (it && it.name) || r.newName || r.aiName || '', sku: r.sku || '', unit: (it && countUnit(it)) || r.unit || 'each', qty: slipFinal(r) || num(r.qty) || 0, price: slipTrackedPrice(r) || 0, fromSlip: true }; l.lineTotal = slipLineTotal(r); return l; };
  const patch = { invoiceNumber: (U.doc.invoiceNumber || '').trim() || null, invoiceDate: (U.doc.invoiceDate || '').trim() || null, orderNumber: (U.doc.orderNumber || '').trim() || null, slipPhoto: slipUrl, scannedBy: s.by };
  let msg;
  if (rcv) {
    /* 3c. paperwork for an order already received: prices and the invoice's numbers, never stock */
    const items = rcv.items.map(oi => { const r = rows.find(x => x.itemId && x.itemId === oi.itemId); const tp = r ? slipTrackedPrice(r) : null; return r && tp && tp > 0 ? Object.assign({}, oi, { price: round2(tp * linePer(oi)), lineTotal: round2(tp * linePer(oi) * (Number(oi.qty) || 0)) }) : oi; });
    const p = { items, invoiceNumber: patch.invoiceNumber || rcv.invoiceNumber || null, invoiceDate: patch.invoiceDate || rcv.invoiceDate || null, invoiceSubtotal: sub || rcv.invoiceSubtotal || null, invoiceTaxes: tax || rcv.invoiceTaxes || null, invoiceShipping: ship || rcv.invoiceShipping || null, trail: trailAdd(rcv.trail, 'invoice', s) };
    if (slipUrl) p.slipPhoto = slipUrl;
    await B.patchOrder(rcv.id, p);
    await addCostEntries(rcv.id, rcv.vendor || supplier, ship, tax);
    await Promise.all(rows.map(r => { const it = itemById(r.itemId), tp = slipTrackedPrice(r); return it && tp > 0 && slipPriceOk(it, rcv.vendor || supplier, tp) ? B.patchItem(it.id, { sources: rememberPrice(it, rcv.vendor || supplier, tp, r.sku, day) }) : null; }));
    msg = 'Updated the ' + (rcv.vendor || '') + ' order from the invoice. Stock didn’t change.';
  } else {
    let receivedCount = 0, lines = null, extra = [];
    if (o) {
      /* 3a. line the slip up with the order: same supply, else a similar SKU, else similar words */
      const claimed = new Set();
      /* a line for a supply takes the slip's rows for that same supply only (never another supply's, or its stock would land on the wrong one);
         a line with no supply (typed in by hand) takes a row with a similar SKU or name, and is linked to that row's supply */
      lines = o.items.map(oi => {
        let mine = oi.itemId ? rows.filter(r => !claimed.has(r.key) && r.itemId === oi.itemId) : [], link = null;
        if (!oi.itemId) { const r = rows.find(r => !claimed.has(r.key) && !r.madeNew && ((oi.sku && r.sku && skusAlike(normSku(oi.sku), normSku(r.sku))) || tokenListsOverlap(matchTokens(oi.name || ''), matchTokens(r.aiName || r.newName || '')))); if (r) { mine = [r]; const it = itemById(r.itemId); link = { itemId: r.itemId, unit: (it && countUnit(it)) || r.unit || oi.unit || 'each' }; } }
        mine.forEach(r => claimed.add(r.key));
        if (!mine.length) return { qty: 0, price: Number(oi.price) || 0, discount: 0 };
        const per = link ? 1 : linePer(oi), tracked = mine.reduce((a, r) => a + (slipFinal(r) || num(r.qty) || 0), 0), total = mine.reduce((a, r) => a + slipLineTotal(r) + (num(r.discount) || 0), 0), disc = mine.reduce((a, r) => a + (num(r.discount) || 0), 0);
        receivedCount++;
        const q = round2(tracked / per);
        return { qty: q, price: q > 0 ? Math.round(total / q * 10000) / 10000 : Number(oi.price) || 0, discount: disc, link };
      });
      extra = rows.filter(r => !claimed.has(r.key)).map(r => { const l = lineFor(r); return { line: l, qty: l.qty, price: l.price, discount: num(r.discount) || 0 }; });
      if (!receivedCount && U.match.choice !== 'picked') { o = null; lines = null; extra = []; toast('None of the slip’s lines matched that order, so it was filed on its own and the order stays open.', { bad: true }); }
    }
    if (o) {
      await receiveOrder(o.id, { lines, extraLines: extra, discount: 0, tax, shipping: ship, reason: 'paid', makeBackorder: receivedCount > 0, invoiceNumber: patch.invoiceNumber, method: 'scan', patch, newIds });
      msg = 'Received the ' + (o.vendor || '') + ' order from the slip.';
    } else {
      /* 3b. no order: it becomes a received order of its own */
      const id = 'order-' + uid(), items = rows.map(lineFor);
      const order = { id, vendor: supplier || 'Unknown', items, status: 'open', dateOrdered: day, orderedAt: null, orderedBy: null, orderedById: null, method: 'scan', expectedDelivery: '', note: 'From a packing slip — no open order', trail: [Object.assign({ t: 'scanned' }, s)] };
      await B.putOrder(order);
      await receiveOrder(id, { order, lines: items.map((l, k) => ({ qty: l.qty, price: l.price, discount: num(rows[k].discount) || 0 })), discount: 0, tax, shipping: ship, reason: 'paid', makeBackorder: false, invoiceNumber: patch.invoiceNumber, method: 'scan', patch, newIds });
      msg = 'Filed the ' + (supplier || '') + ' slip as a received order.';
    }
  }
  /* 4. remembered prices for quick-order codes (guarded: $0 and big drops are AO points, not prices) */
  rows.forEach(r => { const tp = slipTrackedPrice(r); if (!r.sku || !(tp > 0)) return; const was = getElastoPrice(S.D.elastoPrices, r.sku); if (was != null && tp < 0.5 * was) return; if (/^(854|000)-/.test(r.sku)) B.setElastoPrice(r.sku, tp).catch(() => { }); });
  /* 5. the vendor's account # and address, only where it has none */
  const v = S.D.vendors.find(x => String(x.name || '').toLowerCase() === supplier.toLowerCase()) || vendorByName(supplier);
  if (v && v.id) { const up = {}; if (!v.acct && String(U.doc.accountId || '').trim()) up.acct = String(U.doc.accountId).trim(); if (!v.address && String(U.doc.vendorAddress || '').trim()) up.address = String(U.doc.vendorAddress).trim(); if (Object.keys(up).length) await B.patchVendor(v.id, up).catch(() => { }); }
  return msg;
}
/* a price from a slip isn't remembered if it's $0 or less than half the last one (paid with AO points) */
function slipPriceOk(it, vendor, tp) { const s = sourceFor(it, vendor), was = countPrice(s); return !(was && tp < 0.5 * was); }
