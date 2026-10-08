/* =====================================================================
   The account panel: who to call, why it's on the list, one tap to log
   what was done, follow-up, Dr. A's OK, the refund checklist, history.
   ===================================================================== */
function groupOf(a, it) {
  if (a) return a.credit > 0 && !(a.pd > 0) ? 'cr' : a.ins ? 'ins' : 'pt';
  return it && it.kind === 'cr' ? 'cr' : it && it.src === 'ins' ? 'ins' : 'pt';
}
async function idFor(key) { if (!S.keyIds.has(key)) S.keyIds.set(key, await B.itemId(key)); return S.keyIds.get(key); }
/* change an account's record: shown at once, saved (sealed) in the background. The same change is applied again to the latest
   saved copy, so two people working at once never undo each other; if it can't be saved, the saved copy comes back. */
async function change(key, fn0, action, okMsg) {
  const a = S.byKey.get(key), cur = itemFor(key), now = Date.now();
  const base = cur ? null : a ? Object.assign(blankItem(a), { createdAt: now, createdBy: meSid() }) : null;
  if (!cur && !base) return false;
  // an account resolved before (on the list again, or resolved long ago and not loaded): working it reopens it, and its collections ladder starts over
  const fn = !cur || isBack(cur) ? d => { if (d.state === 'done') reopenItem(d, { by: meSid(), note: 'On the list again', fresh: true }, now); fn0(d); } : fn0;
  const id = cur ? cur.id : await idFor(key);
  const copy = JSON.parse(JSON.stringify(cur || base)), had = new Set(((cur || base).log || []).map(e => e && e.id));
  try { fn(copy); } catch (e) { toast(errText(e), { bad: true }); return false; }
  Object.assign(copy, { id, updatedAt: now, by: meSid() });
  S.items.set(id, copy); indexItems(); queueRender(); if (S.openKey === key) renderDrawer();
  S.pend[id] = (S.pend[id] || 0) + 1;
  // what was just done, as a note for Edge (offered with the confirmation)
  const added = (copy.log || []).filter(e => e && !had.has(e.id)), last = added[added.length - 1], en = last ? edgeNote(copy, last) : '';
  return B.mutateItem(id, fn, action, base).then(() => { if (okMsg) toast(okMsg, en ? { actions: [edgeAct(en, last)] } : {}); return true; }, e => {
    toast(errText(e), { bad: true }); if (!S.srv[id]) S.srv[id] = cur || 'gone'; return false;
  }).then(ok => {
    if (!--S.pend[id]) {
      delete S.pend[id]; const srv = S.srv[id]; delete S.srv[id];
      if (srv === 'gone') S.items.delete(id); else if (srv) S.items.set(id, srv);
      indexItems(); queueRender(); if (S.openKey === key) renderDrawer();
    }
    return ok;
  });
}

/* ---------- notes for Edge: what was done, as a line to paste into the patient's notes there ---------- */
function edgeNote(it, e) {
  const c = it && it.src === 'ins' ? carrierFor(it.key) : null;
  return edgeNoteOf(it, e, sid => shortName(sid) || '', c && c.name ? c.name : '');
}
/* entries copied for Edge on this computer (until the page closes), so the panel can say so */
const edgeCpKey = e => (e && e.at) + '|' + (e && e.k);
function edgeCopied(e) { return !!(S.edgeCp && S.edgeCp.has(edgeCpKey(e))); }
async function copyForEdge(text, entries) {
  const ok = await copyText(text);
  if (ok) {
    S.edgeCp = S.edgeCp || new Set(); (entries || []).forEach(e => S.edgeCp.add(edgeCpKey(e)));
    const lb = $('#logBox'); if (lb && S.openKey) lb.innerHTML = logHTML(itemFor(S.openKey));
    if ($('#obListBox')) refreshOBList();
  }
  toast(ok ? 'Copied for Edge — paste it into the patient’s notes there' : 'Couldn’t copy — select the note and copy it by hand', ok ? {} : { bad: true });
  return ok;
}
/* the "Copy for Edge" button on a confirmation */
function edgeAct(text, e) { return { t: 'Copy for Edge', fn: () => copyForEdge(text, e ? [e] : []) }; }
/* after a step done for many accounts at once: each account's note, to paste into each one in Edge */
function edgeNotesModal(title, rows) {
  if (!rows || !rows.length) return;
  S.edgeList = rows;
  openModal('<h3>' + esc(title) + '</h3><div class="lsub">One note per account — paste each into that patient’s notes in Edge.</div><div class="etList">' + rows.map((r, i) =>
    '<div class="etRow"><div class="grow"><div class="etT">' + esc(r.name) + '</div><div class="ebTx small">' + esc(r.text) + '</div></div><div class="ebBtns">' +
    '<button class="btn btn-sec btn-sm" data-act="copyEdgeRow" data-i="' + i + '">' + ic('copy', 14) + 'Copy note</button><button class="btn btn-ghost btn-sm" data-act="copyVal" data-v="' + esc(r.name) + '">Copy name</button></div></div>').join('') +
    '</div><div class="mFt" style="margin-top:14px"><button class="btn btn-pri" data-act="closeModal">Done</button></div>');
}
/* the newest entry of each account just changed, as Edge notes (for edgeNotesModal) */
function edgeRows(accts) {
  return (accts || []).map(a => { const it = itemFor(a.key), e = it && (it.log || [])[it.log.length - 1], text = e ? edgeNote(it, e) : ''; return text ? { key: a.key, name: a.patient, text, e } : null; }).filter(Boolean);
}
Object.assign(ACT, {
  copyEdge(t) { const it = itemFor(curKey()), e = it && (it.log || []).find(x => x && x.id === t.dataset.id), n = e ? edgeNote(it, e) : ''; if (n) copyForEdge(n, [e]); },
  copyEdgeDay() { const L = edgeToday(itemFor(curKey())); if (L.length) copyForEdge(L.map(x => x.n).join('\n'), L.map(x => x.e)); },
  copyEdgeRow(t) {
    const r = S.edgeList && S.edgeList[Number(t.dataset.i)]; if (!r) return;
    copyForEdge(r.text, [r.e]).then(ok => { if (ok) { t.innerHTML = ic('tick', 14) + 'Copied'; t.classList.add('done'); } });
  }
});
/* today's entries on an account that make an Edge note, oldest first */
function edgeToday(it) {
  const t = todayISO();
  return ((it && it.log) || []).filter(e => e && e.at && isoOf(new Date(e.at)) === t).map(e => ({ e, n: edgeNote(it, e) })).filter(x => x.n);
}

