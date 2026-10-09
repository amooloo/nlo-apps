/* =====================================================================
   Moving from the old Time-Off app (Dr. A, once, at the switch-over).
   The old Google Sheet, downloaded as an Excel file (or its tabs as CSV
   files), is read on this computer. Each person's hire date, balances
   and requests come over; the Password and Passcode columns are never
   read. Nothing in the old Sheet changes.

   Before anything is saved, each person's balance is checked against
   the handbook (the old 6 AM script counted Fridays, holidays and partial
   days as full days, moved people up a tier at 1 and 3 years instead of
   2 and 5, and gave part-time staff paid time off), and Dr. A picks the
   numbers each person starts from: the old app's (the default — no
   balance changes without his say), the handbook's, or his own.
   ===================================================================== */

/* ---------- reading the tabs ---------- */
function tabOf(tabs, name) { const k = Array.from(tabs.keys()).find(n => String(n).trim().toLowerCase() === name.toLowerCase()); return k == null ? null : tabs.get(k); }
function normHead(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, ''); }
/* column numbers by heading; a heading with "pass" in it (Password, Passcode) is never mapped, so it's never read */
function headMap(row, spec) {
  const m = {};
  (row || []).forEach((v, c) => { const n = normHead(v); if (!n || /pass/.test(n)) return; const hit = spec.find(([k, re]) => m[k] == null && re.test(n)); if (hit) m[hit[0]] = c; });
  return m;
}
const OLD_EMP_HEAD = [['name', /^(name|employee|employeename|staff|staffname|fullname)$/], ['role', /^role$/], ['title', /^(title|jobtitle|position)$/],
  ['type', /^(employmenttype|emptype|employment|type|fulltimeparttime)$/], ['hire', /^(hiredate|hire|datehired|hired)$/], ['orient', /orient/], ['sick', /sick/], ['vac', /^vac/],
  ['last', /lastaccrual/], ['notes', /^notes?$/], ['moved', /moved/]];
const OLD_REQ_HEAD = [['id', /^(id|requestid)$/], ['ts', /^(timestamp|submitted|submittedat|created|createdat)$/], ['name', /^(employeename|employee|name|staff)$/], ['start', /^start/], ['end', /^end/],
  ['type', /^(requesttype|type|kind)$/], ['paid', /^(paidunpaid|paid|paidtype|paidorunpaid)$/], ['hours', /^(hours|howmuch|duration)$/], ['cover', /cover/], ['notes', /^notes?$/],
  ['status', /^status$/], ['rby', /reviewedby|approvedby/], ['rat', /reviewedat|approvedat/], ['ded', /deducted/]];
function cellStr(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function cellText(v, max) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max || 1000); }
function normName(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^dr\.?\s+/, '').replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim(); }

/* BenefitsEmployees (and FormerStaff, the same columns plus the day they were moved there) */
function oldPeople(grid, d1904, former) {
  const out = []; if (!grid || !grid.length) return out;
  const m = headMap(grid[0], OLD_EMP_HEAD);
  if (m.name == null || m.sick == null || m.vac == null) throw errCode('bad-file', 'The ' + (former ? 'FormerStaff' : 'BenefitsEmployees') + ' tab’s first row should name its columns (Name, … HireDate, … Sick, Vacation).');
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || [], g = k => m[k] == null ? null : row[m[k]];
    const name = cellStr(g('name'), 80); if (!name) continue;
    out.push({ name, role: cellStr(g('role'), 20).toLowerCase(), title: cellStr(g('title'), 60), type: /part/i.test(cellStr(g('type'))) ? 'PT' : 'FT',
      hire: toISODate(g('hire'), d1904), orient: toISODate(g('orient'), d1904), sick: round2(toNum(g('sick')) || 0), vac: round2(toNum(g('vac')) || 0),
      last: toISODate(g('last'), d1904), notes: cellText(g('notes'), 600), former: !!former, moved: former ? toISODate(g('moved'), d1904) : '' });
  }
  return out;
}
function oldStatus(s) { return ({ pending: 'pending', approved: 'approved', denied: 'denied', rejected: 'denied', cancelled: 'cancelled', canceled: 'cancelled', withdrawn: 'cancelled', archived: 'archived' })[cellStr(s).toLowerCase()] || ''; }
/* Requests: ID, Timestamp, Employee Name, Start, End, Request Type, Paid/Unpaid, Hours, Coverage, Notes, Status, Reviewed By, Reviewed At, DeductedOn */
function oldRequests(grid, d1904) {
  const rows = [], bad = [], seen = new Map(); if (!grid || !grid.length) return { rows, bad };
  const m = headMap(grid[0], OLD_REQ_HEAD);
  if (m.name == null || m.start == null || m.status == null) throw errCode('bad-file', 'The Requests tab’s first row should name its columns (ID, Timestamp, Employee Name, Start Date, … Status).');
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || [], g = k => m[k] == null ? null : row[m[k]];
    const name = cellStr(g('name'), 80), start = toISODate(g('start'), d1904), end = toISODate(g('end'), d1904) || start, status = oldStatus(g('status'));
    if (!name && !start && !cellStr(g('status'))) continue; // an empty row
    // its id in the old app, or one made from what it says; a second row with the same one (the same request entered twice,
    // or two alike) gets its own, so each row moves once
    const base = cellStr(g('id'), 40) || ('x-' + normName(name).replace(/ /g, '.') + '-' + start + '-' + end + '-' + normHead(g('type'))).slice(0, 120);
    const nth = (seen.get(base) || 0) + 1; seen.set(base, nth);
    const lid = nth > 1 ? base + '~' + nth : base;
    if (!name || !start || !status || end < start || daysBetween(start, end) > 366) {
      bad.push({ row: r + 1, lid, name, why: !name ? 'no name' : !start ? 'no start date' : !status ? 'its status is “' + cellStr(g('status'), 20) + '”' : 'its dates' }); continue;
    }
    const hoursStr = cellStr(g('hours'), 40), ded = cellStr(g('ded'), 40);
    rows.push({ lid, row: r + 1, name, start, end, ts: toWhenMs(g('ts'), d1904), type: legacyType(g('type')), typeRaw: cellStr(g('type'), 40), paid: legacyPaid(g('paid')),
      part: legacyPart(hoursStr), hoursStr, cover: cellStr(g('cover'), 200), note: cellText(g('notes'), 1000), status, rby: cellStr(g('rby'), 80), rat: toWhenMs(g('rat'), d1904),
      ded: ded ? (toISODate(g('ded'), d1904) || start) : '' });
  }
  return { rows, bad };
}
/* BalanceLog. The 6 AM script's rows: Timestamp, Employee, "Vacation"/"Sick Leave", Amount, New balance, Reason, By.
   The Benefits page's hand adjustments: Timestamp, Employee, "vacation"/"sick"/"personal", Amount, Reason, By. */
