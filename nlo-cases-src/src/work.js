/* =====================================================================
   Workload — Dr. A only (Amir, 5 Oct 2026: "can you give me a dashboard (maybe a separate tab) where I can monitor how much work
   each assistant is doing, how many cases, how many aligners, how long it takes for them on avg to enter a case for retainer and to
   make it....) what is their workload").
   Counted from the case history (who did what, when: B.workLog) and the cases themselves, for the last 7, 30 or 90 days:
   - Cases entered: the new cases each person entered (createdBy), on the day they entered them. Asana imports don't count.
   - Steps moved: each time they moved a case to another step. Lab emails don't count (the app moves those cases by itself).
   - Aligners made: in-house sets moved to "Made – needs packaging" (or past it), for whoever moved them there: the set's upper +
     lower aligners.
   - Retainers (retainers, whitening trays and mouthguards): entered, and how long after the scan date on the case (same day = 0);
     made = reached Milestones (past To make and Printing), for whoever moved it there, and how long after the case was entered.
     A retainer from a scan on file, or a remake from the model on file, has no new scan: it isn't in the scan → entered average.
   - Now: the open cases assigned to each person, by kind, and how many of them are late (lab or delivery date passed).
   The history is read once and kept while the app is open: a longer period reads only the older part, Refresh only what's new.
   It holds no patient names (who, when, which step) and is dropped on Lock.
   ===================================================================== */
const WK_DAYS = [7, 30, 90];
/* the kinds of case on each person's plate, in a fixed order with fixed colors (checked for color-blind separation and contrast,
   neighbours in this order): the app's blue, mint and amber, a violet for appliances, grey for the few that are none of these */
const WK_KINDS = [
  { k: 'outside', l: 'Outside aligners & braces', c: '#2E52C9' },
  { k: 'inhouse', l: 'In-house aligners', c: '#1F9E7E' },
  { k: 'appl', l: 'Appliances & MARPE', c: '#4A3AA7' },
  { k: 'ret', l: 'Retainers & mouthguards', c: '#E29A14' },
  { k: 'other', l: 'Study models & other', c: '#969FAB' }
];
const WK = { days: 30, log: null, from: 0, to: 0, closed: null, closedDays: 0, at: 0, busy: false, err: '', tbl: false };
function wkReset() { Object.assign(WK, { log: null, from: 0, to: 0, closed: null, closedDays: 0, at: 0, busy: false, err: '' }); wkTipHide(); }
/* the period starts at midnight: the last 7 days = today and the 6 before it */
function wkSince(days) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (days - 1)); return d.getTime(); }
function wkKind(c) { const f = typeOf(c).flow; return f === 'outside' ? 'outside' : f === 'inhouse' ? 'inhouse' : f === 'appliance' || f === 'marpe' ? 'appl' : f === 'retainer' ? 'ret' : 'other'; }
/* a history entry that moved a case to another step (by hand: a lab email's move is the app's, not a person's) */
function wkMoved(x) { return !!x && x.a !== 'email' && !!x.to && !!x.from && x.from !== x.to && (x.a === 'stage' || (x.a === 'edit' && (x.fields || []).includes('stage'))); }
const wkDay = iso => Math.round(isoDate(iso) / 864e5);

/* read what the period needs: the history (older part / what's new) and the cases completed in it */
async function wkLoad(force) {
  if (WK.busy || !S.inApp) return;
  const since = wkSince(WK.days), stale = Date.now() - WK.at > 5 * 60e3;
  const older = !WK.log || since < WK.from, newer = !!WK.log && (force || stale), closed = !WK.closed || WK.closedDays < WK.days || force || stale;
  if (!older && !newer && !closed) return;
  WK.busy = true; WK.err = ''; const t0 = Date.now(), b0 = B;
  if (S.view === 'work') { const w = $('#view .wk'); if (w) w.classList.add('busy'); }
  try {
    const parts = [];
    if (!WK.log) parts.push(B.workLog(since));
    else { if (since < WK.from) parts.push(B.workLog(since, WK.from)); if (newer) parts.push(B.workLog(WK.to)); }
    const days = Math.max(WK.days, WK.closedDays);
    const res = await Promise.all(parts.concat(closed ? [B.loadClosed(days)] : []));
    if (B !== b0 || !S.inApp) return; // locked meanwhile
    const cl = closed ? res.pop() : null, have = new Set((WK.log || []).map(x => x.id));
    const add = [].concat.apply([], res).filter(x => x && x.id && !have.has(x.id) && have.add(x.id));
    WK.log = (WK.log || []).concat(add);
    WK.from = WK.from ? Math.min(WK.from, since) : since;
    WK.to = WK.log.reduce((m, x) => Math.max(m, x.at || 0), WK.to || since);
    if (cl) { WK.closed = liveCases(cl); WK.closedDays = days; }
    WK.at = t0;
  } catch (e) { WK.err = errText(e); }
  finally { WK.busy = false; }
  if (S.view === 'work' && S.inApp) renderView();
}

