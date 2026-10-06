/* =====================================================================
   Duplicates (Amir, 6 Oct 2026: "how do we prevent double entries for the same case? Also can the names fill up as you type the
   name. you know like a search during the entry with photos so if the pt is already in there you can just select them? Also if
   there is a double created accidently. How can it be removed or archived?")
   - New case: the patient's name looks itself up as it's typed — the patients already in the app whose name (or chart #) starts
     that way, with their photo and their cases. Picking one fills in the name and chart # exactly as on file (the photo follows,
     photos.js), and under the name the patient's open cases are listed, each with Open.
   - The same patient with an open case of the same kind (dupLike: same type, and for appliances, retainers and aligner sets the same
     thing being made) is said under the name in amber, and Create case asks first: Open that case, or Create a second case anyway
     (which then isn't flagged).
   - Doubles already in: "Possible duplicate" on the lists, the board and in the case panel (Open the other / Remove this one / Not a
     duplicate), and a Possible duplicates filter on All open cases.
   - Remove duplicate (anyone, from the case panel): pick the case to keep; this one's comments and Notes are copied onto it. The
     duplicate is closed with `dup` on it — nothing is deleted. It drops out of every list, Completed, the patient's history (so it
     doesn't count as a refinement), the Workload page and the patient index. Undo right after; Dr. A can bring it back from
     Team & security → Removed duplicates.
   Who/when is in the case's history like every other change.
   ===================================================================== */

/* ---------- the same case twice? ---------- */
/* a and b look like the same case entered twice: the same patient (chart # when both have one, else the name) and the same type —
   and, where both say, the same lab, an appliance in common, retainer kinds and arches in common, the same kind of aligner
   submission (first set / refinement / mid-course / finishing — not the refinement's number: a set entered twice gets the next
   number the second time, and a set is normally completed before the next one is made), and both a remake or neither. A pair marked
   "Not a duplicate" (notDup, on either case) never is. `a` may be the New case form (no id). */
function dupLike(a, b) {
  if (!a || !b || a === b || (a.id && a.id === b.id) || a.locked || b.locked || a.dup || b.dup) return false;
  if (!a.type || a.type !== b.type || !samePatient(a, b)) return false;
  const la = labName(a.lab), lb = labName(b.lab); if (la && lb && la !== lb) return false;
  for (const k of ['appliances', 'retKinds', 'arches']) {
    const x = Array.isArray(a[k]) ? a[k] : [], y = Array.isArray(b[k]) ? b[k] : [];
    if (x.length && y.length && !x.some(v => y.includes(v))) return false;
  }
  const differ = k => !!a[k] && !!b[k] && String(a[k]) !== String(b[k]);
  if (differ('initial') || (a.variant || '') !== (b.variant || '') || (a.remake || '') !== (b.remake || '')) return false;
  if (a.id && b.id && ((a.notDup || []).includes(b.id) || (b.notDup || []).includes(a.id))) return false;
  return true;
}
/* the open cases a New case form would duplicate, oldest first */
function dupCands(o) { return openCases().filter(c => dupLike(o, c)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }
/* open case id → the other open cases that look like the same case (worked out once per change to the open cases) */
const DUPS = { cases: null, v: -1, map: new Map() };
function dupReset() { DUPS.cases = null; DUPS.v = -1; DUPS.map = new Map(); S.dupList = null; } // (on Lock)
function dupMap() {
  if (DUPS.cases === S.cases && DUPS.v === S.casesV) return DUPS.map;
  const m = new Map(), groups = new Map();
  const put = (k, c) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); };
  // only cases sharing a name or a chart # can be the same patient, so only those are compared
  openCases().forEach(c => { const n = normName(c.patient), ch = normChart(c.chart); if (n) put('n:' + n, c); if (ch) put('c:' + ch, c); });
  groups.forEach(g => {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = g[i], b = g[j]; if (!dupLike(a, b)) continue;
      [[a, b], [b, a]].forEach(([x, y]) => { const l = m.get(x.id) || []; if (!l.includes(y)) l.push(y); m.set(x.id, l); });
    }
  });
  m.forEach(l => l.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
  DUPS.cases = S.cases; DUPS.v = S.casesV; DUPS.map = m; return m;
}
function dupsOf(c) { return c && c.id && c.status !== 'done' && !c.locked ? dupMap().get(c.id) || [] : []; }
/* "entered Oct 3, 2:10 PM by Gwen" */
function enteredText(c) { const by = c.createdBy ? firstName(staffName(c.createdBy, '')) : ''; return c.createdAt ? 'entered ' + fmtWhen(c.createdAt) + (by ? ' by ' + by : '') : by ? 'entered by ' + by : ''; }
/* "U/L TT's · Printing · entered Oct 3, 2:10 PM by Gwen" — or "… · completed Sep 12" */
function caseLine(c) {
  return [c.detail || '', c.status === 'done' ? 'completed' + (c.closedAt ? ' ' + fmtDate(isoOf(new Date(c.closedAt))) : '') : stageLabel(c), enteredText(c)].filter(Boolean).join(' · ');
}
function dupFlag(c) {
  const d = dupsOf(c); if (!d.length) return '';
  return '<span class="flag dupF" title="' + esc('Looks like the same case as ' + d.map(o => ptNameText(o.patient) + '’s ' + typeOf(o).l + ' case, ' + caseLine(o)).join('; ') + ' — open it to sort it out') + '">' + ic('copy', 13) + 'Possible duplicate</span>';
}
/* the case panel: which other case(s) it looks like, and what to do about it */
function dupNoticeHTML(c) {
  const d = dupsOf(c); if (!d.length) return '';
  return '<div class="notice dupN" role="note">' + ic('copy', 18) + '<div class="dupNB"><div><b>Possible duplicate</b> — ' + ptName(c.patient) + ' has ' + (d.length > 1 ? d.length + ' other open ' : 'another open ') + esc(typeOf(c).l) + ' case' + (d.length > 1 ? 's' : '') + ':</div>' +
    d.map(o => '<div class="dupNR"><span>' + esc(caseLine(o)) + '</span><button type="button" class="linkBtn" data-act="open" data-id="' + esc(o.id) + '">Open it</button></div>').join('') +
    '<div class="dupNBtns"><button type="button" class="btn btn-sec btn-sm" data-act="dupRemove">Remove this one</button><button type="button" class="btn btn-ghost btn-sm" data-act="notDup">Not a duplicate</button></div></div></div>';
}