function oldLog(grid, d1904) {
  const out = []; if (!grid) return out;
  for (const row of grid) {
    if (!row) continue;
    const date = toISODate(row[0], d1904); if (!date) continue; // the heading row, blank rows
    const name = cellStr(row[1], 80), typ = cellStr(row[2], 30), h = toNum(row[3]); if (!name || h == null) continue;
    if (typ === 'vacation' || typ === 'sick' || typ === 'personal') { out.push({ date, name, b: typ === 'vacation' ? 'vac' : typ === 'sick' ? 'sick' : 'personal', h: round2(h), kind: 'manual', reason: cellStr(row[4], 200), by: cellStr(row[5], 80) }); continue; }
    const b = /^vacation$/i.test(typ) ? 'vac' : /^sick/i.test(typ) ? 'sick' : ''; if (!b) continue;
    const reason = cellStr(row[5], 200);
    const nb = toNum(row[4]);
    out.push({ date, name, b, h: round2(h), nb: nb == null ? null : round2(nb), kind: /monthly accrual/i.test(reason) ? 'accrue' : /approved time.?off/i.test(reason) ? 'take' : /annual reset/i.test(reason) ? 'reset' : 'other', reason, by: cellStr(row[6], 80) });
  }
  return out;
}
function oldClosures(grid, d1904) {
  const out = []; if (!grid) return out;
  for (const row of grid) { const date = row && toISODate(row[0], d1904); if (date && !out.some(c => c.date === date)) out.push({ date, label: cellStr(row[1], 60) || 'Office closed' }); }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}
function oldBlackouts(grid, d1904) {
  const out = []; if (!grid) return out;
  for (const row of grid) { const from = row && toISODate(row[0], d1904); if (!from) continue; const to = toISODate(row[1], d1904) || from; if (to >= from) out.push({ from, to, label: cellStr(row[2], 60) || 'Blackout' }); }
  return out;
}
/* the old app's two (all of January, Thanksgiving week) are this app's every-year ones already */
function usualBlackout(b) {
  const y = Number(b.from.slice(0, 4)), t = thanksgiving(y);
  return (b.from === y + '-01-01' && b.to === y + '-01-31') || (b.from === addDays(t, -3) && b.to === addDays(t, 3));
}
function parseOldSheet(x) {
  const T = n => tabOf(x.tabs, n), d = x.date1904;
  const emps = T('BenefitsEmployees'), reqT = T('Requests');
  if (!emps && !reqT) throw errCode('bad-file', 'This doesn’t look like the old Time-Off Sheet: it has no Requests or BenefitsEmployees tab.');
  const people = [], seen = new Set(), add = p => { const k = normName(p.name); if (!seen.has(k)) { seen.add(k); people.push(p); } };
  oldPeople(emps, d, false).concat(oldPeople(T('FormerStaff'), d, true)).forEach(add);
  const rq = oldRequests(reqT, d);
  // names on requests with no row of their own (people who left before the FormerStaff tab)
  rq.rows.forEach(r => add({ name: r.name, noRow: true, type: 'FT', hire: '', orient: '', vac: 0, sick: 0, title: '', notes: '', role: '', former: true, moved: '' }));
  const log = oldLog(T('BalanceLog'), d), byName = new Map(), logByName = new Map(), put = (m, k, x) => { const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); };
  rq.rows.forEach(r => put(byName, normName(r.name), r)); log.forEach(l => put(logByName, normName(l.name), l));
  return { people, reqs: rq.rows, bad: rq.bad, log, byName, logByName, closures: oldClosures(T('Holidays'), d), blackouts: oldBlackouts(T('Blackouts'), d),
    have: { emps: !!emps, reqs: !!reqT, log: !!T('BalanceLog'), former: !!T('FormerStaff'), holidays: !!T('Holidays'), blackouts: !!T('Blackouts') } };
}
/* the person in NLO Cases' team an old name is: whole name, first + last, first name + last initial, last name, username — when only one fits */
function matchSid(name, roster) {
  const n = normName(name), w = n.split(' ').filter(Boolean); if (!w.length) return '';
  const R = roster.map(r => ({ sid: r.sid, w: normName(r.name).split(' ').filter(Boolean), u: String(r.username || '').toLowerCase() })).filter(r => r.w.length);
  const one = list => list.length === 1 ? list[0].sid : '', last = a => a[a.length - 1];
  return one(R.filter(r => r.w.join(' ') === n))
    || (w.length > 1 ? one(R.filter(r => r.w.length > 1 && r.w[0] === w[0] && last(r.w) === last(w))) : '')
    || one(R.filter(r => r.w[0] === w[0] && (w.length < 2 || r.w.length < 2 || last(r.w)[0] === last(w)[0])))
    || (w.length > 1 ? one(R.filter(r => last(r.w) === last(w))) : '')
    || (R.filter(r => r.w[0] === w[0]).length < 2 ? one(R.filter(r => r.u && r.u === slug(w[0]))) : '');
}

/* what the old app's log says happened to one balance this year, row by row (rows in the order they were written). The 6 AM
   script's rows carry the new balance, so what it really added or took is the change in balance (it never went below 0, though
   the row says the whole amount); where a row shows the balance just before it and that differs from where the log had got to,
   the difference was typed into the Sheet by hand. → { acc, took, man, other, hand, end } */
function oldReplay(rows, b) {
  let prev = 0; const r = { acc: 0, took: 0, man: 0, other: 0, hand: 0 };
  for (const l of rows) {
    if (l.b !== b) continue;
    if (l.kind === 'reset') { prev = l.nb != null ? l.nb : 0; continue; }
    if (l.kind === 'manual') { r.man += l.h; prev += l.h; continue; }
    if (l.nb == null) { if (l.kind === 'accrue') r.acc += l.h; else if (l.kind === 'take') r.took -= l.h; else r.other += l.h; prev += l.h; continue; }
    const before = l.kind === 'accrue' || (l.kind === 'take' && l.nb > 0) ? l.nb - l.h : null;
    if (before != null && Math.abs(before - prev) >= 0.005) { r.hand += before - prev; prev = before; }
    const delta = l.nb - prev;
    if (l.kind === 'accrue') r.acc += delta; else if (l.kind === 'take') r.took -= delta; else r.other += delta;
    prev = l.nb;
  }
  Object.keys(r).forEach(k => { r[k] = round2(r[k]); }); r.end = round2(prev);
  return r;
}

