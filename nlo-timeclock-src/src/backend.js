/* =====================================================================
   Firebase backend (the NLO Cases project). Two separate sign-ins on
   the page, neither of them the one NLO Cases or Time Off use on the
   same computer:
   - 'tc': a person, signed in with their NLO login (managers; anyone
     checking their own week, or clocking in on their own phone or
     computer at the office once Dr. A turns the office lock on);
   - 'tcKiosk': this computer as a time clock, with the login Dr. A made
     for it on it (kept there until he removes it): the office's
     time-clock computer, or a laptop he approved for working from home.
   The office lock asks the office check (a Cloudflare Worker) where a
   login is right before a punch; the rules then take one "at the
   office" punch, under the punch number the check gave, for 2 minutes.
   Nothing here is sealed: the clock holds times, never patient data.
   The rules decide who reads and writes what (../nlo-cases-src/firestore.rules).
   ===================================================================== */
const FB = {
  emu: false, cfg: null,
  app: null, auth: null, db: null,     // a person
  kapp: null, kauth: null, kdb: null,  // this computer as a time clock
  me: null, mgr: false, kiosk: null, unsubs: [], skew: 0, onSync: null, pending: 0, noIndex: false,
  // kiosk: this computer as a time clock — { uid, name, kind: 'clock' (the office's time-clock computer) | 'laptop' (an
  // approved laptop), sids (a laptop: the people it's for) }

  ts() { return firebase.firestore.FieldValue.serverTimestamp(); },
  tsMs(t) { return t && t.toMillis ? t.toMillis() : (typeof t === 'number' ? t : 0); },
  isPerm(e) { return /permission/i.test((e && (e.code || e.message)) || ''); },
  isOwner() { return !!(FB.me && FB.me.role === 'owner'); },
  isMgr() { return !!FB.mgr; },
  now() { return Date.now() + FB.skew; },
  available() { return typeof firebase !== 'undefined' && !!firebase.initializeApp; },
  configured() { return FB.emu || FB_CONFIG.apiKey.indexOf('__') !== 0; },
  init(emu) {
    FB.emu = !!emu;
    FB.cfg = FB.emu ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-nlo-cases', appId: 'demo' } : FB_CONFIG;
    if (!FB.available() || !FB.configured()) return false;
    const mk = name => { try { return firebase.app(name); } catch (e) { return firebase.initializeApp(FB.cfg, name); } };
    FB.app = mk('tc'); FB.auth = FB.app.auth(); FB.db = FB.app.firestore();
    FB.kapp = mk('tcKiosk'); FB.kauth = FB.kapp.auth(); FB.kdb = FB.kapp.firestore();
    if (FB.emu) {
      [FB.auth, FB.kauth].forEach(a => a.useEmulator('http://127.0.0.1:9099', { disableWarnings: true }));
      [FB.db, FB.kdb].forEach(d => d.useEmulator('127.0.0.1', 8080));
    }
    return true;
  },
  busy(n) { FB.pending += n; if (FB.onSync) FB.onSync(); },
  async track(p) { FB.busy(1); try { return await p; } finally { FB.busy(-1); } },
  /* the server's clock, from a time it just wrote (so "since 7:52" and the hours so far don't depend on this device's clock) */
  noteServer(ms, sentAt) { if (ms > 0) { const mid = sentAt + (Date.now() - sentAt) / 2; FB.skew = Math.round(ms - mid); } },

  /* ---------- who's here: both saved sign-ins, read once at load ---------- */
  /* kioskErr: this computer has a time-clock login but its record couldn't be read just now (no internet, the database's
     rules, …): the login is kept and the page tries again — only records the server says are gone sign it out (its
     password is random and kept nowhere, so a sign-out means Dr. A sets it up again) */
  async restore() {
    const once = a => new Promise(res => { const u = a.onAuthStateChanged(x => { u(); res(x); }); });
    const [ku, pu] = await Promise.all([once(FB.kauth), once(FB.auth)]);
    let kiosk = null, person = null, kioskGone = false, lapWait = null, kioskErr = null;
    if (ku) {
      try {
        kiosk = await FB.kioskResume(ku, true);
        // a laptop still waiting for Dr. A to approve it (its request is there): keep waiting
        if (!kiosk) lapWait = await FB.lapAsked(ku.uid, true);
        if (!kiosk && !lapWait) { kioskGone = true; await FB.kauth.signOut().catch(() => { }); }
      } catch (e) { kiosk = null; lapWait = null; kioskErr = e; }
    }
    if (pu) { try { person = await FB.loadMe(pu); } catch (e) { person = null; if (!FB.isNet(e)) await FB.auth.signOut().catch(() => { }); } }
    return { kiosk, person, kioskGone, lapWait, kioskErr };
  },
  isNet(e) { return /unavailable|network|offline|timeout|deadline/i.test((e && (e.code || e.message)) || ''); },

  /* ---------- a person (same logins as NLO Cases) ---------- */
  async emailFor(login) {
    const s = String(login || '').trim();
    if (s.includes('@')) return s.toLowerCase();
    const un = slug(s); if (!un) throw errCode('no-user');
    const snap = await FB.db.doc('logins/' + un).get();
    if (!snap.exists) throw errCode('no-user');
    return snap.data().email;
  },
  async signIn(login, pw, stay) {
    const email = await FB.emailFor(login);
    const P = firebase.auth.Auth.Persistence;
    await FB.auth.setPersistence(stay ? P.LOCAL : P.SESSION).catch(() => { });
    const cred = await FB.auth.signInWithEmailAndPassword(email, pw);
    return FB.loadMe(cred.user);
  },
  async loadMe(user) {
    const ms = await FB.db.doc('members/' + user.uid).get();
    if (!ms.exists) { await FB.signOut(); throw errCode('not-member'); }
    const m = ms.data();
    if (!m.active) { await FB.signOut(); throw errCode('inactive'); }
    if (m.mustSetup) { await FB.signOut(); throw errCode('first-login'); }
    FB.me = { uid: user.uid, staffId: m.staffId || '', role: m.role || 'staff', name: m.name || '', email: user.email || '' };
    // a manager here: Dr. A, or someone he made a time clock manager (People → Edit)
    let mgr = m.role === 'owner';
    if (!mgr && m.staffId) { try { mgr = (await FB.db.doc('tcMgrs/' + m.staffId).get()).exists; } catch (e) { mgr = false; } }
    FB.mgr = mgr;
    return FB.me;
  },
  async signOut() { FB.stop(); FB.me = null; FB.mgr = false; try { await FB.auth.signOut(); } catch (e) { } },

  /* ---------- this computer as a time clock (the office's, or an approved laptop) ---------- */
  /* server: read from the server only (a copy kept on this computer could say "not there" while offline) */
  async kioskResume(user, server) {
    const o = server ? { source: 'server' } : undefined;
    const s = await FB.kdb.doc('tcKiosks/' + user.uid).get(o);
    if (s.exists) { FB.kiosk = { uid: user.uid, name: s.data().name || 'Time clock', kind: 'clock', sids: [] }; return FB.kiosk; }
    const l = await FB.kdb.doc('tcLaptops/' + user.uid).get(o);
    if (!l.exists) return null; // Dr. A removed it
    const d = l.data();
    FB.kiosk = { uid: user.uid, name: d.name || 'Laptop', kind: 'laptop', sids: Array.isArray(d.sids) ? d.sids.filter(x => typeof x === 'string').slice(0, 4) : [] };
    return FB.kiosk;
  },
  /* Dr. A, on the computer that becomes the time clock: its own login (kept on this computer only) */
  async kioskEnroll(name) {
    if (!FB.isOwner()) throw errCode('permission');
    const email = 'tc-clock-' + hexId(6) + '@' + STAFF_DOMAIN;
    await FB.kauth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const cred = await FB.track(FB.kauth.createUserWithEmailAndPassword(email, randomPassword()));
    try { await FB.track(FB.db.doc('tcKiosks/' + cred.user.uid).set({ name, at: FB.ts(), by: FB.me.uid })); }
    catch (e) { try { await cred.user.delete(); } catch (x) { } throw e; }
    FB.kiosk = { uid: cred.user.uid, name, kind: 'clock', sids: [] };
    return FB.kiosk;
  },
  /* ---------- a laptop someone works from home on (Amir, 9 Oct 2026), approved by Dr. A from his own phone or computer:
     on the laptop, its own new login asks with a 6-digit code it shows; Dr. A types the code to approve it (his password
     never goes on the laptop) ---------- */
  async lapAsk(dev) {
    const email = 'tc-laptop-' + hexId(6) + '@' + STAFF_DOMAIN, code = String(100000 + randInt(900000));
    await FB.kauth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const cred = await FB.track(FB.kauth.createUserWithEmailAndPassword(email, randomPassword()));
    try { await FB.track(FB.kdb.doc('tcLapReq/' + cred.user.uid).set({ code, dev: String(dev || '').slice(0, 80), at: FB.ts() })); }
    catch (e) { try { await cred.user.delete(); } catch (x) { } await FB.kauth.signOut().catch(() => { }); throw e; }
    return { uid: cred.user.uid, code, at: FB.now() };
  },
  /* the request this laptop's login made (null: none — turned down, or never asked) */
  async lapAsked(uid, server) {
    const s = await FB.kdb.doc('tcLapReq/' + uid).get(server ? { source: 'server' } : undefined);
    return s.exists ? { uid, code: String(s.data().code || ''), at: FB.tsMs(s.data().at) } : null;
  },
  /* waiting for Dr. A: on('ok', kiosk) once he approves it; on('no') if he turns it down (its request is gone, and no
     approval) */
  lapWait(uid, on) {
    const offs = [];
    let done = false;
    const finish = (what, k) => { if (done) return; done = true; offs.forEach(u => { try { u(); } catch (e) { } }); on(what, k); };
    const check = async () => {
      try { const k = await FB.kioskResume({ uid }); if (k) { finish('ok', k); return; } } catch (e) { }
      try { if (!(await FB.lapAsked(uid))) finish('no'); } catch (e) { }
    };
    offs.push(FB.kdb.doc('tcLaptops/' + uid).onSnapshot(s => { if (s.exists) check(); }, () => { }));
    offs.push(FB.kdb.doc('tcLapReq/' + uid).onSnapshot(s => { if (!s.exists) check(); }, () => { }));
    return () => { done = true; offs.forEach(u => { try { u(); } catch (e) { } }); };
  },
  /* changed their mind on the laptop: its login goes (its request can't be approved without it working, and Dr. A's page
     stops showing it after 30 minutes and clears it after a day) */
  async lapCancel() {
    const u = FB.kauth.currentUser; if (!u) return;
    try { await u.delete(); } catch (e) { }
    await FB.kauth.signOut().catch(() => { });
  },
  /* Dr. A approves it (its name, who uses it) or turns it down */
  async lapApprove(uid, name, sids) {
    if (!FB.isOwner()) throw errCode('permission');
    const b = FB.db.batch();
    b.set(FB.db.doc('tcLaptops/' + uid), { name, sids, at: FB.ts(), by: FB.me.uid });
    b.delete(FB.db.doc('tcLapReq/' + uid));
    await FB.track(b.commit());
  },
  async lapDecline(uid) { await FB.track(FB.db.doc('tcLapReq/' + uid).delete()); },
  /* an approved laptop's own record, from the server (null: Dr. A took it back) */
  async lapSelfNow() { const s = await FB.kdb.doc('tcLaptops/' + FB.kiosk.uid).get({ source: 'server' }); return s.exists ? s.data() : null; },
  async kioskForget() { FB.stop(); FB.kiosk = null; try { await FB.kauth.signOut(); } catch (e) { } },
  async kioskSeen() { if (FB.kiosk) await FB.kdb.doc((FB.kiosk.kind === 'laptop' ? 'tcLaptops/' : 'tcKiosks/') + FB.kiosk.uid).update({ seen: FB.ts() }); },

  /* ---------- the database's rules know the time clock and the office lock (Dr. A publishes them) ---------- */
  async rulesOk(asKiosk) {
    try { await (asKiosk ? FB.kdb : FB.db).doc('meta/rules_tc_2').get(); return true; }
    catch (e) { if (FB.isPerm(e)) return false; throw e; }
  },

  /* ---------- the office lock: where this login is right now ----------
     The office check (url: a workers.dev address) looks at the address the request comes from and writes down, under
     its own login, which network this login is on, with a new one-time punch number (pid) only this page is told; the
     rules then take one "at the office" punch, under that number, for 2 minutes (a newer check replaces it).
     → { office, net, org, city, relay (an address many people share: Private Relay, a VPN), pid, bot (which login the
     office check runs with) }. Throws when it can't tell (no answer in 8 s, or an error). */
  async netCheck(url, asDevice, ms) {
    if (!url) throw errCode('no-check', 'The office check isn’t set up yet.');
    const u = (asDevice ? FB.kauth : FB.auth).currentUser;
    if (!u) throw errCode('not-signed-in', 'Not signed in.');
    const token = await u.getIdToken();
    // (plain text, so the browser sends it at once instead of asking the Worker first)
    let r;
    try { r = await withTimeout(fetch(url + '/check', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: token, cache: 'no-store', credentials: 'omit' }), ms || 8000); }
    catch (e) { throw errCode('net-check', e && e.code === 'timeout' ? 'The office check didn’t answer in time.' : 'Couldn’t reach the office check.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j || !j.ok) throw errCode('net-check', 'The office check answered: ' + ((j && (j.detail || j.error)) || r.status) + '.');
    const pid = /^p[0-9a-f]{24}$/.test(String(j.pid || '')) ? j.pid : '';
    return { office: j.office === true && !!pid, net: String(j.net || ''), org: String(j.org || ''), city: String(j.city || ''), relay: j.relay === true, pid, bot: String(j.bot || '') };
  },
  async isSetUp(asKiosk) { return (await (asKiosk ? FB.kdb : FB.db).doc('meta/tc').get()).exists; },

  /* ---------- live data ----------
     o.role: 'kiosk' | 'laptop' | 'mgr' | 'staff'; o.from: punches from this moment on (ms); on(kind, list) */
  watch(o, on) {
    FB.stop();
    const kiosk = o.role === 'kiosk' || o.role === 'laptop', db = kiosk ? FB.kdb : FB.db, sid = o.sid || '';
    const fromTs = firebase.firestore.Timestamp.fromMillis(o.from);
    const fixTs = firebase.firestore.Timestamp.fromMillis(o.from - TCE.HOUR);
    const add = u => FB.unsubs.push(u);
    const docs = s => s.docs.map(d => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' })));
    const err = kind => e => on('error', { kind, e });
    const list = (q, kind) => add(q.onSnapshot(s => on(kind, docs(s)), err(kind)));
    const one = (path, kind) => add(db.doc(path).onSnapshot(s => on(kind, s.exists ? Object.assign({ id: s.id }, s.data({ serverTimestamps: 'estimate' })) : null), err(kind)));
    one('meta/tc', 'set');
    // an approved laptop reads only the people it's for, one by one (each person's lists put together for the page), and
    // its own record (Dr. A changes who uses it, or takes it back: 'lapself', null once it's gone)
    if (o.role === 'laptop') {
      const agg = {}, put = (kind, who, vals) => { (agg[kind] = agg[kind] || {})[who] = vals; on(kind, [].concat.apply([], Object.keys(agg[kind]).map(k => agg[kind][k]))); };
      const doc1 = s => (s.exists ? [Object.assign({ id: s.id }, s.data({ serverTimestamps: 'estimate' }))] : []);
      const errOf = who => kind => e => on('error', { kind, e, who });
      // (a "not there" from the copy kept on this computer — offline, say — isn't news: only the server's)
      if (FB.kiosk) add(db.doc('tcLaptops/' + FB.kiosk.uid).onSnapshot(s => { if (!s.exists && s.metadata.fromCache) return; on('lapself', s.exists ? Object.assign({ id: s.id }, s.data()) : null); }, () => { }));
      (o.sids || []).forEach(who => {
        const er = errOf(who);
        add(db.doc('roster/' + who).onSnapshot(s => put('roster', who, doc1(s)), er('roster')));
        add(db.doc('tcStaff/' + who).onSnapshot(s => put('staff', who, doc1(s)), er('staff')));
        add(db.doc('tcTry/' + who).onSnapshot(s => put('try', who, doc1(s)), er('try')));
        FB.staffPunches(db, who, fromTs, (kind, list) => put(kind, who, list), er);
        ['tcFix:fix', 'tcOT:ot', 'tcReq:req'].forEach(x => { const [c, kind] = x.split(':'); add(db.collection(c).where('sid', '==', who).onSnapshot(s => put(kind, who, docs(s)), er(kind))); });
      });
      if (!(o.sids || []).length) ['roster', 'staff', 'try', 'punch', 'fix', 'ot', 'req'].forEach(k => on(k, []));
      return;
    }
    list(db.collection('roster'), 'roster');
    if (o.role === 'staff') {
      one('tcStaff/' + sid, 'staff1');
      FB.staffPunches(db, sid, fromTs, on, err);
      list(db.collection('tcFix').where('sid', '==', sid), 'fix');
      list(db.collection('tcOT').where('sid', '==', sid), 'ot');
      list(db.collection('tcReq').where('sid', '==', sid), 'req');
      return;
    }
    list(db.collection('tcStaff'), 'staff');
    list(db.collection('tcPunch').where('at', '>=', fromTs), 'punch');
    list(db.collection('tcFix').where('at', '>=', fixTs), 'fix');
    // requests to fix someone's time: the last 31 days (a request can only be for a punch in the last 31 days)
    list(db.collection('tcReq').where('at', '>=', firebase.firestore.Timestamp.fromMillis(Math.min(o.from, FB.now() - 31 * TCE.DAY))), 'req');
    list(db.collection('tcOT'), 'ot');
    list(db.collection('tcTry'), 'try');
    if (o.role === 'mgr') {
      list(db.collection('tcMgrs'), 'mgrs');
      list(db.collection('tcKiosks'), 'kiosks');
      list(db.collection('tcLaptops'), 'laptops');
      // (Dr. A's: nobody else reads the office's networks, or the laptops asking to be approved)
      if (FB.isOwner()) { list(db.collection('tcOffice'), 'offices'); list(db.collection('tcLapReq'), 'lapreqs'); }
      list(db.collection('tcBeat'), 'beat');
      list(db.collection('tcSent').orderBy('at', 'desc').limit(60), 'sent');
      one('meta/tcAlerts', 'alerts');
    }
  },
  /* someone's own punches: with an index (sid + time) only the recent ones are read; without it, all of theirs (it still
     works — Firestore needs an index for "theirs, since a day", which Settings offers to make) */
  staffPunches(db, sid, fromTs, on, err) {
    const docs = s => s.docs.map(d => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' })));
    const all = () => FB.unsubs.push(db.collection('tcPunch').where('sid', '==', sid).onSnapshot(s => on('punch', docs(s)), err('punch')));
    if (FB.noIndex) { all(); return; }
    let u = null;
    u = db.collection('tcPunch').where('sid', '==', sid).where('at', '>=', fromTs).onSnapshot(s => on('punch', docs(s)), e => {
      if (/failed-precondition|index/i.test((e && (e.code || e.message)) || '')) {
        FB.noIndex = true; FB.indexLink = ((e.message || '').match(/https:\/\/console\.firebase\.google\.com\S+/) || [''])[0];
        try { u(); } catch (x) { }
        all();
      } else err('punch')(e);
    });
    FB.unsubs.push(() => { try { u(); } catch (x) { } });
  },
  stop() { FB.unsubs.forEach(u => { try { u(); } catch (e) { } }); FB.unsubs = []; },
  /* everything in a span (payroll, an older timesheet): one read, not live */
  async loadRange(fromMs, toMs) {
    const db = FB.db, T = firebase.firestore.Timestamp;
    const [p, f, ot] = await FB.track(Promise.all([
      db.collection('tcPunch').where('at', '>=', T.fromMillis(fromMs)).where('at', '<', T.fromMillis(toMs)).get(),
      db.collection('tcFix').where('at', '>=', T.fromMillis(fromMs - TCE.HOUR)).get(),
      db.collection('tcOT').get()
    ]));
    const docs = s => s.docs.map(d => Object.assign({ id: d.id }, d.data()));
    return { punches: docs(p), fixes: docs(f), ot: docs(ot) };
  },

  /* ---------- at the time clock: the PIN, then the punch ----------
     A try is counted before the PIN is checked (5 in 10 minutes for each person), the check only goes through with the
     right PIN, and the punch uses it up in the same save. The hash of the PIN tried goes where nobody can read it
     (tcTryPh), in the same save as its try. */
  async pinTry(sid, pin) {
    const db = FB.kdb, ref = db.doc('tcTry/' + sid), ph = await pinHash(sid, pin), me = FB.kiosk.uid;
    const s = await FB.track(ref.get()), cur = s.exists ? s.data() : null, t0 = cur ? FB.tsMs(cur.t0) : 0, now = FB.now();
    const bad = cur ? (Number(cur.bad) || 0) + 1 : 1;
    const save = d => { const b = db.batch(); b.set(ref, d); b.set(db.doc('tcTryPh/' + sid), { ph, at: FB.ts() }); return b.commit(); };
    const fresh = () => save({ n: 1, t0: FB.ts(), at: FB.ts(), ok: false, k: me, bad, u: '' });
    const next = () => save({ n: cur.n + 1, t0: cur.t0, at: FB.ts(), ok: false, k: me, bad, u: '' });
    const order = !cur ? ['fresh'] : now > t0 + 10 * TCE.MIN ? ['fresh', 'next'] : ['next', 'fresh'];
    let n = 0;
    for (const w of order) {
      if (w === 'next' && !(cur && cur.n < 5)) continue;
      try { await FB.track(w === 'fresh' ? fresh() : next()); n = w === 'fresh' ? 1 : cur.n + 1; break; }
      catch (e) { if (!FB.isPerm(e)) throw e; }
    }
    if (!n) return { ok: false, locked: true, until: t0 + 10 * TCE.MIN };
    try { await FB.track(ref.update({ ok: true })); return { ok: true }; }
    catch (e) {
      if (!FB.isPerm(e)) throw e;
      const start = n === 1 ? now : t0;
      return { ok: false, left: 5 - n, locked: n >= 5, until: start + 10 * TCE.MIN };
    }
  },
  /* the try isn't used (they walked away, or pressed Cancel): nothing left over for anyone else */
  async pinRelease(sid) {
    if (!FB.kiosk) return;
    await FB.kdb.doc('tcTry/' + sid).set(FB.usedTry('')).catch(() => { });
  },
  /* a try used up (u: what used it — the punch's id, 'pin' for a new PIN, '' when let go) */
  usedTry(u) { return { n: 0, t0: FB.ts(), at: FB.ts(), ok: false, k: '', bad: 0, u }; },
  /* the database is there right now (a quick read from the server, not this computer's copy) */
  async ping(ms) { await withTimeout(FB.kdb.doc('meta/rules_tc_2').get({ source: 'server' }).catch(e => { if (!FB.isPerm(e)) throw e; }), ms || 6000); },
  /* net: where the time clock (or laptop) is — 'office', 'off', 'unk' (couldn't check) or '' (not checked); pid: the punch
     number the office check just gave (an "at the office" punch is saved under it) */
  async punch(sid, kind, net, pid) {
    const db = FB.kdb, id = net === 'office' && pid ? pid : 'p' + hexId(12), b = db.batch(), sent = Date.now();
    b.set(db.doc('tcPunch/' + id), { sid, kind, at: FB.ts(), src: FB.kiosk.kind === 'laptop' ? 'laptop' : 'kiosk', by: FB.kiosk.uid, net: net || '' });
    b.set(db.doc('tcTry/' + sid), FB.usedTry(id));
    await FB.track(withTimeout(b.commit(), 15000));
    let at = 0;
    try { at = FB.tsMs((await db.doc('tcPunch/' + id).get()).data().at); FB.noteServer(at, sent); } catch (e) { }
    return { id, at: at || FB.now() };
  },
  async pinChange(sid, pin) {
    const db = FB.kdb, b = db.batch();
    b.set(db.doc('tcPin/' + sid), { h: await pinHash(sid, pin), at: FB.ts() });
    b.update(db.doc('tcStaff/' + sid), { pinAt: FB.ts(), pinBy: 'self', at: FB.ts(), by: FB.kiosk.uid });
    b.set(db.doc('tcTry/' + sid), FB.usedTry('pin'));
    await FB.track(b.commit());
  },

  /* ---------- asking a manager to fix their time (a punch they missed, or a note) ----------
     ps: [{ k: kind, t: ms }] (at most 2; none for a note). At the time clock it needs the person's PIN just before (the
     PIN isn't used up: they can punch next); signed in, it's for themselves. */
  reqDoc(sid, ps, note, src, by) { return { sid, ps: ps.map(p => ({ k: p.k, t: Math.round(p.t) })), note: String(note || '').slice(0, 200), src, by, at: FB.ts(), st: 'open' }; },
  /* a request and its count (at most 10 in 24 hours for each person) in one save */
  async reqSave(db, sid, doc) {
    const id = 'r' + hexId(12), nRef = db.doc('tcReqN/' + sid);
    const s = await FB.track(nRef.get()), cur = s.exists ? s.data() : null;
    const fresh = !cur || FB.now() > FB.tsMs(cur.t0) + TCE.DAY;
    if (!fresh && cur.n >= 10) throw errCode('too-many', 'That’s 10 requests in a day. Tell a manager in person.');
    const b = db.batch();
    b.set(nRef, fresh ? { n: 1, t0: FB.ts(), at: FB.ts() } : { n: cur.n + 1, t0: cur.t0, at: FB.ts() });
    b.set(db.doc('tcReq/' + id), doc);
    await FB.track(withTimeout(b.commit(), 15000));
    return { id };
  },
  async reqSend(sid, ps, note) { return FB.reqSave(FB.kdb, sid, FB.reqDoc(sid, ps, note, FB.kiosk.kind === 'laptop' ? 'laptop' : 'kiosk', FB.kiosk.uid)); },
  async reqSendMine(ps, note) { return FB.reqSave(FB.db, FB.me.staffId, FB.reqDoc(FB.me.staffId, ps, note, 'me', FB.me.uid)); },
  /* the person takes it back (at the time clock right after their PIN, or signed in) */
  async reqTakeBack(id, atKiosk) { await FB.track((atKiosk ? FB.kdb : FB.db).doc('tcReq/' + id).update({ st: 'x', rat: FB.ts() })); },
  /* a manager answers: approved (the punches, as asked or as changed, become corrections in the same save) or declined */
  async reqAnswer(r, ok, ps, why, note) {
    const b = FB.db.batch(), fx = [];
    if (ok) ps.forEach(p => { const id = 'f' + hexId(12); fx.push(id); b.set(FB.db.doc('tcFix/' + id), FB.fixDoc(r.sid, 'add', '', p.k, Math.round(p.t), why)); });
    b.update(FB.db.doc('tcReq/' + r.id), { st: ok ? 'ok' : 'no', rby: FB.me.uid, rbsid: FB.me.staffId, rat: FB.ts(), rwhy: String(note || '').slice(0, 300), fx });
    await FB.track(b.commit());
  },

  /* ---------- on their own phone or computer, at the office (right after the office check said so, under the punch number
     it gave; the rules check) ---------- */
  async punchOwn(kind, pid) {
    if (!pid) throw errCode('not-office', 'The office check didn’t give a punch number.');
    const id = pid, sent = Date.now();
    await FB.track(withTimeout(FB.db.doc('tcPunch/' + id).set({ sid: FB.me.staffId, kind, at: FB.ts(), src: 'own', by: FB.me.uid, net: 'office' }), 15000));
    let at = 0;
    try { at = FB.tsMs((await FB.db.doc('tcPunch/' + id).get()).data().at); FB.noteServer(at, sent); } catch (e) { }
    return { id, at: at || FB.now() };
  },

  /* ---------- managers ---------- */
  /* Dr. A, once: the clock's settings, where alerts go (his own email to start), and everyone on the team on the clock */
  async setupOffice(people) {
    if (!FB.isOwner()) throw errCode('permission');
    const b = FB.db.batch(), d = TCE.DEFAULTS;
    b.set(FB.db.doc('meta/tc'), { wk: d.wk, ot: d.ot, thr: d.thr.slice(), early: d.early, late: d.late, shift: d.shift, brk: d.brk, days: d.days.slice(), pay: '', lock: false, wurl: '', at: FB.ts() });
    b.set(FB.db.doc('meta/tcAlerts'), { emails: okEmail(FB.me.email) ? [FB.me.email] : [], topic: '', route: {}, digest: '', test: null, at: FB.ts() });
    people.forEach(sid => b.set(FB.db.doc('tcStaff/' + sid), { on: true, home: false, hdays: [], early: '', cap: 0, sal: false, pinAt: null, pinBy: '', at: FB.ts(), by: FB.me.uid }));
    await FB.track(b.commit());
  },
  async saveStaff(sid, f, cur) {
    await FB.track(FB.db.doc('tcStaff/' + sid).set({
      on: !!f.on, home: !!f.home, hdays: f.hdays || [], early: f.early || '', cap: f.sal ? 0 : Number(f.cap) || 0, sal: !!f.sal,
      pinAt: cur && cur.pinAt ? cur.pinAt : null, pinBy: cur && ['mgr', 'self'].includes(cur.pinBy) ? cur.pinBy : '', at: FB.ts(), by: FB.me.uid
    }));
  },
  async setPin(sid, pin) {
    const b = FB.db.batch();
    b.set(FB.db.doc('tcPin/' + sid), { h: await pinHash(sid, pin), at: FB.ts() });
    b.update(FB.db.doc('tcStaff/' + sid), { pinAt: FB.ts(), pinBy: 'mgr', at: FB.ts(), by: FB.me.uid });
    await FB.track(b.commit());
  },
  /* Dr. A makes someone a time clock manager, or stops */
  async setMgr(sid, on) {
    if (!FB.isOwner()) throw errCode('permission');
    const ref = FB.db.doc('tcMgrs/' + sid);
    await FB.track(on ? ref.set({ at: FB.ts(), by: FB.me.uid }) : ref.delete());
  },
  async clearTry(sid) { await FB.track(FB.db.doc('tcTry/' + sid).set(FB.usedTry(''))); },
  fixDoc(sid, op, ref, kind, t, why) { return { sid, op, ref, kind, t, why: String(why).slice(0, 300), by: FB.me.uid, bsid: FB.me.staffId, at: FB.ts() }; },
  async fixAdd(sid, kind, t, why) { await FB.track(FB.db.doc('tcFix/f' + hexId(12)).set(FB.fixDoc(sid, 'add', '', kind, Math.round(t), why))); },
  async fixVoid(sid, ref, why) { await FB.track(FB.db.doc('tcFix/f' + hexId(12)).set(FB.fixDoc(sid, 'void', ref, '', 0, why))); },
  async fixMove(sid, ref, kind, t, why) {
    const b = FB.db.batch();
    b.set(FB.db.doc('tcFix/f' + hexId(12)), FB.fixDoc(sid, 'void', ref, '', 0, why));
    b.set(FB.db.doc('tcFix/f' + hexId(12)), FB.fixDoc(sid, 'add', '', kind, Math.round(t), why));
    await FB.track(b.commit());
  },
  async setOT(sid, week, hrs, why) {
    await FB.track(FB.db.doc('tcOT/' + sid + '_' + week).set({ sid, week, hrs: Number(hrs), why: String(why || '').slice(0, 300), by: FB.me.uid, bsid: FB.me.staffId, at: FB.ts() }));
  },
  async delOT(sid, week) { await FB.track(FB.db.doc('tcOT/' + sid + '_' + week).delete()); },
  /* the clock's settings, whole (o.lock and o.wurl: the office lock, kept as they are unless changed) */
  async saveSettings(o) {
    await FB.track(FB.db.doc('meta/tc').set({ wk: o.wk, ot: o.ot, thr: o.thr, early: o.early, late: o.late, shift: o.shift, brk: o.brk, days: o.days, pay: o.pay, lock: !!o.lock, wurl: o.wurl || '', at: FB.ts() }));
  },
  async saveAlerts(o, cur) {
    await FB.track(FB.db.doc('meta/tcAlerts').set({ emails: o.emails, topic: o.topic, route: o.route, digest: o.digest, test: cur && cur.test ? cur.test : null, at: FB.ts() }));
  },
  async testAlert() { await FB.track(FB.db.doc('meta/tcAlerts').update({ test: FB.ts(), at: FB.ts() })); },
  /* the alert script's own login (a new one each time; the old ones stop working) */
  async makeBot() {
    if (!FB.isOwner()) throw errCode('permission');
    const email = 'tc-alerts-' + hexId(6) + '@' + STAFF_DOMAIN, password = randomPassword();
    const tmp = firebase.initializeApp(FB.cfg, 'tcBot' + hexId(4));
    let uid;
    try {
      if (FB.emu) tmp.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      await tmp.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
      uid = (await FB.track(tmp.auth().createUserWithEmailAndPassword(email, password))).user.uid;
      await tmp.auth().signOut();
    } finally { tmp.delete().catch(() => { }); }
    const old = await FB.db.collection('tcBots').get();
    const b = FB.db.batch();
    b.set(FB.db.doc('tcBots/' + uid), { email, at: FB.ts() });
    old.docs.forEach(d => { if (d.id !== uid) b.delete(d.ref); });
    await FB.track(b.commit());
    return { email, password, uid };
  },
  async hasBot() { try { return !(await FB.db.collection('tcBots').get()).empty; } catch (e) { return false; } },
  async renameKiosk(uid, name) { await FB.track(FB.db.doc('tcKiosks/' + uid).update({ name })); },
  async removeKiosk(uid) { await FB.track(FB.db.doc('tcKiosks/' + uid).delete()); },
  async laptopSave(uid, name, sids) { await FB.track(FB.db.doc('tcLaptops/' + uid).update({ name, sids })); },
  async laptopRemove(uid) { await FB.track(FB.db.doc('tcLaptops/' + uid).delete()); },

  /* ---------- the office lock (Dr. A) ---------- */
  /* the office check's own login (a new one each time). The one running keeps working until the new copy answers the test
     (netBotsKeep): then the older logins stop working. */
  async makeNetBot() {
    if (!FB.isOwner()) throw errCode('permission');
    const email = 'tc-check-' + hexId(6) + '@' + STAFF_DOMAIN, password = randomPassword();
    const tmp = firebase.initializeApp(FB.cfg, 'tcNet' + hexId(4));
    let uid;
    try {
      if (FB.emu) tmp.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      await tmp.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
      uid = (await FB.track(tmp.auth().createUserWithEmailAndPassword(email, password))).user.uid;
      await tmp.auth().signOut();
    } finally { tmp.delete().catch(() => { }); }
    await FB.track(FB.db.doc('tcNetBot/' + uid).set({ email, at: FB.ts() }));
    return { email, password, uid };
  },
  async netBotDrop(uid) { await FB.track(FB.db.doc('tcNetBot/' + uid).delete()); },
  /* the office check's logins that work right now, newest first */
  async netBots() { return (await FB.db.collection('tcNetBot').get()).docs.map(d => ({ uid: d.id, local: String(d.data().email || '').split('@')[0], at: FB.tsMs(d.data().at) })).sort((a, z) => z.at - a.at); },
  /* the code got out: all but the newest stop working now (phones can't clock in until the newest is deployed) */
  async netBotsOnlyNewest() {
    const all = await FB.netBots(); if (all.length < 2) return 0;
    const b = FB.db.batch(); all.slice(1).forEach(x => b.delete(FB.db.doc('tcNetBot/' + x.uid))); await FB.track(b.commit());
    return all.length - 1;
  },
  /* the office check answered with this login (bot: the part of its address before the @). When it's the newest one, the
     older ones stop working → 'new' (nothing older left), or 'old' (it still runs an older copy: nothing changes) */
  async netBotsKeep(bot) {
    if (!FB.isOwner()) return 'old';
    const all = (await FB.db.collection('tcNetBot').get()).docs.map(d => ({ ref: d.ref, local: String(d.data().email || '').split('@')[0], at: FB.tsMs(d.data().at) }));
    const newest = all.slice().sort((a, z) => z.at - a.at)[0];
    if (!newest || newest.local !== bot) return 'old';
    const old = all.filter(x => x !== newest);
    if (old.length) { const b = FB.db.batch(); old.forEach(x => b.delete(x.ref)); await FB.track(b.commit()); }
    return 'new';
  },
  checkConfig(bot) {
    const c = { projectId: FB.cfg.projectId, apiKey: FB.cfg.apiKey, botEmail: bot.email, botPassword: bot.password, origins: [location.origin], referer: APP_URL };
    if (FB.emu) Object.assign(c, { authBase: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1', fsBase: 'http://127.0.0.1:8080/v1', emulator: true }); // (tests)
    return c;
  },
  /* "This is the office": the network the office check just saw Dr. A's own login on (the rules: in the last 5 minutes,
     and not an address many people share) */
  async saveOffice(net, name, seen) {
    await FB.track(FB.db.doc('tcOffice/' + net).set({ name, org: String(seen.org || '').slice(0, 100), city: String(seen.city || '').slice(0, 60), by: FB.me.uid, at: FB.ts() }));
  },
  async renameOffice(net, name) { await FB.track(FB.db.doc('tcOffice/' + net).update({ name })); },
  async removeOffice(net) { await FB.track(FB.db.doc('tcOffice/' + net).delete()); },
  /* where a time clock was last seen (Dr. A) */
  async seenOf(uid) { const s = await FB.db.doc('tcNetSeen/' + uid).get(); if (!s.exists) return null; const d = s.data(); return { net: d.net || '', office: d.office === true, org: d.org || '', city: d.city || '', relay: d.relay === true, at: FB.tsMs(d.at) }; },
  scriptConfig(bot) {
    const c = { apiKey: FB.cfg.apiKey, projectId: FB.cfg.projectId, botEmail: bot.email, botPassword: bot.password, appUrl: APP_URL };
    if (FB.emu) Object.assign(c, { authBase: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1', fsBase: 'http://127.0.0.1:8080/v1' }); // (tests)
    return c;
  }
};
