/* =====================================================================
   The screens for people signed in: managers (Now, Timesheets, Payroll,
   People, Alerts, Settings) and anyone's own week (My time — where they
   also clock in on their own phone or computer at the office, once Dr. A
   turns the office lock on).
   Managers are Dr. A and the people he makes time clock managers. Only Dr. A
   changes settings, who's on the clock and where alerts go; nobody
   corrects their own time except Dr. A (the database enforces both).
   ===================================================================== */
const VIEWS = {};
const isMe = sid => !!(B.me && B.me.staffId === sid);
const canFix = sid => S.role === 'mgr' && (!isMe(sid) || B.isOwner());
function chip(t, cls) { return '<span class="stat ' + (cls || 'off') + '">' + esc(t) + '</span>'; }
function stateChip(w) { return w.state === 'in' ? chip('In' + (w.src === 'home' ? ' · home' : ''), 'ok') : w.state === 'lunch' ? chip('Lunch', 'wait') : chip('Out', 'off'); }
const FLAG = { early: ['Early', 'wait'], offday: ['Closed day', 'wait'], home: ['Home', 'info'], homeday: ['Home, other day', 'wait'], offnet: ['Off the office network', 'bad'], nonet: ['Network not checked', 'wait'], late: ['Still in late', 'bad'], long: ['Long shift', 'wait'] };
const ISSUE = { 'missing-out': 'No clock-out', 'no-return': 'Never back from lunch', 'no-in': 'No clock-in', 'lunch-out': 'Out from lunch, no Back', 'double-in': 'Clocked in twice', 'double-out': 'Clocked out twice', 'double-lunch': 'Lunch pressed twice' };
const FIXME = ['missing-out', 'no-return', 'no-in', 'lunch-out']; // the ones that leave time uncounted until a manager adds a punch
/* an open request from the person that covers this missing punch */
function askedFor(sid, x) {
  const kinds = x.type === 'missing-out' ? ['out'] : x.type === 'no-return' ? ['back', 'out'] : x.type === 'lunch-out' ? ['back'] : ['in', 'back'];
  return reqsOf(sid, 'open').find(r => r.ps.some(p => kinds.includes(p.k) && TCE.dayOf(p.t) === x.day)) || null;
}
function weekBar(w, set) {
  if (w.sal) return '<div class="wBar sal" title="' + esc(TCE.hText(w.total) + ' (salaried: kept for the record)') + '"><span style="width:' + Math.min(100, w.total / (w.limit * 1.1) * 100).toFixed(2) + '%"></span></div>';
  const lim = w.limit, max = Math.max(lim * 1.1, w.total, w.approved || 0), pct = x => Math.min(100, x / max * 100);
  const cls = w.total >= lim ? 'bad' : (set.thr.length && w.total >= Math.min.apply(null, set.thr) * TCE.HOUR) ? 'warn' : 'ok';
  const ticks = set.thr.map(t => '<i class="tk" style="left:' + pct(t * TCE.HOUR).toFixed(2) + '%"></i>').join('') + '<i class="tk ot" style="left:' + pct(lim).toFixed(2) + '%"></i>';
  return '<div class="wBar ' + cls + '" title="' + esc(TCE.hText(w.total) + ' of ' + set.ot + ' h') + '"><span style="width:' + pct(w.total).toFixed(2) + '%"></span>' + ticks + '</div>';
}
function etaText(w) {
  if (w.sal) return 'Salaried';
  if (w.approved > w.limit) return w.total > w.approved ? 'Past the ' + TCE.h2(w.approved) + ' h approved' : 'OT approved to ' + TCE.h2(w.approved) + ' h' + (w.eta.approved ? ' · ' + TCE.timeText(w.eta.approved) : '');
  if (w.total >= w.limit) return 'In overtime (' + TCE.hText(w.ot) + ')';
  if (w.eta.ot) return 'Hits ' + S.set.ot + ' h at ' + whenText(w.eta.ot, nowMs());
  return '';
}

/* ---------- Now ---------- */
VIEWS.now = () => {
  const list = onClockList(), now = nowMs(), today = TCE.dayOf(now);
  if (!list.length) return '<div class="card"><div class="cardBd" style="padding-top:18px">Nobody is on the time clock yet. Add people in <button class="linkBtn" data-act="go" data-v="people">People</button>.</div></div>';
  const ws = list.map(r => ({ r, w: weekFor(r.sid) }));
  const inN = ws.filter(x => x.w.state === 'in').length, lunchN = ws.filter(x => x.w.state === 'lunch').length;
  const issues = [];
  ws.forEach(({ r, w }) => {
    w.issues.forEach(x => { if (FIXME.includes(x.type)) issues.push({ sid: r.sid, x }); });
    const lk = lockedUntil(r.sid); if (lk) issues.push({ sid: r.sid, x: { type: 'pin', until: lk } });
  });
  const near = ws.filter(x => !x.w.sal && (x.w.total >= x.w.limit || (S.set.thr.length && x.w.total >= Math.min.apply(null, S.set.thr) * TCE.HOUR))).length;
  const asks = openReqs();
  const tiles = '<div class="tiles">' +
    '<div class="tile mint"><span class="n">' + inN + '</span><span class="l">Clocked in</span></div>' +
    '<div class="tile amber"><span class="n">' + lunchN + '</span><span class="l">At lunch</span></div>' +
    '<div class="tile ' + (near ? 'amber' : '') + '"><span class="n">' + near + '</span><span class="l">Near or in overtime</span></div>' +
    '<div class="tile ' + (issues.length + asks.length ? 'red' : '') + '"><span class="n">' + (issues.length + asks.length) + '</span><span class="l">To fix</span></div></div>';
  const rows = ws.map(({ r, w }) => {
    const d = w.days.find(x => x.iso === today) || { ms: 0, flags: [] };
    const flags = d.flags.map(f => chip(FLAG[f.type][0], FLAG[f.type][1])).join(' ');
    return '<button class="nowRow" data-act="openSheet" data-sid="' + esc(r.sid) + '"><span class="nWho">' + avatar(r.sid) + '<b class="pt">' + esc(nameOf(r.sid)) + '</b></span>' +
      '<span class="nState">' + stateChip(w) + (w.since && w.state !== 'out' ? ' <span class="muted small">' + esc(TCE.timeText(w.since)) + '</span>' : '') + '</span>' +
      '<span class="nToday num"><span class="mLbl">Today </span>' + esc(TCE.hText(d.ms)) + '</span>' +
      '<span class="nWeek"><span class="wTot"><b>' + esc(TCE.hText(w.total)) + '</b>' + weekBar(w, S.set) + '</span></span>' +
      '<span class="nEta small">' + esc(etaText(w)) + (w.cap && w.cap < w.limit ? '<span class="muted"> Cap ' + esc(TCE.h2(w.cap)) + ' h</span>' : '') + '</span>' +
      '<span class="nFlags">' + flags + '</span></button>';
  }).join('');
  const issueRows = issues.map(({ sid, x }) => {
    if (x.type === 'pin') return '<div class="issue">' + avatar(sid) + '<div class="grow"><b>' + esc(nameOf(sid)) + '</b>: 5 wrong PINs at the time clock — locked until ' + esc(TCE.timeText(x.until)) + '.</div><button class="btn btn-sec btn-sm" data-act="clearTry" data-sid="' + esc(sid) + '">Clear the lockout</button></div>';
    const txt = x.type === 'missing-out' ? (x.kind === 'back' ? 'came back from lunch at ' : 'clocked in at ') + TCE.timeText(x.t) + ' on ' + TCE.dayText(x.day) + ' and never clocked out (' + (x.kind === 'back' ? 'the afternoon counts' : 'it counts') + ' 0 until the clock-out is added).'
      : x.type === 'no-in' ? (x.kind === 'out' ? 'clocked out at ' : 'went to lunch at ') + TCE.timeText(x.t) + ' on ' + TCE.dayText(x.day) + ' without clocking in (that time counts 0 until the clock-in is added).'
        : x.type === 'lunch-out' ? 'went to lunch at ' + TCE.timeText(x.lunchT) + ' on ' + TCE.dayText(x.day) + ' and clocked out at ' + TCE.timeText(x.t) + ' without coming back from lunch (if they worked the afternoon, add Back from lunch: until then it counts 0).'
        : 'went to lunch at ' + TCE.timeText(x.t) + ' on ' + TCE.dayText(x.day) + ' and never came back or clocked out.';
    const ask = askedFor(sid, x);
    return '<div class="issue">' + avatar(sid) + '<div class="grow"><b>' + esc(nameOf(sid)) + '</b> ' + esc(txt) + (ask ? '<div class="muted small">' + esc(firstName(nameOf(sid))) + ' asked for it: see Asked to fix above.</div>' : '') + '</div>' +
      (canFix(sid) ? '<button class="btn btn-sec btn-sm" data-act="addPunch" data-sid="' + esc(sid) + '" data-day="' + esc(x.day) + '" data-kind="' + (x.type === 'no-return' || x.type === 'lunch-out' ? 'back' : x.type === 'no-in' ? 'in' : 'out') + '">' + ic('plus', 14) + 'Add the missing punch</button>' : '<span class="muted small">Dr. A fixes your own time</span>') + '</div>';
  }).join('');
  return alertHealthHTML() + tiles +
    (asks.length ? '<div class="card" style="margin-bottom:18px"><div class="cardHd"><h3>' + ic('edit', 18) + ' Asked to fix</h3><span class="sub">Missed punches and notes from staff. A punch counts once you approve it.</span></div><div class="cardBd">' + asks.map(reqRowHTML).join('') + '</div></div>' : '') +
    (issues.length ? '<div class="card" style="margin-bottom:18px"><div class="cardHd"><h3>' + ic('warn', 18) + ' To fix</h3></div><div class="cardBd">' + issueRows + '</div></div>' : '') +
    '<div class="card"><div class="cardHd"><h3>This workweek</h3><span class="sub">' + esc(TCE.dayText(curWeek()) + ' – ' + TCE.dayText(TCE.addDays(curWeek(), 6))) + ' · overtime after ' + S.set.ot + ' h</span></div>' +
    '<div class="nowList"><div class="nowHead"><span>Person</span><span>Now</span><span class="num">Today</span><span>This week</span><span>Overtime</span><span>Today’s flags</span></div>' + rows + '</div></div>';
};
/* the alert script: a warning on Now when it hasn't checked in lately */
function alertHealthHTML() {
  if (!S.got.beat) return '';
  const last = S.beat.reduce((m, b) => Math.max(m, b.at), 0), now = nowMs();
  if (!S.beat.length) return '<div class="notice">' + (B.isOwner() ? 'Alerts aren’t set up yet: <button class="linkBtn" data-act="go" data-v="alerts">Alerts</button> → Get the script.' : 'Alerts aren’t set up yet (Dr. A, in Alerts).') + '</div>';
  const p = TCE.parts(now), night = p.h >= 22 || p.h < 5;
  if (now - last > (night ? 45 : 20) * TCE.MIN) return '<div class="notice bad">The alert script hasn’t checked in since ' + esc(whenText(last, now)) + ', so alerts may not be going out. See <button class="linkBtn" data-act="go" data-v="alerts">Alerts</button>.</div>';
  const err = S.beat.find(b => b.err && now - b.at < 20 * TCE.MIN);
  return err ? '<div class="notice">The alert script reports: ' + esc(err.err) + '</div>' : '';
}
ACT.openSheet = b => { S.person = b.dataset.sid; S.week = curWeek(); S.view = 'sheets'; renderView(); window.scrollTo(0, 0); };

