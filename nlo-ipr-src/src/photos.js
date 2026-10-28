/* =====================================================================
   Patient photos (Amir, 27 Oct 2026: "the IPR tracker and case tracker
   should be fully sharing the same data … enter patient's full name and
   also their photo, kind of like exactly how we have it in case tracker").
   The same pictures as NLO Cases, in the same place (backend.js: the photos
   collection, sealed with the office key):
   - a patient here shows the newest picture the office has of them — the one
     on this record (photos/{record id}), or the one on their NLO Cases case
     (found by the chart #), whichever was taken into the records last;
   - a picture taken, chosen, pasted or dropped here goes on this record, with
     a save of it (its history says so); NLO Cases copies it onto the
     patient's open cases the next time it reads them;
   - cropped and shrunk to a 160 px JPEG on this device (the camera's EXIF
     data goes with it); the full-size picture never leaves the device;
   - loaded only for the patients on screen, kept in memory until the lock;
   - the eye (per computer) blurs the pictures and shortens the names to
     "Jane D." for screens patients can see — as NLO Cases' eye does.
   The editor is NLO Cases' (photos.js there), the same way of working.
   ===================================================================== */
const PHOTO_PX = 160;
const IPH = { cache: new Map(), loading: new Map(), caseBy: new Map(), caseWait: null, caseQueue: new Set(), caseBusy: new Set(), caseRedo: new Set(), subs: new Set(), ver: 0, hide: false, onFile: null };
Object.assign(IC, {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  camera: '<path d="M4 8h3.2l1.6-2.5h6.4L16.8 8H20a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.2" r="3.7"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="M4 17.5l5-4.5 4 3.5 2.6-2.2L20 18"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.6A10 10 0 0112 5.5C18 5.5 21.5 12 21.5 12a17 17 0 01-3.2 4M6.6 6.7C3.9 8.5 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>'
});
const PH_SIL = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="9.2" r="4.3"/><path d="M3.6 22c.8-4.6 4.3-7.4 8.4-7.4s7.6 2.8 8.4 7.4z"/></svg>';
function phUrl(bytes) { return 'data:image/jpeg;base64,' + b64(bytes); }
function iphNotify() { IPH.ver++; IPH.subs.forEach(f => { try { f(); } catch (e) { } }); }
function iphSubscribe(f) { IPH.subs.add(f); return () => { IPH.subs.delete(f); }; }
function iphVersion() { return IPH.ver; }
/* a picture in memory: { url, bytes, at, pv } — null once known to be gone, undefined while it's on its way */
function iphKey(id, pv) { return id + '|' + pv; }
function iphGet(id, pv) {
  if (!id || !pv) return null;
  const k = iphKey(id, pv);
  if (IPH.cache.has(k)) return IPH.cache.get(k);
  if (!IPH.loading.has(k)) IPH.loading.set(k, (async () => {
    let e = null;
    try { const r = await FB.getPhoto(id); if (r && r.bytes) e = { url: phUrl(r.bytes), bytes: r.bytes, at: r.at || 0, pv: r.pv }; } catch (err) { e = null; }
    IPH.cache.set(k, e); IPH.loading.delete(k); iphNotify();
  })());
  return undefined;
}
function iphPut(id, pv, bytes, at) { const e = { url: phUrl(bytes), bytes, at: Number(at) || 0, pv }; IPH.cache.set(iphKey(id, pv), e); iphNotify(); return e; }
/* NLO Cases' newest photo for a chart #: { id, pv, at } or null; undefined while it's being looked up. The chart #s asked for in
   the same moment are looked up together (one read); `force` looks again (a patient just opened). */
const IPH_FRESH_MS = 90000;  // a list's answer is looked up again, in the background, after this long (a picture taken in NLO Cases since)
function iphCaseFor(chart, force) {
  const n = iprNorm(chart); if (!n) return null;
  const have = IPH.caseBy.get(n);
  if (have && !force && Date.now() - have.at < IPH_FRESH_MS) return have.ph;
  // (a forced look while one is on its way: looked up once more after it, so a picture saved a moment ago isn't missed)
  if (IPH.caseBusy.has(n)) { if (force) IPH.caseRedo.add(n); }
  else if (!IPH.caseQueue.has(n)) { IPH.caseQueue.add(n); iphCaseRun(); }
  return have ? have.ph : undefined;
}
function iphCaseRun() {
  if (IPH.caseWait) return;
  IPH.caseWait = setTimeout(async () => {
    const list = Array.from(IPH.caseQueue); IPH.caseQueue.clear(); IPH.caseWait = null;
    list.forEach(c => IPH.caseBusy.add(c));
    let info = new Map(); try { info = await FB.caseInfo(list); } catch (e) { }
    for (const c of list) {
      const cases = (info.get(c) || []).filter(x => x.photo).sort((p, q) => (q.photoAt - p.photoAt) || (q.at - p.at));
      IPH.caseBy.set(c, { at: Date.now(), ph: cases.length ? { id: cases[0].id, pv: cases[0].photo, at: cases[0].photoAt || cases[0].at } : null });
      IPH.caseBusy.delete(c);
      if (IPH.caseRedo.has(c)) { IPH.caseRedo.delete(c); IPH.caseQueue.add(c); }
    }
    if (IPH.caseQueue.size) iphCaseRun();
    iphNotify();
  }, 40);
}
/* which picture a patient shows: the record's own, or NLO Cases', whichever was taken into the records last.
   p: a patient row ({ id, patient_id, photo, photoAt }); returns { url, bytes, src: 'own' | 'case' | '', at, loading } */
