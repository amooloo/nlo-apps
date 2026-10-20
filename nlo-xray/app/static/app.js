/* NLO X-Ray Reader - the page. Talks only to the app on this PC (same origin); loads nothing else. */
'use strict';
(() => {
  // ------------------------------------------------------------------ helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtDate = (d) => {
    if (!d) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m ? `${+m[2]}/${+m[3]}/${m[1]}` : d;
  };
  const fmtVal = (m) => {
    if (m.value == null) return '';
    const v = Number(m.value).toFixed(1);
    const sign = m.unit === 'mm' && m.group !== 'Lengths' && m.value > 0 ? '+' : '';
    return `${sign}${v}${m.unit === '°' ? '°' : ' ' + m.unit}`;
  };
  const statusWord = (s) => ({ new: 'to trace', traced: 'to confirm', confirmed: 'confirmed' }[s] || s);
  const GROUP_COLORS = { cranial: '#8FB4FF', maxilla: '#64F4C9', mandible: '#FF8C7A', teeth: '#F6C453', soft: '#FF9BD2', cvm: '#C7A6FF' };
  const LINE_COLORS = { SN: '#8FB4FF', FH: '#64F4C9', NA: '#F6AF24', NB: '#F6AF24', MP: '#FF8C7A', PP: '#64F4C9', U1: '#FFFFFF',
    L1: '#FFFFFF', 'E-line': '#FF9BD2', FOP: '#9DD9FF', Ramus: '#B8C2D3' };
  const LONG = new Set(['SN', 'FH', 'MP', 'PP', 'FOP']);   // lines drawn past their end points

  const S = {
    defs: null, lm: {}, order: [], status: null, cases: [], q: '',
    case: null, analysis: null, img: null, filtered: null, dpr: 1,
    view: { scale: 1, tx: 0, ty: 0 }, fitScale: 1,
    bright: 100, contrast: 100, invert: false, labels: true, lines: true, follow: true,
    mode: 'idle', anchorIdx: 0, anchorPts: {}, cur: null,
    pending: {}, saveTimer: 0, saving: null, undo: [], ruler: [], prevMode: null,
    ptr: null, hover: null, space: false, raf: 0, settings: null, setTab: 'learn',
  };

  // ------------------------------------------------------------------ server
  let passPromise = null;
  async function api(path, opts = {}) {
    const o = { headers: {}, ...opts };
    if (o.body !== undefined && !(o.body instanceof FormData)) {
      o.headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(o.body);
    }
    const r = await fetch(path, o);
    if (r.status === 401) {
      await askPasscode();
      return api(path, opts);
    }
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (!r.ok) throw new Error((data && data.detail) || r.statusText || 'request failed');
    return data;
  }

  function askPasscode() {
    if (passPromise) return passPromise;
    passPromise = new Promise((resolve) => {
      const dlg = $('#dlgPass');
      $('#passErr').textContent = '';
      $('#passIn').value = '';
      const onClose = async () => {
        try {
          const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('#passIn').value }) });
          if (r.ok) { dlg.removeEventListener('close', onClose); passPromise = null; resolve(); return; }
          $('#passErr').textContent = 'That passcode is not right.';
        } catch (e) { $('#passErr').textContent = 'Could not reach the app.'; }
        dlg.showModal();
      };
      dlg.addEventListener('close', onClose);
      dlg.addEventListener('cancel', (e) => e.preventDefault());
      dlg.showModal();
      $('#passIn').focus();
    });
    return passPromise;
  }

  let toastTimer = 0;
  function toast(msg, err = false, ms = 3800) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!err);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function ask(title, text, yes = 'OK') {
    return new Promise((resolve) => {
      const d = $('#dlgAsk');
      $('#askTitle').textContent = title;
      $('#askText').textContent = text;
      $('#askYes').textContent = yes;
      const done = () => { d.removeEventListener('close', done); resolve(d.returnValue === 'yes'); };
      d.addEventListener('close', done);
      d.returnValue = '';
      d.showModal();
    });
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    try {
      const h = await (await fetch('/api/hello')).json();
      if (h.passcode && !h.signed_in) await askPasscode();
    } catch (e) { /* the api() calls below report it */ }
    S.defs = await api('/api/defs');
    for (const l of S.defs.landmarks) S.lm[l.code] = l;
    S.order = S.defs.landmarks.map((l) => l.code);
    wire();
    await Promise.all([refreshStatus(), refreshCases()]);
    const m = /case=([\w-]+)/.exec(location.hash);
    if (m) openCase(m[1]).catch(() => showWelcome());
    setInterval(refreshStatus, 20000);
  }

  async function refreshStatus() {
    try { S.status = await api('/api/status'); } catch (e) { return; }
    renderLearnLine();
    const wt = $('#welcomeTrace');
    if (wt && S.status.model) wt.textContent = 'The app places the points itself. Click where any point really belongs, or press Enter when it is right.';
  }

  async function refreshCases() {
    try { S.cases = await api('/api/cases'); } catch (e) { toast(e.message, true); return; }
    renderCases();
  }

  // ------------------------------------------------------------------ sidebar
  function renderCases() {
    const q = S.q.trim().toLowerCase();
    const rows = S.cases.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.taken || '').includes(q) || fmtDate(c.taken).includes(q));
    $('#caseCount').textContent = S.cases.length ? `(${S.cases.length})` : '';
    $('#caseList').innerHTML = rows.map((c) => `
      <button class="case${S.case && S.case.id === c.id ? ' active' : ''}" data-id="${esc(c.id)}" type="button">
        <img src="/api/cases/${enc(c.id)}/thumb" alt="" loading="lazy">
        <span class="meta"><span class="nm">${esc(c.name)}</span>
        <span class="sub">${esc(fmtDate(c.taken) || 'no date')}${c.age != null ? ' · ' + c.age + ' y' : ''}${c.stage ? ' · ' + esc(c.stage) : ''}<span class="pill ${esc(c.status)}">${statusWord(c.status)}</span></span></span>
      </button>`).join('') || `<div class="empty" style="color:#8EA0BE;padding:8px 12px">${S.cases.length ? 'Nothing matches.' : 'No x-rays yet.'}</div>`;
  }

  function renderLearnLine() {
    const st = S.status;
    if (!st) return;
    const L = st.learning || {};
    const el = $('#learnLine');
    if (L.running) {
      const p = L.progress || {};
      const pct = p.steps ? Math.round(100 * (p.step || 0) / p.steps) : 0;
      el.innerHTML = `<b>Learning now</b> from ${st.confirmed} tracings… ${pct}%<div class="learnBar"><div style="width:${pct}%"></div></div>`;
    } else if (st.model) {
      el.innerHTML = `<b>Places points itself</b> · v${esc(st.model.version)}<br>avg error ${esc(st.model.mre)} mm on x-rays it hadn't seen`;
    } else {
      const n = st.confirmed, need = st.min_cases;
      el.innerHTML = `<b>Learning:</b> ${n} of ${need} confirmed tracings<div class="learnBar"><div style="width:${Math.min(100, 100 * n / need)}%"></div></div>`;
    }
  }

  function showWelcome() {
    S.case = null;
    $('#caseView').hidden = true;
    $('#welcome').hidden = false;
    history.replaceState(null, '', location.pathname);
    renderCases();
  }

  // ------------------------------------------------------------------ import
  async function importFiles(files) {
    files = [...files].filter((f) => f && f.size);
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    toast(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`, false, 20000);
    let res;
    try { res = await api('/api/cases', { method: 'POST', body: fd }); } catch (e) { toast(e.message, true); return; }
    const ok = res.filter((r) => r.id);
    const bad = res.filter((r) => r.error);
    await refreshCases();
    if (bad.length) toast(bad.map((b) => `${b.name}: ${b.error}`).join(' · '), true, 8000);
    else if (ok.length > 1) toast(`${ok.length} x-rays added. Opening the first.`);
    else $('#toast').classList.remove('show');
    if (ok.length) {
      if (ok[0].duplicate && ok.length === 1) toast(`${ok[0].name} was already here - opened it.`);
      await openCase(ok[0].id, { fresh: !ok[0].duplicate });
    }
  }

  // ------------------------------------------------------------------ open a case
  async function openCase(id, { fresh = false } = {}) {
    await flushSave();
    const r = await api(`/api/cases/${enc(id)}`);
    S.case = r.case;
    S.analysis = r.analysis;
    S.undo = [];
    S.pending = {};
    S.mode = 'idle';
    S.cur = null;
    S.ruler = [];
    history.replaceState(null, '', '#case=' + id);
    $('#welcome').hidden = true;
    $('#caseView').hidden = false;
    renderCases();
    renderAll();
    loadImage();
    if (fresh || !S.case.details_confirmed) await openDetails(true);
    startTracing();
  }

  function loadImage() {
    S.img = null;
    S.filtered = null;
    $('#vLoading').hidden = false;
    $('#vLoading').textContent = 'Loading the x-ray…';
    const id = S.case.id;
    const im = new Image();
    im.onload = () => {
      if (!S.case || S.case.id !== id) return;
      S.img = im;
      $('#vLoading').hidden = true;
      rebuildFiltered();
      fit();
      focusCurrent(false);
    };
    im.onerror = () => { $('#vLoading').textContent = 'Could not load the image.'; };
    im.src = `/api/cases/${enc(id)}/image?v=${enc(S.case.updated || '')}`;
  }

  function required() {
    const sk = new Set(S.case.skipped || []);
    return S.order.filter((c) => !sk.has(S.lm[c].group));
  }

  function nextUnreviewed(from) {
    const req = required();
    const lm = S.case.landmarks || {};
    const start = from ? req.indexOf(from) + 1 : 0;
    for (let i = 0; i < req.length; i++) {
      const c = req[(start + i) % req.length];
      if (!lm[c] || lm[c].by !== 'doctor') return c;
    }
    return null;
  }

  function nextInOrder(code) {
    const req = required();
    const i = req.indexOf(code);
    return i >= 0 && i < req.length - 1 ? req[i + 1] : null;
  }

  function startTracing() {
    S.walkAll = false;
    const c = S.case;
    const n = Object.keys(c.landmarks || {}).length;
    if (c.status === 'confirmed') { S.mode = 'done'; S.cur = null; }
    else if (!n) {
      if (S.status && S.status.model) { autoTrace(); return; }
      S.mode = 'anchors'; S.anchorIdx = 0; S.anchorPts = {};
    } else {
      S.cur = nextUnreviewed(null);
      S.mode = S.cur ? 'review' : 'done';
    }
    renderTrace();
    draw();
    focusCurrent();
  }

  async function autoTrace() {
    await flushSave();
    S.mode = 'busy';
    renderTrace();
    setHint('Placing the points…');
    try {
      const r = await api(`/api/cases/${enc(S.case.id)}/auto`, { method: 'POST' });
      applyServer(r, true);
      S.cur = nextUnreviewed(null);
      S.mode = S.cur ? 'review' : 'done';
      const low = Object.values(S.case.landmarks).filter((v) => v.by === 'model' && v.conf != null && v.conf < 0.5).length;
      toast(low ? `Points placed. ${low} the app is unsure about are marked orange.` : 'Points placed. Check each one: Enter if right, or click where it belongs.');
    } catch (e) {
      toast(e.message, true);
      S.mode = 'anchors'; S.anchorIdx = 0; S.anchorPts = {};
    }
    renderTrace();
    draw();
    focusCurrent();
  }

  async function placeFromAnchors() {
    S.mode = 'busy';
    renderTrace();
    try {
      const r = await api(`/api/cases/${enc(S.case.id)}/anchors`, { method: 'POST', body: S.anchorPts });
      applyServer(r, true);
      S.cur = nextUnreviewed(null);
      S.mode = S.cur ? 'review' : 'done';
    } catch (e) {
      toast(e.message, true);
      S.mode = 'anchors'; S.anchorIdx = 0; S.anchorPts = {};
    }
    renderTrace();
    draw();
    focusCurrent();
  }

  async function restartTracing() {
    if (!await ask('Start over?', 'All points on this x-ray are cleared and you click S, N and Me again.', 'Start over')) return;
    const clear = {};
    for (const c of Object.keys(S.case.landmarks || {})) clear[c] = null;
    try {
      const r = await api(`/api/cases/${enc(S.case.id)}`, { method: 'PATCH', body: { landmarks: clear, status: 'reopen' } });
      applyServer(r, true);
    } catch (e) { toast(e.message, true); return; }
    S.undo = [];
    S.mode = 'anchors'; S.anchorIdx = 0; S.anchorPts = {}; S.cur = null;
    renderAll();
    draw();
  }

  // ------------------------------------------------------------------ editing points
  function setPoint(code, x, y, { advance = false, by = 'doctor', old } = {}) {
    const lm = S.case.landmarks;
    const prev = old !== undefined ? old : (lm[code] ? { ...lm[code] } : null);
    S.undo.push({ code, old: prev });
    if (S.undo.length > 300) S.undo.shift();
    lm[code] = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, by, conf: null };
    S.pending[code] = lm[code];
    scheduleSave();
    if (advance) {
      S.cur = S.walkAll ? nextInOrder(code) : nextUnreviewed(code);
      if (!S.cur) { S.mode = 'done'; S.walkAll = false; fit(); } else focusCurrent();
    }
    renderTrace();
    draw();
  }

  function acceptCurrent() {
    if (S.mode !== 'review' || !S.cur) return;
    const v = S.case.landmarks[S.cur];
    if (!v) return;
    setPoint(S.cur, v.x, v.y, { advance: true });
  }

  function goBack() {
    if (S.mode === 'anchors') {
      if (S.anchorIdx > 0) { S.anchorIdx--; delete S.anchorPts[S.defs.anchors[S.anchorIdx]]; renderTrace(); draw(); }
      return;
    }
    const req = required();
    if (S.mode === 'done' && !S.cur) { S.cur = req[req.length - 1]; S.mode = 'review'; }
    else if (S.cur) { const i = req.indexOf(S.cur); S.cur = req[Math.max(0, i - 1)]; }
    renderTrace(); draw(); focusCurrent();
  }

  function selectPoint(code) {
    S.cur = code;
    if (S.case.status !== 'confirmed') S.mode = 'review';
    renderTrace(); draw();
  }

  function undo() {
    const u = S.undo.pop();
    if (!u) return toast('Nothing to undo.');
    if (u.old) S.case.landmarks[u.code] = u.old; else delete S.case.landmarks[u.code];
    S.pending[u.code] = u.old;
    scheduleSave();
    S.cur = u.code;
    if (S.case.status !== 'confirmed') S.mode = 'review';
    renderTrace(); draw();
  }

  function nudge(dx, dy) {
    if (!S.cur || !S.case.landmarks[S.cur]) return;
    const v = S.case.landmarks[S.cur];
    const k = 1 / S.view.scale;
    setPoint(S.cur, v.x + dx * k, v.y + dy * k, { by: 'doctor' });
  }

  function scheduleSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flushSave, 350);
  }

  async function flushSave() {
    clearTimeout(S.saveTimer);
    if (S.saving) await S.saving;
    const p = S.pending;
    if (!S.case || !Object.keys(p).length) return;
    S.pending = {};
    const id = S.case.id;
    S.saving = (async () => {
      try {
        const r = await api(`/api/cases/${enc(id)}`, { method: 'PATCH', body: { landmarks: p } });
        if (S.case && S.case.id === id) applyServer(r, false);
        const row = S.cases.find((c) => c.id === id);
        if (row && row.status !== r.case.status) { row.status = r.case.status; renderCases(); }
      } catch (e) {
        toast('Not saved: ' + e.message, true);
        if (S.case && S.case.id === id) S.pending = { ...p, ...S.pending };
      }
    })();
    await S.saving;
    S.saving = null;
  }

  function applyServer(r, takeLandmarks) {
    const local = S.case ? S.case.landmarks : null;
    S.case = r.case;
    S.analysis = r.analysis;
    if (!takeLandmarks && local) S.case.landmarks = { ...r.case.landmarks, ...local };
    renderAll();
    draw();
  }

  // ------------------------------------------------------------------ rendering the panels
  function renderAll() {
    if (!S.case) return;
    renderTop();
    renderTrace();
    renderSummary();
    renderCvm();
    renderMeasures();
  }

  function calText() {
    const c = S.case.calibration || {};
    return c.mm_per_px ? `${(+c.mm_per_px).toFixed(4)} mm per pixel` : '';
  }

  function renderTop() {
    const c = S.case;
    const p = c.patient || {};
    $('#pName').textContent = p.name || '(no name)';
    const age = S.analysis && S.analysis.age;
    const bits = [];
    bits.push(c.taken ? `X-ray ${fmtDate(c.taken)}` : 'X-ray date not set');
    if (age != null) bits.push(`${age} years`);
    if (p.sex) bits.push(p.sex === 'F' ? 'female' : 'male');
    if (p.chart) bits.push(`#${p.chart}`);
    $('#pSub').innerHTML = esc(bits.join(' · '));
    const pill = $('#pStatus');
    pill.className = 'pill ' + c.status;
    pill.textContent = statusWord(c.status);
    const confirmed = c.status === 'confirmed';
    $('#confirmBtn').hidden = confirmed;
    $('#reopenBtn').hidden = !confirmed;
    const prog = S.analysis ? S.analysis.progress : null;
    $('#confirmBtn').disabled = !(prog && prog.placed === prog.total && prog.total > 0);
    const cal = $('#vCal');
    const t = calText();
    cal.className = 'vCal' + (t ? '' : ' warn');
    cal.textContent = t ? t : 'Not calibrated: angles only - use Ruler';
    cal.title = (c.calibration && c.calibration.source) || 'Millimetre measurements need the pixel size. Use the Ruler on a known length.';
    $('#ageSub').textContent = age != null ? `${age} y at the x-ray` : '';
  }

  function minimap(code) {
    const T = S.defs.template;
    const minX = -45, maxX = 100, minY = -105, maxY = 14;
    const W = 112, H = 120, pad = 5;
    const k = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY));
    const P = (c) => [pad + (T[c][0] - minX) * k, pad + (maxY - T[c][1]) * k];
    let s = `<svg class="minimap" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
    for (const l of S.defs.lines) {
      const a = P(l.a), b = P(l.b);
      s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#C3C9D0" stroke-width="0.8"/>`;
    }
    for (const o of S.defs.outlines) {
      s += `<polyline fill="none" stroke="#C3C9D0" stroke-width="0.8" points="${o.map((c) => P(c).join(',')).join(' ')}"/>`;
    }
    for (const c of S.order) {
      const [x, y] = P(c);
      s += `<circle cx="${x}" cy="${y}" r="1.3" fill="#969FAB"/>`;
    }
    if (code && T[code]) {
      const [x, y] = P(code);
      s += `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#FA624D" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="2.6" fill="#FA624D"/>`;
    }
    return s + '</svg>';
  }

  function renderTrace() {
    if (!S.case) return;
    const body = $('#traceBody');
    const lm = S.case.landmarks || {};
    const req = required();
    const reviewed = req.filter((c) => lm[c] && lm[c].by === 'doctor').length;
    $('#traceSub').textContent = `${reviewed} / ${req.length} checked`;
    const prog = `<div class="prog"><div style="width:${req.length ? 100 * reviewed / req.length : 0}%"></div></div>`;
    const hasModel = !!(S.status && S.status.model);
    let html = '';
    let hint = '';
    if (S.mode === 'busy') {
      html = '<p class="empty">Working…</p>';
    } else if (S.mode === 'idle' && S.case.status !== 'confirmed') {
      html = '<p class="empty">Check the details to start.</p>';
    } else if (S.mode === 'anchors') {
      const code = S.defs.anchors[S.anchorIdx];
      const d = S.lm[code];
      html = `<div class="traceNow"><div><div class="code">${esc(code)}</div><div class="lname">${esc(d.name)}</div>
        <div class="def">${esc(d.definition)}</div>
        <div class="cue">Click it on the x-ray (${S.anchorIdx + 1} of 3: S, N, Me). The other points then appear roughly in place.</div></div>${minimap(code)}</div>
        <div class="traceBtns">${S.anchorIdx ? '<button class="small" id="bBack" type="button">◀ Back</button>' : ''}
        ${hasModel ? '<button class="small" id="bAuto" type="button">Let the app place them</button>' : ''}</div>
        <div class="keys">Scroll to zoom · drag to move around · <span class="kbd">Backspace</span> back</div>`;
      hint = `Click <b>${esc(d.name)}</b> (${S.anchorIdx + 1} of 3)`;
    } else if (S.mode === 'review' && S.cur) {
      const d = S.lm[S.cur];
      const v = lm[S.cur];
      let cue = '';
      if (!v) cue = '<div class="cue warn">Not placed yet - click where it belongs.</div>';
      else if (v.by === 'doctor') cue = '<div class="cue">Checked. Click elsewhere to move it, or Enter for the next point.</div>';
      else if (v.by === 'model') {
        const pct = v.conf != null ? Math.round(v.conf * 100) : null;
        cue = (v.conf != null && v.conf < 0.5)
          ? `<div class="cue warn">The app is unsure here (${pct}%). Click where it belongs, or Enter if it is right.</div>`
          : `<div class="cue">Placed by the app${pct != null ? ` (${pct}% sure)` : ''}. Enter if right, or click where it belongs.</div>`;
      } else cue = '<div class="cue">Placed from the average tracing. Click where it belongs, or Enter if it is right.</div>';
      html = `<div class="traceNow"><div><div class="code">${esc(S.cur)}</div><div class="lname">${esc(d.name)}</div>
        <div class="def">${esc(d.definition)}</div>${cue}</div>${minimap(S.cur)}</div>
        <div class="traceBtns"><button class="small" id="bBack" type="button">◀ Back</button>
        <button class="primary" id="bOk" type="button">Looks right ▶</button></div>`;
      hint = `Click where <b>${esc(d.name)}</b> belongs, or press Enter if it is right`;
    } else if (S.case.status === 'confirmed') {
      const when = S.case.confirmed_at ? fmtDate(S.case.confirmed_at.slice(0, 10)) : '';
      html = `<div class="doneNote">Confirmed ${esc(when)}. This tracing is a lesson for the app${S.case.cvm && S.case.cvm.doctor ? `, with CVM ${esc(S.case.cvm.doctor)} as your call` : ''}.</div>
        <p class="hint">Dragging a point still corrects it (the app learns the correction).</p>`;
    } else {
      html = `<div class="doneNote">All points checked. Confirm the tracing to file it as a lesson.</div>
        <div class="traceBtns"><button class="primary" id="bConfirm2" type="button">Confirm tracing</button></div>
        <p class="hint">Confirming also records the CVM stage below as your call - change it there first if you see it differently.</p>`;
    }
    if (S.mode !== 'anchors' && S.mode !== 'busy' && !(S.mode === 'idle' && S.case.status !== 'confirmed')) {
      const groups = S.defs.groups.map((g) => {
        const sk = (S.case.skipped || []).includes(g.id);
        const n = g.codes.filter((c) => lm[c] && lm[c].by === 'doctor').length;
        const done = !sk && n === g.codes.length;
        return `<span class="gchip${done ? ' done' : ''}${sk ? ' skipped' : ''}" data-group="${g.id}" title="${sk ? 'Skipped' : 'Go to these points'}"><span class="dot" style="background:${GROUP_COLORS[g.id]}"></span>${esc(g.name)} ${sk ? '' : `${n}/${g.codes.length}`}</span>`;
      }).join('');
      const skipSoft = (S.case.skipped || []).includes('soft');
      const skipCvm = (S.case.skipped || []).includes('cvm');
      html += prog + `<div class="progTxt"><span>${reviewed} of ${req.length} points checked</span><span>${Object.keys(lm).length < req.length ? `${req.length - Object.keys(lm).filter((c) => req.includes(c)).length} not placed` : ''}</span></div>
        <div class="groups">${groups}</div>
        ${S.case.status === 'confirmed' ? '' : `<div class="skipRow"><label><input type="checkbox" id="skSoft" ${skipSoft ? 'checked' : ''}> Skip soft tissue</label>
        <label><input type="checkbox" id="skCvm" ${skipCvm ? 'checked' : ''}> Skip vertebrae (adult)</label></div>
        <div class="traceBtns">${hasModel ? '<button class="small" id="bAuto" type="button">Place with the app</button>' : ''}
        <button class="small" id="bRestart" type="button">Start over from S, N, Me</button></div>`}
        <div class="keys"><span class="kbd">Enter</span> right, next · <span class="kbd">Backspace</span> back · <span class="kbd">←↑→↓</span> nudge · <span class="kbd">Ctrl Z</span> undo · <span class="kbd">F</span> fit · scroll to zoom · drag a point to move it</div>`;
    }
    body.innerHTML = html;
    setHint(hint);
    const on = (id, f) => { const el = $(id, body); if (el) el.onclick = f; };
    on('#bBack', goBack);
    on('#bOk', acceptCurrent);
    on('#bAuto', autoTrace);
    on('#bRestart', restartTracing);
    on('#bConfirm2', confirmTracing);
    for (const g of $$('.gchip', body)) {
      g.onclick = () => {
        const grp = S.defs.groups.find((x) => x.id === g.dataset.group);
        if (!grp || (S.case.skipped || []).includes(grp.id)) return;
        const c = grp.codes.find((x) => !lm[x] || lm[x].by !== 'doctor') || grp.codes[0];
        selectPoint(c);
        focusCurrent();
      };
    }
    const sk = (id, grp) => { const el = $(id, body); if (el) el.onchange = () => setSkip(grp, el.checked); };
    sk('#skSoft', 'soft');
    sk('#skCvm', 'cvm');
  }

  async function setSkip(group, on) {
    await flushSave();
    const cur = new Set(S.case.skipped || []);
    if (on) cur.add(group); else cur.delete(group);
    try {
      const r = await api(`/api/cases/${enc(S.case.id)}`, { method: 'PATCH', body: { skipped: [...cur] } });
      applyServer(r, true);
      if (!on && Object.keys(S.case.landmarks || {}).length >= 4) {
        // bring the group back: its points go where the average tracing says, from the points already placed
        applyServer(await api(`/api/cases/${enc(S.case.id)}/fill`, { method: 'POST' }), true);
      }
      S.cur = nextUnreviewed(null);
      S.mode = S.case.status === 'confirmed' ? 'done' : (S.cur ? 'review' : 'done');
      renderAll(); draw();
    } catch (e) { toast(e.message, true); }
  }

  function renderSummary() {
    const a = S.analysis;
    const el = $('#summary');
    if (!a || !a.summary.length) { el.innerHTML = '<p class="empty">Appears as the points are placed.</p>'; return; }
    el.innerHTML = a.summary.map((s) => `<div class="sitem ${esc(s.level)}"><div class="t">${esc(s.title)}</div>
      <div class="c">${esc(s.call)}</div><div class="d">${esc(s.detail)}</div></div>`).join('');
  }

  function renderCvm() {
    const el = $('#cvmBody');
    const a = S.analysis;
    if ((S.case.skipped || []).includes('cvm')) {
      el.innerHTML = '<p class="empty">Vertebrae skipped for this x-ray.</p>';
      return;
    }
    const cv = a && a.cvm;
    if (!cv) { el.innerHTML = '<p class="empty">Trace C2-C4 to stage CVM.</p>'; return; }
    const doc = (S.case.cvm || {}).doctor;
    const rows = (cv.features || []).map((f) => `<tr><td><b>${esc(f.level)}</b></td>
      <td>${f.concave == null ? '<span class="no">-</span>' : f.concave ? '<span class="yes">concave</span>' : '<span class="no">flat</span>'}
      ${f.concavity_pct != null ? `<span class="no"> ${f.concavity_pct}%${f.concavity_mm != null ? ` (${f.concavity_mm} mm)` : ''}</span>` : ''}</td>
      <td>${f.shape ? esc(f.shape) : f.level === 'C2' ? '' : '<span class="no">-</span>'}${f.height_width != null ? `<span class="no"> h/w ${f.height_width}</span>` : ''}</td></tr>`).join('');
    const opts = ['', 'CS1', 'CS2', 'CS3', 'CS4', 'CS5', 'CS6'].map((o) => `<option value="${o}"${(doc || '') === o ? ' selected' : ''}>${o ? o : 'Same as the app'}</option>`).join('');
    const age = a.age != null ? ` · ${a.age} y` : '';
    const shown = doc || cv.stage;
    el.innerHTML = `<div class="cvmHead"><div class="cvmStage">${esc(shown || '-')}</div><div class="cvmTiming">${doc && doc !== cv.stage ? `Your call (the app reads ${esc(cv.stage || '-')})` : (cv.stage ? 'Read from the tracing' : '')}${esc(age)}</div></div>
      <div class="cvmTiming" style="margin-top:4px">${esc(timingFor(shown) || cv.timing || '')}</div>
      <table class="ft"><tr><th></th><th>Lower border</th><th>Body</th></tr>${rows}</table>
      ${cv.notes && cv.notes.length ? `<div class="notes">${cv.notes.map(esc).join('<br>')}</div>` : ''}
      <div class="callRow"><label for="cvmCall">Your call</label><select id="cvmCall">${opts}</select></div>
      <div class="tuned" id="cvmTuned"></div>`;
    $('#cvmCall').onchange = async (e) => {
      try {
        await flushSave();
        const r = await api(`/api/cases/${enc(S.case.id)}`, { method: 'PATCH', body: { cvm_doctor: e.target.value || null } });
        applyServer(r, false);
      } catch (err) { toast(err.message, true); }
    };
    const st = S.status && S.status.learning && S.status.learning.cvm;
    $('#cvmTuned').textContent = st && st.message ? st.message : 'Your calls on confirmed x-rays tune the thresholds to your eye once there are 8.';
  }

  const TIMING = {
    CS1: 'Pre-pubertal: the peak in mandibular growth is on average about 2 years away.',
    CS2: 'Pre-pubertal: the peak in mandibular growth is on average about 1 year away.',
    CS3: 'Pubertal: the peak in mandibular growth is expected during the coming year.',
    CS4: 'Pubertal: the peak in mandibular growth happened within the last 1-2 years.',
    CS5: 'Post-pubertal: the peak ended at least 1 year ago.',
    CS6: 'Post-pubertal: the peak ended at least 2 years ago.',
  };
  const timingFor = (s) => TIMING[s] || '';

  function renderMeasures() {
    const a = S.analysis;
    const t = $('#measTable');
    if (!a) { t.innerHTML = ''; return; }
    let html = '';
    let grp = null;
    let n = 0;
    for (const m of a.measurements) {
      if (m.group !== grp) { grp = m.group; html += `<tr class="g"><td colspan="4">${esc(grp)}</td></tr>`; }
      const z = m.z;
      const cls = z == null ? '' : Math.abs(z) > 2 ? 'w2' : Math.abs(z) > 1 ? 'w1' : '';
      const val = fmtVal(m);
      const norm = m.norm ? `${m.norm.mean}±${m.norm.sd}` : '';
      const dev = (m.value != null && z != null) ? `<div class="dev"><div class="band"></div><div class="mk" style="left:${clamp(50 + z * 100 / 6, 2, 98)}%"></div></div>` : '';
      if (m.value != null) n++;
      html += `<tr class="${cls}" title="${esc(m.desc)}"><td>${esc(m.label)}</td>`
        + (m.value == null ? `<td class="note" colspan="3">${esc(m.note)}</td>` : `<td class="v">${esc(val)}</td><td class="nm">${esc(norm)}</td><td>${dev}</td>`)
        + '</tr>';
    }
    t.innerHTML = html;
    $('#measSub').textContent = `${n} of ${a.measurements.length}`;
  }

  function setHint(h) {
    const el = $('#vHint');
    el.hidden = !h;
    el.innerHTML = h || '';
  }

  // ------------------------------------------------------------------ the viewer
  const cv = $('#cv');
  const ctx = cv.getContext('2d');

  function resizeCanvas() {
    const r = cv.getBoundingClientRect();
    S.dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * S.dpr));
    cv.height = Math.max(1, Math.round(r.height * S.dpr));
    draw();
  }

  function rebuildFiltered() {
    if (!S.img) return;
    const c = document.createElement('canvas');
    c.width = S.img.naturalWidth;
    c.height = S.img.naturalHeight;
    const x = c.getContext('2d');
    x.filter = `brightness(${S.bright}%) contrast(${S.contrast}%)${S.invert ? ' invert(1)' : ''}`;
    x.drawImage(S.img, 0, 0);
    S.filtered = c;
    draw();
  }

  function fit() {
    if (!S.case) return;
    const r = cv.getBoundingClientRect();
    const w = S.case.image.w, h = S.case.image.h;
    const s = Math.min(r.width / w, r.height / h) * 0.96;
    S.fitScale = s;
    S.view = { scale: s, tx: (r.width - w * s) / 2, ty: (r.height - h * s) / 2 };
    draw();
  }

  const toScreen = (x, y) => [S.view.tx + x * S.view.scale, S.view.ty + y * S.view.scale];
  const toImage = (sx, sy) => [(sx - S.view.tx) / S.view.scale, (sy - S.view.ty) / S.view.scale];

  function zoomAt(sx, sy, f) {
    const [ix, iy] = toImage(sx, sy);
    S.view.scale = clamp(S.view.scale * f, S.fitScale * 0.5, S.fitScale * 16);
    S.view.tx = sx - ix * S.view.scale;
    S.view.ty = sy - iy * S.view.scale;
    draw();
  }

  let anim = 0;
  function focusCurrent(animate = true) {
    if (!S.follow || !S.case || !S.img) return;
    const code = S.mode === 'anchors' ? null : S.cur;
    const v = code && S.case.landmarks[code];
    if (!v) return;
    const r = cv.getBoundingClientRect();
    const target = Math.max(S.view.scale, S.fitScale * 2.4);
    const goal = { scale: target, tx: r.width * 0.5 - v.x * target, ty: r.height * 0.45 - v.y * target };
    const [sx, sy] = toScreen(v.x, v.y);
    const inside = sx > r.width * 0.2 && sx < r.width * 0.8 && sy > r.height * 0.18 && sy < r.height * 0.8 && S.view.scale >= S.fitScale * 2.2;
    if (inside) return;
    if (!animate) { S.view = goal; draw(); return; }
    const from = { ...S.view };
    const t0 = performance.now();
    cancelAnimationFrame(anim);
    const stepA = (t) => {
      const k = Math.min(1, (t - t0) / 180);
      const e = 1 - Math.pow(1 - k, 3);
      S.view = { scale: from.scale + (goal.scale - from.scale) * e, tx: from.tx + (goal.tx - from.tx) * e, ty: from.ty + (goal.ty - from.ty) * e };
      draw();
      if (k < 1) anim = requestAnimationFrame(stepA);
    };
    anim = requestAnimationFrame(stepA);
  }

  function draw() {
    if (S.raf) return;
    S.raf = requestAnimationFrame(() => { S.raf = 0; paint(); });
  }

  function pointsForDraw() {
    if (!S.case) return {};
    const out = {};
    for (const [c, v] of Object.entries(S.case.landmarks || {})) out[c] = v;
    if (S.mode === 'anchors') for (const [c, v] of Object.entries(S.anchorPts)) out[c] = { x: v[0], y: v[1], by: 'doctor' };
    if (S.ptr && S.ptr.drag && S.ptr.moved) out[S.ptr.drag] = { ...out[S.ptr.drag], x: S.ptr.ix, y: S.ptr.iy, by: 'doctor' };
    return out;
  }

  function paintScene(c2, view, dpr, opts = {}) {
    const W = c2.canvas.width, H = c2.canvas.height;
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.fillStyle = '#0b1424';
    c2.fillRect(0, 0, W, H);
    if (!S.filtered) return;
    c2.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
    c2.imageSmoothingEnabled = true;
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(S.filtered, 0, 0);
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = pointsForDraw();
    const scr = (v) => [view.tx + v.x * view.scale, view.ty + v.y * view.scale];
    const K = opts.k || 1;                     // printing draws on a bigger canvas: thicker lines, bigger dots
    if (S.lines || opts.print) {
      c2.lineWidth = 1.3 * K;
      for (const l of S.defs.lines) {
        const a = P[l.a], b = P[l.b];
        if (!a || !b) continue;
        let [x1, y1] = scr(a), [x2, y2] = scr(b);
        if (LONG.has(l.name)) {
          const dx = x2 - x1, dy = y2 - y1;
          x1 -= dx * 0.12; y1 -= dy * 0.12; x2 += dx * 0.12; y2 += dy * 0.12;
        }
        c2.strokeStyle = LINE_COLORS[l.name] || '#FFFFFF';
        c2.globalAlpha = 0.8;
        c2.beginPath(); c2.moveTo(x1, y1); c2.lineTo(x2, y2); c2.stroke();
      }
      // Wits: A and B dropped onto the functional occlusal plane
      if (P.A && P.B && P.MOL && P.PM) {
        const [mx, my] = scr(P.MOL), [px, py] = scr(P.PM);
        const dx = px - mx, dy = py - my, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        c2.setLineDash([3 * K, 3 * K]);
        c2.strokeStyle = '#9DD9FF';
        for (const k of ['A', 'B']) {
          const [ax, ay] = scr(P[k]);
          const t = (ax - mx) * ux + (ay - my) * uy;
          c2.beginPath(); c2.moveTo(ax, ay); c2.lineTo(mx + ux * t, my + uy * t); c2.stroke();
        }
        c2.setLineDash([]);
      }
      c2.strokeStyle = GROUP_COLORS.cvm;
      for (const o of S.defs.outlines) {
        const pts = o.map((c) => P[c]).filter(Boolean);
        if (pts.length !== o.length) continue;
        c2.beginPath();
        pts.forEach((v, i) => { const [x, y] = scr(v); if (i) c2.lineTo(x, y); else c2.moveTo(x, y); });
        c2.stroke();
      }
      c2.globalAlpha = 1;
    }
    // points
    c2.font = `600 ${11 * K}px Montserrat, system-ui, sans-serif`;
    for (const code of S.order) {
      const v = P[code];
      if (!v) continue;
      const [x, y] = scr(v);
      const col = GROUP_COLORS[S.lm[code].group];
      const isCur = !opts.print && code === S.cur && S.mode !== 'anchors';
      const r = (isCur ? 5.5 : 4) * K;
      if (isCur) {
        c2.strokeStyle = 'rgba(255,255,255,.55)';
        c2.lineWidth = 1;
        c2.beginPath(); c2.moveTo(x - 22, y); c2.lineTo(x - 9, y); c2.moveTo(x + 9, y); c2.lineTo(x + 22, y);
        c2.moveTo(x, y - 22); c2.lineTo(x, y - 9); c2.moveTo(x, y + 9); c2.lineTo(x, y + 22); c2.stroke();
        c2.strokeStyle = '#FFFFFF';
        c2.lineWidth = 2;
        c2.beginPath(); c2.arc(x, y, 9, 0, Math.PI * 2); c2.stroke();
      }
      if (!opts.print && v.by === 'model' && v.conf != null && v.conf < 0.5) {
        c2.strokeStyle = '#F6AF24';
        c2.lineWidth = 2;
        c2.setLineDash([3, 2]);
        c2.beginPath(); c2.arc(x, y, 7.5, 0, Math.PI * 2); c2.stroke();
        c2.setLineDash([]);
      }
      c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2);
      if (v.by === 'doctor' || opts.print) { c2.fillStyle = col; c2.fill(); c2.lineWidth = 1.2 * K; c2.strokeStyle = '#0b1424'; c2.stroke(); }
      else { c2.lineWidth = 2; c2.strokeStyle = col; c2.stroke(); }
      if (S.labels || isCur || opts.print) {
        c2.lineWidth = 3 * K;
        c2.strokeStyle = 'rgba(11,20,36,.85)';
        c2.strokeText(code, x + 7 * K, y - 6 * K);
        c2.fillStyle = isCur ? '#FFFFFF' : col;
        c2.fillText(code, x + 7 * K, y - 6 * K);
      }
    }
    // ruler
    if (S.ruler.length && !opts.print) {
      c2.strokeStyle = '#64F4C9';
      c2.fillStyle = '#64F4C9';
      c2.lineWidth = 2;
      const pts = S.ruler.map((p) => scr({ x: p[0], y: p[1] }));
      if (pts.length === 1 && S.hover) pts.push(S.hover);
      c2.beginPath(); pts.forEach(([x, y], i) => (i ? c2.lineTo(x, y) : c2.moveTo(x, y))); c2.stroke();
      for (const [x, y] of pts) { c2.beginPath(); c2.arc(x, y, 3.5, 0, Math.PI * 2); c2.fill(); }
    }
  }

  function paint() { paintScene(ctx, S.view, S.dpr); }

  function hitPoint(sx, sy) {
    const P = pointsForDraw();
    let best = null, bd = 11;
    for (const [c, v] of Object.entries(P)) {
      const [x, y] = toScreen(v.x, v.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function wireViewer() {
    new ResizeObserver(() => { const keep = S.view; resizeCanvas(); if (S.case && S.img && S.view === keep && S.view.scale === S.fitScale) fit(); }).observe($('#viewer'));
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      if (!S.case || !S.img) return;
      cv.setPointerCapture(e.pointerId);
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const pan = e.button === 1 || e.button === 2 || S.space;
      const hit = !pan && S.mode !== 'anchors' && S.mode !== 'ruler' ? hitPoint(sx, sy) : null;
      const old = hit && S.case.landmarks[hit] ? { ...S.case.landmarks[hit] } : null;
      S.ptr = { id: e.pointerId, sx, sy, x0: S.view.tx, y0: S.view.ty, pan, drag: hit, old, moved: false, ix: 0, iy: 0 };
      if (pan) cv.classList.add('panning');
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const p = S.ptr;
      if (!p) {
        S.hover = [sx, sy];
        cv.classList.toggle('overpt', S.mode !== 'anchors' && S.mode !== 'ruler' && !!hitPoint(sx, sy));
        if (S.mode === 'ruler' && S.ruler.length === 1) draw();
        return;
      }
      const dist = Math.hypot(sx - p.sx, sy - p.sy);
      if (!p.moved && dist > 4) {
        p.moved = true;
        if (!p.drag && !p.pan) { p.pan = true; cv.classList.add('panning'); }
      }
      if (!p.moved) return;
      if (p.pan) {
        S.view.tx = p.x0 + (sx - p.sx);
        S.view.ty = p.y0 + (sy - p.sy);
        draw();
      } else if (p.drag) {
        [p.ix, p.iy] = toImage(sx, sy);
        draw();
      }
    });
    const end = (e) => {
      const p = S.ptr;
      if (!p) return;
      S.ptr = null;
      cv.classList.remove('panning');
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (p.pan && p.moved) return;
      if (p.drag && p.moved) {
        setPoint(p.drag, p.ix, p.iy, { old: p.old });
        selectPoint(p.drag);
        return;
      }
      if (e.type === 'pointercancel') return;
      // a click: while checking points it always places the current one (even on top of another point);
      // otherwise a click on a point picks it for a closer look
      if (p.drag && S.mode !== 'review') { selectPoint(p.drag); focusCurrent(); return; }
      const [ix, iy] = toImage(p.sx, p.sy);
      clickAt(ix, iy);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { S.hover = null; });
  }

  function clickAt(ix, iy) {
    if (ix < 0 || iy < 0 || ix > S.case.image.w || iy > S.case.image.h) return;
    if (S.mode === 'anchors') {
      const code = S.defs.anchors[S.anchorIdx];
      S.anchorPts[code] = [ix, iy];
      S.anchorIdx++;
      if (S.anchorIdx >= S.defs.anchors.length) placeFromAnchors();
      else { renderTrace(); draw(); }
    } else if (S.mode === 'review' && S.cur) {
      setPoint(S.cur, ix, iy, { advance: true });
    } else if (S.mode === 'ruler') {
      S.ruler.push([ix, iy]);
      draw();
      if (S.ruler.length === 2) finishRuler();
    }
  }

  // ------------------------------------------------------------------ calibration with a ruler
  function startRuler() {
    if (!S.case) return;
    if (S.mode === 'ruler') { endRuler(); return; }
    S.prevMode = S.mode;
    S.mode = 'ruler';
    S.ruler = [];
    $('#tRuler').classList.add('on');
    setHint('Click the two ends of a known length - e.g. <b>10 mm</b> on the nasion-rod ruler');
  }

  function endRuler() {
    S.mode = S.prevMode || 'idle';
    S.ruler = [];
    S.hover = null;
    $('#tRuler').classList.remove('on');
    renderTrace();
    draw();
  }

  async function finishRuler() {
    const [a, b] = S.ruler;
    const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = $('#dlgCal');
    $('#calInfo').textContent = `${px.toFixed(1)} pixels between the two clicks.`;
    $('#calDefault').checked = S.case.source && S.case.source.format !== 'dicom';
    d.returnValue = '';
    d.showModal();
    $('#calMm').select();
    await new Promise((res) => d.addEventListener('close', res, { once: true }));
    if (d.returnValue === 'ok') {
      const mm = parseFloat($('#calMm').value);
      if (mm > 0 && px > 5) {
        const mmpx = mm / px;
        try {
          const r = await api(`/api/cases/${enc(S.case.id)}`, { method: 'PATCH', body: { calibration: { mm_per_px: mmpx, source: `ruler on this x-ray: ${mm} mm over ${px.toFixed(1)} px` } } });
          applyServer(r, false);
          if ($('#calDefault').checked) {
            await api('/api/settings', { method: 'PUT', body: { calibration: { default_mm_per_px: mmpx } } });
            toast(`Calibrated: ${mmpx.toFixed(4)} mm per pixel - also the default for exported x-rays.`);
          } else toast(`Calibrated: ${mmpx.toFixed(4)} mm per pixel.`);
        } catch (e) { toast(e.message, true); }
      }
    }
    endRuler();
  }

  // ------------------------------------------------------------------ details, confirm, delete, print
  async function openDetails(isNew = false) {
    const d = $('#dlgDetails');
    const c = S.case;
    const p = c.patient || {};
    $('#detailsTitle').textContent = isNew ? 'New x-ray - check the details' : 'X-ray details';
    $('#detailsSave').textContent = isNew ? 'Start tracing' : 'Save';
    $('#detailsThumb').src = `/api/cases/${enc(c.id)}/thumb`;
    $('#dName').value = p.name || '';
    $('#dTaken').value = c.taken || '';
    $('#dChart').value = p.chart || '';
    $('#dDob').value = p.dob || '';
    $('#dSex').value = p.sex || '';
    const cal = c.calibration || {};
    $('#dCal').innerHTML = cal.mm_per_px
      ? `${(+cal.mm_per_px).toFixed(4)} mm per pixel - ${esc(cal.source || '')}`
      : 'Not known for this file: angles and ratios work; for millimetre measurements use <b>Ruler</b> on the x-ray once (it can become the default for exported x-rays).';
    d.returnValue = '';
    d.showModal();
    if (!p.name) $('#dName').focus();
    await new Promise((res) => d.addEventListener('close', res, { once: true }));
    if (d.returnValue !== 'save') return;
    try {
      const r = await api(`/api/cases/${enc(c.id)}`, {
        method: 'PATCH',
        body: { patient: { name: $('#dName').value, chart: $('#dChart').value, dob: $('#dDob').value || null, sex: $('#dSex').value || null }, taken: $('#dTaken').value || null, details_confirmed: true },
      });
      applyServer(r, false);
      await refreshCases();
    } catch (e) { toast(e.message, true); }
  }

  async function confirmTracing() {
    await flushSave();
    const lm = S.case.landmarks || {};
    const unchecked = required().filter((c) => lm[c] && lm[c].by !== 'doctor');
    if (unchecked.length && !await ask('Confirm the tracing?',
      `${unchecked.length} point${unchecked.length > 1 ? 's were' : ' was'} not checked one by one (${unchecked.slice(0, 8).join(', ')}${unchecked.length > 8 ? '…' : ''}). Confirming files every point as right, and the app learns from it.`,
      'Confirm anyway')) return;
    try {
      const r = await api(`/api/cases/${enc(S.case.id)}`, { method: 'PATCH', body: { status: 'confirmed' } });
      applyServer(r, true);
      S.mode = 'done';
      S.cur = null;
      renderAll(); draw();
      fit();
      toast('Confirmed. This tracing is now a lesson for the app.');
      refreshCases();
      refreshStatus();
    } catch (e) { toast(e.message, true); }
  }

  async function reopen() {
    try {
      const r = await api(`/api/cases/${enc(S.case.id)}`, { method: 'PATCH', body: { status: 'reopen' } });
      applyServer(r, true);
      startTracing();
      if (S.mode === 'done') {          // every point was checked: walk through them all again, in order
        S.walkAll = true;
        S.mode = 'review';
        S.cur = required()[0];
        renderTrace(); draw(); focusCurrent();
      }
      refreshCases();
    } catch (e) { toast(e.message, true); }
  }

  async function deleteCase() {
    if (!await ask('Delete this x-ray?', `${(S.case.patient || {}).name || 'This x-ray'} - the image and its tracing go to the app's deleted folder (cases\\_deleted on this PC).`, 'Delete')) return;
    try {
      await api(`/api/cases/${enc(S.case.id)}`, { method: 'DELETE' });
      S.pending = {};
      showWelcome();
      await refreshCases();
      refreshStatus();
    } catch (e) { toast(e.message, true); }
  }

  async function printReport() {
    await flushSave();
    const c = S.case, a = S.analysis, p = c.patient || {};
    // the tracing, drawn at print resolution
    const w = c.image.w, h = c.image.h;
    const scale = Math.min(1400 / w, 1700 / h);
    const off = document.createElement('canvas');
    off.width = Math.round(w * scale);
    off.height = Math.round(h * scale);
    paintScene(off.getContext('2d'), { scale, tx: 0, ty: 0 }, 1, { print: true, k: Math.max(1, off.width / 650) });
    const img = off.toDataURL('image/jpeg', 0.9);
    const sum = a.summary.map((s) => `<div class="sitem ${esc(s.level)}"><div class="t">${esc(s.title)}</div><div class="c">${esc(s.call)}</div><div class="d">${esc(s.detail)}</div></div>`).join('');
    const doc = (c.cvm || {}).doctor;
    const row = (m) => `<tr><td>${esc(m.label)}</td><td class="v">${esc(fmtVal(m))}</td><td class="nm">${m.norm ? `${m.norm.mean}±${m.norm.sd}` : ''}</td></tr>`;
    const have = a.measurements.filter((m) => m.value != null);
    const side = (m) => m.group === 'Lengths' || m.group === 'Soft tissue';
    const rows = have.filter((m) => !side(m)).map(row).join('');
    const lengths = have.filter(side).map(row).join('');
    $('#printArea').innerHTML = `
      <div class="phead"><div><h1>Cephalometric analysis</h1><div class="pmeta">${esc(p.name || '')}${p.chart ? ' · #' + esc(p.chart) : ''}</div></div>
        <div class="pmeta" style="text-align:right">${c.taken ? `X-ray ${esc(fmtDate(c.taken))}` : 'X-ray date not set'}${a.age != null ? ` · age ${a.age}` : ''}${p.sex ? ' · ' + (p.sex === 'F' ? 'female' : 'male') : ''}<br>${c.status === 'confirmed' ? 'Tracing confirmed' : 'Tracing NOT confirmed'} · printed ${esc(fmtDate(new Date().toISOString().slice(0, 10)))}</div></div>
      <div class="pgrid"><div><img class="trace" src="${img}" alt=""><table class="mt" style="margin-top:8px">${rows}</table></div>
        <div><div class="sum">${sum}</div>${doc && a.cvm && doc !== a.cvm.stage ? `<p class="pmeta" style="margin-top:6px">CVM: doctor's call ${esc(doc)} (traced reading ${esc(a.cvm.stage || '-')})</p>` : ''}
        ${lengths ? `<table class="mt" style="margin-top:10px">${lengths}</table>` : ''}</div></div>
      <div class="pfoot">Next Level Orthodontics · NLO X-Ray Reader · ${esc(calText() || 'not calibrated: millimetre values omitted')}. A tracing aid - the clinical judgement is the doctor's.</div>`;
    setTimeout(() => window.print(), 60);
  }

  // ------------------------------------------------------------------ settings & learning
  async function openSettings(tab) {
    S.setTab = tab || S.setTab || 'learn';
    try { S.settings = await api('/api/settings'); } catch (e) { toast(e.message, true); return; }
    $('#dlgSettings').showModal();
    renderSettings();
  }

  let learnPoll = 0;
  async function renderSettings() {
    for (const b of $$('#setTabs button')) b.classList.toggle('on', b.dataset.tab === S.setTab);
    const body = $('#setBody'), foot = $('#setFoot');
    clearInterval(learnPoll);
    foot.innerHTML = '';
    const s = S.settings;
    if (S.setTab === 'learn') {
      let st;
      try { st = await api('/api/model'); } catch (e) { body.innerHTML = esc(e.message); return; }
      const m = st.model;
      const worst = m && m.per_landmark ? Object.entries(m.per_landmark).sort((x, y) => y[1] - x[1]) : [];
      const prog = st.progress || {};
      body.innerHTML = `
        <div class="statBig"><div><b>${st.confirmed}</b><span>confirmed tracings</span></div>
          <div><b>${m ? 'v' + esc(m.version) : '-'}</b><span>${m ? 'network in use' : `starts at ${st.min_cases}`}</span></div>
          <div><b>${m && m.mre != null ? m.mre + ' mm' : '-'}</b><span>average error, unseen x-rays</span></div>
          <div><b>${m && m.sdr2 != null ? m.sdr2 + '%' : '-'}</b><span>points within 2 mm</span></div></div>
        ${st.running ? `<p><b>Learning now:</b> step ${prog.step || 0} of ${prog.steps || '?'}${prog.val_mre != null ? ` · held-out error ${prog.val_mre} mm` : ''}</p>` : ''}
        <p>${esc(st.message || (st.outcome ? '' : 'No learning round has run yet.'))}</p>
        ${m ? `<p class="hint">Trained ${esc(fmtDate((m.trained || '').slice(0, 10)))} on ${m.n_train} x-rays, checked on ${m.n_val} it had not seen. The app only switches to a new network when it does better on those.</p>` : `<p class="hint">After ${st.min_cases} confirmed tracings the app trains a network on this PC; until then the points start from your average tracing.</p>`}
        ${worst.length ? `<label class="f">Average error by point (unseen x-rays)</label><div class="lmErr">${worst.map(([c, e]) => `<span class="${e > 2.5 ? 'bad' : ''}">${esc(c)} ${e} mm</span>`).join('')}</div>` : ''}
        <label class="f">When it learns</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:12.5px"><input type="checkbox" id="lNightly" ${s.learning.nightly !== false ? 'checked' : ''}> Every evening when there are new confirmed tracings and nobody is using the app</label>
        <div class="row3"><div><label class="f" for="lStart">From (hour)</label><input class="in" id="lStart" type="number" min="0" max="23" value="${s.learning.window_start}"></div>
          <div><label class="f" for="lEnd">Until (hour)</label><input class="in" id="lEnd" type="number" min="0" max="23" value="${s.learning.window_end}"></div>
          <div><label class="f" for="lBudget">Up to (minutes)</label><input class="in" id="lBudget" type="number" min="5" max="600" value="${s.learning.budget_min}"></div></div>
        <p class="hint">Default 7 pm - 1 am so it never overlaps Tray Maker's 1-5 am round on the same PC. It uses half the processor at low priority.</p>
        <label class="f">Log</label><pre class="log">${esc(st.log_tail || '(empty)')}</pre>`;
      foot.innerHTML = `${(st.previous || []).length ? '<button class="small" id="lBack" type="button">Go back to the previous network</button>' : ''}
        ${st.running ? '<button class="small danger" id="lStop" type="button">Stop learning</button>' : `<button class="small" id="lNow" type="button" ${st.confirmed < 1 ? 'disabled' : ''}>Learn now</button>`}
        <button class="primary" id="lSave" type="button">Save</button>`;
      const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
      on('#lSave', async () => {
        await saveSettings({ learning: { nightly: $('#lNightly').checked, window_start: +$('#lStart').value, window_end: +$('#lEnd').value, budget_min: +$('#lBudget').value } });
      });
      on('#lNow', async () => { await api('/api/model/train', { method: 'POST' }); toast('Learning started. It keeps going if you close this.'); setTimeout(renderSettings, 800); refreshStatus(); });
      on('#lStop', async () => { await api('/api/model/stop', { method: 'POST' }); toast('Stopping…'); setTimeout(renderSettings, 1500); });
      on('#lBack', async () => {
        if (!await ask('Go back?', 'The app goes back to the network it used before the current one.', 'Go back')) return;
        try { await api('/api/model/rollback', { method: 'POST' }); toast('Back to the previous network.'); refreshStatus(); renderSettings(); } catch (e) { toast(e.message, true); }
      });
      if (st.running) learnPoll = setInterval(() => { if ($('#dlgSettings').open && S.setTab === 'learn') renderSettings(); else clearInterval(learnPoll); }, 4000);
    } else if (S.setTab === 'norms') {
      const dn = S.defs.default_norms, mine = s.norms || {};
      const label = (k) => ({ Wits_M: 'Wits (male)', Wits_F: 'Wits (female)', Wits_U: 'Wits (sex not given)' }[k] || (S.defs.measures.find((m) => m.key === k) || {}).label || k);
      const unit = (k) => (k.startsWith('Wits') ? 'mm' : (S.defs.measures.find((m) => m.key === k) || {}).unit || '');
      const rows = Object.keys(dn).map((k) => {
        const v = mine[k] || dn[k];
        return `<tr><td>${esc(label(k))}</td><td>${esc(unit(k))}</td><td><input data-k="${k}" data-f="mean" value="${v.mean}" type="number" step="0.1"></td><td><input data-k="${k}" data-f="sd" value="${v.sd}" type="number" step="0.1" min="0.1"></td><td class="hint">${dn[k].mean} ± ${dn[k].sd}</td></tr>`;
      }).join('');
      const dc = S.defs.default_cutoffs, cu = { ...dc, ...(s.cutoffs || {}) };
      const cut = (k, l) => `<div><label class="f" for="cu_${k}">${l}</label><input class="in" id="cu_${k}" data-cut="${k}" type="number" step="0.5" value="${cu[k]}"></div>`;
      body.innerHTML = `<p class="hint">Mean ± one standard deviation for each measurement. Values more than 1 SD off show amber, more than 2 SD coral.</p>
        <table class="norms"><tr><th>Measurement</th><th></th><th>Mean</th><th>SD</th><th>Default</th></tr>${rows}</table>
        <label class="f" style="margin-top:18px">Calls in the summary</label>
        <div class="row2">${cut('anb_class2_above', 'Class II when ANB is above (°)')}${cut('anb_class3_below', 'Class III when ANB is below (°)')}</div>
        <div class="row2">${cut('wits_band', 'Wits: Class II/III this far from its norm (mm)')}<div></div></div>
        <div class="row2">${cut('fma_low_below', 'Low angle when FMA is below (°)')}${cut('fma_high_above', 'High angle when FMA is above (°)')}</div>
        <div class="row2">${cut('sngogn_low_below', 'Low angle when SN-GoGn is below (°)')}${cut('sngogn_high_above', 'High angle when SN-GoGn is above (°)')}</div>`;
      foot.innerHTML = '<button class="small" id="nReset" type="button">Back to defaults</button><button class="primary" id="nSave" type="button">Save</button>';
      $('#nReset').onclick = async () => { await saveSettings({ norms: {}, cutoffs: {} }); renderSettings(); };
      $('#nSave').onclick = async () => {
        const norms = {};
        for (const i of $$('#setBody input[data-k]')) {
          norms[i.dataset.k] = norms[i.dataset.k] || {};
          norms[i.dataset.k][i.dataset.f] = parseFloat(i.value);
        }
        const changed = {};
        for (const [k, v] of Object.entries(norms)) if (v.mean !== dn[k].mean || v.sd !== dn[k].sd) changed[k] = v;
        const cutoffs = {};
        for (const i of $$('#setBody input[data-cut]')) if (parseFloat(i.value) !== dc[i.dataset.cut]) cutoffs[i.dataset.cut] = parseFloat(i.value);
        await saveSettings({ norms: changed, cutoffs });
      };
    } else if (S.setTab === 'cvm') {
      const c = s.cvm || {}, dt = S.defs.default_cvm, th = { ...dt, ...(c.thresholds || {}) };
      const tuned = c.tuned;
      const f = (k, l, step) => `<div><label class="f" for="cv_${k}">${l}</label><input class="in" id="cv_${k}" data-th="${k}" type="number" step="${step}" value="${th[k]}"><p class="hint">default ${dt[k]}</p></div>`;
      body.innerHTML = `<p>The stage follows Baccetti, Franchi &amp; McNamara (2005): which lower borders of C2-C4 are concave, and the shape of the C3 and C4 bodies. Two measured judgements decide it, each with a threshold:</p>
        <label class="f">Thresholds in use</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0"><input type="radio" name="cvmMode" value="auto" ${c.mode !== 'manual' && c.mode !== 'defaults' ? 'checked' : ''}> Tuned to my own CVM calls (once there are 8, and only if it agrees with me more often than the defaults)</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0"><input type="radio" name="cvmMode" value="defaults" ${c.mode === 'defaults' ? 'checked' : ''}> The defaults</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0"><input type="radio" name="cvmMode" value="manual" ${c.mode === 'manual' ? 'checked' : ''}> The values below</label>
        <p class="hint">${tuned ? esc(tuned.message || '') : 'Not tuned yet - your calls are collected as you confirm tracings.'}</p>
        <div class="row2">${f('concavity_pct', 'Concave when the border dips at least (% of its length)', 0.5)}${f('trapezoid_ratio', 'Trapezoid when front height / back height is below', 0.01)}</div>
        <div class="row2">${f('square_low', 'Square from height / width', 0.01)}${f('square_high', '... to (above: rectangular vertical)', 0.01)}</div>`;
      foot.innerHTML = '<button class="primary" id="cvSave" type="button">Save</button>';
      $('#cvSave').onclick = async () => {
        const mode = ($('input[name=cvmMode]:checked') || {}).value || 'auto';
        const thresholds = {};
        for (const i of $$('#setBody input[data-th]')) thresholds[i.dataset.th] = parseFloat(i.value);
        await saveSettings({ cvm: { mode, thresholds } });
        if (S.case) { const r = await api(`/api/cases/${enc(S.case.id)}`); applyServer(r, false); }
      };
    } else if (S.setTab === 'cal') {
      const c = s.calibration || {};
      body.innerHTML = `<p>Millimetre measurements (Wits, incisor to NA/NB, lips to the E-line, lengths) need the size of a pixel at the patient's midline. Angles and ratios do not.</p>
        <div class="row2"><div><label class="f" for="caDef">Pixel size for exported x-rays (mm)</label><input class="in" id="caDef" type="number" step="0.0001" value="${c.default_mm_per_px ?? ''}" placeholder="not set"><p class="hint">Used for JPG / PNG / TIFF files, which carry no pixel size. Easiest: on one x-ray click <b>Ruler</b>, mark 10 mm on the nasion-rod ruler and tick "use for every exported x-ray". Export the same way every time.</p></div>
        <div><label class="f" for="caMag">Ceph magnification</label><input class="in" id="caMag" type="number" step="0.001" min="1" max="1.5" value="${c.magnification ?? 1.13}"><p class="hint">For DICOM files that give the pixel size at the detector only. 1.13 is Carestream's figure for the CS 8200 ceph arm. Files that say their own magnification use that.</p></div></div>`;
      foot.innerHTML = '<button class="primary" id="caSave" type="button">Save</button>';
      $('#caSave').onclick = () => saveSettings({ calibration: { default_mm_per_px: $('#caDef').value === '' ? null : parseFloat($('#caDef').value), magnification: parseFloat($('#caMag').value) } });
    } else if (S.setTab === 'access') {
      body.innerHTML = `<p>${s.passcode ? '<b>A passcode is set.</b> Each computer types it once (remembered 30 days).' : 'No passcode: any computer on the office network can open the app.'}</p>
        <p class="hint">Worth setting if patients or guests can join the same Wi-Fi as the office computers. Changing it signs every other computer out.</p>
        <label class="f" for="pcNew">${s.passcode ? 'New passcode' : 'Passcode'}</label><input class="in" id="pcNew" type="password" autocomplete="new-password">`;
      foot.innerHTML = `${s.passcode ? '<button class="small danger" id="pcOff" type="button">Remove passcode</button>' : ''}<button class="primary" id="pcSet" type="button">Set passcode</button>`;
      $('#pcSet').onclick = async () => {
        const v = $('#pcNew').value.trim();
        if (v.length < 4) return toast('Use at least 4 characters.', true);
        await api('/api/settings/passcode', { method: 'POST', body: { code: v } });
        S.settings = await api('/api/settings'); toast('Passcode set.'); renderSettings();
      };
      const off = $('#pcOff');
      if (off) off.onclick = async () => { await api('/api/settings/passcode', { method: 'POST', body: { code: '' } }); S.settings = await api('/api/settings'); toast('Passcode removed.'); renderSettings(); };
    } else {
      body.innerHTML = `<p><b>Everything stays on this PC.</b></p>
        <ul style="margin:8px 0 0 18px;line-height:1.7;font-size:13px">
          <li>The x-rays, tracings and notes are kept in the app folder (<code>cases\\</code>), the trained network in <code>models\\</code>. Nothing is uploaded or synced anywhere.</li>
          <li>The app makes no internet connections. The page carries a security policy that stops the browser from loading or sending anything outside this app - fonts and pictures included.</li>
          <li>The network is trained here, from scratch, only on tracings confirmed in this office. No outside data or pre-trained models are used.</li>
          <li>It is reachable from computers on the office network only (it has no address on the internet). The optional passcode keeps it to staff computers.</li>
          <li>The only time the app's PC talks to the internet for it is when someone runs the update, which downloads the app's program files from GitHub. No patient data goes the other way.</li>
          <li>Deleted x-rays go to <code>cases\\_deleted\\</code>; remove them there for good.</li>
        </ul>`;
    }
  }

  async function saveSettings(patch) {
    try { S.settings = await api('/api/settings', { method: 'PUT', body: patch }); toast('Saved.'); } catch (e) { toast(e.message, true); return; }
    if (S.case) { try { const r = await api(`/api/cases/${enc(S.case.id)}`); applyServer(r, false); } catch (e) { /* ignore */ } }
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    wireViewer();
    resizeCanvas();
    $('#fileIn').onchange = (e) => { importFiles(e.target.files); e.target.value = ''; };
    $('#dropZone').onclick = () => $('#fileIn').click();
    $('#dropZone').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') $('#fileIn').click(); };
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });
    let qTimer = 0;
    $('#search').oninput = (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; renderCases(); }, 120); };
    $('#caseList').onclick = (e) => { const b = e.target.closest('.case'); if (b) openCase(b.dataset.id).catch((err) => toast(err.message, true)); };
    $('#openSettings').onclick = () => openSettings();
    $('#setClose').onclick = () => $('#dlgSettings').close();
    $('#setTabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) { S.setTab = b.dataset.tab; renderSettings(); } };
    $('#detailsBtn').onclick = () => openDetails(false);
    $('#confirmBtn').onclick = confirmTracing;
    $('#reopenBtn').onclick = reopen;
    $('#deleteBtn').onclick = deleteCase;
    $('#printBtn').onclick = printReport;
    $('#tFit').onclick = fit;
    $('#tIn').onclick = () => { const r = cv.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); };
    $('#tOut').onclick = () => { const r = cv.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); };
    $('#tBright').oninput = (e) => { S.bright = +e.target.value; rebuildFiltered(); };
    $('#tContrast').oninput = (e) => { S.contrast = +e.target.value; rebuildFiltered(); };
    $('#tInvert').onclick = (e) => { S.invert = !S.invert; e.currentTarget.classList.toggle('on', S.invert); rebuildFiltered(); };
    $('#tLabels').onclick = (e) => { S.labels = !S.labels; e.currentTarget.classList.toggle('on', S.labels); draw(); };
    $('#tLines').onclick = (e) => { S.lines = !S.lines; e.currentTarget.classList.toggle('on', S.lines); draw(); };
    $('#tFollow').onclick = (e) => { S.follow = !S.follow; e.currentTarget.classList.toggle('on', S.follow); if (S.follow) focusCurrent(); };
    $('#tRuler').onclick = startRuler;
    for (const h of $$('.fold')) h.onclick = () => $('#' + h.dataset.fold).classList.toggle('closed');
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') S.space = false; });
    window.addEventListener('pagehide', () => {
      if (S.case && Object.keys(S.pending).length) {
        fetch(`/api/cases/${enc(S.case.id)}`, { method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ landmarks: S.pending }) });
      }
    });
  }

  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (!S.case || $('#caseView').hidden) return;
    const k = e.key;
    if (e.code === 'Space' && !S.space) { S.space = true; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'Enter') { e.preventDefault(); acceptCurrent(); }
    else if (k === 'Backspace') { e.preventDefault(); goBack(); }
    else if (k === 'Escape') { if (S.mode === 'ruler') endRuler(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
    } else if (k === 'f' || k === 'F') fit();
    else if (k === '+' || k === '=') { const r = cv.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); }
    else if (k === '-' || k === '_') { const r = cv.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); }
    else if (k === 'l' || k === 'L') $('#tLabels').click();
    else if (k === 't' || k === 'T') $('#tLines').click();
    else if (k === 'i' || k === 'I') $('#tInvert').click();
  }

  if (/[?&]debug\b/.test(location.search)) window.__xr = { S, toScreen, toImage };   // for the app's own browser tests
  boot().catch((e) => toast('Could not start: ' + e.message, true, 10000));
})();