/* ---------- requests to fix someone's time (missed punches, notes) ---------- */
function reqWhere(r) { return r.src === 'kiosk' ? 'at the time clock' : r.src === 'laptop' ? 'on an approved laptop' : 'on My time'; }
/* where a punch came from, in words (a timesheet's tip, a punch's details) */
function devName(uid) { const d = S.laptops.find(x => x.uid === uid) || S.kiosks.find(x => x.uid === uid); return d ? d.name : ''; }
function whereText(e) {
  if (e.src === 'fix') return 'added as a correction';
  if (e.src === 'home') return 'from home' + (e.via === 'laptop' ? ' (' + (devName(e.dev) || 'an approved laptop') + ')' : '');
  if (e.via === 'own') return 'on their own phone or computer, at the office';
  if (e.via === 'laptop') return 'on ' + (devName(e.dev) || 'an approved laptop') + ', at the office';
  return 'at the time clock' + (e.net === 'off' ? ', while it wasn’t on the office network' : e.net === 'unk' ? ', while the office network couldn’t be checked' : '');
}
function reqRowHTML(r) {
  const what = TCE.reqText(r), can = canFix(r.sid);
  return '<div class="issue rq">' + avatar(r.sid) + '<div class="grow"><b>' + esc(nameOf(r.sid)) + '</b> ' + (what ? 'missed a punch: ' + esc(what) : 'left a note') +
    '<div class="muted small">Asked ' + esc(reqWhere(r)) + ', ' + esc(whenText(r.at, nowMs())) + '</div>' + (r.note ? '<div class="rqQuote">“' + esc(r.note) + '”</div>' : '') + '</div>' +
    (can ? '<div class="rqActs">' + (what ? '<button class="btn btn-pri btn-sm" data-act="reqOk" data-id="' + esc(r.id) + '">' + ic('tick', 14) + 'Approve</button><button class="btn btn-sec btn-sm" data-act="reqOpen" data-id="' + esc(r.id) + '">Change…</button><button class="btn btn-ghost" data-act="reqOpen" data-id="' + esc(r.id) + '" data-no="1">Decline</button>'
      : '<button class="btn btn-sec btn-sm" data-act="reqOk" data-id="' + esc(r.id) + '">' + ic('tick', 14) + 'Done</button>') + '</div>'
      : '<span class="muted small">' + (isMe(r.sid) ? 'Another manager answers your own' : 'A manager answers it') + '</span>') + '</div>';
}
/* the correction's reason: who asked, where, their note (and what they asked for, when a manager changed it) */
function reqWhy(r, changed) {
  return ('Asked by ' + firstName(nameOf(r.sid)) + ' ' + reqWhere(r) + (changed ? ' for ' + TCE.reqText(r) : '') + (r.note ? ': ' + r.note : '')).slice(0, 300);
}
ACT.reqOk = async b => {
  const r = S.reqs.get(b.dataset.id); if (!r) return;
  await act(b, () => B.reqAnswer(r, true, r.ps, reqWhy(r, false), ''), r.ps.length ? 'Approved: added to ' + firstName(nameOf(r.sid)) + '’s timesheet.' : 'Marked done.');
};
ACT.reqOpen = b => {
  const r = S.reqs.get(b.dataset.id); if (!r) return;
  const rows = r.ps.map((p, i) => '<div class="grid3"><div class="field"><span class="flabel">Punch</span><div class="rqKind k-' + p.k + '">' + esc(KIND[p.k]) + '</div></div>' +
    '<div class="field"><label for="rqD' + i + '">Day</label><input id="rqD' + i + '" type="date" value="' + esc(TCE.dayOf(p.t)) + '"></div>' +
    '<div class="field"><label for="rqT' + i + '">Time</label><input id="rqT' + i + '" type="time" value="' + esc(hmOf(p.t)) + '"></div></div>').join('');
  openModal('<h3>' + esc(nameOf(r.sid)) + ' missed a punch</h3><p class="lsub">Asked ' + esc(reqWhere(r)) + ', ' + esc(whenText(r.at, nowMs())) + '. Change a time if it isn’t right, then approve; or decline.</p>' +
    (r.note ? '<div class="rqQuote" style="margin-bottom:12px">“' + esc(r.note) + '”</div>' : '') + rows +
    '<div class="field"><label for="rqWhy">Note for ' + esc(firstName(nameOf(r.sid))) + ' (optional, they see it)</label><input id="rqWhy" maxlength="300" placeholder="' + (b.dataset.no ? 'e.g. You clocked in at 8:30; see me' : 'e.g. Changed to 7:58 per the schedule') + '"></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-danger" data-act="reqGo" data-id="' + esc(r.id) + '" data-ok="0">Decline</button><button class="btn btn-pri" data-act="reqGo" data-id="' + esc(r.id) + '" data-ok="1">Approve</button></div>');
  if (b.dataset.no) setTimeout(() => { const x = $('#rqWhy'); if (x) x.focus(); }, 40);
};
ACT.reqGo = async b => {
  const r = S.reqs.get(b.dataset.id); if (!r) return;
  const ok = b.dataset.ok === '1', note = String(($('#rqWhy') || {}).value || '').trim();
  let ps = r.ps;
  if (ok) {
    ps = [];
    for (let i = 0; i < r.ps.length; i++) { const t = punchTime('rqD' + i, 'rqT' + i); if (!t) return; ps.push({ k: r.ps[i].k, t }); }
    if (ps.length === 2 && ps[1].t <= ps[0].t) { toast('Back from lunch has to be after going to lunch.', { bad: true }); return; }
  }
  const changed = ok && ps.some((p, i) => Math.abs(p.t - r.ps[i].t) >= TCE.MIN);
  if (await act(b, () => B.reqAnswer(r, ok, ps, reqWhy(r, changed) + (changed && note ? ' — ' + note : ''), note), ok ? 'Approved: added to ' + firstName(nameOf(r.sid)) + '’s timesheet.' : 'Declined. ' + firstName(nameOf(r.sid)) + ' sees it on My time.')) closeModal();
};
/* someone's requests (on My time, and the time clock's My week): waiting, approved, declined */
function reqListHTML(sid, from, kiosk) {
  const list = reqsOf(sid).filter(r => r.st !== 'x' && (r.at >= from || r.st === 'open'));
  if (!list.length) return '';
  const now = nowMs();
  const row = r => {
    const what = TCE.reqText(r) || 'Note: “' + r.note + '”';
    const st = r.st === 'open' ? 'Waiting for a manager' : r.st === 'ok' ? (r.ps.length ? 'Approved' : 'Seen') + (r.rbsid ? ' by ' + nameOf(r.rbsid) : '') : 'Declined' + (r.rbsid ? ' by ' + nameOf(r.rbsid) : '');
    return kiosk ? '<tr><td>' + esc(what) + '</td><td class="num">' + esc(st) + (r.rwhy ? '<div class="kSmall">' + esc(r.rwhy) + '</div>' : '') + '</td></tr>'
      : '<div class="rqMine"><div class="grow"><b>' + esc(what) + '</b><div class="muted small">Asked ' + esc(whenText(r.at, now)) + (r.note && r.ps.length ? ' · “' + esc(r.note) + '”' : '') + '</div>' + (r.rwhy ? '<div class="small">' + esc(nameOf(r.rbsid)) + ': ' + esc(r.rwhy) + '</div>' : '') + '</div>' +
        '<span class="stat ' + (r.st === 'open' ? 'wait' : r.st === 'ok' ? 'ok' : 'bad') + '">' + esc(st) + '</span>' + (r.st === 'open' ? '<button class="btn btn-ghost" data-act="reqUndo" data-id="' + esc(r.id) + '">Take it back</button>' : '') + '</div>';
  };
  return kiosk ? '<div class="kPinT">What you asked for</div><table class="kTbl"><tbody>' + list.map(row).join('') + '</tbody></table>'
    : '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>What you asked for</h3></div><div class="cardBd">' + list.map(row).join('') + '</div></div>';
}
ACT.reqUndo = async b => { await act(b, () => B.reqTakeBack(b.dataset.id, false), 'Taken back.'); };
ACT.clearTry = async b => { await act(b, () => B.clearTry(b.dataset.sid), 'Lockout cleared.'); };

