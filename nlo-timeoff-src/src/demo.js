/* =====================================================================
   Demo backend: a made-up office, everything in memory, nothing saved.
   Opened with ?demo — sign in as Dr. A, as someone who approves
   (Jordan) or as staff (Riley) with "Look at it as", or straight away
   with &as=approver / &as=staff. Every name here is invented. It keeps
   the same limits as the database's rules, so the demo can't do what
   the real app can't (staff deciding requests, approving your own…).
   ===================================================================== */
const DEMO = {
  as: '', uid: null, me: null, h: null, pending: 0, hr: { curV: 1 }, lastCode: '', rotating: false, seeded: false,
  roster: [], members: [], grants: [], reqs: new Map(), perks: new Map(), recs: new Map(), logs: [], hrLogs: [], outbox: [], settings: {}, feed: null, feedKey: '',
  isOwner() { return !!(DEMO.me && DEMO.me.role === 'owner'); },
  hrOn() { return DEMO.isOwner() || DEMO.grants.some(g => g.uid === DEMO.uid); },
  isPerm(e) { return /permission/i.test((e && (e.code || e.message)) || ''); },
  copy(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); },
  wait(ms) { return new Promise(r => setTimeout(r, ms)); },
  clean(c) { const o = Object.assign({}, c); ['id', 'status', 'rev', 'v', 'startMs', 'pubX', 'by', 'updatedAt', 'createdAtSrv', 'hasMe', 'locked', 'odd'].forEach(k => delete o[k]); return o; },
  merge(a, b) { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) DEMO.merge(a[k], b[k]); else a[k] = b[k]; } return a; },

  /* ---------- sign in: Dr. A, Jordan (approves) or Riley (staff) ---------- */
  async signIn() {
    if (!DEMO.seeded) DEMO.seed();
    const sid = DEMO.as === 'approver' ? 'jordan' : DEMO.as === 'staff' ? 'riley' : 'amir', m = DEMO.members.find(x => x.staffId === sid);
    DEMO.me = Object.assign({}, m, { email: m.role === 'owner' ? 'owner@example.com' : '' }); DEMO.uid = m.uid;
    return { state: 'ok' };
  },
  async signOut() { DEMO.h = null; DEMO.me = null; DEMO.uid = null; },
  stop() { },
  async firstSetup() { }, async recover() { }, async sendReset() { }, async changePassword() { await DEMO.wait(300); },
  async toOpen() { await DEMO.wait(120); return DEMO.hrOn() ? 'hr' : 'staff'; },
  async toSetup() { }, async hrRestore() { },

  /* ---------- who approves ---------- */
  teamSids() { return Array.from(new Set(DEMO.grants.map(g => g.sid))); },
  async hrPeople() { await DEMO.wait(120); return { grants: DEMO.grants.map(DEMO.copy), members: DEMO.members.map(DEMO.copy), hasRecovery: true, escrowOk: true }; },
  async hrGrant(m) {
    if (!DEMO.isOwner()) throw errCode('permission-denied');
    if (!m.pub || !m.active) throw errCode('no-pub', (m.name || 'They') + ' needs to sign in once (and choose a password) first.');
    await DEMO.wait(300);
    DEMO.grants = DEMO.grants.filter(g => g.uid !== m.uid).concat([{ uid: m.uid, sid: m.staffId, pubX: m.pub.x, ringV: DEMO.hr.curV }]);
    if (DEMO.h) DEMO.h.team(DEMO.teamSids());
  },
  async hrRevoke(uid, progress) {
    if (!DEMO.isOwner()) throw errCode('permission-denied');
    await DEMO.wait(150); DEMO.grants = DEMO.grants.filter(g => g.uid !== uid);
    if (DEMO.h) DEMO.h.team(DEMO.teamSids());
    return DEMO.hrRotate(progress);
  },
  async hrRotate(progress) {
    const tot = DEMO.reqs.size + DEMO.recs.size;
    for (let n = 1; n <= tot; n++) { await DEMO.wait(12); if (progress) progress(n, tot); }
    DEMO.hr.curV++; DEMO.grants.forEach(g => { g.ringV = DEMO.hr.curV; });
    return { reqs: DEMO.reqs.size, recs: DEMO.recs.size, failed: 0 };
  },
  async hrReseal() { return { reqs: 0, recs: 0, failed: 0 }; },
  async hrFixGrants() { await DEMO.wait(150); return { removed: [], relogin: [], resealed: [], keyChanged: [] }; },
  async publishPeople() { return 0; },
  async archiveUnreadable(id) { return DEMO.saveReq(id, c => { c.events = (c.events || []).concat([{ a: 'takeback', by: DEMO.me.staffId, at: Date.now(), note: 'It couldn’t be opened, so it was taken back.' }]); return { status: 'archived' }; }, { a: 'takeback' }); },

  /* ---------- live data ---------- */
  start(h) {
    DEMO.h = h;
    h.settings(DEMO.copy(DEMO.settings)); h.roster(DEMO.roster.map(DEMO.copy)); h.team(DEMO.teamSids());
    h.people(new Map(DEMO.members.filter(m => m.pub).map(m => [m.staffId, { pub: DEMO.copy(m.pub), uid: m.uid }])));
    DEMO.emit();
  },
  mineOf(rec) { return { sid: rec.sid, hire: rec.hire || '', orient: rec.orient || '', type: rec.type || 'FT', left: rec.left || '', open: DEMO.copy(rec.open || null), adj: DEMO.copy(rec.adj || []), settled: DEMO.copy(rec.settled || []), ben: DEMO.copy(rec.ben || {}), at: Date.now() }; },
  emit() {
    const h = DEMO.h; if (!h || !DEMO.me) return;
    const all = Array.from(DEMO.reqs.values()), me = DEMO.me.staffId, hr = DEMO.hrOn();
    h.board(all.filter(r => r.status === 'approved').map(r => ({ id: r.id, sid: r.sid, start: r.start, end: r.end, part: r.part || 'full' })));
    h.reqs((hr ? all : all.filter(r => r.sid === me)).map(DEMO.copy), []);
    if (h.perks) h.perks(Array.from(DEMO.perks.values()).filter(x => hr || x.sid === me).map(DEMO.copy));
    const rec = DEMO.recs.get(me); h.mine(rec ? DEMO.mineOf(rec) : null);
    if (hr) h.hr(Array.from(DEMO.recs.values()).map(r => Object.assign(DEMO.copy(r), { rev: 1, v: DEMO.hr.curV })));
  },
  /* a request saved the way the real backend saves it, inside the same limits as the database's rules */
  async saveReq(id, fn, opts) {
    opts = opts || {}; await DEMO.wait(180);
    const cur = DEMO.reqs.get(id), me = DEMO.me.staffId, hr = DEMO.hrOn(), owner = DEMO.isOwner();
    if (!cur && !opts.create) throw errCode('gone');
    if (cur && opts.fresh) throw errCode('exists', 'This request is already here.');
    if (cur && opts.rev && cur.rev !== opts.rev) throw errCode('changed', 'This request was just changed — look at it again.');
    if (cur && !hr && cur.sid !== me) throw errCode('permission-denied');
    const content = DEMO.clean(DEMO.copy(cur || { sid: opts.create.sid, status: 'pending', events: [] }));
    const prev = cur ? cur.status : null, r = fn(content) || {}, status = r.status || prev || 'pending';
    if (content.sid !== (cur ? cur.sid : opts.create.sid)) throw errCode('bad', 'A request can’t change hands.');
    if (!isISO(content.start) || !isISO(content.end)) throw errCode('bad', 'A request needs its dates.');
    const mine = content.sid === me, startMs = dayStartMs(content.start);
    const okCreate = (status === 'pending' && mine) || (hr && (owner || !mine || status === 'pending'));
    const okUpdate = !!cur && ((hr && (owner || cur.sid !== me)) ||
      (cur.sid === me && ((prev === 'pending' && ['pending', 'cancelled'].includes(status)) || (prev === 'approved' && status === 'cancelled' && cur.startMs === startMs && cur.startMs > Date.now()))));
    if (cur ? !okUpdate : !okCreate) throw errCode('permission-denied', 'Not allowed.');
    const next = Object.assign(content, { id, status, rev: cur ? cur.rev + 1 : 1, v: DEMO.hr.curV, startMs, pubX: 'demo', by: me, updatedAt: Date.now(), createdAtSrv: cur ? cur.createdAtSrv : Date.now(), hasMe: true });
    DEMO.reqs.set(id, next);
    DEMO.logs.push({ reqId: id, rev: next.rev, a: String(opts.a || 'save').slice(0, 20), sid: me, at: Date.now() });
    if (opts.mail && (DEMO.settings.to || {}).frontDesk !== false) DEMO.outbox.push(Object.assign({ at: Date.now() }, opts.mail));
    DEMO.emit();
    return id;
  },
  newReqId() { return 'q' + hexId(12); },
  /* a scrubs request, saved inside the same limits as the database's rules */
  async savePerk(id, fn, opts) {
    opts = opts || {}; await DEMO.wait(160);
    const cur = DEMO.perks.get(id), me = DEMO.me.staffId, hr = DEMO.hrOn(), owner = DEMO.isOwner();
    if (!cur && !opts.create) throw errCode('gone');
    if (cur && opts.rev && cur.rev !== opts.rev) throw errCode('changed', 'This request was just changed — look at it again.');
    if (cur && !hr && cur.sid !== me) throw errCode('permission-denied');
    const content = DEMO.clean(DEMO.copy(cur || { sid: opts.create.sid, kind: 'scrubs', events: [] })); delete content.year;
    const mailed = !!(opts.mail && DEMO.toMail);
    const prev = cur ? cur.status : null, r = fn(content, { mailed }) || {}, status = r.status || prev || 'pending';
    if (content.sid !== (cur ? cur.sid : opts.create.sid)) throw errCode('bad', 'A request can’t change hands.');
    if (!okPerk(content)) throw errCode('bad', 'Say how many pairs and why.');
    if (!cur && !scrubsOpen(todayISO(), scrubsOf(DEMO.settings).byDay)) throw errCode('bad', 'Scrubs for this year had to be asked for by December ' + scrubsOf(DEMO.settings).byDay + '.');
    const okCreate = status === 'pending' && content.sid === me;
    const okUpdate = !!cur && ((hr && (owner || cur.sid !== me)) || (cur.sid === me && prev === 'pending' && ['pending', 'cancelled'].includes(status)));
    if (cur ? !okUpdate : !okCreate) throw errCode('permission-denied', 'Not allowed.');
    DEMO.perks.set(id, Object.assign(content, { id, status, rev: cur ? cur.rev + 1 : 1, v: DEMO.hr.curV, year: cur ? cur.year : opts.create.year, pubX: 'demo', by: me, updatedAt: Date.now(), createdAtSrv: cur ? cur.createdAtSrv : Date.now(), hasMe: true }));
    if (mailed) DEMO.outbox.push(Object.assign({ at: Date.now(), to: DEMO.toMail }, opts.mail));
    DEMO.emit();
    return { id, mailed };
  },
  toMail: SCRUBS.to,
  async scrubsMailState() { await DEMO.wait(80); return { to: DEMO.toMail, on: true, ver: 3, fresh: true, keyOk: true, ok: !!DEMO.toMail }; },
  async setScrubsMail(to) { await DEMO.wait(120); if (!DEMO.isOwner()) throw errCode('permission-denied'); DEMO.toMail = to; },
  newPerkId() { return 'p' + hexId(12); },
  /* the same id for the same old request every time (the real one is keyed with the HR key; nothing here is secret) */
  async importReqId(lid) {
    const t = 'demo-import:' + lid; let a = 0x811c9dc5, b = 0x9e3779b9, c = 0x85ebca6b;
    for (let i = 0; i < t.length; i++) { const k = t.charCodeAt(i); a = Math.imul(a ^ k, 16777619) >>> 0; b = Math.imul(b + k + i, 2246822519) >>> 0; c = Math.imul(c ^ (k << (i % 16)), 3266489917) >>> 0; }
    return 'q' + [a, b, c].map(x => x.toString(16).padStart(8, '0')).join('');
  },
  async checkKeys() { return []; },
  async importedHere(id, sid) { const r = DEMO.reqs.get(id), l = DEMO.logs.find(x => x.reqId === id && x.rev === 1); return !!(r && r.sid === sid && l && l.a === 'import' && l.sid === DEMO.me.staffId); },
  trustedPub() { return null; },
  async reqLog(id) { await DEMO.wait(40); return DEMO.logs.filter(x => x.reqId === id).map(x => ({ rev: x.rev, a: x.a, sid: x.sid, at: x.at })).sort((a, b) => a.rev - b.rev); },
  async putHR(sid, fn, a) {
    await DEMO.wait(150);
    if (!DEMO.isOwner()) throw errCode('permission-denied', 'Only Dr. A changes HR records.');
    const data = DEMO.copy(DEMO.recs.get(sid) || { sid }); ['rev', 'v', 'updatedAt'].forEach(k => delete data[k]); data.sid = sid;
    fn(data);
    DEMO.recs.set(sid, Object.assign(data, { updatedAt: Date.now() }));
    DEMO.hrLogs.push({ hsid: sid, a: a || 'save', at: Date.now(), uid: DEMO.uid });
    DEMO.emit();
    return data;
  },
  async mineXs() { return new Map(); }, async writeMine() { return true; },
  async hrLog(sid) { return DEMO.hrLogs.filter(x => x.hsid === sid).map(DEMO.copy); },
  async writeFeed(o) { DEMO.feed = DEMO.copy(o); return true; },
  async readFeed() { return DEMO.copy(DEMO.feed); },
  async newFeedKey() { await DEMO.wait(200); DEMO.feedKey = b64(rnd(32)); },
  feedKeyB64() { return DEMO.feedKey; }, projectId() { return 'nlo-cases'; },
  async deskStatus() { await DEMO.wait(80); return { on: true, to: 'frontdesk@example.com' }; },
  async saveSettings(patch) { await DEMO.wait(150); if (!DEMO.isOwner()) throw errCode('permission-denied'); DEMO.merge(DEMO.settings, DEMO.copy(patch)); if (DEMO.h) DEMO.h.settings(DEMO.copy(DEMO.settings)); },

  /* =====================================================================
     The made-up office: six people (one has left), a year of time off,
     some waiting for a decision — all dated around today
     ===================================================================== */
  seed() {
    DEMO.seeded = true; DEMO.feedKey = b64(rnd(32));
    const t = todayISO(), y = Number(t.slice(0, 4)), now = Date.now();
    const P = [['amir', 'Dr. Akhavan', 'DA', 'owner'], ['jordan', 'Jordan (demo)', 'J', 'staff'], ['riley', 'Riley (demo)', 'R', 'staff'], ['casey', 'Casey (demo)', 'C', 'staff'],
      ['morgan', 'Morgan (demo)', 'M', 'staff'], ['taylor', 'Taylor (demo)', 'T', 'staff'], ['drew', 'Drew (demo)', 'D', 'staff'], ['sam', 'Sam (demo)', 'S', 'staff', true]];
    DEMO.roster = P.map(([sid, name, initials, role, gone]) => ({ sid, name, initials, role, active: !gone, username: role === 'owner' ? '' : sid, rid: 'demo-' + sid }));
    const fakeX = s => (s + 'demokeydemokeydemokeydemokeydemokeydemokey').slice(0, 43);
    DEMO.members = DEMO.roster.filter(r => r.active).map(r => Object.assign({ uid: 'u-' + r.sid, staffId: r.sid, name: r.name, role: r.role, active: true, username: r.username },
      r.sid === 'casey' ? { mustSetup: true } : { pub: { kty: 'EC', crv: 'P-256', x: fakeX(r.sid), y: fakeX('y' + r.sid) } }));
    DEMO.grants = ['amir', 'jordan'].map(sid => ({ uid: 'u-' + sid, sid, pubX: fakeX(sid), ringV: 1 }));
    // office days around today
    const mon = w => addDays(t, -((weekday(t) + 6) % 7) + 7 * w), training = addDays(mon(2), 3);
    DEMO.settings = { idleMin: 30, to: { closures: [{ date: training, label: 'Staff training day' }], frontDesk: true } };
    const closed = makeClosed(DEMO.settings.to.closures);
    const office = (iso, dir) => { let d = iso; for (let i = 0; i < 30 && !isOfficeDay(d, closed); i++) d = addDays(d, dir); return d; };
    const at = (iso, h) => Math.min(now - 3600000, dayStartMs(iso) + (h || 10) * 3600000);
    // HR records: hire dates across the tiers (Jordan, 16 years, shows Double Platinum); the year starts at 0 (last year's balance was paid out)
    const open = { asOf: (y - 1) + '-12-31', vac: 0, sick: 0, note: 'Last year’s balance was paid out on Dec 31' };
    const rec = (sid, o) => DEMO.recs.set(sid, Object.assign({ sid, hire: '', orient: '', type: 'FT', dept: '', left: '', notes: '', adj: [] }, o));
    rec('jordan', { hire: '2010-06-03', dept: 'Front office', open, ben: { celebrate: true, k401: true } });
    rec('riley', { hire: '2023-03-13', dept: 'Clinical', open, ben: { celebrate: true, k401: false }, adj: [{ id: 'a1', date: office(addDays(t, -40), -1), b: 'vac', h: 8.5, note: 'Worked the Saturday open house', by: 'amir', at: at(addDays(t, -40)) }] });
    rec('casey', { hire: addDays(t, -150), dept: 'Clinical', notes: 'Started as a sterilization assistant.' });
    rec('morgan', { hire: '2024-09-09', type: 'PT', dept: 'Front office', open });
    rec('taylor', { hire: addDays(t, -(365 * 2 - 40)), dept: 'Clinical', open, ben: { celebrate: false, k401: true } });
    rec('sam', { hire: '2022-02-07', dept: 'Clinical', left: office(addDays(t, -60), -1), open });
    // requests
    const add = (sid, type, start, end, o) => {
      o = o || {}; const id = 'q' + hexId(12), status = o.status || 'pending', asked = o.asked || at(addDays(start, -21), 9);
      const ev = [{ a: o.recordedBy ? 'record' : 'submit', by: o.recordedBy || sid, at: asked }];
      let decision;
      if (o.by && status !== 'pending' && status !== 'cancelled') { decision = { s: status, by: o.by, at: Math.min(now - 1800000, asked + 86400000), note: o.dnote || '' }; ev.push({ a: status === 'approved' ? 'approve' : status === 'denied' ? 'deny' : 'takeback', by: o.by, at: decision.at, note: o.dnote || '' }); }
      if (o.recordedBy) decision = { s: 'approved', by: o.recordedBy, at: asked, note: '' };
      if (status === 'cancelled') ev.push({ a: 'cancel', by: sid, at: Math.min(now - 1800000, asked + 3 * 86400000) });
      DEMO.reqs.set(id, Object.assign({ sid, type, paid: o.paid !== false, start, end, part: o.part || 'full', cover: o.cover || '', note: o.note || '', at: asked, events: ev },
        decision ? { decision } : {}, { id, status, rev: ev.length, v: 1, startMs: dayStartMs(start), pubX: 'demo', by: ev[ev.length - 1].by, updatedAt: ev[ev.length - 1].at, createdAtSrv: asked, hasMe: true }));
      ev.forEach((e, i) => DEMO.logs.push({ reqId: id, rev: i + 1, a: e.a, sid: e.by, at: e.at }));
    };
    // Riley: a week taken, time off coming up, a long one waiting (short notice, and Taylor from the same department is off then)
    add('riley', 'vac', mon(-10), addDays(mon(-10), 3), { status: 'approved', by: 'amir', note: 'Family trip' });
    add('riley', 'sick', office(addDays(t, -19), -1), office(addDays(t, -19), -1), { status: 'approved', recordedBy: 'jordan', asked: at(office(addDays(t, -19), -1), 8) });
    add('riley', 'vac', mon(3), addDays(mon(3), 2), { status: 'approved', by: 'jordan', cover: 'Casey takes my chair' });
    add('riley', 'vac', mon(6), addDays(mon(6), 3), { asked: at(addDays(t, -2), 15), note: 'Cousin’s wedding in Denver', cover: 'Casey' });
    add('riley', 'vac', (y + 1) + '-01-12', (y + 1) + '-01-14', { status: 'denied', by: 'amir', asked: at(addDays(t, -30), 11), dnote: 'January is a blackout month — could you pick a week in February?' });
    // Taylor: a morning appointment next week, time off in the week Riley asked for, one cancelled
    add('taylor', 'medical', addDays(mon(1), 1), addDays(mon(1), 1), { status: 'approved', by: 'jordan', part: 'am', asked: at(addDays(t, -6), 10) });
    add('taylor', 'vac', addDays(mon(6), 1), addDays(mon(6), 2), { status: 'approved', by: 'amir', asked: at(addDays(t, -12), 10) });
    add('taylor', 'personal', addDays(mon(-3), 3), addDays(mon(-3), 3), { status: 'cancelled', asked: at(addDays(t, -30), 10) });
    add('taylor', 'vac', addDays(mon(-8), 3), mon(-7), { status: 'approved', by: 'amir' });
    // Casey (new this year): a sick day recorded for her yesterday, an afternoon waiting
    const yd = office(addDays(t, -1), -1);
    add('casey', 'sick', yd, yd, { status: 'approved', recordedBy: 'jordan', asked: at(yd, 7) });
    add('casey', 'other', addDays(mon(1), 2), addDays(mon(1), 2), { part: 'pm', asked: at(addDays(t, -1), 16), note: 'Car inspection' });
    // Morgan (part-time): two paid days waiting (part-time staff earn no paid time off), a personal day taken
    add('morgan', 'vac', mon(4), addDays(mon(4), 1), { asked: at(addDays(t, -3), 12) });
    add('morgan', 'personal', addDays(mon(-4), 1), addDays(mon(-4), 1), { status: 'approved', by: 'jordan' });
    // Jordan (approves): their own request waits for Dr. A; bereavement taken
    add('jordan', 'vac', mon(8), addDays(mon(8), 3), { asked: at(addDays(t, -1), 9), note: 'Beach week with the kids' });
    add('jordan', 'bereave', mon(-6), addDays(mon(-6), 1), { status: 'approved', by: 'amir', asked: at(addDays(mon(-6), -1), 18) });
    // Sam (has left): history only
    add('sam', 'vac', mon(-14), addDays(mon(-14), 3), { status: 'approved', by: 'amir' });
    // scrubs (2 pairs a year): Riley got a pair; Taylor waits for two; Jordan's own waits for Dr. A
    const perk = (sid, items, reason, o) => {
      o = o || {}; const id = 'p' + hexId(12), status = o.status || 'pending', asked = o.asked || at(addDays(t, -2), 10), ev = [{ a: 'ask', by: sid, at: asked }];
      let decision; if (o.by) { decision = { s: status, by: o.by, at: Math.min(now - 1800000, asked + 86400000), note: o.dnote || '' }; ev.push({ a: status === 'approved' ? 'approve' : 'deny', by: o.by, at: decision.at, note: o.dnote || '' }); }
      DEMO.perks.set(id, Object.assign({ sid, kind: 'scrubs', items, pairs: items.length, reason, at: asked, events: ev }, decision ? { decision } : {},
        { id, status, rev: ev.length, v: 1, year: y, pubX: 'demo', by: ev[ev.length - 1].by, updatedAt: ev[ev.length - 1].at, createdAtSrv: asked, hasMe: true }));
    };
    const it = (color, piece, size, petite) => ({ color, piece, size, petite: !!petite });
    perk('riley', [it('navy', 'set', 'M')], 'The knee tore on my navy pair', { status: 'approved', by: 'jordan', asked: at(addDays(t, -60), 9) });
    perk('taylor', [it('teal', 'set', 'S', true), it('black', 'set', 'S', true)], 'Still wearing the one set I started with', { asked: at(addDays(t, -1), 16) });
    perk('jordan', [it('gray', 'top', 'L')], 'My top faded in the wash', { asked: at(addDays(t, -3), 11) });
  }
};

