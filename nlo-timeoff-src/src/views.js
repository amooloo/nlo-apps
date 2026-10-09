/* =====================================================================
   The screens: Home, Request time off, My time off (requests and the
   statement), Who's out, My benefits — and, for the people who approve,
   Approvals and Team. The request and person panels (drawers) too.
   ===================================================================== */

/* ---------- Home ---------- */
function viewHome() {
  const me = meSid(), mine = personOf(me), t = todayISO();
  let h = '';
  if (isHR()) {
    const w = waitingForMe();
    if (w.length) h += '<button class="callout amber" data-act="nav" data-v="appr">' + ic('check', 20) + '<span><b>' + plural(w.length, 'request') + ' waiting for you</b>' +
      esc(w.slice(0, 3).map(r => shortName(r.sid) + ' (' + fmtRange(r.start, r.end) + ')').join(', ') + (w.length > 3 ? ' and ' + (w.length - 3) + ' more' : '')) + '</span>' + ic('next') + '</button>';
    const pw = perksWaitingForMe();
    if (pw.length) h += '<button class="callout amber" data-act="nav" data-v="appr">' + ic('check', 20) + '<span><b>' + plural(pw.length, 'scrubs request') + ' waiting for you</b>' +
      esc(pw.slice(0, 3).map(x => shortName(x.sid) + ' (' + plural(x.pairs, 'pair') + ')').join(', ') + (pw.length > 3 ? ' and ' + (pw.length - 3) + ' more' : '')) + '</span>' + ic('next') + '</button>';
  }
  h += '<div class="balGrid">' + balCards(me, mine) + '</div>';
  const my = reqsOf(me), wait = my.filter(r => r.status === 'pending').sort(byStart), soon = my.filter(r => r.status === 'approved' && r.end >= t).sort(byStart);
  h += '<div class="twoCol"><div>';
  h += '<div class="card"><div class="cardHd"><h3>My requests</h3><span style="flex:1"></span><button class="btn btn-ghost" data-act="nav" data-v="mine">See all</button></div><div class="cardBd">';
  if (!S.gotReqs && S.firstLoad) h += '<div class="empty">Loading…</div>';
  else if (!wait.length && !soon.length) h += '<div class="empty">Nothing waiting or coming up.<br><button class="btn btn-teal btn-sm" style="margin-top:12px" data-act="nav" data-v="new">' + ic('plus', 15) + 'Request time off</button></div>';
  else h += (wait.length ? '<div class="subH">Waiting for approval</div>' + wait.map(reqRow).join('') : '') + (soon.length ? '<div class="subH">Coming up</div>' + soon.map(reqRow).join('') : '');
  h += '</div></div>';
  h += '</div><div>' + weekCard() + closuresSoonCard() + '</div></div>';
  return h;
}
function byStart(a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }
/* the two balance cards (and how many days off this year) */
function balCards(sid, p) {
  if (!p) {
    return '<div class="card balCard wide"><div class="cardBd"><div class="balEmpty">' + ic('info', 20) + '<div><b>' + (sid === meSid() ? 'Your balances aren’t set up yet' : 'No HR record yet') + '</b><div class="small muted">' +
      (S.mine === undefined && sid === meSid() ? 'Loading…' : sid === meSid() && isOwner() ? 'No HR record for you — add one in Team if you want to track your own balances.' : 'Dr. A adds the hire date and balances (Team → the person). Until then requests still go through; their hours are worked out once it’s added.') + '</div></div></div></div></div>';
  }
  if (isSalaried(p)) return salaryCards(sid);
  const L = ledgerOf(sid), t = todayISO(), na = nextAccrual(p, S.pol, t), tier = tierAt(S.pol, p.hire, t), pt = p.type === 'PT' && !S.pol.ptAccrues;
  const pend = reqsOf(sid).filter(r => r.status === 'pending');
  let after = null;
  if (pend.length) {
    // what the waiting requests would take: the balance on their last day with them approved, against the same day without them
    const all = reqsOf(sid).map(r => r.status === 'pending' ? Object.assign({}, r, { status: 'approved' }) : r), last = pend.reduce((m, r) => r.end > m ? r.end : m, t);
    const L2 = ledger(p, all, S.pol, S.closed, last), L3 = ledger(p, reqsOf(sid), S.pol, S.closed, last);
    after = { vac: L2.vac, sick: L2.sick, by: last, was: { vac: L3.vac, sick: L3.sick } };
  }
  const card = (b, label, icon) => {
    const n = L ? L[b] : 0, earn = b === 'vac' ? (pt ? 0 : tier.perMonth) : (pt ? 0 : S.pol.sickPerMonth);
    return '<div class="card balCard ' + b + '"><div class="cardBd"><div class="balTop">' + ic(icon, 18) + '<span>' + label + '</span>' + (b === 'vac' && !pt && p.hire ? '<span class="tierPill t' + tier.n + '" title="' + esc(tier.years + ' full years of service') + '">' + tierName(tier.n) + '</span>' : '') + '</div>' +
      '<div class="balN">' + hrs(n) + '<small> h</small></div><div class="balD">' + (daysTxt(n) || '0 days') + '</div>' +
      '<div class="balSub">' + (pt ? 'Part-time: no paid ' + (b === 'vac' ? 'vacation' : 'sick leave') + ' (handbook)' : na ? '+' + hrs(b === 'vac' ? na.vac : na.sick) + ' h on ' + esc(fmtDate(na.date)) + (na.date > t && orientEnd(p, S.pol) > t ? ' (after orientation)' : '') : 'Not earning now') + '</div>' +
      (after && after[b] !== after.was[b] ? '<div class="balSub muted">' + (sid === meSid() ? 'If your waiting requests are approved: ' : 'If the waiting requests are approved: ') + hrs(after[b]) + ' h on ' + esc(fmtDate(after.by)) + ' (instead of ' + hrs(after.was[b]) + ')</div>' : '') +
      (!pt && earn ? '<div class="balSub muted">Earns ' + hrs(earn) + ' h a month · ' + hrs(round2(earn * 12)) + ' h a year</div>' : '') + '</div></div>';
  };
  const yr = t.slice(0, 4), daysOff = reqsOf(sid).filter(r => r.status === 'approved').reduce((s, r) => s + reqDays(r, S.closed, S.pol).filter(d => d.date.startsWith(yr) && d.date <= t).length, 0);
  const ye = S.pol.yearEnd, yeTxt = ye.vac === 'payout' && ye.sick === 'payout' ? 'What’s left on Dec 31 is paid out; both start the new year at 0.' : ye.vac === 'payout' ? 'Vacation left on Dec 31 is paid out; unused sick leave is lost. Both start the new year at 0.' : 'Unused balances don’t carry over: both start the new year at 0.';
  return card('vac', 'Vacation', 'sun') + card('sick', 'Sick leave', 'med') +
    '<div class="card balCard yr"><div class="cardBd"><div class="balTop">' + ic('cal', 18) + '<span>' + yr + ' so far</span></div><div class="balN">' + daysOff + '<small> days off</small></div>' +
    '<div class="balSub muted">' + esc(yeTxt) + '</div><button class="linkBtn small" data-act="nav" data-v="mine" data-tab="stmt">See the statement</button></div></div>';
}
/* on salary: no balance to show — just that, and how many days off this year */
function salaryCards(sid) {
  const t = todayISO(), yr = t.slice(0, 4), daysOff = reqsOf(sid).filter(r => r.status === 'approved').reduce((s, r) => s + reqDays(r, S.closed, S.pol).filter(d => d.date.startsWith(yr) && d.date <= t).length, 0);
  return '<div class="card balCard wide"><div class="cardBd"><div class="balEmpty">' + ic('info', 20) + '<div><b>On salary</b><div class="small muted">' +
    (sid === meSid() ? 'Your vacation and sick leave aren’t counted in hours, so there’s no balance here. You still ask for time off here, and it shows on Who’s out.' : 'Vacation and sick leave aren’t counted in hours, so there’s no balance. Time off is still asked for here and shows on Who’s out.') + '</div></div></div></div></div>' +
    '<div class="card balCard yr"><div class="cardBd"><div class="balTop">' + ic('cal', 18) + '<span>' + yr + ' so far</span></div><div class="balN">' + daysOff + '<small> days off</small></div></div></div>';
}
/* one request on a list */
function reqRow(r, opts) {
  opts = opts || {};
  const who = opts.who ? '<span class="nameCell">' + avatarHTML(r.sid) + '<b>' + esc(shortName(r.sid)) + '</b></span>' : '';
  return '<div class="reqRow" role="button" tabindex="0" data-act="openReq" data-id="' + esc(r.id) + '">' + who +
    '<div class="rrMain"><div class="rrDates">' + esc(fmtRange(r.start, r.end)) + partNote(r) + '</div><div class="small muted">' + typeChip(r.type) + (r.paid ? '' : ' <span class="badge unp">Unpaid</span>') + ' ' + esc(sizeTxt(r)) + '</div></div>' +
    statusChip(r.status) + '</div>';
}
/* who's out this week and next (Mon–Thu) */
function weekCard() {
  const t = todayISO(), mon = addDays(t, -((weekday(t) + 6) % 7)), weeks = [mon, addDays(mon, 7)];
  const rows = weeks.map((w, i) => {
    const days = [0, 1, 2, 3].map(k => addDays(w, k)).filter(d => i > 0 || d >= t);
    const lines = days.map(d => {
      const cl = S.closed(d), who = outOn(d);
      if (cl) return '<div class="wkDay closed"><span class="wkD">' + esc(fmtDay(d)) + '</span><span class="small">Closed — ' + esc(cl) + '</span></div>';
      return '<div class="wkDay' + (d === t ? ' today' : '') + '"><span class="wkD">' + esc(d === t ? 'Today' : fmtDay(d)) + '</span>' + (who.length ? who.map(outChip).join('') : '<span class="small muted">Everyone’s in</span>') + '</div>';
    }).join('');
    return lines ? '<div class="subH">' + (i ? 'Next week' : 'This week') + '</div>' + lines : '';
  }).join('');
  return '<div class="card"><div class="cardHd"><h3>Who’s out</h3><span style="flex:1"></span><button class="btn btn-ghost" data-act="nav" data-v="out">Month view</button></div><div class="cardBd">' + (rows || '<div class="empty">The office is closed the rest of this week.</div>') + '</div></div>';
}
/* who's off on day d: approved time off (everyone sees), plus — for the people who approve — what's been asked */
function outOn(d) {
  const out = S.board.filter(o => o.start <= d && o.end >= d && isOfficeDay(d, S.closed)).map(o => ({ sid: o.sid, part: o.part, id: o.id, asked: false }));
  if (isHR()) pendingAll().forEach(r => { if (r.start <= d && r.end >= d && isOfficeDay(d, S.closed)) out.push({ sid: r.sid, part: r.part, id: r.id, asked: true }); });
  return out.sort((a, b) => (a.asked - b.asked) || shortName(a.sid).localeCompare(shortName(b.sid)));
}
function outChip(o) {
  const canOpen = isHR() || o.sid === meSid();
  return '<span class="outChip' + (o.asked ? ' asked' : '') + '"' + (canOpen ? ' role="button" tabindex="0" data-act="openReq" data-id="' + esc(o.id) + '"' : '') + ' title="' + esc(staffName(o.sid) + (o.asked ? ' — asked, not approved yet' : '') + (o.part && o.part !== 'full' ? ' — ' + partLabel(o.part) : '')) + '">' +
    avatarHTML(o.sid) + esc(shortName(o.sid)) + (o.part && o.part !== 'full' ? ' <i>' + esc(partShort(o.part)) + '</i>' : '') + (o.asked ? ' <i>asked</i>' : '') + '</span>';
}
function closuresSoonCard() {
  const t = todayISO(), list = [];
  for (let d = t, g = 0; g < 120 && list.length < 4; d = addDays(d, 1), g++) { const c = S.closed(d); if (c && weekday(d) >= 1 && weekday(d) <= 4) list.push([d, c]); }
  if (!list.length) return '';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Office closed</h3><span class="sub">Coming up</span></div><div class="cardBd">' +
    list.map(([d, c]) => '<div class="kvRow"><span>' + esc(fmtDayY(d)) + '</span><b>' + esc(c) + '</b></div>').join('') + '</div></div>';
}