/* everything the page shows, per person: { k (staff id, '' = nobody, 'n:Name' = a name from Asana), entered, moved, al, sets, retIn,
   retLag [days], ret, retMake [ms], open, late, kinds {kind: n}, lateK, toMake {al, sets, ret} } */
function wkStats() {
  const since = wkSince(WK.days), log = (WK.log || []).filter(x => (x.at || 0) >= since).sort((a, b) => a.at - b.at);
  const pool = new Map(); (WK.closed || []).concat(S.closed || []).forEach(c => { if (c && c.id) pool.set(c.id, c); }); openCases().forEach(c => pool.set(c.id, c));
  const P = new Map(), per = k => { if (!P.has(k)) P.set(k, { k, entered: 0, moved: 0, al: 0, sets: 0, retIn: 0, retLag: [], ret: 0, retMake: [], open: 0, late: 0, kinds: {}, lateK: {}, toMake: { al: 0, sets: 0, ret: 0 } }); return P.get(k); };
  const madeBy = new Map(); log.forEach(x => { if (x.a === 'create' && x.caseId) madeBy.set(x.caseId, x.sid); });
  pool.forEach(c => {
    if (!((c.createdAt || 0) >= since) || c.importedAt || (c.src && c.src.asana) || c.locked) return;
    const by = c.createdBy || madeBy.get(c.id); if (!by) return;
    const p = per(by); p.entered++;
    if (typeOf(c).flow === 'retainer') { p.retIn++; if (txDateOk(c.scanDate) && !c.scanOnFile && c.remake !== 'model') p.retLag.push(Math.max(0, wkDay(isoOf(new Date(c.createdAt))) - wkDay(c.scanDate))); }
  });
  const IH = FLOWS.inhouse.stages.map(s => s[0]), PACK = IH.indexOf('pack'), RT = FLOWS.retainer.stages.map(s => s[0]), MADE = RT.indexOf('milestones'), alDone = new Set(), retDone = new Set();
  log.forEach(x => {
    if (!wkMoved(x)) return;
    const p = per(x.sid || '?'), c = pool.get(x.caseId); p.moved++;
    if (!c) return;
    const fl = typeOf(c).flow;
    if (fl === 'inhouse' && IH.indexOf(x.to) >= PACK && IH.indexOf(x.from) < PACK && !alDone.has(c.id)) { alDone.add(c.id); p.sets++; p.al += alN(c); }
    // (a step it was at that isn't one any more — Sarah's desk, Picked up — was after Milestones)
    const ri = k => RT.includes(k) ? RT.indexOf(k) : k ? MADE + 1 : -1;
    if (fl === 'retainer' && ri(x.to) >= MADE && ri(x.from) < MADE && !retDone.has(c.id)) { retDone.add(c.id); p.ret++; if (c.createdAt && x.at > c.createdAt) p.retMake.push(x.at - c.createdAt); }
  });
  openCases().forEach(c => {
    const p = per(c.assignee || (c.assigneeName ? 'n:' + c.assigneeName : '')), kd = wkKind(c);
    p.open++; p.kinds[kd] = (p.kinds[kd] || 0) + 1;
    if (dueBucket(c) === 'over') { p.late++; p.lateK[kd] = (p.lateK[kd] || 0) + 1; }
    const fl = typeOf(c).flow;
    if (fl === 'inhouse' && IH.indexOf(liveStage(c)) < PACK) { p.toMake.sets++; p.toMake.al += alN(c); }
    if (fl === 'retainer' && RT.indexOf(liveStage(c)) < MADE) p.toMake.ret++; // (To make or Printing)
  });
  return P;
}
function wkAny(d) { return !!d && (d.entered || d.moved || d.sets || d.retIn || d.ret || d.open); }
/* the rows: the assistants by name, then Dr. A, then anyone else with something to show (someone who has left, a name from Asana),
   and the open cases nobody is assigned to */