/* =====================================================================
   The check: a person's balance as the handbook gives it — from 0 on
   January 1 (the old app set everyone to 0 that day), their approved
   time off counted the handbook's way, and the old app's hand
   adjustments — through the end of `asOf`; and line by line, why it
   differs from the old app's.
   ===================================================================== */
function auditOld(p, reqs, log, pol, closed, asOf) {
  const y = asOf.slice(0, 4), jan1 = y + '-01-01', start = isISO(p.hire) && p.hire > jan1 ? addDays(p.hire, -1) : addDays(jan1, -1);
  const key = normName(p.name), mine = log.filter(l => normName(l.name) === key && l.date >= jan1 && l.date <= asOf);
  const manual = mine.filter(l => l.kind === 'manual' && (l.b === 'vac' || l.b === 'sick'));
  const person = { hire: p.hire, orient: p.orient, type: p.type, left: p.former && isISO(p.moved) ? p.moved : '', open: { asOf: start, vac: 0, sick: 0 }, adj: manual.map((l, i) => ({ id: 'm' + i, date: l.date, b: l.b, h: l.h, note: l.reason })) };
  const appr = reqs.filter(r => normName(r.name) === key && r.status === 'approved' && r.end >= jan1 && r.start <= asOf);
  const L = ledger(person, appr.map(r => ({ id: r.lid + '#' + r.row, status: 'approved', type: r.type, paid: r.paid, start: r.start, end: r.end, part: r.part })), pol, closed, asOf);
  const sum = (a, f) => round2(a.reduce((s, x) => s + f(x), 0)), oe = orientEnd(person, pol);
  const out = { hand: { vac: L.vac, sick: L.sick }, old: { vac: p.vac, sick: p.sick }, lines: [], notes: [], hasLog: mine.length > 0 };
  ['vac', 'sick'].forEach(b => {
    const word = b === 'vac' ? 'vacation' : 'sick leave';
    const R = oldReplay(mine, b), oldAcc = R.acc, oldTook = R.took, other = R.other;
    const newAcc = sum(L.entries.filter(e => e.k === 'accrue'), e => b === 'vac' ? e.addVac : e.addSick), newTook = sum(L.entries.filter(e => e.k === 'take' && e.b === b), e => e.paid);
    const unpaid = sum(L.entries.filter(e => e.k === 'take' && e.b === b), e => e.unpaid);
    const mineReqs = appr.filter(r => bucketOf(r, pol) === b);
    // time off that has started but runs on past asOf: the old app took all of it up front; here it comes off day by day
    const future = sum(mineReqs.filter(r => r.ded), r => (L.byReq[r.lid + '#' + r.row] || {}).future || 0);
    const drift = round2(R.hand + p[b] - R.end); // typed into the Sheet by hand (not in its log)
    const add = (d, title, why) => { if (Math.abs(d) >= 0.01) out.lines.push({ b, d: round2(d), title, why: why || '' }); };
    // earned
    const why = [];
    if (p.type === 'PT' && !pol.ptAccrues && oldAcc > 0) why.push('part-time staff earn no paid vacation or sick leave under the handbook');
    if (b === 'vac' && isISO(p.hire)) {
      const hi = mine.filter(l => l.kind === 'accrue' && l.b === 'vac' && l.h > 0 && oldScriptTier(yearsOfService(p.hire, l.date)) > tierAt(pol, p.hire, l.date).n);
      if (hi.length && !(p.type === 'PT' && !pol.ptAccrues)) why.push(plural(hi.length, 'month') + ' at a higher tier than the handbook’s (the old app moves people up at 1 and 3 years; the handbook at 2 and 5)');
    }
    const early = oe ? mine.filter(l => l.kind === 'accrue' && l.b === b && l.h > 0 && l.date < oe).length : 0;
    if (early && !(p.type === 'PT' && !pol.ptAccrues)) why.push(plural(early, 'month') + ' added during orientation (it ends ' + fmtDate(oe) + ')');
    const nOld = mine.filter(l => l.kind === 'accrue' && l.b === b).length, nNew = L.entries.filter(e => e.k === 'accrue').length;
    if (nNew > nOld) why.push('the old app missed ' + plural(nNew - nOld, 'month-end'));
    add(newAcc - oldAcc, 'Earned since Jan 1: the old app added ' + hrs(oldAcc) + ' h, the handbook gives ' + hrs(newAcc) + ' h', why.join('; '));
    // taken
    const why2 = [];
    const off = mineReqs.filter(r => r.ded && r.paid && oldScriptHours(r.start, r.end, r.hoursStr) !== reqHours(r, closed, pol));
    if (off.length) why2.push(plural(off.length, 'request') + ' counted differently — Fridays and closed days don’t count, and a morning, afternoon or 2, 4 or 6 hours isn’t a full day');
    const missed = mineReqs.filter(r => !r.ded && r.paid);
    if (missed.length) why2.push('approved but never taken off by the old app: ' + missed.slice(0, 4).map(r => fmtRange(r.start, r.end)).join(', ') + (missed.length > 4 ? ' and ' + (missed.length - 4) + ' more' : ''));
    if (unpaid > 0) out.notes.push(hrs(unpaid) + ' h of ' + firstName(p.name) + '’s ' + (b === 'vac' ? 'paid time off from vacation' : 'sick leave') + ' since Jan 1 was more than the balance at the time — the handbook makes that part unpaid; the old app just took the balance to 0.');
    add(oldTook - newTook - future, 'Taken off since Jan 1: the old app took ' + hrs(oldTook) + ' h, the handbook count is ' + hrs(round2(newTook + future)) + ' h', why2.join('; '));
    add(future, 'Still to come: ' + hrs(future) + ' h of ' + word + ' after ' + fmtDate(asOf), 'time off that has started runs past this day — the old app took all of it up front, the new app takes it day by day');
    add(-other, 'Other changes in the old app’s log', '');
    add(-drift, (drift > 0 ? 'More' : 'Less') + ' in the Sheet than its own log adds up to', 'a balance typed into the Sheet by hand, or one carried over from last year');
    const rest = round2((L[b] - p[b]) - out.lines.filter(l => l.b === b).reduce((s, l) => s + l.d, 0));
    add(rest, 'Other small differences', 'a hand adjustment that would have taken the balance below 0');
  });
  return out;
}

/* =====================================================================
   The screen
   ===================================================================== */