function iphPick(p) {
  if (!p) return { url: '', src: '', at: 0, loading: false };
  const own = p.id && p.photo ? iphGet(p.id, p.photo) : null;
  const cs = p.patient_id ? iphCaseFor(p.patient_id) : null;
  const cp = cs ? iphGet(cs.id, cs.pv) : null;
  const loading = own === undefined || cs === undefined || cp === undefined;
  const ownAt = Number(p.photoAt) || (own && own.at) || 0, caseAt = cs ? (cs.at || (cp && cp.at) || 0) : 0;
  if (own && cp) return caseAt > ownAt ? { url: cp.url, bytes: cp.bytes, src: 'case', at: caseAt, loading } : { url: own.url, bytes: own.bytes, src: 'own', at: ownAt, loading };
  if (own) return { url: own.url, bytes: own.bytes, src: 'own', at: ownAt, loading };
  if (cp) return { url: cp.url, bytes: cp.bytes, src: 'case', at: caseAt, loading };
  return { url: '', src: '', at: 0, loading };
}
/* ---------- "Hide photos" on this computer (the eye): blurred pictures, "Jane D." names ---------- */
function iphInit() {
  try { IPH.hide = localStorage.getItem('ipr_hide_photos') === '1'; } catch (e) { }
  document.body.classList.toggle('phHide', IPH.hide);
  document.addEventListener('paste', iphOnPaste);
}
function iphToggleHide() {
  IPH.hide = !IPH.hide;
  try { localStorage.setItem('ipr_hide_photos', IPH.hide ? '1' : '0'); } catch (e) { }
  document.body.classList.toggle('phHide', IPH.hide); iphNotify();
  toast(IPH.hide ? 'Patient photos are blurred and names shortened (Jane D.) on this computer. Hover over one to see it.' : 'Patient photos and full names are shown again.');
}
/* "Jane D.": the first name and the last name's initial (NLO Cases' shortName) */
function shortName(n) {
  let s = String(n || '').replace(/\([^)]*\)/g, ' ').trim().replace(/\s+/g, ' '); if (!s) return '';
  const cm = s.split(','); if (cm.length === 2 && cm[0].trim() && cm[1].trim()) s = cm[1].trim() + ' ' + cm[0].trim();
  const w = s.split(' ').filter(x => x && !/^(jr|sr|ii|iii|iv)\.?$/i.test(x));
  if (w.length < 2) return w[0] || s;
  const last = w[w.length - 1].replace(/^[^\p{L}\p{N}]+/u, '');
  return w[0] + (last ? ' ' + last[0].toUpperCase() + '.' : '');
}
function ptShown(n) { const full = cleanName(n); return IPH.hide ? (shortName(full) || full) : full; }