function wkRows(P) {
  const empty = k => ({ k, entered: 0, moved: 0, al: 0, sets: 0, retIn: 0, retLag: [], ret: 0, retMake: [], open: 0, late: 0, kinds: {}, lateK: {}, toMake: { al: 0, sets: 0, ret: 0 } });
  const on = S.roster.filter(r => r.active), rows = [], seen = new Set();
  on.filter(r => r.role !== 'owner').sort((a, b) => a.name.localeCompare(b.name)).concat(on.filter(r => r.role === 'owner'))
    .forEach(r => { seen.add(r.sid); rows.push({ k: r.sid, r, name: staffLabel(r), full: r.name, d: P.get(r.sid) || empty(r.sid) }); });
  P.forEach((d, k) => {
    if (seen.has(k) || !k || !wkAny(d)) return;
    if (k.startsWith('n:')) { rows.push({ k, name: k.slice(2), full: k.slice(2) + ' (not on the team list)', d }); return; }
    const r = staff(k); rows.push({ k, r, name: (r ? staffLabel(r) : k) + (r ? ' (left)' : ''), full: r ? r.name + ' (no longer on the team)' : k, d, gone: true });
  });
  if (P.has('') && wkAny(P.get(''))) rows.push({ k: '', name: 'Not assigned', full: 'Not assigned to anyone', d: P.get(''), none: true });
  return rows;
}
function wkSum(rows) {
  const t = { entered: 0, moved: 0, al: 0, sets: 0, retIn: 0, retLag: [], ret: 0, retMake: [], open: 0, late: 0 };
  rows.forEach(({ d }) => { ['entered', 'moved', 'al', 'sets', 'retIn', 'ret', 'open', 'late'].forEach(k => { t[k] += d[k]; }); t.retLag = t.retLag.concat(d.retLag); t.retMake = t.retMake.concat(d.retMake); });
  return t;
}
const wkAvg = a => a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const wkNum = n => (Math.round(n * 10) / 10).toFixed(n < 10 ? 1 : 0).replace(/\.0$/, '');
/* days between the scan and entering it: "Same day", "0.4 days", "2 days" */
function wkLagTxt(d) { if (d == null) return '—'; if (d < 0.05) return 'Same day'; const s = wkNum(d); return s + (s === '1' ? ' day' : ' days'); }
/* entered → made: "Under 1 hour", "5 hours", "1.5 days" */
function wkSpanTxt(ms) {
  if (ms == null) return '—'; const h = ms / 3600e3; if (h < 1) return 'Under 1 hour';
  if (h < 36) { const n = Math.round(h); return n + (n === 1 ? ' hour' : ' hours'); }
  const s = wkNum(h / 24); return s + (s === '1' ? ' day' : ' days');
}