function impBlank() { return { st: 'pick', asOf: todayISO(), err: '', data: null, ids: new Map(), rows: [], clos: [], blk: [], prog: null, result: null, files: [] }; }
function viewImport() {
  if (!S.imp) S.imp = impBlank();
  const I = S.imp;
  let h = '<div class="btnRow" style="margin:-4px 0 14px"><button class="btn btn-ghost" data-act="nav" data-v="settings">' + ic('prev', 15) + 'Settings</button></div>';
  if (I.st === 'done') return h + importDoneHTML();
  h += '<div class="card" style="max-width:900px"><div class="cardHd"><h3>Move from the old Time-Off app</h3></div><div class="cardBd">' +
    '<ol class="steps small"><li>Open the old Time-Off <b>Google Sheet</b> → <b>File</b> → <b>Download</b> → <b>Microsoft Excel (.xlsx)</b>. (Or download its tabs one at a time as CSV.)</li>' +
    '<li>Drop the file below. It’s read on this computer — the Password and Passcode columns are skipped and never read.</li>' +
    '<li>Check each person, pick which balance they start from, and press <b>Move</b>. Nothing in the old Sheet changes.</li></ol>' +
    '<div class="dropZone" id="imDrop" tabindex="0" role="button" aria-label="Choose the downloaded file">' + ic('import', 26) + '<b>' + (I.files.length ? esc(I.files.join(', ')) : 'Drop the downloaded file here') + '</b><span class="small">' + (I.files.length ? 'Drop another to start over' : 'or click to choose it') + '</span></div>' +
    '<input type="file" id="imFile" accept=".xlsx,.csv,.tsv,.txt" multiple class="hidden">' +
    (S.demo ? '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="imDemo">' + ic('note', 15) + 'Demo: try it with a made-up Sheet</button></div>' : '') +
    (I.st === 'reading' ? '<div class="small muted" style="margin-top:10px">Reading…</div>' : '') +
    (I.err ? '<div class="lockErr" style="margin-top:12px">' + esc(I.err) + '</div>' : '') + '</div></div>';
  if (I.st !== 'ready' && I.st !== 'moving') return h;
  if (I.shAt !== SH.at && I.st === 'ready') impAudit(); // Staff Hub read again since (e.g. from Settings)
  const D = I.data, rows = I.rows, go = rows.filter(r => r.sid && !r.off), reqN = impReqCount(go);
  h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>What’s in it</h3></div><div class="cardBd">' +
    '<div class="prevGrid"><div><div class="n">' + rows.filter(r => !r.p.noRow).length + '</div><div class="l">people</div></div><div><div class="n">' + D.reqs.length + '</div><div class="l">requests</div></div>' +
    '<div><div class="n">' + D.closures.length + '</div><div class="l">office closures</div></div><div><div class="n">' + D.log.length + '</div><div class="l">balance log lines</div></div></div>' +
    '<div class="field" style="max-width:340px"><label for="imAsOf">Balances in the file are as of the end of</label><input type="date" id="imAsOf" data-chg="imAsOf" value="' + esc(I.asOf) + '" max="' + todayISO() + '">' +
    '<div class="hint">The day you downloaded it (after the old app’s 6 AM update). From the next day on, the new app keeps the balances.</div></div>' +
    (D.log.some(l => l.date > I.asOf) ? '<div class="notice bad">The balance log has lines after ' + esc(fmtDate(I.asOf)) + ' — set the day the file was downloaded.</div>' : '') +
    (!D.have.log ? '<div class="notice">There’s no BalanceLog tab, so the check below can’t say why balances differ — only by how much.</div>' : '') +
    (D.bad.length ? '<details class="help"><summary>' + plural(D.bad.length, 'request row') + ' can’t be read and won’t move</summary><ul class="helpList small">' + D.bad.slice(0, 30).map(b => '<li>Row ' + b.row + (b.name ? ' (' + esc(b.name) + ')' : '') + ': ' + esc(b.why) + '</li>').join('') + '</ul></details>' : '') +
    '</div></div>';
  h += '<div class="subH" style="margin-top:20px">People</div><p class="small muted" style="margin:-4px 0 12px">Each person is matched to their NLO Cases login. The balance they start from is the old app’s unless you pick another — the check shows where the old app and the handbook disagree.' +
    (I.shOn ? ' Hire dates, full- or part-time and last days are Staff Hub’s for everyone it has; where the Sheet says something else, it’s shown. <button class="linkBtn" data-act="shRefresh">Read Staff Hub again</button>' : '') + '</p>';
  if (!I.shOn && shAvailable()) h += SH.user === null ? '<div class="notice info">Staff Hub isn’t connected on this computer, so the move would use the Sheet’s hire dates and full- or part-time. <button class="linkBtn" data-act="shConnect">Connect to the office roster</button> to use Staff Hub’s.</div>'
    : SH.err ? '<div class="notice">Staff Hub: ' + esc(SH.err) + ' Until it can be read, the move would use the Sheet’s hire dates. <button class="linkBtn" data-act="shRefresh">Try again</button></div>'
    : '<div class="notice info">Reading Staff Hub’s roster…</div>';
  h += rows.map((r, i) => impPersonHTML(r, i)).join('');
  if (I.clos.length || I.blk.length) {
    h += '<div class="card" style="margin-top:6px"><div class="cardHd"><h3>Office closures and blackouts</h3></div><div class="cardBd">' +
      (I.clos.length ? '<div class="flabel">Days the office was or will be closed (besides the handbook’s holidays)</div><div class="chkList">' + I.clos.map((c, i) => '<label><input type="checkbox" data-chg="imClos" data-i="' + i + '"' + (c.on ? ' checked' : '') + (c.have ? ' disabled' : '') + '><span>' + esc(fmtDayY(c.date)) + ' — ' + esc(c.label) + (c.have ? ' <span class="muted">(already here)</span>' : '') + '</span></label>').join('') + '</div>' : '') +
      (I.blk.length ? '<div class="flabel" style="margin-top:12px">Blackouts</div><div class="chkList">' + I.blk.map((b, i) => '<label><input type="checkbox" data-chg="imBlk" data-i="' + i + '"' + (b.on ? ' checked' : '') + (b.usual ? ' disabled' : '') + '><span>' + esc(b.label) + ' · ' + esc(fmtDate(b.from) + (b.to !== b.from ? ' – ' + fmtDate(b.to) : '')) + (b.usual ? ' <span class="muted">(every year here already)</span>' : '') + '</span></label>').join('') + '</div>' : '') +
      '</div></div>';
  }
  const busy = I.st === 'moving';
  h += '<div class="card" style="margin-top:18px"><div class="cardBd" style="padding-top:16px">' +
    (busy ? '<div class="small" id="imMsg">' + esc(I.prog ? I.prog.msg : 'Moving…') + '</div><div class="prog"><i id="imBar" style="width:' + (I.prog ? I.prog.pct : 2) + '%"></i></div><p class="small muted">Keep this page open until it finishes.</p>'
      : '<div class="btnRow" style="margin-top:0"><button class="btn btn-pri" data-act="imMove"' + (go.length ? '' : ' disabled') + '>' + ic('import', 16) + 'Move ' + plural(go.filter(r => !r.p.noRow && (!S.hrRecs.has(r.sid) || r.replace)).length, 'person', 'people') + ' and ' + plural(reqN, 'request') + '</button>' +
        '<button class="btn btn-ghost" data-act="imReset">Start over</button></div><p class="small muted" style="margin-top:8px">People who already have a record here are skipped unless you tick Replace; requests already moved aren’t moved again. The front desk gets no emails for moved requests.</p>') +
    '</div></div>';
  return h;
}
/* the old requests already moved: a moved request's id is the same every time (B.importReqId), so one that's here is
   never made again — never what a request says */
