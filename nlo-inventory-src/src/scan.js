/* =====================================================================
   Scan — point the camera at a supply's barcode or its QR label (or type
   the code) to find it, then: used one, count it, or add it to the cart.
   A code matches a supply's id, its SKU, any vendor SKU, or its exact
   name. QR labels carry the supply's SKU, as before.
   Libraries load only when they're needed, pinned to exact files.
   ===================================================================== */
const LIBS = {
  qr: { src: 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js', sri: 'sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+', ok: () => typeof Html5Qrcode !== 'undefined' },
  qrcode: { src: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', sri: 'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU', ok: () => typeof QRCode !== 'undefined' },
  pdf: { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', sri: 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e', ok: () => typeof pdfjsLib !== 'undefined' }
};
function loadLib(k) {
  const L = LIBS[k]; if (L.ok()) return Promise.resolve();
  if (L.p) return L.p;
  L.p = new Promise((res, rej) => { const s = document.createElement('script'); s.src = L.src; s.integrity = L.sri; s.crossOrigin = 'anonymous'; s.onload = () => res(); s.onerror = () => { L.p = null; rej(new Error('Couldn’t load what this step needs. Check the internet connection.')); }; document.head.appendChild(s); });
  return L.p;
}
function findByCode(code) {
  const v = String(code || '').trim(), lc = v.toLowerCase(); if (!v) return null;
  return activeItems().find(i => i.id === v || (i.sku && String(i.sku).toLowerCase() === lc) || allSources(i).some(s => s && s.sku && String(s.sku).toLowerCase() === lc) || (i.name && i.name.toLowerCase() === lc)) || null;
}
const SCAN = { stream: null, on: false, det: null, h5: null, timer: null };
ACT.scan = () => {
  openModal('<h3>Scan</h3><div class="lsub">Point the camera at the barcode or QR label — or type the code or a name.</div>' +
    '<div id="scanBox"><video id="scanVid" playsinline muted></video></div><canvas id="scanCv" style="display:none"></canvas>' +
    '<div class="hint" id="scanMsg" style="text-align:center">Starting the camera…</div>' +
    '<div class="inRow" style="margin-top:12px"><input class="inp" id="scanQ" placeholder="Code, SKU or name" data-inp="scanFind" autocomplete="off"></div><div id="scanHits"></div><div id="scanRes"></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Done</button></div>', { cls: 'mid', noFocus: true, cleanup: stopScan });
  startScan();
};
async function startScan() {
  const msg = t => { const m = $('#scanMsg'); if (m) m.textContent = t; };
  try { SCAN.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } }); }
  catch (e) { msg('No camera here (or it isn’t allowed). Type the code below instead.'); const b = $('#scanBox'); if (b) b.style.display = 'none'; return; }
  const v = $('#scanVid'); if (!v) return stopScan();
  v.srcObject = SCAN.stream; try { await v.play(); } catch (e) { }
  SCAN.on = true; msg('Looking for a barcode…');
  if ('BarcodeDetector' in window) {
    try { SCAN.det = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix'] }); return scanLoop(); } catch (e) { SCAN.det = null; }
  }
  try { await loadLib('qr'); const host = document.createElement('div'); host.id = 'h5qr' + Date.now(); host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; document.body.appendChild(host); SCAN.host = host; SCAN.h5 = new Html5Qrcode(host.id, false); scanLoop(); }
  catch (e) { msg('The camera is on, but this browser can’t read barcodes. Type the code below.'); }
}
async function scanLoop() {
  if (!SCAN.on) return;
  const v = $('#scanVid'), c = $('#scanCv');
  if (v && c && v.readyState >= 2) {
    c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    try {
      if (SCAN.det) { const r = await SCAN.det.detect(c); if (r.length) return gotCode(r[0].rawValue); }
      else if (SCAN.h5) { const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8)); const r = blob && await SCAN.h5.scanFileV2(new File([blob], 'f.jpg', { type: 'image/jpeg' }), false); if (r && r.decodedText) return gotCode(r.decodedText); }
    } catch (e) { }
  }
  SCAN.timer = setTimeout(scanLoop, SCAN.det ? 120 : 220);
}
function stopScan() {
  SCAN.on = false; clearTimeout(SCAN.timer);
  if (SCAN.h5) { try { SCAN.h5.clear(); } catch (e) { } SCAN.h5 = null; }
  if (SCAN.host) { SCAN.host.remove(); SCAN.host = null; }
  if (SCAN.stream) { SCAN.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); SCAN.stream = null; }
  SCAN.det = null;
}
function beep(ok) {
  try { if (navigator.vibrate) navigator.vibrate(ok ? [50, 30, 50] : [200]); } catch (e) { }
  try { const ctx = SCAN.ctx || (SCAN.ctx = new (window.AudioContext || window.webkitAudioContext)()); const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); g.gain.value = 0.25; o.frequency.value = ok ? 880 : 300; o.type = ok ? 'sine' : 'square'; o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.25)); } catch (e) { }
}
function gotCode(code) {
  SCAN.on = false; const it = findByCode(code); beep(!!it);
  const m = $('#scanMsg'); if (m) m.textContent = it ? 'Found it.' : 'No supply has the code “' + code + '”. Search by name below.';
  if (it) showScanResult(it); else { const q = $('#scanQ'); if (q) { q.value = code; INP.scanFind(q); } setTimeout(() => { if ($('#scanVid')) { SCAN.on = true; scanLoop(); } }, 2000); }
}
INP.scanFind = t => {
  const q = t.value.trim(), box = $('#scanHits'); if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  const exact = findByCode(q); if (exact) { box.innerHTML = ''; return showScanResult(exact); }
  const hits = activeItems().filter(i => matchesAll(itemSearchText(i), q)).slice(0, 8);
  box.innerHTML = hits.length ? '<div class="card" style="margin-top:8px">' + hits.map(i => '<button class="row" data-act="scanPick" data-id="' + esc(i.id) + '"><span class="grow"><span class="pt">' + esc(i.name) + '</span><span class="meta">' + esc(qtyUnit(i.qty || 0, countUnit(i))) + ' on hand</span></span>' + ic('next', 16) + '</button>').join('') + '</div>' : '<div class="hint">Nothing matches.</div>';
};
ACT.scanPick = t => { const it = itemById(t.dataset.id); if (it) { $('#scanHits').innerHTML = ''; showScanResult(it); } };
function showScanResult(it) {
  const c = inCartLine(it.id), box = $('#scanRes'); if (!box) return;
  box.innerHTML = '<div class="card" style="margin-top:12px;padding:14px 16px"><div class="gap8">' + thumbHTML(it) + '<div style="flex:1;min-width:0"><b style="color:var(--navy)">' + esc(it.name) + '</b><div class="muted small">' + esc(qtyUnit(it.qty || 0, countUnit(it))) + ' on hand' + (it.location ? ' · ' + esc(it.location) : '') + (c ? ' · in the cart (' + esc(lineQtyLabel(c)) + ')' : '') + '</div></div></div>' +
    '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="useOne" data-id="' + esc(it.id) + '">' + ic('minus', 15) + 'Used 1 ' + esc(countUnit(it)) + '</button><button class="btn btn-sec btn-sm" data-act="countIt" data-id="' + esc(it.id) + '">' + ic('count', 15) + 'Count</button><button class="btn btn-teal btn-sm" data-act="drawerAdd" data-id="' + esc(it.id) + '">' + ic('cart', 15) + 'Add to cart</button><button class="btn btn-ghost btn-sm" data-act="scanOpen" data-id="' + esc(it.id) + '">Open</button><button class="btn btn-ghost btn-sm" data-act="scanAgain">Scan another</button></div></div>';
  hydrateImages(box);
}
ACT.scanOpen = t => { closeModal(true); openDrawer('item', t.dataset.id); };
ACT.scanAgain = () => { $('#scanRes').innerHTML = ''; const q = $('#scanQ'); if (q) q.value = ''; const m = $('#scanMsg'); if (m) m.textContent = 'Looking for a barcode…'; if (SCAN.stream) { SCAN.on = true; scanLoop(); } };

