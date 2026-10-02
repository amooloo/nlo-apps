/* =====================================================================
   Patient photos (Amir, 2 Oct 2026: "much easier to recall cases").
   One small square picture per case, shown next to the patient's name.
   - Cropped and shrunk here to a 160 px JPEG (a few KB), which also drops
     the camera's EXIF data (location etc.); the full-size picture never
     leaves the device.
   - Sealed with the office key like the case itself (backend photos/{id});
     the case's own `photo` field holds the picture's version id, so a new
     or changed photo is a normal case save and shows in its history.
   - Loaded only for names on screen, kept in memory until the app locks.
   - "Hide photos" blurs them on this device (screens patients can see).
   ===================================================================== */
const PHOTO_PX = 160;
const PH = { cache: new Map(), loading: new Map(), active: 0, waiters: [], io: null, hide: false, gen: 0, onFile: null };
Object.assign(IC, {
  minus: '<path d="M5 12h14"/>',
  camera: '<path d="M4 8h3.2l1.6-2.5h6.4L16.8 8H20a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.2" r="3.7"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="M4 17.5l5-4.5 4 3.5 2.6-2.2L20 18"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.6A10 10 0 0112 5.5C18 5.5 21.5 12 21.5 12a17 17 0 01-3.2 4M6.6 6.7C3.9 8.5 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>'
});
const PH_SIL = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="9.2" r="4.3"/><path d="M3.6 22c.8-4.6 4.3-7.4 8.4-7.4s7.6 2.8 8.4 7.4z"/></svg>';

/* the round picture next to a patient's name (a plain placeholder until, and unless, the case has a photo) */
function ptAv(c, size) {
  const has = !!(c && c.id && c.photo && !c.locked);
  return '<span class="pav s' + (size || 32) + (has ? ' has' : '') + '"' + (c && c.id ? ' data-pav="' + esc(c.id) + '"' : '') + (has ? ' data-pv="' + esc(c.photo) + '"' : '') + ' aria-hidden="true">' + PH_SIL + '</span>';
}
function phUrl(bytes) { return 'data:image/jpeg;base64,' + b64(bytes); }
function phPut(id, pv, bytes) { const e = { pv, seen: pv, bytes, url: phUrl(bytes) }; PH.cache.set(id, e); return e; }
function phCached(id, pv) { const x = PH.cache.get(id); return x && x.url && (x.pv === pv || x.seen === pv) ? x : null; }
function phShow(el, url) {
  el.innerHTML = ''; const im = document.createElement('img'); im.alt = ''; im.decoding = 'async'; im.src = url;
  el.appendChild(im); el.classList.add('on');
}
function phBlank(el) { el.classList.remove('on'); el.innerHTML = PH_SIL; }
/* after anything is drawn: fill in photos already in memory, fetch the rest once they're on screen */
function phPaint() {
  if (!S.inApp) return;
  if (PH.io) PH.io.disconnect();
  $$('.pav.has:not(.on)').forEach(el => {
    const x = phCached(el.dataset.pav, el.dataset.pv);
    if (x) { phShow(el, x.url); return; }
    if (!window.IntersectionObserver) { phLoad(el.dataset.pav, el.dataset.pv); return; }
    if (!PH.io) PH.io = new IntersectionObserver(list => list.forEach(e => {
      if (e.isIntersecting) { PH.io.unobserve(e.target); phLoad(e.target.dataset.pav, e.target.dataset.pv); }
    }), { rootMargin: '300px 0px' });
    PH.io.observe(el);
  });
}
function phFill(id) {
  const x = PH.cache.get(id); if (!x || !x.url) return;
  $$('.pav.has[data-pav="' + CSS.escape(id) + '"]').forEach(el => { if (x.pv === el.dataset.pv || x.seen === el.dataset.pv) phShow(el, x.url); });
}
/* a few at a time, so a long list doesn't fire dozens of reads at once */
async function phSlot() { while (PH.active >= 4) await new Promise(r => PH.waiters.push(r)); PH.active++; }
function phFree() { PH.active--; const w = PH.waiters.shift(); if (w) w(); }
/* the case's current photo ({ pv, bytes, url }) or null; `pv` is the version the case names */
function phLoad(id, pv) {
  const x = PH.cache.get(id);
  if (x && (x.pv === pv || x.seen === pv)) { phFill(id); return Promise.resolve(x.url ? x : null); }
  const lk = id + '|' + pv; if (PH.loading.has(lk)) return PH.loading.get(lk);
  const gen = PH.gen;
  const p = (async () => {
    await phSlot();
    try {
      if (gen !== PH.gen) return null;
      const r = await B.getPhoto(id);
      if (gen !== PH.gen) return null; // locked meanwhile
      // (a case restored to an older version can name an older version id than the picture it has: keep showing that picture)
      const e = r ? Object.assign(phPut(id, r.pv, r.bytes), { seen: pv }) : { pv: '', seen: pv, url: '' };
      PH.cache.set(id, e); phFill(id); return e.url ? e : null;
    } catch (err) { return null; }
    finally { phFree(); PH.loading.delete(lk); }
  })();
  PH.loading.set(lk, p); return p;
}
function phReset() { PH.gen++; PH.cache.clear(); PH.loading.clear(); if (PH.io) PH.io.disconnect(); PH.io = null; phClose(); }