/* =====================================================================
   A made-up copy of the old Time-Off Sheet (its tabs as rows of cells,
   the way a CSV download reads), with the balances its 6 AM script would
   have left on day T: Fridays and holidays counted, partial days as full
   days, tiers at 1 and 3 years, part-time and orientation ignored. For
   trying "Move from the old app" in the demo, and for the tests. The
   Password and Passcode cells are filled with made-up text so the tests
   can check they never get read.
   ===================================================================== */
function demoOldSheet(T) {
  const Y = Number(T.slice(0, 4)), jan1 = Y + '-01-01', mon0 = addDays(T, -((weekday(T) + 6) % 7)), wk = (n, k) => addDays(mon0, -7 * n + (k || 0));
  const P = [
    { name: 'Jordan Sample', role: 'approver', title: 'Office Manager', type: 'FullTime', hire: '2010-06-03' },
    { name: 'Riley Example', role: 'staff', title: 'Clinical Assistant', type: 'FullTime', hire: '2023-03-13' },
    { name: 'Taylor Mock', role: 'staff', title: 'Clinical Assistant', type: 'FullTime', hire: addDays(T, -(365 * 2 - 40)), byHand: 4.25 },
    { name: 'Morgan Test', role: 'staff', title: 'Front Desk', type: 'PartTime', hire: '2024-09-09' },
    { name: 'Casey Demo', role: 'staff', title: 'Sterilization', type: 'FullTime', hire: addDays(T, -150) },
    { name: 'Drew Newhire', role: 'staff', title: 'Front Desk', type: 'FullTime', hire: addDays(T, -40) },
    { name: 'Sam Former', role: 'staff', title: 'Clinical Assistant', type: 'FullTime', hire: '2022-02-07', moved: addDays(T, -60) }
  ];
  let n = 0; const id = () => (0x3A51C000 + (++n) * 7919).toString(16).toUpperCase().slice(-8);
  const R = [], at = (iso, h, m) => iso + ' ' + String(h).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0') + ':00';
  const req = (name, start, end, type, hours, status, o) => {
    o = o || {}; const asked = addDays(start, -(o.ahead || 21)), by = o.by || 'Amir Akhavan';
    R.push({ id: id(), ts: at(asked, 9, 15 + n % 40), name, start, end, type, paid: o.unpaid ? 'Unpaid' : 'Paid Time Off', hours: hours || 'Full Day', cover: o.cover || '', notes: o.notes || '', status,
      rby: status === 'Pending' ? '' : status === 'Cancelled' ? '' : by, rat: status === 'Pending' || status === 'Cancelled' ? '' : at(addDays(asked, 1), 10, 5), ded: o.ded });
  };
  const past = d => d <= T;
  req('Riley Example', wk(30), wk(30, 4), 'Vacation', 'Full Day', 'Approved', { notes: 'Spring trip', ded: past(wk(30)) });
  req('Riley Example', wk(33, 1), wk(33, 1), 'Sick Leave', 'Full Day', 'Approved', { ahead: 0, ded: past(wk(33, 1)) });
  req('Riley Example', wk(18, 1), wk(18, 1), 'Medical Appointment', 'Morning (AM)', 'Approved', { ded: past(wk(18, 1)) });
  req('Riley Example', wk(25, 2), wk(25, 2), 'Personal Day', 'Full Day', 'Approved', { ded: past(wk(25, 2)) });
  req('Riley Example', wk(38), wk(38, 2), 'Vacation', 'Full Day', 'Denied', {});
  req('Riley Example', wk(-6, 1), wk(-6, 3), 'Vacation', 'Full Day', 'Pending', { notes: 'Cousin’s wedding', ahead: 30 });
  req('Taylor Mock', wk(13), wk(13, 4), 'Vacation', 'Full Day', 'Approved', { ded: past(wk(13)), by: 'Jordan Sample' });
  req('Taylor Mock', wk(7, 2), wk(7, 2), 'Other', '2 Hours', 'Approved', { notes: 'Notary appointment', ded: past(wk(7, 2)) });
  req('Taylor Mock', wk(20, 3), wk(20, 3), 'Personal Day', 'Full Day', 'Cancelled', {});
  req('Morgan Test', wk(21), wk(21, 1), 'Vacation', 'Full Day', 'Approved', { ded: past(wk(21)) });
  req('Jordan Sample', wk(33), wk(33, 4), 'Vacation', 'Full Day', 'Approved', { ded: past(wk(33)) });
  req('Jordan Sample', wk(26), wk(26, 1), 'Bereavement', 'Full Day', 'Approved', { ahead: 1, ded: past(wk(26)) });
  req('Jordan Sample', wk(-9), wk(-9, 3), 'Vacation', 'Full Day', 'Pending', { ahead: 40 });
  req('Casey Demo', wk(3, 1), wk(3, 1), 'Sick Leave', 'Full Day', 'Approved', { ahead: 0, ded: past(wk(3, 1)), by: 'Jordan Sample' });
  req('Casey Demo', wk(1, 3), wk(1, 3), 'Vacation', 'Full Day', 'Approved', { ahead: 2 }); // approved, but the 6 AM script never took it off
  req('Drew Newhire', wk(-1, 2), wk(-1, 2), 'Other', 'Afternoon (PM)', 'Pending', { ahead: 3, notes: 'DMV' });
  req('Sam Former', wk(28), wk(28, 3), 'Vacation', 'Full Day', 'Approved', { ded: past(wk(28)) });
  req('Pat Gone', (Y - 1) + '-08-04', (Y - 1) + '-08-05', 'Vacation', 'Full Day', 'Approved', { ded: true });
  // the old app's own arithmetic, day by day from January 1
  const oldTier = y => y >= 3 ? { pm: 8.5, cap: 102, n: 3 } : y >= 1 ? { pm: 5.67, cap: 68, n: 2 } : { pm: 2.83, cap: 34, n: 1 };
  const bal = new Map(P.map(p => [p.name, { vac: 0, sick: 0, last: '' }])), log = [['Timestamp', 'Employee', 'Type', 'Amount', 'NewBalance', 'Reason', 'AdjustedBy']];
  P.forEach((p, i) => { if (p.hire < jan1) log.push([at(jan1, 6, 0), p.name, 'Vacation', -round2(12 + i * 3.5), 0, 'Jan 1 annual reset (balance paid out via payroll)', 'System'], [at(jan1, 6, 0), p.name, 'Sick Leave', -round2(5 + i), 0, 'Jan 1 annual reset', 'System']); });
  const adj = { day: wk(12, 3), name: 'Jordan Sample', h: 8.5, why: 'Worked the Saturday open house' };
  for (let d = jan1, g = 0; d <= T && g < 400; d = addDays(d, 1), g++) {
    for (const r of R) {
      if (r.status !== 'Approved' || r.start !== d || !r.ded) continue;
      r.ded = d;
      const t = r.type.toLowerCase(), b = /bereavement|personal/.test(t) ? '' : /sick/.test(t) ? 'sick' : 'vac'; if (!b) continue;
      const B = bal.get(r.name); if (!B) continue;
      const h = oldScriptHours(r.start, r.end, r.hours); B[b] = round2(Math.max(0, B[b] - h));
      log.push([at(d, 6, 1), r.name, b === 'sick' ? 'Sick Leave' : 'Vacation', -h, B[b], 'Approved time-off: ' + r.start + (r.end !== r.start ? ' — ' + r.end : '') + ' (' + h + ' hrs)', 'System (approved by ' + r.rby + ')']);
    }
    if (d === adj.day) { const B = bal.get(adj.name); B.vac = round2(B.vac + adj.h); log.push([at(d, 14, 30), adj.name, 'vacation', adj.h, adj.why, 'Amir Akhavan']); }
    if (isLastOfMonth(d)) for (const p of P) {
      if (!p.hire || p.hire > d || (p.moved && d >= p.moved)) continue;
      const B = bal.get(p.name), t = oldTier(yearsOfService(p.hire, d)), v = round2(Math.min(B.vac + t.pm, t.cap)), dv = round2(v - B.vac);
      B.vac = v; B.sick = round2(B.sick + 2.83); B.last = d;
      log.push([at(d, 6, 2), p.name, 'Vacation', dv, v, dv > 0 ? 'Monthly accrual (Tier ' + t.n + ', cap ' + t.cap + ')' : 'Monthly accrual skipped — at annual cap (' + t.cap + ' hrs)', 'System'], [at(d, 6, 2), p.name, 'Sick Leave', 2.83, B.sick, 'Monthly accrual', 'System']);
    }
  }
  const row = (p, i) => { const B = bal.get(p.name); return [p.name, 'NOT-A-REAL-CODE-' + i, p.role, p.title, p.type, p.hire, '', B.sick, round2(B.vac + (p.byHand || 0)), B.last, p.role === 'approver' ? 'Approves time off' : '', 'NOT-A-REAL-PASSWORD-' + i, '', ''].concat(p.moved ? [p.moved] : []); };
  const head = ['Name', 'Passcode', 'Role', 'Title', 'EmploymentType', 'HireDate', 'OrientationEndDate', 'SickLeaveBalance', 'VacationBalance', 'LastAccrualDate', 'Notes', 'Password', 'PersonalDaysBalance', 'DaysOffYTD'];
  const tk = thanksgiving(Y), tabs = new Map([
    ['Requests', [['ID', 'Timestamp', 'Employee Name', 'Start Date', 'End Date', 'Request Type', 'Paid/Unpaid', 'Hours', 'Coverage', 'Notes', 'Status', 'Reviewed By', 'Reviewed At', 'DeductedOn']]
      .concat(R.map(r => [r.id, r.ts, r.name, r.start, r.end, r.type, r.paid, r.hours, r.cover, r.notes, r.status, r.rby, r.rat, r.ded || '']))
      .concat([['BAD00001', at(T, 9), 'Riley Example', '', '', 'Vacation', 'Paid Time Off', 'Full Day', '', '', 'Pending', '', '', '']])],
    ['BenefitsEmployees', [head].concat(P.filter(p => !p.moved).map(row))],
    ['FormerStaff', [head.concat(['Moved from BenefitsEmployees'])].concat(P.filter(p => p.moved).map(row))],
    ['BalanceLog', log],
    ['Holidays', [['Date', 'Label'], [Y + '-12-24', 'Christmas Eve'], [Y + '-07-04', 'Independence Day']]],
    ['Blackouts', [['Start Date', 'End Date', 'Label'], [Y + '-01-01', Y + '-01-31', 'January Blackout (All Year)'], [addDays(tk, -3), addDays(tk, 3), 'Thanksgiving Week'], [Y + '-12-21', Y + '-12-31', 'Holiday rush']]]
  ]);
  return { tabs, date1904: false };
}