/* ---------- the photo editor: take / choose / paste / drop a picture, then fit the face in the circle (NLO Cases') ---------- */
function phClose() { const w = $('#phWrap'); if (w) w.remove(); IPH.onFile = null; }
function phIsPic(f) { return !!f && (/^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(f.name || '')); }
function phShow(el, url) { el.innerHTML = ''; const im = document.createElement('img'); im.alt = ''; im.decoding = 'async'; im.src = url; el.appendChild(im); el.classList.add('on'); }
/* o: { name, current (data: URL or ''), note (where the current one is from), file, onSave(bytes) → Promise, onRemove() → Promise (optional) } */
function phEditor(o) {
  phClose();
  const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const back = document.activeElement;
  const w = document.createElement('div'); w.id = 'phWrap';
  w.innerHTML = '<div class="phBox" role="dialog" aria-modal="true" aria-labelledby="phTitle">' +
    '<div class="phHd"><div style="flex:1;min-width:0"><h3 id="phTitle">Patient photo</h3>' + (o.name ? '<div class="small muted phName">' + esc(o.name) + '</div>' : '') + '</div>' +
      '<button type="button" class="ip-btn icon quiet" data-ph="close" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="phPick" id="phPick"><div class="phDrop" id="phDrop" tabindex="0" role="button" aria-label="Choose a photo">' +
      '<span class="pav s96' + (o.current ? '' : ' none') + '" id="phNow">' + PH_SIL + '</span>' +
      (o.current && o.note ? '<span class="small muted">' + esc(o.note) + '</span>' : '') +
      '<b>' + (touch ? 'Take a photo or choose one' : 'Drop a photo here, or paste one (Ctrl+V)') + '</b>' +
      '<span class="small muted">' + (touch ? '' : 'A screenshot from the imaging software works too. ') + 'It’s cut to a small square and encrypted on this device; the full-size picture isn’t kept. NLO Cases shows it too.</span></div>' +
      '<div class="phBtns">' + (touch ? '<button type="button" class="ip-btn primary" data-ph="camera">' + ic('camera', 16) + 'Take photo</button>' : '') +
        '<button type="button" class="ip-btn ' + (touch ? '' : 'primary') + '" data-ph="file">' + ic('image', 16) + 'Choose a file</button>' +
        (o.onRemove ? '<button type="button" class="ip-btn quiet danger" data-ph="remove">' + ic('trash', 16) + 'Remove photo</button>' : '') + '</div></div>' +
    '<div class="phCrop" id="phCrop" hidden><div class="phStage" id="phStage" tabindex="0" aria-label="Photo: drag or use the arrow keys to move it, + and − to zoom"><canvas id="phCv"></canvas><div class="phRing"></div></div>' +
      '<div class="phZoom"><button type="button" class="ip-btn icon sm" data-ph="out" aria-label="Zoom out">' + ic('minus', 18) + '</button>' +
        '<input type="range" id="phZ" min="1" max="4" step="0.01" value="1" aria-label="Zoom">' +
        '<button type="button" class="ip-btn icon sm" data-ph="in" aria-label="Zoom in">' + ic('plus', 18) + '</button>' +
        '<button type="button" class="ip-btn quiet sm" data-ph="rotate">' + ic('refresh', 15) + 'Rotate</button></div>' +
      '<div class="small muted phTip">Drag to center the face' + (touch ? ', pinch to zoom.' : '. Zoom with the slider or the mouse wheel.') + '</div></div>' +
    '<div class="phErr" id="phErr" role="alert"></div>' +
    '<div class="phFt"><button type="button" class="ip-btn quiet" data-ph="back" hidden>Choose another</button><span style="flex:1"></span>' +
      '<button type="button" class="ip-btn" data-ph="close">Cancel</button><button type="button" class="ip-btn ok" data-ph="save" disabled>Use photo</button></div>' +
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
  IPH.onFile = load;
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
  w.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(); } });
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
/* a picture pasted anywhere on the page: into the editor when it's open, else the app's own hook (the patient on screen) */
function phClipFile(dt) {
  if (!dt) return null;
  const it = Array.from(dt.items || []).find(i => i.kind === 'file' && /^image\//.test(i.type));
  return it ? it.getAsFile() : null;
}
function iphOnPaste(e) {
  if (!S.inApp) return;
  const f = phClipFile(e.clipboardData); if (!f) return;
  const t = e.target, editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));
  if (editable && Array.from(e.clipboardData.types || []).includes('text/plain')) return; // (text being pasted into a field stays text)
  if ($('#phWrap')) { e.preventDefault(); if (IPH.onFile) IPH.onFile(f); return; }
  if (APP_HOOKS.paste && APP_HOOKS.paste(f)) e.preventDefault();
}

/* ---------- the picture next to a name (React) ---------- */
/* p: a patient row; pending: { url } for a picture chosen but not saved yet (a new patient); size: px; force: look NLO Cases
   up again for this patient. Renders the round picture, or the silhouette. */
function PtAvatar({ p, pending, size, force, className }) {
  React.useSyncExternalStore(iphSubscribe, iphVersion);
  // `force`: NLO Cases looked up again once for this patient (a picture taken there since this page started), not on every draw
  const chart = p && p.patient_id;
  React.useEffect(() => { if (force && chart) iphCaseFor(chart, true); }, [force, chart]);
  const pick = pending && pending.url ? { url: pending.url, src: 'new', loading: false } : iphPick(p);
  const cls = 'pav s' + (size || 32) + (pick.url ? ' on' : '') + (className ? ' ' + className : '');
  if (pick.url) return React.createElement('span', { className: cls, 'aria-hidden': 'true', 'data-src': pick.src }, React.createElement('img', { src: pick.url, alt: '', decoding: 'async' }));
  return React.createElement('span', { className: cls, 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: PH_SIL } });
}
/* the patient's name as the eye wants it; re-renders with the eye */
function PtName({ name, fallback }) {
  React.useSyncExternalStore(iphSubscribe, iphVersion);
  const full = cleanName(name); if (!full) return fallback || null;
  const sh = shortName(full);
  return IPH.hide && sh && sh !== full ? React.createElement('span', { className: 'pnm', 'data-s': sh, title: full }, React.createElement('span', { className: 'pnF' }, full)) : full;
}
/* the eye button (the header) */
function PhHideBtn() {
  React.useSyncExternalStore(iphSubscribe, iphVersion);
  return React.createElement('button', { type: 'button', className: 'ip-btn icon phTgl', 'aria-pressed': IPH.hide, onClick: iphToggleHide,
    title: IPH.hide ? 'Patient photos are blurred and names shortened on this computer — click to show them' : 'Blur patient photos and shorten names on this computer (for screens patients can see)',
    'aria-label': IPH.hide ? 'Show patient photos and names' : 'Hide patient photos and names', dangerouslySetInnerHTML: { __html: ic(IPH.hide ? 'eyeOff' : 'eye', 19) } });
}
