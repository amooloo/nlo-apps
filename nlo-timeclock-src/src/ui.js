/* =====================================================================
   UI — starting up (this computer as the time clock, or a person
   signing in), the data as it arrives, the app shell, and the small
   pieces every screen uses. The time clock's own screens are in
   kiosk.js; the managers' and staff screens in views.js.
   ===================================================================== */
const S = {
  demo: false, emu: false, mode: '', view: 'now', role: '', stay: false, fromKiosk: false,
  roster: new Map(), staff: new Map(), punches: new Map(), fixes: new Map(), ot: new Map(), tries: new Map(), reqs: new Map(), mgrs: new Set(),
  setRaw: null, set: TCE.settingsOf({}), alerts: null, kiosks: [], laptops: [], lapReqs: [], offices: [], beat: [], sent: [], got: {},
  myNet: null, kNet: null, kNets: {}, // the office lock: where this device is (the last check), and where each time clock was seen
  lapAsk: null, // a laptop asking Dr. A to approve it: { uid, code, at, off (stops waiting) }
  netBots: [], netBotsAt: 0, // the office check's logins that work right now (Dr. A's Settings)
  from: 0, rulesOk: true, week: '', person: '', pay: null, lastAct: Date.now(), timers: [], renderQ: false, loadErr: '',
  k: { screen: 'tiles' }
};
let B = null;
const ACT = Object.create(null); // click actions: data-act="name" → ACT.name(target, event)
const CHG = Object.create(null); // change handlers: data-chg="name"
const TC_RULES = ""; // the build puts the office's whole Firestore rules file here (for Dr. A's "publish the rules" card)
const DEMO_ONLY = false; // the demo-only build (made-up office, nothing to sign in to) sets this
const LOGO = 'logo-white.png'; // the demo-only build carries the logo inside the page
const MGR_IDLE_MIN = 10;

/* ---------- icons ---------- */
const IC = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  board: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M9 9.5v10"/>',
  sheet: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9v6M17.5 9v6"/>',
  people: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.8 19.5c.9-3.3 3.3-5 6.2-5s5.3 1.7 6.2 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.2 14.6c2.6-.2 4.4 1.2 5 4.4"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>',
  lunch: '<path d="M5 9h11v5a4.5 4.5 0 01-4.5 4.5h-2A4.5 4.5 0 015 14z"/><path d="M16 10.5h1.5a2.5 2.5 0 010 5H16"/><path d="M8.5 3.5v3M12 3.5v3"/>',
  in: '<path d="M10 7l5 5-5 5"/><path d="M15 12H3.5"/><path d="M14 4.5h4.5a2 2 0 012 2v11a2 2 0 01-2 2H14"/>',
  out: '<path d="M14 7l5 5-5 5"/><path d="M19 12H7.5"/><path d="M10 4.5H5.5a2 2 0 00-2 2v11a2 2 0 002 2H10"/>',
  back: '<path d="M9 7l-5 5 5 5"/><path d="M4 12h11.5a4.5 4.5 0 010 9H13"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.3"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
  next: '<path d="M9 6l6 6-6 6"/>', prev: '<path d="M15 6l-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  tick: '<path d="M5.5 12.5l4.2 4.2 8.8-9"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.5 2.4 5.2-5.2"/>',
  warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17v.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4.5 19.5l1-4 10-10 3 3-10 10z"/><path d="M13.5 7.5l3 3"/>',
  trash: '<path d="M5 7h14M10 4h4M7 7l1 12.5h8L17 7"/>',
  undo: '<path d="M8.5 6.5L4 11l4.5 4.5"/><path d="M4.5 11h10a5 5 0 010 10h-3"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 17.5h2"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="M4 7l8 6 8-6"/>',
  shield: '<path d="M12 3l7 2.8v5.5c0 4.4-3 7.5-7 9.2-4-1.7-7-4.8-7-9.2V5.8z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  bksp: '<path d="M9 5.5h10.5a1.5 1.5 0 011.5 1.5v10a1.5 1.5 0 01-1.5 1.5H9L3.5 12z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

/* ---------- toasts, modals ---------- */
function toast(msg, opt) {
  opt = opt || {}; const el = document.createElement('div'); el.className = 'toast' + (opt.bad ? ' bad' : ''); el.setAttribute('role', 'status');
  el.textContent = msg; $('#toasts').appendChild(el); setTimeout(() => el.remove(), opt.ms || 4200);
}
function errText(e) {
  const c = (e && (e.code || e.message)) || '';
  if (/no-user/.test(c)) return 'No login with that username.';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'Username or password is incorrect.';
  if (/inactive/.test(c)) return 'This login has been turned off. Ask Dr. A.';
  if (/not-member/.test(c)) return 'That account isn’t part of the office.';
  if (/first-login/.test(c)) return 'Finish setting up your login in NLO Cases first (sign in there with your temporary password and choose your own), then come back.';
  if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a minute and try again.';
  if (/network|unavailable/.test(c)) return 'Can’t reach the server. Check the internet connection.';
  if (/^demo$/.test(c)) return (e && e.message) || 'Pick someone below.';
  if (/permission/.test(c)) return 'Not allowed. ' + (S.role === 'mgr' ? 'Only Dr. A changes that, and nobody corrects their own time except Dr. A.' : 'Your access may have changed.');
  if (/requires-recent-login/.test(c)) return 'Please sign in again, then retry.';
  if (/^timeout$/.test(c)) return 'Not confirmed: the internet is very slow. Check in a minute whether it went through before trying again.';
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}
function openModal(html, cls) {
  closeModal(); const w = document.createElement('div'); w.id = 'modalWrap';
  w.innerHTML = '<div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
  w.addEventListener('mousedown', e => { if (e.target === w) closeModal(); });
  document.body.appendChild(w);
  const f = $('input:not([type=hidden]):not([disabled]),select,textarea,button.btn', w); if (f) setTimeout(() => { if (!w.contains(document.activeElement)) f.focus(); }, 30);
  return w;
}
function closeModal() { const m = $('#modalWrap'); if (m) m.remove(); }
function confirmBox(title, body, okLabel, danger) {
  return new Promise(res => {
    const w = openModal('<h3>' + esc(title) + '</h3><p class="lsub" style="margin-bottom:18px">' + body + '</p><div class="mFt"><button class="btn btn-sec" data-x="no">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + '" data-x="yes">' + esc(okLabel || 'OK') + '</button></div>');
    $$('[data-x]', w).forEach(b => { b.onclick = () => { closeModal(); res(b.dataset.x === 'yes'); }; });
  });
}
function busyBtn(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.innerHTML; btn.textContent = label || 'Saving…'; btn.disabled = true; } else { if (btn.dataset.l) btn.innerHTML = btn.dataset.l; btn.disabled = false; } }
async function act(btn, fn, okMsg) {
  busyBtn(btn, true);
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) { toast(errText(e), { bad: true }); return false; }
  finally { busyBtn(btn, false); }
}