function impDone() { const ids = S.imp && S.imp.ids ? S.imp.ids : new Map(), out = new Set(); ids.forEach((id, lid) => { if (S.reqs.has(id)) out.add(lid); }); return out; }
function impReqCount(go) {
  const D = S.imp.data, done = impDone();
  return go.reduce((s, r) => s + (D.byName.get(normName(r.p.name)) || []).filter(q => !done.has(q.lid)).length, 0);
}
function impPersonHTML(r, i) {
  const p = r.p, a = r.audit, I = S.imp, has = r.sid && S.hrRecs.has(r.sid), skip = !r.sid || r.off || (has && !r.replace);
  const reqs = I.data.byName.get(normName(p.name)) || [], wait = reqs.filter(q => q.status === 'pending').length;
  const opts = '<option value="">Don’t move</option>' + S.roster.slice().sort((x, y) => (y.active ? 1 : 0) - (x.active ? 1 : 0) || String(x.name).localeCompare(String(y.name)))
    .map(x => '<option value="' + esc(x.sid) + '"' + (x.sid === r.sid ? ' selected' : '') + '>' + esc(staffName(x.sid)) + (x.active ? '' : ' (left)') + '</option>').join('');
  let flag = '';
  if (!p.noRow && a) {
    const dv = round2(a.hand.vac - a.old.vac), ds = round2(a.hand.sick - a.old.sick);
    flag = !dv && !ds ? '<span class="imFlag ok">' + ic('done', 13) + 'Matches the handbook</span>' : '<span class="imFlag' + (dv < 0 || ds < 0 ? ' bad' : '') + '">Handbook: ' + [dv ? (dv > 0 ? '+' : '−') + hrs(Math.abs(dv)) + ' h vacation' : '', ds ? (ds > 0 ? '+' : '−') + hrs(Math.abs(ds)) + ' h sick' : ''].filter(Boolean).join(', ') + '</span>';
  }
  // what the move uses: Staff Hub's start date, full-/part-time and last day where it has them, else the Sheet's
  const e = r.eff || p, shLeft = (r.diffs || []).some(d => d.k === 'left');
  let h = '<div class="imPerson' + (skip ? ' skip' : '') + '"><div class="imHd">' + (r.sid ? avatarHTML(r.sid) : '<span class="av none">–</span>') + '<div class="grow"><b>' + esc(p.name) + '</b>' +
    '<div class="small muted">' + esc([p.noRow ? 'Only on requests (no balance row)' : e.former ? 'Former staff' + (e.moved ? (shLeft ? ' · last day ' : ' · moved ') + fmtDate(e.moved) : '') : '', e.hire ? 'Hired ' + fmtDate(e.hire) : (p.noRow ? '' : 'No hire date in the Sheet'),
      p.noRow ? '' : empText({ type: e.type, emp: r.shf && r.shf.type === e.type ? r.shf.emp : '' }), p.title, plural(reqs.length, 'request') + (wait ? ' (' + wait + ' waiting)' : '')].filter(Boolean).join(' · ')) + '</div></div>' +
    flag + '<select class="inp" data-chg="imSid" data-i="' + i + '" aria-label="Who ' + esc(p.name) + ' is">' + opts + '</select></div>';
  // a different full-/part-time or last day changes what they earn from here on: worth a look (Staff Hub's Employment starts out as Full-time)
  if (!p.noRow && r.sid && I.shOn) h += r.shp ? (r.diffs.length ? '<div class="small imSh' + (r.diffs.some(d => d.k !== 'hire') ? ' warn' : '') + '">' + ic(r.diffs.some(d => d.k !== 'hire') ? 'warn' : 'info', 13) + '<span>Staff Hub: ' + esc(r.diffs.map(shDiffText).join('; ')) + ' — the move uses Staff Hub’s' + (r.diffs.some(d => d.k !== 'hire') ? '. If Staff Hub has it wrong, change it there, then press Read Staff Hub again (above).' : '.') + '</span></div>' : '')
    : '<div class="small muted imSh">Not linked to Staff Hub, so the Sheet’s hire date and full- or part-time are used (link them on Team to use Staff Hub’s).</div>';
  if (has) {
    const ex = S.hrRecs.get(r.sid), early = (ex.adj || []).filter(x => x.date <= I.asOf).length;
    h += '<label class="chk" style="margin-top:8px"><input type="checkbox" data-chg="imReplace" data-i="' + i + '"' + (r.replace ? ' checked' : '') + '> Already has a record here — replace it</label>' +
      (r.replace && early ? '<div class="small coral">' + plural(early, 'adjustment') + ' made here on or before ' + esc(fmtDate(I.asOf)) + ' won’t count after the opening balance is replaced.</div>' : '');
  }
  if (!p.noRow && a && !skip) {
    const pick = r.pick, nums = (k, l, v, s) => '<button type="button" class="imNum" data-act="imPick" data-i="' + i + '" data-k="' + k + '" aria-pressed="' + (pick === k) + '"><span class="k">' + l + '</span><span class="v">' + hrs(v) + ' h vacation · ' + hrs(s) + ' h sick</span></button>';
    h += '<div class="imNums">' + nums('old', 'The old app’s', a.old.vac, a.old.sick) + nums('hand', 'The handbook’s', a.hand.vac, a.hand.sick) +
      '<div class="imNum' + (pick === 'typed' ? ' on' : '') + '" role="group" aria-label="Your own numbers"><button type="button" class="linkBtn" style="text-align:left;text-decoration:none" data-act="imPick" data-i="' + i + '" data-k="typed" aria-pressed="' + (pick === 'typed') + '"><span class="k">Your own</span></button>' +
      '<div class="two"><input type="number" step="0.01" min="0" max="2000" inputmode="decimal" aria-label="Vacation hours" placeholder="Vacation" data-inp="imTyped" data-i="' + i + '" data-b="vac" value="' + esc(r.typed.vac) + '"><input type="number" step="0.01" min="0" max="2000" inputmode="decimal" aria-label="Sick hours" placeholder="Sick" data-inp="imTyped" data-i="' + i + '" data-b="sick" value="' + esc(r.typed.sick) + '"></div></div></div>';
    if (a.lines.length) h += '<details class="help"><summary>Why the old app and the handbook differ</summary><div class="imWhy">' + a.lines.map(l => '<div class="d"><b class="' + (l.d > 0 ? 'plus' : 'minus') + '">' + (l.d > 0 ? '+' : '−') + hrs(Math.abs(l.d)) + ' h</b><span><b style="min-width:0;text-align:left;color:var(--navy)">' + (l.b === 'vac' ? 'Vacation' : 'Sick') + ':</b> ' + esc(l.title) + (l.why ? ' <span class="muted">— ' + esc(l.why) + '</span>' : '') + '</span></div>').join('') + '</div>' +
      '<p class="small muted" style="margin-top:6px">+ means the handbook gives ' + esc(firstName(p.name)) + ' more than the old app; − less. Hours already used as paid time off aren’t taken back by the app — that’s a payroll decision.</p></details>';
    if (a.notes.length) h += '<ul class="helpList small" style="margin-top:6px">' + a.notes.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    if (p.type === 'PT' && !S.pol.ptAccrues) h += '<div class="small muted" style="margin-top:6px">Part-time: no more vacation or sick leave is earned from here on (Settings → Policy).</div>';
  }
  return h + '</div>';
}
function importDoneHTML() {
  const R = S.imp.result;
  return '<div class="card" style="max-width:720px"><div class="cardHd"><h3>Moved</h3></div><div class="cardBd">' +
    '<div class="prevGrid three"><div><div class="n">' + R.people + '</div><div class="l">people’s records</div></div><div><div class="n">' + R.reqs + '</div><div class="l">requests</div></div><div><div class="n">' + R.skipped + '</div><div class="l">skipped (already here)</div></div></div>' +
    (R.failed.length ? '<div class="notice bad">' + plural(R.failed.length, 'item') + ' couldn’t be saved: ' + esc(R.failed.slice(0, 6).join('; ')) + '. Run the move again to retry them — nothing is moved twice.</div>' : '') +
    '<ol class="steps small"><li>Look over <b>Team</b> — everyone’s balance and statement.</li><li>Turn on whoever else approves in <b>Settings → Who approves</b>.</li><li>Then retire the old app (Claude has the switch-over list).</li></ol>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="nav" data-v="team">' + ic('people', 15) + 'Open Team</button><button class="btn btn-ghost" data-act="imReset">Move another file</button></div></div></div>';
}
function paintImport() { if (S.view !== 'import') return; $('#view').innerHTML = viewImport(); paintPhotos($('#view')); afterImport(); }
function afterImport() {
  const z = $('#imDrop'), f = $('#imFile'); if (!z || !f) return;
  z.onclick = () => f.click();
  z.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.click(); } };
  z.ondragover = e => { e.preventDefault(); z.classList.add('over'); };
  z.ondragleave = () => z.classList.remove('over');
  z.ondrop = e => { e.preventDefault(); z.classList.remove('over'); if (e.dataTransfer.files.length) impRead(Array.from(e.dataTransfer.files)); };
  f.onchange = () => { if (f.files.length) impRead(Array.from(f.files)); };
}
async function impRead(files) {
  const I = S.imp = impBlank(); I.st = 'reading'; I.files = files.map(f => f.name); paintImport();
  try { await impLoad(await readOldSheet(files)); } catch (e) { I.st = 'pick'; I.err = errText(e); }
  paintImport();
}
/* the Sheet, read: who's who, what the check finds, and the id each request gets here */
async function impLoad(x) {
  const I = S.imp, D = parseOldSheet(x), ids = new Map();
  // Staff Hub's start dates, full-/part-time and last days take the Sheet's place (Amir, 9 Oct 2026): its roster, read now if
  // this computer is connected and it hasn't been yet
  if (shAvailable()) { try { if (SH.user === undefined) await shCheckUser(); if (SH.user && !SH.data) await shLoad(); } catch (e) { } }
  for (let i = 0; i < D.reqs.length; i += 200) {
    const part = D.reqs.slice(i, i + 200), got = await Promise.all(part.map(q => B.importReqId(q.lid)));
    part.forEach((q, k) => ids.set(q.lid, got[k]));
  }
  I.ids = ids; I.data = D; I.st = 'ready';
  const custom = S.closed.custom, fixed = new Set();
  D.closures.forEach(c => fixedHolidays(Number(c.date.slice(0, 4))).forEach(h => fixed.add(h.date)));
  I.clos = D.closures.filter(c => !fixed.has(c.date)).map(c => ({ date: c.date, label: c.label, have: custom.has(c.date), on: !custom.has(c.date) }));
  I.blk = D.blackouts.map(b => ({ from: b.from, to: b.to, label: b.label, usual: usualBlackout(b), on: !usualBlackout(b) && !S.blackouts.some(x => x.kind === 'dates' && x.from === b.from && x.to === b.to) }));
  const used = new Set();
  I.rows = D.people.map(p => { let sid = matchSid(p.name, S.roster); if (sid && used.has(sid)) sid = ''; if (sid) used.add(sid); return { p, sid, pick: 'old', typed: { vac: '', sick: '' }, replace: false, off: false, audit: null }; })
    .sort((a, b) => (!!a.p.noRow - !!b.p.noRow) || (!!a.p.former - !!b.p.former) || a.p.name.localeCompare(b.p.name));
  impAudit();
}
/* the check, for everyone, with the closures being brought over counted as closed too — and with Staff Hub's start date,
   full-/part-time and last day in place of the Sheet's for anyone it has (r.eff; r.diffs says where they differ) */