/* ---------- "Hide photos" on this device ---------- */
function phInit() {
  try { PH.hide = localStorage.getItem('nloCases.hidePhotos') === '1'; } catch (e) { }
  document.body.classList.toggle('phHide', PH.hide);
  phBindPaste();
}
function phAny() { return PH.hide || openCases().some(c => c.photo); }
function phHideBtn() {
  return '<button class="iconBtn phTgl" data-act="phHide" aria-pressed="' + PH.hide + '" title="' + (PH.hide ? 'Patient photos are blurred on this computer — click to show them' : 'Blur patient photos on this computer (for screens patients can see)') + '" aria-label="' + (PH.hide ? 'Show patient photos' : 'Hide patient photos') + '">' + ic(PH.hide ? 'eyeOff' : 'eye', 19) + '</button>';
}
function phToggleHide() {
  PH.hide = !PH.hide;
  try { localStorage.setItem('nloCases.hidePhotos', PH.hide ? '1' : '0'); } catch (e) { }
  document.body.classList.toggle('phHide', PH.hide);
  $$('[data-act=phHide]').forEach(b => { b.outerHTML = phHideBtn(); });
  toast(PH.hide ? 'Patient photos are blurred on this computer. Hover over one to see it.' : 'Patient photos are shown again.');
}