/* ---------- Request time off (also: change a waiting one; the people who approve can record time off for someone) ---------- */
function newForm(o) {
  return Object.assign({ sid: meSid(), type: '', paid: true, start: '', end: '', part: 'full', cover: '', note: '', record: false, editId: '' }, o || {});
}
function formDirty() { const f = S.form; return !!(f && !f.sent && (f.type || f.start || f.note || f.cover)); }
function viewForm() {
  if (!S.form) S.form = newForm();
  const f = S.form, hr = isHR(), forOther = f.sid !== meSid();
  if (hr && forOther && f.record === undefined) f.record = true;
  const people = activeStaff();
  let h = '<div class="formGrid"><div class="card"><div class="cardBd" style="padding-top:18px">';
  if (hr && !f.editId) h += '<div class="field"><label for="fFor">For</label><select id="fFor" class="inp" data-chg="fFor">' +
    people.map(r => '<option value="' + esc(r.sid) + '"' + (r.sid === f.sid ? ' selected' : '') + '>' + esc(r.sid === meSid() ? 'Me (' + staffName(r.sid) + ')' : staffName(r.sid)) + '</option>').join('') + '</select>' +
    '<div class="hint">Record time off for someone — e.g. a sick call-in.</div></div>';
  h += '<div class="field"><span class="flabel">What kind</span><div class="typeGrid" role="group" aria-label="What kind">' +
    TYPES.map(t => '<button type="button" class="typeTile ty-' + t.k + '" data-act="fType" data-k="' + t.k + '" aria-pressed="' + (f.type === t.k) + '">' + ic(TYPE_ICON[t.k] || 'cal', 20) + '<span>' + esc(t.l) + '</span><small>' + esc(typeSub(t.k, f.sid)) + '</small></button>').join('') + '</div></div>';
  const mx = f.type === 'sick' ? ' max="' + todayISO() + '"' : ''; // sick leave: today or earlier
  h += '<div class="grid2"><div class="field"><label for="fStart">First day</label><input type="date" id="fStart" data-inp="fDate" value="' + esc(f.start) + '"' + mx + '></div>' +
    '<div class="field"><label for="fEnd">Last day</label><input type="date" id="fEnd" data-inp="fDate" value="' + esc(f.end) + '"' + mx + '><div class="hint"><button type="button" class="linkBtn" data-act="fOneDay">Just one day</button></div></div></div>';
  h += '<div class="field"><span class="flabel">How much of each day</span><div class="seg wrap" role="group" aria-label="How much of each day">' +
    PARTS.map(p => '<button type="button" data-act="fPart" data-k="' + p.k + '" aria-pressed="' + (f.part === p.k) + '">' + esc(p.l) + '</button>').join('') + '</div>' +
    '<div class="hint">A full day is ' + hrs(S.pol.day) + ' h; a morning or afternoon ' + hrs(S.pol.day / 2) + ' h. The office is open Monday to Thursday.</div></div>';
  h += '<div class="field" id="fPaidBox">' + paidFieldHTML(f) + '</div>';
  h += '<div class="field"><label for="fCover">Who covers for you <span class="opt">(optional)</span></label><input id="fCover" maxlength="120" data-inp="fText" value="' + esc(f.cover) + '" placeholder="e.g. Gwen takes my seat"></div>';
  h += '<div class="field"><label for="fNote">Notes <span class="opt">(optional — only you and the people who approve see them)</span></label><textarea id="fNote" maxlength="600" data-inp="fText">' + esc(f.note) + '</textarea></div>';
  if (hr && !f.editId && (forOther || isOwner())) h += '<label class="chk"><input type="checkbox" id="fRecord" data-chg="fRecord"' + (f.record ? ' checked' : '') + '> Record it as approved' + (forOther ? '' : ' (your own)') + '</label>';
  h += '</div></div><div><div class="card sumCard" id="fSum">' + formSummary() + '</div></div></div>';
  return h;
}
/* paid or unpaid: the person's choice, except bereavement, which the handbook decides — paid for a death in the immediate
   family (part-time staff: unpaid) */