function impAudit() {
  const I = S.imp, D = I.data; if (!D) return;
  const closed = makeClosed(((S.settings.to || {}).closures || []).concat(I.clos.filter(c => c.on || c.have).map(c => ({ date: c.date, label: c.label }))));
  const links = SH.data && shAvailable() ? shLinks(S.roster, shPeopleOf(SH.data)) : null; I.shAt = SH.at; I.shOn = !!links;
  I.rows.forEach(r => {
    const k = normName(r.p.name), sp = links && r.sid ? links.get(r.sid) || null : null;
    r.shp = sp; r.shf = sp ? shFactsOf(r.sid, sp) : null; // a removed login: only Staff Hub's last day
    const o = shOverOld(r.p, r.p.noRow ? null : r.shf); r.eff = o.p; r.diffs = o.diffs;
    r.audit = r.p.noRow ? null : auditOld(r.eff, D.byName.get(k) || [], D.logByName.get(k) || [], S.pol, closed, I.asOf);
  });
}
Object.assign(CHG, {
  imAsOf(t) { if (!isISO(t.value) || t.value > todayISO()) return; S.imp.asOf = t.value; impAudit(); paintImport(); },
  imSid(t) {
    const I = S.imp, r = I.rows[Number(t.dataset.i)]; if (!r) return;
    const other = t.value && I.rows.find(x => x !== r && x.sid === t.value);
    if (other) { toast(staffName(t.value) + ' is already matched to “' + other.p.name + '” — that one is set to Don’t move.', { ms: 6000 }); other.sid = ''; }
    r.sid = t.value; impAudit(); paintImport(); // Staff Hub's dates are the new person's
  },
  imReplace(t) { const r = S.imp.rows[Number(t.dataset.i)]; if (r) { r.replace = t.checked; paintImport(); } },
  imTyped(t) { const r = S.imp.rows[Number(t.dataset.i)]; if (!r) return; r.typed[t.dataset.b] = t.value; if (r.pick !== 'typed') { r.pick = 'typed'; paintKeep(t); } },
  imClos(t) { const c = S.imp.clos[Number(t.dataset.i)]; if (c) { c.on = t.checked; impAudit(); paintImport(); } },
  imBlk(t) { const b = S.imp.blk[Number(t.dataset.i)]; if (b) b.on = t.checked; }
});
/* re-draw without losing the cursor in the box being typed in */
function paintKeep(t) { const i = t.dataset.i, b = t.dataset.b, pos = t.selectionStart; paintImport(); const el = $('input[data-inp="imTyped"][data-i="' + i + '"][data-b="' + b + '"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { } } }
Object.assign(ACT, {
  imPick(t) { const r = S.imp.rows[Number(t.dataset.i)]; if (!r) return; r.pick = t.dataset.k; if (r.pick === 'typed' && r.typed.vac === '' && r.typed.sick === '') r.typed = { vac: String(r.audit.old.vac), sick: String(r.audit.old.sick) }; paintImport(); },
  imReset() { S.imp = impBlank(); paintImport(); },
  async imDemo() { const I = S.imp = impBlank(); I.files = ['Made-up Time-Off Sheet (demo)']; try { await impLoad(demoOldSheet(todayISO())); } catch (e) { I.st = 'pick'; I.err = errText(e); } paintImport(); },
  async imMove() {
    const I = S.imp, go = I.rows.filter(r => r.sid && !r.off);
    for (const r of go) if (r.pick === 'typed' && !r.p.noRow) {
      const v = Number(r.typed.vac), s = Number(r.typed.sick);
      if (r.typed.vac === '' || r.typed.sick === '' || !(v >= 0 && v <= 2000) || !(s >= 0 && s <= 2000)) { toast('Type both of ' + firstName(r.p.name) + '’s numbers (0 or more), or pick another balance.', { bad: true }); return; }
    }
    const people = go.filter(r => !r.p.noRow && (!S.hrRecs.has(r.sid) || r.replace)).length, reqN = impReqCount(go);
    if (!(await confirmBox('Move ' + plural(people, 'person', 'people') + ' and ' + plural(reqN, 'request') + '?', 'Their records are sealed and saved here; the old Sheet isn’t changed. Requests come over with their status — waiting ones wait for approval here.', 'Move'))) return;
    I.st = 'moving'; I.prog = { msg: 'Starting…', pct: 2 }; paintImport();
    try { I.result = await impRun(go); I.st = 'done'; toast('Moved ' + plural(I.result.people, 'person', 'people') + ' and ' + plural(I.result.reqs, 'request')); }
    catch (e) { I.st = 'ready'; toast(errText(e), { bad: true }); }
    paintImport(); syncFeed(true).catch(() => { });
  }
});
function impProgress(n, tot, msg) {
  const I = S.imp; I.prog = { msg: msg + (tot ? ' ' + n + ' of ' + tot : ''), pct: Math.round(4 + 94 * (tot ? n / tot : 1)) };
  const b = $('#imBar'), m = $('#imMsg'); if (b) b.style.width = I.prog.pct + '%'; if (m) m.textContent = I.prog.msg;
}
/* the move itself: settings (closures, blackouts), then the requests, then each person's record. A balance carried over
   from the old app already has the time off it took off in it, so the record lists those requests (settled) and they
   aren't taken off again; with the handbook's balance (worked out through the move day) the days after it still come off. */
async function impRun(go) {
  const I = S.imp, D = I.data, T = I.asOf, me = meSid(), now = Date.now(), out = { people: 0, reqs: 0, skipped: 0, failed: [] };
  const to = S.settings.to || {};
  const clos = (to.closures || []).slice(); I.clos.filter(c => c.on && !c.have).forEach(c => { if (!clos.some(x => x.date === c.date)) clos.push({ date: c.date, label: c.label }); });
  const blk = (Array.isArray(to.blackouts) ? to.blackouts : BLACKOUTS).slice();
  I.blk.filter(b => b.on && !b.usual).forEach((b, k) => blk.push({ id: 'old' + k + '-' + b.from, label: b.label.slice(0, 60), kind: 'dates', from: b.from, to: b.to, types: ['vac', 'personal', 'other'] }));
  await B.saveSettings({ to: { closures: clos.sort((a, b) => a.date < b.date ? -1 : 1), blackouts: blk } });
  // requests, each once: a moved request's id is the same every time (B.importReqId), so one already here — moved by an
  // earlier run, even one that stopped half-way — is never made again
  const list = [], ids = new Set(S.reqs.keys()), here = new Set(), made = new Set();
  go.forEach(r => (D.byName.get(normName(r.p.name)) || []).forEach(q => { const id = I.ids.get(q.lid); if (id) list.push({ q, sid: r.sid, id }); }));
  // one already here counts as moved only if this import made it, for the same person (anyone else who once held the HR
  // key could work out these ids)
  const theirs = x => x.q.name + ' ' + fmtRange(x.q.start, x.q.end) + ' (something else is saved where it would go, so it wasn’t moved)';
  const seen = list.filter(x => ids.has(x.id));
  for (let i = 0; i < seen.length; i += 20) {
    impProgress(i, seen.length, 'Checking what’s already here…');
    const part = seen.slice(i, i + 20), ok = await Promise.all(part.map(x => B.importedHere(x.id, x.sid).catch(() => false)));
    part.forEach((x, k) => { if (ok[k]) here.add(x.id); else out.failed.push(theirs(x)); });
  }
  const todo = list.filter(x => !ids.has(x.id));
  for (let k = 0; k < todo.length; k++) {
    const { q, sid, id } = todo[k]; impProgress(k + 1, todo.length, 'Requests…');
    const rbySid = q.rby ? matchSid(q.rby, S.roster) : '';
    try {
      await B.saveReq(id, c => {
        const ev = [{ a: 'submit', by: sid, at: q.ts || dayStartMs(q.start) }];
        if (q.status === 'approved' || q.status === 'denied') ev.push({ a: q.status === 'approved' ? 'approve' : 'deny', by: rbySid || q.rby || 'old app', at: q.rat || q.ts || 0 });
        else if (q.status === 'cancelled') ev.push({ a: 'cancel', by: sid, at: q.rat || q.ts || 0 });
        else if (q.status === 'archived') ev.push({ a: 'takeback', by: rbySid || q.rby || 'old app', at: q.rat || q.ts || 0 });
        ev.push({ a: 'import', by: me, at: now });
        Object.assign(c, { type: q.type, paid: q.paid, start: q.start, end: q.end, part: q.part, cover: q.cover, note: q.note, at: q.ts || 0, events: ev,
          legacy: { id: q.lid, ded: q.ded || '', took: q.ded ? oldScriptHours(q.start, q.end, q.hoursStr) : null, by: q.rby || '', type: q.typeRaw, hours: q.hoursStr } });
        if (q.status === 'approved' || q.status === 'denied') c.decision = { s: q.status, by: rbySid || q.rby || '', at: q.rat || 0, note: '' };
        return { status: q.status };
      }, { create: { sid }, fresh: true, a: 'import' });
      out.reqs++; made.add(id);
    } catch (e) {
      if (e.code !== 'exists') out.failed.push(q.name + ' ' + fmtRange(q.start, q.end) + ' (' + errText(e) + ')');
      else if (await B.importedHere(id, sid).catch(() => false)) here.add(id); else out.failed.push(theirs(todo[k]));
    }
  }
  // what the old app took off, per person: each old request it took off that's here now (moved by this run or an earlier
  // one) — from the Sheet and these ids, never from what a request says
  const took = new Map();
  list.forEach(x => { if (x.q.ded && (made.has(x.id) || here.has(x.id))) { if (!took.has(x.sid)) took.set(x.sid, []); took.get(x.sid).push(x.id); } });
  // each person's record
  const ppl = go.filter(r => !r.p.noRow);
  for (let k = 0; k < ppl.length; k++) {
    const r = ppl[k], p = r.p, a = r.audit, ex = S.hrRecs.get(r.sid); impProgress(k + 1, ppl.length, 'People’s records…');
    const ded = took.get(r.sid) || [], exDed = ex && Array.isArray(ex.oldDed) ? ex.oldDed : [], oldDed = Array.from(new Set(exDed.concat(ded)));
    try {
      if (ex && !r.replace) {
        // kept as it is; if its balance came from the old app, the moved requests that it took off are part of it
        out.skipped++;
        const pick = ex.open && ex.open.from ? ex.open.from.pick : '', carried = pick === 'old' || pick === 'typed';
        const exSet = new Set(Array.isArray(ex.settled) ? ex.settled : []);
        if (ded.some(id => !exDed.includes(id)) || (carried && ded.some(id => !exSet.has(id))))
          await B.putHR(r.sid, d => {
            d.oldDed = Array.from(new Set((Array.isArray(d.oldDed) ? d.oldDed : []).concat(ded)));
            if (carried) d.settled = Array.from(new Set((Array.isArray(d.settled) ? d.settled : []).concat(ded)));
          }, 'import');
        continue;
      }
      const nums = r.pick === 'hand' ? a.hand : r.pick === 'typed' ? { vac: round2(Number(r.typed.vac)), sick: round2(Number(r.typed.sick)) } : a.old;
      const e = r.eff || p; // Staff Hub's start date, full-/part-time and last day where it has them (impAudit)
      await B.putHR(r.sid, d => {
        // kept from the record here: adjustments, department and what they're enrolled in (none of it is in the old Sheet)
        const keep = { adj: Array.isArray(d.adj) ? d.adj : [], dept: d.dept || p.title || '', ben: d.ben && typeof d.ben === 'object' ? d.ben : {} };
        Object.keys(d).forEach(x => { if (x !== 'sid') delete d[x]; });
        Object.assign(d, keep, { hire: e.hire || '', orient: p.orient || '', type: e.type, left: e.former ? (e.moved || '') : '', notes: p.notes || '',
          open: { asOf: T, vac: round2(Math.max(0, nums.vac)), sick: round2(Math.max(0, nums.sick)), note: impOpenNote(r.pick, a, T), from: { pick: r.pick, old: a.old, hand: a.hand } },
          oldDed, settled: r.pick === 'hand' ? [] : oldDed, moved: { at: now, by: me, name: p.name } });
        if (r.shp && r.shf) shApply(d, r.shf, r.shp.id);
      }, 'import');
      out.people++;
    } catch (e) { out.failed.push(p.name + ' (' + errText(e) + ')'); }
  }
  try { await B.saveSettings({ to: { moved: { at: now, by: me, asOf: T, people: out.people, reqs: out.reqs } } }); } catch (e) { }
  return out;
}
function impOpenNote(pick, a, T) {
  const o = 'the old app had ' + hrs(a.old.vac) + ' h vacation, ' + hrs(a.old.sick) + ' h sick';
  if (pick === 'hand') return 'Worked out by the handbook from Jan 1 to ' + fmtDateLong(T) + ' when moving from the old Time-Off app (' + o + ')';
  if (pick === 'typed') return 'Set by Dr. A when moving from the old Time-Off app on ' + fmtDateLong(T) + ' (' + o + '; the handbook gave ' + hrs(a.hand.vac) + ' h and ' + hrs(a.hand.sick) + ' h)';
  return 'From the old Time-Off app, as of ' + fmtDateLong(T);
}
