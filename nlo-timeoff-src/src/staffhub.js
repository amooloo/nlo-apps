/* =====================================================================
   Staff Hub (Dr. A). Time Off follows Staff Hub's office roster: each
   person's start date, full-/part-time and last day go into their HR
   record — but a value that differs from the record's (or a new hire's
   record) waits for Dr. A to bring it in, with what it does to the
   balance (Settings → Staff Hub): no balance changes without his OK,
   and the roster can be changed by any office Google account. A change
   of full-/part-time counts from the day it's brought in. What only
   marks a record as Staff Hub's goes in by itself, and so do names, into
   NLO Cases' team, as NLO Cases does. Team lists who's on Staff Hub
   without a login, and links a login Staff Hub has under another name.
   Read with the Google sign-in NLO Cases uses for the roster
   (backend.js); nothing is written to Staff Hub. The plain parts — who
   is who, what Staff Hub says — are in roster.js.
   ===================================================================== */
const SH = { user: undefined, data: null, err: '', at: 0, loading: null, checking: null, syncing: false, run: null, syncedAt: 0, pending: [], told: '', last: null };
function shAvailable() { return !!(B && B.shUser) && isOwner() && isHR(); }
async function shCheckUser() {
  if (!SH.checking) SH.checking = (async () => { try { SH.user = await B.shUser(); } catch (e) { SH.user = null; } return SH.user; })();
  try { return await SH.checking; } finally { SH.checking = null; }
}
function shErrText(e) {
  const c = String((e && (e.code || e.message)) || '');
  return /permission|denied/i.test(c) ? 'This Google account can’t read the office roster. Connect with the account Staff Hub shares it with.' : 'Couldn’t reach the office roster. Check the connection and try again.';
}
/* the roster, read again (one read at a time) */
async function shLoad() {
  if (SH.loading) return SH.loading;
  SH.loading = (async () => {
    SH.err = '';
    try {
      if (!(await shCheckUser())) { SH.data = null; return null; }
      const d = await B.shRoster(); SH.data = d && typeof d === 'object' ? d : { people: {} }; SH.at = Date.now();
    } catch (e) { SH.data = null; SH.err = shErrText(e); }
    return SH.data;
  })();
  try { return await SH.loading; } finally { SH.loading = null; shPaint(); }
}
/* at sign-in (and when Settings or Team is opened later): read it if this computer is connected, then see what's new.
   force ("Read it again"): even if it was read a moment ago — after any read already under way */
async function shAuto(force) {
  if (!S.inApp || !shAvailable()) return;
  if (SH.user === undefined) { await shCheckUser(); shPaint(); }
  if (!SH.user) return;
  if (SH.run) { if (!force) return; while (SH.run) await SH.run.catch(() => { }); }
  if (!force && SH.data && SH.syncedAt && Date.now() - SH.syncedAt < 60000) return;
  SH.run = (async () => { await shLoad(); await shReady(); await shSync(); })();
  try { await SH.run; } finally { SH.run = null; }
}
/* the team and the HR records, loaded (at sign-in they may still be on the way) */
async function shReady() { for (let i = 0; i < 150 && S.inApp && !(S.gotRoster && S.gotHR); i++) await new Promise(r => setTimeout(r, 200)); }
/* names and links into NLO Cases' team, Staff Hub's mark on the records whose values already agree (or off the ones it no longer
   has) — and the list of what waits for Dr. A: values that differ, and records for people hired since the move */
