/* =====================================================================
   nlo-meeting-db.js — the Staff Meeting Hub and Month-End Numbers on the NLO Cases system (30 Oct 2026)
   Amir, 30 Oct 2026: the Staff Meeting Hub should sign in like Case Tracker, with no Google step ("Full move only").
   - NLOM.db(fs, sid) gives the pages their old database's calls (ref(path).on / once / set / update / remove / push /
     transaction / off, ref().update(map)) on the NLO Cases database: each old path is one record (+ a field inside it):
       nlo/staffMeeting/inbox/<id>        → mtgInbox/<id>        actionItems/<id> → mtgActions/<id>
       decisions/<id>                     → mtgDecisions/<id>    kpiDefs/<id>     → mtgKpiDefs/<id>
       meetings/<id>                      → mtgMeetings/<id>     (its transcript and lastNotes → mtgTexts/<id>)
       config → mtgState/config           currentMeetingId → mtgState/current.id      roster → mtgState/roster
       monthEnd/months/<ym> → meMonths/<ym>   monthEnd/years → meState/years   monthEnd/config → meState/config
       nlo/settings/aisaAdminKey → mtgState/aisa.key
     and, read-only: the office AI key (Inventory's invState/ai.gemini) and Staff Hub's roster (Cadence's copy,
     cadMirror/roster.people). Anything else (the Office Calendar, Onboarding) is read from the old database only when
     this computer is already signed in there with an office Google account (never asked for).
     Every write is stamped `_up` (the database's time) and `_by` (the NLO Cases staff id): the rules check both. Reads
     leave the stamps out, and a record with nothing else in it reads as not there (as in the old database).
   - NLOM.signIn / watch / lock: the NLO Cases login (as Case Tracker): username + password, no session kept across
     reloads, NLO Cases' idle minutes, a login turned off is locked out at once.
   - NLOM.moved(): which database these pages use (mtgMeta/moved, readable before signing in).
   - NLOM.cadenceCopy / inventoryOld: Cadence's numbers and Inventory's spending, read where they now live.
   - NLOM.moveIn / moveBack: Dr. A's move (old database → NLO Cases) and the way back.
   ===================================================================== */