/* ---------- the time, people, the clock's arithmetic ---------- */
function nowMs() { return B ? B.now() : Date.now(); }
function ms(t) { return t && t.toMillis ? t.toMillis() : (typeof t === 'number' ? t : 0); }
function person(sid) { return S.roster.get(sid) || null; }
/* the name a screen shows: "Dr. A" for the owner; on the time clock, first names (with a last initial when two match) */
function nameOf(sid) { const r = person(sid); return r ? (r.role === 'owner' ? 'Dr. A' : r.name) : 'Someone'; }
function shortOf(sid) {
  const r = person(sid); if (!r) return 'Someone'; if (r.role === 'owner') return 'Dr. A';
  const f = firstName(r.name), twins = Array.from(S.roster.values()).filter(x => x.active && x.sid !== sid && firstName(x.name) === f);
  if (!twins.length) return f;
  const last = String(r.name).trim().split(/\s+/).pop(); return f + ' ' + (last && last !== f ? last[0] + '.' : '');
}
function avatar(sid, cls) {
  const r = person(sid), n = r ? nameOf(sid) : '?';
  return '<span class="av ' + (cls || '') + '" aria-hidden="true">' + (r && r.photo ? '<img alt="" data-photo="' + esc(sid) + '">' : esc(initials(n))) + '</span>';
}
function paintPhotos(root) { $$('img[data-photo]', root || document).forEach(img => { const r = person(img.dataset.photo); if (r && r.photo && /^data:image\//.test(r.photo)) img.src = r.photo; }); }
function onClockList() {
  return Array.from(S.roster.values()).filter(r => r.active && S.staff.get(r.sid) && S.staff.get(r.sid).on)
    .sort((a, b) => shortOf(a.sid).localeCompare(shortOf(b.sid)));
}
function staffOf(sid) { return TCE.staffOf(S.staff.get(sid)); }
/* someone's entries (punches and corrections); withReqs: with the punches they've asked for and are waiting on, for their
   own screens and the time clock's next button (those count no hours until a manager approves them) */
function listOf(sid, withReqs) {
  const p = [], f = [];
  S.punches.forEach(x => { if (x.sid === sid) p.push(x); });
  S.fixes.forEach(x => { if (x.sid === sid) f.push(x); });
  const list = TCE.entries(p, f);
  return withReqs ? TCE.withReqs(list, reqsOf(sid, 'open')) : list;
}
/* someone's requests to fix their time, newest first (st: only those waiting, 'open') */
function reqsOf(sid, st) { const out = []; S.reqs.forEach(r => { if (r.sid === sid && (!st || r.st === st)) out.push(r); }); return out.sort((a, b) => b.at - a.at); }
function openReqs() { const out = []; S.reqs.forEach(r => { if (r.st === 'open') out.push(r); }); return out.sort((a, b) => a.at - b.at); }
function approvedOf(sid, wk) { const o = S.ot.get(sid + '_' + wk); return o && o.hrs > 0 ? o.hrs : 0; }
function curWeek() { return TCE.weekOf(TCE.dayOf(nowMs()), S.set.wk); }
function weekFor(sid, wk, withReqs) { return TCE.week({ sid, list: listOf(sid, withReqs), set: S.set, staff: staffOf(sid), wkIso: wk || curWeek(), now: nowMs(), approved: approvedOf(sid, wk || curWeek()) }); }
const KIND = { in: 'Clocked in', lunch: 'Out to lunch', back: 'Back from lunch', out: 'Clocked out' };
const KSHORT = { in: 'In', lunch: 'Lunch', back: 'Back', out: 'Out' };
/* what someone can do next, given where they are */
function nextKinds(state) { return state === 'in' ? ['lunch', 'out'] : state === 'lunch' ? ['back', 'out'] : ['in']; }
function stateText(w) {
  if (w.state === 'in') return 'In since ' + TCE.timeText(w.since) + (w.src === 'home' ? ' (home)' : w.src === 'req' ? ' (waiting for a manager)' : '');
  if (w.state === 'lunch') return 'At lunch since ' + TCE.timeText(w.since);
  return 'Out';
}
/* the heads-up someone sees for their week (Amir, 9 Oct 2026: a warning that they're getting close to 40 hours, and only
   approved overtime lets them go over). ot: the overtime ones, shown as a pop-up at the time clock and on My time. */
function headsUp(w, set) {
  const out = [], lim = set.ot, H = TCE.HOUR;
  if (w.sal) return out; // salaried: the hours are only kept for the record
  const today = TCE.dayOf(nowMs()), when = t => TCE.timeText(t) + (TCE.dayOf(t) === today ? ' today' : ' ' + TCE.dayText(TCE.dayOf(t)));
  if (w.approved > w.limit) {
    if (w.total > w.approved) out.push({ bad: true, ot: true, h: 'Past the overtime approved', t: 'You’re at ' + TCE.hmDur(w.total) + ' this week; overtime was approved up to ' + TCE.h2(w.approved) + ' h. Going past it needs a manager’s OK — a manager has been told.' });
    else if (w.eta.approved) out.push({ warn: true, ot: true, h: 'Overtime approved up to ' + TCE.h2(w.approved) + ' h', t: 'You’ll reach it at about ' + when(w.eta.approved) + ' if you stay clocked in. Going past it needs a manager’s OK.' });
    else out.push({ t: 'Overtime approved up to ' + TCE.h2(w.approved) + ' h this week.' });
  } else if (w.total >= w.limit) out.push({ bad: true, ot: true, h: 'In overtime without approval', t: 'You’re at ' + TCE.hmDur(w.total) + ' this week (overtime starts at ' + lim + ' h), and your overtime isn’t approved. Only a manager can approve it — a manager has been told.' });
  else {
    const near = set.thr.length ? Math.min.apply(null, set.thr) * H : lim * H - 4 * H;
    if (w.total >= near || w.eta.ot) out.push({ warn: true, ot: true, h: 'Getting close to overtime', t: 'You’re at ' + TCE.hmDur(w.total) + ' this week. Overtime starts at ' + lim + ' h' + (w.eta.ot ? ', about ' + when(w.eta.ot) + ' if you stay clocked in' : '') + '. Only a manager can approve overtime, so clock out ' + (w.eta.ot ? 'by then' : 'before ' + lim + ' h') + ' unless it’s approved.' });
  }
  if (w.cap && w.cap < w.limit) {
    if (w.total >= w.cap) out.push({ warn: true, t: 'Past the ' + TCE.h2(w.cap) + ' h weekly cap set for you.' });
    else if (w.eta.cap && w.cap - w.total <= 2 * H) out.push({ warn: true, t: 'Your weekly cap is ' + TCE.h2(w.cap) + ' h: about ' + TCE.timeText(w.eta.cap) + ' if you stay clocked in.' });
  }
  return out;
}
/* clocking in (or back from lunch) now would be overtime nobody approved: they're asked first, and a manager is told */
function otNotOk(w) { return !w.sal && (w.approved > w.limit ? w.total >= w.approved : w.total >= w.limit); }

/* ---------- the data as it arrives ---------- */
function ingest(kind, data) {
  const map = (list, conv) => { const m = new Map(); (list || []).forEach(x => { const v = conv(x); if (v) m.set(v.key || x.id, v); }); return m; };
  if (kind === 'error') {
    const e = data && data.e;
    // an approved laptop: refused for one of its people — Dr. A may have just changed who uses it, or taken it back
    if (B.isPerm(e) && data.who && isLaptopHere()) { lapRecheck(data.who, e); return; }
    S.loadErr = B.isPerm(e) ? 'perm' : 'net';
    if (S.loadErr === 'perm' && !S.permChecked) { S.permChecked = true; B.rulesOk(S.mode === 'kiosk').then(ok => { S.rulesOk = ok; queueRender(); }).catch(() => { }); }
    queueRender(); return;
  }
  if (kind === 'lapself') { lapSelf(data); return; }
  S.got[kind] = true;
  if (kind === 'set') { S.setRaw = data; S.set = TCE.settingsOf(data); }
  else if (kind === 'roster') {
    S.roster = map(data, x => ({ key: x.id, sid: x.id, name: String(x.name || x.id), role: x.role || 'staff', active: x.active === true, photo: typeof x.photo === 'string' ? x.photo : '' }));
  }
  else if (kind === 'staff') S.staff = map(data, x => Object.assign({ key: x.id }, x));
  else if (kind === 'staff1') { S.staff = new Map(); if (data) S.staff.set(data.id, data); }
  else if (kind === 'punch') {
    S.punches = map(data, x => (x.sid && TCE.KINDS.includes(x.kind) ? { key: x.id, id: x.id, sid: x.sid, kind: x.kind, at: ms(x.at) || nowMs(), src: ['kiosk', 'own', 'laptop', 'home'].includes(x.src) ? x.src : 'kiosk', net: ['office', 'off', 'unk'].includes(x.net) ? x.net : '', by: x.by || '' } : null));
  }
  else if (kind === 'fix') {
    S.fixes = map(data, x => (x.sid && (x.op === 'add' || x.op === 'void') ? { key: x.id, id: x.id, sid: x.sid, op: x.op, ref: x.ref || '', kind: x.kind || '', t: Number(x.t) || 0, why: x.why || '', by: x.by || '', bsid: x.bsid || '', at: ms(x.at) || nowMs() } : null));
  }
  else if (kind === 'ot') S.ot = map(data, x => (x.sid && x.week ? { key: x.sid + '_' + x.week, sid: x.sid, week: x.week, hrs: Number(x.hrs) || 0, why: x.why || '', bsid: x.bsid || '', at: ms(x.at) } : null));
  else if (kind === 'try') S.tries = map(data, x => ({ key: x.id, sid: x.id, n: Number(x.n) || 0, t0: ms(x.t0), at: ms(x.at), ok: x.ok === true }));
  else if (kind === 'kiosks') S.kiosks = (data || []).map(x => ({ uid: x.id, name: x.name || 'Time clock', at: ms(x.at), seen: ms(x.seen) }));
  else if (kind === 'laptops') S.laptops = (data || []).map(x => ({ uid: x.id, name: x.name || 'Laptop', sids: Array.isArray(x.sids) ? x.sids.filter(y => typeof y === 'string') : [], at: ms(x.at), seen: ms(x.seen) }));
  else if (kind === 'offices') S.offices = (data || []).map(x => ({ net: x.id, name: x.name || 'Office', org: x.org || '', city: x.city || '', at: ms(x.at) })).sort((a, b) => a.at - b.at);
  else if (kind === 'lapreqs') S.lapReqs = lapReqsOf(data);
  else if (kind === 'beat') S.beat = (data || []).map(x => ({ uid: x.id, box: x.box || '', ver: x.ver || '', err: x.err || '', sent: Number(x.sent) || 0, at: ms(x.at) }));
  else if (kind === 'sent') S.sent = (data || []).map(x => ({ id: x.id, type: x.type || '', sid: x.sid || '', text: x.text || '', st: x.st || '', ch: Number(x.ch) || 0, at: ms(x.at) }));
  else if (kind === 'alerts') S.alerts = data;
  else if (kind === 'mgrs') S.mgrs = new Set((data || []).map(x => x.id));
  else if (kind === 'req') {
    S.reqs = map(data, x => (x.sid && ['open', 'ok', 'no', 'x'].includes(x.st) ? {
      key: x.id, id: x.id, sid: x.sid, ps: (Array.isArray(x.ps) ? x.ps : []).map(p => ({ k: p && p.k, t: Number(p && p.t) || 0 })).filter(p => TCE.KINDS.includes(p.k) && p.t > 0).slice(0, 2),
      note: String(x.note || '').slice(0, 200), src: x.src === 'kiosk' || x.src === 'laptop' ? x.src : 'me', at: ms(x.at) || nowMs(), st: x.st,
      rbsid: x.rbsid || '', rat: ms(x.rat), rwhy: String(x.rwhy || ''), fx: Array.isArray(x.fx) ? x.fx : []
    } : null));
  }
  if ((kind === 'punch' || kind === 'fix' || kind === 'ot') && S.pay && S.pay.data) S.pay.stale = true; // (payroll reads the period again)
  S.loadErr = '';
  queueRender();
}
/* a locked-out PIN: 5 wrong tries in the last 10 minutes */
function lockedUntil(sid) { const t = S.tries.get(sid); if (!t || t.n < 5 || t.ok) return 0; const u = t.t0 + 10 * TCE.MIN; return u > nowMs() ? u : 0; }

/* ---------- boot ---------- */
window.addEventListener('pageshow', e => { if (e.persisted && S.mode === 'app') location.reload(); });
async function boot() {
  if (!DEMO_ONLY && window.top !== window.self) { document.body.innerHTML = '<p style="font:15px sans-serif;padding:24px">NLO Time Clock opens in its own tab. <a href="nlo-timeclock.html" target="_blank" rel="noopener">Open it</a>.</p>'; return; }
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.demo = DEMO_ONLY || qs.has('demo'); S.emu = !DEMO_ONLY && local && qs.has('emu');
  if (DEMO_ONLY) $$('img[src="logo-white.png"]').forEach(i => { i.src = LOGO; });
  document.addEventListener('click', onClick);
  document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.chg && CHG[t.dataset.chg]) CHG[t.dataset.chg](t, e); });
  document.addEventListener('keydown', onKey);
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true }));
  setInterval(tick, 1000);
  if (S.demo) {
    B = DEMO; B.seedNow(); $('#demoBar').classList.remove('hidden'); document.body.classList.add('demo'); demoBar();
    const meta = $('.lockMeta'); if (meta) meta.textContent = 'Demo · made-up people · nothing is saved';
    if (qs.has('kiosk')) { await B.kioskOpen(); enterKiosk(); return; }
    lockScreen('demo'); return;
  }
  B = FB;
  if (!FB.init(S.emu)) { lockScreen('unconfigured'); return; }
  FB.onSync = renderSync;
  lockScreen('loading');
  window.addEventListener('online', renderSync); window.addEventListener('offline', renderSync);
  let r;
  try { r = await FB.restore(); } catch (e) { lockScreen('login', { err: errText(e) }); return; }
  afterRestore(r);
}
async function afterRestore(r) {
  // this computer is a time clock (or laptop), but its record couldn't be read just now: keep trying, never sign it out
  if (r.kioskErr) { kioskRetry(r.kioskErr); return; }
  if (r.kiosk) { if (r.person) await FB.signOut(); enterKiosk(); return; }
  if (r.lapWait) { lapWaitStart(r.lapWait); return; } // (a laptop asked Dr. A to approve it: still waiting)
  if (r.person) { S.stay = true; enterApp(); return; }
  lockScreen('login', r.kioskGone ? { err: 'This computer isn’t set up as the time clock or an approved laptop any more (Dr. A removed it, or didn’t approve it). Dr. A can set it up again.' } : {});
}
/* a time clock that can't read its own record (no internet, or the database's rules): tries again by itself, sooner at
   first; the screen says why */