/* ---------- drawer ---------- */
function openDrawer(key) {
  S.openKey = key; S.ui = {}; S.history = null; S.earlier = null;
  if (!$('#drawer')) {
    const scrim = document.createElement('div'); scrim.id = 'scrim'; scrim.dataset.act = 'closeDrawer'; document.body.appendChild(scrim);
    const d = document.createElement('aside'); d.id = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Account'); document.body.appendChild(d);
  }
  renderDrawer(); loadHistory(key);
}
function closeDrawer() { S.openKey = ''; S.ui = {}; const d = $('#drawer'), s = $('#scrim'); if (d) d.remove(); if (s) s.remove(); }
function refreshDrawer() { if (S.openKey) renderDrawer(); }
async function loadHistory(key) {
  const it = itemFor(key); if (!it || !it.id || !B.itemLog) return;
  try { const h = await B.itemLog(it.id); if (S.openKey === key) { S.history = h; const el = $('#histBox'); if (el) el.innerHTML = historyHTML(); } } catch (e) { }
}
/* typed text survives the panel being redrawn by a live update */
function keepInputs(root) { const k = {}; $$('[data-keep]', root).forEach(i => { k[i.id] = i.value; }); const a = document.activeElement; return { k, focus: a && root.contains(a) ? a.id : '', scroll: ($('.dBd', root) || {}).scrollTop || 0 }; }
function restoreInputs(root, s) { Object.keys(s.k).forEach(id => { const i = $('#' + id, root); if (i && s.k[id]) i.value = s.k[id]; }); if (s.focus) { const f = $('#' + s.focus, root); if (f) f.focus(); } const bd = $('.dBd', root); if (bd) bd.scrollTop = s.scroll; }
function renderDrawer() {
  const d = $('#drawer'); if (!d) return;
  const key = S.openKey, a = S.byKey.get(key) || null, it = itemFor(key);
  if (!a && !it) { d.innerHTML = '<div class="dHd"><div style="flex:1"><h3>Not in this report</h3></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd"><div class="notice info">This account isn’t past due or in credit in the latest report.</div></div>'; return; }
  const keep = keepInputs(d), g = groupOf(a, it), back = isBack(it), done = !!it && it.state === 'done' && !back;
  const name = a ? a.patient : it.name, rp = a ? a.rp : it.rp, ins = a ? a.ins : it.src === 'ins';
  let h = '<div class="dHd"><div style="flex:1;min-width:0"><h3>' + esc(name) + '</h3><div class="sub">' +
    (a ? stsBadge(a) + srcBadge(a) : '<span class="badge ' + (ins ? 's-ins' : 's-pt') + '">' + (ins ? 'Insurance' : 'Patient') + '</span>') +
    (a && a.tier ? tierChip(a) : '') +
    (done ? '<span class="badge t-ok">' + esc(OUTCOMES[it.outcome] || 'Resolved') + '</span>' : '') + '</div>' +
    '<div class="small muted" style="margin-top:6px">' + (ins ? 'Insurance subscriber: ' : 'Responsible party: ') + esc(String(rp || '').replace(/^\s*ins\s*:\s*/i, '')) + '</div></div>' +
    '<button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd">';
  if (!a) h += '<div class="notice info">Not past due or in credit in the ' + esc(S.rep ? fmtDateLong(S.rep.asOf) : 'latest') + ' report — paid or fixed in Edge.' + (it && it.state === 'open' ? ' <button class="linkBtn" data-act="resolveCleared">Close it as cleared</button>' : '') + '</div>';
  if (back) h += '<div class="notice info">Resolved ' + esc(fmtDate(isoOf(new Date(it.resolvedAt || it.updatedAt || 0)))) + ' (' + esc(String(OUTCOMES[it.outcome] || 'resolved').toLowerCase()) + '), but it’s ' + (a.pd > 0 ? 'past due' : 'in credit') + ' again in the ' + esc(fmtDate(S.rep.asOf)) + ' report. Logging anything reopens it.</div>';
  if (a) h += contactHTML(a) + (a.ins ? carrierBoxHTML(a) : obBoxHTML(a)) + numbersHTML(a) + whyHTML(a);
  if (it && it.drA && !done) h += drABoxHTML(it);
  const L = a && !done ? ladFor(a) : null;
  if (L) h += ladderHTML(a, it, L);
  if (!done) h += nowHTML(a, it, g);
  h += workHTML(it, done);
  if (g === 'cr') h += checksHTML(it, done);
  h += '<div class="sec"><h5>What’s been done</h5><div id="logBox">' + logHTML(it) + '</div></div>';
  if (a && S.reports.length > 1) h += '<div class="sec"><h5>Earlier reports</h5><div id="earlierBox">' + (S.earlier && S.earlier.key === key ? earlierHTML() : '<button class="btn btn-ghost" data-act="loadEarlier">' + ic('clock', 15) + 'Show this account in earlier reports</button>') + '</div></div>';
  h += '<div class="sec"><h5>History</h5><div id="histBox">' + historyHTML() + '</div></div></div>';
  h += '<div class="dFt">' + (it && done ? '<button class="btn btn-sec btn-sm" data-act="reopen">' + ic('refresh', 15) + 'Reopen</button>' : '<button class="btn btn-pri btn-sm" data-act="resolve">' + ic('done', 15) + 'Resolve…</button>') +
    (a ? '<button class="btn btn-ghost" data-act="copyVal" data-v="' + esc(a.patient) + '" title="Copy the name to look the account up in Edge">' + ic('copy', 15) + 'Copy name for Edge</button>' : '') +
    (isOwner() && it && it.id && !S.demo ? '<span style="flex:1"></span><button class="btn btn-ghost" data-act="versions">' + ic('clock', 15) + 'Versions</button>' : '') + '</div>';
  d.innerHTML = h; restoreInputs(d, keep); paintPhotos(d);
}
function contactHTML(a) {
  const row = (label, p) => { const t = telHref(p); return '<div class="cRow">' + ic('call', 16) + (t ? '<a href="' + esc(t) + '">' + esc(phoneTxt(p)) + '</a><span class="small muted">' + label + '</span><button class="btn btn-ghost" data-act="copyVal" data-v="' + esc(phoneTxt(p)) + '">' + ic('copy', 14) + 'Copy</button>' : '<span class="muted">' + esc(label) + ': ' + (p ? esc(p) : 'none on file') + '</span>') + '</div>'; };
  return '<div class="contact">' + row('Home', a.home) + (a.work ? row('Work', a.work) : '') + '</div>';
}
function numbersHTML(a) {
  const cell = (k, v, cls, s) => '<div><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  let h = '<div class="numGrid">' + (a.pd > 0 ? cell('Past due', money(a.pd, true), 'red', a.days != null ? esc(String(a.days)) + ' days' : '') : '') +
    (a.credit > 0 ? cell('Credit', money(a.credit, true), 'mint', a.ageBucket ? 'last paid ' + a.ageBucket + ' ago' : '') : '') +
    cell('Contract balance', a.bal == null ? '—' : money(a.bal, true)) +
    cell('Last payment', a.lastAmt ? money(a.lastAmt, true) : '—', '', a.recv ? fmtDate(a.recv) : '') + '</div>';
  if (a.pd > 0) {
    const t = a.b0 + a.b30 + a.b60 + a.b90 || 1, w = v => (v / t * 100).toFixed(1) + '%';
    h += '<div style="margin-top:12px"><div class="bkBar" aria-hidden="true"><i class="b0" style="width:' + w(a.b0) + '"></i><i class="b30" style="width:' + w(a.b30) + '"></i><i class="b60" style="width:' + w(a.b60) + '"></i><i class="b90" style="width:' + w(a.b90) + '"></i></div>' +
      '<div class="bkLeg">' + [['b0', '0–30', a.b0], ['b30', '31–60', a.b30], ['b60', '61–90', a.b60], ['b90', '91+', a.b90]].map(([c, l, v]) => '<span><i class="lg ' + c + '"></i>' + l + ' <b>' + money(v, true) + '</b></span>').join('') + '</div></div>';
  }
  if (a.note) h += '<div class="edgeNote">' + ic('note', 15) + '<span><b>Edge note:</b> ' + esc(a.note) + '</span></div>';
  return h;
}
function whyHTML(a) {
  const lines = [];
  if (a.months) lines.push('<div class="wl">' + tierChip(a) + '</div><div class="wd">Past due ' + money(a.pd, true) + ' = ' + a.months + ' × ' + money(S.cfg.inst, true) + ': the carrier hasn’t paid anything in ' + plural(a.months, 'month') + '. ' + esc(TIERS[a.tier].l) + '.</div>');
  if (a.bucket) {
    const s = pdAction(a, S.cfg), l91 = a.bucket === '91' ? list91(S.accts) : null, rank = l91 ? l91.findIndex(x => x.key === a.key) + 1 : 0;
    // on the collections ladder, the ladder below says what to do (a write-off candidate still says so)
    const L = ladFor(a), chip = L && s.k !== 'wo' ? '<span class="sug navy" title="Days past due today: Edge’s Days on ' + esc(fmtDate(S.rep.asOf)) + ', plus the days since">Day ' + L.day + ' past due</span>' : sugChip(s);
    if (!(a.months && s.k === 'claim')) lines.push('<div class="wl">' + chip + '</div><div class="wd">' + (rank ? '#' + rank + ' of ' + l91.length + ' on the 91+ list (' + money(a.b90, true) + ' at 91+ days).' : a.bucket === '31' ? '31–90 days past due — catch it before it reaches 91.' : 'Up to 30 days past due.') + '</div>');
  }
  if (a.credit > 0) {
    const s = crAction(a);
    lines.push('<div class="wl">' + sugChip(s) + '</div><div class="wd">' + (a.prepay ? 'Paid before starting treatment (Start Scheduled) — parked, nothing to do.' : 'Credit of ' + money(a.credit, true) + (a.recv ? ', last payment ' + fmtDate(a.recv) + (a.age != null ? ' (' + a.age + ' days before the report)' : '') : '') + '. Go through the checklist below before refunding.') + '</div>');
  }
  return lines.length ? '<div class="whyBox">' + lines.join('') + '</div>' : '';
}
function drABoxHTML(it) {
  const e = drAQuestion(it) || lastLog(it), st = e && e.k === 'drA_ask' && own(LAD_BY, e.step) ? LAD_BY[e.step] : null;
  const what = !e ? '' : st ? st.l + (st.send ? ' · ' + st.send : '') + (e.note ? ' — ' + e.note : '') : logLabel(e) + (e.note ? ': ' + e.note : '');
  return '<div class="drABox"><div style="display:flex;gap:8px;align-items:center;font-weight:700">' + ic(st ? 'sign' : 'flag', 16) + esc(st ? (isOwner() ? st.s + ' — for you to sign' : 'Waiting for Dr. A to sign ' + st.s) : isOwner() ? 'Waiting for your OK' : 'Waiting for Dr. A') + '</div>' +
    '<div class="small" style="margin-top:4px;color:var(--grey-700)">' + esc(e ? what + ' · ' + shortName(e.by) + ', ' + fmtWhen(e.at) : '') + '</div>' +
    (isOwner() ? '<div class="btnRow"><button class="btn btn-mint btn-sm" data-act="drAok">' + ic(st ? 'sign' : 'done', 15) + (st ? 'Signed' : 'OK') + '</button><button class="btn btn-sec btn-sm" data-act="drAno">Not yet</button></div>' : '') + '</div>';
}

