/* =====================================================================
   The lead drawer: contact buttons, logging attempts, flags, closing,
   comments and history. Plus the New lead form and saved versions.
   ===================================================================== */
const RES_BTN = { sched: '✓ Appointment scheduled', vm: 'Left voicemail', none: 'No answer', sent: 'Sent', pending: 'Pending (see notes)', follow: 'Follow up on a day…', no: 'Not interested' };
const RES_TIP = { pending: 'You reached them, but nothing’s booked yet — it’s waiting on something (say what in the note). No day to pick: the follow-up plan carries on, starting the next office day.' };
const HOW = ['Phone call', 'Walk-in', 'Referral', 'Facebook', 'Instagram', 'Google', 'Other'];
const FIELD_LABELS = { name: 'name', parent: 'parent', phone: 'phone', email: 'email', message: 'message', how: 'source' };

function findLead(id) { return S.leads.get(id) || S.closed.find(l => l.id === id) || (S.hist || []).find(l => l.id === id); }
/* put a copy where it belongs: open leads on the lists, closed ones under Closed */
function placeLead(l) {
  if (l.status === 'done') {
    S.leads.delete(l.id); S.closed = [l].concat(S.closed.filter(x => x.id !== l.id));
    if (S.hist) S.hist = [l].concat(S.hist.filter(x => x.id !== l.id));
  } else { S.leads.set(l.id, l); S.closed = S.closed.filter(x => x.id !== l.id); if (S.hist) S.hist = S.hist.filter(x => x.id !== l.id); }
  queueRender(); if (S.openId === l.id && !S.editing) renderDrawer();
}
/* change a lead: shown at once, saved in the background. The same change is applied again to the latest
   saved copy (so two people working at once never undo each other); if it can't be, the saved copy wins. */
function change(id, fn, action, okMsg) {
  const cur = findLead(id); if (!cur) return Promise.resolve(false);
  const copy = JSON.parse(JSON.stringify(cur)); let st;
  try { st = fn(copy); } catch (e) { toast(errText(e), { bad: true }); return Promise.resolve(false); }
  const status = st === 'done' || st === 'open' ? st : cur.status;
  Object.assign(copy, { status, updatedAt: Date.now(), by: meSid(), closedAt: status === 'done' ? (cur.status === 'done' && cur.closedAt ? cur.closedAt : Date.now()) : null });
  placeLead(copy);
  S.pend[id] = (S.pend[id] || 0) + 1;
  return B.mutateLead(id, fn, action).then(() => { if (okMsg) toast(okMsg); return true; }, e => {
    toast(errText(e), { bad: true }); if (!S.srv[id]) S.srv[id] = cur; return false;
  }).then(ok => {
    if (!--S.pend[id]) {
      delete S.pend[id]; const srv = S.srv[id]; delete S.srv[id];
      if (srv === 'gone') { if (S.leads.has(id) && S.leads.get(id).status !== 'done') S.leads.delete(id); queueRender(); }
      else if (srv) placeLead(srv);
    }
    return ok;
  });
}
/* a comment on a lead that may not be loaded here (e.g. the earlier request a repeat belongs to) */
function noteOn(id, text) {
  const c = { id: uid8(), at: Date.now(), by: meSid(), text };
  const fn = d => { d.comments = (d.comments || []).concat([c]); };
  if (findLead(id)) return change(id, fn, { a: 'comment' });
  return B.mutateLead(id, fn, { a: 'comment' }).then(() => true, () => false);
}