async function shSync() {
  if (!S.inApp || !shAvailable() || !SH.data || SH.syncing || !S.gotRoster || !S.gotHR) return;
  SH.syncing = true; const names = [], failed = [], pending = [];
  try {
    const t = todayISO(), links = shLinks(S.roster, shPeopleOf(SH.data), t);
    // names: current logins (not in the demo, whose made-up names are its own)
    if (!S.demo) for (const [sid, p] of links) {
      const r = staff(sid); if (!r || !r.active) continue;
      const name = String(p.name).replace(/\s+/g, ' ').trim().slice(0, 60), rename = !!name && name !== r.name, link = r.rid ? '' : p.id;
      if (!rename && !link) continue;
      try { await B.setStaffName(sid, rename ? name : '', link); if (rename) names.push(name); } catch (e) { failed.push(r.name); }
    }
    const mv = (S.settings.to || {}).moved, after = mv && isISO(mv.asOf) ? mv.asOf : '';
    for (const [sid, p] of links) {
      if (!S.inApp) return;
      const r = staff(sid), rec = S.hrRecs.get(sid), full = shFactsOf(sid, p), f = shOwn(rec, full);
      if (!Object.keys(full).length) continue;
      if (!rec) {
        // someone hired since the move: their record can be made from Staff Hub (from 0 on their start date); anyone hired earlier
        // comes over with the move, with the old app's balance
        if (r && r.active && after && f.hire && f.hire > after && !shGone(p, t)) pending.push({ sid, pid: p.id, f, full, kind: 'new' });
        continue;
      }
      const ch = shChanges(rec, f, p.id);
      if (ch.list.length) { pending.push({ sid, pid: p.id, f, full, kind: 'change', list: ch.list }); continue; }
      if (ch.any) { try { await B.putHR(sid, d => shApply(d, f, p.id), 'staffhub'); } catch (e) { failed.push(staffName(sid)); } }
    }
    // a record marked as Staff Hub's whose person it doesn't have now: the mark comes off (nothing else changes) — not when the roster
    // came back empty (deleted, or an older copy written over it: the marks stay until it's back)
    if (shPeopleOf(SH.data).length) for (const [sid, rec] of Array.from(S.hrRecs)) {
      if (!rec.sh || links.has(sid)) continue;
      try { await B.putHR(sid, d => { delete d.sh; delete d.emp; }, 'staffhub'); } catch (e) { failed.push(staffName(sid)); }
    }
    SH.syncedAt = Date.now(); SH.pending = pending;
  } finally { SH.syncing = false; }
  if (names.length) { SH.last = { at: Date.now(), text: 'names ' + names.join(', ') }; toast('From Staff Hub: ' + names.join(', '), { ms: 7000 }); }
  if (failed.length) toast('Couldn’t bring in Staff Hub’s changes for ' + failed.join(', ') + ' just now — Time Off tries again the next time it’s opened.', { bad: true, ms: 9000 });
  const key = shPendingKey(pending);
  if (pending.length && key !== SH.told && S.view !== 'settings') {
    SH.told = key;
    toast('Staff Hub has changes for ' + pending.map(x => firstName(staffName(x.sid))).join(', ') + ' — nothing changes here until you bring them in (Settings → Staff Hub)', { ms: 15000, action: 'Look', onAction: () => ACT.nav({ dataset: { v: 'settings' } }) });
  }
  shPaint();
}
function shPendingKey(list) { return list.map(x => x.sid + ':' + x.kind + ':' + JSON.stringify(x.f)).join('|'); }
/* what bringing a change in does to the balance today */
function shEffect(x) {
  const rec = S.hrRecs.get(x.sid); if (!rec || x.kind !== 'change') return '';
  const next = JSON.parse(JSON.stringify(rec)); shApply(next, x.f, x.pid, todayISO());
  const a = balLine(x.sid, rec), b = balLine(x.sid, next); if (!a || !b) return '';
  const t = todayISO(), na = nextAccrual(rec, S.pol, t), nb = nextAccrual(next, S.pol, t), acc = n => n ? '+' + hrs(n.vac) + ' / +' + hrs(n.sick) + ' h on ' + fmtDate(n.date) : 'none';
  const nextTxt = (na ? na.date + na.vac + '/' + na.sick : '') === (nb ? nb.date + nb.vac + '/' + nb.sick : '') ? '' : ' · next earned: ' + acc(na) + ' → ' + acc(nb);
  const toSal = normType(next.type) === 'SAL' && normType(rec.type) !== 'SAL';
  if (toSal) return 'On salary from today: no balance any more — ' + (a.vac || a.sick ? hrs(a.vac) + ' h vacation and ' + hrs(a.sick) + ' h sick leave close, not paid out' : 'nothing to close') + '; nothing more is earned';
  return (a.vac === b.vac && a.sick === b.sick ? 'Balances today stay as they are' : 'Today: vacation ' + hrs(a.vac) + ' → ' + hrs(b.vac) + ' h, sick ' + hrs(a.sick) + ' → ' + hrs(b.sick) + ' h') + nextTxt;
}
/* what Staff Hub says about a team entry's person, as its HR record takes it: a removed login's record only ever gets a last day (a
   rehire's new start date and "on staff" belong to their new login, not the old record) */