/* ---------- Timesheets ---------- */
function sheetWeek() { return S.week || curWeek(); }
function setWeek(wk) { S.week = wk; if (TCE.dayStart(TCE.addDays(wk, -3)) < S.from) rewatch(); renderView(); }
ACT.wkPrev = () => setWeek(TCE.addDays(sheetWeek(), -7));
ACT.wkNext = () => setWeek(TCE.addDays(sheetWeek(), 7));
ACT.wkNow = () => setWeek(curWeek());
CHG.sheetPerson = t => { S.person = t.value; renderView(); };
function weekNav(wk) {
  const cur = curWeek();
  return '<div class="wkNav"><button class="iconBtn" data-act="wkPrev" aria-label="Week before">' + ic('prev', 18) + '</button>' +
    '<b>' + esc(TCE.dayText(wk) + ' – ' + TCE.dayText(TCE.addDays(wk, 6))) + '</b>' +
    '<button class="iconBtn" data-act="wkNext" aria-label="Week after"' + (wk >= cur ? ' disabled' : '') + '>' + ic('next', 18) + '</button>' +
    (wk !== cur ? '<button class="btn btn-ghost" data-act="wkNow">This week</button>' : '') + '</div>';
}
VIEWS.sheets = () => {
  const wk = sheetWeek(), list = onClockList();
  const known = Array.from(S.roster.values()).filter(r => S.staff.get(r.sid) && (r.active || listOf(r.sid).length));
  const opts = '<option value="">Everyone</option>' + known.map(r => '<option value="' + esc(r.sid) + '"' + (S.person === r.sid ? ' selected' : '') + '>' + esc(nameOf(r.sid)) + '</option>').join('');
  const who = S.person ? [S.person] : list.map(r => r.sid);
  return '<div class="filters">' + weekNav(wk) + '<select data-chg="sheetPerson" aria-label="Person">' + opts + '</select>' +
    '<span style="flex:1"></span><button class="btn btn-act btn-sm" data-act="addPunch" data-sid="' + esc(S.person || '') + '">' + ic('plus', 15) + 'Add a punch</button></div>' +
    (who.length ? who.map(sid => personWeekHTML(sid, wk, true)).join('') : '<div class="empty">Nobody on the clock.</div>') +
    '<p class="muted small" style="margin-top:12px">Punches are never changed or deleted: a correction is added beside the original, with who made it and why. A punch with a “?” was asked for by the person and counts once a manager approves it. Breaks under ' + S.set.brk + ' minutes count as paid time. A clock-in with no clock-out counts 0 hours until the clock-out is added.</p>';
};
function personWeekHTML(sid, wk, mgr) {
  const w = weekFor(sid, wk), appr = S.ot.get(sid + '_' + wk), set = S.set;
  const asked = TCE.withReqs([], reqsOf(sid, 'open')), askedOn = iso => asked.filter(e => TCE.dayOf(e.t) === iso);
  const days = w.days.filter(d => d.entries.length || d.ms || set.days.includes(TCE.dow(d.iso)) || askedOn(d.iso).length);
  const rows = days.map(d => {
    const ents = TCE.sortEntries(d.entries.concat(askedOn(d.iso))).map(e => entryChip(e, mgr)).join('');
    const flags = d.flags.map(f => chip(FLAG[f.type][0], FLAG[f.type][1])).concat(d.issues.map(x => chip(ISSUE[x.type] || x.type, 'bad'))).concat(d.gaps.map(g => chip(g.min + '-min break, paid', 'info'))).join(' ');
    return '<tr><td class="dCell">' + esc(TCE.dayText(d.iso)) + '</td><td>' + (ents || '<span class="muted small">—</span>') + (flags ? '<div class="fRow">' + flags + '</div>' : '') + '</td><td class="num">' + (d.ms ? esc(TCE.hText(d.ms)) : '') + '</td></tr>';
  }).join('');
  const otBtn = w.sal ? chip('Salaried: hours kept for the record', 'info') : mgr && canFix(sid) ? (appr ? '<button class="btn btn-ghost" data-act="otEdit" data-sid="' + esc(sid) + '" data-wk="' + esc(wk) + '">' + ic('edit', 14) + 'Overtime approved to ' + esc(TCE.h2(appr.hrs * TCE.HOUR)) + ' h</button>' : '<button class="btn btn-ghost" data-act="otEdit" data-sid="' + esc(sid) + '" data-wk="' + esc(wk) + '">' + ic('tick', 14) + 'Approve overtime</button>') : (appr ? chip('Overtime approved to ' + TCE.h2(appr.hrs * TCE.HOUR) + ' h', 'info') : '');
  return '<div class="card pw"><div class="cardHd">' + avatar(sid) + '<div class="grow"><h3>' + esc(nameOf(sid)) + '</h3><span class="sub">' + esc(stateText(w)) + '</span></div>' +
    '<div class="pwTot"><b>' + esc(TCE.hText(w.total)) + '</b><span>' + (w.sal ? 'salaried' : w.ot ? esc(TCE.hText(w.reg)) + ' + <span class="bad">' + esc(TCE.hText(w.ot)) + ' OT</span>' : 'regular') + '</span></div></div>' +
    '<div class="cardBd">' + weekBar(w, set) + '<div class="pwActs">' + otBtn + (mgr && canFix(sid) ? '<button class="btn btn-ghost" data-act="addPunch" data-sid="' + esc(sid) + '">' + ic('plus', 14) + 'Add a punch</button>' : '') +
    (mgr && isMe(sid) && !B.isOwner() ? '<span class="muted small">Only Dr. A corrects your own time.</span>' : '') + '</div>' +
    '<div class="tblWrap"><table class="tbl sheet"><tbody>' + (rows || '<tr><td class="muted">No punches this week.</td></tr>') + '</tbody></table></div></div></div>';
}
function entryChip(e, mgr) {
  if (e.src === 'req') {
    const r = e.req, tip = 'Asked by ' + nameOf(e.sid) + ' ' + reqWhere(r) + ', ' + whenText(r.at, nowMs()) + ' — waiting for a manager (counts once approved)' + (r.note ? ': ' + r.note : '');
    return '<button class="pch asked k-' + e.kind + '" data-act="' + (mgr && canFix(e.sid) ? 'reqOpen' : 'noop') + '" data-id="' + esc(r.id) + '" title="' + esc(tip) + '">' + ic('clock', 13) + '<span>' + esc(KSHORT[e.kind]) + ' ' + esc(TCE.timeText(e.t)) + '?</span></button>';
  }
  const offNet = e.via === 'clock' && (e.net === 'off' || e.net === 'unk');
  const src = e.src === 'home' ? ic('home', 13) : e.src === 'fix' ? ic('edit', 13) : offNet ? ic('warn', 13) : e.via === 'own' ? ic('phone', 13) : e.via === 'laptop' ? ic('monitor', 13) : '';
  const cls = 'pch k-' + e.kind + (e.void ? ' void' : '') + (e.src === 'fix' ? ' fixed' : '') + (offNet ? ' offnet' : '');
  const tip = (KIND[e.kind] || '') + ' ' + TCE.timeText(e.t) + ' ' + (e.src === 'fix' ? '(added by ' + nameOf(e.fix.bsid) + ': ' + e.fix.why + ')' : whereText(e)) + (e.void ? ' — taken out by ' + nameOf(e.void.bsid) + ': ' + e.void.why : '');
  return '<button class="' + cls + '" data-act="' + (mgr ? 'punchInfo' : 'punchInfoMine') + '" data-id="' + esc(e.id) + '" data-sid="' + esc(e.sid) + '" title="' + esc(tip) + '">' + src + '<span>' + esc(KSHORT[e.kind]) + ' ' + esc(TCE.timeText(e.t)) + '</span></button>';
}
function findEntry(sid, id) { return listOf(sid).find(e => e.id === id); }
ACT.punchInfoMine = b => punchInfo(b, false);
ACT.punchInfo = b => punchInfo(b, true);
function punchInfo(b, mgr) {
  const e = findEntry(b.dataset.sid, b.dataset.id); if (!e) return;
  const where = whereText(e);
  let h = '<h3>' + esc(KIND[e.kind]) + ' ' + esc(TCE.timeText(e.t)) + '</h3><p class="lsub">' + esc(nameOf(e.sid) + ' · ' + TCE.dayText(TCE.dayOf(e.t), true) + ' · ' + where) + '</p>';
  if (e.fix) h += '<div class="kvRow"><span>Added by</span><b>' + esc(nameOf(e.fix.bsid)) + ', ' + esc(whenText(e.fix.at, nowMs())) + '</b></div><div class="txt" style="margin:6px 0 10px">' + esc(e.fix.why) + '</div>';
  if (e.void) h += '<div class="notice">Taken out by ' + esc(nameOf(e.void.bsid)) + ', ' + esc(whenText(e.void.at, nowMs())) + ': ' + esc(e.void.why) + '</div>';
  const can = mgr && canFix(e.sid);
  h += '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Close</button>' +
    (can && !e.void ? '<button class="btn btn-sec" data-act="fixMove" data-sid="' + esc(e.sid) + '" data-id="' + esc(e.id) + '">' + ic('edit', 15) + 'Change the time</button>' +
      '<button class="btn btn-danger" data-act="fixVoid" data-sid="' + esc(e.sid) + '" data-id="' + esc(e.id) + '">' + ic(e.fix ? 'undo' : 'trash', 15) + (e.fix ? 'Take back this correction' : 'Take it out') + '</button>' : '') + '</div>';
  if (mgr && !can) h += '<p class="muted small" style="margin-top:8px">Only Dr. A corrects your own time.</p>';
  openModal(h);
}
ACT.closeM = () => closeModal();
function reasonField(id) { return '<div class="field"><label for="' + id + '">Why (kept with the timesheet)</label><textarea id="' + id + '" maxlength="300" placeholder="e.g. Forgot to clock out; left at 5:05 per Gwen"></textarea></div>'; }
function needWhy(id) { const v = String(($('#' + id) || {}).value || '').trim(); if (!v) { toast('Say why — it stays with the timesheet.', { bad: true }); return ''; } return v; }
ACT.fixVoid = b => {
  const e = findEntry(b.dataset.sid, b.dataset.id); if (!e) return;
  openModal('<h3>' + (e.fix ? 'Take back this correction' : 'Take out this punch') + '</h3><p class="lsub">' + esc(nameOf(e.sid) + ': ' + KIND[e.kind] + ' ' + TCE.timeText(e.t) + ', ' + TCE.dayText(TCE.dayOf(e.t))) + '. It stays on record, struck through.</p>' + reasonField('fvWhy') +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-danger" data-act="fixVoidGo" data-sid="' + esc(e.sid) + '" data-id="' + esc(e.id) + '">' + (e.fix ? 'Take it back' : 'Take it out') + '</button></div>');
};
ACT.fixVoidGo = async b => { const why = needWhy('fvWhy'); if (!why) return; if (await act(b, () => B.fixVoid(b.dataset.sid, b.dataset.id, why), 'Done. The original stays on record.')) closeModal(); };
ACT.fixMove = b => {
  const e = findEntry(b.dataset.sid, b.dataset.id); if (!e) return;
  openModal('<h3>Change the time</h3><p class="lsub">' + esc(nameOf(e.sid) + ': ' + KIND[e.kind] + ' ' + TCE.timeText(e.t) + ', ' + TCE.dayText(TCE.dayOf(e.t))) + '. The original stays on record.</p>' +
    '<div class="grid2"><div class="field"><label for="fmDay">Day</label><input id="fmDay" type="date" value="' + esc(TCE.dayOf(e.t)) + '"></div><div class="field"><label for="fmTime">New time</label><input id="fmTime" type="time" value="' + esc(hmOf(e.t)) + '"></div></div>' +
    reasonField('fmWhy') + '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="fixMoveGo" data-sid="' + esc(e.sid) + '" data-id="' + esc(e.id) + '" data-kind="' + esc(e.kind) + '">Save</button></div>');
};
ACT.fixMoveGo = async b => {
  const t = punchTime('fmDay', 'fmTime'); if (!t) return; const why = needWhy('fmWhy'); if (!why) return;
  if (await act(b, () => B.fixMove(b.dataset.sid, b.dataset.id, b.dataset.kind, t, why), 'Time changed. The original stays on record.')) closeModal();
};
function punchTime(dayId, timeId) {
  const d = ($('#' + dayId) || {}).value, hm = ($('#' + timeId) || {}).value;
  if (!TCE.isISO(d) || !TCE.okHM(hm)) { toast('Pick a day and a time.', { bad: true }); return 0; }
  const t = TCE.atTime(d, hm);
  if (t > nowMs() + 50 * TCE.MIN) { toast('That’s in the future.', { bad: true }); return 0; }
  return t;
}
ACT.addPunch = b => {
  const sid = b.dataset.sid || '', day = b.dataset.day || TCE.dayOf(nowMs()), kind = b.dataset.kind || 'out';
  if (sid && !canFix(sid)) { toast('Only Dr. A corrects your own time.', { bad: true }); return; }
  // opened for someone: that person, whoever they are (on the clock or not); otherwise pick from who's on the clock
  const people = onClockList().filter(r => canFix(r.sid));
  const sel = sid ? '<div class="field"><span class="flabel">Person</span><div class="rqKind">' + esc(nameOf(sid)) + '</div><input type="hidden" id="apWho" value="' + esc(sid) + '"></div>'
    : '<div class="field"><label for="apWho">Person</label><select id="apWho"><option value="">Pick someone</option>' + people.map(r => '<option value="' + esc(r.sid) + '">' + esc(nameOf(r.sid)) + '</option>').join('') + '</select></div>';
  const kinds = '<div class="field"><span class="flabel">Punch</span><div class="seg" id="apKind">' + TCE.KINDS.map(k => '<button type="button" data-k="' + k + '" aria-pressed="' + (k === kind) + '">' + esc(KSHORT[k]) + '</button>').join('') + '</div></div>';
  const w = openModal('<h3>Add a punch</h3><p class="lsub">For a forgotten clock-in or clock-out. It’s marked as a correction, with who added it and why.</p>' + sel + kinds +
    '<div class="grid2"><div class="field"><label for="apDay">Day</label><input id="apDay" type="date" value="' + esc(day) + '"></div><div class="field"><label for="apTime">Time</label><input id="apTime" type="time"></div></div>' +
    reasonField('apWhy') + '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="addPunchGo">Add</button></div>');
  $$('#apKind button', w).forEach(x => { x.onclick = () => $$('#apKind button', w).forEach(y => y.setAttribute('aria-pressed', String(y === x))); });
};
ACT.addPunchGo = async b => {
  const sid = $('#apWho').value, k = $('#apKind button[aria-pressed="true"]'), kind = k ? k.dataset.k : '';
  if (!sid || !kind) { toast('Pick the person and the punch.', { bad: true }); return; }
  const t = punchTime('apDay', 'apTime'); if (!t) return; const why = needWhy('apWhy'); if (!why) return;
  if (await act(b, () => B.fixAdd(sid, kind, t, why), 'Added.')) closeModal();
};
ACT.otEdit = b => {
  const sid = b.dataset.sid, wk = b.dataset.wk, cur = S.ot.get(sid + '_' + wk);
  openModal('<h3>Approve overtime</h3><p class="lsub">' + esc(nameOf(sid)) + ', workweek of ' + esc(TCE.dayText(wk)) + '. The overtime alerts wait until they pass what you approve. (Overtime is paid either way.)</p>' +
    '<div class="field"><label for="otH">Up to (hours this workweek)</label><input id="otH" type="number" min="' + (S.set.ot + 0.5) + '" max="80" step="0.5" value="' + esc(cur ? cur.hrs : S.set.ot + 4) + '"></div>' +
    '<div class="field"><label for="otWhy">Note (optional)</label><input id="otWhy" maxlength="300" value="' + esc(cur ? cur.why : '') + '"></div>' +
    '<div class="mFt">' + (cur ? '<button class="btn btn-ghost" data-act="otDel" data-sid="' + esc(sid) + '" data-wk="' + esc(wk) + '" style="margin-right:auto;color:var(--coral-700)">Take it back</button>' : '') +
    '<button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="otGo" data-sid="' + esc(sid) + '" data-wk="' + esc(wk) + '">Approve</button></div>');
};
ACT.otGo = async b => {
  const h = Number($('#otH').value);
  if (!(h > S.set.ot && h <= 80)) { toast('Between ' + S.set.ot + ' and 80 hours.', { bad: true }); return; }
  if (await act(b, () => B.setOT(b.dataset.sid, b.dataset.wk, h, $('#otWhy').value.trim()), 'Overtime approved.')) closeModal();
};
ACT.otDel = async b => { if (await act(b, () => B.delOT(b.dataset.sid, b.dataset.wk), 'Approval taken back.')) closeModal(); };

/* ---------- Payroll (each workweek's regular and overtime hours, for a pay period) ---------- */
function periodOf(iso) { return TCE.payPeriodOf(iso, S.set.pay); }
VIEWS.pay = () => {
  if (!S.set.pay) return '<div class="card"><div class="cardBd" style="padding-top:18px"><b>Pick when a pay period starts.</b><p class="muted" style="margin:6px 0 10px">Payroll is every two weeks. Pick the first day of any pay period (best on the workweek’s first day, ' + TCE.WD[S.set.wk] + ', so each workweek falls in one period).</p>' +
    (B.isOwner() ? '<div class="inRow" style="max-width:360px"><input class="inp" type="date" id="payAnchor"><button class="btn btn-pri btn-sm" data-act="payAnchor">Save</button></div>' : '<p class="muted">Dr. A sets it in Settings.</p>') + '</div></div>';
  const today = TCE.dayOf(nowMs()), cur = periodOf(today), enter = TCE.payPeriodToEnter(today, S.set.pay);
  if (!S.pay || !S.pay.start) S.pay = { start: enter[0] }; // (on payroll Friday: the period to enter)
  const [a, z] = periodOf(S.pay.start), P = S.pay;
  if (!P.data || P.key !== a + S.set.wk + S.set.pay || P.stale) {
    if (P.stale && !P.loading) { P.stale = false; P.data = null; }
    if (!P.loading) { P.loading = true; P.key = a + S.set.wk + S.set.pay; B.loadRange(TCE.dayStart(TCE.addDays(a, -10)), TCE.dayStart(TCE.addDays(z, 2))).then(d => { P.data = d; P.loading = false; P.at = Date.now(); queueRender(); }).catch(e => { P.loading = false; P.err = errText(e); queueRender(); }); }
    return payNav(a, z, cur) + '<div class="empty">' + (P.err ? esc(P.err) : 'Reading the period…') + '</div>';
  }
  const rows = payRows(a, z, P.data);
  const anyIssue = rows.some(r => r.issues.length), live = z >= today, payDay = TCE.payDayOf(z);
  // the two-week totals first (what goes into payroll), then each workweek (overtime is counted by workweek)
  const wkHead = rows.length ? rows[0].weeks.map(x => '<th class="num wkCol" colspan="2">Week of ' + esc(TCE.dayText(x.wkIso)) + (x.partial ? '*' : '') + '</th>').join('') : '';
  const sub = rows.length ? rows[0].weeks.map(() => '<th class="num wkCol">Reg</th><th class="num wkCol">OT</th>').join('') : '';
  const body = rows.map(r => '<tr' + (r.sal ? ' class="salRow"' : '') + '><td><b class="pt">' + esc(r.name) + '</b>' + (r.sal ? ' ' + chip('Salaried', 'info') : '') + '</td>' +
    '<td class="num big"><b>' + hNum(r.reg) + '</b></td><td class="num big' + (r.ot ? ' bad' : '') + (r.sal ? ' muted' : '') + '"><b>' + (r.sal ? '—' : hNum(r.ot)) + '</b></td><td class="num">' + hNum(r.reg + r.ot) + '</td>' +
    '<td class="small">' + (r.issues.length ? '<span class="bad">' + esc(r.issues.join('; ')) + '</span>' : r.sal ? '<span class="muted">Salaried: hours for the record, not for pay</span>' : '<span class="ok">Ready</span>') + '</td>' +
    r.weeks.map(x => x.wkIso > today ? '<td class="num muted wkCol">—</td><td class="num muted wkCol">—</td>' : '<td class="num wkCol">' + hNum(x.reg) + '</td><td class="num wkCol' + (x.ot ? ' bad' : '') + (r.sal ? ' muted' : '') + '">' + (r.sal ? '—' : hNum(x.ot)) + '</td>').join('') + '</tr>').join('');
  return payNav(a, z, cur) +
    (today === payDay ? '<div class="notice ok">' + ic('done', 16) + ' <b>Payroll day.</b> Each person’s regular and overtime hours for the two weeks are below' + (live ? ' (so far: the period ends ' + esc(TCE.dayText(z)) + ')' : '') + '.</div>'
      : z < today && payDay > today ? '<div class="notice info">Payroll for this period is entered ' + esc(TCE.dayText(payDay, true)) + '.</div>'
        : live ? '<div class="notice info">This period isn’t over yet: the hours are so far. Payroll is entered ' + esc(TCE.dayText(payDay, true)) + '.</div>' : '') +
    (anyIssue ? '<div class="notice bad">Some days aren’t complete (time with a missing clock-in or clock-out counts 0 hours, and a missed punch someone asked for counts once approved). Fix them on Now or in Timesheets before running payroll.</div>' : '') +
    '<div class="card"><div class="tblWrap"><table class="tbl pay"><thead><tr><th rowspan="2">Person</th><th class="num" rowspan="2">Regular<br><span class="muted small">2 weeks</span></th><th class="num" rowspan="2">Overtime<br><span class="muted small">2 weeks</span></th><th class="num" rowspan="2">Total</th><th rowspan="2">To check</th>' + wkHead + '</tr><tr>' + sub + '</tr></thead><tbody>' +
    (body || '<tr><td colspan="9" class="muted">Nobody on the clock.</td></tr>') + '</tbody></table></div></div>' +
    (DEMO_ONLY ? '<p class="muted small" style="margin-top:10px">In the office’s copy, this page also downloads the totals and every day as CSV files (for Paychex) and prints.</p>'
      : '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="payCsv">' + ic('download', 15) + 'Totals (CSV)</button><button class="btn btn-sec btn-sm" data-act="payCsvDays">' + ic('download', 15) + 'Every day (CSV)</button><button class="btn btn-sec btn-sm" data-act="payPrint">' + ic('print', 15) + 'Print</button></div>') +
    '<p class="muted small" style="margin-top:10px">Overtime is worked out by workweek (over ' + S.set.ot + ' hours from ' + TCE.WD[S.set.wk] + ' to ' + TCE.WD[(S.set.wk + 6) % 7] + '), never by pay period.' + (rows.some(r => r.weeks.some(x => x.partial)) ? ' * A workweek that starts or ends outside this period: only its days inside the period are counted here, and its overtime is shown in the period it ends in.' : '') + ' Read ' + esc(agoText(P.at, Date.now())) + ' · <button class="linkBtn" data-act="payReload">read again</button></p>';
};
function payNav(a, z, cur) {
  return '<div class="filters"><div class="wkNav"><button class="iconBtn" data-act="payPrev" aria-label="Period before">' + ic('prev', 18) + '</button><b>' + esc(TCE.dayText(a) + ' – ' + TCE.dayText(z)) + '</b>' +
    '<button class="iconBtn" data-act="payNext" aria-label="Period after"' + (a >= cur[0] ? ' disabled' : '') + '>' + ic('next', 18) + '</button>' + (a !== cur[0] ? '<button class="btn btn-ghost" data-act="payNow">This period</button>' : '') + '</div></div>';
}
/* each person's period: the workweeks in it (regular and overtime), the two-week totals, and what's unfinished */
function payRows(a, z, data) {
  const now = nowMs(), set = S.set, from = TCE.dayStart(a), to = TCE.dayStart(TCE.addDays(z, 1));
  const ot = new Map(); (data.ot || []).forEach(x => { if (x.sid && x.week) ot.set(x.sid + '_' + x.week, Number(x.hrs) || 0); });
  const people = Array.from(S.roster.values()).filter(r => S.staff.get(r.sid) && (S.staff.get(r.sid).on || (data.punches || []).some(p => p.sid === r.sid)));
  return people.map(r => {
    const P = (data.punches || []).filter(p => p.sid === r.sid).map(p => ({ id: p.id, sid: p.sid, kind: p.kind, at: ms(p.at), src: p.src }));
    const F = (data.fixes || []).filter(f => f.sid === r.sid).map(f => ({ id: f.id, sid: f.sid, op: f.op, ref: f.ref || '', kind: f.kind || '', t: Number(f.t) || 0, why: f.why || '', bsid: f.bsid || '', at: ms(f.at) }));
    const list = TCE.entries(P, F), staff = staffOf(r.sid);
    const pp = TCE.payPeriod(list, set, staff, a, z, now, wk => ot.get(r.sid + '_' + wk) || 0);
    const issues = pp.issues.map(i => (ISSUE[i.type] || i.type) + ' ' + TCE.dayText(i.day));
    reqsOf(r.sid, 'open').forEach(q => { if (q.ps.some(p => p.t >= from && p.t < to)) issues.push('Asked for a missed punch (not approved yet)'); });
    return { sid: r.sid, name: nameOf(r.sid), sal: staff.sal, weeks: pp.weeks, list, reg: pp.reg, ot: pp.ot, issues };
  }).filter(r => r.reg + r.ot > 0 || r.issues.length || (S.staff.get(r.sid) || {}).on);
}
ACT.payPrev = () => { S.pay = { start: TCE.addDays(periodOf(S.pay.start)[0], -14) }; renderView(); };
ACT.payNext = () => { S.pay = { start: TCE.addDays(periodOf(S.pay.start)[0], 14) }; renderView(); };
ACT.payNow = () => { S.pay = { start: periodOf(TCE.dayOf(nowMs()))[0] }; renderView(); };
ACT.payReload = () => { S.pay = { start: S.pay.start }; renderView(); };
ACT.payAnchor = async b => { const v = $('#payAnchor').value; if (!TCE.isISO(v)) { toast('Pick a day.', { bad: true }); return; } await act(b, () => B.saveSettings(Object.assign({}, S.set, { pay: v })), 'Saved.'); };
ACT.payCsv = () => {
  const [a, z] = periodOf(S.pay.start), rows = payRows(a, z, S.pay.data), wks = rows.length ? rows[0].weeks : [];
  const head = ['Employee', 'Period start', 'Period end', 'Regular hours', 'Overtime hours', 'Total hours', 'Pay type', 'To check'].concat(wks.flatMap(x => ['Week of ' + x.wkIso + ' regular', 'Week of ' + x.wkIso + ' overtime']));
  const out = [head].concat(rows.map(r => [r.name, a, z, hNum(r.reg), hNum(r.ot), hNum(r.reg + r.ot), r.sal ? 'Salaried (hours for the record)' : 'Hourly', r.issues.join('; ')].concat(r.weeks.flatMap(x => [hNum(x.reg), hNum(x.ot)]))));
  download('time-clock-' + a + '-to-' + z + '.csv', csvOf(out));
};
ACT.payCsvDays = () => {
  const [a, z] = periodOf(S.pay.start), rows = payRows(a, z, S.pay.data), out = [['Employee', 'Date', 'Day', 'Punches', 'Hours', 'Flags', 'Corrections']];
  rows.forEach(r => r.weeks.forEach(x => x.w.days.forEach(d => {
    if (d.iso < a || d.iso > z || (!d.entries.length && !d.ms)) return;
    const live = d.entries.filter(e => !e.void);
    const fixes = d.entries.filter(e => e.fix || e.void).map(e => (e.void ? 'Took out ' : 'Added ') + KSHORT[e.kind] + ' ' + TCE.timeText(e.t) + ' (' + nameOf((e.void || e.fix).bsid) + ': ' + (e.void || e.fix).why + ')');
    out.push([r.name, d.iso, TCE.WD[TCE.dow(d.iso)], live.map(e => KSHORT[e.kind] + ' ' + TCE.timeText(e.t) + (e.src === 'home' ? ' (home)' : e.via === 'own' ? ' (own phone/computer)' : e.via === 'clock' && e.net === 'off' ? ' (off the office network)' : e.via === 'clock' && e.net === 'unk' ? ' (network not checked)' : '')).join('; '), hNum(d.ms),
      d.flags.map(f => FLAG[f.type][0]).concat(d.issues.map(i => ISSUE[i.type] || i.type)).concat(d.gaps.map(g => g.min + '-min break paid')).join('; '), fixes.join('; ')]);
  })));
  download('time-clock-days-' + a + '-to-' + z + '.csv', csvOf(out));
};
ACT.payPrint = () => { document.body.classList.add('printPay'); window.print(); setTimeout(() => document.body.classList.remove('printPay'), 500); };

/* ---------- People ---------- */
VIEWS.people = () => {
  const own = B.isOwner(), people = Array.from(S.roster.values()).filter(r => r.active).sort((a, b) => (a.role === 'owner') - (b.role === 'owner') || nameOf(a.sid).localeCompare(nameOf(b.sid)));
  const rows = people.map(r => {
    const raw = S.staff.get(r.sid), st = TCE.staffOf(raw), lk = lockedUntil(r.sid);
    if (!raw) return '<tr><td><div class="nameCell">' + avatar(r.sid) + '<b class="pt">' + esc(nameOf(r.sid)) + '</b></div></td><td colspan="4" class="muted small">Not on the time clock list yet.</td><td>' + (own ? '<button class="btn btn-sec btn-sm" data-act="staffEdit" data-sid="' + esc(r.sid) + '">Add</button>' : '') + '</td></tr>';
    const laps = S.laptops.filter(l => l.sids.includes(r.sid)).map(l => l.name);
    const home = st.home ? 'Yes' + (st.hdays.length ? ' · ' + st.hdays.map(d => TCE.WD3[d]).join(', ') : ' · any day') + ' · ' + (laps.length ? laps.join(', ') : 'no laptop yet') : 'No';
    const lim = [st.early ? 'Earliest ' + TCE.hmText(st.early) : '', st.cap ? 'Cap ' + st.cap + ' h' : ''].filter(Boolean).join(' · ');
    return '<tr><td><div class="nameCell">' + avatar(r.sid) + '<b class="pt">' + esc(nameOf(r.sid)) + '</b></div></td>' +
      '<td>' + (st.on ? chip('On', 'ok') : chip('Off', 'off')) + (st.on && st.sal ? ' ' + chip('Salaried', 'info') : '') + (S.mgrs.has(r.sid) ? ' ' + chip('Manager', 'info') : '') + '</td>' +
      '<td>' + (raw.pinAt ? '<span class="small">Set ' + esc(TCE.dayText(TCE.dayOf(ms(raw.pinAt)))) + '</span>' : '<span class="bad small">Not set</span>') + (lk ? ' ' + chip('Locked', 'bad') : '') + '</td>' +
      '<td class="small">' + esc(home) + '</td><td class="small hideM">' + esc(lim || '—') + '</td>' +
      '<td class="acts"><button class="btn btn-sec btn-sm" data-act="pinSet" data-sid="' + esc(r.sid) + '">' + ic('key', 14) + (raw.pinAt ? 'New PIN' : 'Set PIN') + '</button>' +
      (lk ? '<button class="btn btn-ghost" data-act="clearTry" data-sid="' + esc(r.sid) + '">Clear lockout</button>' : '') +
      (own ? '<button class="btn btn-ghost" data-act="staffEdit" data-sid="' + esc(r.sid) + '">' + ic('edit', 14) + 'Edit</button>' : '') + '</td></tr>';
  }).join('');
  return '<div class="card"><div class="cardHd"><h3>Who’s on the clock</h3><span class="sub">The team comes from NLO Cases (which follows Staff Hub). ' + (own ? 'Managers: you, and anyone you mark (Edit).' : 'Dr. A decides who’s on the clock.') + '</span></div>' +
    '<div class="tblWrap"><table class="tbl"><thead><tr><th>Person</th><th>Clock</th><th>PIN</th><th>From home</th><th class="hideM">Limits</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
    '<p class="muted small" style="margin-top:12px">A manager sets a starter PIN and tells the person; they can change it at the time clock (after their PIN: Change my PIN). 5 wrong PINs lock that person for 10 minutes and alert you. Someone on salary and exempt from overtime whose hours you want on record: keep them on the clock and tick Salaried (Edit).</p>';
};
ACT.pinSet = b => {
  const sid = b.dataset.sid;
  if (!S.staff.get(sid)) { toast('Add them to the time clock first (Edit).', { bad: true }); return; }
  openModal('<h3>' + esc(S.staff.get(sid).pinAt ? 'New PIN' : 'Set a PIN') + ' for ' + esc(nameOf(sid)) + '</h3><p class="lsub">4 digits. Tell them in person; they can change it at the time clock.</p>' +
    '<div class="inRow" style="max-width:300px"><input class="inp pinIn" id="pinA" inputmode="numeric" maxlength="4" autocomplete="off" value="' + randomPin() + '"><button class="btn btn-ghost" data-act="pinRand">' + ic('refresh', 15) + 'Another</button></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="pinGo" data-sid="' + esc(sid) + '">Save the PIN</button></div>');
};
ACT.pinRand = () => { $('#pinA').value = randomPin(); };
ACT.pinGo = async b => {
  const pin = $('#pinA').value.trim();
  if (!okPin(pin)) { toast('A PIN is 4 digits.', { bad: true }); return; }
  if (weakPin(pin)) { toast('Too easy to guess. Try another.', { bad: true }); return; }
  if (await act(b, () => B.setPin(b.dataset.sid, pin))) { closeModal(); toast('PIN saved: ' + pin + '. Tell ' + firstName(nameOf(b.dataset.sid)) + ' in person.', { ms: 9000 }); }
};
ACT.staffEdit = b => {
  const sid = b.dataset.sid, raw = S.staff.get(sid), st = TCE.staffOf(raw || { on: true });
  const days = TCE.WD3.map((d, i) => '<button type="button" class="pick sm" data-d="' + i + '" aria-pressed="' + st.hdays.includes(i) + '">' + d + '</button>').join('');
  const w = openModal('<h3>' + esc(nameOf(sid)) + '</h3><p class="lsub">Time clock settings for this person.</p>' +
    '<label class="chk"><input type="checkbox" id="seOn"' + (st.on ? ' checked' : '') + '> On the time clock</label>' +
    '<label class="chk"><input type="checkbox" id="seSal"' + (st.sal ? ' checked' : '') + '> <span>Salaried and exempt from overtime: keep a record of their hours <span class="muted">(no overtime, and no alerts about their hours or working from home. Salaried but not exempt? Leave this off so their overtime counts.)</span></span></label>' +
    (person(sid) && person(sid).role !== 'owner' ? '<label class="chk"><input type="checkbox" id="seMgr"' + (S.mgrs.has(sid) ? ' checked' : '') + '> <span>Manages the time clock <span class="muted">(sees everyone’s time; adds missed punches, approves requests and overtime — never their own)</span></span></label>' : '') +
    '<label class="chk"><input type="checkbox" id="seHome"' + (st.home ? ' checked' : '') + '> <span>May clock in from home <span class="muted">(on a laptop you approve for them: Settings → Approved laptops; in and out only, marked Home)</span></span></label>' +
    '<div class="field" id="seDaysF"><span class="flabel">Home days <span class="muted" style="text-transform:none;letter-spacing:0">(none picked = any day; another day is flagged and alerted)</span></span><div class="pickRow" id="seDays">' + days + '</div></div>' +
    '<div class="grid2"><div class="field"><label for="seEarly">Own earliest clock-in</label><input id="seEarly" type="time" value="' + esc(st.early) + '"><div class="hint">Blank = the office’s (' + esc(S.set.early ? TCE.hmText(S.set.early) : 'none') + ')</div></div>' +
    '<div class="field"><label for="seCap">Weekly cap (hours)</label><input id="seCap" type="number" min="0" max="80" step="0.5" value="' + esc(st.cap || '') + '" placeholder="None"><div class="hint">e.g. part-time hours; alerts when reached</div></div></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="staffGo" data-sid="' + esc(sid) + '">Save</button></div>');
  $$('#seDays .pick', w).forEach(x => { x.onclick = () => x.setAttribute('aria-pressed', String(x.getAttribute('aria-pressed') !== 'true')); });
};
ACT.staffGo = async b => {
  const sid = b.dataset.sid, cap = Number($('#seCap').value) || 0, early = $('#seEarly').value || '';
  if (cap && (cap < 1 || cap > 80)) { toast('A cap between 1 and 80 hours (or blank).', { bad: true }); return; }
  if (early && !TCE.okHM(early)) { toast('Pick a time or leave it blank.', { bad: true }); return; }
  const f = { on: $('#seOn').checked, sal: $('#seSal').checked, home: $('#seHome').checked, hdays: $$('#seDays .pick[aria-pressed="true"]').map(x => Number(x.dataset.d)), early, cap };
  const mgrBox = $('#seMgr'), mgr = mgrBox ? mgrBox.checked : S.mgrs.has(sid);
  if (await act(b, async () => { await B.saveStaff(sid, f, S.staff.get(sid)); if (mgr !== S.mgrs.has(sid)) await B.setMgr(sid, mgr); }, 'Saved.')) closeModal();
};

/* ---------- Alerts ---------- */
function alertsOf() { const a = S.alerts || {}; return { emails: Array.isArray(a.emails) ? a.emails : [], topic: typeof a.topic === 'string' ? a.topic : '', route: a.route && typeof a.route === 'object' ? a.route : {}, digest: TCE.okHM(a.digest) ? a.digest : '', test: ms(a.test) }; }
function routeOf(route, type) { const v = route[type]; return Number.isInteger(v) && v >= 0 && v <= 3 ? v : (TCE.ROUTE[type] != null ? TCE.ROUTE[type] : 3); }
VIEWS.alerts = () => {
  if (!S.got.alerts) return '<div class="empty">Loading…</div>';
  const own = B.isOwner(), A = alertsOf(), dis = own ? '' : ' disabled';
  const grid = TCE.ALERTS.map(([t, name, when]) => {
    const v = routeOf(A.route, t);
    return '<tr><td><b>' + esc(name) + '</b><div class="muted small">' + esc(when) + '</div></td>' +
      '<td class="num"><input type="checkbox" class="rt" data-t="' + t + '" data-b="1" aria-label="' + esc(name) + ' by email"' + (v & 1 ? ' checked' : '') + dis + '></td>' +
      '<td class="num"><input type="checkbox" class="rt" data-t="' + t + '" data-b="2" aria-label="' + esc(name) + ' by phone push"' + (v & 2 ? ' checked' : '') + dis + '></td></tr>';
  }).join('');
  const push = A.topic ? '<div class="kvRow"><span>Topic</span><b><code>' + esc(A.topic) + '</code></b></div>' +
    '<details class="help" open><summary>Get the pushes on a phone (each person, once)</summary><ol class="steps"><li>Install the free <b>ntfy</b> app (App Store or Google Play).</li><li>Tap <b>+</b> (Subscribe to topic), type the topic above exactly, and tap Subscribe.</li><li>That’s it. Anyone who leaves: change the topic here (the old one stops getting alerts) and give it to the others again.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="copyTopic">' + ic('copy', 14) + 'Copy the topic</button><a class="btn btn-ghost" href="https://ntfy.sh/' + esc(A.topic) + '" target="_blank" rel="noopener">Open it on ntfy.sh</a></div></details>' : '<p class="muted small">Off. Turn it on to get alerts as phone notifications through the free ntfy app.</p>';
  const beats = S.beat.slice().sort((a, b) => b.at - a.at), now = nowMs();
  const status = beats.length ? beats.map(x => '<div class="kvRow"><span>' + esc(x.box || 'Script') + '</span><b>' + (now - x.at < 20 * TCE.MIN ? '<span class="ok">Checked ' + esc(agoText(x.at, now)) + '</span>' : '<span class="bad">Last checked ' + esc(whenText(x.at, now)) + '</span>') + (x.err ? ' · <span class="bad">' + esc(x.err) + '</span>' : '') + '</b></div>').join('') : '<p class="muted small">Not set up yet.</p>';
  const log = S.sent.length ? S.sent.slice(0, 40).map(x => { const [title, ...rest] = String(x.text).split('\n'); return '<div class="logRow"><time>' + esc(whenText(x.at, now)) + '</time><div class="grow"><b>' + esc(title) + '</b><div class="muted small">' + esc(rest.join(' ')) + '</div></div><span class="small ' + (x.st === 'sent' ? 'ok' : 'bad') + '">' + esc(x.st === 'sent' ? ['', 'Email', 'Push', 'Email + push'][x.ch & 3] || 'Sent' : x.st === 'claim' ? 'Sending' : 'Not sent') + '</span></div>'; }).join('') : '<p class="muted small">None yet.</p>';
  return '<div class="adminGrid"><div>' +
    '<div class="card"><div class="cardHd"><h3>' + ic('mail', 18) + ' Email</h3></div><div class="cardBd"><div class="field"><label for="alEm">Send alerts to</label><textarea id="alEm" rows="3"' + dis + ' placeholder="one address per line">' + esc(A.emails.join('\n')) + '</textarea><div class="hint">Up to 10 addresses. Emails come from the Gmail account the alert script runs in.</div></div>' +
    '<div class="field"><label for="alDg">Daily summary at</label><input id="alDg" type="time" value="' + esc(A.digest) + '"' + dis + '><div class="hint">Blank = no daily summary.</div></div>' + (own ? '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="alertsSave">Save</button></div>' : '') + '</div></div>' +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>' + ic('phone', 18) + ' Phone push</h3>' + (own ? '<span style="flex:1"></span>' + (A.topic ? '<button class="btn btn-ghost" data-act="topicNew">Change the topic</button><button class="btn btn-ghost" data-act="topicOff" style="color:var(--coral-700)">Turn off</button>' : '<button class="btn btn-sec btn-sm" data-act="topicNew">Turn on</button>') : '') + '</div><div class="cardBd">' + push + '</div></div>' +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Which alerts go where</h3></div><div class="tblWrap"><table class="tbl"><thead><tr><th>Alert</th><th class="num">Email</th><th class="num">Push</th></tr></thead><tbody>' + grid + '</tbody></table></div>' +
    (own ? '<div class="cardBd"><div class="btnRow"><button class="btn btn-pri" data-act="alertsSave">Save</button></div></div>' : '<div class="cardBd"><p class="muted small">Dr. A changes these.</p></div>') + '</div>' +
    '</div><div>' +
    '<div class="card"><div class="cardHd"><h3>' + ic('bell', 18) + ' The alert script</h3></div><div class="cardBd">' + status +
    '<p class="small muted" style="margin-top:8px">A small Google Apps Script checks the clock every 5 minutes (every half hour at night) and sends the alerts. Each alert goes out once.</p>' +
    (own ? '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="getScript">' + ic('download', 15) + (beats.length ? 'Get the script again' : 'Get the script') + '</button><button class="btn btn-ghost" data-act="testAlert">Send a test</button></div>' : '') + '</div></div>' +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Recent alerts</h3></div><div class="cardBd">' + log + '</div></div>' +
    '</div></div>';
};
ACT.copyTopic = async () => { toast(await copyText(alertsOf().topic) ? 'Topic copied.' : 'Couldn’t copy.'); };
async function saveAlertsWith(change, btn, msg) {
  const A = alertsOf(), cur = S.alerts;
  const emails = String(($('#alEm') || {}).value != null ? $('#alEm').value : A.emails.join('\n')).split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
  const bad = emails.filter(e => !okEmail(e)); if (bad.length) { toast('Not an email address: ' + bad[0], { bad: true }); return; }
  if (emails.length > 10) { toast('Up to 10 addresses.', { bad: true }); return; }
  const route = {}; $$('input.rt').forEach(x => { route[x.dataset.t] = (route[x.dataset.t] || 0) | (x.checked ? Number(x.dataset.b) : 0); });
  const o = Object.assign({ emails: Array.from(new Set(emails)), topic: A.topic, route: Object.keys(route).length ? route : A.route, digest: ($('#alDg') ? $('#alDg').value : A.digest) || '' }, change || {});
  if (await act(btn, () => B.saveAlerts(o, cur), msg || 'Saved.')) { S.dirty = false; renderView(); }
}
ACT.alertsSave = b => saveAlertsWith(null, b);
ACT.topicNew = async b => { if (alertsOf().topic && !(await confirmBox('Change the topic?', 'Phones subscribed to the old topic stop getting alerts until they subscribe to the new one.', 'Change it'))) return; saveAlertsWith({ topic: newTopic() }, b, 'Phone push is on. Subscribe in the ntfy app (steps below).'); };
ACT.topicOff = async b => { if (await confirmBox('Turn off phone push?', 'Alerts keep going by email.', 'Turn off', true)) saveAlertsWith({ topic: '' }, b, 'Phone push is off.'); };
ACT.testAlert = async b => { await act(b, () => B.testAlert(), 'Asked for a test. It goes out within 5 minutes (if the script is set up).'); };
ACT.getScript = async b => {
  if (!(await confirmBox('Get the script', 'This makes a new login for the alert script. A copy of the script already running stops working until it’s replaced with this one.', 'Make it'))) return;
  let text = '';
  const ok = await act(b, async () => {
    const bot = await B.makeBot();
    let src = '';
    if (S.demo) src = '/* NLO Time Clock alerts — in the demo there is no real script. */\nvar CONFIG = /*TC_CONFIG*/null;\n';
    else { const r = await fetch(SCRIPT_FILE, { cache: 'no-store' }); if (!r.ok) throw new Error('Couldn’t load the script (' + r.status + ').'); src = await r.text(); }
    if (src.split('/*TC_CONFIG*/null').length !== 2) throw new Error('The script file looks wrong. Reload the page and try again.');
    text = src.replace('/*TC_CONFIG*/null', JSON.stringify(B.scriptConfig(bot)));
  });
  if (!ok) return;
  S.scriptText = text;
  openModal('<h3>Set up the alert script</h3><p class="lsub">About 3 minutes, once. It runs in the Gmail account you use for it (alerts come from that address). The script holds its own login — keep it to yourself.</p>' +
    '<ol class="steps"><li><button class="btn btn-pri btn-sm" data-act="copyScript">' + ic('copy', 14) + 'Copy the script</button></li>' +
    '<li>Open <a href="https://script.new" target="_blank" rel="noopener">script.new</a>, signed in to the Gmail account to send from (e.g. records@).</li>' +
    '<li>Select everything in the editor, paste, and press <b>Save</b> (name it “NLO Time Clock alerts”).</li>' +
    '<li>Pick <b>setup</b> next to <b>Run</b> in the top bar and press <b>Run</b>. Google asks for access: <b>Review permissions</b> → pick the account → <b>Advanced</b> → <b>Go to NLO Time Clock alerts (unsafe)</b> → <b>Allow</b>. (It’s “unsafe” only because Google hasn’t reviewed a private script.)</li>' +
    '<li>Come back here: the script shows under The alert script within a minute. Then press <b>Send a test</b>.</li></ol>' +
    '<p class="small muted">What it asks for: send email as you (the alerts), connect to an external service (the time clock’s database and ntfy), run when you’re not there (every 5 minutes). It only reads the time clock; it can’t change anyone’s time.</p>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Done</button></div>', 'wide');
};
ACT.copyScript = async () => { toast(await copyText(S.scriptText || '') ? 'Script copied. Paste it at script.new.' : 'Couldn’t copy. Try again.'); };

/* ---------- Settings ---------- */
VIEWS.settings = () => {
  const own = B.isOwner(), s = S.set, dis = own ? '' : ' disabled';
  const days = TCE.WD3.map((d, i) => '<button type="button" class="pick sm" data-d="' + i + '" aria-pressed="' + s.days.includes(i) + '"' + dis + '>' + d + '</button>').join('');
  const wk = TCE.WD.map((d, i) => '<option value="' + i + '"' + (s.wk === i ? ' selected' : '') + '>' + d + '</option>').join('');
  const now = nowMs();
  const kiosks = S.kiosks.length ? S.kiosks.map(k => '<div class="kvRow"><span>' + ic('monitor', 15) + ' <b>' + esc(k.name) + '</b>' + (B.kiosk && B.kiosk.uid === k.uid ? ' <span class="muted">(this computer)</span>' : '') + '</span><span>' +
    (k.seen ? (now - k.seen < 25 * TCE.MIN ? '<span class="ok small">Seen ' + esc(agoText(k.seen, now)) + '</span>' : '<span class="muted small">Last seen ' + esc(whenText(k.seen, now)) + '</span>') : '<span class="muted small">Not seen yet</span>') +
    (own ? ' <button class="btn btn-ghost" data-act="kioskRename" data-uid="' + esc(k.uid) + '">Rename</button><button class="btn btn-ghost" data-act="kioskRemove" data-uid="' + esc(k.uid) + '" style="color:var(--coral-700)">Remove</button>' : '') + '</span></div>').join('') : '<p class="muted small">None yet.</p>';
  return '<div class="adminGrid"><div><div class="card"><div class="cardHd"><h3>Overtime and boundaries</h3></div><div class="cardBd">' +
    '<p class="muted small" style="margin-bottom:12px">Changing the workweek, the paid-break minutes or the pay period figures past weeks again too: change them at the start of a pay period.</p>' +
    '<div class="grid2"><div class="field"><label for="stWk">Workweek starts</label><select id="stWk"' + dis + '>' + wk + '</select><div class="hint">Overtime is counted per workweek (12:00 AM).</div></div>' +
    '<div class="field"><label for="stOt">Overtime after (hours a week)</label><input id="stOt" type="number" min="20" max="80" step="0.5" value="' + s.ot + '"' + dis + '></div></div>' +
    '<div class="field"><label for="stThr">Heads-up alerts at (hours a week)</label><input id="stThr" value="' + esc(s.thr.join(', ')) + '"' + dis + ' placeholder="36, 38"><div class="hint">Up to 5, below overtime, separated by commas.</div></div>' +
    '<div class="grid2"><div class="field"><label for="stEarly">Earliest clock-in</label><input id="stEarly" type="time" value="' + esc(s.early) + '"' + dis + '><div class="hint">Earlier is flagged and alerted (never blocked). Blank = off.</div></div>' +
    '<div class="field"><label for="stLate">Still clocked in after</label><input id="stLate" type="time" value="' + esc(s.late) + '"' + dis + '><div class="hint">“Forgot to clock out?” alert. Blank = off.</div></div></div>' +
    '<div class="grid2"><div class="field"><label for="stShift">Long-shift alert at (hours a day)</label><input id="stShift" type="number" min="0" max="24" step="0.5" value="' + s.shift + '"' + dis + '><div class="hint">0 = off.</div></div>' +
    '<div class="field"><label for="stBrk">Breaks shorter than (minutes) are paid</label><input id="stBrk" type="number" min="0" max="60" step="1" value="' + s.brk + '"' + dis + '><div class="hint">Federal rule: short rest breaks (5–20 min) are paid time.</div></div></div>' +
    '<div class="field"><span class="flabel">Office days</span><div class="pickRow" id="stDays">' + days + '</div><div class="hint">A punch on another day is flagged and alerted.</div></div>' +
    '<div class="field"><label for="stPay">A pay period starts on</label><input id="stPay" type="date" value="' + esc(s.pay) + '"' + dis + '><div class="hint">Any first day of a two-week pay period' + (s.pay && TCE.dow(s.pay) !== s.wk ? ' — <span class="bad">it isn’t a ' + TCE.WD[s.wk] + ', so a workweek is split between two periods</span>' : '') + '.</div></div>' +
    (own ? '<div class="btnRow"><button class="btn btn-pri" data-act="setSave">Save</button></div>' : '<p class="muted small">Dr. A changes these.</p>') + '</div></div></div>' +
    '<div><div class="card"><div class="cardHd"><h3>' + ic('monitor', 18) + ' Time-clock computers</h3></div><div class="cardBd">' + kiosks +
    (own ? '<p class="small muted" style="margin:10px 0">On the computer or iPad staff will clock in at, sign in here and:</p><button class="btn btn-sec btn-sm" data-act="kioskEnroll">' + ic('clock', 15) + 'Make this computer a time clock</button>' : '') + '</div></div>' +
    officeCardHTML() + laptopsCardHTML() +
    (B.noIndex && B.indexLink && own ? '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Faster “My time” for staff</h3></div><div class="cardBd"><p class="small">Staff checking their own week read all their punches until the database has an index for it. One click makes it (Firebase console, then Create).</p><a class="btn btn-sec btn-sm" href="' + esc(B.indexLink) + '" target="_blank" rel="noopener">Make the index</a></div></div>' : '') +
    '</div></div>';
};
ACT.setSave = async b => {
  const thr = String($('#stThr').value).split(/[,\s]+/).filter(Boolean).map(Number), ot = Number($('#stOt').value);
  if (!(ot >= 20 && ot <= 80)) { toast('Overtime after 20 to 80 hours.', { bad: true }); return; }
  if (thr.length > 5 || thr.some(x => !(x > 0 && x < ot))) { toast('Heads-up hours must be below ' + ot + ' (up to 5).', { bad: true }); return; }
  const o = {
    wk: Number($('#stWk').value), ot, thr: Array.from(new Set(thr)).sort((a, z) => a - z), early: $('#stEarly').value || '', late: $('#stLate').value || '',
    shift: Number($('#stShift').value) || 0, brk: Math.round(Number($('#stBrk').value) || 0), days: $$('#stDays .pick[aria-pressed="true"]').map(x => Number(x.dataset.d)).sort(), pay: $('#stPay').value || '',
    lock: S.set.lock, wurl: S.set.wurl // (the office lock: changed in its own card)
  };
  if (o.shift < 0 || o.shift > 24 || o.brk < 0 || o.brk > 60) { toast('Check the long-shift hours and the break minutes.', { bad: true }); return; }
  if (await act(b, () => B.saveSettings(o), 'Saved.')) { S.pay = null; S.dirty = false; renderView(); }
};
CHG.noop = () => { };
ACT.noop = () => { };
document.addEventListener('click', e => { const p = e.target.closest('#stDays .pick'); if (p && !p.disabled) p.setAttribute('aria-pressed', String(p.getAttribute('aria-pressed') !== 'true')); });
ACT.kioskEnroll = () => {
  openModal('<h3>Make this computer a time clock</h3><p class="lsub">Staff then clock in here with their PIN. It stays set up on this computer (in this browser) until you remove it in Settings. You’ll be signed out here; sign in again from the time clock’s Manager button.</p>' +
    '<div class="field"><label for="keName">Name</label><input id="keName" maxlength="40" value="Front desk"></div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="kioskEnrollGo">Make it a time clock</button></div>');
};
ACT.kioskEnrollGo = async b => {
  const name = $('#keName').value.trim().slice(0, 40); if (!name) { toast('Give it a name.', { bad: true }); return; }
  if (await act(b, () => B.kioskEnroll(name))) { closeModal(); B.stop(); await B.signOut(); S.fromKiosk = false; enterKiosk(); }
};
ACT.kioskRename = async b => {
  const k = S.kiosks.find(x => x.uid === b.dataset.uid); if (!k) return;
  openModal('<h3>Rename</h3><div class="field"><label for="krName">Name</label><input id="krName" maxlength="40" value="' + esc(k.name) + '"></div><div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="kioskRenameGo" data-uid="' + esc(k.uid) + '">Save</button></div>');
};
ACT.kioskRenameGo = async b => { const n = $('#krName').value.trim().slice(0, 40); if (!n) return; if (await act(b, () => B.renameKiosk(b.dataset.uid, n), 'Renamed.')) closeModal(); };
ACT.kioskRemove = async b => {
  const k = S.kiosks.find(x => x.uid === b.dataset.uid); if (!k) return;
  if (!(await confirmBox('Remove “' + k.name + '”?', 'Staff can’t clock in on that computer any more (its punches stay). You can set it up again any time.', 'Remove', true))) return;
  await act(b, () => B.removeKiosk(k.uid), 'Removed.');
};

/* ---------- the office lock (Amir, 9 Oct 2026: "only available when it's used inside the office"; lock punching only, and
   block anywhere else; home only from an approved laptop) ----------
   1. the office check: a small Cloudflare Worker with its own login (Dr. A pastes it in, once)
   2. the office's network(s): saved from a computer on it ("This is the office")
   3. on: staff may also clock in on their own phone or computer, on the office network only; the time clock is never
      refused (off the office network its punches are flagged) */
function netText(net) { return /^v6:/.test(net) ? net.slice(3) + '::/64 (IPv6)' : String(net || '').replace(/^v4:/, ''); }
function seenText(n) { return [n.org, n.city].filter(Boolean).join(', ') || 'unknown provider'; }
function officeCardHTML() {
  const own = B.isOwner(), s = S.set, now = nowMs();
  const chipOn = s.lock ? chip('On', 'ok') : chip('Off', 'off');
  if (!own) return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>' + ic('shield', 18) + ' Office network</h3><span style="flex:1"></span>' + chipOn + '</div><div class="cardBd"><p class="small muted">' + (s.lock ? 'Staff can also clock in on their own phone or computer, on the office network only.' : 'Staff clock in at the time clock.') + ' Dr. A sets this up.</p></div></div>';
  if (!S.kNetsAt || Date.now() - S.kNetsAt > 60000) loadKioskNets();
  const nets = S.offices.map(o => '<div class="kvRow"><span>' + ic('shield', 15) + ' <b>' + esc(o.name) + '</b> <span class="muted small">' + esc(netText(o.net) + ' · ' + seenText(o)) + '</span></span><span>' +
    '<button class="btn btn-ghost" data-act="offRename" data-net="' + esc(o.net) + '">Rename</button><button class="btn btn-ghost" data-act="offRemove" data-net="' + esc(o.net) + '" style="color:var(--coral-700)">Remove</button></span></div>').join('');
  // a time clock on a network that isn't saved (the office's internet changed?): saved from that computer, the usual way
  // (a network is only ever saved from where Dr. A is himself)
  const strays = S.kiosks.map(k => ({ k, n: S.kNets[k.uid] })).filter(x => x.n && okNetKey(x.n.net) && !S.offices.some(o => o.net === x.n.net) && now - x.n.at < TCE.DAY);
  const stray = strays.map(x => '<div class="notice">' + ic('warn', 16) + ' <div><b>' + esc(x.k.name) + '</b> was on a network that isn’t saved as the office’s: ' + esc(seenText(x.n) + ' (' + netText(x.n.net) + ')') + ', ' + esc(whenText(x.n.at, now)) + '. If the office’s internet changed, save it from that computer: press <b>Manager</b> on the time clock, sign in, and press <b>This is the office</b> here.</div></div>').join('');
  // which kinds of address are saved: phones often use the newer kind (IPv6) and office computers the older (IPv4)
  const v4 = S.offices.some(o => /^v4:/.test(o.net)), v6 = S.offices.some(o => /^v6:/.test(o.net));
  const cover = S.offices.length && !(v4 && v6) ? '<p class="small muted ofCover">' + ic('info', 13) + ' Saved so far: ' + (v4 ? 'the older kind of address (IPv4)' : 'the newer kind of address (IPv6)') + ' only. If a phone or computer on the office Wi-Fi is told it isn’t on the office network, press <b>This is the office</b> on that device too (most internet providers give an office both kinds; some only one).</p>' : '';
  if (!S.netBotsAt || Date.now() - S.netBotsAt > 60000) loadNetBots();
  const step1 = (s.wurl ? '<span class="ok small">Set up</span> <span class="muted small">' + esc(s.wurl.replace(/^https:\/\//, '')) + '</span> <button class="btn btn-ghost" data-act="netTest">Test</button><button class="btn btn-ghost" data-act="netSetup">Set it up again</button>'
    : '<button class="btn btn-sec btn-sm" data-act="netSetup">' + ic('shield', 15) + 'Set up the office check</button>') +
    // more than one of its logins works: a new setup that hasn't answered the test yet (the older ones stop once it does)
    (S.netBots.length > 1 ? '<div class="notice">' + ic('warn', 16) + ' <div>' + esc(plural(S.netBots.length, 'office check login')) + ' work right now: the newest hasn’t answered a test yet (paste its code, Deploy, then Test). If the code got out: <button class="linkBtn" data-act="netBotsOnly">turn the older ones off now</button> — phones can’t clock in until the newest is deployed.</div></div>' : '');
  const ready = s.wurl && S.offices.length;
  return '<div class="card" style="margin-top:18px" id="officeCard"><div class="cardHd"><h3>' + ic('shield', 18) + ' Office network</h3><span style="flex:1"></span>' + chipOn + '</div><div class="cardBd">' +
    '<p class="small" style="margin-bottom:12px">When it’s on, staff can also clock in on their own phone or computer, but only on the office’s internet: anywhere else it’s refused. The time clock itself is never refused — off the office network its punches go through, flagged, and you get an alert. From home: only an approved laptop (below). Timesheets, approvals, Payroll and Settings work from anywhere.</p>' +
    '<div class="ofStep"><span class="ofN">1</span><div class="grow"><b>The office check</b><div class="small muted">A small free Cloudflare Worker that sees which internet a phone or computer is on. About 5 minutes, once.</div><div class="btnRow" style="margin-top:6px">' + step1 + '</div></div></div>' +
    '<div class="ofStep"><span class="ofN">2</span><div class="grow"><b>The office’s network</b><div class="small muted">On a computer on the office internet (then on your phone on the office Wi-Fi too: some devices use the newer kind of address).</div>' + (nets || '') + cover + stray +
    '<div class="btnRow" style="margin-top:6px"><button class="btn btn-sec btn-sm" data-act="offHere"' + (s.wurl ? '' : ' disabled') + '>' + ic('tick', 15) + 'This is the office</button></div></div></div>' +
    '<div class="ofStep"><span class="ofN">3</span><div class="grow"><b>' + (s.lock ? 'On' : 'Turn it on') + '</b><div class="small muted">' + (s.lock ? 'Phones and computers clock in on the office network only.' : 'From a computer on the office network.') + '</div><div class="btnRow" style="margin-top:6px">' +
    (s.lock ? '<button class="btn btn-ghost" data-act="lockOff" style="color:var(--coral-700)">Turn it off</button>' : '<button class="btn btn-pri btn-sm" data-act="lockOn"' + (ready ? '' : ' disabled') + '>Turn on the office lock</button>') + '</div></div></div>' +
    '<details class="help"><summary>iPhones and Macs on the office Wi-Fi</summary><p class="small">iCloud Private Relay (Safari on iCloud+) and any VPN hide which internet a device is on, so the check can’t see the office. On an iPhone: Settings → Wi-Fi → tap ⓘ next to the office network → turn off <b>Limit IP Address Tracking</b> and <b>iCloud Private Relay</b> for that network. Staff using Chrome aren’t affected by Private Relay. Cellular data is never the office network: they have to be on the Wi-Fi.</p></details>' +
    '</div></div>';
}
/* the office check's logins that work (Dr. A; at most once a minute while Settings is open) */
function loadNetBots() {
  S.netBotsAt = Date.now();
  B.netBots().then(l => { const was = S.netBots.length; S.netBots = l; if (l.length !== was && S.view === 'settings') queueRender(); }).catch(() => { });
}
ACT.netBotsOnly = async b => {
  if (!(await confirmBox('Turn the older logins off now?', 'Only the newest office check login keeps working. Until its code is pasted into the Worker and deployed, phones and computers can’t clock in, and the time clock’s punches are flagged.', 'Turn them off', true))) return;
  if (await act(b, () => B.netBotsOnlyNewest(), 'The older office check logins stopped working.')) { S.netBotsAt = 0; renderView(); }
};
function okNetKey(net) { return /^(v4:\d{1,3}(\.\d{1,3}){3}|v6:[0-9a-f]{1,4}(:[0-9a-f]{1,4}){3})$/.test(String(net || '')); }
/* where each time clock was last seen (one read each, at most once a minute while Settings is open) */
function loadKioskNets() {
  S.kNetsAt = Date.now();
  Promise.all(S.kiosks.map(k => B.seenOf(k.uid).then(n => { S.kNets[k.uid] = n; }).catch(() => { }))).then(() => { if (S.view === 'settings') queueRender(); });
}
ACT.netSetup = async b => {
  const again = !!S.set.wurl;
  if (!(await confirmBox('Set up the office check', again ? 'This makes a new login for the office check. The copy running now keeps working until the new one answers the test; then the old login stops working (do this if the code ever got out).' : 'This makes the office check’s own login, inside the code you’ll paste into Cloudflare.', 'Make it'))) return;
  let text = '';
  const ok = await act(b, async () => {
    const bot = await B.makeNetBot();
    try {
      let src = '';
      if (S.demo) src = '/* NLO Time Clock office check — in the demo there is no real Worker. */\nconst CONFIG = /*TC_NET_CONFIG*/null;\n';
      else { const r = await fetch(CHECK_FILE, { cache: 'no-store' }); if (!r.ok) throw new Error('Couldn’t load the office check (' + r.status + ').'); src = await r.text(); }
      if (src.split('/*TC_NET_CONFIG*/null').length !== 2) throw new Error('The office check file looks wrong. Reload the page and try again.');
      text = src.replace('/*TC_NET_CONFIG*/null', JSON.stringify(B.checkConfig(bot)));
    } catch (e) { B.netBotDrop(bot.uid).catch(() => { }); throw e; } // (no code to paste: that login goes again)
    S.netBotsAt = 0;
  });
  if (!ok) return;
  S.checkText = text;
  // (a name nobody would guess: the office check's address isn't something to advertise)
  const name = (S.set.wurl.match(/^https:\/\/([a-z0-9-]+)\./) || [])[1] || 'nlo-check-' + hexId(3);
  const step2 = again
    ? '<li>Open <a href="https://dash.cloudflare.com" target="_blank" rel="noopener">dash.cloudflare.com</a> → <b>Workers &amp; Pages</b> → <b>' + esc(name) + '</b>.</li>'
    : '<li>Open <a href="https://dash.cloudflare.com" target="_blank" rel="noopener">dash.cloudflare.com</a> → <b>Workers &amp; Pages</b> → <b>Create</b> → <b>Start with Hello World</b>. Name it <b>' + esc(name) + '</b> and press <b>Deploy</b>.</li>';
  openModal('<h3>Set up the office check</h3><p class="lsub">About 5 minutes' + (again ? '' : ', once,') + ' in your free Cloudflare account (the one AISA uses). The code holds its own login: it can only write down which network a phone or computer is on, but whoever has it could make a phone look like it’s at the office — keep it to yourself.</p>' +
    '<ol class="steps"><li><button class="btn btn-pri btn-sm" data-act="copyCheck">' + ic('copy', 14) + 'Copy the code</button></li>' + step2 +
    '<li>Press <b>Edit code</b>, select everything in the editor, paste, and press <b>Deploy</b>.</li>' +
    '<li>Copy its address (it ends in <b>workers.dev</b>) and paste it here:<div class="inRow" style="margin-top:6px"><input class="inp" id="netUrl" placeholder="https://' + esc(name) + '.yourname.workers.dev" value="' + esc(S.set.wurl) + '" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="btn btn-pri btn-sm" data-act="netUrlSave">Save and test</button></div></li></ol>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Done</button></div>', 'wide');
};
ACT.copyCheck = async () => { toast(await copyText(S.checkText || '') ? 'Code copied. Paste it in the Worker’s editor.' : 'Couldn’t copy. Try again.'); };
ACT.netUrlSave = async b => {
  const u = String(($('#netUrl') || {}).value || '').trim().replace(/\/+$/, '').toLowerCase();
  if (!/^https:\/\/[a-z0-9-]{1,63}\.[a-z0-9-]{1,63}\.workers\.dev$/.test(u)) { toast('Paste the Worker’s address: https://….workers.dev', { bad: true }); return; }
  if (!(await act(b, () => B.saveSettings(Object.assign({}, S.set, { wurl: u }))))) return;
  S.set.wurl = u;
  await netTestRun(b);
};
async function netTestRun(btn) {
  busyBtn(btn, true, 'Testing…');
  try {
    const r = await B.netCheck(S.set.wurl, false);
    // the newest login answered: the older ones stop working now (until then the copy running kept working)
    const which = await B.netBotsKeep(r.bot).catch(() => 'old');
    S.netBotsAt = 0;
    if (which === 'old') { toast('The office check answers, but with an older copy of the code. Paste the newest code into the Worker, press Deploy, and test again.', { bad: true, ms: 10000 }); return; }
    toast('The office check works. This device is on ' + seenText(r) + ' (' + netText(r.net) + ')' + (r.office ? ': the office’s network.' : r.relay ? ' — an address many people share (Private Relay or a VPN), so it can’t be the office’s.' : ' — not saved as the office’s yet.'), { ms: 9000 });
  }
  catch (e) { toast('The office check didn’t answer: ' + errText(e) + ' Check the address, and that the code was deployed.', { bad: true, ms: 9000 }); }
  finally { busyBtn(btn, false); }
}
ACT.netTest = b => netTestRun(b);
/* an address many people share (iCloud Private Relay, a VPN, a hosting company) is never the office's own internet */
const RELAY_HELP = 'iCloud Private Relay or a VPN is hiding which internet this device is on. On an iPhone or iPad: Settings → Wi-Fi → tap ⓘ next to the office network → turn off Limit IP Address Tracking (and iCloud Private Relay, if it’s there). On a Mac: System Settings → Wi-Fi → Details next to the office network → the same. Or turn off the VPN.';
function offHereModal(r) {
  S.offSeen = r;
  const known = S.offices.find(o => o.net === r.net);
  openModal('<h3>This is the office</h3><p class="lsub">This device is on <b>' + esc(seenText(r)) + '</b> (' + esc(netText(r.net)) + ').</p>' +
    (known ? '<div class="notice ok">' + ic('done', 16) + ' Already saved as “' + esc(known.name) + '”.</div><div class="mFt"><button class="btn btn-sec" data-act="closeM">Close</button></div>'
      : r.relay ? '<div class="notice bad">That’s an address many people share, not the office’s own internet, so it can’t be saved. ' + esc(RELAY_HELP) + ' Then press This is the office again.</div><div class="mFt"><button class="btn btn-sec" data-act="closeM">Close</button></div>'
        : '<div class="field"><label for="offName">Name</label><input id="offName" maxlength="40" value="' + esc(S.offices.length ? 'Office (' + (/^v6:/.test(r.net) ? 'IPv6' : 'another address') + ')' : 'Office Wi-Fi') + '"></div>' +
          '<p class="small muted">Only save it from the office: anyone on this network can clock in on their phone once the lock is on.</p>' +
          '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="offHereGo">Save as the office’s network</button></div>'));
}
ACT.offHere = async b => {
  let r;
  busyBtn(b, true, 'Checking…');
  try { r = await B.netCheck(S.set.wurl, false); } catch (e) { toast('Couldn’t check: ' + errText(e), { bad: true }); return; } finally { busyBtn(b, false); }
  offHereModal(r);
};
ACT.offHereGo = async b => {
  const name = String($('#offName').value || '').trim().slice(0, 40), r = S.offSeen; if (!name || !r) { toast('Give it a name.', { bad: true }); return; }
  // checked again right before saving (the database takes the network Dr. A was seen on in the last few minutes)
  busyBtn(b, true, 'Checking…');
  let r2;
  try { r2 = await B.netCheck(S.set.wurl, false); } catch (e) { busyBtn(b, false); toast('Couldn’t check: ' + errText(e), { bad: true }); return; }
  busyBtn(b, false);
  if (r2.net !== r.net || r2.relay) { toast('This device just moved to another network: here’s the one it’s on now.', { bad: true }); offHereModal(r2); return; }
  if (await act(b, () => B.saveOffice(r2.net, name, r2), 'Saved. Phones and computers on it count as the office.')) { closeModal(); S.myNet = null; }
};
ACT.offRename = b => {
  const o = S.offices.find(x => x.net === b.dataset.net); if (!o) return;
  openModal('<h3>Rename</h3><div class="field"><label for="ornName">Name</label><input id="ornName" maxlength="40" value="' + esc(o.name) + '"></div><div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="offRenameGo" data-net="' + esc(o.net) + '">Save</button></div>');
};
ACT.offRenameGo = async b => { const n = $('#ornName').value.trim().slice(0, 40); if (!n) return; if (await act(b, () => B.renameOffice(b.dataset.net, n), 'Renamed.')) closeModal(); };
ACT.offRemove = async b => {
  const o = S.offices.find(x => x.net === b.dataset.net); if (!o) return;
  const last = S.offices.length === 1 && S.set.lock;
  if (!(await confirmBox('Remove “' + o.name + '”?', 'Phones and computers on it stop counting as the office' + (last ? ' — it’s the only one saved, so nobody can clock in on a phone or computer until you save another (the time clock keeps working, flagged)' : '') + '.', 'Remove', true))) return;
  await act(b, () => B.removeOffice(o.net), 'Removed.');
};
ACT.lockOn = async b => {
  if (!S.set.wurl || !S.offices.length) { toast('Set up the office check and save the office’s network first.', { bad: true }); return; }
  let r;
  busyBtn(b, true, 'Checking…');
  try { r = await B.netCheck(S.set.wurl, false); } catch (e) { toast('Couldn’t check: ' + errText(e), { bad: true }); return; } finally { busyBtn(b, false); }
  if (!r.office) { toast('Turn it on from a computer on the office network (this one is on ' + seenText(r) + ').', { bad: true, ms: 8000 }); return; }
  if (await act(b, () => B.saveSettings(Object.assign({}, S.set, { lock: true })), 'The office lock is on. Staff can clock in on their phones on the office Wi-Fi.')) { S.myNet = null; renderView(); }
};
ACT.lockOff = async b => {
  if (!(await confirmBox('Turn off the office lock?', 'Staff can then clock in only at the time clock (and approved laptops) — not on their phones or computers. The time clock stops checking the network.', 'Turn it off', true))) return;
  if (await act(b, () => B.saveSettings(Object.assign({}, S.set, { lock: false })), 'The office lock is off.')) renderView();
};

/* ---------- approved laptops (Amir: the laptop one of his assistants uses to work from home sometimes, and a teammate's
   who works from home) ---------- */
function laptopsCardHTML() {
  const own = B.isOwner(), now = nowMs();
  const rows = S.laptops.map(l => '<div class="kvRow"><span>' + ic('monitor', 15) + ' <b>' + esc(l.name) + '</b> <span class="muted small">' + esc(l.sids.map(nameOf).join(', ') || 'nobody') + '</span></span><span>' +
    (l.seen ? (now - l.seen < 25 * TCE.MIN ? '<span class="ok small">Seen ' + esc(agoText(l.seen, now)) + '</span>' : '<span class="muted small">Last seen ' + esc(whenText(l.seen, now)) + '</span>') : '<span class="muted small">Not seen yet</span>') +
    (own ? ' <button class="btn btn-ghost" data-act="lapEdit" data-uid="' + esc(l.uid) + '">Edit</button><button class="btn btn-ghost" data-act="lapRemove" data-uid="' + esc(l.uid) + '" style="color:var(--coral-700)">Take it back</button>' : '') + '</span></div>').join('');
  // laptops asking to be approved in the last 30 minutes (Dr. A only): he types the code on the laptop's own screen (nothing
  // a request says is shown until its code matches: anyone can make a login and ask)
  const asking = lapAsking(now);
  const waiting = own && asking.length ? '<div class="notice info" style="margin-top:10px">' + ic('monitor', 16) + ' <div><b>' + esc(plural(asking.length, 'laptop is', 'laptops are')) + ' asking to be approved</b> (' + esc((asking.length > 1 ? 'the latest ' : '') + agoText(asking[0].at, now)) + '). Type the code shown on the laptop’s own screen:' +
    (S.demo && B.LAP_CODE ? ' <span class="muted">(in the demo, ' + esc(B.LAP_CODE) + ')</span>' : '') +
    '<div class="lapWait"><input class="inp" id="lapCode" data-nodirty inputmode="numeric" maxlength="7" placeholder="123 456" autocomplete="off" value="' + esc(S.lapCodeIn || '') + '"><button class="btn btn-pri btn-sm" data-act="lapFind">Approve…</button></div></div></div>' : '';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>' + ic('monitor', 18) + ' Approved laptops</h3></div><div class="cardBd">' +
    '<p class="small muted" style="margin-bottom:8px">The only way to clock in from home. Each one is a time clock for the people you pick, with their PIN: away from the office, clock in and out only, marked Home. It stays approved in that browser (Chrome, not a private window) until you take it back.</p>' +
    (rows || '<p class="muted small">None yet.</p>') + waiting +
    (own && !asking.length ? '<p class="small muted" style="margin-top:10px">To approve one: on the laptop, open the time clock (this page) and press <b>Approve this laptop</b> under the sign-in. It shows a 6-digit code to type here — no password goes on the laptop.</p>' : '') + '</div></div>';
}
const LAP_FRESH = 30 * TCE.MIN; // (a laptop's code works for 30 minutes; the rules say so too)
function lapAsking(now) { return S.lapReqs.filter(q => now - q.at < LAP_FRESH); }
function lapPeopleHTML(cur) {
  return '<div class="field"><span class="flabel">Who uses it</span><div class="lapPick">' + onClockList().map(r => {
    const st = staffOf(r.sid);
    return '<label class="chk"><input type="checkbox" class="lapWho" value="' + esc(r.sid) + '"' + (cur.includes(r.sid) ? ' checked' : '') + '> <span>' + esc(nameOf(r.sid)) + (st.home ? '' : ' <span class="muted">(not allowed from home yet: this allows it)</span>') + '</span></label>';
  }).join('') + '</div></div>';
}
function lapPicked() { return $$('.lapWho:checked').map(x => x.value).slice(0, 5); }
/* the people picked are allowed home (on this laptop) from now on: their own setting turns on too */
async function lapAllowHome(sids) { for (const sid of sids) { const raw = S.staff.get(sid), st = staffOf(sid); if (!st.home) await B.saveStaff(sid, Object.assign({}, st, { home: true }), raw); } }
document.addEventListener('input', e => { if (e.target && e.target.id === 'lapCode') S.lapCodeIn = e.target.value; }); // (kept when the screen is drawn again)
/* the code the laptop shows → its request (exactly one of the last day's has to match; requests nobody approves are cleared
   away after a day) */
ACT.lapFind = () => {
  const code = String(($('#lapCode') || {}).value || '').replace(/\D/g, '');
  if (code.length !== 6) { toast('Type the 6-digit code the laptop shows.', { bad: true }); return; }
  const hits = lapAsking(nowMs()).filter(q => q.code === code);
  if (hits.length !== 1) { toast(hits.length ? 'Two laptops show that code. On the laptop, press Cancel and ask again.' : 'No laptop is asking with that code (a code works for 30 minutes). Check the number on the laptop’s own screen.', { bad: true, ms: 7000 }); return; }
  const q = hits[0];
  openModal('<h3>Approve this laptop</h3><p class="lsub">' + esc(q.dev || 'A laptop') + ', asked ' + esc(agoText(q.at, nowMs())) + '. Check it’s the laptop in front of you, showing the code you typed. It becomes a time clock for the people you pick, each with their PIN.</p>' +
    '<div class="field"><label for="leName">Name</label><input id="leName" maxlength="40" value="Remote laptop"></div>' + lapPeopleHTML([]) +
    '<div class="mFt"><button class="btn btn-ghost" data-act="lapDecline" data-uid="' + esc(q.uid) + '" style="color:var(--coral-700);margin-right:auto">Turn it down</button><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="lapApproveGo" data-uid="' + esc(q.uid) + '">Approve it</button></div>');
};
ACT.lapApproveGo = async b => {
  const name = $('#leName').value.trim().slice(0, 40), sids = lapPicked(), uid = b.dataset.uid;
  if (!name) { toast('Give it a name.', { bad: true }); return; }
  if (!sids.length || sids.length > 4) { toast('Pick who uses it (1 to 4 people).', { bad: true }); return; }
  // (approved first: if the laptop stopped asking, nobody's "from home" setting changes)
  const ok = await act(b, async () => {
    try { await B.lapApprove(uid, name, sids); }
    catch (e) { if (B.isPerm(e)) throw errCode('gone', 'That laptop stopped asking (its code ran out after 30 minutes, or it was turned down). On the laptop, ask again.'); throw e; }
    await lapAllowHome(sids);
  }, 'Approved. The laptop turns into the time clock now.');
  if (ok) { closeModal(); S.lapCodeIn = ''; }
};
ACT.lapDecline = async b => {
  if (await act(b, () => B.lapDecline(b.dataset.uid), 'Turned down. That laptop can’t clock anyone in.')) { closeModal(); S.lapCodeIn = ''; }
};
ACT.lapEdit = b => {
  const l = S.laptops.find(x => x.uid === b.dataset.uid); if (!l) return;
  openModal('<h3>' + esc(l.name) + '</h3><div class="field"><label for="lpName">Name</label><input id="lpName" maxlength="40" value="' + esc(l.name) + '"></div>' + lapPeopleHTML(l.sids) +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="lapEditGo" data-uid="' + esc(l.uid) + '">Save</button></div>');
};
ACT.lapEditGo = async b => {
  const name = $('#lpName').value.trim().slice(0, 40), sids = lapPicked();
  if (!name) { toast('Give it a name.', { bad: true }); return; }
  if (!sids.length || sids.length > 4) { toast('Pick who uses it (1 to 4 people).', { bad: true }); return; }
  if (await act(b, async () => { await lapAllowHome(sids); await B.laptopSave(b.dataset.uid, name, sids); }, 'Saved. The laptop picks it up right away.')) closeModal();
};
ACT.lapRemove = async b => {
  const l = S.laptops.find(x => x.uid === b.dataset.uid); if (!l) return;
  if (!(await confirmBox('Take back “' + l.name + '”?', 'Nobody can clock in on it any more (its punches stay). Use this for a lost laptop or someone who left. You can approve it again any time.', 'Take it back', true))) return;
  await act(b, () => B.laptopRemove(l.uid), 'Taken back.');
};

/* ---------- My time (anyone signed in; with the office lock on, they clock in here on their own phone or computer while
   they're on the office network) ---------- */
VIEWS.me = () => {
  const sid = B.me ? B.me.staffId : '', raw = S.staff.get(sid), st = TCE.staffOf(raw);
  if (!S.got.staff1 && !S.got.staff) return '<div class="empty">Loading…</div>';
  if (!raw || !st.on) return '<div class="card"><div class="cardBd" style="padding-top:18px"><b>You’re not on the time clock.</b><p class="muted" style="margin-top:6px">Ask Dr. A if you should be.</p></div></div>';
  const wk = sheetWeek(), cur = curWeek(), w = weekFor(sid), wp = weekFor(sid, null, true), hu = headsUp(w, S.set), today = TCE.dayOf(nowMs());
  const top = '<div class="card meCard"><div class="cardBd" style="padding-top:18px"><div class="meState">' + stateChip(wp) + '<b>' + esc(stateText(wp)) + '</b></div>' +
    '<div class="kWeek"><b>' + esc(TCE.hmDur(w.total)) + '</b> this workweek' + (w.ot ? ' · <span class="bad">' + esc(TCE.hmDur(w.ot)) + ' overtime</span>' : '') + '</div>' +
    hu.map(x => '<div class="notice ' + (x.bad ? 'bad' : x.warn ? '' : 'info') + (x.ot ? ' otPop' : '') + '"' + (x.ot ? ' role="alert"' : '') + '>' + (x.ot ? ic('warn', 18) + '<div><b>' + esc(x.h) + '</b> ' : '') + esc(x.t) + (x.ot ? '</div>' : '') + '</div>').join('') +
    myPunchHTML(st, wp) +
    '<div class="btnRow" style="margin-top:12px"><button class="btn btn-sec btn-sm" data-act="meReq">' + ic('edit', 15) + 'I forgot to punch</button></div></div></div>';
  return top + reqListHTML(sid, TCE.dayStart(TCE.addDays(today, -14)), false) + '<div class="filters" style="margin-top:18px">' + weekNav(wk) + '</div>' + personWeekHTML(sid, wk, false) +
    '<p class="muted small" style="margin-top:12px">Missed a punch, or something else to tell a manager? Use “I forgot to punch” above: a manager approves it (your original punches always stay on record, with who changed what and why).</p>';
};
/* the punch buttons on their own phone or computer: only on the office network (the office check asks right before each
   punch too; the database refuses an "at the office" punch without it) */
function myPunchHTML(st, wp) {
  const home = st.home ? ' From home, clock in on your approved laptop.' : '';
  if (!S.set.lock) return '<p class="muted">Clock in and out at the office time clock with your PIN.' + home + '</p>';
  if (!S.set.wurl) return '<p class="muted">Clock in and out at the office time clock with your PIN (the office check isn’t set up yet).</p>';
  const n = S.myNet;
  // (checked when My time opens, and again right before each punch; a screen left open checks again after 30 minutes)
  if (!n || n.state === 'checking' || (Date.now() - n.at > 30 * 60000 && document.visibilityState === 'visible')) { myNetCheck(); return '<div class="netLine">' + ic('refresh', 16) + ' Checking which network you’re on…</div>'; }
  const btn = kind => '<button class="kBig k-' + kind + '" data-act="ownPunch" data-kind="' + kind + '">' + ic(kind === 'in' ? 'in' : kind === 'out' ? 'out' : kind === 'lunch' ? 'lunch' : 'back', 26) + '<span>' + esc({ in: 'Clock in', lunch: 'Out to lunch', back: 'Back from lunch', out: 'Clock out' }[kind]) + '</span></button>';
  if (n.state === 'office') return '<div class="kBtns">' + nextKinds(wp.state).map(btn).join('') + '</div><p class="muted small">' + ic('shield', 13) + ' On the office network. Each punch takes the server’s time, not this device’s.</p>';
  if (n.state === 'away' && n.relay) return '<div class="notice netAway">' + ic('lock', 18) + '<div><b>The office network can’t be seen from this device.</b> ' + esc(RELAY_HELP) + ' Then <button class="linkBtn" data-act="myNetAgain">check again</button> — or use the time clock.' + home + '</div></div>';
  if (n.state === 'away') return '<div class="notice netAway">' + ic('lock', 18) + '<div><b>You’re not on the office network</b> (this device is on ' + esc(seenText(n)) + '). To clock in on this phone or computer, join the office Wi-Fi — or use the time clock.' + home + ' <button class="linkBtn" data-act="myNetAgain">Check again</button></div></div>';
  return '<div class="notice">Couldn’t check which network you’re on: ' + esc(n.err || '') + ' Use the time clock, or <button class="linkBtn" data-act="myNetAgain">check again</button>.</div>';
}
function netState(r) { return { state: r.office ? 'office' : 'away', org: r.org, city: r.city, net: r.net, relay: !r.office && r.relay, at: Date.now() }; }
function myNetCheck() {
  if (S.myNet && S.myNet.state === 'checking' && Date.now() - S.myNet.at < 15000) return;
  const mine = S.myNet = { state: 'checking', at: Date.now() };
  B.netCheck(S.set.wurl, false)
    .then(r => { if (S.myNet === mine) S.myNet = netState(r); },
      e => { if (S.myNet === mine) S.myNet = { state: 'error', err: errText(e), at: Date.now() }; })
    .then(() => { if (S.mode === 'app' && S.view === 'me') queueRender(); });
}
ACT.myNetAgain = () => { S.myNet = null; renderView(); };
/* "I forgot to punch", signed in (the same form as at the time clock) */
ACT.meReq = () => {
  const wp = weekFor(B.me.staffId, null, true);
  S.rq = { kind: wp.state === 'out' ? 'in' : 'lunch', day: TCE.dayOf(nowMs()), t1: '', t2: '', note: '' };
  meReqModal();
};
function meReqModal() {
  openModal('<h3>I forgot to punch</h3><p class="lsub">Pick the punch you missed and when. It goes to the managers and counts once one of them approves it.</p>' + reqFormHTML(S.rq, 'mr') +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeM">Cancel</button><button class="btn btn-pri" data-act="meReqGo">Send to a manager</button></div>', 'rqModal');
}
ACT.mrKind = b => { S.rq.kind = b.dataset.k; if (S.rq.kind !== 'lunch') S.rq.t2 = ''; meReqModal(); };
ACT.mrDay = b => { S.rq.day = b.dataset.day; meReqModal(); };
ACT.meReqGo = async b => {
  const q = reqFromForm(S.rq, B.me.staffId);
  if (q.err) { toast(q.err, { bad: true }); return; }
  if (await act(b, () => B.reqSendMine(q.ps, q.note), q.ps.length ? 'Sent. It counts once a manager approves it.' : 'Your note went to the managers.')) { closeModal(); S.rq = null; }
};
ACT.ownPunch = async b => {
  const kind = b.dataset.kind, w = weekFor(B.me.staffId), wp = weekFor(B.me.staffId, null, true);
  if (kind === 'out' && wp.state === 'lunch' && wp.since && nowMs() - wp.since > TCE.HOUR && !(await confirmBox('Did you come back from lunch?', 'You went to lunch at ' + esc(TCE.timeText(wp.since)) + '. If you came back and worked, cancel and use “I forgot to punch” to say when (otherwise the afternoon counts 0 hours).', 'No, I left at lunch'))) return;
  if ((kind === 'in' || kind === 'back') && otNotOk(w) && !(await confirmBox('Overtime isn’t approved', 'You’re at ' + esc(TCE.hmDur(w.total)) + ' this workweek' + (w.approved > w.limit ? ', past the ' + esc(TCE.h2(w.approved)) + ' h approved' : ' (overtime starts at ' + esc(S.set.ot) + ' h)') + '. Only a manager can approve overtime: check with one before you keep working. If you do work, clock in — every hour worked has to be on the clock — and a manager is told.', 'Clock in anyway'))) return;
  const ok = await act(b, async () => {
    // where they are right now: the database takes one punch under the number this check gives, within 2 minutes (a
    // newer check — another tab, say — replaces it, so a refusal checks once more)
    let r;
    for (let i = 0; i < 2 && !r; i++) {
      const n = await B.netCheck(S.set.wurl, false);
      S.myNet = netState(n);
      if (!n.office) throw errCode('away', n.relay ? 'The office network can’t be seen from this device (Private Relay or a VPN). See the note above, or use the time clock.' : 'You’re not on the office network now. Join the office Wi-Fi, or use the time clock.');
      try { r = await B.punchOwn(kind, n.pid); }
      catch (e) { if (!B.isPerm(e)) throw e; if (i) { S.myNet = null; throw errCode('not-office', 'Not saved: the database doesn’t see this device on the office network. Check again, or use the time clock.'); } }
    }
    toast(KIND[kind] + ' at ' + TCE.timeText(r.at) + '.');
  });
  queueRender();
  if (!ok) return;
};