/* ---------- drawer ---------- */
function openDrawer(id) {
  S.openId = id; S.editing = false; S.history = null; S.ui = {};
  if (!$('#drawer')) {
    const scrim = document.createElement('div'); scrim.id = 'scrim'; scrim.dataset.act = 'closeDrawer'; document.body.appendChild(scrim);
    const d = document.createElement('aside'); d.id = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Lead'); document.body.appendChild(d);
  }
  renderDrawer(); loadHistory(id);
}
function closeDrawer(force) {
  if (!force && S.editing && editDirty() && !confirm('Discard your changes?')) return;
  S.openId = null; S.editing = false; S.ui = {}; const d = $('#drawer'), s = $('#scrim'); if (d) d.remove(); if (s) s.remove();
}
function refreshDrawer(gone) {
  if (!S.openId) return;
  if (gone && !findLead(S.openId)) {
    if (S.editing) { const n = $('#drawerNotice'); if (n) n.innerHTML = '<div class="notice bad">Someone just closed or deleted this lead.</div>'; return; }
    closeDrawer(true); return;
  }
  if (S.editing) { const n = $('#drawerNotice'); if (n) n.innerHTML = '<div class="notice">Someone else just updated this lead. Saving keeps their changes and applies yours on top.</div>'; return; }
  renderDrawer(); loadHistory(S.openId);
}
async function loadHistory(id) {
  try { const h = await B.leadLog(id); if (S.openId === id) { S.history = h; const el = $('#histBox'); if (el) el.innerHTML = historyHTML(); } } catch (e) { }
}
/* typed text (a note, a comment, a date) survives the drawer being redrawn by a live update */
function keepInputs(root) { const k = {}; $$('[data-keep]', root).forEach(i => { k[i.id] = i.value; }); const a = document.activeElement; return { k, focus: a && root.contains(a) ? a.id : '' }; }
function restoreInputs(root, s) { Object.keys(s.k).forEach(id => { const i = $('#' + id, root); if (i && s.k[id]) i.value = s.k[id]; }); if (s.focus) { const f = $('#' + s.focus, root); if (f) f.focus(); } }
function renderDrawer() {
  const d = $('#drawer'); const l = findLead(S.openId); if (!d) return;
  if (!l) { d.innerHTML = '<div class="dHd"><div style="flex:1"><h3>Loading…</h3></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>'; return; }
  const keep = keepInputs(d);
  if (S.editing) { d.innerHTML = editHTML(); restoreInputs(d, keep); return; }
  if (l.locked) {
    d.innerHTML = '<div class="dHd"><div style="flex:1"><h3>Lead can’t be opened</h3></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
      '<div class="dBd"><div class="notice bad">This lead’s saved copy can’t be decrypted on this computer.</div>' +
      (isOwner() ? '<p class="small" style="margin-bottom:12px">Every earlier version is kept. Pick the last good one to restore it.</p><button class="btn btn-pri" data-act="versions">' + ic('clock', 16) + 'Restore a saved version</button>' : '<p class="small">Ask Dr. A — he can restore it from its saved versions.</p>') + '</div>';
    return;
  }
  const done = l.status === 'done', i = curStep(l), owner = isOwner();
  const working = !done && !l.flag && l.stage !== 'scheduled' && i >= 0;
  const p = phoneInfo(l.phone), em = validEmail(l.email);
  const kv = (k, v) => '<div><div class="k">' + k + '</div><div class="v">' + (v || '<span class="muted">—</span>') + '</div></div>';
  const assignSel = '<select class="inp" id="assignSel" data-chg="assign" aria-label="Assigned to" style="min-height:36px;padding:6px 10px"' + (done ? ' disabled' : '') + '><option value="">Unassigned' + (l.assigneeName ? ' (Asana: ' + esc(l.assigneeName) + ')' : '') + '</option>' +
    activeRoster().map(r => '<option value="' + esc(r.sid) + '"' + (l.assignee === r.sid ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>';
  const extra = Object.keys(l.extra || {}).filter(k => String(l.extra[k] || '').trim());
  d.innerHTML = '<div class="dHd"><div style="flex:1;min-width:0"><h3>' + esc(leadName(l)) + '</h3><div class="sub">' + srcBadge(l) + flagBadge(l) +
    (done ? '<span class="badge ' + (l.closeWhy === 'sched' ? 't-ok' : '') + '">' + esc(CLOSE_WHY[l.closeWhy] || 'Closed') + '</span>' : '') +
    (l.parent && l.name ? '<span class="small muted">Parent: ' + esc(l.parent) + '</span>' : '') + '</div></div>' +
    '<button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="dBd"><div id="drawerNotice"></div>' +
    (done ? '<div class="notice info">Closed ' + esc(fmtWhen(l.closedAt)) + ' · ' + esc(CLOSE_WHY[l.closeWhy] || '') + (l.appt ? ' · appointment ' + esc(fmtDay(l.appt)) + (l.apptTime ? ' at ' + esc(fmtClock(l.apptTime)) : '') : '') + '</div>' : '') +
    (!done && l.flag ? flagBoxHTML(l) : '') +
    '<div class="contact">' +
      '<div class="cRow">' + ic('call', 16) + (p.tel ? '<a href="' + esc(telLink(l.phone)) + '">' + esc(p.pretty) + '</a><button class="btn btn-ghost" data-act="copyVal" data-v="' + esc(p.pretty) + '">' + ic('copy', 14) + 'Copy</button>' : '<span class="muted">' + (l.phone ? esc(l.phone) + ' (doesn’t look like a phone number)' : 'No phone number') + '</span>') + '</div>' +
      '<div class="cRow">' + ic('email', 16) + (em ? '<a href="mailto:' + esc(l.email.trim()) + '">' + esc(l.email.trim()) + '</a><button class="btn btn-ghost" data-act="copyVal" data-v="' + esc(l.email.trim()) + '">' + ic('copy', 14) + 'Copy</button>' : '<span class="muted">' + (l.email ? esc(l.email) + ' (doesn’t look like an email)' : 'No email') + '</span>') + '</div>' +
    '</div>' +
    (working ? nowBoxHTML(l, i) : '') +
    (l.message ? '<div class="sec"><h5>Their message</h5><div class="txt">' + esc(l.message) + '</div></div>' : '') +
    (extra.length ? '<div class="sec"><h5>Also on the form</h5><div class="kv">' + extra.map(k => kv(esc(k), esc(l.extra[k]))).join('') + '</div></div>' : '') +
    '<div class="sec"><h5>Follow-up plan</h5>' + planHTML(l) + '</div>' +
    '<div class="sec"><h5>Details</h5><div class="kv">' +
      '<div style="grid-column:1/-1"><div class="k">Assigned to</div>' + assignSel + '</div>' +
      kv('Received', esc(fmtWhen(receivedAt(l)))) + kv('Came from', esc(srcLabel(l))) +
      (l.appt ? kv('Appointment', esc(fmtDay(l.appt) + (l.apptTime ? ' · ' + fmtClock(l.apptTime) : ''))) : '') +
      kv('Last update', esc(l.updatedAt ? fmtWhen(l.updatedAt) + (l.by ? ' · ' + firstName(staffName(l.by, '')) : '') : '')) +
    '</div>' + (l.src && l.src.raw ? '<details class="raw"><summary>Original form, as received</summary><div class="txt">' + esc(l.src.raw) + '</div></details>' : '') + '</div>' +
    '<div class="sec"><h5>Comments</h5>' + ((l.comments || []).map(x => '<div class="cmt"><span class="av">' + esc(initials(staffName(x.by, x.by))) + '</span><div><div class="w"><b>' + esc(firstName(staffName(x.by, x.by)) || '—') + '</b> · ' + esc(fmtWhen(x.at)) + '</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(x.text) + '</div></div></div>').join('') || '<div class="small muted" style="margin-bottom:6px">No comments yet.</div>') +
    '<div class="field" style="margin-top:8px;margin-bottom:6px"><label for="cmtText" class="hidden">Add a comment</label><textarea id="cmtText" data-keep rows="2" placeholder="Add a comment…"></textarea></div><button class="btn btn-sec btn-sm" data-act="addCmt">Add comment</button></div>' +
    '<div class="sec"><h5>History</h5><div id="histBox">' + historyHTML() + '</div></div></div>' +
    '<div class="dFt">' + (done ? '<button class="btn btn-pri btn-sm" data-act="reopen">' + ic('refresh', 15) + 'Reopen</button>' :
      '<button class="btn btn-sec btn-sm" data-act="closeLead">' + ic('done', 15) + 'Close lead…</button><button class="btn btn-sec btn-sm" data-act="edit">' + ic('edit', 15) + 'Edit details</button>') +
    (owner ? '<span style="flex:1"></span><button class="btn btn-ghost" data-act="versions">' + ic('clock', 16) + 'Versions</button><button class="btn btn-ghost" data-act="delLead" style="color:var(--coral-700)">' + ic('trash', 16) + 'Delete</button>' : '') + '</div>';
  restoreInputs(d, keep);
}
/* the attempt to make now: how to reach them, the message to send, and one tap to log what happened */
function nowBoxHTML(l, i) {
  const s = l.steps[i], kind = s.kind, p = phoneInfo(l.phone);
  let how = '';
  if (kind === 'call') {
    how = p.tel ? '<a class="btn btn-act" href="' + esc(telLink(l.phone)) + '">' + ic('call', 16) + 'Call ' + esc(p.pretty) + '</a>' : '<div class="small" style="color:var(--coral-700)">No phone number on file. Add one with Edit details, or log the attempt.</div>';
  } else {
    const m = messageFor(l, i, S.cfg, senderName(B.me && B.me.name));
    const link = kind === 'text' ? smsLink(l.phone, m.body) : mailLink(l.email, m.subject, m.body);
    const can = { text: !!p.tel, email: validEmail(l.email) };
    how = '<div class="seg" role="group" aria-label="Text or email">' + ['text', 'email'].map(k => '<button data-act="setKind" data-k="' + k + '" data-i="' + i + '" aria-pressed="' + (kind === k) + '"' + (!can[k] && kind !== k ? ' disabled title="' + (k === 'text' ? 'No phone number on file' : 'No email on file') + '"' : '') + '>' + ic(k, 14) + KIND[k] + '</button>').join('') + '</div>' +
      (kind === 'email' ? '<div class="small muted" style="margin-top:8px">Subject: <b>' + esc(m.subject) + '</b></div>' : '') + '<div class="msgPrev">' + esc(m.body) + '</div>' +
      '<div class="btnRow">' + (link ? '<a class="btn btn-act btn-sm" href="' + esc(link) + '">' + ic(kind, 15) + (kind === 'text' ? 'Open in Messages' : 'Open in email') + '</a>' : '<span class="small" style="color:var(--coral-700)">' + (kind === 'text' ? 'No mobile number on file.' : 'No email on file.') + '</span>') +
      '<button class="btn btn-sec btn-sm" data-act="copyVal" data-v="' + esc(kind === 'email' ? 'Subject: ' + m.subject + '\n\n' + m.body : m.body) + '">' + ic('copy', 15) + 'Copy message</button></div>';
  }
  const R = kind === 'call' ? ['sched', 'vm', 'none', 'pending', 'follow', 'no'] : ['sched', 'sent', 'pending', 'follow', 'no'];
  const form = S.ui.form && S.ui.step === i ? inlineFormHTML(l, i) : '', pendForm = S.ui.form === 'pending' && S.ui.step === i;
  return '<div class="nowBox"><div class="nowHd"><span class="nowN">' + (i < STEP_DEFS.length ? 'Attempt ' + (i + 1) + ' of ' + STEP_DEFS.length : 'Follow-up') + '</span><b>' + esc(stepLabel(l, i)) + '</b><span style="flex:1"></span>' + dueChip(l) + '</div>' +
    '<div class="nowHow">' + how + '</div>' +
    '<div class="flabel" style="margin-top:14px">What happened?</div><div class="rbRow">' + R.map(r => '<button class="rb r-' + r + '" data-act="logRes" data-res="' + r + '" data-i="' + i + '"' + (RES_TIP[r] ? ' title="' + esc(RES_TIP[r]) + '"' : '') + (S.ui.form === r ? ' aria-pressed="true"' : '') + '>' + esc(RES_BTN[r]) + '</button>').join('') + '</div>' + form +
    (pendForm ? '' : '<div class="field" style="margin:10px 0 0"><label for="nowNote" class="hidden">Note</label><input id="nowNote" data-keep placeholder="Note (optional) — e.g. call back after 3 PM" autocomplete="off"></div>') +
    '<div class="small" style="margin-top:8px"><button class="linkBtn" data-act="moveStep" data-i="' + i + '">Do this on another day</button></div></div>';
}
function inlineFormHTML(l, i) {
  const t = todayISO(), next = nextOfficeDay(addDays(t, 1), S.cfg);
  if (S.ui.form === 'pending') return '<div class="inForm"><div class="field" style="margin-bottom:8px"><label for="nowNote">What is it pending on?</label><input id="nowNote" data-keep placeholder="e.g. checking their work schedule, will call back" autocomplete="off"></div>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="savePending" data-i="' + i + '">Save — pending</button><button class="btn btn-ghost" data-act="cancelForm">Cancel</button></div>' +
    '<div class="small muted" style="margin-top:6px">No day to pick — the follow-up plan carries on, starting the next office day.</div></div>';
  if (S.ui.form === 'sched') return '<div class="inForm"><div class="grid2"><div class="field"><label for="apDate">Appointment day (optional)</label><input type="date" id="apDate" data-keep min="' + t + '"></div>' +
    '<div class="field"><label for="apTime">Time (optional)</label><input type="time" id="apTime" data-keep step="300"></div></div>' +
    '<div class="btnRow"><button class="btn btn-mint btn-sm" data-act="saveSched" data-i="' + i + '">' + ic('done', 15) + 'Save — scheduled</button><button class="btn btn-ghost" data-act="cancelForm">Cancel</button></div>' +
    '<div class="small muted" style="margin-top:6px">This closes the lead as scheduled. If they don’t show, reopen it.</div></div>';
  const quick = [['Next office day', next], ['Next week', nextOfficeDay(addDays(t, 7), S.cfg)], ['In 2 weeks', nextOfficeDay(addDays(t, 14), S.cfg)], ['In a month', nextOfficeDay(addDays(t, 30), S.cfg)]];
  const isMove = S.ui.form === 'move';
  return '<div class="inForm"><div class="flabel">' + (isMove ? 'Move this attempt (and the ones after it) to' : 'Follow up on') + '</div><div class="pickRow" style="margin-bottom:8px">' +
    quick.map(([lbl, d]) => '<button class="pick sm" data-act="pickDay" data-d="' + d + '">' + esc(lbl) + ' · ' + esc(fmtDay(d).split(',')[0]) + '</button>').join('') + '</div>' +
    '<div class="field" style="max-width:220px"><label for="fuDate" class="hidden">Day</label><input type="date" id="fuDate" data-keep min="' + t + '" value="' + next + '"></div>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="' + (isMove ? 'saveMove' : 'saveFollow') + '" data-i="' + i + '">' + (isMove ? 'Move' : 'Save follow-up') + '</button><button class="btn btn-ghost" data-act="cancelForm">Cancel</button></div>' +
    (isMove ? '' : '<div class="small muted" style="margin-top:6px">Use this when they answered and asked to be contacted later. The rest of the plan moves with it. No particular day? Use “Pending (see notes)” instead.</div>') + '</div>';
}
function planHTML(l) {
  const cur = curStep(l), last = lastDone(l), canU = canUndo(l);
  return '<div class="plan">' + l.steps.map((s, i) => {
    const st = s.doneAt ? 'done' : s.skip ? 'skip' : i === cur && !l.flag && l.status !== 'done' ? 'cur' : 'todo';
    const sub = s.doneAt ? ((RES[s.res] || {}).l || s.res) + ' · ' + (firstName(staffName(s.by, s.by)) || '—') + ' · ' + fmtWhen(s.doneAt)
      : s.skip ? (s.skip === 'sched' ? 'Not needed — appointment scheduled' : 'Not needed — lead closed')
      : (st === 'cur' ? 'Due ' : 'Planned ') + fmtDay(s.due) + (dayDiff(s.due) < 0 && st === 'cur' ? ' (late)' : '');
    return '<div class="ps ' + st + '"><span class="pn">' + (s.doneAt ? '✓' : i + 1) + '</span><div class="pb"><div class="pl"><b>' + esc(stepLabel(l, i)) + '</b><span class="pk k-' + s.kind + '">' + ic(s.kind, 13) + KIND[s.kind] + '</span></div>' +
      '<div class="pm">' + esc(sub) + '</div>' + (s.note ? '<div class="pnote">' + esc(s.note) + '</div>' : '') + '</div>' +
      (i === last && canU ? '<button class="btn btn-ghost" data-act="undoLog" title="Take back this attempt">' + ic('undo', 14) + 'Undo</button>' : '') + '</div>';
  }).join('') + '</div>';
}
function flagBoxHTML(l) {
  const other = l.dupOf && findLead(l.dupOf);
  const btn = (act, label, cls) => '<button class="btn ' + (cls || 'btn-sec') + ' btn-sm" data-act="' + act + '">' + label + '</button>';
  const acts = l.flag === 'test' ? btn('flagClose', 'Close test request', 'btn-pri') + btn('flagClear', 'It’s a real lead')
    : l.flag === 'dup' ? btn('flagClear', 'It’s a new request — start follow-up', 'btn-pri') + btn('flagDup', 'Close as duplicate') + (other ? btn('openDup', 'Open the earlier one') : '')
    : l.flag === 'spam' ? btn('flagClear', 'Not spam — start follow-up', 'btn-pri') + btn('flagSpam', 'Close as spam')
    : btn('flagClear', 'Looks fine — start follow-up', 'btn-pri') + btn('edit', 'Fix the details') + btn('flagSpam', 'Close as spam');
  return '<div class="flagBox f-' + esc(l.flag) + '"><div class="fbT">' + ic('flag', 16) + esc(FLAG_LABEL[l.flag] || 'Needs a look') + '</div>' + (l.flagWhy ? '<div class="fbW">' + esc(l.flagWhy) + '</div>' : '') +
    '<div class="small" style="margin:6px 0 10px">The follow-up plan starts once someone checks it.</div><div class="btnRow">' + acts + '</div></div>';
}
function histText(x) {
  switch (x.a) {
    case 'create': return x.how === 'website' ? 'added it from the website' : 'added the lead';
    case 'import': return 'imported it from Asana';
    case 'log': return 'logged attempt ' + (Number(x.i) + 1) + ': ' + String((RES[x.res] || {}).l || x.res).toLowerCase();
    case 'undo': return 'took back the last attempt';
    case 'close': return 'closed it — ' + String(CLOSE_WHY[x.why] || x.why || '').toLowerCase();
    case 'reopen': return 'reopened it';
    case 'move': return 'moved the next attempt to ' + fmtDay(x.to);
    case 'flag': return 'checked it and started the follow-up';
    case 'assign': return x.to ? 'assigned it to ' + staffName(x.to, x.to) : 'unassigned it';
    case 'edit': return 'changed ' + (x.fields || []).map(f => FIELD_LABELS[f] || f).join(', ');
    case 'kind': return 'switched attempt ' + (Number(x.i) + 1) + ' to ' + (x.to === 'text' ? 'a text' : 'an email');
    case 'comment': return 'added a comment';
    case 'restore': return 'restored an earlier version';
    case 'delete': return 'deleted it';
    default: return x.a || '';
  }
}
function historyHTML() {
  const h = S.history; if (!h) return '<div class="small muted">Loading…</div>'; if (!h.length) return '<div class="small muted">No history yet.</div>';
  return h.filter(x => x.a !== 'rekey' && x.a !== 'save').slice().reverse().map(x =>
    '<div class="hist"><time>' + esc(fmtWhen(x.at)) + '</time><span><b>' + esc(x.a === 'create' && x.how === 'website' ? 'Website' : (firstName(staffName(x.sid, x.sid)) || x.sid || '')) + '</b> ' + esc(histText(x)) + '</span></div>').join('');
}

/* ---------- logging an attempt ---------- */
function logResult(id, i, res, extra) {
  const note = (($('#nowNote') || {}).value || '').trim(), now = Date.now(), cfg = S.cfg;
  const o = Object.assign({ by: meSid(), note }, extra || {});
  const fn = l => { const r = applyResult(l, i, res, o, cfg, now); return res === 'sched' ? closeLead(l, 'sched') : r === 'done' ? 'done' : undefined; };
  const before = findLead(id); if (!before) return;
  // check first, so a missing date is caught here and not after the change is shown
  try { fn(JSON.parse(JSON.stringify(before))); } catch (e) { toast(errText(e), { bad: true }); if (e && e.code === 'need-note') { const n = $('#nowNote'); if (n) n.focus(); } return; }
  S.ui = {}; const ni = $('#nowNote'); if (ni) ni.value = '';
  change(id, fn, { a: 'log', i, res });
  const l = findLead(id), nx = l && l.status !== 'done' ? curStep(l) : -1;
  const msg = res === 'sched' ? 'Appointment scheduled — lead closed' : l && l.status === 'done' ? RES[res].s + ' — lead closed (' + String(CLOSE_WHY[l.closeWhy] || '').toLowerCase() + ')'
    : 'Logged: ' + RES[res].s + (nx >= 0 ? ' · next: ' + KIND[l.steps[nx].kind].toLowerCase() + ' ' + (dayDiff(l.steps[nx].due) === 0 ? 'today' : fmtDay(l.steps[nx].due)) : '');
  toast(msg, { action: 'Undo', onAction: () => undoLast(id) });
}
function undoLast(id) {
  const l = findLead(id); if (!l || !canUndo(l)) { toast('Can’t undo that any more — it has changed since.', { bad: true }); return; }
  change(id, d => undoStep(d), { a: 'undo' }, 'Undone');
}
Object.assign(ACT, {
  logRes(t) {
    const i = Number(t.dataset.i), res = t.dataset.res;
    // Pending with the note already written logs at once; otherwise it asks what it's pending on
    if (res === 'pending' && S.ui.form !== 'pending' && (($('#nowNote') || {}).value || '').trim()) { logResult(S.openId, i, res); return; }
    if (res === 'sched' || res === 'follow' || res === 'pending') { S.ui = S.ui.form === res ? {} : { form: res, step: i }; renderDrawer(); const f = $(res === 'sched' ? '#apDate' : res === 'pending' ? '#nowNote' : '#fuDate'); if (f) f.focus(); return; }
    logResult(S.openId, i, res);
  },
  saveSched(t) { logResult(S.openId, Number(t.dataset.i), 'sched', { appt: ($('#apDate') || {}).value || '', apptTime: ($('#apTime') || {}).value || '' }); },
  saveFollow(t) { logResult(S.openId, Number(t.dataset.i), 'follow', { follow: ($('#fuDate') || {}).value || '' }); },
  savePending(t) { logResult(S.openId, Number(t.dataset.i), 'pending'); },
  pickDay(t) { const f = $('#fuDate'); if (f) f.value = t.dataset.d; },
  cancelForm() { S.ui = {}; renderDrawer(); },
  moveStep(t) { S.ui = S.ui.form === 'move' ? {} : { form: 'move', step: Number(t.dataset.i) }; renderDrawer(); },
  saveMove() {
    const d = ($('#fuDate') || {}).value || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < todayISO()) { toast('Pick today or a day ahead.', { bad: true }); return; }
    S.ui = {}; const to = nextOfficeDay(d, S.cfg);
    change(S.openId, l => { rebase(l, d, S.cfg); }, { a: 'move', to }, 'Moved to ' + fmtDay(to) + (to !== d ? ' (the next office day)' : ''));
  },
  setKind(t) { const i = Number(t.dataset.i), k = t.dataset.k; const l = findLead(S.openId); if (!l || l.steps[i].kind === k) return; change(S.openId, d => { setStepKind(d, i, k); }, { a: 'kind', i, to: k }); },
  undoLog() { undoLast(S.openId); },
  flagClear() { change(S.openId, l => { clearFlag(l, S.cfg, todayISO()); }, { a: 'flag' }, 'Checked — the follow-up has started'); },
  flagClose() { closeAs(S.openId, 'test'); },
  flagSpam() { closeAs(S.openId, 'spam'); },
  flagDup() {
    const l = findLead(S.openId); if (!l) return; const other = l.dupOf;
    closeAs(l.id, 'dup');
    if (other) noteOn(other, 'Sent another request ' + fmtWhen(receivedAt(l)) + (l.message ? ': “' + l.message.slice(0, 400) + '”' : '') + ' (closed as a duplicate)');
  },
  openDup() { const l = findLead(S.openId); if (l && l.dupOf) openDrawer(l.dupOf); },
  addCmt() {
    const el = $('#cmtText'); const txt = (el && el.value || '').trim(); if (!txt) return; el.value = '';
    const c = { id: uid8(), at: Date.now(), by: meSid(), text: txt };
    change(S.openId, d => { d.comments = (d.comments || []).concat([c]); }, { a: 'comment' });
  },
  reopen() { change(S.openId, l => reopenLead(l, S.cfg, todayISO()), { a: 'reopen' }, 'Reopened — the remaining attempts start today'); },
  closeLead() { closeModalFor(S.openId); },
  edit() { const l = findLead(S.openId); if (!l) return; S.editBase = JSON.parse(JSON.stringify(l)); S.editing = true; renderDrawer(); },
  cancelEdit() { S.editing = false; renderDrawer(); },
  saveEdit() { saveEdit(); },
  delLead: async () => {
    const l = findLead(S.openId); if (!l) return;
    if (!(await confirmBox('Delete this lead?', 'This removes ' + leadName(l) + ' from every list. You can bring it back from Settings → Deleted leads for 90 days. To finish a lead normally, use “Close lead” instead.', 'Delete', true))) return;
    const id = l.id; closeDrawer(true); S.closed = S.closed.filter(x => x.id !== id);
    act(() => B.deleteLead(id), 'Lead deleted');
  },
  versions() { versionsModal(S.openId); },
  restoreVer(t) { restoreVer(Number(t.dataset.i)); },
  newLead() { newLeadModal(); }
});
CHG.assign = t => {
  const to = t.value, id = S.openId;
  change(id, d => { d.assignee = to; if (to) d.assigneeName = ''; }, { a: 'assign', to }, to ? 'Assigned to ' + staffName(to) : 'Unassigned');
};
function closeAs(id, why) {
  const label = String(CLOSE_WHY[why] || why).toLowerCase();
  change(id, l => closeLead(l, why), { a: 'close', why }, 'Closed as ' + label);
  if (S.openId === id) closeDrawer(true);
}
function closeModalFor(id) {
  const l = findLead(id); if (!l) return;
  const order = ['sched', 'notint', 'noresp', 'other', 'dup', 'spam', 'test'];
  openModal('<h3>Close this lead</h3><div class="lsub">' + esc(leadName(l)) + ' · ' + l.steps.filter(s => s.doneAt).length + ' attempt' + (l.steps.filter(s => s.doneAt).length === 1 ? '' : 's') + ' made</div>' +
    '<div class="flabel">Why?</div><div class="pickRow" id="cwPick">' + order.map(k => '<button class="pick" data-why="' + k + '" aria-pressed="false">' + esc(CLOSE_WHY[k]) + '</button>').join('') + '</div>' +
    '<div class="field" style="margin-top:14px"><label for="cwNote">Note (optional)</label><textarea id="cwNote" rows="2"></textarea></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="cwOk" disabled>Close lead</button></div>', w => {
      let why = '';
      $$('#cwPick .pick', w).forEach(b => b.onclick = () => { why = b.dataset.why; $$('#cwPick .pick', w).forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#cwOk', w).disabled = false; });
      $('#cwOk', w).onclick = () => {
        const note = $('#cwNote', w).value.trim(), c = note ? { id: uid8(), at: Date.now(), by: meSid(), text: 'Closed (' + CLOSE_WHY[why] + '): ' + note } : null;
        closeModal();
        change(id, d => { if (c) d.comments = (d.comments || []).concat([c]); return closeLead(d, why); }, { a: 'close', why }, 'Closed — ' + String(CLOSE_WHY[why]).toLowerCase());
        if (S.openId === id) closeDrawer(true);
      };
    });
}

/* ---------- edit details ---------- */
function editHTML() {
  const b = S.editBase, web = b.src && b.src.kind === 'website';
  return '<div class="dHd"><div style="flex:1"><h3>Edit details</h3><div class="sub small muted">' + esc(leadName(b)) + '</div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="dBd"><div id="drawerNotice"></div>' + leadFieldsHTML(b, 'ed', !web) + '</div>' +
    '<div class="dFt"><button class="btn btn-pri" data-act="saveEdit">Save changes</button><button class="btn btn-sec" data-act="cancelEdit">Cancel</button></div>';
}
function leadFieldsHTML(l, p, showHow) {
  const v = k => esc(l[k] || '');
  return '<div class="grid2"><div class="field"><label for="' + p + '-name">Patient name</label><input id="' + p + '-name" data-keep autocomplete="off" value="' + v('name') + '"></div>' +
    '<div class="field"><label for="' + p + '-parent">Parent or guardian</label><input id="' + p + '-parent" data-keep autocomplete="off" value="' + v('parent') + '"></div></div>' +
    '<div class="grid2"><div class="field"><label for="' + p + '-phone">Phone</label><input id="' + p + '-phone" data-keep type="tel" autocomplete="off" value="' + v('phone') + '"></div>' +
    '<div class="field"><label for="' + p + '-email">Email</label><input id="' + p + '-email" data-keep type="email" autocomplete="off" value="' + v('email') + '"></div></div>' +
    (showHow ? '<div class="field"><label>How they reached us</label><div class="pickRow" id="' + p + '-how">' + HOW.map(h => '<button type="button" class="pick sm" data-how="' + esc(h) + '" aria-pressed="' + ((l.src && l.src.how) === h) + '">' + esc(h) + '</button>').join('') + '</div></div>' : '') +
    '<div class="field"><label for="' + p + '-message">Message / notes</label><textarea id="' + p + '-message" data-keep rows="3">' + v('message') + '</textarea></div>';
}
function readLeadFields(root, p) {
  const g = k => (($('#' + p + '-' + k, root) || {}).value || '').trim();
  const how = $('#' + p + '-how [aria-pressed="true"]', root);
  return { name: properName(g('name')), parent: properName(g('parent')), phone: g('phone'), email: g('email'), message: g('message'), how: how ? how.dataset.how : '' };
}
document.addEventListener('click', e => { // pick one "how they reached us" button
  const b = e.target.closest('[data-how]'); if (!b) return;
  $$('[data-how]', b.parentNode).forEach(x => x.setAttribute('aria-pressed', String(x === b && x.getAttribute('aria-pressed') !== 'true')));
});
function editDirty() {
  if (!S.editing || !S.editBase) return false; const d = $('#drawer'); if (!d) return false;
  const now = readLeadFields(d, 'ed'), b = S.editBase;
  return ['name', 'parent', 'phone', 'email', 'message'].some(k => now[k] !== (b[k] || '')) || (now.how && now.how !== ((b.src && b.src.how) || ''));
}
function saveEdit() {
  const d = $('#drawer'), now = readLeadFields(d, 'ed'), b = S.editBase, web = b.src && b.src.kind === 'website';
  if (!now.name && !now.parent) { $('#drawerNotice').innerHTML = '<div class="notice bad">Add the patient’s or the parent’s name.</div>'; return; }
  const fields = ['name', 'parent', 'phone', 'email', 'message'].filter(k => now[k] !== (b[k] || '')).concat(!web && now.how !== ((b.src && b.src.how) || '') ? ['how'] : []);
  S.editing = false;
  if (!fields.length) { renderDrawer(); return; }
  change(S.openId, x => {
    fields.forEach(k => { if (k === 'how') x.src = Object.assign({}, x.src, { how: now.how }); else x[k] = now[k]; });
    if (fields.includes('phone') || fields.includes('email')) setKinds(x);
  }, { a: 'edit', fields }, 'Saved');
  loadHistory(S.openId);
}

/* ---------- new lead (phone call, walk-in, referral…) ---------- */
function newLeadModal() {
  const now = new Date(), who = pickAssignee(S.cfg, S.roster) || meSid();
  openModal('<h3>New lead</h3><div class="lsub">For a phone call, walk-in or referral. Website requests are added automatically.</div><form id="nlForm" autocomplete="off">' +
    leadFieldsHTML({ src: { how: 'Phone call' } }, 'nl', true) +
    '<div class="grid3"><div class="field"><label for="nl-day">Received</label><input type="date" id="nl-day" value="' + isoOf(now) + '" max="' + isoOf(now) + '"></div>' +
    '<div class="field"><label for="nl-time">Time</label><input type="time" id="nl-time" value="' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + '"></div>' +
    '<div class="field"><label for="nl-who">Assigned to</label><select id="nl-who"><option value="">Unassigned</option>' + activeRoster().map(r => '<option value="' + esc(r.sid) + '"' + (r.sid === who ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></div></div>' +
    '<div id="nlMsg"></div><div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Cancel</button><button class="btn btn-pri" type="submit" id="nlSave">Add lead</button></div></form>', w => {
      let okNoContact = false, okDup = false;
      $('#nlForm', w).onsubmit = async e => {
        e.preventDefault();
        const f = readLeadFields(w, 'nl'), msg = $('#nlMsg', w);
        if (!f.name && !f.parent) { msg.innerHTML = '<div class="lockErr">Add the patient’s or the parent’s name.</div>'; return; }
        if (!phoneInfo(f.phone).ok && !validEmail(f.email) && !okNoContact) { msg.innerHTML = '<div class="notice">No working phone number or email — the follow-up can’t reach them. Press Add lead again to add it anyway.</div>'; okNoContact = true; return; }
        const [y, mo, d] = ($('#nl-day', w).value || isoOf(new Date())).split('-').map(Number), [hh, mm] = ($('#nl-time', w).value || '09:00').split(':').map(Number);
        const recv = Math.min(Date.now(), new Date(y, mo - 1, d, hh, mm).getTime());
        const l = Object.assign(blankLead(), { name: f.name, parent: f.parent, phone: f.phone, email: f.email, message: f.message });
        l.src = { kind: 'manual', how: f.how || 'Other' };
        startLead(l, recv, S.cfg); l.assignee = $('#nl-who', w).value; l.createdAt = Date.now(); l.createdBy = meSid();
        const dup = findDup(l, leadPool(), 45);
        if (dup && !okDup) {
          msg.innerHTML = '<div class="notice">Same ' + (phoneInfo(dup.phone).digits === phoneInfo(l.phone).digits && phoneInfo(l.phone).ok ? 'phone number' : 'email') + ' as <b>' + esc(leadName(dup)) + '</b> (' + (dup.status === 'done' ? 'closed' : 'open') + ', received ' + esc(fmtDate(isoOf(new Date(receivedAt(dup))))) + '). <button class="linkBtn" type="button" data-act="openDupNew" data-id="' + esc(dup.id) + '">Open that lead</button> or press Add lead again to add this one too.</div>';
          okDup = true; return;
        }
        const btn = $('#nlSave', w); busyBtn(btn, true, 'Adding…');
        try {
          const id = await B.createLead(l, { a: 'create', how: 'manual' });
          closeModal();
          if (!S.leads.has(id)) placeLead(Object.assign(JSON.parse(JSON.stringify(l)), { id, rev: 1, status: 'open', updatedAt: Date.now(), closedAt: null }));
          toast('Lead added'); openDrawer(id);
        } catch (x) { busyBtn(btn, false); msg.innerHTML = '<div class="lockErr">' + esc(errText(x)) + '</div>'; }
      };
    });
}
ACT.openDupNew = t => { closeModal(); openDrawer(t.dataset.id); };

/* ---------- modals ---------- */
function openModal(html, onReady) {
  closeModal();
  const w = document.createElement('div'); w.id = 'modalWrap';
  w.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
  w.addEventListener('mousedown', e => { if (e.target === w && !w.querySelector('#nlForm')) closeModal(); });
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
async function versionsModal(id) {
  openModal('<h3>Saved versions</h3><div class="lsub">Every change keeps the copy it replaced. Restoring makes that copy current again (and keeps today’s too).</div><div id="verList"><div class="small muted">Loading…</div></div><div class="mFt"><button class="btn btn-sec" data-act="closeModal">Close</button></div>');
  try {
    const list = await B.leadVersions(id); S.verList = list; S.verId = id;
    const how = { log: 'logged an attempt', undo: 'undo', comment: 'commented', edit: 'edited', close: 'closed', reopen: 'reopened', assign: 'reassigned', restore: 'restored', move: 'moved', flag: 'checked', kind: 'text/email', save: 'saved', rekey: 'key change', delete: 'deleted' };
    $('#verList').innerHTML = list.length ? '<div class="tblWrap"><table class="tbl"><thead><tr><th>Version</th><th>Contents</th><th></th></tr></thead><tbody>' + list.map((v, i) =>
      '<tr><td class="small"><b>#' + v.rev + '</b><div class="muted">replaced ' + esc(fmtWhen(v.replacedAt)) + '<br>by ' + esc(firstName(staffName(v.replacedBy, v.replacedBy))) + (v.replacedHow ? ' (' + esc(how[v.replacedHow] || v.replacedHow) + ')' : '') + '</div></td>' +
      '<td class="small">' + (v.data ? '<b>' + esc(leadName(v.data)) + '</b><div class="muted">' + esc((v.data.closeWhy ? 'Closed: ' + (CLOSE_WHY[v.data.closeWhy] || '') : stepMeta(Object.assign({}, v.data, { status: 'open' }))) + ' · ' + (v.data.steps || []).filter(s => s.doneAt).length + ' attempts') + '</div>' : '<span style="color:var(--coral-700)">Can’t be read</span>') + '</td>' +
      '<td style="text-align:right">' + (v.data ? '<button class="btn btn-sec btn-sm" data-act="restoreVer" data-i="' + i + '">Restore</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="small muted">No earlier versions yet.</div>';
  } catch (x) { $('#verList').innerHTML = '<div class="lockErr">' + esc(errText(x)) + '</div>'; }
}
async function restoreVer(i) {
  const v = S.verList && S.verList[i]; if (!v || !v.data) return;
  try { await B.restoreVersion(S.verId, v.data); closeModal(); toast('Version #' + v.rev + ' restored'); if (S.openId === S.verId) loadHistory(S.verId); }
  catch (x) { toast(errText(x), { bad: true }); }
}