let kioskRetryT = 0, kioskRetryN = 0;
function kioskRetry(e) {
  clearTimeout(kioskRetryT);
  const perm = FB.isPerm(e);
  lockScreen('kioskwait', { err: perm ? 'The database refused to read this time clock. If Dr. A just published database rules from another NLO app, he needs to publish them again from Time Clock (signed in as himself).' : 'No answer from the database: check the internet.' });
  kioskRetryT = setTimeout(kioskRetryNow, Math.min(60000, 5000 * (++kioskRetryN)));
}
async function kioskRetryNow() {
  clearTimeout(kioskRetryT);
  if (S.mode !== 'lock') return;
  let r;
  try { r = await FB.restore(); } catch (e) { kioskRetry(e); return; }
  if (!r.kioskErr) kioskRetryN = 0;
  afterRestore(r);
}
ACT.kioskRetryNow = b => { busyBtn(b, true, 'Trying…'); kioskRetryNow(); };
ACT.kioskSignIn = () => { clearTimeout(kioskRetryT); lockScreen('login'); };
/* every second: the time clock's clock; every 30 s: hours that run on while someone is clocked in; idle checks */
function tick() {
  const n = Date.now();
  if (S.mode === 'kiosk') kioskTick(n);
  if (S.mode === 'app') {
    if (S.role === 'mgr' && !S.stay && n - S.lastAct > (S.fromKiosk ? 3 : MGR_IDLE_MIN) * 60000) { lockOut(S.fromKiosk ? '' : 'Signed out after ' + MGR_IDLE_MIN + ' minutes without use.'); return; }
    if (!S.lastRender || n - S.lastRender > 30000) { if (!$('#modalWrap') && !document.activeElement.matches('input,select,textarea')) queueRender(); }
  }
}

