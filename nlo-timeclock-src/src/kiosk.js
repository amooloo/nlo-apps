/* =====================================================================
   The office's time clock: everyone on the clock as photo tiles, a
   4-digit PIN, then In / Lunch / Back / Out. After a punch it shows the
   time the server took, the hours so far this workweek, and anything
   the managers will see (too early, a closed day, overtime coming).
   Nothing ever blocks a punch: boundaries are flagged and alerted.
   With the office lock on, it asks the office check where it is right
   before each punch: off the office network the punch still goes
   through, flagged.
   Someone who missed a punch asks for it here ("I forgot to punch"),
   right after their PIN; a manager approves it.
   The same screen runs on a laptop Dr. A approved for working from
   home: only the people he picked; away from the office network (or
   before the office check is set up), clock in and out only (marked
   Home). It always checks where it is, even with the lock off.
   ===================================================================== */
const K_IDLE = 45000, K_FORM_IDLE = 120000, K_DONE = 8000, K_DONE_OT = 25000, K_SESSION = 8 * 60000;
async function enterKiosk() {
  S.mode = 'kiosk'; S.role = 'kiosk'; S.k = { screen: 'tiles' }; S.got = {}; S.permChecked = false; S.loadErr = ''; S.kNet = null;
  $('#lockWrap').classList.add('hidden'); $('#app').classList.add('hidden'); $('#kiosk').classList.remove('hidden');
  $('#kName').textContent = B.kiosk ? B.kiosk.name : 'Time clock';
  document.body.classList.toggle('isLaptop', isLaptopHere());
  try { S.rulesOk = await B.rulesOk(true); } catch (e) { S.rulesOk = true; }
  rewatch(); renderKiosk(); kioskTick(Date.now());
  B.kioskSeen().catch(() => { });
  // every 10 minutes: "still here", and (the office's time clock, with the office lock on) which network it's on
  S.timers.forEach(t => clearInterval(t)); S.timers = [setInterval(() => { if (S.mode === 'kiosk') { B.kioskSeen().catch(() => { }); kNetWatch(); } }, 10 * 60000)];
  setTimeout(kNetWatch, 5000); // (once the settings are in)
  keepAwake();
}
/* where this time clock (or laptop) is, right before a punch → { net, pid }: net 'office', 'off' (another network), 'unk'
   (no answer from the office check) — or '' when nothing is checked (the office's time clock with the office lock off; a
   laptop before the office check is set up: it counts as away). pid: the punch number for an "at the office" punch. */
async function kNet() {
  if (!S.set.wurl || (!isLaptopHere() && !S.set.lock)) return { net: '', pid: '' };
  // (a check of its own still on its way would replace this one's punch number: wait for it first)
  if (S.kNetP) { try { await withTimeout(S.kNetP, 8000); } catch (e) { } }
  try { const r = await B.netCheck(S.set.wurl, true, 6000); S.kNet = { office: r.office, org: r.org, city: r.city, at: Date.now() }; return { net: r.office ? 'office' : 'off', pid: r.pid }; }
  catch (e) { return { net: 'unk', pid: '' }; }
}
/* the office's time clock, now and then: a line on screen when it isn't on the office network (moved, or the internet
   changed) — only while nobody's using it (each check replaces the punch number the last one gave) */
function kNetWatch() {
  if (S.mode !== 'kiosk' || isLaptopHere() || !S.set.lock || !S.set.wurl || S.k.screen !== 'tiles' || S.kNetP) return;
  const p = S.kNetP = B.netCheck(S.set.wurl, true).then(r => { S.kNet = { office: r.office, org: r.org, city: r.city, at: Date.now() }; }, () => { S.kNet = { office: null, at: Date.now() }; })
    .then(() => { if (S.kNetP === p) S.kNetP = null; if (S.mode === 'kiosk' && S.k.screen === 'tiles') renderKiosk(); });
}
/* away from the office on a laptop: clock in and out only (a lunch from home is clocking out and back in) */
function lapKinds(state) { return state === 'out' ? ['in'] : ['out']; }
/* keep the screen on (where the browser can) */
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (S.mode === 'kiosk' && document.visibilityState === 'visible') keepAwake(); });

function kioskTick(n) {
  const t = $('#kTime'), d = $('#kDate'), now = nowMs();
  if (t) t.textContent = TCE.timeText(now).replace(/ (AM|PM)$/, '');
  if (t) t.dataset.ap = /PM$/.test(TCE.timeText(now)) ? 'PM' : 'AM';
  if (d) d.textContent = TCE.dayText(TCE.dayOf(now), true);
  const k = S.k;
  if (k.verifiedAt && !k.busy && n - k.verifiedAt > K_SESSION && k.screen !== 'done') kCancel(); // (a PIN is good for one visit)
  else if (['pin', 'acts', 'week', 'newpin', 'otok', 'lunchq'].includes(k.screen) && !k.busy && n - S.lastAct > K_IDLE) kCancel();
  else if (k.screen === 'req' && !k.busy && n - S.lastAct > K_FORM_IDLE) kCancel();
  else if (k.screen === 'done' && n - k.doneAt > (k.otWarn ? K_DONE_OT : K_DONE)) { S.k = { screen: 'tiles' }; renderKiosk(); }
  else if (k.screen === 'tiles' && (!k.drawn || n - k.drawn > 30000)) renderKiosk();
  // a fresh copy of the page early each morning (new versions), only when nobody's using it and the internet is there
  const p = TCE.parts(now);
  if (k.screen === 'tiles' && p.h === 3 && p.mi < 5 && navigator.onLine !== false && n - (S.loadedAt || 0) > 3600000 && n - (S.reloadTry || 0) > 60000) {
    // only when the page itself can be fetched (otherwise the time clock would sit on the browser's error page)
    S.reloadTry = n;
    fetch(location.href.split('#')[0], { method: 'HEAD', cache: 'no-store' }).then(r => { if (r.ok && S.k.screen === 'tiles') location.reload(); }).catch(() => { });
  }
}
S.loadedAt = Date.now();