function shFactsOf(sid, p) { const r = staff(sid), f = shFacts(p); return r && !r.active ? (f.left ? { left: f.left } : {}) : f; }
/* bring changes in (each into the record as it is now; a change of full-/part-time counts from today), or make a new hire's record */
async function shBringIn(list) {
  const t = todayISO(), done = [], failed = [];
  for (const x of list) {
    try {
      await B.putHR(x.sid, d => {
        const here = Object.keys(d).some(k => k !== 'sid'); // made meanwhile: a change, like any other
        shApply(d, x.f, x.pid, here ? t : ''); if (!Array.isArray(d.adj)) d.adj = [];
      }, x.kind === 'new' ? 'staffhub-new' : 'staffhub');
      done.push(x);
    } catch (e) { failed.push(staffName(x.sid) + ' (' + errText(e) + ')'); }
  }
  SH.pending = SH.pending.filter(p => !done.includes(p));
  if (done.length) {
    const txt = done.map(x => staffName(x.sid) + ': ' + (x.kind === 'new' ? 'Time Off record made' : x.list.map(c => shChangeLine(c, x.f, c.k === 'type' ? t : '')).join(', '))).join('; ');
    SH.last = { at: Date.now(), text: txt }; toast('Brought in from Staff Hub — ' + txt, { ms: 9000 });
  }
  if (failed.length) toast('Couldn’t bring in: ' + failed.join('; '), { bad: true, ms: 9000 });
  shPaint();
}
/* the Settings card and the Team list, drawn again where they're on screen (and the move, which uses Staff Hub's dates) */
function shPaint() {
  const a = $('#shBox'); if (a) a.innerHTML = shBodyHTML();
  const t = $('#shTeam'); if (t) { t.outerHTML = shTeamHTML(); paintPhotos($('#shTeam')); }
  if (S.view === 'import' && S.imp && S.imp.data && S.imp.st === 'ready' && S.imp.shAt !== SH.at) { impAudit(); paintImport(); }
}
Object.assign(ACT, {
  shConnect(t) {
    const go = B.shConnect(); busyBtn(t, true, 'Connecting…'); // the sign-in window opens straight from the click
    go.then(async () => { SH.user = undefined; SH.err = ''; await shAuto(true); })
      .catch(x => { busyBtn(t, false); if (!/popup-closed|cancelled-popup/.test(String(x && x.code))) toast(errText(x), { bad: true }); })
      .then(() => shPaint());
  },
  async shRefresh(t) { busyBtn(t, true, 'Reading…'); SH.err = ''; await shAuto(true); shPaint(); },
  async shApplyOne(t) { const x = SH.pending.find(p => p.sid === t.dataset.sid); if (!x) return; busyBtn(t, true, 'Bringing in…'); await shBringIn([x]); },
  /* keep this record's own value (e.g. an original start date where Staff Hub has a rehire's): until Staff Hub says something else */
  async shKeep(t) {
    const x = SH.pending.find(p => p.sid === t.dataset.sid); if (!x || x.kind !== 'change') return;
    if (!(await confirmBox('Keep Time Off’s for ' + firstName(staffName(x.sid)) + '?', 'Staff Hub says ' + x.list.map(c => shChangeLine(c, x.f)).join(', ') + '. Time Off keeps its own instead (you can change it in their HR record) until Staff Hub says something else.', 'Keep Time Off’s'))) return;
    busyBtn(t, true, 'Saving…');
    try {
      await B.putHR(x.sid, d => {
        const keep = Object.assign({}, d.shKeep && typeof d.shKeep === 'object' ? d.shKeep : {}); x.list.forEach(c => { keep[c.k] = c.to; }); d.shKeep = keep;
        const fo = shOwn(d, x.full); d.sh = shMark(fo, x.pid); if (!('type' in fo)) delete d.emp;
      }, 'staffhub-keep');
      SH.pending = SH.pending.filter(p => p !== x); toast('Keeping Time Off’s for ' + staffName(x.sid));
    } catch (e) { toast(errText(e), { bad: true }); }
    shPaint();
  },
  async shApplyAll(t) {
    const list = SH.pending.slice(); if (!list.length) return;
    if (!(await confirmBox('Bring in all ' + list.length + '?', list.map(x => staffName(x.sid)).join(', ') + ' — as listed, with what each does to the balance.', 'Bring them in'))) return;
    busyBtn(t, true, 'Bringing in…'); await shBringIn(list);
  },
  /* who a login is on Staff Hub (a login under another name there, or one linked to the wrong person): its saved link */
  shLink(t) {
    if (!SH.data) return;
    const sid = t.dataset.sid, st = shTeamState(S.roster, shPeopleOf(SH.data), todayISO()), cur = st.links.get(sid) || null, r = staff(sid), name = staffName(sid), td = todayISO();
    const opts = (cur ? [cur] : []).concat(st.free).map(p => '<option value="' + esc(p.id) + '"' + (cur && p.id === cur.id ? ' selected' : '') + '>' + esc(p.name + (p.title ? ' — ' + p.title : '') + (shGone(p, td) ? ' (left)' : '')) + '</option>').join('');
    openModal('<h3>' + esc(name) + ' on Staff Hub</h3><p class="small" style="margin:8px 0 12px">Who is ' + esc(firstName(name)) + ' on Staff Hub’s roster? Their start date, full- or part-time and last day come from that person' + (r && r.active ? ', and so does their name' : '') + '. NLO Cases uses the same link.</p>' +
      '<div class="field"><label for="shPick">On Staff Hub</label><select id="shPick">' + (cur ? '' : '<option value="" selected>Choose…</option>') + opts + '<option value="' + SH_NONE + '"' + (r && r.rid === SH_NONE ? ' selected' : '') + '>Not on Staff Hub</option></select></div>' +
      '<div class="mFt"><button class="btn btn-sec btn-sm" data-act="closeModal">Cancel</button><button class="btn btn-pri btn-sm" id="shPickSave">Save</button></div>');
    $('#shPickSave').onclick = async () => {
      const v = $('#shPick').value; if (!v) { toast('Pick who they are, or Not on Staff Hub.', { bad: true }); return; }
      busyBtn($('#shPickSave'), true, 'Saving…');
      try { await B.setStaffName(sid, '', v); closeModal(); toast(v === SH_NONE ? name + ': not on Staff Hub' : name + ' is linked to Staff Hub’s ' + ((shPeopleOf(SH.data).find(p => p.id === v) || {}).name || v)); }
      catch (e) { busyBtn($('#shPickSave'), false); toast(errText(e), { bad: true }); return; }
      // the team list carries the link; then what follows from it
      for (let i = 0; i < 40 && (staff(sid) || {}).rid !== v; i++) await new Promise(res => setTimeout(res, 150));
      shAuto(true).catch(() => { });
    };
  }
});