(function () {
  'use strict';
  const NC_FB = { apiKey: 'AIzaSyAoPSh6DaKTeg-NplM-UaPoxlFdTo0u4go', authDomain: 'nlo-cases.firebaseapp.com', projectId: 'nlo-cases', appId: '1:1050188201609:web:df7890b26686b41a395058' };
  const APP = 'nloCasesLogin', LAST = 'nloMtg.lastLogin', RULES_MARK = 'meta/rules_mtg_1';
  const ROOT = 'nlo/staffMeeting';
  const MOUNTS = [
    { path: ROOT + '/inbox', col: 'mtgInbox' },
    { path: ROOT + '/actionItems', col: 'mtgActions' },
    { path: ROOT + '/decisions', col: 'mtgDecisions' },
    { path: ROOT + '/kpiDefs', col: 'mtgKpiDefs' },
    { path: ROOT + '/meetings', col: 'mtgMeetings', texts: 'mtgTexts', textKeys: ['transcript', 'lastNotes'] },
    { path: ROOT + '/config', doc: 'mtgState/config' },
    { path: ROOT + '/currentMeetingId', doc: 'mtgState/current', field: 'id' },
    { path: ROOT + '/roster', doc: 'mtgState/roster' },
    { path: ROOT + '/monthEnd/months', col: 'meMonths' },
    { path: ROOT + '/monthEnd/years', doc: 'meState/years' },
    { path: ROOT + '/monthEnd/config', doc: 'meState/config' },
    { path: 'nlo/settings/aisaAdminKey', doc: 'mtgState/aisa', field: 'key' },
    { path: 'nlo/settings/geminiKey', doc: 'invState/ai', field: 'gemini', ro: true },
    { path: 'nlo/cadence/roster/people', doc: 'cadMirror/roster', field: 'people', ro: true }
  ].map(m => Object.assign({ segs: m.path.split('/') }, m));
  /* what a move copies: every old path above that isn't read-only */
  const MOVED = MOUNTS.filter(m => !m.ro);

  const segsOf = p => String(p || '').split('/').filter(Boolean);
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const STAMPS = ['_up', '_by'];

  /* ---------- values the old database's way ---------- */
  /* written: no nulls / undefined inside, an empty object is nothing, no list directly inside a list (Firestore can't) */
  function clean(v, inList) {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) {
      const a = v.map(x => { const c = clean(x, true); return c === null ? null : c; });
      if (inList) { const o = {}; a.forEach((x, i) => { if (x !== null) o[i] = x; }); return Object.keys(o).length ? o : null; }
      return a.length ? a : null;
    }
    if (typeof v === 'object') {
      if (typeof v.toMillis === 'function') return v.toMillis();
      const o = {}; Object.keys(v).forEach(k => { const c = clean(v[k], false); if (c !== null) o[k] = c; });
      return Object.keys(o).length ? o : null;
    }
    if (typeof v === 'number' && !isFinite(v)) return null;
    return v;
  }
  /* read: stamps left out, Firestore times as milliseconds, an object keyed 0..n read as a list when the old database would
     have (more than half of the keys up to the largest are there) */
  function plain(v, top) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return v.map(x => plain(x, false));
    if (typeof v === 'object') {
      if (typeof v.toMillis === 'function') return v.toMillis();
      const keys = Object.keys(v).filter(k => !(top && STAMPS.indexOf(k) >= 0));
      if (!keys.length) return null;
      if (keys.every(k => /^(0|[1-9]\d{0,8})$/.test(k))) {
        const max = Math.max.apply(null, keys.map(Number));
        if (max < 2 * keys.length) { const a = []; for (let i = 0; i <= max; i++) a.push(v[i] === undefined ? null : plain(v[i], false)); return a; }
      }
      const o = {}; keys.forEach(k => { const c = plain(v[k], false); if (c !== null) o[k] = c; });
      return Object.keys(o).length ? o : null;
    }
    return v;
  }
  function getIn(v, fp) { for (let i = 0; i < fp.length; i++) { if (!v || typeof v !== 'object') return null; v = v[fp[i]]; } return v === undefined ? null : v; }
  function setIn(o, fp, val) { let c = o; for (let i = 0; i < fp.length - 1; i++) { if (!isObj(c[fp[i]])) c[fp[i]] = {}; c = c[fp[i]]; } c[fp[fp.length - 1]] = val; }

  /* ---------- push keys, as the old database makes them (time-ordered) ---------- */
  const PUSH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let lastPush = 0, lastRand = [];
  function pushKey() {
    let now = Date.now(); const dup = now === lastPush; lastPush = now;
    const t = new Array(8); for (let i = 7; i >= 0; i--) { t[i] = PUSH.charAt(now % 64); now = Math.floor(now / 64); }
    let id = t.join('');
    if (!dup) { lastRand = []; for (let i = 0; i < 12; i++) lastRand[i] = Math.floor(Math.random() * 64); }
    else { let i; for (i = 11; i >= 0 && lastRand[i] === 63; i--) lastRand[i] = 0; if (i >= 0) lastRand[i]++; }
    for (let i = 0; i < 12; i++) id += PUSH.charAt(lastRand[i]);
    return id;
  }

  /* ---------- where an old path lives ---------- */
  function mountOf(segs) {
    for (const m of MOUNTS) { if (segs.length >= m.segs.length && m.segs.every((s, i) => segs[i] === s)) return m; }
    return null;
  }
  /* → { m, col } (a whole collection) | { m, doc, fp, texts? } (a record and a field path inside it) | null */
  function target(path) {
    const segs = segsOf(path), m = mountOf(segs);
    if (!m) return null;
    const rest = segs.slice(m.segs.length);
    if (m.col) {
      if (!rest.length) return { m, col: m.col };
      const id = rest[0], f = rest.slice(1);
      if (m.texts && f.length && m.textKeys.indexOf(f[0]) >= 0) return { m, doc: m.texts + '/' + id, fp: f };
      return { m, doc: m.col + '/' + id, fp: f, texts: m.texts && !f.length ? m.texts + '/' + id : null };
    }
    return { m, doc: m.doc, fp: m.field ? [m.field].concat(rest) : rest };
  }

  /* =====================================================================
     the adapter: fs = a Firestore instance (the NLO Cases login's), sid() = the signed-in staff id,
     rt = the old database to read anything else from when this computer is already signed in there (or null)
     ===================================================================== */
  function makeDb(fs, sid, rtIn) {
    const FV = firebase.firestore.FieldValue, FP = firebase.firestore.FieldPath;
    const rtOf = typeof rtIn === 'function' ? rtIn : () => rtIn;
    const listeners = [];   // { path, cb, stop }
    const stamp = () => ({ _up: FV.serverTimestamp(), _by: String(sid() || '') });
    const docRef = p => fs.doc(p);
    const dataOf = s => (s && s.exists ? s.data() : null);
    /* a meeting is its record + its texts record */
    function withTexts(t, d, x) {
      let v = plain(d, true);
      if (t.m.texts) {
        const tx = plain(x, true);
        if (tx) { v = v || {}; t.m.textKeys.forEach(k => { if (tx[k] != null) v[k] = tx[k]; }); }
      }
      return v;
    }
    function snap(path, val) { const s = segsOf(path); return { key: s.length ? s[s.length - 1] : null, val: () => val, exists: () => val !== null, ref: api.ref(path) }; }
    function notHere(path) { const e = new Error('Not on the NLO Cases system: ' + path); e.code = 'not-available'; return e; }

    /* ---- reading: a path's value, as the old database gives it ----
       The first value comes only once the server has answered (offline, Firestore would first say "nothing here" from its
       empty cache, and the pages would start a new meeting over the real one); after that, only a real change is an event
       (a save that changes nothing but the stamps, or only the order of keys, isn't one — as in the old database, so a page
       that saves what it computes from what it reads settles instead of saving again and again). A listener that fails
       (e.g. refused) is dropped. */
    const META = { includeMetadataChanges: true };
    function listen(path, cb, err) {
      const t = target(path), subs = [];
      let dead = false, last;   // last: what was delivered last (its fingerprint); undefined = nothing yet
      const stopAll = () => { subs.splice(0).forEach(u => { try { u(); } catch (e) { } }); };
      const fail = e => { if (dead) return; dead = true; stopAll(); if (typeof err === 'function') { try { err(e); } catch (x) { } } else console.warn(path, e); };
      const deliver = (v, fromServer) => {
        if (dead || (last === undefined && !fromServer)) return;
        const f = JSON.stringify(canon(v));
        if (f === last) return;
        last = f; cb(snap(path, v));
      };
      const stop = () => { dead = true; stopAll(); };
      if (!t) {
        const rt = rtOf();
        if (rt) { const r = rt.ref(path); const f = s => { if (!dead) cb(snap(path, s.val())); }; r.on('value', f, fail); subs.push(() => r.off('value', f)); return stop; }
        setTimeout(() => fail(notHere(path)), 0);
        return stop;
      }
      if (t.col) {
        let main = null, tx = t.m.texts ? null : {}, sa = false, sb = !t.m.texts;
        const emit = () => {
          if (main === null || tx === null) return;
          const out = {};
          Object.keys(main).concat(Object.keys(tx).filter(id => !(id in main))).sort().forEach(id => { const v = withTexts(t, main[id] || null, tx[id]); if (v !== null) out[id] = v; });
          deliver(Object.keys(out).length ? out : null, sa && sb);
        };
        subs.push(fs.collection(t.col).onSnapshot(META, q => { main = {}; q.forEach(d => { main[d.id] = d.data(); }); if (!q.metadata.fromCache) sa = true; emit(); }, fail));
        if (t.m.texts) subs.push(fs.collection(t.m.texts).onSnapshot(META, q => { tx = {}; q.forEach(d => { tx[d.id] = d.data(); }); if (!q.metadata.fromCache) sb = true; emit(); }, fail));
        return stop;
      }
      if (t.texts) {
        let A, B, ga = false, gb = false, sa = false, sb = false;
        const emit = () => { if (ga && gb) deliver(withTexts(t, A, B), sa && sb); };
        subs.push(docRef(t.doc).onSnapshot(META, s => { A = dataOf(s); ga = true; if (!s.metadata.fromCache) sa = true; emit(); }, fail));
        subs.push(docRef(t.texts).onSnapshot(META, s => { B = dataOf(s); gb = true; if (!s.metadata.fromCache) sb = true; emit(); }, fail));
        return stop;
      }
      let sv = false;
      subs.push(docRef(t.doc).onSnapshot(META, s => {
        if (!s.metadata.fromCache) sv = true;
        const v = plain(dataOf(s), true);
        deliver(t.fp.length ? plain(getIn(v, t.fp), false) : v, sv);
      }, fail));
      return stop;
    }
    /* once: the first value from the server (as the old database: from what a listener already has, else it asks) */
    function readOnce(path) {
      return new Promise((res, rej) => {
        let stop = null, done = false;
        const end = () => { done = true; setTimeout(() => { if (stop) stop(); }, 0); };
        stop = listen(path, s => { if (!done) { end(); res(s); } }, e => { if (!done) { end(); rej(e); } });
      });
    }

    /* ---- writing: one or more old paths → one batch (the old database's multi-path update) ---- */
    function plan(entries) {
      const per = {};   // doc → { whole: value|null|undefined, fields: [[fp, value]] }
      const put = (doc, fn) => { const p = per[doc] || (per[doc] = { whole: undefined, fields: [] }); fn(p); };
      entries.forEach(([path, value]) => {
        const t = target(path);
        if (!t) throw notHere(path);
        if (t.m.ro) { const e = new Error('Read-only here: ' + path); e.code = 'permission-denied'; throw e; }
        if (t.col) throw notHere(path + ' (a whole list)');
        const v = clean(value, false);
        if (!t.fp.length) {
          if (t.texts) {   // a whole meeting: its texts go to their own record
            const main = isObj(v) ? Object.assign({}, v) : v, tx = {};
            if (isObj(main)) t.m.textKeys.forEach(k => { if (main[k] != null) { tx[k] = main[k]; delete main[k]; } });
            put(t.doc, p => { p.whole = isObj(main) && Object.keys(main).length ? main : null; });
            put(t.texts, p => { p.whole = Object.keys(tx).length ? tx : null; });
          } else put(t.doc, p => { p.whole = isObj(v) ? v : null; if (v !== null && !isObj(v)) throw new Error('A record must be an object: ' + path); });
        } else put(t.doc, p => p.fields.push([t.fp, v]));
      });
      Object.keys(per).forEach(doc => {
        const p = per[doc];
        if (p.whole !== undefined && p.fields.length) throw new Error('Path ' + doc + ' is an ancestor of another path in the same update');
        const seen = p.fields.map(f => f[0].join('\u0001'));
        p.fields.forEach(f => { const k = f[0].join('\u0001'); if (seen.some(o => o !== k && (o.indexOf(k + '\u0001') === 0))) throw new Error('Path ' + f[0].join('/') + ' is an ancestor of another path in the same update'); });
      });
      return per;
    }
    function apply(batchOrTx, per) {
      Object.keys(per).forEach(doc => {
        const p = per[doc], ref = docRef(doc);
        if (p.whole === null) batchOrTx.delete(ref);
        else if (p.whole !== undefined) batchOrTx.set(ref, Object.assign({}, p.whole, stamp()));
        else {
          const data = stamp(), paths = [new FP('_up'), new FP('_by')];
          p.fields.forEach(([fp, v]) => { setIn(data, fp, v === null ? FV.delete() : v); paths.push(new FP(...fp)); });
          batchOrTx.set(ref, data, { mergeFields: paths });
        }
      });
    }
    function write(entries) {
      if (NL.paused) return Promise.reject(pausedErr());
      try { const per = plan(entries), b = fs.batch(); apply(b, per); return b.commit(); }
      catch (e) { return Promise.reject(e); }
    }

    const api = {
      ref(path) {
        path = segsOf(path).join('/');
        const self = {
          key: segsOf(path).slice(-1)[0] || null,
          path,
          child: p => api.ref(path + '/' + p),
          on(ev, cb, err) {
            const ent = { path, cb, stop: null };
            listeners.push(ent);
            ent.stop = listen(path, cb, e => {
              const i = listeners.indexOf(ent); if (i >= 0) listeners.splice(i, 1);
              if (typeof err === 'function') err(e); else console.warn(path, e);
            });
            return cb;
          },
          off(ev, cb) {
            for (let i = listeners.length - 1; i >= 0; i--) {
              const l = listeners[i];
              if (l.path === path && (!cb || l.cb === cb)) { try { l.stop(); } catch (e) { } listeners.splice(i, 1); }
            }
          },
          once() { return readOnce(path); },
          set(v) { return write([[path, v]]); },
          remove() { return write([[path, null]]); },
          update(obj) {
            if (!path) return write(Object.keys(obj || {}).map(k => [segsOf(k).join('/'), obj[k]]));
            return write(Object.keys(obj || {}).map(k => [path + '/' + segsOf(k).join('/'), obj[k]]));
          },
          push(v) {
            const c = api.ref(path + '/' + pushKey());
            if (v === undefined) return c;
            const p = c.set(v); c.then = p.then.bind(p); c.catch = p.catch.bind(p); return c;
          },
          async transaction(fn) {
            if (NL.paused) throw pausedErr();
            const t = target(path);
            if (!t || t.col || t.m.ro) throw notHere(path);
            let out, committed = false;
            await fs.runTransaction(async tx => {
              const ds = await tx.get(docRef(t.doc));
              const cur = t.fp.length ? plain(getIn(plain(dataOf(ds), true), t.fp), false) : plain(dataOf(ds), true);
              const nv = fn(cur === undefined ? null : cur);
              if (nv === undefined) { committed = false; out = cur; return; }
              committed = true; out = clean(nv, false);
              apply(tx, plan([[path, nv]]));
            });
            return { committed, snapshot: snap(path, out) };
          }
        };
        return self;
      },
      /* stop everything listening (Lock) */
      offAll() { listeners.splice(0).forEach(l => { try { l.stop(); } catch (e) { } }); },
      pending() { try { return fs.waitForPendingWrites(); } catch (e) { return Promise.resolve(); } }
    };
    return api;
  }

  /* =====================================================================
     the NLO Cases login (as Case Tracker): username → email → sign in → an active member, set up
     ===================================================================== */
  const NL = { app: null, auth: null, fs: null, ready: null, me: null, unsubs: [], idleMin: 10, paused: false };
  function pausedErr() { const e = new Error('The Staff Meeting Hub is being moved right now — try again in a minute.'); e.code = 'paused'; return e; }
  function init() {
    if (NL.app) return NL;
    try { NL.app = firebase.app(APP); } catch (e) { NL.app = firebase.initializeApp(NC_FB, APP); }
    NL.auth = NL.app.auth(); NL.fs = NL.app.firestore();
    NL.ready = NL.auth.setPersistence(firebase.auth.Auth.Persistence.NONE).catch(() => { });
    return NL;
  }
  const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30);
  function err(code) { const e = new Error(code); e.code = code; return e; }
  const codeOf = e => String((e && (e.code || e.message)) || '');
  const badLogin = e => /invalid-credential|wrong-password|user-not-found|invalid-login|invalid-email|missing-password|user-disabled/.test(codeOf(e));
  function errText(e) {
    const c = codeOf(e);
    if (/no-user/.test(c)) return 'No login with that username.';
    if (/inactive/.test(c)) return 'This login has been turned off. Ask Dr. A.';
    if (/not-member/.test(c)) return 'That account isn’t part of the office.';
    if (/first-login/.test(c)) return 'Finish setting up your login in NLO Cases first (it asks for a new password), then come back.';
    if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a minute and try again.';
    if (/network|unavailable|offline|deadline/i.test(c)) return 'Can’t reach the server. Check the internet connection and try again.';
    if (badLogin(e)) return 'Username or password is incorrect.';
    return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
  }
  async function signIn(user, pw) {
    init(); await NL.ready;
    const u = String(user || '').trim();
    let email = u.toLowerCase();
    if (u.indexOf('@') < 0) {
      const un = slug(u); if (!un) throw err('no-user');
      const s = await NL.fs.doc('logins/' + un).get();
      if (!s.exists) throw err('no-user');
      email = s.data().email;
    }
    const cred = await NL.auth.signInWithEmailAndPassword(email, pw);
    const uid = cred.user.uid;
    try {
      const ms = await NL.fs.doc('members/' + uid).get();
      if (!ms.exists) throw err('not-member');
      const m = ms.data() || {};
      if (m.active !== true) throw err('inactive');
      if (m.mustSetup) throw err('first-login');
      let ro = null; try { if (m.staffId) { const r = await NL.fs.doc('roster/' + m.staffId).get(); ro = r.exists ? r.data() : null; } } catch (e) { }
      NL.me = { uid, email: cred.user.email || email, sid: String(m.staffId || ''), role: m.role === 'owner' ? 'owner' : 'staff', name: String(m.name || (ro && ro.name) || ''), rid: ro && typeof ro.rid === 'string' ? ro.rid : '' };
      try { localStorage.setItem(LAST, u); } catch (e) { }
      NL.fs.doc('members/' + uid).update({ lastLogin: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => { });
      try { const st = await NL.fs.doc('meta/settings').get(); const n = Number(st.exists ? (st.data() || {}).idleMin : 0); if (n > 0) NL.idleMin = n; } catch (e) { }
      return NL.me;
    } catch (e) { try { await NL.auth.signOut(); } catch (x) { } NL.me = null; throw e; }
  }
  /* while signed in: the login turned off / no longer a member → onOff(); NLO Cases' idle minutes */
  function watch(onOff) {
    unwatch();
    if (!NL.me) return;
    const uid = NL.me.uid;
    NL.unsubs.push(NL.fs.doc('members/' + uid).onSnapshot(s => {
      if (s.metadata && s.metadata.fromCache) return;
      const m = s.exists ? s.data() : null;
      if (!m || m.active !== true) onOff();
    }, e => { if (/permission/i.test(codeOf(e))) onOff(); }));
    NL.unsubs.push(NL.fs.doc('meta/settings').onSnapshot(s => { const n = Number(s.exists ? (s.data() || {}).idleMin : 0); NL.idleMin = n > 0 ? n : 10; }, () => { }));
  }
  function unwatch() { NL.unsubs.splice(0).forEach(u => { try { u(); } catch (e) { } }); }
  function idleMin() { const n = Number(NL.idleMin); return n > 0 ? n : 10; }
  /* Lock: anything still on its way is sent first (up to ~10 s), then the page starts over at the sign-in (nothing of the
     office's stays in memory; as NLO Cases, a reload means signing in again) */
  async function lock(msg) {
    unwatch();
    try { if (NL.fs) await Promise.race([NL.fs.waitForPendingWrites(), new Promise(r => setTimeout(r, 10000))]); } catch (e) { }
    try { sessionStorage.setItem('nloMtg.lockMsg', msg || 'Locked. Sign in to continue.'); } catch (e) { }
    try { if (NL.auth) await NL.auth.signOut(); } catch (e) { }
    location.reload();
  }
  function lockMsg() { let m = ''; try { m = sessionStorage.getItem('nloMtg.lockMsg') || ''; sessionStorage.removeItem('nloMtg.lockMsg'); } catch (e) { } return m; }
  /* sign the NLO Cases login out without reloading (Dr. A's login on the move page, when it closes) */
  async function signOut() { unwatch(); NL.me = null; try { if (NL.auth) await NL.auth.signOut(); } catch (e) { } }
  function lastLogin() { try { return localStorage.getItem(LAST) || ''; } catch (e) { return ''; } }

  /* which database: 'fs' (moved), 'rtdb' (not yet), or 'rtdb' with refused:true (older rules: can't tell) */
  async function moved() {
    init();
    try {
      const s = await Promise.race([NL.fs.doc('mtgMeta/moved').get({ source: 'server' }), new Promise((_, rej) => setTimeout(() => rej(err('deadline-exceeded')), 8000))]);
      const d = s.exists ? s.data() : null;
      const on = !!(d && d.on === true);
      try { if (on) localStorage.setItem('nloMtg.fs', '1'); else localStorage.removeItem('nloMtg.fs'); } catch (e) { }
      return { mode: on ? 'fs' : 'rtdb', at: d && d.at && d.at.toMillis ? d.at.toMillis() : null };
    } catch (e) {
      let seen = false; try { seen = localStorage.getItem('nloMtg.fs') === '1'; } catch (x) { }
      return { mode: seen ? 'fs' : 'rtdb', refused: /permission/i.test(codeOf(e)), offline: !/permission/i.test(codeOf(e)), seen };
    }
  }
  /* hear the move happen: cb(on, record) on every change of mtgMeta/moved. Refused (e.g. NLO Cases' rules don't have the
     Hub's part yet — before Dr. A publishes them, as part of the move) or cut off: listen again later (30 s, doubling to
     10 min), so a screen opened before the rules were published still hears the move. fsIn: another page's Firestore
     (Cadence's own login) instead of this one's; onErr(e): told about each refusal. */
  const movedSubs = new Set();
  /* a move is under way (the old database says so): every listener that's waiting to ask again asks now */
  function kickMoved() { movedSubs.forEach(k => { try { k(); } catch (e) { } }); }
  function onMoved(cb, fsIn, onErr) {
    const f = fsIn || init().fs;
    let unsub = null, timer = null, wait = 30000, stopped = false;
    const kick = () => { if (!stopped && !unsub) { clearTimeout(timer); wait = 30000; sub(); } };
    movedSubs.add(kick);
    const sub = () => {
      if (stopped) return;
      unsub = f.doc('mtgMeta/moved').onSnapshot({ includeMetadataChanges: true }, s => {
        wait = 30000;
        if (s.metadata && s.metadata.fromCache) return;
        const d = s.exists ? s.data() : null;
        cb(!!(d && d.on === true), d || {});
      }, e => {
        unsub = null;
        if (typeof onErr === 'function') { try { onErr(e); } catch (x) { } }
        if (!stopped) { timer = setTimeout(sub, wait); wait = Math.min(wait * 2, 600000); }
      });
    };
    sub();
    return () => { stopped = true; movedSubs.delete(kick); clearTimeout(timer); if (unsub) { try { unsub(); } catch (e) { } unsub = null; } };
  }
  /* where the Hub's data is, asked of the server: { on, pause, at } (null: can't tell — refused or no connection) */
  async function moveState(fsIn) {
    try {
      const f = fsIn || init().fs;
      const s = await Promise.race([f.doc('mtgMeta/moved').get({ source: 'server' }), new Promise((_, rej) => setTimeout(() => rej(err('deadline-exceeded')), 8000))]);
      const d = s.exists ? s.data() : {};
      return { on: d.on === true, pause: d.pause === true, at: d.at && d.at.toMillis ? d.at.toMillis() : null };
    } catch (e) { return /permission/i.test(codeOf(e)) ? { on: false, refused: true } : null; }
  }

  /* ---------- the screens' side of a move ----------
     A screen on the old database freezes while Dr. A moves the Hub (the old database's marker nlo/staffMeeting/moving, which
     every screen signed in there can read whatever the NLO Cases rules say) and switches over after (movedTo, or
     mtgMeta/moved). A screen on the NLO Cases system freezes while he moves it back (mtgMeta/moved.pause) and switches back
     after. A screen that finds the old database marked moved but can't confirm it with the NLO Cases database stops there
     (nothing is saved to the old copy) and says so. */
  let ovKeys = false;
  function overlay(msg, opts) {
    if (switching) return;
    let el = document.getElementById('nlomOverlay');
    if (!msg) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'nlomOverlay'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true');
      el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.74);display:flex;align-items:center;justify-content:center;padding:16px';
      document.body.appendChild(el);
      if (!ovKeys) { ovKeys = true; document.addEventListener('keydown', e => { if (document.getElementById('nlomOverlay') && !(e.target && e.target.id === 'nlomOvBtn')) { e.preventDefault(); e.stopPropagation(); } }, true); }
    }
    el.innerHTML = '<div style="max-width:430px;background:#fff;border-radius:16px;padding:22px 22px 18px;font:500 15px/1.5 Montserrat,system-ui,sans-serif;color:#1e293b;box-shadow:0 20px 60px rgba(0,0,0,.35)"><div id="nlomOvMsg"></div>' +
      (opts && opts.reload ? '<div style="text-align:right;margin-top:14px"><button type="button" id="nlomOvBtn" style="font:700 14px Montserrat,system-ui,sans-serif;padding:9px 16px;border-radius:10px;border:0;background:#1D3EA9;color:#fff;cursor:pointer">Reload</button></div>' : '') + '</div>';
    el.querySelector('#nlomOvMsg').textContent = msg;
    const b = el.querySelector('#nlomOvBtn'); if (b) { b.onclick = () => location.reload(); setTimeout(() => { try { b.focus(); } catch (e) { } }, 30); }
    try { if (document.activeElement && document.activeElement !== b && document.activeElement.blur) document.activeElement.blur(); } catch (e) { }
  }
  /* switching: this screen is about to reload (nothing else is shown over that) */
  let switching = false;
  function switchNow(text) { if (switching) return; overlay(text + ' Switching over…'); switching = true; setTimeout(() => location.reload(), 1200); }
  /* a move that was interrupted (Dr. A's screen closed mid-way) mustn't pause everyone for good: a marker older than this is
     ignored (the moving screen re-stamps it as it goes; the old database also removes it when that screen disconnects) */
  const STALE = 15 * 60000;
  const msOf = at => (typeof at === 'number' ? at : at && typeof at.toMillis === 'function' ? at.toMillis() : 0);
  const fresh = (at, off) => { const t = msOf(at); return t > 0 && (Date.now() + (off || 0)) - t < STALE; };   /* off: the server's clock offset */
  const waitFor = ms => Math.min(STALE + 1000, Math.max(1000, ms));
  /* a pause marker on the NLO Cases side: stale once this screen has seen the same one for STALE (no clocks compared) */
  function pauseClock() { let key = null, since = 0; return d => { const k = d && d.pause === true ? String(msOf(d.at)) : null; if (k !== key) { key = k; since = Date.now(); } return k === null ? -1 : STALE - (Date.now() - since); }; }
  const rememberFs = on => { try { if (on) localStorage.setItem('nloMtg.fs', '1'); else localStorage.removeItem('nloMtg.fs'); } catch (e) { } };
  const FREEZE_IN = 'Dr. A is moving the Staff Meeting Hub to the NLO Cases system. This screen switches over by itself in a minute or two — nothing to do.';
  const FREEZE_BACK = 'Dr. A is moving the Staff Meeting Hub back to the old database. This screen switches over by itself in a minute or two — nothing to do.';
  /* the old database's own markers (moving: a fresh one only / movedTo); cb(state) on each change, and again when a moving
     marker goes stale; onCancel(): the old database stopped them (e.g. its sign-in ended) */
  function watchOld(rt, cb, onCancel) {
    const st = { moving: null, movedTo: null, rawMoving: null }; let got = 0, timer = null, dead = false, off = 0;
    const a = rt.ref(ROOT + '/moving'), b = rt.ref(ROOT + '/movedTo'), o = rt.ref('.info/serverTimeOffset');
    const emit = () => {
      if (dead || got !== 3) return;
      clearTimeout(timer);
      const m = st.rawMoving;
      st.moving = m && fresh(m.at, off) ? m : null;
      if (st.moving) timer = setTimeout(emit, waitFor(STALE - (Date.now() + off - msOf(m.at)) + 1000));
      if (st.moving || st.movedTo) kickMoved();   /* (the NLO Cases rules are always published by the time of a move) */
      cb(st);
    };
    const fa = s => { st.rawMoving = s.val(); got |= 1; emit(); };
    const fb = s => { st.movedTo = s.val(); got |= 2; emit(); };
    const fo = s => { off = Number(s.val()) || 0; emit(); };
    const cancel = () => { if (dead) return; dead = true; clearTimeout(timer); stop(); if (typeof onCancel === 'function') { try { onCancel(); } catch (e) { } } };
    const stop = () => { try { a.off('value', fa); b.off('value', fb); o.off('value', fo); } catch (e) { } };
    o.on('value', fo, () => { }); a.on('value', fa, cancel); b.on('value', fb, cancel);
    return () => { dead = true; clearTimeout(timer); stop(); };
  }
  /* busy(): this screen is the one doing the move */
  function followNew(busy) {
    let timer = null;
    const left = pauseClock();
    return onMoved((on, d) => {
      clearTimeout(timer);
      if (busy()) { NL.paused = false; return; }
      if (!on) { NL.paused = false; if (d.on === false) { rememberFs(false); switchNow('The Staff Meeting Hub has moved back to the office Google sign-in.'); } return; }
      const ms = left(d), p = ms > 0;
      NL.paused = p;
      overlay(p ? FREEZE_BACK : null);
      if (p) timer = setTimeout(() => { NL.paused = false; overlay(null); }, waitFor(ms + 1000));
    });
  }
  function followOld(busy) { return onMoved(on => { if (on && !busy()) { rememberFs(true); switchNow('The Staff Meeting Hub has moved to the NLO Cases system.'); } }); }
  /* onClear(): told each time the old database is neither being moved nor marked moved (the page starts only then) */
  function watchOldDb(rt, busy, onClear, onCancel) {
    let wasPaused = false, checking = false, last = null;
    const resume = () => { overlay(null); if (typeof onClear === 'function') onClear(); };
    /* a pause that ended without the old database being marked moved (Dr. A's screen went away mid-way, or couldn't mark
       it): ask the NLO Cases database before carrying on here — moved: switch; no answer: stay paused and ask again */
    const check = () => {
      if (checking) return; checking = true;
      moveState().then(ms => {
        checking = false;
        if (busy() || switching || !last || last.moving || last.movedTo) return;
        if (ms && ms.on) { rememberFs(true); switchNow('The Staff Meeting Hub has moved to the NLO Cases system.'); return; }
        if (!ms) { setTimeout(() => { if (wasPaused) check(); }, 5000); return; }
        wasPaused = false; resume();
      });
    };
    return watchOld(rt, st => {
      last = st;
      if (busy()) return;
      if (st.movedTo) { movedAway(); return; }
      if (st.moving) { wasPaused = true; overlay(FREEZE_IN); return; }
      if (wasPaused) { overlay(FREEZE_IN); check(); return; }
      resume();
    }, onCancel);
  }
  /* Dr. A's screen claims the move (one screen at a time; a claim left by a screen that went away is taken over once stale;
     the old database removes it when that screen disconnects): resolves to the claim's token, or rejects (code 'busy') */
  async function claimMove(rt, by) {
    const token = pushKey(), ref = rt.ref(ROOT + '/moving');
    let off = 0; try { off = Number((await rt.ref('.info/serverTimeOffset').once('value')).val()) || 0; } catch (e) { }
    const r = await ref.transaction(cur => (cur && fresh(cur.at, off) && cur.token !== token) ? undefined : { at: firebase.database.ServerValue.TIMESTAMP, by: String(by || ''), token });
    if (!r.committed) { const e = new Error('another screen is moving the Hub right now'); e.code = 'busy'; throw e; }
    try { await ref.onDisconnect().remove(); } catch (e) { }
    return token;
  }
  async function moveStillMine(rt, token) { const v = (await rt.ref(ROOT + '/moving').once('value')).val(); return !!(v && v.token === token); }
  function touchMove(rt, token) { return rt.ref(ROOT + '/moving').transaction(cur => cur && cur.token === token ? Object.assign({}, cur, { at: firebase.database.ServerValue.TIMESTAMP }) : undefined).catch(() => { }); }
  async function releaseMove(rt, token) {
    const ref = rt.ref(ROOT + '/moving');
    try { await ref.transaction(cur => cur && cur.token === token ? null : undefined); } catch (e) { }
    try { await ref.onDisconnect().cancel(); } catch (e) { }
  }
  function movedAway() {
    if (switching) return;
    let t = 0; try { t = Number(sessionStorage.getItem('nloMtg.awayAt') || 0); } catch (e) { }
    if (!(Date.now() - t < 120000)) { try { sessionStorage.setItem('nloMtg.awayAt', String(Date.now())); } catch (e) { } rememberFs(true); switchNow('The Staff Meeting Hub has moved to the NLO Cases system.'); return; }
    overlay('The Staff Meeting Hub has moved to the NLO Cases system, but this computer can’t confirm that with the NLO Cases database right now (no connection, or its database rules need publishing again — ask Dr. A). Nothing can be saved on this screen until then.', { reload: true });
  }
  async function rulesLive() {
    try { await NL.fs.doc(RULES_MARK).get({ source: 'server' }); return true; }
    catch (e) { if (/permission/i.test(codeOf(e))) return false; throw e; }
  }

  /* who the signed-in person is in Staff Hub's roster (the ids the meeting records use): Dr. A → s_amir; a login linked to
     Staff Hub → that person; else the same whole name; else a stand-in with the login's own name */
  function personOf(me, roster, ownerId) {
    if (!me) return null;
    const list = Array.isArray(roster) ? roster : [];
    if (me.role === 'owner') return list.find(p => p && p.id === ownerId) || { id: ownerId, name: 'Dr. Amir Akhavan', first: 'Amir', last: 'Akhavan', nick: 'Dr. A', short: 'Dr. A', active: true };
    if (me.rid) { const p = list.find(x => x && x.id === me.rid); if (p) return p; }
    const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/^dr\.?\s+/, '').replace(/\s+/g, ' ').trim();
    const n = norm(me.name);
    if (n) {
      const hits = list.filter(p => p && p.id !== ownerId && [p.name, p.first && p.last ? p.first + ' ' + p.last : ''].some(x => x && norm(x) === n));
      if (hits.length === 1) return hits[0];
    }
    const parts = String(me.name || '').trim().split(/\s+/);
    return { id: 'nc_' + slug(me.sid || me.uid), name: me.name || 'Someone', first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '', active: true, nc: true };
  }

  /* ---------- Cadence's numbers, from Cadence's own records (the shape its old copy for the Hub had) ---------- */
  const ymdOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDays = (ymd, n) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd); const d = new Date(+m[1], +m[2] - 1, +m[3], 12); d.setDate(d.getDate() + n); return ymdOf(d); };
  async function cadenceCopy(fs) {
    const td = ymdOf(new Date()), lo = addDays(td, -32), hi = addDays(td, 40);
    /* (only the last 32 days up to today: the scoreboard's window — fewer reads than every list made ahead) */
    const [cfg, toff, inst] = await Promise.all([fs.doc('cadState/config').get(), fs.doc('cadState/timeoff').get(), fs.collection('cadInst').where('date', '>=', lo).where('date', '<=', td).get()]);
    const c = cfg.exists ? (cfg.data() || {}) : {};
    const arr = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
    const staff = arr(c.staff).filter(x => x && x.id).map(x => ({ id: x.id, name: String(x.name || ''), status: x.status || 'active' }));
    const checklists = arr(c.checklists).filter(x => x && x.id).map(x => ({ id: x.id, name: String(x.name || ''), schedule: { kind: (x.schedule || {}).kind || '', dueTime: (x.schedule || {}).dueTime || '' } }));
    const instances = [];
    inst.forEach(d => { const i = d.data() || {}; if (i.date >= lo && i.date <= td) instances.push({ id: i.id || d.id, date: i.date, checklistId: i.checklistId || '', assigneeId: i.assigneeId || '', status: i.status || '' }); });
    const e = toff.exists ? ((toff.data() || {}).e || {}) : {};
    const timeOff = Object.keys(e).map(k => e[k]).filter(o => o && o.date >= td && o.date <= hi).map(o => ({ staffId: o.staffId || '', date: o.date, scope: o.scope || 'full' }));
    return { staff, checklists, instances, timeOff, at: Date.now() };
  }

  /* ---------- Inventory's spending, from Inventory's own records (the shapes its old copy had) ---------- */
  async function inventoryOld(fs) {
    const all = c => fs.collection(c).get().then(q => { const o = []; q.forEach(d => o.push([d.id, d.data() || {}])); return o; });
    const [items, orders, logs, bud, exps] = await Promise.all([all('invItems'), all('invOrders'), all('invLog'), fs.doc('invState/budget').get(), all('invExpenses')]);
    const strip = o => { const x = Object.assign({}, o); delete x.up; delete x.upBy; return x; };
    const I = {}, O = {}, L = {};
    items.forEach(([id, o]) => { const x = strip(o); I[x.id != null ? x.id : id] = x; });
    orders.forEach(([id, o]) => { const x = strip(o); O[x.id != null ? x.id : id] = x; });
    logs.forEach(([, o]) => { const who = String(o.who || ''), e = o.e || {}; Object.keys(e).forEach(k => { const x = e[k]; if (!x || typeof x !== 'object') return; const y = Object.assign({}, x); if (who && !/^old\d*$/.test(who)) y.byId = who; L[k] = y; }); });
    const b = bud.exists ? strip(bud.data() || {}) : {};
    const ex = exps.map(([, o]) => strip(o)).sort((a, z) => String(z.addedAt || z.date || '').localeCompare(String(a.addedAt || a.date || '')));
    b.expenses = ex;
    return { items: I, orders: O, log: L, budget: b };
  }

  /* =====================================================================
     the move (Dr. A): everything under the old paths → the NLO Cases records, checked; and back
     ===================================================================== */
  /* the old database's whole Staff Meeting part as { mount path: value } */
  async function readOld(rt) {
    const out = {};
    for (const m of MOVED) out[m.path] = (await rt.ref(m.path).once('value')).val();
    return out;
  }
  /* those values as Firestore records: [{ doc, data }] (data without stamps) */
  function recordsOf(old) {
    const recs = [];
    MOVED.forEach(m => {
      const v = old[m.path];
      if (m.col) {
        if (!isObj(v) && !Array.isArray(v)) return;
        Object.keys(v).forEach(id => {
          const c = clean(v[id], false); if (!isObj(c)) return;
          if (m.texts) {
            const main = Object.assign({}, c), tx = {};
            m.textKeys.forEach(k => { if (main[k] != null) { tx[k] = main[k]; delete main[k]; } });
            if (Object.keys(main).length) recs.push({ doc: m.col + '/' + id, data: main });
            if (Object.keys(tx).length) recs.push({ doc: m.texts + '/' + id, data: tx });
          } else recs.push({ doc: m.col + '/' + id, data: c });
        });
      } else {
        const c = clean(v, false); if (c === null) return;
        const data = m.field ? { [m.field]: c } : c;
        if (!isObj(data)) return;
        const prev = recs.find(r => r.doc === m.doc);
        if (prev) Object.assign(prev.data, data); else recs.push({ doc: m.doc, data });
      }
    });
    return recs;
  }
  const sizeOf = o => new Blob([JSON.stringify(o)]).size;
  const fpr = v => JSON.stringify(canon(plain(clean(v, false), false)));
  function canon(v) { if (Array.isArray(v)) return v.map(canon); if (isObj(v)) { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); }); return o; } return v; }
  function badIds(recs) { return recs.map(r => r.doc.split('/')[1]).filter(id => !/^[A-Za-z0-9_-]{1,100}$/.test(id)); }
  /* records over Firestore's 1 MB limit for one record (none is expected: a transcript that big would be ~19 hours of talk) */
  function tooBig(recs) { return recs.filter(r => sizeOf(r.data) + 200 > 1000000).map(r => r.doc + ' (' + Math.round((sizeOf(r.data) + 200) / 1024) + ' KB)'); }
  /* write the records (in batches of ≤ 400 and ≤ ~8 MB), removing NLO Cases records the old database doesn't have (a re-run
     is clean); then read them all back and compare */
  async function writeRecords(fs, sid, recs, onStep) {
    const FV = firebase.firestore.FieldValue;
    const cols = {};
    MOVED.forEach(m => { if (m.col) { cols[m.col] = 1; if (m.texts) cols[m.texts] = 1; } });
    const have = new Set(recs.map(r => r.doc));
    const extra = [];
    for (const c of Object.keys(cols)) { const q = await fs.collection(c).get({ source: 'server' }); q.forEach(d => { if (!have.has(c + '/' + d.id)) extra.push(c + '/' + d.id); }); }
    // (the single records — config, current, roster, the AISA key, Month-End's years and setup — are set whole when the old
    // database has them; they can't have been made without it, so none is left over)
    const ops = recs.map(r => ({ set: r, s: sizeOf(r.data) + 200 })).concat(extra.map(d => ({ del: d, s: 200 })));
    /* a record over Firestore's 1 MB limit: say so before anything is written */
    const big = ops.find(op => op.s > 1000000);
    if (big) { const e = new Error('Too big to move: ' + big.set.doc + ' (' + Math.round(big.s / 1024) + ' KB) — nothing was written'); e.code = 'too-big'; throw e; }
    let b = fs.batch(), n = 0, size = 0, done = 0;
    for (const op of ops) {
      const s = op.s;
      if (n && (n >= 400 || size + s > 8000000)) { await b.commit(); done += n; if (onStep) onStep(done, ops.length); b = fs.batch(); n = 0; size = 0; }
      if (op.set) b.set(fs.doc(op.set.doc), Object.assign({}, op.set.data, { _up: FV.serverTimestamp(), _by: String(sid || '') }));
      else b.delete(fs.doc(op.del));
      n++; size += s;
    }
    if (n) { await b.commit(); done += n; if (onStep) onStep(done, ops.length); }
    // read back and compare
    const back = {};
    for (const c of Object.keys(cols)) { const q = await fs.collection(c).get({ source: 'server' }); q.forEach(d => { back[c + '/' + d.id] = d.data(); }); }
    for (const m of MOVED) if (m.doc && !back[m.doc]) { const s = await fs.doc(m.doc).get({ source: 'server' }); if (s.exists) back[m.doc] = s.data(); }
    const missing = [], differ = [];
    recs.forEach(r => { const got = back[r.doc]; if (!got) missing.push(r.doc); else if (fpr(stripStamps(got)) !== fpr(r.data)) differ.push(r.doc); });
    const left = Object.keys(back).filter(d => !have.has(d) && Object.keys(stripStamps(back[d])).length);
    return { written: recs.length, removed: extra.length, missing, differ, left };
  }
  function stripStamps(d) { const o = Object.assign({}, d); STAMPS.forEach(k => delete o[k]); return o; }
  function counts(old) {
    const o = {};
    MOVED.forEach(m => { const v = old[m.path]; o[m.path.replace(ROOT + '/', '').replace('nlo/settings/', '')] = m.col ? (v && typeof v === 'object' ? Object.keys(v).length : 0) : (v == null ? 0 : 1); });
    return o;
  }
  /* the NLO Cases records → the old paths (for moving back) */
  async function readNew(fs) {
    const db = makeDb(fs, () => '', null), out = {};
    for (const m of MOVED) {
      if (m.col) out[m.path] = await db.ref(m.path).once('value').then(s => s.val());
      else out[m.path] = await db.ref(m.path).once('value').then(s => s.val());
    }
    return out;
  }

  /* the NLO Cases staff id of a login (pages that did their own sign-in, e.g. Cadence) */
  const sidCache = {};
  async function sidFor(fs, uid) {
    if (!uid) return '';
    if (sidCache[uid] != null) return sidCache[uid];
    try { const s = await fs.doc('members/' + uid).get(); sidCache[uid] = s.exists ? String((s.data() || {}).staffId || '') : ''; } catch (e) { return ''; }
    return sidCache[uid];
  }

  window.NLOM = {
    ROOT, MOUNTS, MOVED, RULES_MARK,
    init, db: makeDb, signIn, signOut, watch, unwatch, idleMin, lock, lockMsg, lastLogin, errText, badLogin, moved, onMoved, moveState, rulesLive, personOf,
    overlay, watchOld, followNew, followOld, watchOldDb, claimMove, moveStillMine, touchMove, releaseMove, rememberFs, pauseClock, STALE,
    get paused() { return NL.paused; },
    cadenceCopy, inventoryOld, readOld, readNew, recordsOf, writeRecords, counts, badIds, tooBig, fpr, clean, plain, pushKey, target, sidFor,
    get me() { return NL.me; }, get fs() { return NL.fs; }, get auth() { return NL.auth; }
  };
})();