function renderKiosk() {
  const el = $('#kMain'); if (!el) return;
  const k = S.k, off = navigator.onLine === false;
  let h = '';
  if (!S.rulesOk) h = '<div class="kMsg">' + ic('shield', 40) + '<b>The time clock is almost ready.</b><span>Dr. A needs to publish the database’s new rules (he’ll see how when he signs in).</span></div>';
  else if (S.loadErr === 'perm') h = '<div class="kMsg">' + ic('warn', 40) + '<b>This computer can’t read the time clock.</b><span>If Dr. A removed it as a time clock, he can set it up again: Manager → Settings.</span></div>';
  else if (!S.got.set || !S.got.staff || !S.got.roster) h = '<div class="kMsg"><span>Loading…</span></div>';
  else if (!S.setRaw) h = '<div class="kMsg">' + ic('clock', 40) + '<b>The time clock isn’t set up yet.</b><span>Dr. A sets it up from Manager.</span></div>';
  else if (k.screen === 'tiles') h = kTilesHTML();
  else if (k.screen === 'pin' || k.screen === 'newpin') h = kPinHTML();
  else if (k.screen === 'acts') h = kActsHTML();
  else if (k.screen === 'week') h = kWeekHTML();
  else if (k.screen === 'req') h = kReqHTML();
  else if (k.screen === 'otok') h = kOtOkHTML();
  else if (k.screen === 'lunchq') h = kLunchQHTML();
  else if (k.screen === 'done') h = kDoneHTML();
  // keep what someone is typing (the screen is drawn again when they pick something)
  const a = document.activeElement, keep = a && el.contains(a) && a.id ? { id: a.id, s: a.selectionStart } : null;
  const kn = S.kNet, netBar = !isLaptopHere() && S.set.lock && kn && kn.office === false && Date.now() - kn.at < 30 * 60000
    ? '<div class="kOff kNetOff">' + ic('warn', 18) + 'This time clock isn’t on the office network (it’s on ' + esc([kn.org, kn.city].filter(Boolean).join(', ') || 'another network') + '). Punches are still saved, flagged for a manager.</div>' : '';
  el.innerHTML = (off || S.loadErr === 'net' ? '<div class="kOff">' + ic('warn', 18) + 'No internet: the time clock can’t take punches right now. Write your time down and tell a manager.</div>' : '') + netBar + h;
  k.drawn = Date.now();
  paintPhotos(el);
  if (keep) { const x = document.getElementById(keep.id); if (x) { x.focus(); try { if (keep.s != null) x.setSelectionRange(keep.s, keep.s); } catch (e) { } } }
}
function kTilesHTML() {
  const list = onClockList();
  if (!list.length) return isLaptopHere() ? '<div class="kMsg">' + ic('monitor', 40) + '<b>Nobody is set up on this laptop.</b><span>Dr. A picks who uses it: Manager → Settings → Approved laptops.</span></div>'
    : '<div class="kMsg">' + ic('people', 40) + '<b>Nobody is on the time clock yet.</b><span>Dr. A adds people in Manager → People.</span></div>';
  return '<div class="kHint">' + (isLaptopHere() ? 'Approved laptop · tap your name' : 'Tap your name') + '</div><div class="kTiles">' + list.map(r => {
    const w = weekFor(r.sid, null, true), lk = lockedUntil(r.sid), cls = w.state === 'in' ? 'in' : w.state === 'lunch' ? 'lunch' : 'out';
    const sub = lk ? 'Locked until ' + TCE.timeText(lk) : w.state === 'in' ? 'In · ' + TCE.timeText(w.since) + (w.src === 'home' ? ' (home)' : w.src === 'req' ? ' (asked)' : '') : w.state === 'lunch' ? 'Lunch · ' + TCE.timeText(w.since) : 'Out';
    return '<button class="kTile ' + cls + (lk ? ' locked' : '') + '" data-act="kTile" data-sid="' + esc(r.sid) + '">' + avatar(r.sid, 'kAv') +
      '<span class="kTn">' + esc(shortOf(r.sid)) + '</span><span class="kTs">' + esc(sub) + '</span></button>';
  }).join('') + '</div>';
}
function kWho(sid, w) {
  return '<div class="kWho">' + avatar(sid, 'kAv lg') + '<div><div class="kWn">' + esc(nameOf(sid)) + '</div><div class="kWs">' + esc(stateText(w)) + '</div></div></div>';
}
function kPinHTML() {
  const k = S.k, w = weekFor(k.sid), st = S.staff.get(k.sid);
  const title = k.screen === 'newpin' ? (k.np1 ? 'Type the new PIN again' : 'Type a new 4-digit PIN') : 'Type your PIN';
  const dots = [0, 1, 2, 3].map(i => '<i class="' + (i < k.pin.length ? 'on' : '') + '"></i>').join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', '0', 'b'].map(c =>
    c === 'x' ? '<button class="kKey kKeyAlt" data-act="kCancel">Cancel</button>'
      : c === 'b' ? '<button class="kKey kKeyAlt" data-act="kBack" aria-label="Delete">' + ic('bksp', 28) + '</button>'
        : '<button class="kKey" data-act="kDigit" data-d="' + c + '"' + (k.busy ? ' disabled' : '') + '>' + c + '</button>').join('');
  const noPin = k.screen === 'pin' && st && !st.pinAt;
  return '<div class="kPanel">' + kWho(k.sid, w) +
    (noPin ? '<div class="kNote bad">No PIN set yet. Ask a manager to set one for you (Manager → People).</div><div class="kBtns"><button class="kBig kGhost" data-act="kCancel">Back</button></div>' :
      '<div class="kPinT">' + esc(title) + '</div><div class="kDots' + (k.shake ? ' shake' : '') + '" aria-label="' + k.pin.length + ' of 4 digits">' + dots + '</div>' +
      '<div class="kNote' + (k.msg && !k.info ? ' bad' : '') + '" role="status">' + esc(k.busy ? 'Checking…' : k.msg || '') + '</div>' +
      '<div class="kPad">' + keys + '</div>') + '</div>';
}
function kActsHTML() {
  const k = S.k, w = weekFor(k.sid), wp = weekFor(k.sid, null, true), hu = headsUp(w, S.set), open = reqsOf(k.sid, 'open');
  // a laptop away from the office network: clock in and out only, for someone allowed home (marked Home)
  const away = isLaptopHere() && k.net !== 'office', homeOk = (S.staff.get(k.sid) || {}).home === true;
  const kinds = away ? (homeOk ? lapKinds(wp.state) : []) : nextKinds(wp.state);
  const btn = kind => '<button class="kBig k-' + kind + '" data-act="kPunch" data-kind="' + kind + '"' + (k.busy ? ' disabled' : '') + '>' + ic(kind === 'in' ? 'in' : kind === 'out' ? 'out' : kind === 'lunch' ? 'lunch' : 'back', 30) + '<span>' + esc({ in: 'Clock in', lunch: 'Out to lunch', back: 'Back from lunch', out: 'Clock out' }[kind]) + '</span></button>';
  // a clock-out missing from an earlier day, or a clock-in missing (unless they've already asked for it)
  const today = TCE.dayOf(nowMs());
  const missing = w.issues.filter(x => x.type === 'missing-out' && x.day !== today && !askedFor(k.sid, x));
  const noIn = w.issues.filter(x => x.type === 'no-in' && !askedFor(k.sid, x));
  return '<div class="kPanel">' + kWho(k.sid, wp) +
    '<div class="kWeek"><b>' + esc(TCE.hmDur(w.total)) + '</b> this workweek' + (w.ot ? ' · <span class="bad">' + esc(TCE.hmDur(w.ot)) + ' overtime</span>' : '') + '</div>' +
    hu.map(kHeadsUp).join('') +
    missing.map(x => '<div class="kNote warn">Your clock-out on ' + esc(TCE.dayText(x.day)) + ' wasn’t recorded.<button class="kInl" data-act="kReq" data-k="out" data-day="' + esc(x.day) + '">Tell a manager when you left</button></div>').join('') +
    noIn.map(x => '<div class="kNote warn">' + esc((x.day === today ? 'Today' : 'On ' + TCE.dayText(x.day)) + ' you ' + (x.kind === 'out' ? 'clocked out' : 'went to lunch') + ' at ' + TCE.timeText(x.t) + ' without clocking in.') + '<button class="kInl" data-act="kReq" data-k="in" data-day="' + esc(x.day) + '">Tell a manager when you started</button></div>').join('') +
    (k.msg ? '<div class="kNote ' + (k.msgOk ? 'info' : 'warn') + '" role="status">' + esc(k.msg) + '</div>' : '') +
    ((S.staff.get(k.sid) || {}).pinBy === 'mgr' ? '<div class="kNote info">Your PIN was set by a manager. Pick your own: <button class="kInl" data-act="kNewPin">Change my PIN</button></div>' : '') +
    open.map(r => '<div class="kNote info kAsked">' + ic('clock', 16) + '<span>' + esc(r.ps.length ? 'Waiting for a manager: ' + TCE.reqText(r) : 'Your note to the managers (not seen yet): “' + cut(r.note, 60) + '”') + '</span><button class="kInl" data-act="kReqUndo" data-id="' + esc(r.id) + '">Take it back</button></div>').join('') +
    (away && homeOk ? '<div class="kNote info">' + ic('home', 16) + ' Away from the office: clock in and out only, marked Home on your timesheet.' + (k.net === 'unk' ? ' (The office network couldn’t be checked just now. <button class="kInl" data-act="kNetAgain">Check again</button>)' : '') + '</div>' : '') +
    (away && !homeOk ? (k.net === 'unk' ? '<div class="kNote warn">The office network couldn’t be checked just now, so this laptop can’t tell whether it’s at the office. <button class="kInl" data-act="kNetAgain">Check again</button></div>'
      : '<div class="kNote warn">You aren’t set up to clock in from home, so on this laptop you can clock in only at the office. Ask Dr. A.</div>') : '') +
    '<div class="kBtns">' + kinds.map(btn).join('') +
    (wp.state === 'out' ? '<button class="kBig kGhost" data-act="kReq" data-k="in">' + ic('edit', 22) + '<span>Already working? I forgot to clock in</span></button>' : '') + '</div>' +
    '<div class="kLinks"><button class="btn btn-ghost kForgot" data-act="kReq">' + ic('edit', 16) + 'I forgot to punch</button><button class="btn btn-ghost" data-act="kWeek">' + ic('sheet', 16) + 'My week</button><button class="btn btn-ghost" data-act="kNewPin">' + ic('key', 16) + 'Change my PIN</button><button class="btn btn-ghost" data-act="kCancel">' + ic('x', 16) + 'Cancel</button></div></div>';
}
/* a heads-up: the overtime ones as a pop-up (Amir: a warning that they're getting close; only approved overtime goes over) */
function kHeadsUp(x) {
  if (!x.ot) return '<div class="kNote ' + (x.bad ? 'bad' : x.warn ? 'warn' : 'info') + '">' + esc(x.t) + '</div>';
  return '<div class="kOt ' + (x.bad ? 'bad' : 'warn') + '" role="alert">' + ic('warn', 30) + '<div><b>' + esc(x.h) + '</b><span>' + esc(x.t) + '</span></div></div>';
}
/* about to clock in (or back) in overtime nobody approved: asked first; the punch is never refused (all time worked is paid) */
function kOtOkHTML() {
  const k = S.k, w = weekFor(k.sid), label = k.otKind === 'back' ? 'Back from lunch' : 'Clock in';
  return '<div class="kPanel kDone">' + '<div class="kCheck kWarnC">' + ic('warn', 50) + '</div>' +
    '<div class="kDoneT">Overtime isn’t approved</div><div class="kDoneN">' + esc(nameOf(k.sid)) + '</div>' +
    '<div class="kOt bad"><div><span>You’re at ' + esc(TCE.hmDur(w.total)) + ' this workweek' + (w.approved > w.limit ? ', past the ' + esc(TCE.h2(w.approved)) + ' h approved' : ' (overtime starts at ' + esc(S.set.ot) + ' h)') +
    '. Only a manager can approve overtime: check with one before you keep working. If you do work, clock in — every hour worked has to be on the clock — and a manager is told.</span></div></div>' +
    '<div class="kBtns"><button class="kBig k-out" data-act="kOtYes"' + (k.busy ? ' disabled' : '') + '>' + ic(k.otKind === 'back' ? 'back' : 'in', 28) + '<span>' + esc(label) + ' anyway</span></button><button class="kBig kGhost" data-act="kActs">Back</button></div></div>';
}
function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
/* "I forgot to punch": which punch, the day, the time(s), a note → a request a manager approves */
const REQ_KINDS = [['in', 'Clock in'], ['lunch', 'Lunch'], ['out', 'Clock out'], ['note', 'Just a note']];
function reqDays(now) { const t = TCE.dayOf(now); return [0, 1, 2, 3, 4, 5, 6].map(i => TCE.addDays(t, -i)); }
function reqDayLabel(iso, now) { const t = TCE.dayOf(now); return iso === t ? 'Today' : iso === TCE.addDays(t, -1) ? 'Yesterday' : TCE.dayText(iso); }
function reqFormHTML(f, pre) {
  const now = nowMs(), kinds = REQ_KINDS.map(([k, l]) => '<button type="button" data-act="' + pre + 'Kind" data-k="' + k + '" aria-pressed="' + (f.kind === k) + '">' + esc(l) + '</button>').join('');
  const days = reqDays(now).map(d => '<button type="button" data-act="' + pre + 'Day" data-day="' + d + '" aria-pressed="' + (f.day === d) + '">' + esc(reqDayLabel(d, now)) + '</button>').join('');
  const time = (id, field, label) => '<label class="rqTime"><span>' + esc(label) + '</span><input type="time" id="' + id + '" data-rq="' + field + '" value="' + esc(f[field] || '') + '"></label>';
  return '<div class="rqSeg" role="group" aria-label="Which punch">' + kinds + '</div>' +
    (f.kind && f.kind !== 'note' ? '<div class="rqLbl">Which day?</div><div class="rqDays" role="group" aria-label="Which day">' + days + '</div>' +
      (f.kind === 'lunch' ? '<div class="rqTimes">' + time(pre + 'T1', 't1', 'Out to lunch at') + time(pre + 'T2', 't2', 'Back at') + '</div><div class="rqHint">Leave one blank if you punched it.</div>'
        : '<div class="rqTimes">' + time(pre + 'T1', 't1', f.kind === 'in' ? 'Clocked in at' : 'Clocked out at') + '</div>') : '') +
    (f.kind ? '<label class="rqNoteF"><span>' + (f.kind === 'note' ? 'Your note for the managers' : 'Note for the managers (optional)') + '</span><textarea id="' + pre + 'Note" data-rq="note" maxlength="200" rows="2" placeholder="' + (f.kind === 'note' ? 'e.g. Stayed until 6 for the emergency patient' : 'e.g. Got here at 7:55 and forgot') + '">' + esc(f.note || '') + '</textarea></label>' : '');
}
/* what the form asks for → { ps, note } or { err } */
function reqFromForm(f, sid) {
  const now = nowMs(), note = String(f.note || '').trim().slice(0, 200);
  if (!f.kind) return { err: 'Pick which punch you missed.' };
  if (f.kind === 'note') return note ? { ps: [], note } : { err: 'Write your note.' };
  if (!TCE.isISO(f.day)) return { err: 'Pick the day.' };
  const at = hm => (TCE.okHM(hm) ? TCE.atTime(f.day, hm) : 0), ps = [];
  if (f.kind === 'lunch') {
    const a = at(f.t1), b = at(f.t2);
    if (!a && !b) return { err: 'Type when you went to lunch, when you came back, or both.' };
    if (a && b && b <= a) return { err: 'Back from lunch has to be after going to lunch.' };
    if (a) ps.push({ k: 'lunch', t: a }); if (b) ps.push({ k: 'back', t: b });
  } else { const t = at(f.t1); if (!t) return { err: 'Type the time.' }; ps.push({ k: f.kind, t }); }
  if (ps.some(p => p.t > now + TCE.MIN)) return { err: 'That time hasn’t happened yet.' };
  if (reqsOf(sid, 'open').some(r => r.ps.length === ps.length && r.ps.every((p, i) => p.k === ps[i].k && Math.abs(p.t - ps[i].t) < TCE.MIN))) return { err: 'You’ve already asked for that one.' };
  return { ps, note };
}
function kReqHTML() {
  const k = S.k, wp = weekFor(k.sid, null, true), f = k.req;
  return '<div class="kPanel wide kReq">' + kWho(k.sid, wp) +
    '<div class="kPinT">Which punch did you miss?</div>' + reqFormHTML(f, 'kr') +
    '<div class="kNote bad" role="status">' + esc(k.msg || '') + '</div>' +
    '<div class="kBtns kBtns2"><button class="kBig" data-act="kReqSend"' + (k.busy || !f.kind ? ' disabled' : '') + '>' + ic('tick', 26) + '<span>' + (k.busy ? 'Sending…' : 'Send to a manager') + '</span></button><button class="kBig kGhost" data-act="kActs">Back</button></div>' +
    '<p class="kSmall">It counts once a manager approves it. Your punches always stay on record as they are.</p></div>';
}
function kWeekHTML() {
  const k = S.k, w = weekFor(k.sid);
  const rows = w.days.filter(d => d.entries.length || d.ms).map(d => '<tr><td>' + esc(TCE.dayText(d.iso)) + '</td><td>' + d.entries.filter(e => !e.void).map(e => esc(KSHORT[e.kind] + ' ' + TCE.timeText(e.t))).join(' · ') + '</td><td class="num">' + esc(TCE.hmDur(d.ms)) + '</td></tr>').join('');
  return '<div class="kPanel wide">' + kWho(k.sid, w) + '<div class="kPinT">Week of ' + esc(TCE.dayText(w.wkIso)) + '</div>' +
    '<table class="kTbl"><tbody>' + (rows || '<tr><td colspan="3" class="muted">No punches yet this week.</td></tr>') + '</tbody><tfoot><tr><td colspan="2">Total' + (w.ot ? ' (' + esc(TCE.hmDur(w.reg)) + ' regular + ' + esc(TCE.hmDur(w.ot)) + ' overtime)' : '') + '</td><td class="num">' + esc(TCE.hmDur(w.total)) + '</td></tr></tfoot></table>' +
    reqListHTML(k.sid, w.from, true) +
    '<p class="kSmall">Something wrong? Press Back, then “I forgot to punch”: a manager fixes it (the original punch always stays on record).</p>' +
    '<div class="kBtns"><button class="kBig kGhost" data-act="kActs">Back</button></div></div>';
}
function kDoneHTML() {
  const k = S.k, d = k.done, w = d.w, day = TCE.dayOf(d.at), dd = w.days.find(x => x.iso === day) || { flags: [] };
  const notes = [];
  if (k.newPin) notes.push({ info: true, t: 'Your new PIN works from now on.' });
  else {
    dd.flags.forEach(f => {
      if (f.type === 'early' && f.e && Math.abs(f.e.t - d.at) < 1000) notes.push({ warn: true, t: 'Earlier than ' + TCE.hmText(f.limit) + ', the earliest clock-in time. Your manager sees this on the timesheet.' });
      if (f.type === 'offday' && (d.kind === 'in' || d.kind === 'back')) notes.push({ warn: true, t: 'The office is closed on ' + TCE.WD[TCE.dow(day)] + 's. Your manager sees this on the timesheet.' });
    });
    if (d.kind === 'in' || d.kind === 'back') headsUp(w, S.set).forEach(x => notes.push(x));
    k.otWarn = notes.some(x => x.ot); // (the time clock waits longer before going back to the names)
    if (d.kind === 'in' && d.before.state === 'in' && d.before.since && TCE.dayOf(d.before.since) !== day) notes.push({ warn: true, t: 'Your clock-out on ' + TCE.dayText(TCE.dayOf(d.before.since)) + ' wasn’t recorded. Tell a manager so they can add it.' });
    if (!isLaptopHere() && d.net === 'off') notes.push({ warn: true, t: 'This time clock isn’t on the office network right now, so this punch is flagged for a manager.' });
    if (!isLaptopHere() && d.net === 'unk') notes.push({ warn: true, t: 'The office network couldn’t be checked just now, so this punch is flagged for a manager.' });
    if (isLaptopHere() && d.net !== 'office') notes.push({ info: true, t: 'Marked Home on your timesheet.' });
    reqsOf(k.sid, 'open').forEach(r => { if (r.ps.length) notes.push({ info: true, t: 'Waiting for a manager: ' + TCE.reqText(r) + '. It counts once approved.' }); });
  }
  const what = k.newPin ? 'PIN changed' : KIND[d.kind];
  return '<div class="kPanel kDone">' + '<div class="kCheck">' + ic('tick', 54) + '</div>' +
    '<div class="kDoneT">' + esc(what) + (k.newPin ? '' : ' at ' + esc(TCE.timeText(d.at))) + '</div>' +
    '<div class="kDoneN">' + esc(nameOf(k.sid)) + '</div>' +
    (k.newPin ? '' : '<div class="kWeek"><b>' + esc(TCE.hmDur(w.total)) + '</b> so far this workweek</div>') +
    notes.map(kHeadsUp).join('') +
    '<div class="kBtns"><button class="kBig kGhost" data-act="kDone">' + (k.otWarn ? 'Got it' : 'Done') + '</button></div></div>';
}