/* ---------- Settings → Staff Hub ---------- */
function shCardHTML() { return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Staff Hub</h3><span class="sub">Start dates, full- or part-time, last days</span></div><div class="cardBd" id="shBox">' + shBodyHTML() + '</div></div>'; }
function shPendingHTML() {
  const P = SH.pending; if (!P.length) return '';
  const t = todayISO();
  return '<div class="shWait"><div class="subH" style="margin-top:0">Waiting for you (' + P.length + ')</div>' +
    P.map(x => '<div class="accessRow">' + avatarHTML(x.sid) + '<div class="grow"><b>' + esc(staffName(x.sid)) + '</b><div class="small">' +
      esc(x.kind === 'new' ? 'Start their Time Off record: hired ' + fmtDate(x.f.hire) + ', ' + empWord(x.f.type || 'FT', x.f.emp) + ' — from 0 on their start date' : x.list.map(c => shChangeLine(c, x.f, c.k === 'type' ? t : '')).join(' · ')) + '</div>' +
      (x.kind === 'change' ? '<div class="small muted">' + esc(shEffect(x)) + '</div>' : '') + '</div>' +
      '<div class="btnCol"><button class="btn btn-sec btn-sm" data-act="shApplyOne" data-sid="' + esc(x.sid) + '">Bring in</button>' + (x.kind === 'change' ? '<button class="linkBtn small" data-act="shKeep" data-sid="' + esc(x.sid) + '">Keep Time Off’s</button>' : '') + '</div></div>').join('') +
    (P.length > 1 ? '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="shApplyAll">Bring them all in</button></div>' : '') +
    '<p class="small muted" style="margin-top:8px">Nothing changes in Time Off until you bring it in. If Staff Hub has it wrong, change it there and press Read it again.</p></div>';
}
function shBodyHTML() {
  const about = '<p class="small muted" style="margin-top:10px">Staff Hub is where hires, start dates, full- or part-time and last days are kept, and Time Off follows it: vacation tiers count from the start date there, part-time staff earn no paid time off, and nothing is earned after the last day. A change there shows up here for you to bring in; a change of full- or part-time counts from the day you do. Names follow Staff Hub too (NLO Cases keeps them). Orientation, department, balances, benefits and notes are kept here.</p>';
  if (!B.shUser) return '<p class="small muted">Not available here.</p>';
  if (SH.user === undefined) return '<div class="small muted">Checking…</div>';
  if (!SH.user) return '<p class="small">Bring in start dates, full- or part-time and last days from Staff Hub’s roster instead of typing them here.</p>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="shConnect">' + ic('people', 15) + 'Connect to the office roster</button></div>' +
    '<p class="small muted" style="margin-top:6px">With the Google account Staff Hub shares its roster with — the sign-in NLO Cases uses for it (Team &amp; security → From Staff Hub). Connecting in either connects both on this computer, and it stays connected.</p>' + about;
  if (SH.err) return '<p class="small coral" style="margin-bottom:4px">' + esc(SH.err) + '</p><div class="btnRow"><button class="btn btn-sec btn-sm" data-act="shRefresh">' + ic('refresh', 15) + 'Try again</button><button class="btn btn-ghost" data-act="shConnect">Use another Google account</button></div>' + about;
  if (!SH.data) return '<div class="small muted">Reading the office roster…</div>';
  const st = shTeamState(S.roster, shPeopleOf(SH.data), todayISO()), L = SH.last, at = Number(SH.data.updatedAt);
  return shPendingHTML() + '<div class="kvRow"><span>Office roster</span><b>' + (at ? 'Shared ' + esc(fmtWhen(at)) : 'Shared') + '</b></div>' +
    '<div class="kvRow"><span>Linked</span><b>' + st.linked + ' of ' + plural(st.logins, 'person', 'people') + ' with a login</b></div>' +
    (st.noLogin.length ? '<div class="kvRow"><span>On Staff Hub, no login yet</span><b style="text-align:right">' + esc(st.noLogin.map(p => p.name).join(', ')) + '</b></div>' : '') +
    (st.missing.length ? '<div class="kvRow"><span>Not linked to Staff Hub</span><b style="text-align:right">' + esc(st.missing.map(r => r.name).join(', ')) + '</b></div>' : '') +
    (st.twice.length ? '<div class="kvRow"><span>Two logins, one person</span><b style="text-align:right">' + esc(st.twice.map(x => x.names.join(' and ') + ' (' + x.p.name + ')').join('; ')) + '</b></div>' : '') +
    (L ? '<div class="small" style="margin-top:8px"><b>Last brought in, ' + esc(fmtWhen(L.at)) + ':</b> ' + esc(L.text) + '</div>' : '') +
    '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="shRefresh">' + ic('refresh', 15) + 'Read it again</button>' + (st.noLogin.length || st.missing.length || st.twice.length ? '<button class="btn btn-ghost" data-act="nav" data-v="team">' + ic('people', 15) + 'See them on Team</button>' : '') + '</div>' + about;
}

/* ---------- Team: who's on Staff Hub without a login, and the other way round ---------- */
function shTeamHTML() {
  if (!shAvailable()) return '<div id="shTeam"></div>';
  if (SH.user === null) return '<div id="shTeam"><p class="small muted" style="margin-top:10px">Connect Staff Hub (Settings → Staff Hub) and everyone’s start date, full- or part-time and last day come from it.</p></div>';
  if (!SH.data) return '<div id="shTeam">' + (SH.err ? '<p class="small coral" style="margin-top:10px">Staff Hub: ' + esc(SH.err) + '</p>' : '') + '</div>';
  const st = shTeamState(S.roster, shPeopleOf(SH.data), todayISO()), t = todayISO(), P = SH.pending;
  const wait = P.length ? '<div class="notice info" style="margin:12px 0 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="flex:1;min-width:200px">Staff Hub has changes for ' + esc(P.map(x => firstName(staffName(x.sid))).join(', ')) + ' — they wait for you in Settings.</span><button class="btn btn-sec btn-sm" data-act="nav" data-v="settings">Look at them</button></div>' : '';
  if (!st.noLogin.length && !st.missing.length && !st.twice.length) return '<div id="shTeam">' + wait + '<p class="small muted" style="margin-top:10px">' + ic('done', 13) + ' Everyone on Staff Hub’s roster has a login here, and everyone here is on it. Start dates, full- or part-time and last days come from Staff Hub.</p></div>';
  const row = (av, name, sub, right) => '<div class="accessRow">' + av + '<div class="grow"><b>' + esc(name) + '</b><div class="small muted">' + esc(sub) + '</div></div>' + (right || '') + '</div>';
  return '<div id="shTeam">' + wait + '<div class="card" style="margin-top:14px"><div class="cardHd"><h3>From Staff Hub</h3><span class="sub">The office roster</span></div><div class="cardBd">' +
    (st.noLogin.length ? '<div class="subH" style="margin-top:2px">No login yet</div><p class="small muted" style="margin:-4px 0 6px">They can ask for time off once they have one — add them in NLO Cases (Team &amp; security lists them too).</p>' +
      st.noLogin.map(p => row('<span class="av">' + esc(initials(p.name)) + '</span>', p.name, [p.title, isISO(p.start) ? (p.start > t ? 'starts ' : 'started ') + fmtDate(p.start) : '', p.employment].filter(Boolean).join(' · '))).join('') +
      '<div class="btnRow"><a class="btn btn-sec btn-sm" href="nlo-cases.html">' + ic('next', 15) + 'Open NLO Cases</a></div>' : '') +
    (st.missing.length ? '<div class="subH">Not linked to Staff Hub</div><p class="small muted" style="margin:-4px 0 6px">Their hire date and full- or part-time are kept here until they’re linked. If Staff Hub has them under another name, press Link and pick them.</p>' +
      st.missing.map(r => row(avatarHTML(r.sid), staffName(r.sid), 'Has a login here', '<button class="btn btn-sec btn-sm" data-act="shLink" data-sid="' + esc(r.sid) + '">Link…</button>')).join('') : '') +
    (st.twice.length ? '<div class="subH">Two logins for one person</div>' + st.twice.map(x => row('<span class="av">' + esc(initials(x.p.name)) + '</span>', x.p.name, 'Matches ' + x.names.join(' and ') + ' — remove the extra login in NLO Cases, or link each to the right person')).join('') : '') +
    '</div></div></div>';
}

/* ---------- a person's HR record: the fields Staff Hub supplies ---------- */
/* from its roster as read now (someone it doesn't have: none), else — not read on this computer — as the record says they were last
   brought in → { f (the facts), pid, live } or null */
function shLock(sid, rec) {
  if (SH.data && shAvailable()) { const p = shLinks(S.roster, shPeopleOf(SH.data)).get(sid); if (!p) return null; const f = shOwn(rec, shFactsOf(sid, p)); return Object.keys(f).length ? { f, pid: p.id, live: true } : null; }
  const m = rec && rec.sh;
  if (!m || !Array.isArray(m.f) || !m.f.length) return null;
  const f = {}; m.f.filter(k => SH_FIELDS.includes(k)).forEach(k => { f[k] = k === 'type' ? normType(rec.type) : rec[k] || ''; });
  if ('type' in f && rec.emp) f.emp = rec.emp;
  return { f, pid: m.id, live: false };
}
/* "Staff Hub" after a value that came from there */
function shTag(rec, k) { return rec && rec.sh && Array.isArray(rec.sh.f) && rec.sh.f.includes(k) ? ' <span class="sug blue" title="From Staff Hub — changed there">Staff Hub</span>' : ''; }
/* the person panel (Dr. A): who they are on Staff Hub, and a way to change it */
function shWhoHTML(sid) {
  if (!shAvailable() || !SH.data) return '';
  const p = shLinks(S.roster, shPeopleOf(SH.data)).get(sid), r = staff(sid); if (!r || r.role === 'owner') return '';
  return '<div class="kvRow"><span>On Staff Hub</span><b>' + (p ? esc(p.name) : r && r.rid === SH_NONE ? 'Not on Staff Hub' : 'Not linked') + ' <button class="linkBtn small" data-act="shLink" data-sid="' + esc(sid) + '">' + (p ? 'Change' : 'Link') + '</button></b></div>';
}