/* ---------- QR labels ---------- */
ACT.qrIt = async t => {
  const it = itemById(t.dataset.id); if (!it) return;
  const code = labelCode(it);
  openModal('<h3>QR label</h3><div class="lsub">' + esc(it.name) + ' · scans as <b>' + esc(code) + '</b></div><div id="qrBox" style="display:flex;justify-content:center;padding:16px;background:#fff"></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Close</button><button class="btn btn-pri" data-act="qrPrint">' + ic('print', 16) + 'Print</button></div>', { cls: 'mid', noFocus: true });
  try { await loadLib('qrcode'); new QRCode($('#qrBox'), { text: String(code), width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M }); S.ui.qrName = it.name; S.ui.qrCode = code; }
  catch (e) { $('#qrBox').textContent = errText(e); }
};
ACT.qrPrint = () => {
  const img = $('#qrBox img') || $('#qrBox canvas'); if (!img) return; if (demoBlocked('print')) return;
  const src = img.tagName === 'CANVAS' ? img.toDataURL() : img.src, w = window.open('', '_blank', 'width=420,height=520'); if (!w) return toast('Allow pop-ups to print the label.', { bad: true });
  /* built with the DOM (an <img src> written inside this script would be picked up by the browser's look-ahead) */
  w.document.write('<!doctype html><title>QR label</title><style>body{font-family:Arial,sans-serif;text-align:center;margin:12px}img{width:180px;height:180px}p{margin:6px 0;font-size:13px}</style><body></body>');
  const d = w.document, im = d.createElement('img'); im.src = src; d.body.appendChild(im);
  const p1 = d.createElement('p'), b = d.createElement('b'); b.textContent = S.ui.qrName; p1.appendChild(b); d.body.appendChild(p1);
  const p2 = d.createElement('p'); p2.textContent = S.ui.qrCode; d.body.appendChild(p2);
  w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) { } }, 400);
};
/* labels for every supply on the screen: QR (the SKU it scans as), name, SKU, where it's kept */
function labelCode(it) { return String((primarySource(it) || {}).sku || it.sku || it.id); }
ACT.printLabels = async t => {
  const list = supVisible().slice(0, 240); if (!list.length) return toast('No supplies on the screen to print.'); if (demoBlocked('print')) return;
  const w = window.open('', '_blank', 'width=900,height=700'); if (!w) return toast('Allow pop-ups to print labels.', { bad: true });
  busyBtn(t, true, 'Making labels…');
  try {
    await loadLib('qrcode');
    const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-9999px;top:0'; document.body.appendChild(host);
    const codes = list.map(it => { const box = document.createElement('div'); host.appendChild(box); new QRCode(box, { text: labelCode(it), width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M }); const cv = box.querySelector('canvas'); return cv ? cv.toDataURL('image/png') : ''; });
    host.remove();
    const d = w.document;
    d.write('<!doctype html><title>Labels</title><style>body{font-family:Arial,sans-serif;margin:12px}.l{display:inline-flex;flex-direction:column;align-items:center;width:180px;border:2px solid #1B2F4C;border-radius:10px;padding:8px;margin:5px;page-break-inside:avoid;vertical-align:top}.l img{width:100px;height:100px}.n{font-size:11px;font-weight:700;text-align:center;margin-top:4px;color:#1B2F4C}.s{font-size:10px;color:#444}.bar{margin:0 0 12px}@media print{.bar{display:none}}</style><body></body>');
    const bar = d.createElement('div'); bar.className = 'bar'; const pb = d.createElement('button'); pb.textContent = 'Print ' + list.length + ' label' + (list.length === 1 ? '' : 's'); pb.onclick = () => w.print(); bar.appendChild(pb); d.body.appendChild(bar);
    list.forEach((it, k) => {
      const l = d.createElement('div'); l.className = 'l';
      if (codes[k]) { const im = d.createElement('img'); im.src = codes[k]; l.appendChild(im); }
      const n = d.createElement('div'); n.className = 'n'; n.textContent = it.name; l.appendChild(n);
      const s = d.createElement('div'); s.className = 's'; s.textContent = labelCode(it) + (it.location ? ' · ' + it.location : '') + (Number(it.min) ? ' · reorder below ' + qtyUnit(it.min, countUnit(it)) : ''); l.appendChild(s);
      d.body.appendChild(l);
    });
    d.close(); w.focus();
  } catch (e) { try { w.close(); } catch (x) { } toast(errText(e), { bad: true }); }
  busyBtn(t, false);
};
