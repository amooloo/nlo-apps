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
   Then (the done card) Dr. A locks the old copy to his own Google account
   (../tools/rtdb-rules-ipr-lock.py, in Cloud Shell: an IPR Tracker 3 page
   left open on some computer can't keep saving there) and removes it:
   that reads the old database again, brings over anything saved there
   since the move, checks, and deletes nlo/ipr's patients and visits —
   only if the old copy is still exactly what it read (its ETag), so a
   save there in the meantime is never lost (the mark stays).
   ===================================================================== */
const MV = { step: 'start', who: '', plan: null, done: 0, total: 0, err: '', res: null, checked: false, busy: false };
const LOCK_CMD = 'curl -sO https://amooloo.github.io/nlo-apps/tools/rtdb-rules-ipr-lock.py && python3 rtdb-rules-ipr-lock.py';

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
  /* the old database's REST API, with this sign-in. o: { body, etag: true (ask for the data's ETag), ifMatch: <ETag> (write only
     if the data there is still exactly that) } → { status, data, etag }; a refused ifMatch (412: changed since) is an answer */
  async req(method, path, o) {
    o = o || {};
    const u = await OLD.user(); if (!u) throw errCode('no-old', 'Not connected to the old IPR Tracker.');
    const tok = await u.getIdToken();
    const url = (S.emu ? 'http://127.0.0.1:9000/' : OLD_FB.databaseURL + '/') + path + '.json?' + (S.emu ? 'ns=demo-nlo-cases&' : '') + 'auth=' + encodeURIComponent(tok);
    const headers = {};
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.etag) headers['X-Firebase-ETag'] = 'true';
    if (o.ifMatch) headers['if-match'] = o.ifMatch;
    let r;
    try { r = await fetch(url, { method, cache: 'no-store', credentials: 'omit', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }); }
    catch (e) { throw errCode('unavailable', 'Couldn’t reach the old IPR Tracker. Check the internet connection.'); }
    if (r.status === 401 || r.status === 403) throw errCode('permission-denied', 'This Google account (' + (u.email || 'not Dr. A’s') + ') can’t ' + (method === 'GET' ? 'read' : 'change') + ' the old IPR Tracker. Connect with Dr. A’s Google account.');
    if (r.status === 412 && o.ifMatch) return { status: 412, data: null, etag: r.headers.get('ETag') || '' };
    if (!r.ok) throw errCode('unavailable', 'The old IPR Tracker answered ' + r.status + '.');
    return { status: r.status, data: await r.json(), etag: r.headers.get('ETag') || '' };
  },
  async call(method, path, body) { return (await OLD.req(method, path, { body })).data; },
  read(path) { return OLD.call('GET', path); }
};
/* everything under nlo/ipr, read at once, with its ETag (the old database's fingerprint of that data) */
function asObj(v) {
  if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { if (x != null) o[String(i)] = x; }); return o; }
  return v && typeof v === 'object' ? v : {};
}
async function readOld() {
  const r = await OLD.req('GET', 'nlo/ipr', { etag: true }), all = asObj(r.data), other = {};
  Object.keys(all).forEach(k => { if (k !== 'patients' && k !== 'visits' && k !== 'moved') other[k] = all[k]; });
  return { patients: asObj(all.patients), visits: asObj(all.visits), moved: all.moved || null, other, etag: r.etag };
}

/* ---------- working out the move (nothing is saved here): the old records → the sealed records ----------
   → { pts: [{ id, body }], vis: [{ id, p, body }], orphans: [{ pk, vk }], counts, notes, first, last }.
   have (Remove the old copy): the records here — a visit whose patient is here already (taken out of the old copy before, the
   visit saved there after by an old page left open) comes over to that patient. */
const okId = id => typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_.:-]+$/.test(id) && !/^__.*__$/.test(id);
/* the id a record keeps here: its old one — or, for one with characters this database can't take (only a hand edit makes
   one), the same new one every time */
async function idFor(k) { return okId(k) ? k : 'm' + (await Crypto.sha256hex('ipr-old-id:' + k)).slice(0, 31); }
/* a fingerprint of an old record exactly as it was read (any order of keys): kept, sealed, with the record here, so "Remove
   the old copy" can tell a record that changed in the old database after the move */