/* ---------- lock screens (same logins as NLO Cases) ---------- */
function lockScreen(mode, info) {
  info = info || {};
  S.mode = 'lock';
  $('#lockWrap').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#kiosk').classList.add('hidden');
  const card = $('#lockCard'), err = info.err ? '<div class="lockErr" role="alert">' + esc(info.err) + '</div>' : '', ok = info.ok ? '<div class="lockOk" role="status">' + esc(info.ok) + '</div>' : '';
  let h = '';
  if (mode === 'loading') h = '<div class="lsub" style="text-align:center">Loading…</div>';
  else if (mode === 'unconfigured') h = '<h1>Almost ready</h1><div class="lsub">This copy isn’t connected to the office database.</div>';
  else if (mode === 'kioskwait') h = '<h1>Time clock</h1><div class="lsub">This computer is set up as a time clock, but it can’t read the time clock right now. It keeps trying by itself.</div>' + err +
    '<button class="btn btn-pri btn-block" data-act="kioskRetryNow" style="margin-top:14px">Try again now</button>' +
    '<div class="lockFoot"><button class="linkBtn" data-act="kioskSignIn">Sign in as a person instead</button></div>';
  else if (mode === 'demo') {
    h = '<h1>Try the time clock</h1><div class="lsub">A made-up office. It’s Thursday afternoon in the demo. Every PIN is <b>' + DEMO.PIN + '</b>.</div>' + err +
      '<div class="demoPick">' +
      '<button class="btn btn-mint btn-block" data-act="demoKiosk">' + ic('clock', 18) + 'The office time clock</button>' +
      '<button class="btn btn-pri btn-block" data-act="demoAs" data-who="owner">Dr. A (manager, owner)</button>' +
      '<button class="btn btn-sec btn-block" data-act="demoAs" data-who="manager">Morgan (a manager Dr. A added)</button>' +
      '<button class="btn btn-sec btn-block" data-act="demoLaptop">' + ic('monitor', 18) + 'Jamie’s approved laptop (works from home)</button>' +
      '<button class="btn btn-sec btn-block" data-act="demoAs" data-who="staff">Taylor (staff, on her phone)</button></div>' +
      '<p class="lsub" style="margin-top:12px">The office lock is on: phones and computers clock in only on the office network. Switch where this device pretends to be with the bar at the bottom.</p>';
  } else if (mode === 'lapask') {
    h = '<h1>Approve this laptop</h1><div class="lsub">For working from home: once Dr. A approves it, this laptop is a time clock for the people he picks, each with their PIN. Away from the office it clocks in and out only, marked Home.</div>' + err +
      '<ul class="lapSteps"><li>Use the browser you’ll clock in with (Chrome or Edge — not a private window), and keep using it: the approval stays in it.</li>' +
      '<li>This laptop shows a 6-digit code. Dr. A types it on his own phone or computer — his password never goes on this laptop.</li></ul>' +
      '<button class="btn btn-pri btn-block" id="lapAskBtn" data-act="lapAskGo">Ask Dr. A to approve it</button>' +
      '<button class="btn btn-sec btn-block" data-act="lapAskBack" style="margin-top:8px">Back</button>';
  } else if (mode === 'lapwait' && info.expired) {
    h = '<h1>The code ran out</h1><div class="lsub">A code works for 30 minutes. Ask again for a new one when Dr. A is ready to approve this laptop.</div>' + err +
      '<button class="btn btn-pri btn-block" data-act="lapAskAgain" style="margin-top:14px">Ask again</button>' +
      '<button class="btn btn-sec btn-block" data-act="lapAskCancel" style="margin-top:8px">Cancel</button>';
  } else if (mode === 'lapwait') {
    const c = String(info.code || '');
    h = '<h1>Waiting for Dr. A</h1><div class="lsub">To approve this laptop, Dr. A types this code on his own phone or computer: Time Clock → Settings → Approved laptops. It works for 30 minutes.</div>' + err +
      '<div class="lapCode" aria-label="Code ' + esc(c.split('').join(' ')) + '">' + esc(c.slice(0, 3)) + '<span></span>' + esc(c.slice(3)) + '</div>' +
      '<p class="lsub lapWaitNote" style="text-align:center">Keep this page open: it turns into the time clock as soon as he approves it.</p>' +
      '<button class="btn btn-sec btn-block" data-act="lapAskCancel">Cancel</button>';
  } else {
    h = '<h1>Sign in</h1><div class="lsub">Same username and password as NLO Cases.</div>' + err + ok +
      '<form id="signForm" autocomplete="on"><div class="field"><label for="lgUser">Username</label><input id="lgUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>' +
      '<div class="field"><label for="lgPw">Password</label><input id="lgPw" type="password" name="password" autocomplete="current-password" required></div>' +
      '<label class="chk"><input type="checkbox" id="lgStay"> Stay signed in on this device <span class="muted">(your own phone or computer only)</span></label>' +
      '<button class="btn btn-pri btn-block" id="lgBtn" type="submit">Sign in</button></form>' +
      '<div class="lockFoot">Clock in at the office time clock with your PIN, or here on your own phone or computer while you’re on the office Wi-Fi. Signing in is also for checking your own hours, and for managers.' +
      '<br><button class="linkBtn" data-act="lapAskStart">' + ic('monitor', 14) + ' A laptop for working from home? Approve this laptop</button></div>';
  }
  card.innerHTML = h;
  const f = $('#signForm');
  if (f) {
    f.onsubmit = async e => {
      e.preventDefault(); const btn = $('#lgBtn'); busyBtn(btn, true, 'Signing in…');
      try { S.stay = $('#lgStay').checked; await B.signIn($('#lgUser').value, $('#lgPw').value, S.stay); enterApp(); }
      catch (x) { busyBtn(btn, false); lockScreen('login', { err: errText(x) }); setTimeout(() => { const u = $('#lgUser'); if (u) u.focus(); }, 30); }
    };
    setTimeout(() => { const u = $('#lgUser'); if (u && !f.contains(document.activeElement)) u.focus(); }, 30);
  }
}
/* ---------- a laptop asking to be approved (on the laptop; Dr. A approves it from his own phone or computer) ---------- */
ACT.lapAskStart = () => lockScreen('lapask');
ACT.lapAskBack = () => lockScreen(S.demo ? 'demo' : 'login');
ACT.lapAskGo = async b => {
  busyBtn(b, true, 'Asking…');
  let r;
  try { r = await B.lapAsk(devText()); }
  catch (e) { lockScreen('lapask', { err: 'Couldn’t ask: ' + errText(e) }); return; }
  lapWaitStart(r);
};
function lapWaitStart(r) {
  lapWaitStop();
  S.lapAsk = r;
  const expired = () => nowMs() > r.at + 30 * TCE.MIN;
  lockScreen('lapwait', { code: r.code, expired: expired() });
  // (the code runs out after 30 minutes: the rules don't take an approval after that)
  r.tick = setInterval(() => { if (S.lapAsk !== r) { clearInterval(r.tick); return; } if (expired()) { clearInterval(r.tick); lockScreen('lapwait', { code: r.code, expired: true }); } }, 15000);
  r.off = B.lapWait(r.uid, async what => {
    if (S.lapAsk !== r) return;
    lapWaitStop();
    if (what === 'ok') { enterKiosk(); toast('Approved. This laptop is now a time clock for the people Dr. A picked.', { ms: 7000 }); return; }
    await B.lapCancel();
    lockScreen(S.demo ? 'demo' : 'login', { err: 'Dr. A didn’t approve this laptop. Ask him, then try again.' });
  });
}
function lapWaitStop() { const r = S.lapAsk; S.lapAsk = null; if (r) { if (r.off) r.off(); clearInterval(r.tick); } }
ACT.lapAskCancel = async b => {
  lapWaitStop();
  busyBtn(b, true, 'Cancelling…');
  await B.lapCancel();
  lockScreen(S.demo ? 'demo' : 'login');
};
/* the code ran out: this laptop's login goes, and it asks again with a new one */
ACT.lapAskAgain = async b => {
  lapWaitStop();
  busyBtn(b, true, 'Asking…');
  await B.lapCancel();
  ACT.lapAskGo(b);
};
ACT.demoAs = async b => { await B.signInAs(b.dataset.who); S.stay = true; enterApp(); };
ACT.demoKiosk = async () => { await B.kioskOpen(); enterKiosk(); };
/* the demo's bar: made-up people, and where this device pretends to be (the office lock checks it) */
function demoBar() {
  const w = B.where, seg = (v, l) => '<button type="button" data-act="demoWhere" data-w="' + v + '" aria-pressed="' + (w === v) + '">' + l + '</button>';
  $('#demoBar').innerHTML = '<span>Demo — made-up people, nothing is saved</span><span class="dbWhere">This device is: ' + seg('office', 'At the office') + seg('home', 'At home') + '</span>';
}
ACT.demoWhere = b => {
  B.setWhere(b.dataset.w); demoBar(); S.myNet = null; S.kNet = null;
  toast(b.dataset.w === 'home' ? 'Pretending this device is at home (not on the office network).' : 'Pretending this device is on the office Wi-Fi.');
  if (S.mode === 'kiosk') { kNetWatch(); renderKiosk(); } else queueRender();
};
ACT.demoLaptop = async () => { await B.kioskOpen('laptop'); enterKiosk(); };
async function lockOut(msg) {
  const back = S.fromKiosk && B.kiosk;
  S.timers.forEach(t => clearInterval(t)); S.timers = [];
  closeModal(); B.stop(); await B.signOut(); S.mode = ''; S.fromKiosk = false; S.view = 'now';
  if (back) { enterKiosk(); return; }
  if (S.demo) { lockScreen('demo'); return; }
  lockScreen('login', msg ? { ok: msg } : {});
}