/* ---------- the page ---------- */
function viewWork() {
  wkLoad();
  const P = wkStats(), rows = wkRows(P), all = wkSum(Array.from(P.values()).map(d => ({ d }))), n = WK.days, ready = !!WK.log;
  const per = 'in the last ' + n + ' days';
  const fl = '<div class="filters wkFilters"><div class="wkDays" role="radiogroup" aria-label="Period">' + WK_DAYS.map(d =>
    '<button class="chip' + (d === n ? ' on' : '') + '" role="radio" aria-checked="' + (d === n) + '" data-act="wkDays" data-d="' + d + '">Last ' + d + ' days</button>').join('') + '</div>' +
    '<span class="small muted wkAt">' + (WK.busy && !ready ? 'Reading the history…' : WK.at ? 'Updated ' + esc(new Date(WK.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) : '') + '</span>' +
    '<button class="btn btn-ghost" data-act="wkRefresh"' + (WK.busy ? ' disabled' : '') + '>' + ic('refresh', 15) + 'Refresh</button></div>';
  const err = WK.err ? '<div class="notice bad wkErr">' + esc('Couldn’t read the history: ' + WK.err) + ' <button class="linkBtn" data-act="wkRefresh">Try again</button></div>' : '';
  const tile = (v, l, s, k, cls) => '<div class="tile wkT' + (cls ? ' ' + cls : '') + '" data-t="' + k + '"><span class="n">' + v + '</span><span class="l">' + l + '</span>' + (s ? '<span class="s">' + s + '</span>' : '') + '</div>';
  const wait = '<span class="wkWait">…</span>', retLag = wkAvg(all.retLag), retMake = wkAvg(all.retMake);
  const tiles = '<div class="tiles wkTiles">' +
    tile(ready ? all.entered : wait, 'Cases entered', per, 'entered') +
    tile(ready ? all.al : wait, 'Aligners made', ready ? 'in-house · ' + all.sets + ' set' + (all.sets === 1 ? '' : 's') : 'in-house', 'al') +
    tile(ready ? all.ret : wait, 'Retainers made', 'retainers, whitening trays & mouthguards', 'ret') +
    tile(ready ? esc(wkLagTxt(retLag)) : wait, 'Retainers: scan → entered', ready ? (all.retLag.length ? 'average of ' + all.retLag.length : 'none entered') : '', 'lag', 'wkTxt') +
    tile(ready ? esc(wkSpanTxt(retMake)) : wait, 'Retainers: entered → made', ready ? (all.retMake.length ? 'average of ' + all.retMake.length : 'none made') : '', 'make', 'wkTxt') +
    tile(all.open, 'Open now', all.late ? '<span class="wkLateTx">' + ic('clock', 13) + all.late + ' late</span>' : 'none late', 'open') + '</div>';
  return '<div class="wk' + (WK.busy && ready ? ' busy' : '') + '">' + fl + err + tiles + wkTableHTML(rows, all, ready) + wkPlateHTML(rows) + wkHowHTML() + '</div>';
}
/* by person: the period's numbers, and what's open now */
function wkTableHTML(rows, all, ready) {
  const c = (v, k, cls) => '<td class="num' + (cls ? ' ' + cls : '') + '" data-c="' + k + '">' + v + '</td>';
  const cnt = (n, k) => c(ready ? String(n) : '…', k, ready && !n ? 'zero' : '');
  const cells = (d, k) => cnt(d.entered, 'entered') + cnt(d.moved, 'moved') +
    c(ready ? d.al + (d.sets ? '<span class="wkSub">' + d.sets + ' set' + (d.sets === 1 ? '' : 's') + '</span>' : '') : '…', 'al', ready && !d.al ? 'zero' : '') +
    cnt(d.retIn, 'retIn') + c(ready ? esc(wkLagTxt(wkAvg(d.retLag))) : '…', 'retLag', 'wkTx') + cnt(d.ret, 'ret') + c(ready ? esc(wkSpanTxt(wkAvg(d.retMake))) : '…', 'retMake', 'wkTx') +
    c(k == null ? String(d.open) : d.open ? '<button class="linkBtn" data-act="wkList" data-who="' + esc(k) + '" title="See them in All open cases">' + d.open + '</button>' : '0', 'open', d.open ? '' : 'zero') +
    c(d.late ? (k == null ? '' : '<button class="linkBtn wkLateTx" data-act="wkList" data-who="' + esc(k) + '" data-due="over" title="See them in All open cases">') + ic('clock', 13) + d.late + (k == null ? '' : '</button>') : '0', 'late', d.late ? 'late' : 'zero');
  const who = x => '<td class="wkWho" title="' + esc(x.full) + '">' + (x.r ? '<span class="av" data-sav="' + esc(x.r.sid) + '">' + esc(x.r.initials || initials(x.r.name)) + '</span>' : '<span class="av none">' + (x.none ? '–' : esc(initials(x.name))) + '</span>') + '<b>' + esc(x.name) + '</b></td>';
  // (Open and Late open All open cases filtered to the person: the list's "Assigned to" filter has Unassigned, not names from Asana)
  const linkKey = x => x.none ? '_none' : x.k.startsWith('n:') ? null : x.k;
  return '<div class="card wkCard"><div class="cardHd"><h3>By person</h3><span class="sub">Last ' + WK.days + ' days, and their open cases now</span></div>' +
    '<div class="tblWrap wkTblWrap"><table class="tbl wkTbl"><thead><tr class="wkGrp"><th rowspan="2" class="wkWho">Person</th><th colspan="2">All cases</th><th>In-house</th><th colspan="4">Retainers</th><th colspan="2">Now</th></tr>' +
    '<tr><th class="num">Entered</th><th class="num">Steps moved</th><th class="num">Aligners made</th><th class="num">Entered</th><th class="num">Scan → entered</th><th class="num">Made</th><th class="num">Entered → made</th><th class="num">Open</th><th class="num">Late</th></tr></thead><tbody>' +
    rows.map(x => '<tr data-k="' + esc(x.k) + '">' + who(x) + cells(x.d, linkKey(x)) + '</tr>').join('') + '</tbody>' +
    '<tfoot><tr data-k="_all"><td class="wkWho"><b>Office</b></td>' + cells(all, null) + '</tr></tfoot></table></div></div>';
}
/* on each person's plate now: their open cases as one bar, split by kind (a table instead, with Table) */
function wkPlateHTML(rows) {
  const list = rows.filter(x => x.d.open || !x.none).slice().sort((a, b) => (b.d.open - a.d.open) || ((a.none ? 1 : 0) - (b.none ? 1 : 0)));
  const max = Math.max(1, ...list.map(x => x.d.open));
  const hd = '<div class="cardHd"><h3>On each person’s plate</h3><span class="sub">Open cases assigned to them now, by kind</span><span style="flex:1"></span>' +
    '<button class="btn btn-ghost wkTblBtn" data-act="wkTbl" aria-pressed="' + WK.tbl + '">' + ic(WK.tbl ? 'board' : 'list', 15) + (WK.tbl ? 'Chart' : 'Table') + '</button></div>';
  const legend = '<div class="wkLegend" aria-hidden="true">' + WK_KINDS.map(k => '<span><i style="background:' + k.c + '"></i>' + esc(k.l) + '</span>').join('') + '</div>';
  const nm = x => (x.r ? '<span class="av" data-sav="' + esc(x.r.sid) + '">' + esc(x.r.initials || initials(x.r.name)) + '</span>' : '<span class="av none">' + (x.none ? '–' : esc(initials(x.name))) + '</span>') + '<span class="wkNm">' + esc(x.name) + '</span>';
  if (WK.tbl) {
    return '<div class="card wkCard" id="wkPlate">' + hd + '<div class="tblWrap"><table class="tbl wkTbl wkPlateTbl"><thead><tr><th class="wkWho">Person</th>' + WK_KINDS.map(k => '<th class="num">' + esc(k.l) + '</th>').join('') +
      '<th class="num">Open</th><th class="num">Late</th><th class="num">Aligners to make</th><th class="num">Retainers to make</th></tr></thead><tbody>' +
      list.map(x => '<tr data-k="' + esc(x.k) + '"><td class="wkWho">' + nm(x) + '</td>' + WK_KINDS.map(k => '<td class="num' + (x.d.kinds[k.k] ? '' : ' zero') + '" data-c="' + k.k + '">' + (x.d.kinds[k.k] || 0) + '</td>').join('') +
        '<td class="num" data-c="open"><b>' + x.d.open + '</b></td><td class="num' + (x.d.late ? ' late' : ' zero') + '" data-c="late">' + x.d.late + '</td>' +
        '<td class="num' + (x.d.toMake.al ? '' : ' zero') + '" data-c="alToMake">' + x.d.toMake.al + (x.d.toMake.sets ? '<span class="wkSub">' + x.d.toMake.sets + ' set' + (x.d.toMake.sets === 1 ? '' : 's') + '</span>' : '') + '</td>' +
        '<td class="num' + (x.d.toMake.ret ? '' : ' zero') + '" data-c="retToMake">' + x.d.toMake.ret + '</td></tr>').join('') + '</tbody></table></div></div>';
  }
  const bar = x => {
    if (!x.d.open) return '<span class="wkTot muted">Nothing open</span>';
    const segs = WK_KINDS.filter(k => x.d.kinds[k.k]).map(k => {
      const v = x.d.kinds[k.k], late = x.d.lateK[k.k] || 0;
      const extra = k.k === 'inhouse' && x.d.toMake.sets ? x.d.toMake.al + ' aligners to make (' + x.d.toMake.sets + ' set' + (x.d.toMake.sets === 1 ? '' : 's') + ')' : k.k === 'ret' && x.d.toMake.ret ? x.d.toMake.ret + ' to make' : '';
      return '<span class="wkSeg" style="flex:' + v + ';--k:' + k.c + '" tabindex="0" role="img" aria-label="' + esc(x.name + ': ' + v + ' ' + k.l + (late ? ', ' + late + ' late' : '')) + '" data-n="' + v + '" data-l="' + esc(k.l) + '" data-w="' + esc(x.name) + '" data-late="' + late + '" data-x="' + esc(extra) + '"></span>';
    }).join('');
    return '<span class="wkBar" style="--w:' + (x.d.open / max * 100).toFixed(2) + '%">' + segs + '</span><span class="wkTot"><b>' + x.d.open + '</b> open' + (x.d.late ? '<span class="wkDot"> · </span><span class="wkLateTx">' + ic('clock', 13) + x.d.late + ' late</span>' : '') + '</span>';
  };
  return '<div class="card wkCard" id="wkPlate">' + hd + '<div class="cardBd">' + legend + '<div class="wkBars">' +
    list.map(x => '<div class="wkRow" data-k="' + esc(x.k) + '"><span class="wkName" title="' + esc(x.full) + '">' + nm(x) + '</span><span class="wkTrack">' + bar(x) + '</span></div>').join('') + '</div></div></div>';
}
function wkHowHTML() {
  const li = (b, t) => '<li><b>' + b + '</b> ' + t + '</li>';
  return '<details class="wkHow"><summary>How these are counted</summary><ul>' +
    li('Cases entered:', 'new cases each person entered in the app, counted on the day they entered them. Cases brought in from Asana don’t count.') +
    li('Steps moved:', 'each time they moved a case to another step. Moves made by lab emails don’t count.') +
    li('Aligners made:', 'in-house sets moved to “Made – needs packaging” (or past it), for whoever moved them there — the set’s upper and lower aligners.') +
    li('Retainers:', 'retainers, whitening trays and mouthguards. <i>Scan → entered</i> counts days from the scan date on the case to the day it was entered (the same day is 0). <i>Made</i> is when it reached Milestones (past To make and Printing), for whoever moved it there; <i>Entered → made</i> is the time from entering it to then. A retainer from a scan on file, or a remake from the model, isn’t in the scan → entered average (no new scan).') +
    li('Now:', 'open cases assigned to each person. Late = its lab or delivery date has passed. Tap a number to see those cases.') +
    '</ul></details>';
}

/* ---------- the hover / focus readout on the bars (values from the bar, written as text, never as markup) ---------- */
function wkTipShow(seg) {
  let tip = $('#wkTip'); if (!tip) { tip = document.createElement('div'); tip.id = 'wkTip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  tip.textContent = '';
  const line = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; tip.appendChild(d); };
  const top = document.createElement('div'); top.className = 'wkTipV'; const b = document.createElement('b'); b.textContent = seg.dataset.n; top.appendChild(b);
  const key = document.createElement('i'); key.style.background = seg.style.getPropertyValue('--k'); top.prepend(key); top.appendChild(document.createTextNode(' ' + seg.dataset.l)); tip.appendChild(top);
  if (Number(seg.dataset.late)) line('wkTipLate', seg.dataset.late + ' late');
  if (seg.dataset.x) line('wkTipX', seg.dataset.x);
  line('wkTipW', seg.dataset.w);
  const r = seg.getBoundingClientRect(); tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  tip.style.top = (r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8) + 'px';
  seg.classList.add('on');
}
function wkTipHide() { const t = $('#wkTip'); if (t) t.style.display = 'none'; $$('.wkSeg.on').forEach(s => s.classList.remove('on')); }
document.addEventListener('pointerover', e => { const s = e.target.closest && e.target.closest('.wkSeg'); if (s) wkTipShow(s); else if ($('.wkSeg.on') && !(e.target.closest && e.target.closest('#wkTip'))) wkTipHide(); });
document.addEventListener('focusin', e => { const s = e.target.closest && e.target.closest('.wkSeg'); if (s) wkTipShow(s); else wkTipHide(); });
document.addEventListener('scroll', () => wkTipHide(), true);

Object.assign(ADMIN_ACTS, {
  wkDays(t) { const d = Number(t.dataset.d); if (!WK_DAYS.includes(d) || d === WK.days) return; WK.days = d; renderView(); },
  wkRefresh() { wkLoad(true); renderView(); },
  wkTbl() { WK.tbl = !WK.tbl; wkTipHide(); renderView(); const b = $('#wkPlate .wkTblBtn'); if (b) b.focus(); },
  // a person's open (or late) cases: All open cases with the Assigned to filter set
  wkList(t) { wkTipHide(); S.view = 'list'; S.q = ''; S.f = noFilters(); S.f.who = t.dataset.who || ''; if (t.dataset.due) S.f.due = t.dataset.due; renderNav(); renderView(); window.scrollTo(0, 0); }
});