async function oldHash(row) { return (await Crypto.sha256hex(canonJSON(row))).slice(0, 32); }
async function planMove(old, names, have) {
  const pts = [], vis = [], orphans = [], notes = [], skipped = { renamed: 0, junk: 0 };
  const counts = { pts: 0, vis: 0, named: 0, unnamed: 0, mismatch: 0, twoNames: 0, orphans: 0 };
  const group = new Map();   // the key the old app filed a patient's visits under → that patient's id here
  const seenVis = new Set();
  let first = '', last = '';
  for (const k of Object.keys(old.patients)) {
    const r = old.patients[k];
    if (!r || typeof r !== 'object') { skipped.junk++; continue; }
    const id = await idFor(k); if (id !== k) skipped.renamed++;
    const chart = String(r.patient_id == null ? '' : r.patient_id).trim();
    // the old app kept the initials in "name" (or the chart # again when none were typed)
    let ini = String(r.name == null ? '' : r.name).trim(); if (ini === chart) ini = '';
    const body = { chart, name: '', at: String(r.created_at || ''), oh: await oldHash(r) };
    if (ini) body.ini = ini;
    const list = names.get(iprNorm(chart)) || [], one = FB.oneName(list);
    if (one && fitsInitials(one, ini)) { body.name = one; counts.named++; }
    else { counts.unnamed++; if (one) counts.mismatch++; else if (list.length) counts.twoNames++; }
    pts.push({ id, body }); counts.pts++;
    // (IPR Tracker 3 filed a patient's visits under the record's own id field — the same as its key, for every record it made)
    group.set(k, id);
    if (typeof r.id === 'string' && r.id && r.id !== k && !old.patients[r.id] && !group.has(r.id)) group.set(r.id, id);
  }
  for (const pk of Object.keys(old.visits)) {
    const grp = old.visits[pk]; if (!grp || typeof grp !== 'object') { skipped.junk++; continue; }
    let p = group.get(pk) || null;
    if (!p && have) { const m = await idFor(pk); p = have.pts.has(pk) ? pk : have.pts.has(m) ? m : null; }
    for (const vk of Object.keys(grp)) {
      const r = grp[vk];
      if (!r || typeof r !== 'object') { skipped.junk++; continue; }
      if (!p) { orphans.push({ pk, vk }); counts.orphans++; continue; }
      // (the same visit key under two patients — only a hand edit makes that — or here already under another patient: a stable id
      // of its own, so neither is lost)
      let id = await idFor(vk);
      if (seenVis.has(id) || (have && have.vis && have.vis.has(id) && have.vis.get(id).d.p !== p)) id = await idFor(pk + '/' + vk);
      seenVis.add(id); if (id !== vk) skipped.renamed++;
      const body = FB.cleanVis(r); delete body.patient_uuid; delete body.id;
      body.oh = await oldHash(r);
      vis.push({ id, p, body }); counts.vis++;
      const d = String(r.date || ''); if (d) { if (!first || d < first) first = d; if (!last || d > last) last = d; }
    }
  }
  if (counts.mismatch) notes.push(plural(counts.mismatch, 'patient') + ': the name NLO Cases has for the chart # doesn’t fit the initials here, so it isn’t used; the initials stay until someone adds the full name.');
  if (counts.twoNames) notes.push(plural(counts.twoNames, 'patient') + ': NLO Cases has two different names for the chart #, so neither is used.');
  if (counts.orphans) notes.push(plural(counts.orphans, 'visit') + (counts.orphans === 1 ? ' belongs' : ' belong') + ' to no patient (the old app never showed ' + (counts.orphans === 1 ? 'it' : 'them') + '), so ' + (counts.orphans === 1 ? 'it isn’t' : 'they aren’t') + ' moved.');
  if (skipped.renamed) notes.push(plural(skipped.renamed, 'record') + ' get a new record id here (the old one has characters this database can’t take).');
  if (skipped.junk) notes.push(plural(skipped.junk, 'empty entry', 'empty entries') + ' in the old database aren’t moved.');
  return { pts, vis, orphans, counts, notes, first, last };
}
function planSum(P) { return JSON.stringify([P.counts, P.first, P.last, P.notes.length, P.pts.map(p => p.id + p.body.oh), P.vis.map(v => v.id + v.p + v.body.oh), P.orphans.map(o => o.pk + '/' + o.vk)]); }
/* the names NLO Cases has for every chart # in the old records */
async function namesFor(old) {
  const charts = Array.from(new Set(Object.values(old.patients).filter(r => r && typeof r === 'object').map(r => String(r.patient_id == null ? '' : r.patient_id).trim()).filter(Boolean)));
  return FB.caseNames(charts);
}

