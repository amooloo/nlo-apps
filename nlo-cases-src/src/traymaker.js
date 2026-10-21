/* ---------- the Tray Maker on the lab PC (19 Oct 2026) ----------
   The Tray Maker (nlo-bleachtray: the printable models for retainers, whitening trays and mouthguards) shows the cases
   entered here that are waiting for their models - under "To make" in its sidebar - so the lab clicks the case and drops
   the scan instead of typing the name. It never has the office key, so with every save of such a case this app writes a
   small sealed copy for it to `labq/<case id>`: patient, chart #, arches, what to make, remake / scan on file, due and
   delivery dates, who's on it - sealed to the Tray Maker's OWN public key (`labqkeys/<its login>`, which it publishes
   under the lab PC's robot login, the one the lab bridge uses: Team & security → Lab PC). The copy goes with the case's
   own write (same batch / transaction - backend.js) and is deleted the moment the case no longer waits: moved on from
   To make, models noted, completed, deleted. When the Tray Maker sends the models to OrthoFactory (or opens them in
   PreForm for the printer) it puts a sealed note in the inbox (to the office inbox key, like the lab bridge's orders);
   tmSync below notes it on the case (btModels, the same field the Make models button's message sets) and moves the
   case on from To make to Printing (Amir, 19 Oct 2026: "when I work on it and send it to the printer or Trimlign, it
   should write back to the other app and move it to printing"); the case leaves the queue with that save. The
   lab PC seeing the order in OrthoFactory does the same when the note didn't come (tmNoted, 20 Oct 2026).
   Needs the 19 Oct 2026 rules (`labq`, `labqkeys`); until they're live nothing is written (FB.labqOn). ---------- */
const TM = { keys: null, keysAt: 0, warned: false };
/* the Tray Maker's public key: the newest entry in labqkeys (one lab PC; a second would be another entry). Read at most
   every 10 minutes; none = no Tray Maker linked yet = nothing to write */
async function tmKey() {
  if (B !== FB || !FB.labqOn) return null;
  if (TM.keys && Date.now() - TM.keysAt < 600000) return TM.keys;
  try {
    const snap = await FB.db.collection('labqkeys').get(); let best = null;
    snap.forEach(d => { const x = d.data(); if (!x || !x.pub || !x.kid) return; const at = FB.tsMs(x.at) || 0; if (!best || at > best.at) best = { uid: d.id, pub: x.pub, kid: String(x.kid), at, name: String(x.name || '') }; });
    TM.keys = best; TM.keysAt = Date.now();
  } catch (e) { TM.keys = null; TM.keysAt = Date.now() - 540000; if (window.console && !TM.warned) { TM.warned = true; console.warn('tray maker key:', e && e.message); } }
  return TM.keys;
}
/* does this case wait for models? retainer-flow (retainers & whitening, mouthguard), open, at To make, models not in yet */
function tmWaiting(body, status) {
  if (!body || status === 'done' || body.dup) return false;
  const ty = TYPE[body.type]; if (!ty || ty.flow !== 'retainer') return false;
  if (liveStage(body) !== 'print') return false;
  return !(body.btModels && body.btModels.at);
}
/* what the Tray Maker gets to see of the case (plain fields, nothing clinical) */
function tmBody(id, body) {
  const s = (v, n) => String(v == null ? '' : v).slice(0, n || 120);
  return { v: 1, case: id, patient: s(body.patient), chart: s(body.chart, 40), type: s(body.type, 20), arches: (body.arches || []).map(a => s(a, 10)).slice(0, 2),
    retKinds: (body.retKinds || []).map(k => s(k, 20)).slice(0, 4), remake: s(body.remake, 40), scanOnFile: !!body.scanOnFile,
    dueDate: s(body.dueDate, 20), deliveryDate: s(body.deliveryDate, 20), stage: s(body.stage, 20), createdAt: s(body.createdAt || body.scanDate, 30),
    assignee: s(staffName(body.assignee, body.assigneeName || ''), 60), by: s(FB.me && FB.me.name ? FB.me.name : '', 60) };
}
/* the sealed queue document for a case, or null when it doesn't belong in the queue (the caller then deletes it) */
async function tmQueueDoc(id, body, status) {
  if (B !== FB || !FB.labqOn || !tmWaiting(body, status)) return null;
  const k = await tmKey(); if (!k) return null;
  const box = await Crypto.sealTo(k.pub, TE.encode(JSON.stringify(tmBody(id, body))), 'labq:' + id);
  return { ref: FB.db.doc('labq/' + id), data: { kid: k.kid, epk: box.epk, iv: box.iv, ct: box.ct, at: FB.ts() } };
}
/* ---------- the models went out: noted on the case (btModels) and, while it waits at To make, moved to Printing (Amir, 19 Oct
   2026: "when I work on it and send it to the printer or Trimlign, it should write back to the other app and move it to
   printing"). What moves it: the Tray Maker's sealed note (tmSync - the Tray Maker ties its case to the NLO Cases case by the
   patient's name before it sends one), or the lab PC seeing the Tray Maker's order in OrthoFactory (tmLabApply - the patient's
   name, what the order holds, when it was exported). The Tray Maker window's own message (Make models, ui.js) only notes the
   models (`tab`), and only while no Tray Maker is linked: until 20 Oct 2026 it noted them first, which made the note that came
   after look old - it was dropped, and a case made from Make models stayed at To make. ---------- */