/* ---------- the photo editor: take / choose / paste / drop a picture, then fit the face in the circle ---------- */
function phClose() { const w = $('#phWrap'); if (w) w.remove(); PH.onFile = null; }
function phIsPic(f) { return !!f && (/^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(f.name || '')); }
/* o: { name, current (data: URL or ''), file, onSave(bytes) → Promise, onRemove() → Promise (optional) } */
function phEditor(o) {
  phClose();
  const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const back = document.activeElement;
  const w = document.createElement('div'); w.id = 'phWrap';
  w.innerHTML = '<div class="phBox" role="dialog" aria-modal="true" aria-labelledby="phTitle">' +
    '<div class="phHd"><div style="flex:1;min-width:0"><h3 id="phTitle">Patient photo</h3>' + (o.name ? '<div class="small muted phName">' + esc(o.name) + '</div>' : '') + '</div>' +
      '<button type="button" class="iconBtn" data-ph="close" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="phPick" id="phPick"><div class="phDrop" id="phDrop" tabindex="0" role="button" aria-label="Choose a photo">' +
      '<span class="pav s96' + (o.current ? '' : ' none') + '" id="phNow">' + PH_SIL + '</span>' +
      '<b>' + (touch ? 'Take a photo or choose one' : 'Drop a photo here, or paste one (Ctrl+V)') + '</b>' +
      '<span class="small muted">' + (touch ? '' : 'A screenshot from the imaging software works too. ') + 'It’s cut to a small square and encrypted on this device; the full-size picture isn’t kept.</span></div>' +
      '<div class="phBtns">' + (touch ? '<button type="button" class="btn btn-pri" data-ph="camera">' + ic('camera', 16) + 'Take photo</button>' : '') +
        '<button type="button" class="btn ' + (touch ? 'btn-sec' : 'btn-pri') + '" data-ph="file">' + ic('image', 16) + 'Choose a file</button>' +
        (o.onRemove ? '<button type="button" class="btn btn-ghost" data-ph="remove" style="color:var(--coral-700)">' + ic('trash', 16) + 'Remove photo</button>' : '') + '</div></div>' +
    '<div class="phCrop" id="phCrop" hidden><div class="phStage" id="phStage" tabindex="0" aria-label="Photo: drag or use the arrow keys to move it, + and − to zoom"><canvas id="phCv"></canvas><div class="phRing"></div></div>' +
      '<div class="phZoom"><button type="button" class="iconBtn" data-ph="out" aria-label="Zoom out">' + ic('minus', 18) + '</button>' +
        '<input type="range" id="phZ" min="1" max="4" step="0.01" value="1" aria-label="Zoom">' +
        '<button type="button" class="iconBtn" data-ph="in" aria-label="Zoom in">' + ic('plus', 18) + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-ph="rotate">' + ic('refresh', 15) + 'Rotate</button></div>' +
      '<div class="small muted phTip">Drag to center the face' + (touch ? ', pinch to zoom.' : '. Zoom with the slider or the mouse wheel.') + '</div></div>' +
    '<div class="phErr" id="phErr" role="alert"></div>' +
    '<div class="phFt"><button type="button" class="btn btn-ghost" data-ph="back" hidden>Choose another</button><span style="flex:1"></span>' +
      '<button type="button" class="btn btn-sec" data-ph="close">Cancel</button><button type="button" class="btn btn-teal" data-ph="save" disabled>Use photo</button></div>' +
    '<input type="file" accept="image/*" capture="environment" id="phCam" hidden><input type="file" accept="image/*" id="phFile" hidden></div>';
  document.body.appendChild(w);
  const q = s => $(s, w), stage = q('#phStage'), cv = q('#phCv'), zr = q('#phZ'), save = q('[data-ph=save]'), errEl = q('#phErr');
  if (o.current) phShow(q('#phNow'), o.current);
  const st = { src: null, S: 260, s0: 1, z: 1, x: 0, y: 0 };
  const err = m => { errEl.textContent = m || ''; };
  const draw = () => {
    if (!st.src) return; const S = st.S, dpr = window.devicePixelRatio || 1, px = Math.round(S * dpr);
    if (cv.width !== px) { cv.width = cv.height = px; cv.style.width = cv.style.height = S + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    const sc = st.s0 * st.z; g.imageSmoothingQuality = 'high'; g.drawImage(st.src, st.x, st.y, st.src.width * sc, st.src.height * sc);
  };
  const clamp = () => { const sc = st.s0 * st.z; st.x = Math.min(0, Math.max(st.S - st.src.width * sc, st.x)); st.y = Math.min(0, Math.max(st.S - st.src.height * sc, st.y)); };
  const zoomTo = (z, px, py) => {
    if (!st.src) return; z = Math.max(1, Math.min(4, z)); const s1 = st.s0 * st.z, s2 = st.s0 * z;
    px = px == null ? st.S / 2 : px; py = py == null ? st.S / 2 : py;
    st.x = px - (px - st.x) * s2 / s1; st.y = py - (py - st.y) * s2 / s1; st.z = z; clamp(); draw(); zr.value = String(z);
  };
  const crop = () => {
    q('#phPick').hidden = true; q('#phCrop').hidden = false; q('[data-ph=back]').hidden = false;
    st.S = stage.clientWidth || 260; st.s0 = Math.max(st.S / st.src.width, st.S / st.src.height); st.z = 1; zr.value = '1';
    // centered across; a bit above the middle down (faces sit in the upper part of most portraits)
    st.x = (st.S - st.src.width * st.s0) / 2; st.y = (st.S - st.src.height * st.s0) * 0.35; clamp(); draw();
    save.disabled = false; err(''); stage.focus();
  };
  const load = f => {
    err('');
    if (!phIsPic(f)) { err('That isn’t a picture. Use a photo (JPEG or PNG) or a screenshot.'); return; }
    if (f.size > 40e6) { err('That picture is too large (over 40 MB).'); return; }
    const rd = new FileReader();
    rd.onerror = () => err('Couldn’t read that picture.');
    rd.onload = () => {
      const im = new Image();
      im.onerror = () => err('This picture can’t be opened in the browser. Use a JPEG or PNG, or take a screenshot of it.');
      im.onload = () => {
        // very large pictures are scaled down first so dragging stays smooth (the browser has already turned it upright)
        const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); st.src = c; crop();
      };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
  PH.onFile = load;
  const rotate = () => { const s = st.src, c = document.createElement('canvas'); c.width = s.height; c.height = s.width; const g = c.getContext('2d'); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(s, 0, 0); st.src = c; crop(); };
  const output = async () => {
    const c = document.createElement('canvas'); c.width = c.height = PHOTO_PX; const g = c.getContext('2d');
    const k = PHOTO_PX / st.S, sc = st.s0 * st.z * k;
    g.fillStyle = '#fff'; g.fillRect(0, 0, PHOTO_PX, PHOTO_PX); g.imageSmoothingQuality = 'high';
    g.drawImage(st.src, st.x * k, st.y * k, st.src.width * sc, st.src.height * sc);
    for (const qty of [0.86, 0.72, 0.55]) {
      const b = await new Promise(r => c.toBlob(r, 'image/jpeg', qty)); if (!b) throw new Error('Couldn’t make the picture.');
      const bytes = new Uint8Array(await b.arrayBuffer()); if (bytes.length <= 40000 || qty === 0.55) return bytes;
    }
  };
  const done = () => { phClose(); if (back && back.isConnected && back.focus) back.focus(); };
  w.addEventListener('click', async e => {
    const b = e.target.closest('[data-ph]'); if (!b) { if (e.target.closest('#phDrop')) q('#phFile').click(); return; }
    const k = b.dataset.ph;
    if (k === 'close') done();
    else if (k === 'camera') q('#phCam').click();
    else if (k === 'file') q('#phFile').click();
    else if (k === 'back') { q('#phPick').hidden = false; q('#phCrop').hidden = true; b.hidden = true; save.disabled = true; st.src = null; err(''); }
    else if (k === 'in') zoomTo(st.z * 1.15); else if (k === 'out') zoomTo(st.z / 1.15);
    else if (k === 'rotate') { if (st.src) rotate(); }
    else if (k === 'remove') { busyBtn(b, true, 'Removing…'); try { await o.onRemove(); done(); } catch (x) { busyBtn(b, false); err(errText(x)); } }
    else if (k === 'save') {
      if (!st.src) return; busyBtn(save, true, 'Saving…');
      try { await o.onSave(await output()); done(); } catch (x) { busyBtn(save, false); err(errText(x)); }
    }
  });
  ['#phCam', '#phFile'].forEach(s => q(s).addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) load(f); }));
  q('#phDrop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); q('#phFile').click(); } });
  w.addEventListener('dragover', e => { e.preventDefault(); w.classList.add('over'); });
  w.addEventListener('dragleave', e => { if (e.target === w) w.classList.remove('over'); });
  w.addEventListener('drop', e => { e.preventDefault(); w.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) load(f); });
  zr.addEventListener('input', () => zoomTo(Number(zr.value)));
  // drag to move; two fingers to zoom
  const pts = new Map();
  stage.addEventListener('pointerdown', e => { if (!st.src) return; stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  stage.addEventListener('pointermove', e => {
    const prev = pts.get(e.pointerId); if (!prev || !st.src) return; const cur = { x: e.clientX, y: e.clientY };
    if (pts.size === 1) { st.x += cur.x - prev.x; st.y += cur.y - prev.y; clamp(); draw(); }
    else { const other = Array.from(pts.entries()).find(([k]) => k !== e.pointerId)[1], d1 = Math.hypot(prev.x - other.x, prev.y - other.y), d2 = Math.hypot(cur.x - other.x, cur.y - other.y), r = stage.getBoundingClientRect();
      if (d1 > 0) zoomTo(st.z * d2 / d1, (cur.x + other.x) / 2 - r.left, (cur.y + other.y) / 2 - r.top); }
    pts.set(e.pointerId, cur);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => stage.addEventListener(t, e => pts.delete(e.pointerId)));
  stage.addEventListener('wheel', e => { if (!st.src) return; e.preventDefault(); const r = stage.getBoundingClientRect(); zoomTo(st.z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  stage.addEventListener('keydown', e => {
    if (!st.src) return; const m = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
    if (m) { e.preventDefault(); st.x += m[0]; st.y += m[1]; clamp(); draw(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(st.z * 1.1); } else if (e.key === '-') { e.preventDefault(); zoomTo(st.z / 1.1); }
    else if (e.key === 'Enter') { e.preventDefault(); save.click(); }
  });
  if (o.file) load(o.file); else (q('[data-ph=camera]') || q('#phDrop')).focus();
  return w;
}

/* ---------- a case's photo (from the case, or by pasting a picture while it's open) ---------- */
function phCaseEdit(c, file) {
  if (!c || c.locked) return;
  const x = c.photo ? phCached(c.id, c.photo) : null;
  phEditor({ name: c.patient, current: x ? x.url : '', file, onSave: bytes => phSaveCase(c.id, bytes), onRemove: c.photo ? () => phRemoveCase(c.id) : null });
  if (c.photo && !x) phLoad(c.id, c.photo).then(r => { const el = $('#phNow'); if (r && el) { el.classList.remove('none'); phShow(el, r.url); } });
}
const skipOk = e => { if (!(e && e.code === 'skip')) throw e; };
async function phSaveCase(id, bytes) {
  const c = findCase(id); if (!c) throw errCode('gone');
  const old = c.photo ? (phCached(id, c.photo) || await phLoad(id, c.photo)) : null, oldBytes = old && old.bytes;
  const pv = await B.setPhoto(id, bytes, { a: 'photo', how: c.photo ? 'change' : 'add' });
  phPut(id, pv, bytes); c.photo = pv;
  // the same patient's other open cases that have no photo yet get it too
  const copied = [];
  for (const o of openCases().filter(o => o.id !== id && !o.photo && !o.locked && samePatient(o, c))) {
    try { const p2 = await B.setPhoto(o.id, bytes, { a: 'photo', how: 'copy' }); phPut(o.id, p2, bytes); o.photo = p2; copied.push(o.id); } catch (e) { }
  }
  queueRender(); if (S.openId === id && !S.editing) renderDrawer();
  toast((old ? 'Photo changed' : 'Photo added') + (copied.length ? ' (also on ' + copied.length + ' other open case' + (copied.length > 1 ? 's' : '') + ' for this patient)' : ''), { action: 'Undo', ms: 9000, onAction: () => act(async () => {
    if (oldBytes) { const p = await B.setPhoto(id, oldBytes, { a: 'photo', how: 'undo' }); phPut(id, p, oldBytes); }
    else await B.setPhoto(id, null, { a: 'photo', how: 'remove' }).catch(skipOk);
    for (const oid of copied) await B.setPhoto(oid, null, { a: 'photo', how: 'remove' }).catch(skipOk);
  }, 'Undone') });
}
async function phRemoveCase(id) {
  const c = findCase(id); const x = c && c.photo ? (phCached(id, c.photo) || await phLoad(id, c.photo)) : null, keep = x && x.bytes;
  await B.setPhoto(id, null, { a: 'photo', how: 'remove' }).catch(skipOk);
  if (c) c.photo = ''; queueRender(); if (S.openId === id && !S.editing) renderDrawer();
  toast('Photo removed', keep ? { action: 'Undo', onAction: () => act(async () => { const p = await B.setPhoto(id, keep, { a: 'photo', how: 'undo' }); phPut(id, p, keep); }, 'Photo put back') } : {});
}
/* the drawer's photo also takes a picture dropped on it */
function phWireDrawer(d) {
  const b = $('.dPh', d); if (!b) return;
  b.addEventListener('dragover', e => { e.preventDefault(); b.classList.add('over'); });
  b.addEventListener('dragleave', () => b.classList.remove('over'));
  b.addEventListener('drop', e => { e.preventDefault(); b.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; const c = findCase(S.openId); if (f && c) phCaseEdit(c, f); });
}

/* ---------- New case form: the photo goes in with the case; a patient who already has one gets it again ---------- */
function phSlotHTML() {
  return '<button type="button" class="phSlot" id="cf-photo" data-act="cfPhoto" aria-label="Patient photo">' + ptAv(null, 64) + '<span class="phSlotL">' + ic('camera', 13) + '<span>Add photo</span></span></button>';
}
function phWireForm(root) {
  const slot = $('#cf-photo', root); if (!slot) return;
  root._ph = null; root._phOff = '';
  ensureHist(); // completed cases too, to find this patient's photo
  slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('over'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('over'));
  slot.addEventListener('drop', e => { e.preventDefault(); slot.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) phFormEdit(root, f); });
  let t = null; const look = () => { clearTimeout(t); t = setTimeout(() => phFormReuse(root), 350); };
  ['#cf-patient', '#cf-chart'].forEach(s => { const el = $(s, root); if (el) el.addEventListener('input', look); });
}
function phFormEdit(root, file) {
  const cur = root._ph;
  phEditor({ name: ($('#cf-patient', root) || {}).value || '', current: cur ? cur.url : '', file,
    onSave: async bytes => { root._ph = { bytes, url: phUrl(bytes), from: 'new' }; phFormShow(root); },
    // (taking a reused photo off sticks for this patient while the form is open)
    onRemove: cur ? async () => { if (cur.from === 'reuse') root._phOff = normName(($('#cf-patient', root) || {}).value); root._ph = null; phFormShow(root); } : null });
}
function phFormShow(root) {
  const slot = $('#cf-photo', root); if (!slot) return; const p = root._ph, av = $('.pav', slot);
  if (p) phShow(av, p.url); else phBlank(av);
  slot.classList.toggle('set', !!p);
  $('.phSlotL span', slot).textContent = p ? (p.from === 'reuse' ? 'From their other case' : 'Change photo') : 'Add photo';
}
function phFormReuse(root) {
  if (!root.isConnected || (root._ph && root._ph.from === 'new')) return; // a photo picked here wins
  const probe = { patient: (($('#cf-patient', root) || {}).value || '').trim(), chart: (($('#cf-chart', root) || {}).value || '').trim() };
  const src = probe.patient ? casePool().filter(x => x && x.id && x.photo && !x.locked && samePatient(x, probe)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] : null;
  if (!src) { if (root._ph) { root._ph = null; phFormShow(root); } return; }
  if ((root._phOff && root._phOff === normName(probe.patient)) || (root._ph && root._ph.srcId === src.id)) return;
  phLoad(src.id, src.photo).then(x => {
    if (!x || !x.bytes || !root.isConnected || (root._ph && root._ph.from === 'new')) return;
    root._ph = { bytes: x.bytes, url: x.url, from: 'reuse', srcId: src.id }; phFormShow(root);
  });
}

/* ---------- pasting a picture: into the photo editor, the New case form, or the open case ---------- */
function phClipFile(dt) {
  if (!dt) return null;
  const it = Array.from(dt.items || []).find(i => i.kind === 'file' && /^image\//.test(i.type));
  return it ? it.getAsFile() : null;
}
function phBindPaste() {
  document.addEventListener('paste', e => {
    if (!S.inApp) return;
    const f = phClipFile(e.clipboardData); if (!f) return;
    // text being pasted into a field stays text (copying from a web page can carry a picture along)
    const t = e.target, editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));
    if (editable && Array.from(e.clipboardData.types || []).includes('text/plain')) return;
    if ($('#phWrap')) { e.preventDefault(); if (PH.onFile) PH.onFile(f); return; }
    const nc = $('#ncForm'); if (nc) { const root = nc.closest('#modalWrap'); if (root && $('#cf-photo', root)) { e.preventDefault(); phFormEdit(root, f); } return; }
    if (S.openId && !S.editing && $('#drawer') && !$('#modalWrap')) { const c = findCase(S.openId); if (c && !c.locked) { e.preventDefault(); phCaseEdit(c, f); } }
  });
}

Object.assign(ADMIN_ACTS, {
  phHide() { phToggleHide(); },
  phEdit() { const c = findCase(S.openId); if (c) phCaseEdit(c); },
  cfPhoto(t) { const root = t.closest('#modalWrap'); if (root) phFormEdit(root); }
});
