/* =====================================================================
   The move (once, Dr. A), and afterwards "Remove the old copy".
   The IPR Tracker's records sat in the nlo-inventory Realtime Database
   (nlo/ipr/patients, nlo/ipr/visits/<patient>/<visit>), unencrypted,
   with initials only. Dr. A connects to it with Google (his account or
   the office one), the page reads everything and shows what it found,
   with the full name NLO Cases has for each chart #. "Move it now" reads
   it all again, seals every patient and visit here under the same ids,
   opens every one again to check it matches, and only then marks the
   records moved (iprMeta/moved) — and leaves a mark in the old database
   (nlo/ipr/moved) that sends the old IPR Tracker's page here.
   Running it again (a move that stopped half way) saves the same records
   under the same ids, so nothing doubles.
   The old copy stays until Dr. A removes it (the app's menu): that reads
   the old database again, brings over anything saved there since the
   move (an old page left open), checks, and then deletes nlo/ipr's
   patients and visits (the mark stays).
   ===================================================================== */
const MV = { step: 'start', who: '', plan: null, done: 0, total: 0, err: '', res: null, checked: false, busy: false };

/* ---------- the old database (read, and at the very end emptied) ----------
   Its own Google sign-in, kept only while this page is open (never on the computer): closed after the move; a lock or a
   reload ends it. */