/* ---------- the move card ---------- */
function moveCardHTML() {
  const st = MV.step, P = MV.plan;
  let h = '<div class="card gateCard moveCard"><div class="cardHd"><h3>Move the IPR Tracker over</h3><span class="sub">one time, a few minutes</span></div><div class="cardBd">';
  if (st === 'start' || st === 'connecting' || st === 'reading') {
    h += '<p class="small">The IPR Tracker now signs in with NLO Cases logins, locks after ' + idleMinutes() + ' minutes like NLO Cases, and seals every patient and visit with the office key. Its patients and visits move here from the old IPR Tracker once, each with the full name NLO Cases has for the chart #.</p>' +
      '<ol class="steps small"><li><b>Connect to the old IPR Tracker</b> with your Google account (or the office one).</li><li>Look over what it found, then press <b>Move it now</b>.</li><li>Every record is checked here before the IPR Tracker opens. Then you remove the old copy (and lock it, recommended) — this card shows how.</li></ol>' +
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
      '<p class="small">From now on everyone signs in here with their NLO Cases login' + (MV.markErr ? '.' : '; the old IPR Tracker’s page sends them here.') + '</p>' +
      (MV.markErr ? '<div class="hint">The old IPR Tracker’s database didn’t take the mark that sends its page here (' + esc(MV.markErr) + '), so an old page someone opens still works on its own until the old copy is removed.</div>' : '') +
      '<div class="mvNext"><p class="small" style="margin-top:14px"><b>While you’re here:</b></p><ol class="steps small">' +
      '<li><b>Remove the old copy</b> (a minute): anything saved there meanwhile comes over first, every record is checked, then the unencrypted copy is deleted.' +
      '<div class="btnRow" style="margin-top:8px"><button class="btn btn-sec btn-sm" data-act="mvRemove">Remove the old copy</button></div></li>' +
      '<li><b>Lock the old copy</b> (recommended, two minutes): only your Google account can then use it, so an IPR Tracker page left open on some computer since before today can’t keep saving there. Open <b>Cloud Shell</b> (signed in as you), paste the command, look over what it shows, and answer <b>y</b>.' +
      lockCmdHTML() + '</li></ol></div>' +
      '<div class="btnRow"><button class="btn btn-pri" data-act="mvOpen">Open the IPR Tracker</button></div>';
  } else if (st === 'error') {
    h += '<div class="lockErr" role="alert">' + esc(MV.err || 'The move stopped.') + '</div><p class="small">Nothing is marked moved, and the old IPR Tracker wasn’t changed. Running the move again saves the same records under the same ids, so it’s safe to try again.</p>' +
      '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="mvRead">Read it again</button></div>';
  }
  return h + '</div></div>';
}
/* the Cloud Shell command that locks the old copy to Dr. A (../tools/rtdb-rules-ipr-lock.py) */
function lockCmdHTML() {
  return '<div class="cmdBox"><code>' + esc(LOCK_CMD) + '</code></div>' +
    '<div class="btnRow" style="margin-top:8px"><button class="btn btn-sec btn-sm" data-act="mvCopyCmd">' + ic('copy', 15) + 'Copy the command</button><a class="btn btn-ghost" href="https://shell.cloud.google.com/?show=terminal" target="_blank" rel="noopener noreferrer">Open Cloud Shell</a></div>';
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
  try { const old = await readOld(); MV.plan = await planMove(old, await namesFor(old), null); MV.step = 'ready'; }
  catch (e) { console.error(e); MV.step = MV.plan ? 'error' : 'start'; MV.err = errText(e); MV.plan = null; }
  renderGate();
};
ACT.mvGo = async () => {
  if (!MV.plan) return;
  if (!await confirmBox('Move the IPR Tracker now?', 'Make sure nobody is charting in the old IPR Tracker. It takes a minute or two; keep this page open.', 'Move it now')) return;
  MV.err = ''; MV.step = 'rereading'; MV.busy = true; renderGate();
  try {
    // read it all again: anything different from what the card showed, and the card shows the new numbers instead
    const old = await readOld(), P = await planMove(old, await namesFor(old), null);
    if (planSum(P) !== planSum(MV.plan)) {
      MV.plan = P; MV.step = 'ready'; MV.busy = false;
      MV.err = 'The old IPR Tracker changed since you read it. The numbers above are new: look them over and press Move it now again.';
      renderGate(); return;
    }
    MV.plan = P;
    await doMove(P);
    // the old page sends everyone here from now on (a mark only: nothing about anyone)
    MV.markErr = '';
    await OLD.call('PUT', 'nlo/ipr/moved', { at: Date.now(), to: 'IPR_Tracker.html' }).catch(e => { console.warn('moved mark', e); MV.markErr = errText(e); });
    OLD.disconnect().catch(() => { }); MV.who = '';
    MV.step = 'done';
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
ACT.mvCopyCmd = () => { navigator.clipboard.writeText(LOCK_CMD).then(() => toast('Copied — paste it in Cloud Shell and press Enter.', { ms: 6000 }), () => toast('Couldn’t copy — select the command and copy it by hand.', { bad: true })); };
ACT.mvRemove = () => rmOpen();

/* ---------- "Remove the old copy" (Dr. A: the move's done card, or the app's menu) ----------
   The old database is read again; anything saved there after the move (an old page left open) comes over first — a record
   changed in both places keeps this one's version, the old one going into its history — then every record is checked, and the
   old copy is deleted only if it is still exactly the copy read (its ETag): a save there in the meantime, and nothing is
   deleted (the mark that sends the old page here stays). */
const RM = { step: 'start', who: '', plan: null, err: '', res: null, busy: false, markErr: '' };
function rmOpen() {
  RM.err = ''; RM.res = null; RM.plan = null; RM.step = 'start'; RM.markErr = '';
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
    h += '<p class="small">The old IPR Tracker’s database still has a copy of the patients and visits, unencrypted. Take it out: anything saved there since the move comes over first, every record is checked here, and then the old copy is deleted. Connect with your own Google account (once the old copy is locked, it’s the only one that can).</p>' +
      (RM.err ? '<div class="lockErr" role="alert">' + esc(RM.err) + '</div>' : '') +
      '<div class="btnRow">' + (RM.who ? '<span class="small muted" style="align-self:center">Connected as <b>' + esc(RM.who) + '</b></span><button class="btn btn-pri btn-sm" data-act="rmRead"' + (st !== 'start' ? ' disabled' : '') + '>' + (st === 'reading' ? 'Reading…' : 'Check the old copy') + '</button>'
        : '<button class="btn btn-pri btn-sm" data-act="rmConnect"' + (st !== 'start' ? ' disabled' : '') + '>' + ic('google', 16) + (st === 'reading' ? 'Reading…' : 'Connect to the old IPR Tracker') + '</button>') + '</div>';
  } else if ((st === 'ready' || st === 'working') && P) {
    const c = P.counts;
    h += '<p class="small">In the old database now:</p>' + row('Patients', c.pts) + row('Visits', c.vis) +
      (c.orphans ? row('Visits that belong to no patient', '<span class="stat off">' + c.orphans + '</span> <span class="muted">(no app ever showed them; they can’t be brought here, so they’re deleted with the old copy)</span>') : '') +
      row('Saved there since the move', P.recs ? '<span class="stat off">' + plural(P.recs, 'record') + '</span> <span class="muted">(they come over first)</span>' : '<span class="stat ok">nothing</span>') +
      (P.conflicts ? row('Changed in both places', P.conflicts + ' <span class="muted">(this IPR Tracker’s version is kept; the old one goes into its history)</span>') : '') +
      (P.notes.length ? '<div class="hint"><ul class="mvNotes">' + P.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul></div>' : '') +
      (RM.err ? '<div class="lockErr" role="alert">' + esc(RM.err) + '</div>' : '') +
      (c.pts + c.vis + c.orphans ? '<div class="btnRow"><button class="btn btn-danger" data-act="rmGo"' + (st === 'ready' ? '' : ' disabled') + '>' + (st === 'working' ? 'Working…' : P.writes.length ? 'Bring them over and remove the old copy' : 'Remove the old copy') + '</button></div>'
        : '<p class="small"><b>The old copy is empty.</b> Nothing left to remove.</p>');
  } else if (st === 'done' && RM.res) {
    h += '<p class="small"><b>Removed.</b> ' + (RM.res.brought ? plural(RM.res.brought, 'record') + ' saved in the old IPR Tracker since the move came over first; ' : '') + 'the old database no longer has the IPR Tracker’s patients or visits. Everything is here, sealed.</p>' +
      '<p class="small muted">The old database’s daily backups from before today still hold it; they delete themselves after a year.</p>' +
      '<p class="small" style="margin-top:12px"><b>Recommended, if it isn’t done yet: lock the old copy</b> to your Google account, so an IPR Tracker page left open on some computer since before the move can’t save there. In <b>Cloud Shell</b> (signed in as you): paste the command and answer <b>y</b>.</p>' + lockCmdHTML() +
      (RM.markErr ? '<div class="hint">It wasn’t noted here as removed (' + esc(RM.markErr) + '); checking the old copy again notes it.</div>' : '') +
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
/* the old copy now, against what's here: the writes that bring over what changed there since the move */
async function rmPlan() {
  const old = await readOld(), have = await FB.everything();
  const P = await planMove(old, new Map(), have);   // (names aren't looked up again: a record here keeps the one it has)
  const writes = []; let conflicts = 0;
  const sameOld = (h, x) => h && h.body.oh && h.body.oh === x.body.oh;
  for (const x of P.pts) {
    const h = have.pts.get(x.id);
    if (!h) { writes.push({ kind: 'pt', id: x.id, body: Object.assign({}, x.body), mode: 'create', action: { a: 'old-copy' } }); continue; }
    if (sameOld(h, x)) continue;
    // a patient changed in the old database (the old page never changes one — only a hand edit could): this one's chart # and
    // name stay; the fingerprint is the old record's now, and its initials come along if this one has none
    const nb = Object.assign({}, h.body, { oh: x.body.oh }); if (x.body.ini && !nb.ini) nb.ini = x.body.ini;
    writes.push({ kind: 'pt', id: x.id, body: nb, mode: 'update', rev: h.d.rev, action: { a: 'old-copy' } });
  }
  for (const x of P.vis) {
    const h = have.vis.get(x.id);
    if (!h) { writes.push({ kind: 'vis', id: x.id, p: x.p, body: x.body, mode: 'create', action: { a: 'old-copy' } }); continue; }
    if (sameOld(h, x)) continue;
    // changed in the old database since the move: if nobody saved it here since, the old one's version comes over; if both
    // changed, the old version goes into this one's history and this one's version stays on top. (An old page saving a visit
    // whose record it no longer finds there writes it without its created_at: this one's is kept.)
    const body = Object.assign({}, x.body); if (!body.created_at && h.body.created_at) body.created_at = h.body.created_at;
    const hist = await FB.historyOf('vis', x.id), editedHere = hist.some(e => e.a && e.a !== 'move' && e.a !== 'old-copy');
    if (!editedHere && h.d.p === x.p) writes.push({ kind: 'vis', id: x.id, p: x.p, body, mode: 'update', rev: h.d.rev, action: { a: 'old-copy' } });
    else { conflicts++; writes.push({ kind: 'vis', id: x.id, p: x.p, body, mode: 'both', rev: h.d.rev }); }
  }
  const notes = P.notes.filter(n => !/ to no patient /.test(n));   // (they have their own row)
  return { old, P, writes, recs: new Set(writes.map(w => w.id)).size, conflicts, counts: P.counts, notes, sig: planSum(P) };
}
/* one write bringing a record over; each checks the record here is still the one planned against (rev) */
async function rmWrite(w) {
  const put = (b, nb) => { Object.keys(b).forEach(k => delete b[k]); Object.assign(b, JSON.parse(JSON.stringify(nb))); };
  const same = d => { if (d.rev !== w.rev) throw errCode('changed', 'it was saved here a moment ago'); };
  try {
    if (w.mode === 'create') await FB.create(w.kind, w.id, w.body, { p: w.p, action: w.action });
    else if (w.mode === 'update') await FB.mutate(w.kind, w.id, (b, d) => { same(d); put(b, w.body); }, w.action);
    else {
      // changed in both places: the old version saved over this one, then this one's put back on top — the old version stays in
      // the history in between (and if someone saves here in between, theirs stays on top)
      let keep = null;
      const a = await FB.mutate('vis', w.id, (b, d) => { same(d); keep = JSON.parse(JSON.stringify(b)); put(b, w.body); }, { a: 'old-copy' });
      await FB.mutate('vis', w.id, (b, d) => { if (d.rev !== a.rev) return false; put(b, Object.assign({}, keep, { oh: w.body.oh })); }, { a: 'kept' });
    }
  } catch (e) { throw errCode('mismatch', 'A record couldn’t be brought over (' + errText(e) + '). Nothing was deleted; try again.'); }
}
ACT.rmRead = async () => {
  RM.err = ''; RM.step = 'reading'; rmRender();
  try {
    const plan = await rmPlan(), c = plan.counts;
    // empty already (removed before, and it wasn't noted here then): noted now
    if (!c.pts && !c.vis && !c.orphans && !S.removed) { try { await FB.markMoved('oldRemoved', { pts: 0, vis: 0 }); S.removed = { at: Date.now() }; } catch (e) { } }
    RM.plan = plan; RM.step = 'ready';
  } catch (e) { console.error(e); RM.step = 'start'; RM.err = errText(e); }
  rmRender();
};
ACT.rmGo = async () => {
  if (!RM.plan) return;
  const n = RM.plan.counts.orphans;
  if (!await confirmBox('Remove the old copy?', 'The IPR Tracker’s patients and visits are deleted from the old database, after anything saved there since the move comes over and every record is checked here.' +
    (n ? ' The ' + plural(n, 'visit') + ' that belong' + (n === 1 ? 's' : '') + ' to no patient ' + (n === 1 ? 'is' : 'are') + ' deleted with it.' : '') + ' This can’t be undone — but everything stays here, sealed.', 'Remove it', true)) return;
  RM.err = ''; RM.markErr = ''; RM.step = 'working'; RM.busy = true; MV.busy = true; rmRender();
  try {
    const Q = await rmPlan();
    if (Q.sig !== RM.plan.sig) { RM.plan = Q; RM.step = 'ready'; RM.err = 'The old copy changed since you checked it. The numbers above are new: look them over and press the button again.'; throw null; }
    if (!Q.old.etag) throw errCode('unavailable', 'The old database didn’t say which copy it has, so nothing was deleted. Try again.');
    // conflicts are two saves to one record, in order: one at a time
    for (const w of Q.writes) await rmWrite(w);
    // everything in the old copy is here now: each record, with the old one's fingerprint (and each visit with its patient)
    const have = await FB.everything(), missing = [];
    Q.P.pts.forEach(x => { const h = have.pts.get(x.id); if (!h || h.body.oh !== x.body.oh) missing.push(x.id); });
    Q.P.vis.forEach(x => { const h = have.vis.get(x.id); if (!h || h.body.oh !== x.body.oh || h.d.p !== x.p) missing.push(x.id); });
    if (missing.length) throw errCode('mismatch', plural(missing.length, 'record') + ' from the old copy aren’t here yet, so nothing was deleted. Try again.');
    // the old copy goes — only if it's still exactly the copy read above: a save there meanwhile, and nothing is deleted
    const keep = Object.assign({}, Q.old.other, { moved: Q.old.moved || { at: Date.now(), to: 'IPR_Tracker.html' } });
    const r = await OLD.req('PUT', 'nlo/ipr', { body: keep, ifMatch: Q.old.etag });
    if (r.status === 412) { RM.plan = await rmPlan(); RM.step = 'ready'; RM.err = 'Something was saved in the old IPR Tracker just now, so nothing was deleted. Look it over and press the button again.'; throw null; }
    if (!S.removed) { try { await FB.markMoved('oldRemoved', { pts: Q.counts.pts, vis: Q.counts.vis }); S.removed = { at: Date.now() }; } catch (e) { RM.markErr = errText(e); } }
    RM.res = { brought: Q.recs }; RM.step = 'done';
    OLD.disconnect().catch(() => { }); RM.who = '';
    IP_SUBS.forEach(f => { try { f(); } catch (e) { } });
  } catch (e) { if (e) { console.error(e); RM.step = RM.plan ? 'ready' : 'start'; RM.err = errText(e); } }
  RM.busy = false; MV.busy = false; rmRender();
};