/* ---------- the steps ---------- */
ACT.kTile = b => {
  const sid = b.dataset.sid, lk = lockedUntil(sid);
  S.k = { screen: 'pin', sid, pin: '', msg: lk ? 'Too many wrong PINs. Try again at ' + TCE.timeText(lk) + ', or ask a manager.' : '' };
  renderKiosk();
};
ACT.kDigit = b => kDigit(b.dataset.d);
ACT.kBack = () => { const k = S.k; if (k.busy) return; k.pin = k.pin.slice(0, -1); k.msg = ''; k.shake = false; renderKiosk(); };
ACT.kCancel = () => kCancel();
ACT.kActs = () => { Object.assign(S.k, { screen: 'acts', msg: '', msgOk: false }); renderKiosk(); };
ACT.kWeek = () => { S.k.screen = 'week'; renderKiosk(); };
ACT.kDone = () => { S.k = { screen: 'tiles' }; renderKiosk(); };
ACT.kNewPin = () => { Object.assign(S.k, { screen: 'newpin', pin: '', np1: '', msg: '', info: false }); renderKiosk(); };
function kCancel() {
  const k = S.k;
  if (k.sid && k.verified) B.pinRelease(k.sid).catch(() => { });
  S.k = { screen: 'tiles' }; renderKiosk();
}
function kDigit(d) {
  const k = S.k; if (k.busy || !/^\d$/.test(d)) return;
  if (k.pin.length >= 4) return;
  k.pin += d; k.shake = false; if (k.screen === 'pin') k.msg = '';
  renderKiosk();
  if (k.pin.length === 4) { if (k.screen === 'pin') kCheck(); else kNewPinStep(); }
}
async function kCheck() {
  const k = S.k, sid = k.sid, pin = k.pin;
  k.busy = true; renderKiosk();
  try {
    const r = await B.pinTry(sid, pin);
    // (a laptop: where it is decides which buttons — away from the office, clock in and out only)
    if (r.ok && isLaptopHere()) k.net = (await kNet()).net;
    k.busy = false; k.pin = '';
    if (r.ok) { k.verified = true; k.verifiedAt = Date.now(); k.screen = 'acts'; k.msg = ''; }
    else { k.shake = true; k.msg = r.locked ? 'Too many wrong PINs. Try again at ' + TCE.timeText(r.until) + ', or ask a manager.' : 'Wrong PIN. ' + plural(r.left, 'try', 'tries') + ' left.'; }
  } catch (e) { k.busy = false; k.pin = ''; k.msg = /network|unavailable/i.test((e && (e.code || e.message)) || '') ? 'Can’t reach the server. Check the internet and try again.' : errText(e); }
  if (S.k === k) renderKiosk();
}
ACT.kOtYes = () => { const k = S.k; k.otOk = true; ACT.kPunch({ dataset: { kind: k.otKind } }); };
ACT.kLunchLeft = () => { const k = S.k; k.lunchOk = true; ACT.kPunch({ dataset: { kind: 'out' } }); };
/* "Did you come back from lunch?" — clocking out more than an hour after going to lunch, with no Back in between */
function kLunchQHTML() {
  const k = S.k, w = weekFor(k.sid, null, true);
  return '<div class="kPanel kDone">' + '<div class="kCheck kWarnC">' + ic('lunch', 46) + '</div>' +
    '<div class="kDoneT">Did you come back from lunch?</div><div class="kDoneN">' + esc(nameOf(k.sid)) + '</div>' +
    '<div class="kNote warn">You went to lunch at ' + esc(TCE.timeText(w.since)) + '. If you came back and worked, say when — otherwise the afternoon counts 0 hours.</div>' +
    '<div class="kBtns"><button class="kBig" data-act="kReq" data-k="lunch" data-back="1">' + ic('back', 26) + '<span>I came back: forgot to punch</span></button>' +
    '<button class="kBig k-out" data-act="kLunchLeft">' + ic('out', 26) + '<span>No, I left at lunch</span></button>' +
    '<button class="kBig kGhost" data-act="kActs">Back</button></div></div>';
}
ACT.kPunch = async b => {
  const k = S.k, sid = k.sid, kind = b.dataset.kind; if (k.busy) return;
  const before = weekFor(sid, null, true), now = nowMs();
  if ((kind === 'in' || kind === 'back') && !k.otOk && otNotOk(weekFor(sid))) { Object.assign(k, { screen: 'otok', otKind: kind, msg: '' }); renderKiosk(); return; }
  if (kind === 'out' && before.state === 'lunch' && before.since && now - before.since > TCE.HOUR && !k.lunchOk) { Object.assign(k, { screen: 'lunchq', msg: '' }); renderKiosk(); return; }
  k.busy = true; k.msg = ''; renderKiosk();
  const slow = setTimeout(() => { if (S.k === k && k.busy) { k.msg = 'Still saving… the internet is slow. Please wait.'; k.msgOk = false; renderKiosk(); } }, 5000);
  try {
    await B.ping(6000); // (the database answers right now: otherwise the punch would wait unseen)
  } catch (e) {
    clearTimeout(slow); k.busy = false; k.msgOk = false; k.screen = k.screen === 'otok' || k.screen === 'lunchq' ? 'acts' : k.screen;
    k.msg = 'Can’t reach the server, so the punch can’t be saved right now. Write your time down and tell a manager.';
    if (S.k === k) renderKiosk(); return;
  }
  // where it is right now (the office lock): the time clock is never refused for it — off the office network the punch is
  // flagged; a laptop away from the office clocks in and out only, for someone allowed home
  const homeOk = (S.staff.get(sid) || {}).home === true;
  const awayNo = n => isLaptopHere() && n !== 'office' && !(homeOk && (kind === 'in' || kind === 'out'));
  let nc = await kNet();
  if (isLaptopHere() && nc.net === 'unk') nc = await kNet(); // (a laptop that couldn't check: once more before it counts as away)
  const awayMsg = nc.net === 'unk' && !homeOk ? 'Couldn’t check the office network just now: try again in a moment, or use the time clock.'
    : homeOk ? 'This laptop isn’t on the office network now: clock in and out only.' : 'This laptop isn’t on the office network, so it can’t clock you in. Use the time clock at the office.';
  if (isLaptopHere()) k.net = nc.net;
  if (awayNo(nc.net)) {
    clearTimeout(slow); Object.assign(k, { busy: false, msgOk: false, screen: 'acts', msg: awayMsg });
    if (S.k === k) renderKiosk(); return;
  }
  try {
    let r;
    try { r = await B.punch(sid, kind, nc.net, nc.pid); }
    catch (e) {
      // not taken as "at the office" (a newer check came in between, or the office's network was just removed): the time
      // clock saves it anyway, flagged (it couldn't be checked); a laptop checks once more
      if (!(nc.net === 'office' && B.isPerm(e))) throw e;
      nc = isLaptopHere() ? await kNet() : { net: 'unk', pid: '' };
      if (isLaptopHere()) k.net = nc.net;
      if (awayNo(nc.net)) throw errCode('away', awayMsg);
      r = await B.punch(sid, kind, nc.net, nc.pid);
    }
    const net = nc.net;
    if (!S.punches.has(r.id)) S.punches.set(r.id, { id: r.id, sid, kind, at: r.at, src: isLaptopHere() ? 'laptop' : 'kiosk', net, by: B.kiosk ? B.kiosk.uid : '' }); // (the live copy is on its way)
    Object.assign(k, { busy: false, verified: false, otOk: false, lunchOk: false, screen: 'done', done: { kind, at: r.at, w: weekFor(sid), before, net }, doneAt: Date.now() });
  } catch (e) {
    k.busy = false; k.msgOk = false;
    if (e && e.code === 'away') Object.assign(k, { screen: 'acts', msg: e.message });
    else if (e && e.code === 'timeout') Object.assign(k, { screen: 'acts', msg: 'Not confirmed: the internet is very slow. Don’t punch again. In a minute, look at your name on the time clock: if the punch isn’t there, tell a manager.' });
    else if (B.isPerm(e)) Object.assign(k, { screen: 'pin', pin: '', verified: false, msg: kRefused(k) });
    else { k.screen = 'acts'; k.msg = errText(e); }
  } finally { clearTimeout(slow); }
  if (S.k === k) renderKiosk();
};
/* the database didn't take it: the PIN's 5 minutes ran out — or something just changed (a setting, the network) */
function kRefused(k) { return Date.now() - (k.verifiedAt || 0) > 4.5 * 60000 ? 'That took too long. Type your PIN again.' : 'That punch wasn’t taken: something just changed (a setting, or the network). Type your PIN again, and if it happens again, tell a manager.'; }
/* a laptop that couldn't check the office network: check again */
ACT.kNetAgain = async () => {
  const k = S.k; if (k.busy) return;
  k.busy = true; renderKiosk();
  k.net = (await kNet()).net; k.busy = false;
  if (S.k === k) renderKiosk();
};
ACT.kReq = b => {
  const k = S.k, wp = weekFor(k.sid, null, true);
  const kind = (b && b.dataset.k) || (wp.state === 'out' ? 'in' : 'lunch');
  k.req = { kind, day: (b && b.dataset.day) || TCE.dayOf(nowMs()), t1: '', t2: '', note: '' };
  Object.assign(k, { screen: 'req', msg: '', msgOk: false }); renderKiosk();
  const t = $(b && b.dataset.back ? '#krT2' : '#krT1'); if (t) t.focus(); // (came back from lunch: "Back at")
};
ACT.krKind = b => { const f = S.k.req; f.kind = b.dataset.k; if (f.kind !== 'lunch') f.t2 = ''; S.k.msg = ''; renderKiosk(); };
ACT.krDay = b => { S.k.req.day = b.dataset.day; S.k.msg = ''; renderKiosk(); };
ACT.kReqSend = async () => {
  const k = S.k; if (k.busy) return;
  const q = reqFromForm(k.req, k.sid);
  if (q.err) { k.msg = q.err; renderKiosk(); return; }
  k.busy = true; k.msg = ''; renderKiosk();
  try {
    await B.reqSend(k.sid, q.ps, q.note);
    Object.assign(k, { busy: false, screen: 'acts', msgOk: true, msg: q.ps.length ? 'Sent. A manager will approve it; until then it doesn’t count. You can punch now.' : 'Your note went to the managers.' });
  } catch (e) {
    k.busy = false;
    if (B.isPerm(e)) Object.assign(k, { screen: 'pin', pin: '', verified: false, msg: 'That took too long. Type your PIN again.' });
    else k.msg = e && e.code === 'timeout' ? 'Not confirmed: the internet is very slow. Look under My week in a minute; if it isn’t there, tell a manager.' : errText(e);
  }
  if (S.k === k) renderKiosk();
};
ACT.kReqUndo = async b => {
  const k = S.k; if (k.busy) return;
  k.busy = true; renderKiosk();
  try { await B.reqTakeBack(b.dataset.id, true); Object.assign(k, { busy: false, msgOk: true, msg: 'Taken back.' }); }
  catch (e) { k.busy = false; if (B.isPerm(e)) Object.assign(k, { screen: 'pin', pin: '', verified: false, msg: 'That took too long. Type your PIN again.' }); else { k.msg = errText(e); k.msgOk = false; } }
  if (S.k === k) renderKiosk();
};
/* what's typed in the form is kept as it's typed (the form is drawn again when someone picks a punch or a day) */
document.addEventListener('input', e => {
  const t = e.target, f = t && t.dataset && t.dataset.rq;
  if (!f) return;
  const form = S.mode === 'kiosk' && S.k.screen === 'req' ? S.k.req : S.rq;
  if (form) form[f] = t.value;
});
async function kNewPinStep() {
  const k = S.k, pin = k.pin;
  if (!k.np1) {
    if (weakPin(pin)) { k.pin = ''; k.msg = 'Pick something harder to guess (not ' + pin + ').'; k.shake = true; renderKiosk(); return; }
    k.np1 = pin; k.pin = ''; k.msg = ''; renderKiosk(); return;
  }
  if (pin !== k.np1) { Object.assign(k, { pin: '', np1: '', msg: 'Those didn’t match. Type a new PIN.', shake: true }); renderKiosk(); return; }
  k.busy = true; renderKiosk();
  try {
    await B.pinChange(k.sid, pin);
    Object.assign(k, { busy: false, verified: false, newPin: true, screen: 'done', done: { kind: '', at: nowMs(), w: weekFor(k.sid), before: weekFor(k.sid) }, doneAt: Date.now() });
  } catch (e) {
    k.busy = false;
    if (B.isPerm(e)) Object.assign(k, { screen: 'pin', pin: '', verified: false, np1: '', msg: 'That took too long. Type your current PIN again.' });
    else { k.pin = ''; k.np1 = ''; k.msg = errText(e); }
  }
  if (S.k === k) renderKiosk();
}
function kioskKey(e) {
  if ($('#modalWrap')) return;
  const k = S.k;
  if ((k.screen === 'pin' || k.screen === 'newpin') && /^\d$/.test(e.key)) { e.preventDefault(); kDigit(e.key); }
  else if ((k.screen === 'pin' || k.screen === 'newpin') && e.key === 'Backspace') { e.preventDefault(); ACT.kBack(); }
  else if (e.key === 'Escape' && k.screen !== 'tiles') { e.preventDefault(); kCancel(); }
}