/* ---------- a person's app ---------- */
async function enterApp() {
  S.mode = 'app'; S.role = B.isMgr() ? 'mgr' : 'staff'; S.lastAct = Date.now();
  S.view = S.role === 'mgr' ? 'now' : 'me';
  S.week = ''; S.got = {}; S.permChecked = false;
  $('#lockWrap').classList.add('hidden'); $('#kiosk').classList.add('hidden'); $('#app').classList.remove('hidden');
  try { S.rulesOk = await B.rulesOk(false); } catch (e) { S.rulesOk = true; }
  rewatch();
  renderShell(); renderView();
}
/* the window of punches read live: this workweek and the one on screen, with 3 days before (a clock-out missing from then) */
function windowFrom() {
  const cw = curWeek(), w = S.week && S.week < cw ? S.week : cw;
  return TCE.dayStart(TCE.addDays(w, -3));
}
function rewatch() {
  S.from = windowFrom();
  if (!S.rulesOk && S.mode === 'app') return;
  const lap = S.mode === 'kiosk' && B.kiosk && B.kiosk.kind === 'laptop';
  B.watch({ role: S.mode === 'kiosk' ? (lap ? 'laptop' : 'kiosk') : S.role, sid: B.me ? B.me.staffId : '', sids: lap ? B.kiosk.sids : [], from: S.from }, ingest);
}
const isLaptopHere = () => !!(B && B.kiosk && B.kiosk.kind === 'laptop');
/* ---------- an approved laptop keeps up with its own record: Dr. A changes who uses it, or takes it back ---------- */
function lapSidsOf(d) { return d && Array.isArray(d.sids) ? d.sids.filter(x => typeof x === 'string').slice(0, 4) : []; }
function lapSelf(d) {
  if (!isLaptopHere() || S.mode !== 'kiosk') return;
  if (!d) { B.lapSelfNow().then(x => { if (!x) lapGone(); else lapSelf(x); }, () => { }); return; } // (the server's word only)
  const k = B.kiosk, sids = lapSidsOf(d), name = String(d.name || 'Laptop');
  if (name !== k.name) { k.name = name; const n = $('#kName'); if (n) n.textContent = name; }
  if (sids.join('|') !== k.sids.join('|')) {
    k.sids = sids;
    if (S.k.sid && !sids.includes(S.k.sid)) S.k = { screen: 'tiles' }; // (someone mid-punch who was just taken off it)
    S.got = {}; rewatch(); renderKiosk();
  }
}
/* refused for one of its people: read its own record again (from the server) before saying something's wrong */
let lapChecking = false;
async function lapRecheck(who, e) {
  if (lapChecking) return;
  lapChecking = true;
  try {
    const d = await B.lapSelfNow();
    if (!d) { lapGone(); return; }
    if (!lapSidsOf(d).includes(who)) { lapSelf(d); return; } // (taken off this laptop: nothing wrong)
    S.loadErr = 'perm'; queueRender();
  } catch (x) { S.loadErr = B.isPerm(x) ? 'perm' : 'net'; queueRender(); }
  finally { lapChecking = false; }
}
/* taken back: this laptop's login goes, and it says so */
async function lapGone() {
  if (S.mode !== 'kiosk') return;
  S.mode = ''; S.timers.forEach(t => clearInterval(t)); S.timers = [];
  closeModal(); B.stop(); await B.kioskForget(); document.body.classList.remove('isLaptop');
  lockScreen(S.demo ? 'demo' : 'login', { err: 'This laptop isn’t approved any more (Dr. A took it back). Nobody can clock in on it until he approves it again.' });
}
/* the laptops asking Dr. A to be approved (the last day's; older ones are cleared away) */
const lapCleared = new Set();
function lapReqsOf(data) {
  const now = nowMs(), out = [];
  (data || []).forEach(x => {
    const at = ms(x.at) || now;
    if (now - at > TCE.DAY) { if (B.isOwner() && !lapCleared.has(x.id)) { lapCleared.add(x.id); B.lapDecline(x.id).catch(() => { }); } return; }
    if (/^\d{6}$/.test(String(x.code || ''))) out.push({ uid: x.id, code: String(x.code), dev: String(x.dev || '').slice(0, 80), at });
  });
  return out.sort((a, z) => z.at - a.at);
}
function navList() {
  if (S.role !== 'mgr') return [['me', 'My time', 'user']];
  const n = [['now', 'Now', 'board'], ['sheets', 'Timesheets', 'sheet'], ['pay', 'Payroll', 'money'], ['people', 'People', 'people'], ['alerts', 'Alerts', 'bell'], ['settings', 'Settings', 'gear']];
  if (B.me && S.staff.get(B.me.staffId) && S.staff.get(B.me.staffId).on) n.push(['me', 'My time', 'user']);
  return n;
}
const TITLES = { now: 'Now', sheets: 'Timesheets', pay: 'Payroll', people: 'People', alerts: 'Alerts', settings: 'Settings', me: 'My time' };
function renderShell() {
  const nav = navList(), me = B.me || {};
  const btns = nav.map(([v, l, i]) => '<button class="navBtn' + (S.view === v ? ' on' : '') + '" data-act="go" data-v="' + v + '">' + ic(i, 18) + '<span>' + esc(l) + '</span>' + navCount(v) + '</button>').join('');
  // (the logo's src is set below, not written into the HTML: Chrome's look-ahead for images can read this page's script as
  // HTML at a network chunk boundary and would ask the server for "' + esc(LOGO) + '")
  $('#side').innerHTML = '<div class="sideTop"><img data-logo alt="Next Level Orthodontics"><div class="appTag">Time Clock</div></div>' +
    '<nav class="nav" aria-label="Main">' + btns + '</nav>' +
    '<div class="sideFoot"><div class="whoBox">' + avatar(me.staffId || '') + '<div><b>' + esc(me.staffId ? nameOf(me.staffId) : (me.name || '')) + '</b>' + (S.role === 'mgr' ? (B.isOwner() ? 'Owner' : 'Manager') : 'Staff') + '</div></div>' +
    '<div class="syncLine" id="syncLine"></div>' +
    (S.fromKiosk ? '<button class="sideLock" data-act="toKiosk">' + ic('clock', 15) + 'Back to the time clock</button>' : '') +
    '<button class="sideLock" data-act="signOut">' + ic('lock', 15) + 'Sign out</button></div>';
  $('#mobTop').innerHTML = '<img data-logo alt="NLO"><span class="mobTag">Time Clock</span><span style="flex:1"></span>' +
    (S.fromKiosk ? '<button class="iconBtn" style="color:#fff" data-act="toKiosk" aria-label="Back to the time clock">' + ic('clock', 20) + '</button>' : '') +
    '<button class="iconBtn" style="color:#fff" data-act="signOut" aria-label="Sign out">' + ic('lock', 20) + '</button>';
  $$('img[data-logo]').forEach(i => { i.src = LOGO; });
  $('#mobNav').innerHTML = nav.length > 1 ? btns : '';
  $('#mobNav').classList.toggle('hidden', nav.length < 2);
  paintPhotos($('#side')); renderSync();
}
function navCount(v) {
  if (v === 'now') { const n = issueCount(); return n ? '<span class="cnt red">' + n + '</span>' : ''; }
  return '';
}
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  const off = typeof navigator !== 'undefined' && navigator.onLine === false;
  el.innerHTML = '<span class="dot ' + (off || S.loadErr ? 'bad' : (B && B.pending ? 'busy' : 'ok')) + '"></span>' + (off ? 'Offline' : S.loadErr ? 'Can’t load' : B && B.pending ? 'Saving…' : 'Live');
}
function queueRender() {
  if (S.mode === 'kiosk' && S.k.screen === 'req') return; // (someone filling in the form: nothing on it changes with the live data)
  if (S.renderQ) return; S.renderQ = true;
  requestAnimationFrame(() => { S.renderQ = false; if (S.mode === 'app') { renderShell(); renderView(); } else if (S.mode === 'kiosk') renderKiosk(); });
}
function renderShellCounts() { $$('.navBtn[data-v="now"]').forEach(b => { const old = $('.cnt', b); if (old) old.remove(); b.insertAdjacentHTML('beforeend', navCount('now')); }); }
function renderView() {
  S.lastRender = Date.now();
  const v = S.view, top = $('#topSlot'), el = $('#view');
  if (S.dirty && (v === 'settings' || v === 'alerts') && el.childElementCount) return; // (unsaved changes: keep them on screen)
  $$('.navBtn').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  top.innerHTML = '<div class="topBar"><h2>' + esc(TITLES[v] || '') + '</h2><span class="topNow">' + esc(TCE.dayText(TCE.dayOf(nowMs()), true)) + ' · ' + esc(TCE.timeText(nowMs())) + '</span></div>';
  let h;
  const gate = gateHTML();
  if (gate) h = gate;
  else {
    try { h = (VIEWS[v] || VIEWS.now)(); }
    catch (e) { console.error(e); h = '<div class="notice bad">This screen hit a problem: ' + esc(e.message || e) + '. Reload the page.</div>'; }
  }
  // keep what someone is typing (a live update redraws the screen)
  const keep = document.activeElement && el.contains(document.activeElement) && document.activeElement.id ? { id: document.activeElement.id, v: document.activeElement.value, s: document.activeElement.selectionStart } : null;
  el.innerHTML = h;
  if (keep) { const x = document.getElementById(keep.id); if (x) { x.value = keep.v; x.focus(); try { x.setSelectionRange(keep.s, keep.s); } catch (e) { } } }
  paintPhotos(el);
}
/* before the screens: the rules, the first-time setup */
function gateHTML() {
  if (!S.rulesOk) return rulesCardHTML();
  if (S.loadErr === 'perm') return '<div class="notice bad">The database refused to load the time clock. ' + (B.isOwner() ? 'The rules may be older than this page — see below.' : 'Ask Dr. A.') + '</div>' + (B.isOwner() ? rulesCardHTML() : '');
  if (!S.got.set) return '<div class="empty">Loading…</div>';
  if (!S.setRaw) {
    if (!B.isOwner()) return '<div class="card"><div class="cardBd" style="padding-top:18px"><b>The time clock isn’t set up yet.</b><p class="muted" style="margin-top:6px">Dr. A sets it up the first time he opens it.</p></div></div>';
    return setupCardHTML();
  }
  return '';
}
function rulesText() { return TC_RULES.replace('__OWNER_EMAIL__', String((B.me && B.me.email) || '').toLowerCase()); }
function rulesCardHTML() {
  if (!B.isOwner()) return '<div class="card"><div class="cardBd" style="padding-top:18px"><b>One step left before the time clock works.</b><p class="muted" style="margin-top:6px">Dr. A needs to publish the database’s new rules. Ask him to open NLO Time Clock.</p></div></div>';
  return '<div class="card"><div class="cardHd"><h3>' + ic('shield', 18) + ' One step before the time clock works</h3></div><div class="cardBd">' +
    '<p style="margin-bottom:10px">The database’s rules don’t know the time clock yet. They’re the same rules NLO Cases, Leads, A/R and Time Off use, with the time clock added — nothing else changes.</p>' +
    '<ol class="steps"><li><button class="btn btn-sec btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the new rules</button></li>' +
    '<li><a class="btn btn-sec btn-sm" href="https://console.firebase.google.com/project/nlo-cases/firestore" target="_blank" rel="noopener">Open the Firebase console</a> → <b>Firestore Database</b> in the left menu → <b>Rules</b> tab.</li>' +
    '<li>Select everything in the editor, paste, and press <b>Publish</b>.</li>' +
    '<li><button class="btn btn-pri btn-sm" data-act="rulesAgain">' + ic('refresh', 15) + 'Check again</button></li></ol></div></div>';
}
ACT.copyRules = async () => { toast(await copyText(rulesText()) ? 'Rules copied. Paste them in the Firebase console.' : 'Couldn’t copy. Try again.'); };
ACT.rulesAgain = async b => {
  await act(b, async () => { S.rulesOk = await B.rulesOk(false); });
  if (S.rulesOk) { S.loadErr = ''; toast('The rules are live.'); rewatch(); }
  else toast('Not yet — the new rules aren’t live. Publish them, wait a few seconds, and check again.', { bad: true });
  renderView();
};
function setupCardHTML() {
  const team = Array.from(S.roster.values()).filter(r => r.active && r.role !== 'owner');
  return '<div class="card"><div class="cardHd"><h3>' + ic('clock', 18) + ' Set up the time clock</h3></div><div class="cardBd">' +
    '<p style="margin-bottom:10px">This turns the clock on with these starting points (all can be changed in Settings): overtime after <b>40 h</b> in the workweek (Sunday to Saturday), heads-ups at <b>36 h</b> and <b>38 h</b>, earliest clock-in <b>7:30 AM</b>, an alert if someone is still clocked in at <b>6:30 PM</b> or works <b>10 h</b> in a day, breaks under <b>20 minutes</b> paid, office days <b>Monday to Thursday</b>.</p>' +
    '<p style="margin-bottom:10px">Everyone on the team goes on the clock (' + esc(team.map(r => firstName(r.name)).join(', ') || 'nobody yet') + '); in People, take anyone on salary off it, or mark them Salaried to keep a record of their hours. Alerts go to ' + esc(okEmail(B.me.email) ? B.me.email : 'nobody yet') + ' to start.</p>' +
    '<button class="btn btn-pri" data-act="doSetup">Set up the time clock</button></div></div>';
}
ACT.doSetup = async b => {
  const team = Array.from(S.roster.values()).filter(r => r.active && r.role !== 'owner').map(r => r.sid);
  if (await act(b, () => B.setupOffice(team), 'The time clock is set up. Next: People (PINs), then Alerts.')) { S.view = 'people'; renderShell(); }
};
ACT.go = b => { S.view = b.dataset.v; S.dirty = false; closeModal(); renderView(); window.scrollTo(0, 0); };
// (data-nodirty: a box on those screens that isn't one of their settings — the code a laptop shows, say)
['input', 'change'].forEach(ev => document.addEventListener(ev, e => { if (S.mode === 'app' && (S.view === 'settings' || S.view === 'alerts') && e.target.closest && e.target.closest('#view') && !e.target.closest('[data-nodirty]')) S.dirty = true; }));
document.addEventListener('click', e => { if (S.mode === 'app' && (S.view === 'settings' || S.view === 'alerts') && e.target.closest && e.target.closest('#view .pick')) S.dirty = true; }, true);
ACT.signOut = () => lockOut('Signed out.');
ACT.toKiosk = () => lockOut('');
function issueCount() {
  if (S.role !== 'mgr' || !S.setRaw) return 0;
  let n = 0;
  onClockList().forEach(r => { const w = weekFor(r.sid); n += w.issues.filter(x => FIXME.includes(x.type)).length + (lockedUntil(r.sid) ? 1 : 0); });
  return n + openReqs().filter(r => canFix(r.sid)).length;
}

/* ---------- events ---------- */
function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const f = ACT[t.dataset.act]; if (!f) return;
  e.preventDefault(); f(t, e);
}
function onKey(e) {
  if (e.key === 'Escape' && $('#modalWrap')) { closeModal(); return; }
  if (S.mode === 'kiosk') kioskKey(e);
}