function bereavePaid(sid) { const p = personOf(sid); return !(p && p.type === 'PT'); }
function paidFieldHTML(f) {
  if (f.type === 'bereave') return '<span class="flabel">Paid</span><div class="small">' + (bereavePaid(f.sid)
    ? '<b>Paid</b> — bereavement for someone in the immediate family is paid, up to ' + S.pol.bereaveDays + ' days, and comes out of no balance.'
    : '<b>Unpaid</b> — the handbook doesn’t pay bereavement for part-time staff.') + ' <span class="muted">For anyone else, choose Vacation or Other.</span></div>';
  return '<span class="flabel">Paid</span><div class="seg" role="group" aria-label="Paid or unpaid"><button type="button" data-act="fPaid" data-v="1" aria-pressed="' + f.paid + '">Paid</button><button type="button" data-act="fPaid" data-v="0" aria-pressed="' + !f.paid + '">Unpaid</button></div>';
}
const TYPE_ICON = { vac: 'sun', sick: 'med', personal: 'user', medical: 'clock', family: 'heart', bereave: 'note', other: 'cal' };
function typeSub(k, sid) {
  const b = S.pol.route[k];
  if (k !== 'bereave' && isSalaried(personOf(sid))) return k === 'sick' ? 'On salary · today or earlier' : 'On salary — no balance';
  if (k === 'bereave') return (bereavePaid(sid) ? 'Paid' : 'Unpaid (part-time)') + ' · up to ' + S.pol.bereaveDays + ' days';
  if (k === 'personal') return 'Paid, from no balance';
  if (k === 'sick') return 'From sick leave · today or earlier';
  return b === 'sick' ? 'From sick leave' : b === 'vac' ? 'From vacation' : 'From no balance';
}
function afterForm() { }
/* the live summary next to the form: the days, the hours, where they come from, and anything to know */
function formSummary() {
  const f = S.form, p = personOf(f.sid), r = { id: f.editId || '__new', type: f.type, paid: f.paid, start: f.start, end: f.end || f.start, part: f.part };
  if (!f.type || !f.start) return '<div class="cardHd"><h3>Summary</h3></div><div class="cardBd"><div class="empty">Pick what kind and the dates.</div></div>';
  const others = (isHR() ? allReqs().filter(x => x.sid !== f.sid && (x.status === 'approved' || x.status === 'pending')).map(x => ({ sid: x.sid, start: x.start, end: x.end, status: x.status }))
    : S.board.filter(o => o.sid !== f.sid).map(o => ({ sid: o.sid, start: o.start, end: o.end, status: 'approved' })))
    .map(o => Object.assign(o, { name: shortName(o.sid), sameDept: !!(isHR() && deptOf(o.sid) && deptOf(o.sid) === deptOf(f.sid)) }));
  const ctx = { pol: S.pol, closed: S.closed, blackouts: S.blackouts, today: todayISO(), person: p, reqs: reqsOf(f.sid).filter(x => x.id !== f.editId), others };
  const c = checkRequest(r, ctx), blocks = c.blocks.slice(), warns = c.warns.slice();
  // the people who approve can go past a blackout (e.g. recording time off that already happened); it's still shown
  const override = isHR() && blocks.length && blocks.every(b => b.k === 'blackout');
  let h = '<div class="cardHd"><h3>Summary</h3></div><div class="cardBd">';
  if (!blocks.length || override) {
    const days = c.days, total = round2(days.reduce((s, d) => s + d.h, 0));
    const skipped = []; if (isISO(r.start) && isISO(r.end) && r.end >= r.start) for (let d = r.start, g = 0; d <= r.end && g < 130; d = addDays(d, 1), g++) { const cl = S.closed(d); if (cl && weekday(d) >= 1 && weekday(d) <= 4) skipped.push([d, cl]); }
    h += '<div class="sumBig"><b>' + hrs(total) + ' h</b><span>' + plural(days.length, 'office day') + (days.length && f.part !== 'full' ? ' · ' + esc(partLabel(f.part)) + ' each' : '') + '</span></div>';
    h += '<div class="dayList">' + days.slice(0, 40).map(d => '<span class="dayPill">' + esc(fmtDay(d.date)) + '</span>').join('') + (days.length > 40 ? '<span class="small muted">+ ' + (days.length - 40) + ' more</span>' : '') + '</div>';
    if (skipped.length) h += '<div class="small muted" style="margin-top:6px">Closed, so not counted: ' + esc(skipped.map(([d, l]) => fmtDay(d) + ' (' + l + ')').join(', ')) + '</div>';
    const b = bucketOf(r, S.pol);
    if (p && isSalaried(p) && b !== 'unpaid') h += '<div class="kvRow"><span>Paid</span><b>On salary — no balance</b></div>';
    else if (p && (b === 'vac' || b === 'sick')) {
      const pv = preview(p, ctx.reqs, r, S.pol, S.closed, todayISO());
      h += '<div class="kvRow"><span>From ' + (b === 'sick' ? 'sick leave' : 'vacation') + '</span><b>' + hrs(pv[b]) + ' h</b></div>' +
        (pv.unpaid ? '<div class="kvRow"><span>Unpaid</span><b class="coral">' + hrs(pv.unpaid) + ' h</b></div>' : '') +
        '<div class="kvRow"><span>' + (b === 'sick' ? 'Sick leave' : 'Vacation') + ' left after it</span><b>' + hrs(pv.after[b]) + ' h</b></div>';
    } else if (b === 'none') h += '<div class="kvRow"><span>Paid</span><b>From no balance</b></div>';
    else if (b === 'unpaid') h += '<div class="kvRow"><span>Unpaid</span><b>' + hrs(total) + ' h</b></div>';
    else if (!p) h += '<p class="small muted" style="margin-top:8px">' + (f.sid === meSid() ? 'Your balances aren’t set up yet' : 'No HR record yet') + ', so the hours aren’t checked against a balance.</p>';
  }
  if (blocks.length) h += '<div class="checks">' + blocks.map(x => '<div class="chkLine ' + (override ? 'warn' : 'bad') + '">' + ic(override ? 'warn' : 'block', 16) + '<span>' + esc(x.msg) + (override && x.k === 'blackout' ? ' You can still record it.' : '') + '</span></div>').join('') + '</div>';
  if (warns.length) h += '<div class="checks">' + warns.map(x => '<div class="chkLine warn">' + ic('warn', 16) + '<span>' + esc(x.msg) + '</span></div>').join('') + '</div>';
  const can = !blocks.length || override, label = f.editId ? 'Save the change' : f.record ? 'Record it (approved)' : 'Send the request';
  h += '<div class="btnRow" style="margin-top:16px"><button class="btn btn-teal" data-act="fSend"' + (can ? '' : ' disabled') + '>' + ic('tick', 16) + esc(label) + '</button>' +
    (f.editId ? '<button class="btn btn-ghost" data-act="nav" data-v="mine">Cancel</button>' : '') + '</div>';
  if (!f.record && !f.editId) h += '<p class="small muted" style="margin-top:10px">' + esc(approverLine(f.sid)) + '</p>';
  return h + '</div>';
}
function approverLine(sid) {
  const ap = S.team.filter(x => x !== sid).map(shortName).filter(Boolean);
  return ap.length ? ap.join(' or ') + ' will look at it. You’ll see the answer here.' : 'Dr. A will look at it. You’ll see the answer here.';
}
function refreshSummary() { const el = $('#fSum'); if (el) el.innerHTML = formSummary(); }
Object.assign(ACT, {
  fType(t) {
    const was = S.form.type; S.form.type = t.dataset.k;
    if (S.form.type === 'bereave') S.form.paid = bereavePaid(S.form.sid); else if (was === 'bereave') S.form.paid = true;
    const pb = $('#fPaidBox'); if (pb) pb.innerHTML = paidFieldHTML(S.form);
    ['#fStart', '#fEnd'].forEach(q => { const el = $(q); if (el) { if (S.form.type === 'sick') el.max = todayISO(); else el.removeAttribute('max'); } });
    if (S.form.type === 'sick' && !S.form.start) { S.form.start = S.form.end = todayISO(); const a = $('#fStart'), b = $('#fEnd'); if (a) a.value = S.form.start; if (b) b.value = S.form.end; } $$('[data-act=fType]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === S.form.type))); refreshSummary(); },
  fPart(t) { S.form.part = t.dataset.k; $$('[data-act=fPart]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === S.form.part))); refreshSummary(); },
  fPaid(t) { S.form.paid = t.dataset.v === '1'; $$('[data-act=fPaid]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === '1') === S.form.paid))); refreshSummary(); },
  fOneDay() { if (!S.form.start) { const a = $('#fStart'); if (a) a.focus(); return; } S.form.end = S.form.start; const b = $('#fEnd'); if (b) b.value = S.form.end; refreshSummary(); },
  async fSend(t) {
    const f = S.form; if (f.type === 'bereave') f.paid = bereavePaid(f.sid);
    const r = { type: f.type, paid: f.paid, start: f.start, end: f.end || f.start, part: f.part };
    if (!TYPE[r.type] || !isISO(r.start) || !isISO(r.end)) { toast('Pick what kind and the dates first.', { bad: true }); return; }
    busyBtn(t, true, 'Saving…');
    const me = meSid(), now = Date.now(), status = f.record ? 'approved' : 'pending';
    try {
      if (f.editId) {
        await B.saveReq(f.editId, c => { Object.assign(c, r, { cover: f.cover.trim(), note: f.note.trim() }); c.events = (c.events || []).concat([{ a: 'edit', by: me, at: now }]); }, { a: 'edit' });
        toast('Changed — it still waits for approval');
      } else {
        const id = B.newReqId();
        await B.saveReq(id, c => {
          Object.assign(c, r, { cover: f.cover.trim(), note: f.note.trim(), by: me, at: now, events: [{ a: f.record ? 'record' : 'submit', by: me, at: now }] });
          if (f.record) c.decision = { s: 'approved', by: me, at: now, note: '' };
          return { status };
        }, { create: { sid: f.sid }, a: f.record ? 'record' : 'submit', mail: f.record ? deskMail(Object.assign({ sid: f.sid }, r), 'block') : null });
        toast(f.record ? 'Recorded for ' + shortName(f.sid) : 'Sent — ' + approverLine(f.sid).replace(' You’ll see the answer here.', ''));
        syncFeed(isHR(), f.record ? 0 : 1).catch(() => { });
      }
      S.form = Object.assign(f, { sent: true }); S.view = f.record && f.sid !== me ? 'appr' : 'mine'; S.form = null; renderNav(); renderView(); window.scrollTo(0, 0);
    } catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); }
  }
});
Object.assign(CHG, {
  fFor(t) { S.form.sid = t.value; S.form.record = t.value !== meSid() ? true : false; if (S.form.type === 'bereave') S.form.paid = bereavePaid(S.form.sid); renderView(); },
  fRecord(t) { S.form.record = t.checked; refreshSummary(); },
  fDate() {
    const a = $('#fStart'), b = $('#fEnd'); S.form.start = a ? a.value : ''; S.form.end = b ? b.value : '';
    if (S.form.start && (!S.form.end || S.form.end < S.form.start)) { S.form.end = S.form.start; if (b && document.activeElement !== b) b.value = S.form.end; }
    refreshSummary();
  },
  fText() { const a = $('#fCover'), b = $('#fNote'); if (a) S.form.cover = a.value; if (b) S.form.note = b.value; }
});
/* the front-desk email: block (approved) or release (cancelled/taken back) the schedule */
function deskMail(r, kind) {
  if ((S.settings.to || {}).frontDesk === false) return null;
  const who = shortName(r.sid), when = r.start === r.end ? fmtDayY(r.start) : fmtDayY(r.start) + ' to ' + fmtDayY(r.end);
  const part = r.part && r.part !== 'full' ? ' (' + partLabel(r.part).toLowerCase() + (r.start !== r.end ? ' each day' : '') + ')' : r.start === r.end ? ' (full day)' : ' (full days)';
  if (kind === 'block') return { subject: 'Schedule block needed: ' + who + ', ' + fmtRange(r.start, r.end), text: 'Please block the schedule for ' + who + ' on ' + when + part + '. Their time off was approved.\n\n— NLO Time Off' };
  return { subject: 'Schedule block no longer needed: ' + who + ', ' + fmtRange(r.start, r.end), text: who + '’s time off on ' + when + part + ' was cancelled. Please take the schedule block off.\n\n— NLO Time Off' };
}

/* ---------- My time off: requests and the statement ---------- */
function viewMine() {
  const tab = S.tab.mine || 'req';
  let h = '<div class="seg" role="tablist" style="margin-bottom:16px">' + [['req', 'Requests'], ['stmt', 'Statement']].map(([k, l]) => '<button role="tab" data-act="tab" data-t="' + k + '" aria-pressed="' + (tab === k) + '">' + l + '</button>').join('') + '</div>';
  return h + (tab === 'stmt' ? statementHTML(meSid()) : myRequestsHTML());
}
function myRequestsHTML() {
  const t = todayISO(), my = reqsOf(meSid()), yr = t.slice(0, 4);
  if (!S.gotReqs && S.firstLoad) return '<div class="empty">Loading…</div>';
  const g = [
    ['Waiting for approval', my.filter(r => r.status === 'pending').sort(byStart)],
    ['Coming up', my.filter(r => r.status === 'approved' && r.end >= t).sort(byStart)],
    ['Taken this year', my.filter(r => r.status === 'approved' && r.end < t && r.end >= yr + '-01-01').sort(byStart).reverse()],
    ['Earlier', my.filter(r => r.status === 'approved' && r.end < yr + '-01-01').sort(byStart).reverse()],
    ['Not approved or cancelled', my.filter(r => ['denied', 'cancelled'].includes(r.status)).sort(byStart).reverse()]
  ].filter(x => x[1].length);
  if (!g.length) return '<div class="card"><div class="cardBd"><div class="empty">No requests yet.<br><button class="btn btn-teal btn-sm" style="margin-top:12px" data-act="nav" data-v="new">' + ic('plus', 15) + 'Request time off</button></div></div></div>';
  return '<div class="card"><div class="cardBd">' + g.map(([l, list], i) => (i === g.length - 1 && l.startsWith('Not') ? '<details class="help"><summary>' + esc(l) + ' (' + list.length + ')</summary>' + list.map(reqRow).join('') + '</details>' : '<div class="subH">' + esc(l) + '</div>' + list.map(reqRow).join(''))).join('') + '</div></div>';
}
/* a person's statement for a year: where every hour came from and went */
function statementHTML(sid) {
  const p = personOf(sid), t = todayISO(), years = [];
  if (!p) return '<div class="card"><div class="cardBd"><div class="empty">' + (sid === meSid() ? 'Your balances aren’t set up yet — Dr. A adds them.' : 'No HR record yet.') + '</div></div></div>';
  const y0 = Math.max(2025, Number(((p.open && p.open.asOf) || p.hire || t).slice(0, 4))), y1 = Number(t.slice(0, 4)) + (t.slice(5) >= '10-01' ? 1 : 0);
  for (let y = y1; y >= y0; y--) years.push(y);
  const y = Number(S.tab['stmtY:' + sid] || t.slice(0, 4)), end = y + '-12-31';
  const L = ledger(p, reqsOf(sid), S.pol, S.closed, end < t ? end : end), today = t;
  const ents = L.entries.filter(e => e.date >= y + '-01-01' && e.date <= end);
  const fut = e => e.date > today;
  let h = '<div class="card"><div class="cardHd"><h3>Statement</h3><span class="sub">' + esc(staffName(sid)) + '</span><span style="flex:1"></span><select class="inp" style="max-width:120px" data-chg="stmtYear" data-sid="' + esc(sid) + '">' + years.map(x => '<option' + (x === y ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div><div class="cardBd">';
  if (!ents.length) h += '<div class="empty">Nothing in ' + y + '.</div>';
  else {
    h += '<div class="tblWrap"><table class="tbl stmt"><thead><tr><th>Date</th><th>What</th><th class="num">Vacation</th><th class="num">Sick</th><th class="num hideM">Vacation left</th><th class="num hideM">Sick left</th></tr></thead><tbody>' +
      ents.map(e => '<tr class="' + (fut(e) ? 'fut' : '') + '"><td class="nowrap">' + esc(fmtDate(e.date)) + '</td><td>' + stmtWhat(e) + '</td><td class="num">' + stmtDelta(e, 'vac') + '</td><td class="num">' + stmtDelta(e, 'sick') + '</td><td class="num hideM">' + hrs(e.vac) + '</td><td class="num hideM">' + hrs(e.sick) + '</td></tr>').join('') + '</tbody></table></div>' +
      (ents.some(fut) ? '<p class="small muted" style="margin-top:8px">Lines after today (grey) are what’s planned: approved time off and the monthly accruals still to come.</p>' : '');
  }
  const po = L.payouts.find(x => x.year === y);
  if (po) h += '<div class="notice info" style="margin-top:12px">' + ic('money', 15) + ' ' + y + ' year end: ' + (po.vac || po.sick ? hrs(po.vac) + ' h vacation and ' + hrs(po.sick) + ' h sick leave paid out' : 'nothing to pay out') + (po.lostSick || po.lostVac ? '; ' + hrs(po.lostVac + po.lostSick) + ' h not carried over' : '') + '.</div>';
  return h + '</div></div>';
}
function stmtWhat(e) {
  const r = e.id && S.reqs.get(e.id);
  const tag = r ? '<button class="linkBtn" data-act="openReq" data-id="' + esc(r.id) + '">' + esc(typeLabel(r.type)) + '</button>' : esc(typeLabel(e.type));
  if (e.k === 'open') return 'Opening balance' + (e.note ? ' — ' + esc(e.note) : '');
  if (e.k === 'accrue') return 'Earned (' + tierName(e.tier) + ')' + (e.capped ? ' <span class="small muted">— at the cap</span>' : '');
  if (e.k === 'take') return tag + (e.unpaid ? ' <span class="small coral">' + hrs(e.unpaid) + ' h unpaid</span>' : '');
  if (e.k === 'free') return tag + ' <span class="small muted">' + (e.sal ? 'on salary' : 'paid, from no balance') + ' (' + hrs(e.h) + ' h)</span>';
  if (e.k === 'salary') return 'On salary from today — no balance from here on; ' + (e.closed.vac || e.closed.sick ? hrs(e.closed.vac) + ' h vacation and ' + hrs(e.closed.sick) + ' h sick leave closed, not paid out' : 'nothing to close');
  if (e.k === 'unpaid') return tag + ' <span class="small muted">unpaid (' + hrs(e.h) + ' h)</span>';
  if (e.k === 'adjust') return 'Adjustment' + (e.note ? ': ' + esc(e.note) : '') + (e.h !== e.want ? ' <span class="small muted">(only ' + hrs(Math.abs(e.h)) + ' h could come off)</span>' : '');
  if (e.k === 'yearend') return e.year + ' balance ' + (e.pay.vac || e.pay.sick ? 'paid out' : 'not carried over') + ' — the new year starts at 0';
  return '';
}
function stmtDelta(e, b) {
  let n = 0;
  if (e.k === 'open') return '<b>' + hrs(e[b]) + '</b>';
  if (e.k === 'accrue') n = b === 'vac' ? e.addVac : e.addSick;
  else if (e.k === 'take' && e.b === b) n = -e.paid;
  else if (e.k === 'adjust' && e.b === b) n = e.h;
  else if (e.k === 'yearend') n = -((e.pay[b] || 0) + (e.lost[b] || 0));
  else if (e.k === 'salary') n = -(e.closed[b] || 0);
  if (!n) return '<span class="muted">—</span>';
  return '<span class="' + (n > 0 ? 'plus' : 'minus') + '">' + (n > 0 ? '+' : '−') + hrs(Math.abs(n)) + '</span>';
}
CHG.stmtYear = t => { S.tab['stmtY:' + t.dataset.sid] = t.value; if (S.openSid) refreshDrawer(); else renderView(); };

/* ---------- Who's out: a month ---------- */
function viewOut() {
  const m0 = S.month || todayISO().slice(0, 8) + '01', [y, m] = m0.split('-').map(Number), first = new Date(y, m - 1, 1), t = todayISO();
  const start = addDays(m0, -((first.getDay() + 6) % 7)), last = lastOfMonth(m0), cells = [];
  for (let d = start; d <= last || weekday(d) !== 1; d = addDays(d, 1)) cells.push(d);
  let h = '<div class="calBar"><button class="iconBtn" data-act="mon" data-n="-1" aria-label="Earlier month">' + ic('prev') + '</button><h3>' + esc(fmtMonth(m0)) + '</h3><button class="iconBtn" data-act="mon" data-n="1" aria-label="Later month">' + ic('next') + '</button>' +
    (m0 !== t.slice(0, 8) + '01' ? '<button class="btn btn-ghost" data-act="mon" data-n="0">Today</button>' : '') + '<span style="flex:1"></span>' +
    (isHR() ? '<span class="small muted"><span class="outChip asked demoChip">asked</span> = waiting for approval</span>' : '') + '</div>';
  h += '<div class="cal"><div class="calHead">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => '<div class="' + (i > 3 ? 'off' : '') + '">' + d + '</div>').join('') + '</div><div class="calGrid">' +
    cells.map(d => {
      const inM = d.slice(0, 7) === m0.slice(0, 7), wd = weekday(d), off = wd === 0 || wd >= 5, cl = S.closed(d), who = !off && !cl ? outOn(d) : [];
      return '<div class="calDay' + (inM ? '' : ' other') + (off ? ' off' : '') + (d === t ? ' today' : '') + (cl && !off ? ' closed' : '') + (who.length ? ' has' : '') + '"><div class="cd">' + Number(d.slice(8)) + '<span class="cdW">' + esc(fmtDay(d).split(',')[0]) + '</span></div>' +
        (cl && !off ? '<div class="clTag">' + esc(cl) + '</div>' : '') + who.map(outChip).join('') + '</div>';
    }).join('') + '</div></div>';
  return h;
}
ACT.mon = t => { const n = Number(t.dataset.n); S.month = n === 0 ? todayISO().slice(0, 8) + '01' : addMonths(S.month || todayISO().slice(0, 8) + '01', n); renderView(); };

/* ---------- My benefits ---------- */
/* Dr. A can look at anyone's benefits page as they see it (he usually has no HR record of his own) */
function benefitsAsHTML(sid, others, mineToo) {
  return '<div class="field" style="max-width:380px;margin:0 0 14px"><label for="benAs">Show the benefits page of</label><select id="benAs" class="inp" data-chg="benAs">' +
    (mineToo ? '<option value="">Me</option>' : '') + others.map(r => '<option value="' + esc(r.sid) + '"' + (r.sid === sid ? ' selected' : '') + '>' + esc(staffName(r.sid)) + ' — as they see it</option>').join('') + '</select>' +
    (mineToo ? '' : '<div class="hint">You don’t have an HR record of your own, so here’s what each person sees.</div>') + '</div>';
}
CHG.benAs = t => { S.benAs = t.value; renderView(); };
function viewBenefits() {
  const me = meSid(), owner = isOwner(), t = todayISO(), mineToo = !!personOf(me);
  const others = owner ? activeStaff().filter(r => r.sid !== me && S.hrRecs.has(r.sid)) : [];
  let sid = me;
  if (owner && S.benAs && others.some(r => r.sid === S.benAs)) sid = S.benAs;
  else if (owner && !mineToo && others.length) sid = others[0].sid;
  const bar = others.length ? benefitsAsHTML(sid, others, mineToo) : '', p = personOf(sid);
  if (!p) return bar + '<div class="card" style="max-width:720px"><div class="cardBd"><div class="empty">' + (owner ? 'Nobody has an HR record yet. Add each person’s hire date in Team, and their benefits page shows here.' : 'Your hire date isn’t set up yet — Dr. A adds it. Your benefits show here then.') + '</div></div></div>';
  const tier = tierAt(S.pol, p.hire, t), nt = nextTierDate(S.pol, p.hire, t), oe = orientEnd(p, S.pol), pt = p.type === 'PT';
  const k = k401Entry(p.hire), pays = CELEBRATE.pays[Math.min(tier.n, CELEBRATE.pays.length) - 1];
  const ben = p.ben || {}, own = sid === me, enr = on => on ? '<span class="sug mint">' + ic('done', 13) + 'Enrolled</span>' : '<span class="sug">Not enrolled</span>';
  let h = '<div class="twoCol"><div>';
  h += '<div class="card"><div class="cardHd"><h3>Your time off</h3><span class="tierPill t' + tier.n + '">' + tierName(tier.n) + '</span></div><div class="cardBd">' +
    '<div class="kvRow"><span>Started</span><b>' + esc(fmtDateLong(p.hire)) + ' · ' + plural(tier.years, 'full year') + '</b></div>' +
    '<div class="kvRow"><span>Employment</span><b>' + esc(empText(p)) + '</b></div>' +
    (isSalaried(p) ? '<div class="notice">On salary: vacation and sick leave aren’t counted in hours, so there’s no balance. Time off is still asked for here and shows on Who’s out.</div>' :
    pt && !S.pol.ptAccrues ? '<div class="notice">Part-time staff don’t earn paid vacation or sick leave (handbook).</div>' :
      '<div class="kvRow"><span>Vacation</span><b>' + hrs(tier.perMonth) + ' h a month · ' + hrs(Math.min(round2(tier.perMonth * 12), tier.cap)) + ' h a year (' + hrs(round2(Math.min(tier.perMonth * 12, tier.cap) / S.pol.day)) + ' days)</b></div>' +
      '<div class="kvRow"><span>Sick leave</span><b>' + hrs(S.pol.sickPerMonth) + ' h a month · ' + hrs(round2(S.pol.sickPerMonth * 12)) + ' h a year</b></div>' +
      (oe > t ? '<div class="kvRow"><span>Earning starts</span><b>After orientation (' + esc(fmtDate(oe)) + ')</b></div>' : '') +
      (nt ? '<div class="kvRow"><span>Next tier</span><b>' + tierName(nt.n) + ' on ' + esc(fmtDate(nt.date)) + ' (' + (nt.perMonth === tier.perMonth ? 'the same ' : '') + hrs(nt.perMonth) + ' h a month)</b></div>' : '<div class="kvRow"><span>Next tier</span><b>You’re at the top tier</b></div>')) +
    '<details class="help"><summary>How time off works</summary><ul class="helpList small">' +
    '<li>The office is open <b>Monday to Thursday</b>; a full day is ' + hrs(S.pol.day) + ' h, a morning or afternoon ' + hrs(S.pol.day / 2) + ' h. Closed days don’t count.</li>' +
    '<li>Vacation and sick leave are earned on the <b>last day of each month</b>, after orientation. Tiers: ' + S.pol.tiers.map((x, i) => tierName(i + 1) + ' ' + (x.from ? 'from ' + x.from + ' years' : 'to start') + ' (' + hrs(Math.min(round2(x.perMonth * 12), x.cap)) + ' h a year)').join(', ') + '.</li>' +
    '<li>' + esc(S.pol.yearEnd.vac === 'payout' ? 'Vacation left on December 31 is paid out' : 'Vacation left on December 31 doesn’t carry over') + '; ' + esc(S.pol.yearEnd.sick === 'payout' ? 'so is sick leave' : 'unused sick leave is lost') + '. Both start the new year at 0.</li>' +
    '<li>Sick leave is only for today or days already past — never ahead of time. A planned appointment is a medical appointment.</li>' +
    '<li>Medical appointments, family emergencies and “other” come out of vacation. Personal days are paid but come out of no balance; so is bereavement for someone in the immediate family, up to ' + S.pol.bereaveDays + ' days (unpaid for part-time staff).</li>' +
    '<li>More than ' + S.pol.noticeDays + ' days in a row: please ask ' + S.pol.noticeMonths + ' months ahead. Blackouts: ' + esc(S.blackouts.map(b => b.label).join(', ') || 'none') + '.</li>' +
    '<li>If there isn’t enough balance, the rest of the time off is unpaid.</li></ul></details></div></div>';
  h += scrubsCardHTML(sid, own);
  h += '</div><div>';
  h += '<div class="card"><div class="cardHd"><h3>Celebrate Primary Care</h3><span style="flex:1"></span>' + enr(ben.celebrate) + '</div><div class="cardBd">' +
    (oe > t ? '<div class="kvRow"><span>Available</span><b>After orientation (' + esc(fmtDate(oe)) + ')</b></div>' : '') +
    '<div class="kvRow"><span>The practice pays</span><b>' + money(pays) + ' a month</b></div><div class="kvRow"><span>You pay</span><b>' + money(round2(CELEBRATE.monthly - pays)) + ' a month</b></div>' +
    (!ben.celebrate && !(oe > t) ? '<p class="small muted" style="margin-top:8px">To enroll, talk to the Office Coordinator or Dr. Akhavan.</p>' : '') +
    '<details class="help"><summary>About Celebrate Primary Care</summary><div class="small helpTxt">' +
    '<p><b>What it is:</b> direct primary care — your own provider, reachable 24/7 by text, email or video, with same-day office visits and wholesale prices on labs, medicines and procedures.</p>' +
    '<p><b>What it isn’t:</b> health insurance. It doesn’t cover hospital stays, specialists, the ER or outside prescriptions; it works alongside any insurance you have.</p>' +
    '<p><b>Cost:</b> $65 a month. The practice pays ' + CELEBRATE.pays.map((x, i) => money(x) + ' at ' + tierName(i + 1) + (i === CELEBRATE.pays.length - 1 ? ' and up' : '')).join(', ') + '. Child memberships are $45 a month (with a paying adult), at your own cost.</p>' +
    '<p><b>Provider:</b> Celebrate Primary Care · 919 NW 57th St, Gainesville FL 32605 · (352) 474-8686.</p><p><b>To enroll:</b> talk to the Office Coordinator or Dr. Akhavan.</p></div></details></div></div>';
  h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>401(k) retirement plan</h3><span style="flex:1"></span>' + enr(ben.k401) + '</div><div class="cardBd">' +
    '<div class="kvRow"><span>Eligible</span><b>' + (k <= t ? 'Yes — since ' + esc(fmtDate(k)) : 'From ' + esc(fmtDateLong(k))) + '</b></div>' +
    '<div class="kvRow"><span>Safe Harbor match</span><b>100% of the first 4% you put in</b></div>' +
    '<p class="small muted" style="margin-top:8px">Eligible after 1 year of employment.' + (k <= t && !ben.k401 ? ' To enroll, talk to the Office Coordinator or Dr. Akhavan.' : '') + '</p>' +
    '<details class="help"><summary>About the plan</summary><div class="small helpTxt">' +
    '<p><b>Plan:</b> Amir Akhavan DMD, PLLC 401(k) Plan — a Safe Harbor profit-sharing 401(k). Pre-tax or Roth.</p>' +
    '<p><b>Vesting:</b> your own deferrals and the Safe Harbor match are always 100% vested; profit sharing vests 25% a year (100% at 4 years).</p>' +
    '<p><b>Loans, withdrawals and rollovers</b> follow the plan document. Plan trustee: Ascensus Trust Company · (701) 234-0207. Plan administrator: Amir Akhavan DMD, PLLC · (352) 332-7466.</p>' +
    '<p><b>To enroll:</b> talk to the Office Coordinator or Dr. Akhavan once you’re eligible.</p></div></details></div></div>';
  return bar + h + '</div></div>';
}

/* ---------- Approvals (the people who approve) ---------- */
function viewApprovals() {
  const tab = S.tab.appr || 'wait';
  const pk = allPerks().filter(x => x.status === 'pending').sort((a, b) => (a.at || 0) - (b.at || 0));
  let h = '<div class="listHd"><div class="seg" role="tablist">' + [['wait', 'Waiting', pendingAll().length + pk.length], ['all', 'All requests', 0]].map(([k, l, n]) => '<button role="tab" data-act="tab" data-t="' + k + '" aria-pressed="' + (tab === k) + '">' + l + (n ? ' <span class="cntPill">' + n + '</span>' : '') + '</button>').join('') + '</div><span></span>' +
    '<button class="btn btn-sec btn-sm" data-act="recordFor">' + ic('plus', 15) + 'Record time off for someone</button></div>';
  if (tab === 'all') return h + allReqsHTML();
  h += unreadableHTML();
  const list = pendingAll().sort(byStart);
  if (!list.length && !pk.length) return h + '<div class="card"><div class="cardBd"><div class="empty">' + ic('done', 22) + '<br>Nothing waiting.</div></div></div>';
  return h + list.map(approvalCard).join('') + (pk.length ? '<div class="subH" style="margin-top:' + (list.length ? '22' : '0') + 'px">Scrubs</div>' + pk.map(perkCard).join('') : '');
}
/* ---------- scrubs: a yearly allowance, asked for with a reason and approved ---------- */
function perkItemsHTML(x) { const L = x.items || []; return L.map((it, i) => '<div class="small">' + (L.length > 1 ? '<span class="muted">Pair ' + (i + 1) + ':</span> ' : '') + esc(scrubItemText(it)) + '</div>').join(''); }
function perkCard(x) {
  const own = x.sid === meSid() && !isOwner(), per = S.scrubs.perYear, used = scrubsUsed(allPerks(), x.sid, x.year), thisY = Number(todayISO().slice(0, 4));
  return '<div class="card apCard"><div class="apHd">' + avatarHTML(x.sid, '', true) + '<div class="grow"><b>' + esc(staffName(x.sid)) + '</b><div class="small muted"><span class="badge">Scrubs</span> · asked ' + esc(x.at ? fmtAgo(x.at) : '') + '</div></div>' +
    '<div class="apWhen"><b>' + plural(x.pairs, 'pair') + '</b></div></div>' +
    '<div class="apBd">' + perkItemsHTML(x) + '<div class="small apNote" style="margin-top:8px">“' + esc(x.reason) + '”</div><div class="decide"><div class="kvRow"><span>' + x.year + ', with this one</span><b>' + used + ' of ' + plural(per, 'pair') + '</b></div>' +
    (used > per || x.year !== thisY ? '<div class="checks">' + (used > per ? '<div class="chkLine bad">' + ic('block', 16) + '<span>That’s more than the ' + plural(per, 'pair') + ' a year.</span></div>' : '') +
      (x.year !== thisY ? '<div class="chkLine warn">' + ic('warn', 16) + '<span>It counts against ' + x.year + ', not this year.</span></div>' : '') + '</div>' : '') + '</div></div>' +
    '<div class="apFt">' + (own ? '<span class="small muted">Your own request — Dr. A decides it.</span>' :
      '<button class="btn btn-teal btn-sm" data-act="approvePerk" data-id="' + esc(x.id) + '" data-rev="' + esc(String(x.rev || '')) + '">' + ic('tick', 15) + 'Approve</button><button class="btn btn-sec btn-sm" data-act="denyPerk" data-id="' + esc(x.id) + '" data-rev="' + esc(String(x.rev || '')) + '">Not approved…</button>') + '</div></div>';
}
function perkRow(x) {
  const own = x.sid === meSid() && x.status === 'pending';
  return '<div class="leRow"><div class="grow"><b>' + plural(x.pairs, 'pair') + '</b>' + perkItemsHTML(x) +
    '<div class="small muted" style="margin-top:2px">“' + esc(x.reason) + '” · asked ' + esc(x.at ? fmtAgo(x.at) : '') + '</div>' +
    (x.decision && x.decision.note && x.status === 'denied' ? '<div class="small muted">' + esc(shortName(x.decision.by)) + ': “' + esc(x.decision.note) + '”</div>' : '') +
    // (for the people who approve: whether the order email went, or someone has to order these by hand)
    (isHR() && x.status === 'approved' && x.decision && x.decision.mailed === false ? '<div class="small" style="color:var(--amber-700)">Not emailed — order these by hand</div>'
      : isHR() && x.status === 'approved' && x.decision && x.decision.mailed ? '<div class="small muted">Order emailed</div>' : '') + '</div>' + statusChip(x.status) +
    (own ? '<button class="linkBtn small" data-act="cancelPerk" data-id="' + esc(x.id) + '">Cancel</button>' : '') + '</div>';
}
function scrubsCardHTML(sid, own) {
  const t = todayISO(), y = Number(t.slice(0, 4)), per = S.scrubs.perYear, by = S.scrubs.byDay, used = scrubsUsed(allPerks(), sid, y), left = Math.max(0, per - used), open = scrubsOpen(t, by);
  const mine = perksOf(sid).filter(x => x.kind === 'scrubs').sort((a, b) => (b.at || 0) - (a.at || 0)), now = mine.filter(x => x.year === y), before = mine.filter(x => x.year !== y);
  if (!per && !mine.length) return '';
  const pill = !open ? '<span class="sug">Closed until January 1</span>' : '<span class="sug ' + (left ? 'mint' : '') + '">' + (left ? plural(left, 'pair') + ' left in ' + y : 'All asked for in ' + y) + '</span>';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Scrubs</h3><span class="sub">' + plural(per, 'pair') + ' a year</span><span style="flex:1"></span>' + pill + '</div><div class="cardBd">' +
    (now.length ? now.map(perkRow).join('') : '<div class="small muted">None asked for in ' + y + ' yet.</div>') +
    (own && left && open ? '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="askScrubs">' + ic('plus', 15) + 'Ask for scrubs</button></div>' : '') +
    '<p class="small muted" style="margin-top:8px">Ask by December ' + by + ', with the reason. Once it’s approved, the order goes out. Pairs not asked for by December ' + by + ' don’t carry over.</p>' +
    (before.length ? '<details class="help"><summary>Earlier years (' + before.length + ')</summary>' + before.map(perkRow).join('') + '</details>' : '') + '</div></div>';
}
async function decidePerk(id, s, note, rev, mail) {
  const x = S.perks.get(id); if (!x) return null;
  const me = meSid(), now = Date.now();
  return B.savePerk(id, (c, o) => { c.decision = Object.assign({ s, by: me, at: now, note: note || '' }, mail ? { mailed: !!(o && o.mailed) } : {}); c.events = (c.events || []).concat([{ a: s === 'approved' ? 'approve' : s === 'denied' ? 'deny' : 'cancel', by: me, at: now, note: note || '' }]); return { status: s }; },
    { a: s === 'approved' ? 'approve' : s === 'denied' ? 'deny' : 'cancel', rev: rev || x.rev, mail: mail || null });
}
/* the scrubs form: for each pair, the color, top or bottom (or both), about what size, and petite */
function skItemHTML(it, i, n) {
  return '<div class="skItem">' + (n > 1 ? '<div class="subH" style="margin:4px 0 8px">Pair ' + (i + 1) + '</div>' : '') +
    '<div class="field"><span class="flabel">Color</span><div class="seg wrap" role="group" aria-label="Color">' + SCRUB_COLORS.map(([k, l]) => '<button type="button" data-sk="color" data-i="' + i + '" data-v="' + k + '" aria-pressed="' + (it.color === k) + '"><span class="swatch sw-' + k + '"></span>' + l + '</button>').join('') + '</div></div>' +
    '<div class="field"><span class="flabel">Top or bottom</span><div class="seg wrap" role="group" aria-label="Top or bottom">' + SCRUB_PIECES.map(([k, l]) => '<button type="button" data-sk="piece" data-i="' + i + '" data-v="' + k + '" aria-pressed="' + (it.piece === k) + '">' + l + '</button>').join('') + '</div></div>' +
    '<div class="grid2"><div class="field"><label for="skSize' + i + '">Size (about)</label><select id="skSize' + i + '" data-sk="size" data-i="' + i + '"><option value="">Pick a size</option>' + SCRUB_SIZES.map(z => '<option value="' + z + '"' + (it.size === z ? ' selected' : '') + '>' + z + '</option>').join('') + '</select></div>' +
    '<div class="field"><span class="flabel">Fit</span><div class="chkList"><label><input type="checkbox" data-sk="petite" data-i="' + i + '"' + (it.petite ? ' checked' : '') + '><span>Petite</span></label></div></div></div></div>';
}
Object.assign(ACT, {
  askScrubs() {
    const me = meSid(), t = todayISO(), y = Number(t.slice(0, 4)), by = S.scrubs.byDay, left = Math.min(10, scrubsLeft(S.scrubs.perYear, allPerks(), me, y));
    if (!scrubsOpen(t, by)) { toast('Scrubs for ' + y + ' had to be asked for by December ' + by + ' — ' + (y + 1) + '’s start January 1.'); return; }
    if (!left) { toast('This year’s scrubs are all asked for — next year’s start January 1.'); return; }
    const items = [{ color: '', piece: 'set', size: '', petite: false }];
    openModal('<h3>Ask for scrubs</h3><div class="lsub">' + plural(left, 'pair') + ' left in ' + y + ' · ask by December ' + by + '</div>' +
      (left > 1 ? '<div class="field"><span class="flabel">How many pairs</span><div class="seg" role="group" aria-label="How many pairs">' + Array.from({ length: left }, (_, i) => i + 1).map(n => '<button type="button" data-pairs="' + n + '" aria-pressed="' + (n === 1) + '">' + n + '</button>').join('') + '</div></div>' : '') +
      '<div id="skItems"></div>' +
      '<div class="field"><label for="skWhy">Why</label><textarea id="skWhy" maxlength="500" placeholder="e.g. My old pair tore at the knee"></textarea><div class="hint">Only you and the people who approve see this; the order email doesn’t include it.</div></div>' +
      '<div class="mFt"><button class="btn btn-sec btn-sm" data-act="closeModal">Cancel</button><button class="btn btn-pri btn-sm" id="skSend">Send</button></div>');
    const box = $('#skItems'), paint = () => { box.innerHTML = items.map((it, i) => skItemHTML(it, i, items.length)).join(''); };
    paint();
    $$('[data-pairs]').forEach(b => b.onclick = () => {
      const n = Number(b.dataset.pairs); $$('[data-pairs]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      while (items.length < n) items.push(Object.assign({}, items[items.length - 1])); items.length = n; paint();
    });
    box.onclick = e => { const b = e.target.closest('button[data-sk]'); if (!b) return; items[Number(b.dataset.i)][b.dataset.sk] = b.dataset.v; paint(); };
    box.onchange = e => { const el = e.target; if (!el.dataset || !el.dataset.sk) return; const it = items[Number(el.dataset.i)]; if (el.dataset.sk === 'petite') it.petite = el.checked; else it[el.dataset.sk] = el.value; };
    $('#skSend').onclick = async () => {
      const why = ($('#skWhy').value || '').trim();
      const bad = items.findIndex(it => !it.color || !it.size);
      if (bad >= 0) return toast('Pick a color and a size' + (items.length > 1 ? ' for pair ' + (bad + 1) : '') + '.', { bad: true });
      if (!why) return toast('Say why — it goes with the request.', { bad: true });
      const btn = $('#skSend'); busyBtn(btn, true, 'Sending…');
      const now = Date.now(), list = items.map(it => ({ color: it.color, piece: it.piece, size: it.size, petite: !!it.petite }));
      try {
        await B.savePerk(B.newPerkId(), c => { Object.assign(c, { kind: 'scrubs', items: list, pairs: list.length, reason: why.slice(0, 500), at: now, events: [{ a: 'ask', by: me, at: now }] }); return { status: 'pending' }; }, { create: { sid: me, year: y }, a: 'ask' });
        closeModal(); toast('Sent — it waits for approval');
      } catch (e) { busyBtn(btn, false); toast(errText(e), { bad: true }); }
    };
  },
  async approvePerk(t) {
    const x = S.perks.get(t.dataset.id); if (!x) return;
    busyBtn(t, true, 'Approving…');
    let mailed = false;
    const ok = await act(async () => { const r = await decidePerk(x.id, 'approved', '', Number(t.dataset.rev) || x.rev, scrubsMail(staffName(x.sid), x.items || [], staffName(meSid()))); mailed = !!(r && r.mailed); });
    if (ok) toast('Approved — ' + shortName(x.sid) + ' sees it now' + (mailed ? ', and the order is on its way to be emailed' : '. The order couldn’t be emailed' + (isOwner() ? ' (Settings → Scrubs says why)' : '') + ', so order these by hand.'), { ms: 10000 });
    else busyBtn(t, false);
  },
  async denyPerk(t) {
    const x = S.perks.get(t.dataset.id); if (!x) return;
    const note = await noteBox('Not approved', 'Tell ' + shortName(x.sid) + ' why — they’ll see this note with the answer.', 'Send the answer', true, true); if (note == null) return;
    await act(() => decidePerk(x.id, 'denied', note, Number(t.dataset.rev) || x.rev), 'Answered — ' + shortName(x.sid) + ' sees it now');
  },
  async cancelPerk(t) {
    const x = S.perks.get(t.dataset.id); if (!x) return;
    if (!(await confirmBox('Cancel this request?', plural(x.pairs, 'pair') + ' of scrubs.', 'Cancel it', true))) return;
    await act(() => decidePerk(x.id, 'cancelled', ''), 'Cancelled');
  }
});
/* requests that can't be opened with the HR key (sealed wrong, or with content that makes no sense): shown, never counted */
function unreadableHTML() {
  const bad = Array.from(S.reqs.values()).filter(r => r.locked && r.status !== 'archived' && r.status !== 'cancelled' && r.status !== 'denied');
  if (!bad.length) return '';
  return '<div class="card" style="margin-bottom:14px;border-color:var(--coral-200)"><div class="cardHd"><h3>Can’t be opened</h3><span class="sub">' + plural(bad.length, 'request') + ' — not counted anywhere</span></div><div class="cardBd">' +
    bad.map(r => '<div class="leRow"><div class="grow"><b>' + esc(staffName(r.sid)) + '</b> <span class="small muted">' + esc(STATUS[r.status] ? STATUS[r.status][0] : r.status) + ' · starts ' + esc(r.startMs ? fmtDayY(isoOfMs(r.startMs)) : '?') + '</span></div>' +
      ((r.odd === 'bad' || isOwner()) && (isOwner() || r.sid !== meSid()) ? '<button class="btn btn-ghost" data-act="takeBackBad" data-id="' + esc(r.id) + '">Take back…</button>' : '') + '</div>').join('') +
    '<p class="small muted" style="margin-top:8px">' + (isOwner() ? 'Your login has every HR key, so these can’t be opened by anyone. Take them back and ask the person to send them again.' : 'One may be sealed with an HR key this login doesn’t have yet — it opens by itself when it does. Dr. A can take back any that stay.') + '</p></div></div>';
}
ACT.takeBackBad = async t => {
  if (!(await confirmBox('Take back this request?', 'It can’t be opened, so it’s marked as taken back (its history is kept). Ask them to send it again.', 'Take it back', true))) return;
  act(() => B.archiveUnreadable(t.dataset.id), 'Taken back');
};
ACT.recordFor = () => { S.form = newForm({ sid: (activeStaff().find(r => r.sid !== meSid()) || {}).sid || meSid(), record: true }); S.view = 'new'; renderNav(); renderView(); };
/* what an approver needs to decide: the request, the hours against the balance, and who else is off */
function decisionChecks(r) {
  const p = personOf(r.sid), others = allReqs().filter(x => x.sid !== r.sid && x.id !== r.id && (x.status === 'approved' || x.status === 'pending'))
    .map(x => ({ sid: x.sid, name: shortName(x.sid), start: x.start, end: x.end, status: x.status, sameDept: !!(deptOf(x.sid) && deptOf(x.sid) === deptOf(r.sid)) }));
  const c = checkRequest(r, { pol: S.pol, closed: S.closed, blackouts: S.blackouts, today: todayISO(), person: p, reqs: reqsOf(r.sid).filter(x => x.id !== r.id), others });
  const b = bucketOf(r, S.pol), pv = p && !isSalaried(p) && (b === 'vac' || b === 'sick') ? preview(p, reqsOf(r.sid).filter(x => x.id !== r.id), r, S.pol, S.closed, todayISO()) : null;
  return { c, b, pv, p };
}
function checksHTML(r) {
  const { c, b, pv, p } = decisionChecks(r);
  let h = '<div class="decide">';
  if (pv) h += '<div class="kvRow"><span>From ' + (b === 'sick' ? 'sick leave' : 'vacation') + '</span><b>' + hrs(pv[b]) + ' h</b></div>' + (pv.unpaid ? '<div class="kvRow"><span>Unpaid</span><b class="coral">' + hrs(pv.unpaid) + ' h</b></div>' : '') + '<div class="kvRow"><span>Left after it</span><b>' + hrs(pv.after[b]) + ' h</b></div>';
  else if (p && isSalaried(p) && b !== 'unpaid') h += '<div class="kvRow"><span>Paid</span><b>On salary — no balance</b></div>';
  else if (b === 'none') h += '<div class="kvRow"><span>Paid</span><b>From no balance</b></div>';
  else if (b === 'unpaid') h += '<div class="kvRow"><span>Paid</span><b>Unpaid</b></div>';
  if (!p) h += '<div class="small muted">No HR record for ' + esc(shortName(r.sid)) + ' yet, so there’s no balance to check against.</div>';
  const lines = c.blocks.map(x => ['bad', x.msg]).concat(c.warns.filter(x => x.k !== 'short').map(x => [x.k === 'dept' ? 'bad' : 'warn', x.msg]));
  if (r.startMs && dayStartMs(r.start) !== r.startMs) lines.unshift(['bad', 'The dates in this request don’t match what it was saved with. Ask ' + shortName(r.sid) + ' to send it again.']);
  if (lines.length) h += '<div class="checks">' + lines.map(([k, m]) => '<div class="chkLine ' + k + '">' + ic(k === 'bad' ? 'block' : 'warn', 16) + '<span>' + esc(m) + '</span></div>').join('') + '</div>';
  return h + '</div>';
}
function approvalCard(r) {
  const own = r.sid === meSid() && !isOwner();
  return '<div class="card apCard"><div class="apHd">' + avatarHTML(r.sid, '', true) + '<div class="grow"><b>' + esc(staffName(r.sid)) + '</b><div class="small muted">' + typeChip(r.type) + (r.paid ? '' : ' <span class="badge unp">Unpaid</span>') + ' · asked ' + esc(r.at ? fmtAgo(r.at) : '') + '</div></div>' +
    '<div class="apWhen"><b>' + esc(fmtRange(r.start, r.end)) + '</b><div class="small muted">' + esc(sizeTxt(r)) + partNote(r) + '</div></div></div>' +
    '<div class="apBd">' + (r.cover ? '<div class="small"><b>Covering:</b> ' + esc(r.cover) + '</div>' : '') + (r.note ? '<div class="small apNote">“' + esc(r.note) + '”</div>' : '') + checksHTML(r) + '</div>' +
    '<div class="apFt">' + (own ? '<span class="small muted">Your own request — Dr. A decides it.</span>' :
      '<button class="btn btn-teal btn-sm" data-act="approve" data-id="' + esc(r.id) + '" data-rev="' + esc(String(r.rev || '')) + '">' + ic('tick', 15) + 'Approve</button><button class="btn btn-sec btn-sm" data-act="deny" data-id="' + esc(r.id) + '" data-rev="' + esc(String(r.rev || '')) + '">Not approved…</button>') +
    '<span style="flex:1"></span><button class="btn btn-ghost" data-act="openReq" data-id="' + esc(r.id) + '">Details</button></div></div>';
}
function allReqsHTML() {
  const f = S.tab.allF || { who: '', st: '', y: todayISO().slice(0, 4) };
  const years = Array.from(new Set(allReqs().map(r => r.start.slice(0, 4)).concat([todayISO().slice(0, 4)]))).sort().reverse();
  const list = allReqs().filter(r => (!f.who || r.sid === f.who) && (!f.st || r.status === f.st) && (!f.y || r.start.slice(0, 4) === f.y || r.end.slice(0, 4) === f.y)).sort(byStart).reverse();
  const sel = (k, opts) => '<select data-chg="allF" data-k="' + k + '">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (f[k] === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  let h = '<div class="filters">' + sel('who', [['', 'Everyone']].concat(activeStaff().map(r => [r.sid, staffName(r.sid)]))) +
    sel('st', [['', 'Any status'], ['pending', 'Waiting'], ['approved', 'Approved'], ['denied', 'Not approved'], ['cancelled', 'Cancelled'], ['archived', 'Taken back']]) +
    sel('y', [['', 'Any year']].concat(years.map(y => [y, y]))) + '<span class="small muted">' + plural(list.length, 'request') + '</span></div>';
  if (!list.length) return h + '<div class="card"><div class="cardBd"><div class="empty">No requests match.</div></div></div>';
  return h + '<div class="card"><div class="tblWrap"><table class="tbl"><thead><tr><th>Who</th><th>When</th><th class="hideM">Kind</th><th class="num hideM">Hours</th><th>Status</th></tr></thead><tbody>' +
    list.map(r => '<tr class="click" tabindex="0" data-act="openReq" data-id="' + esc(r.id) + '"><td><span class="nameCell">' + avatarHTML(r.sid) + esc(shortName(r.sid)) + '</span></td><td class="nowrap">' + esc(fmtRange(r.start, r.end)) + '<div class="small muted">' + esc(partShort(r.part)) + '</div></td><td class="hideM">' + typeChip(r.type) + (r.paid ? '' : ' <span class="badge unp">Unpaid</span>') + '</td><td class="num hideM">' + hrs(reqHours(r, S.closed, S.pol)) + '</td><td>' + statusChip(r.status) + '</td></tr>').join('') +
    '</tbody></table></div></div>';
}
CHG.allF = t => { const f = S.tab.allF || { who: '', st: '', y: todayISO().slice(0, 4) }; f[t.dataset.k] = t.value; S.tab.allF = f; renderView(); };

/* deciding, cancelling, taking back */
async function decide(id, s, note, rev) {
  const r = S.reqs.get(id); if (!r) return;
  const me = meSid(), now = Date.now();
  await B.saveReq(id, c => {
    c.decision = { s, by: me, at: now, note: note || '' };
    c.events = (c.events || []).concat([{ a: s === 'approved' ? 'approve' : s === 'denied' ? 'deny' : s === 'archived' ? 'takeback' : 'cancel', by: me, at: now, note: note || '' }]);
    return { status: s };
  }, { a: s === 'approved' ? 'approve' : s === 'denied' ? 'deny' : s === 'archived' ? 'takeback' : 'cancel', rev: rev || r.rev, mail: s === 'approved' ? deskMail(r, 'block') : (r.status === 'approved' && (s === 'cancelled' || s === 'archived')) ? deskMail(r, 'release') : null });
  syncFeed(isHR(), r.status === 'pending' ? -1 : 0).catch(() => { });
}
Object.assign(ACT, {
  async approve(t) {
    const r = S.reqs.get(t.dataset.id); if (!r) return;
    if (r.startMs && dayStartMs(r.start) !== r.startMs) { toast('This request’s dates don’t match what it was saved with — ask ' + shortName(r.sid) + ' to send it again.', { bad: true }); return; }
    busyBtn(t, true, 'Approving…');
    if (await act(() => decide(r.id, 'approved', '', Number(t.dataset.rev) || r.rev), 'Approved — ' + shortName(r.sid) + ' sees it now')) { if (S.openId) closeDrawer(); }
    else busyBtn(t, false);
  },
  async deny(t) {
    const r = S.reqs.get(t.dataset.id); if (!r) return;
    const note = await noteBox('Not approved', 'Tell ' + shortName(r.sid) + ' why — they’ll see this note with the answer.', 'Send the answer', true, true); if (note == null) return;
    if (await act(() => decide(r.id, 'denied', note, Number(t.dataset.rev) || r.rev), 'Answered — ' + shortName(r.sid) + ' sees it now') && S.openId) closeDrawer();
  },
  async cancelReq(t) {
    const r = S.reqs.get(t.dataset.id); if (!r) return;
    const started = r.status === 'approved' && !(r.startMs > Date.now());
    if (started) { toast('It has already started — ask Dr. A to change it.', { bad: true }); return; }
    if (!(await confirmBox(r.status === 'approved' ? 'Cancel this time off?' : 'Cancel this request?', fmtRange(r.start, r.end) + ' · ' + typeLabel(r.type) + (r.status === 'approved' ? '. The front desk is told the schedule block isn’t needed any more.' : '.'), 'Cancel it', true))) return;
    if (await act(() => decide(r.id, 'cancelled', ''), 'Cancelled') && S.openId) closeDrawer();
  },
  async takeBack(t) {
    const r = S.reqs.get(t.dataset.id); if (!r) return;
    const note = await noteBox('Take back this ' + (r.status === 'approved' ? 'approved time off' : 'request') + '?', 'It comes off the calendar and out of the balance, and ' + shortName(r.sid) + ' sees your note. Use it for duplicates, tests, or time off that didn’t happen.', 'Take it back', false, true);
    if (note == null) return;
    if (await act(() => decide(r.id, 'archived', note), 'Taken back') && S.openId) closeDrawer();
  },
  editReq(t) {
    const r = S.reqs.get(t.dataset.id); if (!r) return;
    S.form = newForm({ editId: r.id, sid: r.sid, type: r.type, paid: r.paid, start: r.start, end: r.end, part: r.part, cover: r.cover || '', note: r.note || '' });
    closeDrawer(); S.view = 'new'; renderNav(); renderView(); window.scrollTo(0, 0);
  },
  openReq(t) { openReqDrawer(t.dataset.id); }
});

/* ---------- a request, in full ---------- */
async function openReqDrawer(id, keep) {
  const r = S.reqs.get(id); if (!r) { if (!keep) toast('That request isn’t open on this login.', { bad: true }); return; }
  S.openId = id; S.openSid = '';
  const me = meSid(), mine = r.sid === me, hr = isHR(), t = todayISO();
  const days = reqDays(r, S.closed, S.pol), total = round2(days.reduce((s, d) => s + d.h, 0));
  let h = '<div class="dHd">' + avatarHTML(r.sid, '', true) + '<div class="grow"><h3>' + esc(fmtRange(r.start, r.end)) + '</h3><div class="sub">' + esc(staffName(r.sid)) + ' · ' + typeChip(r.type) + (r.paid ? '' : ' <span class="badge unp">Unpaid</span>') + ' ' + statusChip(r.status) + '</div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd">';
  h += '<div class="kvRow"><span>Each day</span><b>' + esc(partLabel(r.part)) + '</b></div><div class="kvRow"><span>Office days</span><b>' + days.length + ' · ' + hrs(total) + ' h</b></div>' +
    '<div class="dayList" style="margin:6px 0 10px">' + days.slice(0, 60).map(d => '<span class="dayPill">' + esc(fmtDay(d.date)) + '</span>').join('') + '</div>';
  if (r.cover) h += '<div class="kvRow"><span>Covering</span><b>' + esc(r.cover) + '</b></div>';
  if (r.note) h += '<div class="sec"><h5>Notes</h5><div class="small apNote">' + esc(r.note) + '</div></div>';
  if (r.decision && r.decision.note) h += '<div class="sec"><h5>' + (r.status === 'denied' ? 'Why it wasn’t approved' : 'Note from ' + esc(shortName(r.decision.by))) + '</h5><div class="small apNote">' + esc(r.decision.note) + '</div></div>';
  if (r.status === 'approved' || r.status === 'pending') {
    const p = personOf(r.sid), b = bucketOf(r, S.pol);
    if (p && !isSalaried(p) && (b === 'vac' || b === 'sick')) {
      const L = ledgerOf(r.sid, r.end > t ? r.end : t), st = L && L.byReq[r.id], pv = r.status === 'pending' ? preview(p, reqsOf(r.sid).filter(x => x.id !== r.id), r, S.pol, S.closed, t) : null;
      const x = pv || st, old = (p.settled || []).includes(r.id), before = !old && x && x.before && p.open && r.start <= p.open.asOf;
      if (x) h += '<div class="sec"><h5>Hours</h5><div class="kvRow"><span>From ' + (b === 'sick' ? 'sick leave' : 'vacation') + '</span><b>' + hrs((x[b] || 0) + (old ? x.before || 0 : 0)) + ' h</b></div>' +
        ((x.unpaid || 0) ? '<div class="kvRow"><span>Unpaid</span><b class="coral">' + hrs(x.unpaid) + ' h</b></div>' : '') +
        (old ? '<div class="small muted">Taken off by the old Time-Off app' + (r.legacy && r.legacy.took != null && r.legacy.took !== x.hours ? ' (it took ' + hrs(r.legacy.took) + ' h by its own count)' : '') + '.</div>'
          : before ? '<div class="small muted">' + hrs(x.before) + ' h of it ' + (x.before === x.hours ? 'was' : 'were') + ' before the opening balance (' + esc(fmtDate(p.open.asOf)) + ').</div>' : '') + '</div>';
    }
  }
  if (hr && r.status === 'pending') h += '<div class="sec"><h5>Before deciding</h5>' + checksHTML(r) + '</div>';
  h += '<div class="sec"><h5>History</h5><div id="reqHist">' + histHTML(r, null) + '</div></div>';
  h += '</div><div class="dFt">';
  const startedOrPast = !(r.startMs > Date.now());
  if (hr && r.status === 'pending' && (!mine || isOwner())) h += '<button class="btn btn-teal btn-sm" data-act="approve" data-id="' + esc(r.id) + '" data-rev="' + esc(String(r.rev || '')) + '">' + ic('tick', 15) + 'Approve</button><button class="btn btn-sec btn-sm" data-act="deny" data-id="' + esc(r.id) + '" data-rev="' + esc(String(r.rev || '')) + '">Not approved…</button>';
  if (mine && r.status === 'pending') h += '<button class="btn btn-sec btn-sm" data-act="editReq" data-id="' + esc(r.id) + '">Change it</button><button class="btn btn-ghost" data-act="cancelReq" data-id="' + esc(r.id) + '">Cancel request</button>';
  if (mine && r.status === 'approved' && !startedOrPast) h += '<button class="btn btn-sec btn-sm" data-act="cancelReq" data-id="' + esc(r.id) + '">Cancel this time off</button>';
  if (mine && r.status === 'approved' && startedOrPast && !hr) h += '<span class="small muted">It has started — ask Dr. A to change it.</span>';
  if (hr && (r.status === 'approved' || r.status === 'pending') && (!mine || isOwner())) h += '<span style="flex:1"></span><button class="btn btn-ghost" data-act="takeBack" data-id="' + esc(r.id) + '">Take back…</button>';
  h += '</div>';
  if (keep && $('#drawer')) { $('#drawer').innerHTML = h; paintPhotos($('#drawer')); } else openDrawerHTML(h);
  try { const log = await B.reqLog(r.id, r.sid); const el = $('#reqHist'); if (el && S.openId === id) el.innerHTML = histHTML(r, log); } catch (e) { }
}
const EVT = { submit: 'asked for it', record: 'recorded it', edit: 'changed it', approve: 'approved it', deny: 'didn’t approve it', cancel: 'cancelled it', takeback: 'took it back', import: 'brought it over from the old app', rekey: 'sealed it again (new HR key)', reseal: 'sealed it again', save: 'saved it' };
function histHTML(r, log) {
  const ev = (r.events || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
  let h = ev.map(e => '<div class="hist"><time>' + esc(fmtWhen(e.at)) + '</time><span><b>' + esc(shortName(e.by)) + '</b> ' + esc(EVT[e.a] || e.a) + (e.note ? ' — “' + esc(e.note) + '”' : '') + '</span></div>').join('');
  if (log && log.length) { const extra = log.filter(x => ['rekey', 'reseal', 'import'].includes(x.a)); h += extra.map(x => '<div class="hist"><time>' + esc(fmtWhen(x.at)) + '</time><span class="muted">' + esc(EVT[x.a] || x.a) + '</span></div>').join(''); }
  if (r.legacy && r.legacy.id) h += '<div class="hist"><time></time><span class="muted">Old Time-Off app request ' + esc(r.legacy.id) + '</span></div>';
  return h || '<div class="small muted">—</div>';
}

/* ---------- Team (the people who approve): balances for everyone, payroll ---------- */
function viewTeam() {
  const tab = S.tab.team || 'people';
  let h = '<div class="listHd"><div class="seg" role="tablist">' + [['people', 'People'], ['pay', 'Payroll'], ['year', 'Year end']].map(([k, l]) => '<button role="tab" data-act="tab" data-t="' + k + '" aria-pressed="' + (tab === k) + '">' + l + '</button>').join('') + '</div><span></span></div>';
  if (tab === 'pay') return h + payrollHTML();
  if (tab === 'year') return h + yearEndHTML();
  const t = todayISO(), all = activeStaff(), sal = all.filter(r => isSalaried(personOf(r.sid))), people = all.filter(r => !isSalaried(personOf(r.sid)));
  h += '<div class="card"><div class="tblWrap"><table class="tbl"><thead><tr><th>Person</th><th>Tier</th><th class="num">Vacation</th><th class="num">Sick</th><th class="hideM">Next accrual</th><th class="hideM">Coming up</th></tr></thead><tbody>' +
    people.map(r => {
      const p = personOf(r.sid), L = p ? ledgerOf(r.sid) : null, tier = p && p.hire ? tierAt(S.pol, p.hire, t) : null, na = p ? nextAccrual(p, S.pol, t) : null;
      const next = reqsOf(r.sid).filter(x => x.status === 'approved' && x.end >= t).sort(byStart)[0], w = reqsOf(r.sid).filter(x => x.status === 'pending').length;
      return '<tr class="click" tabindex="0" data-act="openPerson" data-sid="' + esc(r.sid) + '"><td><span class="nameCell">' + avatarHTML(r.sid) + '<span><b>' + esc(staffName(r.sid)) + '</b>' + (p ? '<div class="small muted">' + (p.type === 'PT' ? esc(empText(p)) + ' · ' : '') + (p.hire ? 'since ' + esc(fmtDate(p.hire)) : 'no hire date') + (isISO(p.left) && p.left >= t ? ' · last day ' + esc(fmtDate(p.left)) : '') + '</div>' : '<div class="small coral">No HR record yet</div>') + '</span></span></td>' +
        '<td>' + (p && p.type === 'PT' && !S.pol.ptAccrues ? '<span class="tierPill">' + esc(empText(p)) + '</span>' : tier ? '<span class="tierPill t' + tier.n + '">' + tierName(tier.n) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + (L ? '<b>' + hrs(L.vac) + '</b><div class="small muted">' + esc(daysTxt(L.vac)) + '</div>' : '—') + '</td><td class="num">' + (L ? '<b>' + hrs(L.sick) + '</b>' : '—') + '</td>' +
        '<td class="hideM small">' + (na ? '+' + hrs(na.vac) + ' / +' + hrs(na.sick) + ' h · ' + esc(fmtDate(na.date)) : '<span class="muted">—</span>') + '</td>' +
        '<td class="hideM small">' + (next ? esc(fmtRange(next.start, next.end)) : '<span class="muted">—</span>') + (w ? ' <span class="stat wait">' + w + ' waiting</span>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
  if (sal.length) h += '<p class="small muted salLine" style="margin-top:10px">On salary, so no balance: ' + sal.map(r => '<button class="linkBtn" data-act="openPerson" data-sid="' + esc(r.sid) + '">' + esc(staffName(r.sid)) + '</button>').join(', ') + '.</p>';
  if (isOwner()) {
    h += shTeamHTML() + '<p class="small muted" style="margin-top:10px">Tap someone to see their statement, change their balance or add an adjustment. People come from NLO Cases’ team, which follows Staff Hub; start dates, full- or part-time and last days come from Staff Hub too, once you bring them in.</p>';
    setTimeout(() => shAuto().catch(() => { }), 0); // reads Staff Hub's roster if it hasn't lately (Team then lists who has no login)
  }
  return h;
}
ACT.openPerson = t => openPersonDrawer(t.dataset.sid);
function openPersonDrawer(sid, keep) {
  S.openSid = sid; S.openId = '';
  const p = personOf(sid), t = todayISO(), owner = isOwner();
  let h = '<div class="dHd">' + avatarHTML(sid, '', true) + '<div class="grow"><h3>' + esc(staffName(sid)) + '</h3><div class="sub">' + (p && p.hire ? '<span class="tierPill t' + tierAt(S.pol, p.hire, t).n + '">' + tierName(tierAt(S.pol, p.hire, t).n) + '</span> ' : '') + (p ? esc(empText(p)) + (p.dept ? ' · ' + esc(p.dept) : '') : 'No HR record yet') + '</div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd">';
  if (p) {
    h += '<div class="balGrid sm">' + balCards(sid, p) + '</div>';
    h += '<div class="sec"><h5>HR record</h5><div class="kvRow"><span>Hire date</span><b>' + esc(p.hire ? fmtDateLong(p.hire) : '—') + shTag(p, 'hire') + '</b></div>' +
      '<div class="kvRow"><span>Employment</span><b>' + esc(empText(p)) + shTag(p, 'type') + '</b></div><div class="kvRow"><span>Orientation ends</span><b>' + esc(orientEnd(p, S.pol) ? fmtDate(orientEnd(p, S.pol)) : '—') + (p.orient ? '' : ' <span class="small muted">(90 days)</span>') + '</b></div>' +
      (p.left ? '<div class="kvRow"><span>Last day</span><b>' + esc(fmtDate(p.left)) + shTag(p, 'left') + '</b></div>' : '') +
      (isSalaried(p) ? '' : '<div class="kvRow"><span>Opening balance</span><b>' + (p.open ? hrs(p.open.vac) + ' h vacation · ' + hrs(p.open.sick) + ' h sick, end of ' + esc(fmtDate(p.open.asOf)) : 'From the hire date (0)') + '</b></div>' +
      (p.open && p.open.note ? '<div class="small muted">' + esc(p.open.note) + '</div>' : '')) +
      (p.notes ? '<div class="kvRow"><span>Notes</span><b style="text-align:right;white-space:pre-wrap;font-weight:500">' + esc(p.notes) + '</b></div>' : '') +
      (owner ? shWhoHTML(sid) : '') +
      (owner ? '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="editHR" data-sid="' + esc(sid) + '">Change…</button>' + (isSalaried(p) ? '' : '<button class="btn btn-sec btn-sm" data-act="addAdj" data-sid="' + esc(sid) + '">Add an adjustment…</button>') + '</div>' : '') + '</div>';
    const ben = p.ben || {}, k = k401Entry(p.hire), y = Number(t.slice(0, 4)), per = S.scrubs.perYear;
    h += '<div class="sec"><h5>Benefits</h5><div class="kvRow"><span>Celebrate Primary Care</span><b>' + (ben.celebrate ? '<span class="sug mint">' + ic('done', 13) + 'Enrolled</span>' : 'Not enrolled') + '</b></div>' +
      '<div class="kvRow"><span>401(k)</span><b>' + (ben.k401 ? '<span class="sug mint">' + ic('done', 13) + 'Enrolled</span>' : k && k <= t ? 'Eligible — not enrolled' : k ? 'Eligible from ' + esc(fmtDate(k)) : '—') + '</b></div>' +
      '<div class="kvRow"><span>Scrubs in ' + y + '</span><b>' + scrubsUsed(allPerks(), sid, y) + ' of ' + plural(per, 'pair') + '</b></div>' +
      perksOf(sid).filter(x => x.year === y).map(perkRow).join('') + '</div>';
    if ((p.adj || []).length) h += '<div class="sec"><h5>Adjustments</h5>' + p.adj.slice().sort((a, b) => a.date < b.date ? 1 : -1).map(a => '<div class="hist"><time>' + esc(fmtDate(a.date)) + '</time><span><b>' + (a.h > 0 ? '+' : '−') + hrs(Math.abs(a.h)) + ' h ' + (a.b === 'sick' ? 'sick' : 'vacation') + '</b> — ' + esc(a.note || '') + (a.by ? ' <span class="muted">(' + esc(shortName(a.by)) + ')</span>' : '') + '</span>' + (owner ? '<button class="linkBtn small" style="margin-left:auto" data-act="rmAdj" data-sid="' + esc(sid) + '" data-id="' + esc(a.id || '') + '">Remove</button>' : '') + '</div>').join('') + '</div>';
    h += '<div class="sec">' + statementHTML(sid).replace('<div class="card">', '<div class="card flat">') + '</div>';
  } else if (owner) h += '<div class="empty">No hire date or balance yet.<br><button class="btn btn-teal btn-sm" style="margin-top:12px" data-act="editHR" data-sid="' + esc(sid) + '">Add the HR record</button></div>' + (shWhoHTML(sid) ? '<div class="sec">' + shWhoHTML(sid) + '</div>' : '');
  else h += '<div class="empty">Dr. A hasn’t added an HR record yet.</div>';
  const rs = reqsOf(sid).sort(byStart).reverse();
  h += '<div class="sec"><h5>Requests</h5>' + (rs.length ? rs.slice(0, 40).map(r => reqRow(r)).join('') : '<div class="small muted">None yet.</div>') + '</div>';
  h += '</div>';
  if (keep && $('#drawer')) { $('#drawer').innerHTML = h; paintPhotos($('#drawer')); } else openDrawerHTML(h);
}

/* ---------- Payroll and the year-end list ---------- */
function payrollHTML() {
  const t = todayISO(), f = S.tab.payF || { from: t.slice(0, 8) + '01', to: lastOfMonth(t) };
  let h = '<div class="card"><div class="cardHd"><h3>Time off in a pay period</h3><span class="sub">Approved time off, from the balances it came out of</span></div><div class="cardBd">' +
    '<div class="grid3"><div class="field"><label for="pfFrom">From</label><input type="date" id="pfFrom" data-chg="payF" value="' + esc(f.from) + '"></div><div class="field"><label for="pfTo">To</label><input type="date" id="pfTo" data-chg="payF" value="' + esc(f.to) + '"></div></div>';
  const rows = payrollRows(f.from, f.to);
  if (!rows.length) return h + '<div class="empty">No approved time off in that period.</div></div></div>';
  h += '<div class="tblWrap"><table class="tbl"><thead><tr><th>Person</th><th class="num">Vacation</th><th class="num">Sick</th><th class="num">Paid, no balance</th><th class="num">Unpaid</th><th class="num hideM">Days</th></tr></thead><tbody>' +
    rows.map(x => '<tr><td>' + esc(x.name) + (x.pre ? '<div class="small muted">incl. ' + hrs(x.pre) + ' h before the move</div>' : '') + '</td><td class="num">' + hrs(x.vac) + '</td><td class="num">' + hrs(x.sick) + '</td><td class="num">' + hrs(x.free) + '</td><td class="num' + (x.unpaid ? ' coral' : '') + '">' + hrs(x.unpaid) + '</td><td class="num hideM">' + x.days + '</td></tr>').join('') + '</tbody></table></div>' +
    '<div class="btnRow" style="margin-top:12px"><button class="btn btn-sec btn-sm" data-act="payCSV">' + ic('download', 15) + 'Download CSV</button><button class="btn btn-ghost" data-act="payCopy">' + ic('copy', 15) + 'Copy for Paychex</button></div>' +
    '<p class="small muted" style="margin-top:8px">Hours of paid vacation and sick leave come out of the balances; “paid, no balance” is personal days and bereavement; “unpaid” includes paid time off there wasn’t enough balance for. Time off before the move from the old app is counted as it was asked for.</p>';
  return h + '</div></div>';
}
function payrollRows(from, to) {
  if (!isISO(from) || !isISO(to) || to < from) return [];
  return activeStaff().concat(S.roster.filter(r => !r.active)).map(r => {
    const p = personOf(r.sid), rs = reqsOf(r.sid).filter(x => x.status === 'approved' && x.end >= from && x.start <= to);
    if (!rs.length || (p && typeOn(p, from) === 'SAL' && typeOn(p, to) === 'SAL')) return null; // on salary: not hours for payroll
    if (p) {
      const L = ledgerOf(r.sid, to), o = Object.assign({ name: staffName(r.sid), pre: 0 }, payPeriod(L, from, to));
      // days on or before the opening balance, or taken off by the old app, aren't in the ledger: count them as asked
      const asOf = p.open && isISO(p.open.asOf) ? p.open.asOf : '', settled = new Set(p.settled || []);
      const dset = new Set(L.entries.filter(e => e.date >= from && e.date <= to && (e.k === 'take' || e.k === 'free' || e.k === 'unpaid')).map(e => e.date));
      rs.forEach(x => reqDays(x, S.closed, S.pol).filter(d => d.date >= from && d.date <= to && ((asOf && d.date <= asOf) || settled.has(x.id))).forEach(d => {
        const b = bucketOf(x, S.pol), k = b === 'none' ? 'free' : b; o[k] = round2(o[k] + d.h); o.pre = round2(o.pre + d.h); dset.add(d.date);
      }));
      o.days = dset.size;
      return o;
    }
    // no HR record: what was asked, by kind of balance
    const o = { name: staffName(r.sid) + ' (no HR record)', vac: 0, sick: 0, free: 0, unpaid: 0, days: 0 };
    rs.forEach(x => reqDays(x, S.closed, S.pol).filter(d => d.date >= from && d.date <= to).forEach(d => { const b = bucketOf(x, S.pol); o[b === 'none' ? 'free' : b] = round2((o[b === 'none' ? 'free' : b] || 0) + d.h); o.days++; }));
    return o;
  }).filter(Boolean);
}
CHG.payF = () => { S.tab.payF = { from: $('#pfFrom').value, to: $('#pfTo').value }; renderView(); };
function payText(sep) {
  const f = S.tab.payF || { from: todayISO().slice(0, 8) + '01', to: lastOfMonth(todayISO()) }, rows = payrollRows(f.from, f.to);
  const head = ['Person', 'Vacation hours', 'Sick hours', 'Paid (no balance) hours', 'Unpaid hours', 'Days'], q = sep === ',' ? csvCell : (v => String(v));
  return ['Time off ' + f.from + ' to ' + f.to].concat([head.map(q).join(sep)]).concat(rows.map(x => [x.name, hrs(x.vac), hrs(x.sick), hrs(x.free), hrs(x.unpaid), x.days].map(q).join(sep))).join('\n');
}
Object.assign(ACT, {
  payCSV() { if (DEMO_ONLY) { toast('In the app this downloads time-off-payroll.csv (this demo page can’t save files).'); return; } const blob = new Blob([payText(',')], { type: 'text/csv' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'time-off-payroll.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); },
  payCopy() { copyText(payText('\t')).then(ok => toast(ok ? 'Copied — paste it into a spreadsheet' : 'Couldn’t copy', ok ? {} : { bad: true })); }
});
function yearEndHTML() {
  const t = todayISO(), y = Number(S.tab.yeY || (t.slice(5) >= '06-01' ? t.slice(0, 4) : Number(t.slice(0, 4)) - 1));
  const everyone = activeStaff().concat(S.roster.filter(r => !r.active));
  const rows = everyone.map(r => {
    const p = personOf(r.sid); if (!p || (isISO(p.left) && p.left < y + '-12-31')) return null;
    const L = ledger(p, reqsOf(r.sid), S.pol, S.closed, (y + 1) + '-01-01'), po = L.payouts.find(x => x.year === y);
    return po ? { name: staffName(r.sid), po } : null;
  }).filter(Boolean);
  const gone = everyone.map(r => { const p = personOf(r.sid); if (!p || !isISO(p.left) || p.left.slice(0, 4) !== String(y) || p.left >= y + '-12-31' || typeOn(p, p.left) === 'SAL') return null; const L = ledger(p, reqsOf(r.sid), S.pol, S.closed, p.left); return { name: staffName(r.sid), left: p.left, vac: L.vac, sick: L.sick }; }).filter(Boolean);
  const goneHTML = gone.length ? '<div class="subH" style="margin-top:18px">Left during ' + y + '</div><p class="small muted" style="margin:-4px 0 8px">Their balance on their last day — for their last paycheck, not the year-end list.</p><div class="tblWrap"><table class="tbl"><thead><tr><th>Person</th><th>Last day</th><th class="num">Vacation</th><th class="num">Sick</th></tr></thead><tbody>' +
    gone.map(x => '<tr><td>' + esc(x.name) + '</td><td>' + esc(fmtDate(x.left)) + '</td><td class="num">' + hrs(x.vac) + '</td><td class="num">' + hrs(x.sick) + '</td></tr>').join('') + '</tbody></table></div>' : '';
  const done = (y + '-12-31') < t;
  let h = '<div class="card"><div class="cardHd"><h3>' + y + ' year end</h3><span class="sub">' + (done ? 'What was left on Dec 31' : 'If nothing changes, what will be left on Dec 31') + '</span><span style="flex:1"></span>' +
    '<select class="inp" style="max-width:120px" data-chg="yeY">' + [Number(t.slice(0, 4)) + 1, Number(t.slice(0, 4)), Number(t.slice(0, 4)) - 1].map(x => '<option' + (x === y ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div><div class="cardBd">';
  if (!rows.length) return h + '<div class="empty">Nothing to pay out.</div>' + goneHTML + '</div></div>';
  h += '<div class="tblWrap"><table class="tbl"><thead><tr><th>Person</th><th class="num">Vacation to pay</th><th class="num">Sick to pay</th><th class="num hideM">Not carried over</th></tr></thead><tbody>' +
    rows.map(x => '<tr><td>' + esc(x.name) + '</td><td class="num">' + hrs(x.po.vac) + '</td><td class="num">' + hrs(x.po.sick) + '</td><td class="num hideM">' + hrs(x.po.lostVac + x.po.lostSick) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="small muted" style="margin-top:8px">' + esc(S.pol.yearEnd.vac === 'payout' && S.pol.yearEnd.sick === 'payout' ? 'Vacation and sick leave left on December 31 are paid out by the last payroll of the year (Settings → Policy).' : 'Settings → Policy says what happens to each balance at year end.') + '</p>' + goneHTML;
  return h + '</div></div>';
}
CHG.yeY = t => { S.tab.yeY = t.value; renderView(); };