/* ---------- a manager at the time clock ---------- */
ACT.kMgr = () => {
  const w = openModal('<h3>Manager sign-in</h3><p class="lsub">For Dr. A and the time clock managers he adds. It signs out by itself after 3 minutes without use, and the time clock comes back.</p>' +
    (S.demo ? '<div class="notice info">In the demo this signs in as Dr. A.</div>' : '') +
    '<form id="kMgrForm"><div class="field"><label for="kmU">Username</label><input id="kmU" autocomplete="off" autocapitalize="none" spellcheck="false"' + (S.demo ? '' : ' required') + '></div>' +
    '<div class="field"><label for="kmP">Password</label><input id="kmP" type="password" autocomplete="off"' + (S.demo ? '' : ' required') + '></div>' +
    '<div class="lockErr hidden" id="kmErr" role="alert"></div>' +
    '<div class="mFt"><button type="button" class="btn btn-sec" data-act="kMgrNo">Cancel</button><button class="btn btn-pri" id="kmBtn" type="submit">Sign in</button></div></form>');
  $('#kMgrForm', w).onsubmit = async e => {
    e.preventDefault(); const btn = $('#kmBtn'); busyBtn(btn, true, 'Signing in…');
    try {
      if (S.demo) await B.signInAs('owner'); else await B.signIn($('#kmU').value, $('#kmP').value, false);
      if (!B.isMgr()) { await B.signOut(); throw errCode('x', 'Only managers sign in here. Staff use their PIN on the time clock.'); }
      closeModal(); B.stop(); S.fromKiosk = true; S.stay = false; enterApp();
    } catch (x) { busyBtn(btn, false); const m = $('#kmErr'); m.textContent = errText(x); m.classList.remove('hidden'); }
  };
};
ACT.kMgrNo = () => closeModal();