/* ---------- the collections ladder (handbook §14) ---------- */
function ladderHTML(a, it, L) {
  let h = '<div class="sec ladSec"><h5>Collections ladder · day ' + L.day + ' past due</h5>';
  if (L.hold) h += '<div class="holdBox"><div class="hbT">' + ic('pause', 16) + '<b>On Maintenance Hold</b><span class="small">since ' + esc(fmtDate(isoOf(new Date(L.hold.at)))) + '</span></div>' +
    '<div class="small">Comfort visits only — no active tooth movement. Lift it once the past due is paid in full, or an arrangement is signed and its first payment is in: take the yellow box off in Edge and tell the clinical team.</div>' +
    '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="ladHold" data-on="0">Lift the hold</button></div></div>';
  if (L.paused && L.paused !== 'done') h += '<div class="notice info">Paused — ' + esc(L.paused === 'plan' ? 'a payment plan (Alternative Arrangement) is in place.' : L.paused === 'promise' ? 'they promised to pay by ' + fmtDay(it.follow) + '; it picks up again after that.' : 'the account is set to Paused.') +
    (L.paused === 'plan' ? ' <button class="linkBtn" data-act="ladAA">It was broken…</button>' : '') + '</div>';
  if (L.pip && !L.due && L.reached === 0) h += '<div class="notice info">Edge’s note says a payment is in process — no text needed yet.</div>';
  if (L.due) h += ladNowHTML(L, L.due);
  else if (L.fin) h += '<div class="notice">' + esc((L.done.aa ? 'Letter #8' : 'Letter #7') + ' went out ' + fmtDate(isoOf(new Date(L.fin.at))) + '. The 30 days for appliance removal and emergencies end ' + fmtDay(L.endOn) + '.') + '</div>';
  else if (L.next && !L.paused) h += '<div class="small ladNext">Nothing due now. Next: <b>' + esc(L.next.s) + '</b> — ' + esc(L.next.l) + ', on day ' + L.next.day + ' (' + esc(fmtDay(L.nextOn)) + ').</div>';
  h += ladStepsHTML(a, L);
  h += '<div class="ladFoot">' + (!L.broke && !L.fin && L.paused !== 'plan' ? '<button class="linkBtn small" data-act="ladAA">An arrangement was broken…</button>' : '') + '<button class="linkBtn small" data-act="ladHelp">How the ladder works</button></div>';
  return h + '</div>';
}
/* the step that's due: how it goes out, the text, the call, what else to do in Edge — and one tap when it's done */
function ladNowHTML(L, s) {
  const signed = !!L.signed[s.id], asked = L.asked === s.id, end = s.id === 'end' || s.id === 'endaa', owner = isOwner();
  const li = (icon, html) => '<li>' + ic(icon, 14) + '<span>' + html + '</span></li>';
  let lines = '';
  if (s.send) lines += li('mail', esc(s.send) + (s.dra ? ' · <b>signed by Dr. A</b>' : ''));
  if (s.text) lines += li('text', 'Text <b>' + esc(s.text) + '</b> <span class="muted">(Weave — as written)</span>');
  if (s.call) lines += li('call', esc(s.call));
  (s.do || []).forEach(x => { lines += li('next', esc(x)); });
  if (s.hold && !L.hold) lines += li('pause', '<b>Maintenance Hold</b> — the FC’s call from 60 days: comfort visits only, no active tooth movement (Edge: the yellow box and a treatment note; tell the clinical team).');
  let btns = '';
  if (end) btns = '<button class="btn btn-pri btn-sm" data-act="resolve">' + ic('done', 15) + 'Resolve…</button>';
  else if (s.dra && !signed) {
    // asked already: Dr. A answers in the box above (Signed / Not yet)
    if (asked) btns = '<span class="waitTag">' + ic('clock', 14) + (owner ? 'Waiting for your signature (above)' : 'Waiting for Dr. A to sign') + '</span>';
    else if (owner) btns = '<button class="btn btn-mint btn-sm" data-act="ladSigned" data-s="' + s.id + '">' + ic('sign', 15) + 'I signed it</button>';
    else btns = '<button class="btn btn-pri btn-sm" data-act="ladAsk" data-s="' + s.id + '">' + ic('flag', 15) + 'Ask Dr. A to sign</button>';
    if (!(owner && asked)) btns += '<button class="btn btn-sec btn-sm" data-act="ladDone" data-s="' + s.id + '" title="Dr. A signed it outside the app, and it went out">Signed &amp; sent</button>';
  } else btns = '<button class="btn btn-pri btn-sm" data-act="ladDone" data-s="' + s.id + '">' + ic('done', 15) + esc(s.btn) + '</button>';
  if (s.hold && !L.hold) btns += '<button class="btn btn-sec btn-sm" data-act="ladHold" data-on="1">' + ic('pause', 15) + 'Put on Maintenance Hold</button>';
  const tag = end ? 'Last step' : s.id === 'aa' ? 'Off the ladder' : 'Due now', sub = s.id === 'aa' ? 'Letter #8 · arrangement broken' : end ? '' : (s.n ? 'Letter #' + s.n + ' · ' : '') + 'day ' + s.day;
  return '<div class="ladNow ' + esc(s.tone) + '"><div class="ladHd"><span class="ladTag">' + tag + '</span><b>' + esc(s.l) + '</b>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') +
    (signed ? '<span class="badge t-ok">' + ic('sign', 12) + 'Signed by Dr. A</span>' : '') + '</div><ul class="ladDo">' + lines + '</ul><div class="btnRow">' + btns + '</div></div>';
}
/* every step of this round: done (by whom, when), due, passed without being recorded, or the day it comes */
function ladStepsHTML(a, L) {
  const t = todayISO(), steps = LADDER.concat(L.broke ? [LAD_AA] : []);
  const rows = steps.map((s, i) => {
    const d = L.done[s.id], due = L.due && L.due.id === s.id, past = s.id === 'aa' ? false : i <= L.reached;
    const cls = d ? 'ok' : due ? 'due' : past ? 'skip' : '';
    const w = d ? '✓ ' + shortName(d.by) + ' · ' + fmtDate(isoOf(new Date(d.at))) : due ? 'Due now' : past ? 'Not recorded' : L.fin || L.broke ? '—' : fmtDate(ladDate(a, S.rep.asOf, t, s.day));
    return '<li class="' + cls + '"><span class="ld">' + (s.id === 'aa' ? 'Off' : 'Day ' + s.day) + '</span><span class="ls"><b>' + esc(s.s) + '</b>' + (s.n ? ' · ' + esc(s.l) : '') + (L.signed[s.id] && !d ? ' <span class="small" style="color:var(--mint-700)">signed</span>' : '') + '</span><span class="lw">' + esc(w) + '</span></li>';
  }).join('');
  const nDone = steps.filter(s => L.done[s.id]).length;
  return '<details class="ladAll"><summary><span class="ladBar" aria-hidden="true">' + steps.map((s, i) => '<i class="' + (L.done[s.id] ? 'ok' : L.due && L.due.id === s.id ? 'due' : s.id !== 'aa' && i <= L.reached ? 'skip' : '') + '"></i>').join('') + '</span>' +
    '<span class="small">' + nDone + ' of ' + steps.length + ' recorded · every step</span></summary><ol class="ladList">' + rows + '</ol></details>';
}
/* what was just done — one tap */
function nowHTML(a, it, g) {
  const keys = Object.keys(LOGS).filter(k => LOGS[k].g === g && !(k === 'cr_refreq' && a && a.prepay));
  const form = S.ui.form;
  let h = '<div class="nowBox"><div class="nowHd"><span class="nowN">Log it</span><b>' + (g === 'ins' ? 'What happened with the carrier?' : g === 'cr' ? 'What’s been done about the credit?' : 'What happened?') + '</b></div>' +
    (g === 'pt' && a && telHref(a.home) ? '<div class="btnRow" style="margin:0 0 10px"><a class="btn btn-act btn-sm" href="' + esc(telHref(a.home)) + '">' + ic('call', 15) + 'Call ' + esc(phoneTxt(a.home)) + '</a></div>' : '') +
    '<div class="rbRow">' + keys.map(k => '<button class="rb" data-act="log" data-k="' + k + '"' + (form === k ? ' aria-pressed="true"' : '') + '>' + esc(LOGS[k].l) + '</button>').join('') + '</div>';
  if (form === 'pt_promise') h += '<div class="inForm"><div class="grid2"><div class="field"><label for="prDate">Pay by</label><input type="date" id="prDate" data-keep min="' + todayISO() + '"></div><div class="field"><label for="prAmt">Amount (optional)</label><input id="prAmt" data-keep inputmode="decimal" placeholder="$"></div></div>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="savePromise">Save — follow up that day</button><button class="btn btn-ghost" data-act="cancelForm">Cancel</button></div></div>';
  h += '<div class="inRow" style="margin:10px 0 0"><label for="nowNote" class="hidden">Note</label><input id="nowNote" class="inp" data-keep autocomplete="off" placeholder="' + (form === 'ins_denied' ? 'Why was it denied? (needed)' : 'Note — with a button above, or on its own') + '">' +
    (form ? '' : '<button class="btn btn-sec btn-sm" data-act="log" data-k="note" title="Save just the note">Save note</button>') + '</div>' +
    (form === 'ins_denied' ? '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="saveDenied">Save — claim denied</button><button class="btn btn-ghost" data-act="cancelForm">Cancel</button></div>' : '') +
    '<div class="small muted" style="margin-top:8px">Logging sets the next follow-up for you (you can change it below).' + (g === 'cr' ? ' Refunds and write-offs wait for Dr. A’s OK.' : '') + '</div></div>';
  return h;
}
function workHTML(it, done) {
  const ppl = arPeople(), t = todayISO();
  const quick = [['Tomorrow', nextOfficeDay(addDays(t, 1))], ['1 week', nextOfficeDay(addDays(t, 7))], ['2 weeks', nextOfficeDay(addDays(t, 14))], ['30 days', nextOfficeDay(addDays(t, 30))]];
  const dis = done ? ' disabled' : '';
  return '<div class="sec"><h5>Work</h5><div class="workRow">' +
    '<div><div class="k">Status</div><select class="inp" data-chg="stage" aria-label="Status"' + dis + '>' + Object.keys(STAGES).map(k => '<option value="' + k + '"' + ((it && it.stage || '') === k ? ' selected' : '') + '>' + esc(STAGES[k]) + '</option>').join('') + '</select></div>' +
    '<div><div class="k">Assigned to</div><select class="inp" data-chg="assign" aria-label="Assigned to"' + dis + '><option value="">Nobody</option>' + ppl.map(r => '<option value="' + esc(r.sid) + '"' + (it && it.assignee === r.sid ? ' selected' : '') + '>' + esc(staffName(r.sid)) + '</option>').join('') +
    (it && it.assignee && !ppl.some(r => r.sid === it.assignee) ? '<option value="' + esc(it.assignee) + '" selected>' + esc(staffName(it.assignee, it.assignee)) + '</option>' : '') + '</select></div>' +
    '<div style="grid-column:1/-1"><div class="k">Follow up</div><div class="fuRow">' + (it && it.follow ? followChip(it.follow) : '<span class="small muted">No follow-up set</span>') +
    (done ? '' : quick.map(([l, d]) => '<button class="pick sm" data-act="setFollow" data-d="' + d + '" title="' + esc(fmtDay(d)) + '">' + esc(l) + '</button>').join('') +
      '<input type="date" id="fuDate" data-keep aria-label="Follow-up day" min="' + t + '" value="' + esc((it && it.follow) || '') + '" data-chg="followDate">' + (it && it.follow ? '<button class="btn btn-ghost" data-act="setFollow" data-d="">Clear</button>' : '')) + '</div></div>' +
    (!done && (!it || !it.drA) ? '<div style="grid-column:1/-1"><button class="linkBtn small" data-act="askDrA">' + ic('flag', 13) + ' Ask Dr. A (refund, write-off, a decision)…</button></div>' : '') + '</div></div>';
}
function checksHTML(it, done) {
  const c = (it && it.checks) || {}, n = REFUND_CHECKS.filter(([k]) => c[k]).length;
  return '<div class="sec"><h5>Before a refund · ' + n + ' of ' + REFUND_CHECKS.length + '</h5><div class="chkList">' + REFUND_CHECKS.map(([k, l]) =>
    '<label class="' + (c[k] ? 'on' : '') + '"><input type="checkbox" data-chg="check" data-k="' + k + '"' + (c[k] ? ' checked' : '') + (done ? ' disabled' : '') + '><span>' + esc(l) + '</span></label>').join('') + '</div>' +
    '<p class="small muted" style="margin-top:6px">From the FC instructions (Credits &amp; Refunds). Transferring to the family’s balance is usually better than a refund. The refund form is in the <a href="NLO_Financial_Suite.html" target="_blank" rel="noopener">Financial Suite</a> (Refund Authorization).</p></div>';
}
function logHTML(it) {
  const L = ((it && it.log) || []).slice().reverse();
  if (!L.length) return '<div class="small muted">Nothing logged yet.</div>';
  const undoId = it && canUndoLog(it) && Date.now() - (L[0].at || 0) < 30 * 60000 && L[0].by === meSid() ? L[0].id : '';
  // today's work as Edge notes, ready to paste (each entry can also be copied on its own)
  const td = edgeToday(it), all = td.length && td.every(x => edgeCopied(x.e));
  const box = td.length ? '<div class="edgeBox"><div class="ebHd">' + ic('note', 15) + '<b>For Edge · today</b><span class="small muted grow">' + (all ? 'copied' : 'paste into the patient’s notes in Edge') + '</span>' +
    '<button class="btn btn-sec btn-sm" data-act="copyEdgeDay">' + ic(all ? 'tick' : 'copy', 14) + (td.length > 1 ? 'Copy all ' + td.length : 'Copy') + '</button></div><div class="ebTx">' + esc(td.map(x => x.n).join('\n')) + '</div></div>' : '';
  return box + L.map(e => { const n = edgeNote(it, e); return '<div class="logRow">' + avatarHTML(e.by) + '<div style="flex:1;min-width:0"><div class="w"><b>' + esc(shortName(e.by) || '—') + '</b> · ' + esc(fmtWhen(e.at)) + '</div>' +
    '<div class="lt">' + esc(logLabel(e)) + (e.date && e.k === 'pt_promise' ? ' — by ' + esc(fmtDay(e.date)) : '') + (e.amt != null ? ' · ' + money(e.amt, true) : '') + '</div>' + (e.note ? '<div class="ln">' + esc(e.note) + '</div>' : '') +
    (n ? '<button class="linkBtn small ebCp" data-act="copyEdge" data-id="' + esc(e.id) + '" title="' + esc(n) + '">' + (edgeCopied(e) ? ic('tick', 12) + 'Copied for Edge' : 'Copy Edge note') + '</button>' : '') + '</div>' +
    (e.id === undoId ? '<button class="btn btn-ghost" data-act="undoLog" title="Take this back">' + ic('undo', 14) + 'Undo</button>' : '') + '</div>'; }).join('');
}
function histText(x) {
  switch (x.a) {
    case 'create': return 'started working the account';
    case 'log': return 'logged: ' + String(logLabel({ k: x.k }) || x.k).toLowerCase();
    case 'undo': return 'took back the last entry';
    case 'resolve': return 'resolved it — ' + String(OUTCOMES[x.outcome] || '').toLowerCase();
    case 'reopen': return 'reopened it';
    case 'assign': return x.to ? 'assigned it to ' + staffName(x.to, x.to) : 'unassigned it';
    case 'follow': return x.to ? 'set the follow-up to ' + fmtDay(x.to) : 'cleared the follow-up';
    case 'stage': return 'set the status to “' + (STAGES[x.to] || 'Not started') + '”';
    case 'check': return (x.on ? 'ticked' : 'unticked') + ' a refund check';
    case 'drA': return own(LAD_BY, x.step) ? 'asked Dr. A to sign ' + LAD_BY[x.step].s : 'asked Dr. A';
    case 'drAok': return own(LAD_BY, x.step) ? 'signed ' + LAD_BY[x.step].s : 'OK’d it';
    case 'drAno': return 'said not yet';
    case 'ladder': return 'recorded: ' + (own(LAD_BY, x.step) ? LAD_BY[x.step].did.replace(/^./, c => c.toLowerCase()) : 'a collections step');
    case 'mhold': return x.on ? 'put it on Maintenance Hold' : 'lifted the Maintenance Hold';
    case 'aa': return 'marked the arrangement broken';
    case 'restore': return 'restored an earlier version';
    case 'obcheck': return 'checked OrthoBanc’s failed-payment report (' + fmtDate(x.for) + (x.n != null ? ', ' + plural(x.n, 'failed payment') : '') + ')';
    case 'obimport': return 'imported OrthoBanc’s failed-payment report (' + fmtDate(x.day) + (x.n != null ? ', ' + plural(x.n, 'failed payment') : '') + ')';
    case 'obtick': return (x.on === false ? 'unticked ' : 'ticked ') + plural(x.n || 1, 'family', 'families') + (x.on === false ? '' : ' as texted') + ' (OrthoBanc, ' + fmtDate(x.day) + ')';
    case 'carrier': return x.op === 'add' ? 'added the carrier ' + (x.name || '') : x.op === 'edit' ? 'updated the carrier ' + (x.name || '') : x.op === 'remove' ? 'removed the carrier ' + (x.name || '') : x.op === 'tag' ? 'set the carrier on ' + plural(x.n || 1, 'insurance account') :
      x.op === 'edge' ? 'filled in the carriers from Edge’s Insurance Aging' + (x.asOf ? ' of ' + fmtDate(x.asOf) : '') + (x.n ? ' (' + plural(x.n, 'account') + ')' : '') : x.op === 'merge' ? 'merged the carrier ' + (x.name || '') + ' into ' + (x.into || '') : 'changed the insurance carriers';
    case 'edgetask': return 'added ' + plural(x.n || 1, 'task') + ' from Edge';
    default: return x.a || '';
  }
}
function historyHTML() {
  const h = S.history; if (!h) return '<div class="small muted">' + (itemFor(S.openKey) ? 'Loading…' : 'Nothing yet — the account’s record starts with the first thing logged.') + '</div>';
  const list = h.filter(x => x.a !== 'rekey' && x.a !== 'save'); if (!list.length) return '<div class="small muted">No history yet.</div>';
  return list.slice().reverse().map(x => '<div class="hist"><time>' + esc(fmtWhen(x.at)) + '</time><span><b>' + esc(shortName(x.sid) || '') + '</b> ' + esc(histText(x)) + '</span></div>').join('');
}
function earlierHTML() {
  const e = S.earlier; if (!e) return '';
  if (e.loading) return '<div class="small muted">Opening earlier reports…</div>';
  if (!e.rows.length) return '<div class="small muted">Not in any earlier report.</div>';
  return '<table class="tbl histTbl"><thead><tr><th>Report</th><th class="num">Past due</th><th class="num">91+</th><th class="num">Credit</th></tr></thead><tbody>' +
    e.rows.map(r => '<tr><td>' + esc(fmtDate(r.asOf)) + '</td><td class="num">' + (r.a ? money(r.a.pd, true) : '—') + '</td><td class="num">' + (r.a ? money(r.a.b90, true) : '—') + '</td><td class="num">' + (r.a && r.a.credit ? money(r.a.credit, true) : '—') + '</td></tr>').join('') + '</tbody></table>';
}