/* ---------- the patients already in the app (New case: as the name is typed) ---------- */
function ptWords(s) { return normName(s).split(/[\s\-–—'’.,()]+/).filter(Boolean); }
/* every patient the app can see — open cases, and the completed ones it has read (the patient's whole history comes in once their
   name or chart # is typed in full: photos.js asks for it) — one entry per name, spelled as on their latest case */
function ptDirectory() {
  const by = new Map(), seen = new Set();
  const pool = casePool().concat((S.mailClosed && S.mailClosed.list) || [], (typeof WK !== 'undefined' && WK.closed) || []);
  pool.forEach(c => {
    if (!c || !c.id || seen.has(c.id) || c.locked || c.dup) return; seen.add(c.id);
    const nm = String(c.patient || '').trim().replace(/\s+/g, ' '), k = normName(nm); if (!k) return;
    let p = by.get(k); if (!p) by.set(k, p = { k, name: nm, chart: '', cases: [], at: -1 });
    p.cases.push(c);
    const t = c.updatedAt || c.createdAt || 0, ch = String(c.chart || '').trim();
    if (t >= p.at) { p.at = t; p.name = nm; if (ch) p.chart = ch; } else if (!p.chart && ch) p.chart = ch;
  });
  return Array.from(by.values());
}
/* how well a patient matches what's typed: every word typed starts a word of their name (exact name 4, name starts so 3, else 2),
   or it starts their chart # (1); 0 = no */
function ptScore(p, q) {
  const toks = ptWords(q); if (!toks.length) return 0;
  const words = ptWords(p.name), nq = normName(q), np = normName(p.name);
  if (toks.every(t => words.some(w => w.startsWith(t)))) return np === nq ? 4 : np.startsWith(nq) ? 3 : 2;
  const qc = normChart(q); if (qc.length >= 3 && /\d/.test(qc) && p.cases.some(c => normChart(c.chart).startsWith(qc))) return 1;
  return 0;
}
function ptSearch(q, max) {
  if (normName(q).length < 2) return [];
  return ptDirectory().map(p => ({ p, s: ptScore(p, q), open: p.cases.some(c => c.status !== 'done') ? 1 : 0 })).filter(x => x.s)
    .sort((a, b) => b.s - a.s || b.open - a.open || b.p.at - a.p.at).slice(0, max || 5).map(x => x.p);
}
/* the typed letters in bold */
function ptHl(name, q) {
  const toks = ptWords(q);
  return String(name).split(/(\s+)/).map(part => {
    if (!part || /^\s+$/.test(part)) return esc(part);
    const lw = part.toLowerCase(), t = toks.filter(x => lw.startsWith(x)).sort((a, b) => b.length - a.length)[0];
    return t ? '<b>' + esc(part.slice(0, t.length)) + '</b>' + esc(part.slice(t.length)) : esc(part);
  }).join('');
}
const byMade = (a, b) => (a.createdAt || 0) - (b.createdAt || 0), byClosed = (a, b) => (b.closedAt || 0) - (a.closedAt || 0);
function ptDoneText(done) {
  if (!done.length) return '';
  const d = done[0];
  return 'last case ' + typeOf(d).l + (d.closedAt ? ', completed ' + fmtDate(isoOf(new Date(d.closedAt))) : '') + (done.length > 1 ? ' (' + done.length + ' completed)' : '');
}
/* one line about a patient in the list: their open cases (kind and step), else their last completed case */
function ptSumText(p) {
  const open = p.cases.filter(c => c.status !== 'done').sort(byMade), done = p.cases.filter(c => c.status === 'done').sort(byClosed);
  const parts = [];
  if (open.length) parts.push((open.length === 1 ? 'Open: ' : open.length + ' open: ') + open.slice(0, 2).map(c => typeOf(c).l + ' (' + stageLabel(c) + ')').join(', ') + (open.length > 2 ? ', …' : ''));
  if (done.length) parts.push(open.length ? done.length + ' completed' : ptDoneText(done).replace(/^last case /, 'Completed: '));
  return parts.join(' · ');
}
function ptPhotoCase(p) { return p.cases.filter(c => c.photo).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || p.cases[0]; }
function ptListHTML(items, q, active) {
  return '<div class="ptfHd">Already in the app — pick the patient' + (items.length > 1 ? '' : ' if it’s them') + '</div>' +
    items.map((p, i) => '<div class="ptOpt' + (i === active ? ' on' : '') + '" role="option" id="cf-pto' + i + '" aria-selected="' + (i === active) + '" data-i="' + i + '">' + ptAv(ptPhotoCase(p), 36) +
      '<span class="ptoTx"><span class="ptoNm">' + ptName(p.name, q) + (p.chart ? '<span class="ptoCh">#' + esc(p.chart) + '</span>' : '') + '</span><span class="ptoSub">' + esc(ptSumText(p)) + '</span></span>' +
      '<span class="ptoUse" aria-hidden="true">Use</span></div>').join('');
}
/* under the name: the patient's cases (the form's patient: typed, or picked from the list) — amber when one looks like the same case */
function ptInfoHTML(o) {
  if (!normName(o.patient) && !normChart(o.chart)) return '';
  const seen = new Set(), mine = [];
  casePool().forEach(c => { if (c && c.id && !seen.has(c.id) && !c.locked && !c.dup && samePatient(c, o)) { seen.add(c.id); mine.push(c); } });
  if (!mine.length) return '';
  const open = mine.filter(c => c.status !== 'done' && S.cases.has(c.id)).sort(byMade), done = mine.filter(c => c.status === 'done').sort(byClosed);
  const dups = o.type ? open.filter(c => dupLike(o, c)) : [], others = open.filter(c => !dups.includes(c));
  const nm = ptName(String(o.patient || mine[0].patient || '').trim() || 'This patient');
  const row = (c, main) => '<div class="piRow"><span class="piTx"><b>' + esc(typeOf(c).l) + '</b> · ' + esc(caseLine(c)) + '</span><button type="button" class="btn ' + (main ? 'btn-pri' : 'btn-sec') + ' btn-sm" data-act="ptOpen" data-id="' + esc(c.id) + '">' + (main ? 'Open that case' : 'Open') + '</button></div>';
  if (dups.length) return '<div class="ptInfo warn" role="alert"><div class="piHd">' + ic('alert', 17) + '<span><b>' + nm + ' already has ' + (dups.length > 1 ? dups.length + ' open ' : 'an open ') + esc(typeOf(o).l) + ' case' + (dups.length > 1 ? 's' : '') + '.</b> If it’s the same one, open it instead of making a second case.</span></div>' +
    dups.map(c => row(c, true)).join('') + (others.length ? '<div class="piMore">Also open: ' + esc(others.map(c => typeOf(c).l + ' (' + stageLabel(c) + ')').join(', ')) + '</div>' : '') + '</div>';
  if (open.length) return '<div class="ptInfo"><div class="piHd">' + ic('user', 16) + '<span><b>' + nm + '</b> is already in the app with ' + (open.length === 1 ? 'an open case' : open.length + ' open cases') + ':</span></div>' +
    open.map(c => row(c, false)).join('') + (done.length ? '<div class="piMore">' + esc(ptDoneText(done).replace(/^l/, 'L')) + '</div>' : '') + '</div>';
  return '<div class="ptInfo quiet">' + ic('user', 15) + '<span><b>' + nm + '</b> is already in the app — ' + esc(ptDoneText(done)) + '. No open cases.</span></div>';
}
/* the New case form: the name looks itself up; the patient's cases show under it */
function ptWire(root) {
  const inp = $('#cf-patient', root), chart = $('#cf-chart', root), row = inp && inp.closest('.cfSec'); if (!inp || !row) return;
  row.insertAdjacentHTML('beforeend', '<div class="ptFind" id="cf-ptFind" hidden><div class="ptList" id="cf-ptList" role="listbox" aria-label="Patients already in the app"></div></div><div id="cf-ptInfo" aria-live="polite"></div>');
  const box = $('#cf-ptFind', root), list = $('#cf-ptList', root), info = $('#cf-ptInfo', root);
  inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-autocomplete', 'list'); inp.setAttribute('aria-controls', 'cf-ptList'); inp.setAttribute('aria-expanded', 'false');
  const st = { items: [], active: -1, picked: '', off: '' };
  const close = () => { box.hidden = true; st.items = []; st.active = -1; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); };
  const draw = () => {
    const q = inp.value, n = normName(q);
    // nothing to look up, a patient just picked (until the name changes), or the list put away with Esc (until it changes)
    if (n.length < 2 || n === st.picked || n === st.off) { close(); return; }
    st.items = ptSearch(q, 5);
    if (!st.items.length) { close(); return; }
    if (st.active >= st.items.length) st.active = -1;
    list.innerHTML = ptListHTML(st.items, q, st.active); box.hidden = false; inp.setAttribute('aria-expanded', 'true');
    if (st.active >= 0) inp.setAttribute('aria-activedescendant', 'cf-pto' + st.active); else inp.removeAttribute('aria-activedescendant');
    phPaint();
  };
  const sync = () => {
    const o = readCaseForm(root), h = ptInfoHTML(o);
    if (info._h !== h) { info._h = h; info.innerHTML = h; phPaint(); }
    // a Create case question about another patient or kind of case is put away (it asks again if it still applies)
    const ask = $('#ncDup', root); if (ask && ask.dataset.sig && ask.dataset.sig !== dupSig(dupCands(o), o)) { ask.innerHTML = ''; ask.dataset.sig = ''; }
  };
  const pick = i => {
    const p = st.items[i]; if (!p) return;
    inp.value = p.name; st.picked = normName(p.name); close();
    const ch0 = chart ? chart.value.trim() : '';
    if (chart && p.chart && !ch0) { chart.value = p.chart; chart.dispatchEvent(new Event('input', { bubbles: true })); }
    inp.dispatchEvent(new Event('input', { bubbles: true })); // (the photo, the patient's earlier sets, the "what's being made" line…)
    sync(); inp.focus();
  };
  let t = null;
  inp.addEventListener('input', () => { st.active = -1; if (normName(inp.value) !== st.picked) st.picked = ''; if (normName(inp.value) !== st.off) st.off = ''; draw(); clearTimeout(t); t = setTimeout(sync, 120); });
  if (chart) chart.addEventListener('input', () => { clearTimeout(t); t = setTimeout(sync, 120); });
  inp.addEventListener('focus', draw);
  inp.addEventListener('keydown', e => {
    if (box.hidden) { if (e.key === 'ArrowDown' && normName(inp.value).length >= 2) { st.off = ''; st.picked = ''; draw(); if (!box.hidden) { e.preventDefault(); st.active = 0; draw(); } } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = st.items.length; st.active = e.key === 'ArrowDown' ? (st.active + 1) % n : (st.active <= 0 ? n - 1 : st.active - 1); draw(); return; }
    if (e.key === 'Enter' && st.active >= 0) { e.preventDefault(); pick(st.active); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); st.off = normName(inp.value); close(); }
  });
  // (a press on a patient keeps the cursor in the name box)
  list.addEventListener('mousedown', e => { if (e.target.closest('.ptOpt')) e.preventDefault(); });
  list.addEventListener('click', e => { const o = e.target.closest('.ptOpt'); if (o) pick(Number(o.dataset.i)); });
  root._ptRefresh = () => { if (!root.isConnected) return; if (!box.hidden || document.activeElement === inp) draw(); sync(); };
  root._dupSync = sync;
  sync();
}
/* Create case with an open case of the same kind for the patient: asked once, right above the buttons */
function dupSig(list, o) { return list.length ? list.map(c => c.id).join(',') + '|' + o.type + '|' + normName(o.patient) + '|' + normChart(o.chart) : ''; }
function dupAsk(w, o, list) {
  const box = $('#ncDup', w); if (!box) return;
  const c = list[0], more = list.length - 1;
  box.dataset.sig = dupSig(list, o);
  box.innerHTML = '<div class="dupAsk" role="alert"><div class="daHd">' + ic('alert', 18) + '<b>' + ptName(o.patient) + ' already has an open ' + esc(typeOf(o).l) + ' case' + (more ? ' (and ' + more + ' more)' : '') + '</b></div>' +
    '<div class="daTx">' + esc(caseLine(c)) + '. If it’s the same case, open it instead of making a second one.</div>' +
    '<div class="daBtns"><button type="button" class="btn btn-pri btn-sm" data-act="ptOpen" data-id="' + esc(c.id) + '">Open that case</button><button type="button" class="btn btn-sec btn-sm" id="ncDupOk">Create a second case anyway</button></div></div>';
  $('#ncDupOk', box).onclick = () => { w._dupOk = box.dataset.sig; const f = $('#ncForm', w); if (f.requestSubmit) f.requestSubmit(); else $('#ncSave', w).click(); };
  box.scrollIntoView({ block: 'center' });
}
/* New case's submit: true = go ahead (`o` gets notDup when a second case was asked for on purpose) */
function dupGate(w, o) {
  const list = dupCands(o); if (!list.length) return true;
  if (w._dupOk && w._dupOk === dupSig(list, o)) { o.notDup = list.map(c => c.id); return true; }
  dupAsk(w, o, list); return false;
}

/* ---------- Remove duplicate ---------- */
/* the cases this one could be a duplicate of: the patient's other cases — the ones that look the same first, then their other open
   cases, then completed ones */
function dupKeepCands(c) {
  const seen = new Set([c.id]), mine = [];
  casePool().forEach(x => { if (x && x.id && !seen.has(x.id) && !x.locked && !x.dup && samePatient(x, c)) { seen.add(x.id); mine.push(x); } });
  const rank = x => dupLike(c, x) ? 0 : x.status !== 'done' ? 1 : 2;
  return mine.sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? byMade(a, b) : byClosed(a, b)));
}
/* what of the duplicate's is carried onto the case kept: its comments (who wrote them and when stay) and its Notes as a comment —
   not ones the kept case already has */