const OLD = {
  auth: null,
  init() {
    if (OLD.auth) return true;
    if (typeof firebase === 'undefined' || !firebase.auth) return false;
    const cfg = S.emu ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-nlo-cases', appId: 'demo' } : OLD_FB;
    const app = firebase.apps.find(a => a && a.name === 'iprMove') || firebase.initializeApp(cfg, 'iprMove');
    OLD.auth = app.auth();
    if (S.emu) OLD.auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    OLD.auth.setPersistence(firebase.auth.Auth.Persistence.NONE).catch(() => { });
    return true;
  },
  async user() { if (!OLD.init()) return null; return OLD.auth.currentUser || null; },
  /* straight from the click (a sign-in window may only open from one) */
  connect() {
    if (!OLD.init()) return Promise.reject(errCode('unavailable', 'Not available in this browser.'));
    if (S.emu) return OLD.auth.signInAnonymously();
    const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    return OLD.auth.signInWithPopup(p);
  },
  async disconnect() { if (OLD.auth) await OLD.auth.signOut(); },
  async call(method, path, body) {
    const u = await OLD.user(); if (!u) throw errCode('no-old', 'Not connected to the old IPR Tracker.');
    const tok = await u.getIdToken();
    const url = (S.emu ? 'http://127.0.0.1:9000/' : OLD_FB.databaseURL + '/') + path + '.json?' + (S.emu ? 'ns=demo-nlo-cases&' : '') + 'auth=' + encodeURIComponent(tok);
    let r;
    try { r = await fetch(url, { method, cache: 'no-store', credentials: 'omit', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw errCode('unavailable', 'Couldn’t reach the old IPR Tracker. Check the internet connection.'); }
    if (r.status === 401 || r.status === 403) throw errCode('permission-denied', 'This Google account (' + (u.email || 'not Dr. A’s or the office’s') + ') can’t ' + (method === 'GET' ? 'read' : 'change') + ' the old IPR Tracker. Connect with Dr. A’s or the office account.');
    if (!r.ok) throw errCode('unavailable', 'The old IPR Tracker answered ' + r.status + '.');
    return r.json();
  },
  read(path) { return OLD.call('GET', path); }
};
async function readOld() {
  const [patients, visits, moved] = await Promise.all([OLD.read('nlo/ipr/patients'), OLD.read('nlo/ipr/visits'), OLD.read('nlo/ipr/moved').catch(() => null)]);
  return { patients: patients && typeof patients === 'object' ? patients : {}, visits: visits && typeof visits === 'object' ? visits : {}, moved };
}

/* ---------- working out the move (nothing is saved here): the old records → the sealed records ----------
   → { pts: [{ id, body }], vis: [{ id, p, body }], counts, notes, first, last } */
const okId = id => typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_.:-]+$/.test(id) && !/^__.*__$/.test(id);
/* a fingerprint of an old record exactly as it was read (any order of keys): kept, sealed, with the record here, so "Remove
   the old copy" can tell a record that changed in the old database after the move */
async function oldHash(row) { return (await Crypto.sha256hex(canonJSON(row))).slice(0, 32); }
async function planMove(old, names) {
  const pts = [], vis = [], notes = [], skipped = { badId: 0, orphan: 0, junk: 0 };
  const counts = { pts: 0, vis: 0, named: 0, unnamed: 0, mismatch: 0, twoNames: 0 };
  let first = '', last = '';
  for (const k of Object.keys(old.patients)) {
    const r = old.patients[k];
    if (!r || typeof r !== 'object') { skipped.junk++; continue; }
    if (!okId(k)) { skipped.badId++; continue; }
    const chart = String(r.patient_id == null ? '' : r.patient_id).trim();
    // the old app kept the initials in "name" (or the chart # again when none were typed)
    let ini = String(r.name == null ? '' : r.name).trim(); if (ini === chart) ini = '';
    const body = { chart, name: '', at: String(r.created_at || ''), oh: await oldHash(r) };
    if (ini) body.ini = ini;
    const list = names.get(iprNorm(chart)) || [], one = FB.oneName(list);
    if (one && fitsInitials(one, ini)) { body.name = one; counts.named++; }
    else { counts.unnamed++; if (one) counts.mismatch++; else if (list.length) counts.twoNames++; }
    pts.push({ id: k, body }); counts.pts++;
  }
  const have = new Set(pts.map(p => p.id));
  for (const pk of Object.keys(old.visits)) {
    const group = old.visits[pk]; if (!group || typeof group !== 'object') { skipped.junk++; continue; }
    for (const vk of Object.keys(group)) {
      const r = group[vk];
      if (!r || typeof r !== 'object') { skipped.junk++; continue; }
      if (!have.has(pk)) { skipped.orphan++; continue; }
      if (!okId(vk)) { skipped.badId++; continue; }
      const body = FB.cleanVis(r); delete body.patient_uuid; delete body.id;
      body.oh = await oldHash(r);
      vis.push({ id: vk, p: pk, body }); counts.vis++;
      const d = String(r.date || ''); if (d) { if (!first || d < first) first = d; if (!last || d > last) last = d; }
    }
  }
  if (counts.mismatch) notes.push(plural(counts.mismatch, 'patient') + ': the name NLO Cases has for the chart # doesn’t fit the initials here, so it isn’t used; the initials stay until someone adds the full name.');
  if (counts.twoNames) notes.push(plural(counts.twoNames, 'patient') + ': NLO Cases has two different names for the chart #, so neither is used.');
  if (skipped.orphan) notes.push(plural(skipped.orphan, 'visit') + (skipped.orphan === 1 ? ' belongs' : ' belong') + ' to no patient (the old app never showed them), so ' + (skipped.orphan === 1 ? 'it stays' : 'they stay') + ' behind.');
  if (skipped.badId) notes.push(plural(skipped.badId, 'record') + ' had an id this database can’t take, so they stay behind.');
  if (skipped.junk) notes.push(plural(skipped.junk, 'empty entry', 'empty entries') + ' in the old database aren’t moved.');
  return { pts, vis, counts, notes, first, last };
}
function planSum(P) { return JSON.stringify([P.counts, P.first, P.last, P.notes.length, P.pts.map(p => p.id + p.body.oh), P.vis.map(v => v.id + v.body.oh)]); }
/* the names NLO Cases has for every chart # in the old records */
async function namesFor(old) {
  const charts = Array.from(new Set(Object.values(old.patients).filter(r => r && typeof r === 'object').map(r => String(r.patient_id == null ? '' : r.patient_id).trim()).filter(Boolean)));
  return FB.caseNames(charts);
}

/* ---------- the move card ---------- */
function moveCardHTML() {
  const st = MV.step, P = MV.plan;
  let h = '<div class="card gateCard moveCard"><div class="cardHd"><h3>Move the IPR Tracker over</h3><span class="sub">one time, a minute or two</span></div><div class="cardBd">';
  if (st === 'start' || st === 'connecting' || st === 'reading') {
    h += '<p class="small">The IPR Tracker now signs in with NLO Cases logins, locks after ' + idleMinutes() + ' minutes like NLO Cases, and seals every patient and visit with the office key. Its patients and visits move here from the old IPR Tracker once, each with the full name NLO Cases has for the chart #.</p>' +
      '<ol class="steps small"><li><b>Connect to the old IPR Tracker</b> with your Google account (or the office one).</li><li>Look over what it found, then press <b>Move it now</b>.</li><li>Every record is checked here before the IPR Tracker opens. The old copy stays until you remove it (the menu, once everyone is on the new one).</li></ol>' +
      (MV.err ? '<div class="lockErr" role="alert">' + esc(MV.err) + '</div>' : '') +
      '<div class="btnRow">' + (MV.who ? '<span class="small muted" style="align-self:center">Connected as <b>' + esc(MV.who) + '</b></span><button class="btn btn-pri btn-sm" data-act="mvRead"' + (st !== 'start' ? ' disabled' : '') + '>' + (st === 'reading' ? 'Reading…' : 'Read the old IPR Tracker') + '</button><button class="btn btn-ghost" data-act="mvSwitch">Use another account</button>'
        : '<button class="btn btn-pri btn-sm" data-act="mvConnect"' + (st !== 'start' ? ' disabled' : '') + '>' + ic('google', 16) + (st === 'connecting' ? 'Connecting…' : st === 'reading' ? 'Reading…' : 'Connect to the old IPR Tracker') + '</button>') + '</div>';
  } else if ((st === 'ready' || st === 'rereading') && P) {
    const c = P.counts, row = (l, v) => '<div class="kvRow"><span>' + l + '</span><b>' + v + '</b></div>';
    h += '<p class="small">Found in the old IPR Tracker (read just now):</p>' +
      row('Patients', c.pts) +
      row('Visits', c.vis + (P.first ? ' <span class="muted">(' + esc(P.first) + ' – ' + esc(P.last) + ')</span>' : '')) +
      row('Full names from NLO Cases', c.named + (c.unnamed ? ' <span class="muted">(' + c.unnamed + ' keep their initials for now)</span>' : '')) +
      (P.notes.length ? '<div class="hint"><b>Worth knowing:</b><ul class="mvNotes">' + P.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul></div>' : '') +
      '<div class="hint">Make sure nobody is charting in the old IPR Tracker while it moves. Keep this page open.</div>' +
      (MV.err ? '<div class="lockErr" role="alert">' + esc(MV.err) + '</div>' : '') +
      '<div class="btnRow"><button class="btn btn-pri" data-act="mvGo"' + (st === 'ready' ? '' : ' disabled') + '>' + ic('upload', 16) + (st === 'rereading' ? 'Checking it again…' : 'Move it now') + '</button><button class="btn btn-ghost" data-act="mvRead"' + (st === 'ready' ? '' : ' disabled') + '>Read it again</button></div>';
  } else if (st === 'moving' || st === 'checking') {
    const pct = MV.total ? Math.round(MV.done / MV.total * 100) : 0;
    h += '<p class="small">' + (st === 'checking' ? 'Opening every record again to check it…' : 'Sealing and saving ' + MV.done + ' of ' + MV.total + ' records…') + ' Keep this page open.</p>' +
      '<div class="bar"><i style="width:' + (st === 'checking' ? 100 : pct) + '%"></i></div>';
  } else if (st === 'done' && MV.res) {
    const r = MV.res;
    h += '<p class="small"><b>Moved.</b> Every record matches the old IPR Tracker: ' + plural(r.pts, 'patient') + ' (' + r.named + ' with their full name from NLO Cases) and ' + plural(r.vis, 'visit') + '.</p>' +
      '<p class="small">From now on everyone signs in here with their NLO Cases login' + (MV.markErr ? '.' : '; the old IPR Tracker’s page sends them here.') + ' When everyone is on this one, remove the old copy (the menu → <b>Remove the old copy</b>).</p>' +
      (MV.markErr ? '<div class="hint">The old IPR Tracker’s database didn’t take the mark that sends its page here (' + esc(MV.markErr) + '), so an old page someone opens still works on its own until the old copy is removed.</div>' : '') +
      '<div class="btnRow"><button class="btn btn-pri" data-act="mvOpen">Open the IPR Tracker</button></div>';
  } else if (st === 'error') {
    h += '<div class="lockErr" role="alert">' + esc(MV.err || 'The move stopped.') + '</div><p class="small">Nothing is marked moved, and the old IPR Tracker wasn’t changed. Running the move again saves the same records under the same ids, so it’s safe to try again.</p>' +
      '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="mvRead">Read it again</button></div>';
  }
  return h + '</div></div>';
}
/* after the card is drawn: is this page connected to the old database already? */
function moveAfter() {
  if (MV.checked) return; MV.checked = true;
  OLD.user().then(u => { if (u && !MV.who) { MV.who = u.email || (S.emu ? 'test account' : 'a Google account'); renderGate(); } }).catch(() => { });
}
ACT.mvConnect = async () => {
  MV.err = ''; MV.step = 'connecting'; renderGate();
  try { const r = await OLD.connect(); MV.who = (r && r.user && r.user.email) || (S.emu ? 'test account' : 'a Google account'); }
  catch (e) { MV.step = 'start'; MV.err = errText(e); renderGate(); return; }
  MV.step = 'start'; return ACT.mvRead();
};
ACT.mvSwitch = async () => { await OLD.disconnect().catch(() => { }); MV.who = ''; MV.err = ''; MV.step = 'start'; ACT.mvConnect(); };
ACT.mvRead = async () => {
  MV.err = ''; MV.step = 'reading'; renderGate();
  try { const old = await readOld(); MV.plan = await planMove(old, await namesFor(old)); MV.step = 'ready'; }
  catch (e) { console.error(e); MV.step = MV.plan ? 'error' : 'start'; MV.err = errText(e); MV.plan = null; }
  renderGate();
};
ACT.mvGo = async () => {
  if (!MV.plan) return;
  if (!await confirmBox('Move the IPR Tracker now?', 'Make sure nobody is charting in the old IPR Tracker. It takes a minute or two; keep this page open.', 'Move it now')) return;
  MV.err = ''; MV.step = 'rereading'; MV.busy = true; renderGate();
  try {
    // read it all again: anything different from what the card showed, and the card shows the new numbers instead
    const old = await readOld(), P = await planMove(old, await namesFor(old));
    if (planSum(P) !== planSum(MV.plan)) {
      MV.plan = P; MV.step = 'ready'; MV.busy = false;
      MV.err = 'The old IPR Tracker changed since you read it. The numbers above are new: look them over and press Move it now again.';
      renderGate(); return;
    }
    MV.plan = P;
    await doMove(P);
    MV.step = 'done';
    // the old page sends everyone here from now on (a mark only: nothing about anyone)
    MV.markErr = '';
    await OLD.call('PUT', 'nlo/ipr/moved', { at: Date.now(), to: 'IPR_Tracker.html' }).catch(e => { console.warn('moved mark', e); MV.markErr = errText(e); });
    OLD.disconnect().catch(() => { }); MV.who = '';
  } catch (e) { console.error(e); MV.step = 'error'; MV.err = errText(e); }
  MV.busy = false; renderGate();
};
/* what's here already for each planned record: the same (skip), different (save it over, with history), or missing (create) */
function moveWrites(P, have, action) {
  const writes = [];
  P.pts.forEach(x => { const h = have.pts.get(x.id); if (!h) writes.push({ kind: 'pt', id: x.id, body: x.body, mode: 'create', action }); else if (canonJSON(h.body) !== canonJSON(x.body)) writes.push({ kind: 'pt', id: x.id, body: x.body, mode: 'update', action }); });
  P.vis.forEach(x => { const h = have.vis.get(x.id); if (!h) writes.push({ kind: 'vis', id: x.id, p: x.p, body: x.body, mode: 'create', action }); else if (canonJSON(h.body) !== canonJSON(x.body)) writes.push({ kind: 'vis', id: x.id, p: x.p, body: x.body, mode: 'update', action }); });
  return writes;
}
/* every planned record is here, opens, and is exactly what was planned */
function moveCheck(P, after) {
  const bad = [];
  const miss = (list, m) => list.filter(x => { const h = m.get(x.id); return !h || canonJSON(h.body) !== canonJSON(x.body) || (x.p && h.d.p !== x.p); }).length;
  const mp = miss(P.pts, after.pts), mvv = miss(P.vis, after.vis);
  if (mp) bad.push(plural(mp, 'patient') + ' missing or different');
  if (mvv) bad.push(plural(mvv, 'visit') + ' missing or different');
  if (after.bad.length) bad.push(plural(after.bad.length, 'record') + ' here that can’t be opened');
  return bad;
}
async function doMove(P) {
  MV.step = 'moving'; MV.done = 0; MV.total = P.pts.length + P.vis.length; renderGate();
  const writes = moveWrites(P, await FB.everything(), { a: 'move' });
  MV.total = writes.length;
  const failed = await FB.moveWrite(writes, (d, n) => { MV.done = d; MV.total = n; S.lastAct = Date.now(); if (S.gate === 'move') renderGate(); });
  if (failed.length) throw errCode('mismatch', plural(failed.length, 'record') + ' couldn’t be saved (' + errText(failed[0].e) + '). Run the move again.');
  MV.step = 'checking'; renderGate();
  const bad = moveCheck(P, await FB.everything());
  if (bad.length) throw errCode('mismatch', 'Not everything is here yet — ' + bad.join('; ') + '. Run the move again.');
  await FB.markMoved('moved', { pts: P.pts.length, vis: P.vis.length, named: P.counts.named });
  MV.res = { pts: P.pts.length, vis: P.vis.length, named: P.counts.named };
}
ACT.mvOpen = () => { OLD.disconnect().catch(() => { }); S.moved = { at: Date.now() }; ACT.retryOpen(); };

/* ---------- "Remove the old copy" (Dr. A, from the app's menu, once everyone is on the new IPR Tracker) ----------
   The old database is read again; anything saved there after the move (an old page left open) comes over first — a record
   changed in both places keeps this one's version, the old one going into its history — then every record is checked and
   nlo/ipr's patients and visits are deleted (the mark that sends the old page here stays). */
const RM = { step: 'start', who: '', plan: null, err: '', res: null, busy: false };
function rmOpen() {
  RM.err = ''; RM.res = null; RM.plan = null; RM.step = 'start';
  let w = $('#rmWrap');
  if (!w) { w = document.createElement('div'); w.id = 'rmWrap'; w.className = 'lkModal'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); document.body.appendChild(w); }
  OLD.user().then(u => { RM.who = u ? (u.email || (S.emu ? 'test account' : 'a Google account')) : ''; rmRender(); }).catch(() => rmRender());
  rmRender();
}
function rmClose() { const w = $('#rmWrap'); if (w && !RM.busy) w.remove(); }
ACT.rmClose = () => rmClose();
function rmRender() {
  const w = $('#rmWrap'); if (!w) return;
  const st = RM.step, P = RM.plan, row = (l, v) => '<div class="kvRow"><span>' + l + '</span><b>' + v + '</b></div>';
  let h = '<div class="lkModalCard wide"><div class="rmHd"><h3>Remove the old copy</h3><button type="button" class="btn btn-ghost lkX" data-act="rmClose" aria-label="Close"' + (RM.busy ? ' disabled' : '') + '>' + ic('x', 16) + '</button></div>';
  if (S.removed && st === 'start') h += '<p class="small">The old copy was removed ' + esc(fmtWhen(S.removed.at)) + '. Checking again shows anything an old page saved there since.</p>';
  if (st === 'start' || st === 'reading') {
    h += '<p class="small">The old IPR Tracker’s database still has a copy of the patients and visits, unencrypted. Once everyone uses this IPR Tracker, take it out: anything saved there since the move comes over first, every record is checked here, and then the old copy is deleted.</p>' +
      (RM.err ? '<div class="lockErr" role="alert">' + esc(RM.err) + '</div>' : '') +
      '<div class="btnRow">' + (RM.who ? '<span class="small muted" style="align-self:center">Connected as <b>' + esc(RM.who) + '</b></span><button class="btn btn-pri btn-sm" data-act="rmRead"' + (st !== 'start' ? ' disabled' : '') + '>' + (st === 'reading' ? 'Reading…' : 'Check the old copy') + '</button>'
        : '<button class="btn btn-pri btn-sm" data-act="rmConnect"' + (st !== 'start' ? ' disabled' : '') + '>' + ic('google', 16) + (st === 'reading' ? 'Reading…' : 'Connect to the old IPR Tracker') + '</button>') + '</div>';
  } else if ((st === 'ready' || st === 'working') && P) {
    const c = P.counts;
    h += '<p class="small">In the old database now:</p>' + row('Patients', c.pts) + row('Visits', c.vis) +
      row('Saved there since the move', P.recs ? '<span class="stat off">' + plural(P.recs, 'record') + '</span> <span class="muted">(they come over first)</span>' : '<span class="stat ok">nothing</span>') +
      (P.conflicts ? row('Changed in both places', P.conflicts + ' <span class="muted">(this IPR Tracker’s version is kept; the old one goes into its history)</span>') : '') +
      (P.notes.length ? '<div class="hint"><ul class="mvNotes">' + P.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul></div>' : '') +
      (RM.err ? '<div class="lockErr" role="alert">' + esc(RM.err) + '</div>' : '') +
      (c.pts + c.vis ? '<div class="btnRow"><button class="btn btn-danger" data-act="rmGo"' + (st === 'ready' ? '' : ' disabled') + '>' + (st === 'working' ? 'Working…' : P.writes.length ? 'Bring them over and remove the old copy' : 'Remove the old copy') + '</button></div>'
        : '<p class="small"><b>The old copy is empty.</b> Nothing left to remove.</p>');
  } else if (st === 'done' && RM.res) {
    h += '<p class="small"><b>Removed.</b> ' + (RM.res.brought ? plural(RM.res.brought, 'record') + ' saved in the old IPR Tracker since the move came over first; ' : '') + 'the old database no longer has the IPR Tracker’s patients or visits. Everything is here, sealed.</p>' +
      '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="rmClose">Done</button></div>';
  }
  w.innerHTML = h + '</div>';
}
ACT.rmConnect = async () => {
  RM.err = ''; RM.step = 'reading'; rmRender();
  try { const r = await OLD.connect(); RM.who = (r && r.user && r.user.email) || (S.emu ? 'test account' : 'a Google account'); }
  catch (e) { RM.step = 'start'; RM.err = errText(e); rmRender(); return; }
  RM.step = 'start'; return ACT.rmRead();
};
/* the old copy now, against what's here: [writes] to bring over, and how many of them changed in both places */
async function rmPlan() {
  const old = await readOld(), have = await FB.everything();
  const P = await planMove(old, new Map());   // (names aren't looked up again: a record here keeps the one it has)
  const writes = [], conflicts = [];
  const sameOld = (h, x) => h && h.body.oh && h.body.oh === x.body.oh;
  for (const x of P.pts) {
    const h = have.pts.get(x.id);
    if (!h) { const nb = Object.assign({}, x.body); writes.push({ kind: 'pt', id: x.id, body: nb, mode: 'create', action: { a: 'old-copy' } }); continue; }
    if (sameOld(h, x)) continue;
    // a patient changed in the old database (the old page never changes one — only a hand edit could): this one's chart # and
    // name stay; the fingerprint is the old record's now, and its initials come along if this one has none
    const nb = Object.assign({}, h.body, { oh: x.body.oh }); if (x.body.ini && !nb.ini) nb.ini = x.body.ini;
    writes.push({ kind: 'pt', id: x.id, body: nb, mode: 'update', action: { a: 'old-copy' } });
  }
  for (const x of P.vis) {
    const h = have.vis.get(x.id);
    if (!h) { writes.push({ kind: 'vis', id: x.id, p: x.p, body: x.body, mode: 'create', action: { a: 'old-copy' } }); continue; }
    if (sameOld(h, x)) continue;
    // changed in the old database since the move: if nobody saved it here since, the old one's version comes over; if both
    // changed, the old version goes into this one's history and this one's version is put back on top
    const hist = await FB.historyOf('vis', x.id), editedHere = hist.some(e => e.a && e.a !== 'move' && e.a !== 'old-copy');
    if (!editedHere) writes.push({ kind: 'vis', id: x.id, p: x.p, body: x.body, mode: 'update', action: { a: 'old-copy' } });
    else { conflicts.push(x.id); writes.push({ kind: 'vis', id: x.id, p: x.p, body: x.body, mode: 'update', action: { a: 'old-copy' } }, { kind: 'vis', id: x.id, p: x.p, body: Object.assign({}, h.body, { oh: x.body.oh }), mode: 'update', action: { a: 'kept' } }); }
  }
  // (the old copy goes as a whole: a visit there that belongs to no patient goes with it)
  const notes = P.notes.map(n => /to no patient/.test(n) ? n.replace(/, so (it stays|they stay) behind\.$/, ': not brought over, and deleted with the old copy.') : n);
  return { old, P, writes, recs: new Set(writes.map(w => w.id)).size, conflicts: conflicts.length, counts: P.counts, notes, sig: planSum(P) };
}
ACT.rmRead = async () => {
  RM.err = ''; RM.step = 'reading'; rmRender();
  try { RM.plan = await rmPlan(); RM.step = 'ready'; }
  catch (e) { console.error(e); RM.step = 'start'; RM.err = errText(e); }
  rmRender();
};
ACT.rmGo = async () => {
  if (!RM.plan) return;
  if (!await confirmBox('Remove the old copy?', 'The IPR Tracker’s patients and visits are deleted from the old database, after anything saved there since the move comes over and every record is checked here. This can’t be undone — but everything stays here, sealed.', 'Remove it', true)) return;
  RM.err = ''; RM.step = 'working'; RM.busy = true; MV.busy = true; rmRender();
  try {
    const Q = await rmPlan();
    if (Q.sig !== RM.plan.sig) { RM.plan = Q; RM.step = 'ready'; RM.err = 'The old copy changed since you checked it. The numbers above are new: look them over and press the button again.'; throw null; }
    // conflicts are two saves to one record, in order: one at a time
    for (const w of Q.writes) { const f = await FB.moveWrite([w]); if (f.length) throw errCode('mismatch', 'A record couldn’t be saved (' + errText(f[0].e) + '). Nothing was deleted; try again.'); }
    // everything in the old copy is here now: each record, with the old one's fingerprint
    const have = await FB.everything(), missing = [];
    Q.P.pts.forEach(x => { const h = have.pts.get(x.id); if (!h || h.body.oh !== x.body.oh) missing.push(x.id); });
    Q.P.vis.forEach(x => { const h = have.vis.get(x.id); if (!h || h.body.oh !== x.body.oh || h.d.p !== x.p) missing.push(x.id); });
    if (missing.length) throw errCode('mismatch', plural(missing.length, 'record') + ' from the old copy aren’t here yet, so nothing was deleted. Try again.');
    // a last look: nothing new in the old copy since (an old page saving right now)
    const again = await rmPlan();
    if (again.writes.length) { RM.plan = again; RM.step = 'ready'; RM.err = 'Something was just saved in the old IPR Tracker. Look it over and press the button again.'; throw null; }
    // delete exactly the records just checked (one saved there this very moment stays, and shows the next time)
    const vdel = {}, pdel = {};
    Object.keys(again.old.visits).forEach(pid => { const g = again.old.visits[pid]; if (g && typeof g === 'object') Object.keys(g).forEach(vid => { vdel[pid + '/' + vid] = null; }); else vdel[pid] = null; });
    Object.keys(again.old.patients).forEach(id => { pdel[id] = null; });
    if (Object.keys(vdel).length) await OLD.call('PATCH', 'nlo/ipr/visits', vdel);
    if (Object.keys(pdel).length) await OLD.call('PATCH', 'nlo/ipr/patients', pdel);
    const [p2, v2] = await Promise.all([OLD.read('nlo/ipr/patients'), OLD.read('nlo/ipr/visits')]);
    if (p2 || v2) { RM.plan = await rmPlan(); RM.step = 'ready'; RM.err = 'Something was saved in the old IPR Tracker just now, so it’s still there. Look it over and press the button again.'; throw null; }
    await OLD.call('PUT', 'nlo/ipr/moved', { at: Date.now(), to: 'IPR_Tracker.html' }).catch(() => { });
    if (!S.removed) { await FB.markMoved('oldRemoved', { pts: Q.counts.pts, vis: Q.counts.vis }); S.removed = { at: Date.now() }; }
    RM.res = { brought: Q.recs }; RM.step = 'done';
    OLD.disconnect().catch(() => { }); RM.who = '';
    IP_SUBS.forEach(f => { try { f(); } catch (e) { } });
  } catch (e) { if (e) { console.error(e); RM.step = RM.plan ? 'ready' : 'start'; RM.err = errText(e); } }
  RM.busy = false; MV.busy = false; rmRender();
};