/* ---------- actions ---------- */
function curKey() { return S.openKey; }
function noteVal() { return (($('#nowNote') || {}).value || '').trim(); }
function doLog(k, extra) {
  const key = curKey(), it = itemFor(key), now = Date.now(), o = Object.assign({ by: meSid(), note: noteVal() }, extra || {});
  const test = JSON.parse(JSON.stringify(it || blankItem(S.byKey.get(key) || { key, patient: '', rp: '', src: 'pt', credit: 0, pd: 0 })));
  try { applyLog(test, k, o, now); } catch (e) { toast(errText(e), { bad: true }); const n = $('#nowNote'); if (n && e.code === 'need-note') n.focus(); return; }
  S.ui = {}; const ni = $('#nowNote'); if (ni) ni.value = '';
  change(key, d => { applyLog(d, k, o, now); }, { a: 'log', k }).then(ok => { if (ok) loadHistory(key); });
  const te = test.log[test.log.length - 1], en = edgeNote(test, te);
  toast('Logged: ' + LOGS[k].s + (test.follow ? ' · follow up ' + (dayDiff(test.follow) === 0 ? 'today' : fmtDay(test.follow)) : ''), { actions: en ? [edgeAct(en, te)] : [], action: 'Undo', onAction: () => undoLast(key) });
}
function undoLast(key) {
  const it = itemFor(key); if (!it || !canUndoLog(it)) { toast('Can’t undo that any more — it has changed since.', { bad: true }); return; }
  change(key, d => undoLog(d), { a: 'undo' }, 'Undone').then(() => loadHistory(key));
}
/* try a ladder change on a copy first, so a refusal (already recorded…) is said before anything is shown */
function ladTest(key, fn) {
  const it = itemFor(key), a = S.byKey.get(key);
  const t = JSON.parse(JSON.stringify(it && !isBack(it) ? it : blankItem(a || { key, patient: '', rp: '', src: 'pt', credit: 0, pd: 0 })));
  try { fn(t); return true; } catch (e) { toast(errText(e), { bad: true }); return false; }
}
function ladRecord(key, s, note) {
  const now = Date.now(), ni = $('#nowNote'); if (ni) ni.value = '';
  change(key, d => { ladderLog(d, s.id, { by: meSid(), note }, now); }, { a: 'ladder', step: s.id }).then(ok => { if (ok) loadHistory(key); });
  const te = { id: '', at: now, by: meSid(), k: 'ladder', step: s.id, note }, en = edgeNote(itemFor(key), te);
  toast('Recorded: ' + s.did, { actions: en ? [edgeAct(en, te)] : [], action: 'Undo', onAction: () => undoLast(key) });
}
/* a certified letter: keep its tracking number with it */
function certModal(key, s) {
  const pre = noteVal();
  openModal('<h3>' + esc(s.s) + ' sent</h3><div class="lsub">' + esc(s.l) + ' — ' + esc(s.send) + '</div>' +
    '<div class="field"><label for="ctNo">Certified tracking number</label><input id="ctNo" autocomplete="off" spellcheck="false" placeholder="From the certified mail receipt (optional)"></div>' +
    '<div class="field"><label for="ctNote">Note (optional)</label><input id="ctNote" autocomplete="off" value="' + esc(pre) + '"></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="ctOk">' + ic('done', 15) + 'Save</button></div>', w => {
      $('#ctOk', w).onclick = () => {
        const no = $('#ctNo', w).value.trim().slice(0, 60), nt = $('#ctNote', w).value.trim();
        closeModal(); ladRecord(key, s, [no ? 'Certified #' + no : '', nt].filter(Boolean).join(' · '));
      };
    });
}
Object.assign(ACT, {
  log(t) {
    const k = t.dataset.k, L = LOGS[k];
    if (L.ask === 'date') { S.ui = S.ui.form === k ? {} : { form: k }; renderDrawer(); const f = $('#prDate'); if (f) f.focus(); return; }
    if (L.ask === 'note' && !noteVal()) { S.ui = S.ui.form === k ? {} : { form: k }; renderDrawer(); const f = $('#nowNote'); if (f) f.focus(); return; }
    if (k === 'note' && !noteVal()) { const f = $('#nowNote'); if (f) { f.focus(); toast('Write the note first, then press Save note.'); } return; }
    doLog(k);
  },
  savePromise() { const d = ($('#prDate') || {}).value || '', amt = Number(String(($('#prAmt') || {}).value || '').replace(/[$,\s]/g, '')); doLog('pt_promise', { date: d, amt: amt > 0 ? amt : null }); },
  saveDenied() { doLog('ins_denied'); },
  cancelForm() { S.ui = {}; renderDrawer(); },
  undoLog() { undoLast(curKey()); },
  setFollow(t) { const to = t.dataset.d || '', key = curKey(); change(key, d => { d.follow = to; }, { a: 'follow', to }, to ? 'Follow up ' + fmtDay(to) : 'Follow-up cleared'); },
  askDrA() {
    const key = curKey(), a = S.byKey.get(key);
    openModal('<h3>Ask Dr. A</h3><div class="lsub">' + esc(a ? a.patient : (itemFor(key) || {}).name || '') + ' — it shows on his Today until he answers.</div>' +
      '<div class="field"><label for="drQ">What do you need from him?</label><textarea id="drQ" rows="3" placeholder="e.g. OK to refund $125 to the family by check? Insurance paid twice."></textarea></div>' +
      '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="drQok">Ask</button></div>', w => {
        $('#drQok', w).onclick = () => {
          const q = $('#drQ', w).value.trim(); if (!q) { $('#drQ', w).focus(); return; }
          closeModal(); const now = Date.now();
          change(key, d => { d.log = (d.log || []).concat([{ id: uid8(), at: now, by: meSid(), k: 'drA_ask', note: q, prev: { stage: d.stage, follow: d.follow, drA: !!d.drA } }]); d.drA = true; }, { a: 'drA' }, 'Asked — it’s on Dr. A’s Today').then(() => loadHistory(key));
        };
      });
  },
  drAok() {
    const key = curKey(), note = noteVal(), it = itemFor(key), q = it && drAQuestion(it), step = q && q.k === 'drA_ask' && own(LAD_BY, q.step) ? q.step : '';
    change(key, d => answerDrA(d, true, { by: meSid(), note }, Date.now()), step ? { a: 'drAok', step } : { a: 'drAok' }, step ? 'Signed — ready to send' : 'OK’d').then(() => loadHistory(key));
  },
  drAno() { const key = curKey(), note = noteVal(); change(key, d => answerDrA(d, false, { by: meSid(), note }, Date.now()), { a: 'drAno' }, 'Sent back').then(() => loadHistory(key)); },
  resolve() {
    const key = curKey(), a = S.byKey.get(key), it = itemFor(key), g = groupOf(a, it), hold = it && !isBack(it) && holdOf(it);
    openModal('<h3>Resolve this account</h3><div class="lsub">' + esc(a ? a.patient : it.name) + (a ? ' · ' + (a.pd > 0 ? money(a.pd, true) + ' past due' : money(a.credit, true) + ' credit') : '') + '</div>' +
      (hold ? '<div class="notice">On Maintenance Hold: once it’s paid or settled, take the yellow box off in Edge and tell the clinical team.</div>' : '') +
      '<div class="flabel">How was it resolved?</div><div class="pickRow" id="rsPick">' + DONE[g].map(([k, l]) => '<button class="pick" data-o="' + k + '" aria-pressed="false">' + esc(l) + '</button>').join('') + '</div>' +
      '<div class="field" style="margin-top:14px"><label for="rsNote">Note (optional)</label><textarea id="rsNote" rows="2" placeholder="e.g. refund check #1012 mailed 10/6"></textarea></div>' +
      '<p class="small muted">It stays on the list as resolved until the next report from Edge no longer shows it.</p>' +
      '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="rsOk" disabled>Resolve</button></div>', w => {
        let o = '';
        $$('#rsPick .pick', w).forEach(b => b.onclick = () => { o = b.dataset.o; $$('#rsPick .pick', w).forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#rsOk', w).disabled = false; });
        $('#rsOk', w).onclick = () => { const note = $('#rsNote', w).value.trim(); closeModal(); change(key, d => resolveItem(d, o, { by: meSid(), note }, Date.now()), { a: 'resolve', outcome: o }, 'Resolved — ' + String(OUTCOMES[o]).toLowerCase() + (hold ? '. Lift the Maintenance Hold in Edge' : '')).then(() => loadHistory(key)); };
      });
  },
  resolveCleared() { const key = curKey(), it = itemFor(key), hold = it && holdOf(it); change(key, d => resolveItem(d, 'cleared', { by: meSid(), note: S.rep ? 'Not in the ' + fmtDate(S.rep.asOf) + ' report' : '' }, Date.now()), { a: 'resolve', outcome: 'cleared' }, 'Closed — cleared in Edge' + (hold ? '. Lift the Maintenance Hold in Edge and tell the clinical team' : '')).then(() => loadHistory(key)); },
  /* the collections ladder */
  ladDone(t) {
    const key = curKey(), id = t.dataset.s, s = own(LAD_BY, id) ? LAD_BY[id] : null; if (!s) return;
    if (!ladTest(key, d => ladderLog(d, id, { by: meSid() }, Date.now()))) return;
    if (s.cert) return certModal(key, s);
    ladRecord(key, s, noteVal());
  },
  ladAsk(t) {
    const key = curKey(), id = t.dataset.s, note = noteVal(), now = Date.now(); if (!own(LAD_BY, id)) return;
    const ni = $('#nowNote'); if (ni) ni.value = '';
    change(key, d => askSign(d, id, { by: meSid(), note }, now), { a: 'drA', step: id }, 'Asked — it’s on Dr. A’s Today').then(ok => { if (ok) loadHistory(key); });
  },
  ladSigned(t) {
    const key = curKey(), id = t.dataset.s, now = Date.now(); if (!own(LAD_BY, id)) return;
    change(key, d => signStep(d, id, { by: meSid() }, now), { a: 'drAok', step: id }, 'Signed — ready to send').then(ok => { if (ok) loadHistory(key); });
  },
  ladHold(t) {
    const key = curKey(), on = t.dataset.on === '1', note = noteVal(), now = Date.now();
    const ni = $('#nowNote'); if (ni) ni.value = '';
    change(key, d => holdLog(d, on, { by: meSid(), note }, now), { a: 'mhold', on }).then(ok => { if (ok) loadHistory(key); });
    const te = { id: '', at: now, by: meSid(), k: on ? 'mhold_on' : 'mhold_off', note }, en = edgeNote(itemFor(key), te);
    toast(on ? 'On Maintenance Hold — in Edge: the yellow box and a treatment note; tell the clinical team' : 'Hold lifted — take the yellow box off in Edge and tell the clinical team', { ms: 9000, actions: en ? [edgeAct(en, te)] : [], action: 'Undo', onAction: () => undoLast(key) });
  },
  async ladAA() {
    const key = curKey(), note = noteVal();
    if (!(await confirmBox('The arrangement was broken?', 'Letter #8 (Broken Arrangement) comes next: Dr. A signs it, and it goes certified + regular mail + email. If they have an appointment, change it to Debond/Finish. They get 30 days for appliance removal and emergencies only; to restart treatment they pay the full remaining balance (Mastercard, Visa or Discover only).', 'It was broken'))) return;
    change(key, d => breakArrangement(d, { by: meSid(), note }, Date.now()), { a: 'aa' }, 'Marked broken — Letter #8 is next').then(ok => { if (ok) loadHistory(key); });
  },
  reopen() { const key = curKey(); change(key, d => reopenItem(d, { by: meSid() }, Date.now()), { a: 'reopen' }, 'Reopened').then(() => loadHistory(key)); },
  async loadEarlier() {
    const key = curKey(); S.earlier = { key, loading: true, rows: [] }; const box = $('#earlierBox'); if (box) box.innerHTML = earlierHTML();
    const rows = [];
    for (const r of S.reports.filter(x => !x.locked && x.id !== S.repId).slice(0, 12)) {
      try { const rep = r.id === S.prevId && S.prev ? S.prev : normReport(await B.loadReport(r.id)); const row = (rep.rows || []).find(x => x.key === key); rows.push({ asOf: rep.asOf, a: row ? acctOf(row, S.cfg, rep.asOf) : null }); } catch (e) { }
    }
    if (S.openKey !== key) return;
    S.earlier = { key, rows: rows.sort((x, y) => (x.asOf < y.asOf ? 1 : -1)) }; const b2 = $('#earlierBox'); if (b2) b2.innerHTML = earlierHTML();
  },
  versions() { versionsModal(curKey()); },
  restoreVer(t) { restoreVer(Number(t.dataset.i)); }
});
CHG.stage = t => { const key = curKey(), to = t.value; change(key, d => { d.stage = to; }, { a: 'stage', to }); };
CHG.assign = t => { const key = curKey(), to = t.value; change(key, d => { d.assignee = to; }, { a: 'assign', to }, to ? 'Assigned to ' + staffName(to) : 'Unassigned'); };
CHG.followDate = t => { const key = curKey(), to = t.value || ''; if (to && to < todayISO()) { toast('Pick today or a day ahead.', { bad: true }); return; } change(key, d => { d.follow = to; }, { a: 'follow', to }, to ? 'Follow up ' + fmtDay(to) : 'Follow-up cleared'); };
CHG.check = t => { const key = curKey(), k = t.dataset.k, on = t.checked; change(key, d => { d.checks = Object.assign({}, d.checks, { [k]: on }); if (!on) delete d.checks[k]; }, { a: 'check', on }); };

/* ---------- modals ---------- */
function openModal(html, onReady) {
  closeModal();
  const w = document.createElement('div'); w.id = 'modalWrap';
  w.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
  w.addEventListener('mousedown', e => { if (e.target === w) closeModal(); });
  document.body.appendChild(w);
  const f = $('input:not([type=hidden]),select,textarea', w); if (f) f.focus();
  if (onReady) onReady(w);
  return w;
}
function closeModal() { const w = $('#modalWrap'); if (w) w.remove(); }
function confirmBox(title, text, okLabel, danger) {
  return new Promise(res => {
    openModal('<h3>' + esc(title) + '</h3><p class="lsub" style="font-size:13.5px;color:var(--grey-600)">' + esc(text) + '</p><div class="mFt"><button class="btn btn-sec" id="cbNo">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + '" id="cbYes">' + esc(okLabel) + '</button></div>', w => {
      $('#cbNo', w).onclick = () => { closeModal(); res(false); }; $('#cbYes', w).onclick = () => { closeModal(); res(true); }; $('#cbYes', w).focus();
    });
  });
}

/* ---------- saved versions (owner) ---------- */
async function versionsModal(key) {
  const it = itemFor(key); if (!it) return;
  openModal('<h3>Saved versions</h3><div class="lsub">Every change keeps the copy it replaced. Restoring makes that copy current again (and keeps today’s too).</div><div id="verList"><div class="small muted">Loading…</div></div><div class="mFt"><button class="btn btn-sec" data-act="closeModal">Close</button></div>');
  try {
    const list = await B.itemVersions(it.id); S.verList = list; S.verId = it.id; S.verKey = key;
    $('#verList').innerHTML = list.length ? '<div class="tblWrap"><table class="tbl"><thead><tr><th>Version</th><th>Contents</th><th></th></tr></thead><tbody>' + list.map((v, i) =>
      '<tr><td class="small"><b>#' + v.rev + '</b><div class="muted">replaced ' + esc(fmtWhen(v.replacedAt)) + '<br>by ' + esc(shortName(v.replacedBy)) + (v.replacedHow ? ' (' + esc(v.replacedHow) + ')' : '') + '</div></td>' +
      '<td class="small">' + (v.data ? esc((v.data.state === 'done' ? 'Resolved: ' + (OUTCOMES[v.data.outcome] || '') : STAGES[v.data.stage || '']) + ' · ' + plural((v.data.log || []).length, 'entry', 'entries')) : '<span style="color:var(--coral-700)">Can’t be read</span>') + '</td>' +
      '<td style="text-align:right">' + (v.data ? '<button class="btn btn-sec btn-sm" data-act="restoreVer" data-i="' + i + '">Restore</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="small muted">No earlier versions yet.</div>';
  } catch (x) { $('#verList').innerHTML = '<div class="lockErr">' + esc(errText(x)) + '</div>'; }
}
async function restoreVer(i) {
  const v = S.verList && S.verList[i]; if (!v || !v.data) return;
  try { await B.restoreVersion(S.verId, v.data); closeModal(); toast('Version #' + v.rev + ' restored'); loadHistory(S.verKey); }
  catch (x) { toast(errText(x), { bad: true }); }
}