function dupCarry(c, keep) {
  const has = new Set(((keep && keep.comments) || []).map(x => x.id + '|' + x.text)), texts = new Set(((keep && keep.comments) || []).map(x => x.text));
  const out = (c.comments || []).filter(x => x && String(x.text || '').trim() && !has.has(x.id + '|' + x.text)).map(x => Object.assign({}, x, { dupFrom: c.id }));
  const nt = String(c.notes || '').trim(), text = 'Notes from the duplicate case: ' + nt;
  if (nt && nt !== String((keep && keep.notes) || '').trim() && !texts.has(text)) { const a = notesAuthor(c) || {}; out.push({ id: uid8(), at: a.at || c.notesAt || c.createdAt || Date.now(), by: a.by || c.notesBy || c.createdBy || meSid(), text, dupFrom: c.id }); }
  return out;
}
function dupKeepRowHTML(x, c, on) {
  const other = !samePatient(x, c) || normName(x.patient) !== normName(c.patient);
  return '<label class="dkRow' + (dupLike(c, x) ? ' same' : '') + '"><input type="radio" name="dupKeep" value="' + esc(x.id) + '"' + (on ? ' checked' : '') + '>' + ptAv(x, 32) +
    '<span class="dkTx"><b>' + (other ? ptName(x.patient) + ' · ' : '') + esc(typeOf(x).l) + '</b>' + (dupLike(c, x) ? '<span class="dkSame">looks the same</span>' : '') + '<span class="small muted">' + esc(caseLine(x)) + '</span></span></label>';
}
function dupRemoveModal(id) {
  const c = findCase(id); if (!c || c.locked) return;
  if (c.dup) { toast('This case was already removed as a duplicate'); return; }
  const cands = dupKeepCands(c), first = cands.find(x => dupLike(c, x)) || null;
  let copyOn = true;
  // what would be copied onto the case picked to keep (not what it already has)
  const copyHTML = k => { const cr = k ? dupCarry(c, k) : []; if (!cr.length) return '';
    const nts = cr.filter(x => x.text.startsWith('Notes from the duplicate case: ')).length, nCm = cr.length - nts;
    return '<label class="dkCopy"><input type="checkbox" id="dkCopy"' + (copyOn ? ' checked' : '') + '> Copy ' + (nCm ? 'its ' + (nCm === 1 ? 'comment' : nCm + ' comments') + (nts ? ' and Notes' : '') : 'its Notes') + ' to the case you keep</label>'; };
  const listHTML = items => items.length ? items.map(x => dupKeepRowHTML(x, c, first && x.id === first.id)).join('') : '<div class="small muted dkNone">No other case for ' + esc(c.patient || 'this patient') + ' — search for it below (a different spelling or chart #?).</div>';
  openModal('<h3>Remove a duplicate</h3><div class="lsub">' + ptName(c.patient) + esc(' · ' + typeOf(c).l + ' · ' + caseLine(c)) + '</div>' +
    '<h5 class="dkH">Which case is the one to keep?</h5><div class="dkList" id="dkList" role="radiogroup" aria-label="The case to keep">' + listHTML(cands) + '</div>' +
    '<div class="field dkFind"><label for="dkQ">Not there? Find it by name or chart #</label><input id="dkQ" type="search" autocomplete="off" spellcheck="false" placeholder="e.g. ' + esc(String(c.patient || '').trim().split(/\s+/).slice(-1)[0] || 'Smith') + '"></div>' +
    '<div id="dkCopyWrap">' + copyHTML(first) + '</div>' +
    '<p class="small muted dkWhat">This one leaves every list and the patient’s history. Nothing is deleted: you can undo right after, and Dr. A can bring it back from Team &amp; security.</p>' +
    '<div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Cancel</button><button class="btn btn-danger" type="button" id="dkGo"' + (first ? '' : ' disabled') + '>' + ic('copy', 16) + 'Remove duplicate</button></div>', w => {
      w.querySelector('.modal').classList.add('dkModal');
      const go = $('#dkGo', w), q = $('#dkQ', w), box = $('#dkList', w);
      const sel = () => { const r = $('input[name=dupKeep]:checked', w); go.disabled = !r; return r ? r.value : ''; };
      const copySync = () => { const id = sel(), k = id ? casePool().find(x => x.id === id) : null, h = copyHTML(k), wr = $('#dkCopyWrap', w); if (wr._h !== h) { wr._h = h; wr.innerHTML = h; } };
      w.addEventListener('change', e => { if (e.target.name === 'dupKeep') copySync(); if (e.target.id === 'dkCopy') copyOn = e.target.checked; });
      q.addEventListener('input', () => {
        const v = q.value.trim(), keep = sel();
        if (!v) { box.innerHTML = listHTML(cands); } else {
          const found = [], seen = new Set([c.id]);
          ptSearch(v, 8).forEach(p => p.cases.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || byMade(a, b)).forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); found.push(x); } }));
          box.innerHTML = found.length ? found.slice(0, 10).map(x => dupKeepRowHTML(x, c, false)).join('') : '<div class="small muted dkNone">No case found for “' + esc(v) + '”.</div>';
        }
        const r = keep && $('input[name=dupKeep][value="' + CSS.escape(keep) + '"]', w); if (r) r.checked = true;
        copySync(); phPaint();
      });
      go.onclick = async () => {
        const keepId = sel(); if (!keepId) return;
        const cp = $('#dkCopy', w); busyBtn(go, true, 'Removing…');
        try { await dupRemoveRun(c, keepId, !!(cp && cp.checked)); closeModal(); }
        catch (x) { busyBtn(go, false); toast(errText(x), { bad: true }); }
      };
      phPaint(); if (!first) q.focus(); else go.focus();
    });
}
async function dupRemoveRun(c, keepId, copy) {
  const keep = S.cases.get(keepId) || casePool().find(x => x.id === keepId) || null;
  const carry = copy ? dupCarry(c, keep) : [], was = c.status === 'done' ? 'done' : 'open';
  let copied = 0;
  if (carry.length) {
    await B.mutateCase(keepId, d => {
      const ids = new Set((d.comments || []).map(x => x.id)), texts = new Set((d.comments || []).map(x => x.text));
      const add = carry.filter(x => !ids.has(x.id) && !(x.text.startsWith('Notes from the duplicate case: ') && texts.has(x.text))); if (!add.length) return 'skip';
      d.comments = (d.comments || []).concat(add).sort((a, b) => (a.at || 0) - (b.at || 0)); copied = add.length;
    }, { a: 'dupcopy', from: c.id, n: carry.length }).catch(skipOk);
  }
  await B.mutateCase(c.id, d => { d.dup = { of: keepId, by: meSid(), at: Date.now(), was }; return 'done'; }, { a: 'dup', of: keepId });
  // the patient's photo, when the case kept has none
  if (c.photo && keep && !keep.photo && S.cases.has(keepId)) {
    try { const x = phCached(c.id, c.photo) || await phLoad(c.id, c.photo); if (x && x.bytes) { const pv = await B.setPhoto(keepId, x.bytes, { a: 'photo', how: 'copy' }); phPut(keepId, pv, x.bytes); } } catch (e) { }
  }
  const drop = x => x.id !== c.id; if (S.hist) S.hist = S.hist.filter(drop); S.closed = S.closed.filter(drop);
  if (S.openId === c.id) closeDrawer(true);
  queueRender();
  if (S.cases.has(keepId) && !S.openId) openDrawer(keepId); // the case kept, with what was copied onto it
  toast('Duplicate removed' + (keep ? ' — kept ' + ptNameText(keep.patient) + '’s ' + typeOf(keep).l + ' case' : '') + (copied ? ' (' + copied + ' comment' + (copied > 1 ? 's' : '') + ' copied to it)' : ''), { action: 'Undo', ms: 12000, onAction: () => act(async () => {
    await B.mutateCase(c.id, d => { if (!d.dup) return 'skip'; delete d.dup; return was; }, { a: 'undup' }).catch(skipOk);
    if (copied) await B.mutateCase(keepId, d => { const n = (d.comments || []).length; d.comments = (d.comments || []).filter(x => x.dupFrom !== c.id); if (d.comments.length === n) return 'skip'; }, { a: 'dupcopy', from: c.id, undo: 1 }).catch(skipOk);
    if (was === 'done') S.closedLoaded = false;
  }, 'Brought back') });
}
/* "Not a duplicate": this case and the one(s) it was flagged with are left alone from now on */
async function notDupRun(c) {
  const ids = dupsOf(c).map(o => o.id); if (!ids.length) return;
  await B.mutateCase(c.id, d => { const was = d.notDup || []; const now = Array.from(new Set(was.concat(ids))); if (now.length === was.length) return 'skip'; d.notDup = now; }, { a: 'notdup', of: ids }).catch(skipOk);
  const cur = findCase(c.id); if (cur) cur.notDup = Array.from(new Set((cur.notDup || []).concat(ids)));
  S.casesV = (S.casesV || 0) + 1; queueRender(); if (S.openId === c.id && !S.editing) renderDrawer();
  toast('Marked as not a duplicate');
}