/* the note's send is noted already: by a note (not the window's message) as new or newer */
function tmSame(prev, bt) { return !!(prev && prev.at && prev.how && !prev.tab && prev.at >= bt.at); }
/* bt: {at, models, how, pc?, tab?, key?}; `ok(x)`: whether the case as saved still wants it (default: not the same send); `stay`:
   note it without moving the case. Resolves to the step it moved the case to ('' none); a case that doesn't want it rejects
   with code 'skip' */
async function tmNoted(id, bt, log, ok, stay) {
  log = Object.assign({ a: 'bt', models: bt.models, how: bt.how }, log);
  ok = ok || (x => !tmSame(x.btModels, bt));
  await B.mutateCase(id, x => {
    delete log.from; delete log.to;            // (the transaction can run this more than once)
    if (!ok(x)) return 'skip';
    x.btModels = bt;
    // the models are being made: To make -> Printing (only from To make - a case already further on stays where it is)
    if (!stay && liveStage(x) === 'print' && caseStages(x).some(st => st[0] === 'printing')) { log.from = x.stage; log.to = 'printing'; x.stage = 'printing'; }
  }, log);
  const live = S.cases.get(id); if (live) { live.btModels = bt; if (log.to) live.stage = log.to; queueRender(); if (S.openId === id) renderDrawer(); }
  if (S.openId === id && !S.editing) loadHistory(id);
  return log.to || '';
}
/* the Tray Maker's notes in the inbox: {bt:1, v, case, patient, models:[...], at, pc, how} - the case notes the models and
   leaves the queue; a note for a case that isn't here (deleted, or an older copy of the app) is kept a week, then cleared */
async function tmSync(docs, open, closed) {
  for (const d of docs) {
    const m = d.mail || {}; const id = plainStr(m.case), at = typeof m.at === 'number' && m.at > 0 ? m.at : (d.at || Date.now());
    const models = Array.isArray(m.models) ? m.models.map(x => plainStr(x).slice(0, 20)).slice(0, 8) : [];
    // how: 'orthofactory' (Send to Trimlign) or 'printer' (opened in PreForm); a note from before 19 Oct 2026 has none
    const how = plainStr(m.how).slice(0, 20) === 'printer' ? 'printer' : 'orthofactory', bt = { at, models, pc: plainStr(m.pc).slice(0, 60), how };
    const c = (id && (S.cases.get(id) || (closed || []).find(x => x && x.id === id))) || null;
    if (!c) { if (Date.now() - (d.at || Date.now()) > 7 * 864e5) await B.inboxDelete(d.id).catch(() => { }); continue; }
    if (tmSame(c.btModels, bt)) { await B.inboxDelete(d.id).catch(() => { }); continue; } // noted already
    if (!(await B.inboxClaim(d.id))) continue; // another open app is on it
    try {
      const to = await tmNoted(c.id, bt);
      toast('Models for ' + ptNameText(c.patient) + (how === 'printer' ? ' went to the printer' : ' are in OrthoFactory') + ' (Tray Maker) — ' + (to ? 'moved to Printing' : 'noted on the case'));
    } catch (e) { if (!(e && (e.code === 'skip' || e.code === 'gone'))) { if (window.console) console.warn('tray maker note:', e && e.message); continue; } }
    await B.inboxDelete(d.id).catch(() => { });
  }
}
/* the lab PC sees the Tray Maker's order in OrthoFactory (lab.js tmMatch) for the case still waiting at To make for it, the note not
   having reached it (the Tray Maker not linked yet): noted and moved to Printing the same way, once. What's noted is what the
   order holds ("upper WT"). */
async function tmLabApply(o, c) {
  const cur = findCase(c.id); if (!tmLabWaits(cur, o)) return 'skip'; // (moved on, or noted, since the sync began)
  const bt = { at: o.at || Date.now(), models: tmLabModels(o), pc: o.pc || '', how: 'orthofactory', key: o.key };
  try {
    const to = await tmNoted(c.id, bt, { lab: 1, key: o.key }, x => tmLabWaits(Object.assign({}, x, { id: c.id }), o));
    toast('Models for ' + ptNameText(cur.patient) + ' are in OrthoFactory (lab PC) — ' + (to ? 'moved to Printing' : 'noted on the case'));
    return 'ok';
  } catch (e) { if (e && (e.code === 'skip' || e.code === 'gone')) return 'skip'; throw e; }
}
/* "upper WT", "lower TT", … from the order's pieces (whitening tray T…0, retainer A…1, mouthguard T…2, Phase I A…3) */
function tmLabModels(o) {
  const lv = (o && o.lv) || {}, name = { A1: 'TT', A3: 'P1', T0: 'WT', T2: 'MG' }, out = [];
  [['au', 'upper', 'A'], ['tu', 'upper', 'T'], ['al', 'lower', 'A'], ['tl', 'lower', 'T']].forEach(([k, arch, kind]) =>
    Array.from(String(lv[k] || '')).forEach((ch, i) => { if (ch !== '-' && name[kind + i]) out.push(arch + ' ' + name[kind + i]); }));
  return out.slice(0, 8);
}
/* signing out: nothing of this office's stays in the page */
function tmReset() { TM.keys = null; TM.keysAt = 0; }