/* ---------- Team & security: the duplicates removed lately, each can be brought back ---------- */
function dupListHTML(list) {
  return list.length ? list.map((c, i) => { const x = c.dup || {}, k = x.of && casePool().find(o => o.id === x.of);
    return '<div class="row" style="cursor:default">' + ptAv(c, 32) + '<span class="grow"><span class="pt">' + ptName(c.patient) + '</span><span class="meta">' + esc(typeOf(c).l + (c.detail ? ' · ' + c.detail : '') + ' · removed ' + fmtWhen(x.at) + ' by ' + (firstName(staffName(x.by, x.by)) || '—') + (k ? ' · kept the one ' + enteredText(k) : '')) + '</span></span>' +
      '<button class="btn btn-sec btn-sm" data-act="undup" data-i="' + i + '">Bring back</button></div>'; }).join('')
    : '<div class="small muted">No duplicates removed in the last 90 days.</div>';
}
/* (once loaded, the list stays through the page's own redraws — the Staff Hub roster or the lab-email status arriving) */
function dupAdminCardHTML() {
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Removed duplicates</h3><span class="sub">Last 90 days</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="loadDups">' + ic('refresh', 15) + 'Load</button></div>' +
    '<div class="cardBd" id="dupBox">' + (S.dupList ? dupListHTML(S.dupList) : '<div class="small muted">Cases anyone removed as a duplicate. Each can be brought back. Click Load.</div>') + '</div></div>';
}
function dupHistText(x) {
  if (x.a === 'dup') { const k = x.of && casePool().find(o => o.id === x.of); return 'removed it as a duplicate' + (k ? ' (kept the ' + typeOf(k).l + ' case ' + enteredText(k) + ')' : ''); }
  if (x.a === 'undup') return 'brought it back (it had been removed as a duplicate)';
  if (x.a === 'notdup') return 'marked it as not a duplicate';
  if (x.a === 'dupcopy') return x.undo ? 'took back what was copied from a duplicate' : 'copied ' + (x.n === 1 ? 'a comment' : (x.n || 'the') + ' comments') + ' from a duplicate case';
  return '';
}
Object.assign(ADMIN_ACTS, {
  ptOpen(t) { const id = t.dataset.id; if (!S.cases.has(id)) return; closeModal(); openDrawer(id); },
  dupRemove() { if (S.openId) dupRemoveModal(S.openId); },
  notDup() { const c = findCase(S.openId); if (c) notDupRun(c); },
  dupsF() { S.f.dups = S.f.dups ? '' : '1'; if (S.f.dups) S.sort = { k: 'patient', dir: 1 }; renderView(); },
  async loadDups() {
    const box0 = $('#dupBox'); if (!box0) return; box0.innerHTML = '<div class="small muted">Loading…</div>';
    try {
      S.dupList = (await B.loadChanged(90)).filter(c => c.dup).map(c => { c.stage = liveStage(c); return c; }).sort((a, b) => ((b.dup || {}).at || 0) - ((a.dup || {}).at || 0));
      const box = $('#dupBox'); if (box) { box.innerHTML = dupListHTML(S.dupList); phPaint(); }
    } catch (x) { const box = $('#dupBox'); if (box) box.innerHTML = '<div class="small" style="color:var(--coral-700)">' + esc(errText(x)) + '</div>'; }
  },
  async undup(t) {
    const c = S.dupList && S.dupList[Number(t.dataset.i)]; if (!c) return; busyBtn(t, true, 'Bringing back…');
    try { await B.mutateCase(c.id, d => { if (!d.dup) return 'skip'; const was = d.dup.was; delete d.dup; return was === 'done' ? 'done' : 'open'; }, { a: 'undup' }).catch(skipOk); S.closedLoaded = false; toast((ptNameText(c.patient) || 'Case') + ' is back'); ADMIN_ACTS.loadDups(); }
    catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); }
  }
});
