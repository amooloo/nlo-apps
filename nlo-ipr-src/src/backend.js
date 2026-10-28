/* =====================================================================
   Firebase backend (the NLO Cases project, Firestore). Nothing readable
   about a patient ever leaves the browser:
     iprPts/<id>   a patient: sealed { chart, name, ini?, at, oh?, photo?, photoAt? }
     iprVis/<id>   a visit:   sealed { date, assistant_initials, upper_ipr, … } (the same fields the IPR Tracker always kept)
     iprPtLog / iprVisLog   every save's history entry, holding the sealed copy it replaced (append-only)
     photos/<id>   the patient's photo (27 Oct 2026), sealed — NLO Cases' patient-photo collection, at the patient record's id;
                   the record's `photo` names its version, `photoAt` when it was taken into the records
   Plain fields: the key version, revision, who saved and when, a visit's patient record (p, a random id), and a patient's pc —
   the keyed hash of the chart # (NLO Cases' patient index, keyed off the office key) — so NLO Cases finds a patient's visits,
   and this page a patient's cases, without opening every record. firestore.rules (in nlo-cases-src) holds them to this.
   ===================================================================== */
const FB = {
  emu: false, app: null, auth: null, db: null, cfg: null,
  uid: null, me: null, priv: null, ring: null, keys: null, curV: 0, ringV: 0, idxKey: null, idxKeyRing: null,
  unsubs: [], pending: 0, onSync: null, queues: {},

  ts() { return firebase.firestore.FieldValue.serverTimestamp(); },
  del() { return firebase.firestore.FieldValue.delete(); },
  tsMs(t) { return t && t.toMillis ? t.toMillis() : (t || null); },
  isOwner() { return !!(FB.me && FB.me.role === 'owner'); },
  isPerm(e) { return /permission/i.test(String((e && (e.code || e.message)) || '')); },

  available() { return typeof firebase !== 'undefined' && !!firebase.initializeApp && !!firebase.firestore; },
  configured() { return FB.emu || FB_CONFIG.apiKey.indexOf('__') !== 0; },
  init(emu) {
    FB.emu = !!emu;
    FB.cfg = FB.emu ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-nlo-cases', appId: 'demo' } : FB_CONFIG;
    if (!FB.available() || !FB.configured()) return false;
    FB.app = firebase.apps.find(a => a && a.name === '[DEFAULT]') || firebase.initializeApp(FB.cfg);
    FB.auth = FB.app.auth(); FB.db = FB.app.firestore();
    if (FB.emu) { FB.auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); FB.db.useEmulator('127.0.0.1', 8080); }
    return true;
  },
  async ready() {
    // Never keep a session across reloads: the key ring only lives in memory, so a reload means sign in again.
    try { await FB.auth.setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) { }
  },
  busy(n) { FB.pending += n; if (FB.onSync) FB.onSync(); },
  async track(p) { FB.busy(1); try { return await p; } finally { FB.busy(-1); } },

  /* ---------- sign in (the same logins as NLO Cases) ---------- */
  async emailFor(login) {
    const s = String(login || '').trim();
    if (s.includes('@')) return s.toLowerCase();
    const un = slug(s); if (!un) throw errCode('no-user');
    const snap = await FB.db.doc('logins/' + un).get();
    if (!snap.exists) throw errCode('no-user');
    return snap.data().email;
  },
  async signIn(login, pw) {
    const email = await FB.emailFor(login);
    const cred = await FB.auth.signInWithEmailAndPassword(email, pw);
    FB.uid = cred.user.uid;
    const ms = await FB.db.doc('members/' + FB.uid).get();
    if (!ms.exists) { await FB.signOut(); throw errCode('not-member'); }
    const m = ms.data();
    if (!m.active) { await FB.signOut(); throw errCode('inactive'); }
    FB.me = Object.assign({ uid: FB.uid, email: cred.user.email || email }, m);
    if (m.mustSetup) {
      if (m.priv) { // chose a password already but didn't finish: try it
        try { await FB.unlockWith(pw, m); await FB.db.doc('members/' + FB.uid).update({ mustSetup: false, boot: FB.del(), lastLogin: FB.ts() }); return { state: 'ok' }; } catch (e) { }
      }
      return { state: 'first' };
    }
    try { await FB.unlockWith(pw, m); }
    catch (e) { return { state: m.role === 'owner' ? 'recover' : 'broken' }; }
    FB.db.doc('members/' + FB.uid).update({ lastLogin: FB.ts() }).catch(() => { });
    return { state: 'ok' };
  },
  async unlockWith(pw, m) {
    let bytes;
    try { bytes = await Crypto.pwOpen(pw, m.priv, 'priv:' + FB.uid); }
    catch (e) { if (!m.privPrev) throw e; bytes = await Crypto.pwOpen(pw, m.privPrev, 'priv:' + FB.uid); }
    FB.priv = await Crypto.importPriv(bytes);
    await FB.loadRing(m);
  },
  async loadRing(m) {
    const ring = Crypto.ringFrom(await Crypto.openFrom(FB.priv, m.ring, 'ring:' + FB.uid));
    FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.ringV = m.ringV || 0;
    const k = await FB.db.doc('meta/keys').get();
    FB.curV = k.exists ? k.data().current : 1;
  },
  /* the office key may have just been changed (Dr. A, in NLO Cases): take the newest from this login's copy of the ring */
  async refreshKeys() {
    const s = await FB.db.doc('members/' + FB.uid).get(), m = s.exists ? s.data() : null;
    if (!m || !m.active || !m.ring) return false;
    await FB.loadRing(m); return true;
  },
  /* first sign-in with a temporary password: choose a real one (it's the NLO Cases password too) */
  async firstSetup(tempPw, newPw) {
    const m = FB.me, uid = FB.uid;
    let ring;
    try { ring = Crypto.ringFrom(await Crypto.pwOpen(tempPw, m.boot, 'boot:' + uid)); }
    catch (e) { throw errCode('boot-failed'); }
    const cur = (await FB.db.doc('meta/keys').get()).data().current;
    if (!ring[cur]) throw errCode('boot-stale');
    const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), pbytes = await Crypto.privBytes(pair);
    const priv = await Crypto.pwSeal(newPw, pbytes, 'priv:' + uid);
    const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
    await FB.db.doc('members/' + uid).update({ pub, priv, ring: ringBox, ringV: cur });
    await FB.auth.currentUser.updatePassword(newPw);
    await FB.db.doc('members/' + uid).update({ mustSetup: false, boot: FB.del(), lastLogin: FB.ts() });
    FB.priv = await Crypto.importPriv(pbytes); FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.curV = cur; FB.ringV = cur;
    FB.me = Object.assign({}, FB.me, { mustSetup: false, pub });
  },
  /* the owner forgot the password → reset by email → the recovery code opens the key ring */
  async recover(pw, code) {
    const uid = FB.uid;
    const r = (await FB.db.doc('meta/recovery').get()).data();
    let ring;
    try {
      const rpriv = await Crypto.importPriv(await Crypto.pwOpen(normCode(code), r.priv, 'recovery-priv'));
      ring = Crypto.ringFrom(await Crypto.openFrom(rpriv, r.ring, 'ring:recovery'));
    } catch (e) { throw errCode('bad-code'); }
    const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), pbytes = await Crypto.privBytes(pair);
    const priv = await Crypto.pwSeal(pw, pbytes, 'priv:' + uid);
    const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
    const v = Math.max.apply(null, Object.keys(ring).map(Number));
    await FB.db.doc('members/' + uid).update({ pub, priv, privPrev: FB.del(), ring: ringBox, ringV: v, lastLogin: FB.ts() });
    FB.priv = await Crypto.importPriv(pbytes); FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.ringV = v;
    FB.curV = (await FB.db.doc('meta/keys').get()).data().current;
  },
  async sendReset(email) { await FB.auth.sendPasswordResetEmail(email); },
  async signOut() {
    FB.stop(); IP.reset();
    FB.priv = FB.ring = FB.keys = FB.me = FB.uid = FB.idxKey = FB.idxKeyRing = null; FB.curV = FB.ringV = 0; FB.queues = {};
    try { await FB.auth.signOut(); } catch (e) { }
  },
  stop() { FB.unsubs.forEach(u => { try { u(); } catch (e) { } }); FB.unsubs = []; },

  /* ---------- before the app opens: are this version's rules live, and have the records moved? ---------- */
  async open() {
    try { await FB.db.doc('meta/rules_ipr_1').get(); } catch (e) { if (FB.isPerm(e)) return { st: 'rules' }; throw e; }
    const mv = await FB.db.doc('iprMeta/moved').get();
    if (!mv.exists) return { st: FB.isOwner() ? 'move' : 'notyet' };
    const rm = await FB.db.doc('iprMeta/oldRemoved').get();
    const info = s => { const d = s.data() || {}; return { at: FB.tsMs(d.at) || 0, by: d.by || '', pts: d.pts || 0, vis: d.vis || 0, named: d.named || 0 }; };
    return { st: 'ready', moved: info(mv), removed: rm.exists ? info(rm) : null };
  },

  /* ---------- live: this login, the office key, the idle lock, the roster, and every patient ---------- */
  start(h) {
    FB.stop();
    const uid = FB.uid;
    FB.unsubs.push(FB.db.doc('members/' + uid).onSnapshot(async s => {
      if (!s.exists || s.data().active !== true) return h.revoked();
      const m = s.data();
      if (m.ringV && m.ringV !== FB.ringV && m.ring) { try { await FB.loadRing(m); } catch (e) { h.error(e); } }
    }, e => h.revoked(e)));
    FB.unsubs.push(FB.db.doc('meta/keys').onSnapshot(s => { if (s.exists) FB.curV = s.data().current; }, () => { }));
    FB.unsubs.push(FB.db.doc('meta/settings').onSnapshot(s => h.settings(s.exists ? s.data() : {}), () => { }));
    FB.unsubs.push(FB.db.collection('roster').onSnapshot(s => h.roster(s.docs.map(d => Object.assign({ sid: d.id }, d.data()))), () => h.roster(null)));
    // (opening is async: each snapshot's changes are applied in the order they came, never an older one over a newer one)
    let chain = Promise.resolve();
    FB.unsubs.push(FB.db.collection('iprPts').onSnapshot(snap => {
      const changes = snap.docChanges().map(ch => ({ type: ch.type, id: ch.doc.id, d: ch.doc.data() }));
      chain = chain.then(async () => {
        if (FB.uid !== uid) return;
        const up = [], gone = [];
        for (const ch of changes) { if (ch.type === 'removed') gone.push(ch.id); else up.push(await FB.openPt(ch.id, ch.d)); }
        if (FB.uid !== uid) return;
        IP.apply(up, gone); h.patients();
      }).catch(e => console.warn(e));
    }, e => { IP.fail(e); h.error(e); }));
  },

  /* ---------- opening records ---------- */
  async openBox(d, aad) { const key = FB.keys && FB.keys[d.v]; if (!key) throw errCode('no-key', 'Missing key version ' + d.v); return Crypto.openJSON(key, d, aad); },
  /* a patient as the app has always seen one: patient_id is the chart #, name the full name ('' until someone adds it), ini the
     initials an older record kept */
  ptRow(id, body, d) {
    return { id, patient_id: String(body.chart || ''), name: cleanName(body.name), ini: String(body.ini || ''), created_at: body.at || '', rev: d.rev, by: d.sid || '', updatedAt: FB.tsMs(d.updatedAt),
      photo: typeof body.photo === 'string' ? body.photo : '', photoAt: Number(body.photoAt) || 0 };
  },
  /* what a record's sealed copy is bound to: its own id — and a visit also to its patient's record (p), so a sealed visit can't be
     passed off as another patient's (the rules keep p from changing) */
  aad(kind, id, p) { return kind === 'pt' ? 'iprpt:' + id : 'iprvis:' + id + ':' + p; },
  async openPt(id, d) {
    try { return FB.ptRow(id, await FB.openBox(d, FB.aad('pt', id)), d); }
    catch (e) { return { id, locked: true, patient_id: '', name: '', ini: '', created_at: '', rev: d.rev }; }
  },
  visRow(id, body, d) { return Object.assign({}, body, { id, patient_uuid: d.p, rev: d.rev, by: d.sid || '', updatedAt: FB.tsMs(d.updatedAt) }); },
  async visitsOf(pid) {
    const snap = await FB.db.collection('iprVis').where('p', '==', pid).get(), out = [];
    for (const doc of snap.docs) { const d = doc.data(); try { out.push(FB.visRow(doc.id, await FB.openBox(d, FB.aad('vis', doc.id, d.p)), d)); } catch (e) { } }
    return out;
  },
  /* (fields the page keeps on a row, never saved inside the sealed copy) */
  cleanVis(o) { const b = Object.assign({}, o); ['id', 'patient_uuid', 'rev', 'by', 'updatedAt', 'locked'].forEach(k => delete b[k]); return JSON.parse(JSON.stringify(b)); },

  /* ---------- the patient index (NLO Cases' — backend.js there): a keyed hash of the chart #, made with a key derived from
     the office key's first version, so it stays the same through key changes. Without the office key it reveals nothing. ---------- */
  async idxKeyGet() {
    if (!FB.idxKey || FB.idxKeyRing !== FB.ring) {
      const v = Math.min.apply(null, Object.keys(FB.ring).map(Number));
      const base = await crypto.subtle.importKey('raw', unb64(FB.ring[v]), 'HKDF', false, ['deriveKey']);
      FB.idxKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode('patient-index') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
      FB.idxKeyRing = FB.ring;
    }
    return FB.idxKey;
  },
  async idxHash(k) {
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await FB.idxKeyGet(), TE.encode(k)));
    return b64(sig.subarray(0, 16)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); // 22 characters
  },
  /* an IPR patient's pc: its chart # with letters and digits only, so NLO Cases finds it however either app wrote the dashes */
  async iprPc(chart) { const c = iprNorm(chart); return c ? FB.idxHash('c:' + c) : null; },
  /* the index keys NLO Cases may have filed this chart # under (it keeps dashes): as typed, without dashes, and — for a chart #
     of digits only — with a dash anywhere in it ("156541" → "15-6541") */
  chartForms(chart) {
    const a = iprNorm(chart), n = normChart(chart), out = new Set([a, n].filter(Boolean));
    if (/^\d{3,12}$/.test(a)) for (let i = 1; i < a.length; i++) out.add(a.slice(0, i) + '-' + a.slice(i));
    return Array.from(out);
  },
  /* the names NLO Cases has for these chart #s: Map(iprNorm(chart) → [{ name, at }], newest first) — from the cases whose own
     chart # is the same one (letters and digits); a case removed as a duplicate doesn't count */
  async caseNames(charts, progress) {
    const out = new Map();
    (await FB.caseInfo(charts, progress)).forEach((list, a) => { const l = list.filter(c => c.name).map(c => ({ name: c.name, at: c.at })); if (l.length) out.set(a, l); });
    return out;
  },
  /* NLO Cases' cases for these chart #s, newest first: Map(iprNorm(chart) → [{ id, name, at, open, photo, photoAt }]) — the name
     the case has, and its patient photo's version id (photos/{case id}) with when it was taken (27 Oct 2026) */
  async caseInfo(charts, progress) {
    const want = new Map(); // index key → iprNorm(chart)
    for (const ch of charts) { const a = iprNorm(ch); if (!a) continue; for (const f of FB.chartForms(ch)) want.set(await FB.idxHash('c:' + f), a); }
    const keys = Array.from(want.keys()), docs = new Map(), out = new Map(), wanted = new Set(want.values());
    for (let i = 0; i < keys.length; i += 30) {
      const s = await FB.db.collection('cases').where('pc', 'in', keys.slice(i, i + 30)).get();
      s.docs.forEach(d => docs.set(d.id, d));
      if (progress) progress(Math.min(i + 30, keys.length), keys.length);
    }
    for (const doc of docs.values()) {
      const x = doc.data(); let body; try { body = await FB.openBox(x, 'case:' + doc.id); } catch (e) { continue; }
      if (!body || body.dup) continue;
      const a = iprNorm(body.chart); if (!a || !wanted.has(a)) continue;
      if (!out.has(a)) out.set(a, []);
      out.get(a).push({ id: doc.id, name: cleanName(body.patient), at: FB.tsMs(x.updatedAt) || 0, open: x.status !== 'done',
        photo: typeof body.photo === 'string' ? body.photo : '', photoAt: Number(body.photoAt) || 0 });
    }
    out.forEach(list => list.sort((p, q) => q.at - p.at));
    return out;
  },
  /* the newest photo NLO Cases has for a chart #: { id (the case), pv, at } or null */
  async casePhotoOf(chart) {
    const list = (await FB.caseInfo([chart])).get(iprNorm(chart)) || [];
    const c = list.filter(x => x.photo).sort((p, q) => (q.photoAt - p.photoAt) || (q.at - p.at))[0];
    return c ? { id: c.id, pv: c.photo, at: c.photoAt || c.at } : null;
  },
  /* the one name NLO Cases has for a chart # ('' when it has none, or two different ones) */
  oneName(list) {
    const names = new Map(); (list || []).forEach(x => { const k = normName(x.name); if (!names.has(k)) names.set(k, x.name); });
    return names.size === 1 ? Array.from(names.values())[0] : '';
  },

  /* ---------- saving ---------- */
  /* history entry at the fixed id "<record>_<rev>"; prev = the sealed copy this write replaces */
  async logOps(w, kind, id, rev, prev, action) {
    const lid = id + '_' + rev, coll = kind === 'pt' ? 'iprPtLog' : 'iprVisLog';
    const box = await Crypto.sealJSON(FB.keys[FB.curV], action, (kind === 'pt' ? 'iprptlog:' : 'iprvislog:') + lid);
    const o = kind === 'pt' ? { ptId: id } : { visId: id };
    w.set(FB.db.doc(coll + '/' + lid), Object.assign(o, { rev, uid: FB.uid, sid: FB.me.staffId, at: FB.ts(), v: FB.curV, iv: box.iv, ct: box.ct, prev: prev || null }));
  },
  newId(kind) { return FB.db.collection(kind === 'pt' ? 'iprPts' : 'iprVis').doc().id; },
  /* a new patient or visit (with its first history entry) under `id`; a visit needs its patient (`p`) saved already, or in the
     same batch (`with`: another record to create alongside, e.g. a new patient with its first visit). `photo` (bytes): a new
     patient's picture, in the same batch under the version id its record names */
  async create(kind, id, body, opts, retried) {
    opts = opts || {};
    const b = FB.db.batch();
    const add = async (k, rid, bd, p, photo) => {
      if (k === 'pt' && photo) { bd = Object.assign({}, bd, { photo: uid8(), photoAt: Number(opts.photoAt) || Date.now() }); b.set(FB.db.doc('photos/' + rid), await FB.photoBox(rid, photo, bd.photo)); }
      const v = FB.curV, box = await Crypto.sealJSON(FB.keys[v], bd, FB.aad(k, rid, p));
      const doc = { v, iv: box.iv, ct: box.ct, rev: 1, by: FB.uid, sid: FB.me.staffId, createdAt: FB.ts(), updatedAt: FB.ts() };
      if (k === 'pt') { const pc = await FB.iprPc(bd.chart); if (pc) doc.pc = pc; } else doc.p = p;
      b.set(FB.db.doc((k === 'pt' ? 'iprPts/' : 'iprVis/') + rid), doc);
      await FB.logOps(b, k, rid, 1, null, opts.action || { a: 'create' });
      return bd;
    };
    if (opts.with) await add(opts.with.kind, opts.with.id, opts.with.body, opts.with.p, opts.with.photo);
    body = await add(kind, id, body, opts.p, opts.photo);
    try { await FB.track(b.commit()); }
    catch (e) {
      // refused: the office key may have changed a moment ago (take the newest, try once more) — or this record exists already
      if (retried || !FB.isPerm(e) || !(await FB.refreshKeys())) throw e;
      return FB.create(kind, id, body, opts, true);
    }
    return opts.photo ? body : id;
  },
  /* one person's saves to the same record run one after another, never racing each other */
  queued(k, fn) {
    const p = (FB.queues[k] || Promise.resolve()).then(fn, fn);
    FB.queues[k] = p.catch(() => { });
    return p;
  },
  /* fn(body, doc) edits the latest sealed copy in place (return false: nothing to save). Resolves to { body, rev, d } (or { body,
     skipped }). ops(tx, body), if given, adds other writes that must land together with this save (the patient's photo) */
  mutate(kind, id, fn, action, ops) { return FB.queued(kind + '/' + id, () => FB._mutate(kind, id, fn, action, 0, ops)); },
  async _mutate(kind, id, fn, action, tries, ops) {
    const ref = FB.db.doc((kind === 'pt' ? 'iprPts/' : 'iprVis/') + id);
    let out = null;
    try {
      await FB.track(FB.db.runTransaction(async tx => {
        const s = await tx.get(ref); if (!s.exists) throw errCode('gone', 'That record isn’t there any more.');
        const d = s.data(), aad = FB.aad(kind, id, d.p), body = await FB.openBox(d, aad);
        if (fn(body, d) === false) { out = { body, rev: d.rev, skipped: true, d }; return; }
        const v = FB.curV, box = await Crypto.sealJSON(FB.keys[v], body, aad);
        const upd = { v, iv: box.iv, ct: box.ct, rev: d.rev + 1, by: FB.uid, sid: FB.me.staffId, updatedAt: FB.ts() };
        if (kind === 'pt') { const pc = await FB.iprPc(body.chart); upd.pc = pc || FB.del(); }
        tx.update(ref, upd);
        await FB.logOps(tx, kind, id, d.rev + 1, { v: d.v, iv: d.iv, ct: d.ct }, action || { a: 'save' });
        if (ops) await ops(tx, body);
        out = { body, rev: d.rev + 1, d: Object.assign({}, d, { rev: d.rev + 1, sid: FB.me.staffId, updatedAt: Date.now() }) };
      }));
    } catch (e) {
      if (tries < 2 && FB.isPerm(e) && await FB.refreshKeys().catch(() => false)) {
        await new Promise(r => setTimeout(r, 150 + Math.random() * 350));
        return FB._mutate(kind, id, fn, action, tries + 1, ops);
      }
      throw e;
    }
    return out;
  },

  /* ---------- patient photos (27 Oct 2026, Amir: "the IPR tracker and case tracker should be fully sharing the same data … their
     photo, exactly how we have it in case tracker"): NLO Cases' photos collection — a case's at photos/{case id}, this app's at
     photos/{patient record id} — each sealed with the office key (as NLO Cases seals them: AAD 'photo:' + id), changed only
     together with a save of its record. Either app reads both. ---------- */
  async photoBox(id, bytes, pv) {
    const v = FB.curV; const box = await Crypto.seal(FB.keys[v], bytes, 'photo:' + id);
    return { v, iv: box.iv, ct: box.ct, pv, at: FB.ts(), by: FB.uid };
  },
  /* { pv, bytes, at } or null — a case's photo, or an IPR patient's */
  async getPhoto(id) {
    const s = await FB.db.doc('photos/' + id).get(); if (!s.exists) return null;
    const x = s.data(); if (!FB.keys[x.v]) throw errCode('no-key', 'Missing key version ' + x.v);
    return { pv: x.pv, bytes: await Crypto.open(FB.keys[x.v], x, 'photo:' + id), at: FB.tsMs(x.at) || 0 };
  },

  /* ---------- the move, and Dr. A's "Remove the old copy" (move.js) ---------- */
  /* every record here, opened: { pts: Map(id → { body, d }), vis: Map(id → { body, d }) } */
  async everything() {
    const [ps, vs] = await Promise.all([FB.db.collection('iprPts').get(), FB.db.collection('iprVis').get()]);
    const pts = new Map(), vis = new Map(), bad = [];
    for (const doc of ps.docs) { const d = doc.data(); try { pts.set(doc.id, { body: await FB.openBox(d, FB.aad('pt', doc.id)), d }); } catch (e) { bad.push(doc.id); } }
    for (const doc of vs.docs) { const d = doc.data(); try { vis.set(doc.id, { body: await FB.openBox(d, FB.aad('vis', doc.id, d.p)), d }); } catch (e) { bad.push(doc.id); } }
    return { pts, vis, bad };
  },
  /* what each save to a record was (its history), oldest first: [{ rev, a, sid, at }] */
  async historyOf(kind, id) {
    const coll = kind === 'pt' ? 'iprPtLog' : 'iprVisLog', f = kind === 'pt' ? 'ptId' : 'visId', pre = kind === 'pt' ? 'iprptlog:' : 'iprvislog:';
    const s = await FB.db.collection(coll).where(f, '==', id).get(), out = [];
    for (const doc of s.docs) { const x = doc.data(); let a = null; try { a = await FB.openBox(x, pre + doc.id); } catch (e) { } out.push({ rev: x.rev, a: a && a.a, sid: x.sid, at: FB.tsMs(x.at) }); }
    return out.sort((p, q) => p.rev - q.rev);
  },
  /* writes: [{ kind, id, body, p?, mode: 'create' | 'update', action }] — a few at a time, each record in a batch of its own with
     its history entry (well inside the rules' lookup limits); patients before visits */
  async moveWrite(writes, progress) {
    let done = 0; const failed = [];
    const one = async w => {
      try {
        if (w.mode === 'create') await FB.create(w.kind, w.id, w.body, { p: w.p, action: w.action });
        else await FB.mutate(w.kind, w.id, b => {
          const photo = w.kind === 'pt' && b.photo ? { photo: b.photo, photoAt: b.photoAt } : null; // (a photo added here stays: the old copy never had one)
          Object.keys(b).forEach(k => delete b[k]); Object.assign(b, JSON.parse(JSON.stringify(w.body))); if (photo) Object.assign(b, photo);
        }, w.action);
      } catch (e) { failed.push({ w, e }); }
      done++; if (progress) progress(done, writes.length);
    };
    for (const kind of ['pt', 'vis']) {
      const list = writes.filter(w => w.kind === kind);
      for (let i = 0; i < list.length; i += 8) await Promise.all(list.slice(i, i + 8).map(one));
    }
    return failed;
  },
  async markMoved(kind, counts) {
    await FB.track(FB.db.doc('iprMeta/' + kind).set({ at: FB.ts(), by: FB.me.staffId, pts: counts.pts | 0, vis: counts.vis | 0, named: counts.named | 0 }));
  },

  /* ---------- this tab's draft (what's on screen), sealed for this login only: kept across the lock and a reload ---------- */
  async sealDraft(obj) { const v = FB.curV, box = await Crypto.sealJSON(FB.keys[v], obj, 'iprdraft:' + FB.uid); return JSON.stringify({ v, iv: box.iv, ct: box.ct }); },
  async openDraft(s) { const d = JSON.parse(s); return FB.openBox(d, 'iprdraft:' + FB.uid); }
};

/* ---------- the records the app works with, opened, in memory while signed in ----------
   Every patient (live from iprPts); a patient's visits when they're opened. Gone at the lock. */
const IP = {
  pts: new Map(), ready: false, waiters: [], err: null, vis: new Map(), made: new Set(),
  reset() { IP.pts = new Map(); IP.vis = new Map(); IP.made = new Set(); IP.ready = false; IP.err = null; const w = IP.waiters; IP.waiters = []; w.forEach(([, rej]) => rej(errCode('locked'))); },
  apply(up, gone) {
    up.forEach(r => IP.pts.set(r.id, r)); gone.forEach(id => IP.pts.delete(id));
    if (!IP.ready) { IP.ready = true; const w = IP.waiters; IP.waiters = []; w.forEach(([res]) => res()); }
  },
  fail(e) { IP.err = e; const w = IP.waiters; IP.waiters = []; w.forEach(([, rej]) => rej(e)); },
  whenReady() { if (IP.ready) return Promise.resolve(); if (IP.err) return Promise.reject(IP.err); return new Promise((res, rej) => IP.waiters.push([res, rej])); },
  async patients() { await IP.whenReady(); return Array.from(IP.pts.values()).filter(p => !p.locked); },
  patient(id) { return IP.pts.get(id) || null; },
  async visits(pid) {
    const rows = await FB.visitsOf(pid);
    IP.vis.set(pid, new Map(rows.map(r => [r.id, r])));
    return rows.map(r => Object.assign({}, r));
  },
  /* the patients with this chart # (letters and digits compared) */
  async byChart(chart) { const a = iprNorm(chart); if (!a) return []; return (await IP.patients()).filter(p => iprNorm(p.patient_id) === a); },
  /* fields: { chart, name, ini?, photo? (bytes), photoAt? } */
  async createPatient(fields) {
    const id = FB.newId('pt'); let body = { chart: String(fields.chart || '').trim(), name: cleanName(fields.name), at: new Date().toISOString() };
    if (fields.ini) body.ini = String(fields.ini);
    const r = await FB.create('pt', id, body, fields.photo ? { photo: fields.photo, photoAt: fields.photoAt } : null);
    if (fields.photo && r && r.photo) body = r;
    const row = FB.ptRow(id, body, { rev: 1, sid: FB.me.staffId, updatedAt: Date.now() });
    if (!IP.pts.has(id)) IP.pts.set(id, row);
    return row;
  },
  /* the patient's photo: set (bytes) or remove (null), together with a save of the record (its history says so). `at`: when the
     picture was taken into the records (a picture brought over from NLO Cases keeps its own time). Resolves to the row. */
  async setPhoto(id, bytes, how, at) {
    const pv = bytes ? uid8() : '', when = bytes ? (Number(at) || Date.now()) : 0;
    const r = await FB.mutate('pt', id, b => { if (!bytes && !b.photo) return false; if (bytes) { b.photo = pv; b.photoAt = when; } else { delete b.photo; delete b.photoAt; } return true; },
      { a: 'photo', how: how || (bytes ? 'add' : 'remove') },
      async tx => { const ref = FB.db.doc('photos/' + id); if (bytes) tx.set(ref, await FB.photoBox(id, bytes, pv)); else tx.delete(ref); });
    const row = FB.ptRow(id, r.body, r.d); IP.pts.set(id, row); return row;
  },
  /* patch: { chart?, name? } */
  async savePatient(id, patch, action) {
    const r = await FB.mutate('pt', id, b => {
      let ch = false;
      if (patch.chart != null && String(patch.chart).trim() !== b.chart) { b.chart = String(patch.chart).trim(); ch = true; }
      if (patch.name != null && cleanName(patch.name) !== cleanName(b.name)) { b.name = cleanName(patch.name); ch = true; }
      return ch;
    }, action || { a: 'save' });
    const row = FB.ptRow(id, r.body, r.d); IP.pts.set(id, row); return row;
  },
  /* the visit on screen, saved under the id it was given when it started (app.js): made by its first save, updated by every save
     after — so a save that runs twice (an autosave and Save, the lock's last save, a save after signing in again) can only ever
     update that one visit, never make a second copy. Fields replace the ones of the same name; the rest stays as it is. Saves to
     one visit run one after another. Resolves to the visit's row (made: true when this save made it). */
  async putVisit(id, pid, fields) {
    if (!id || !pid) throw errCode('no-visit', 'No visit to save.');
    const patch = FB.cleanVis(fields), known = () => IP.made.has(id) || (IP.vis.has(pid) && IP.vis.get(pid).has(id));
    const update = () => FB._mutate('vis', id, (b, d) => {
      if (d.p !== pid) throw errCode('wrong-patient', 'This visit belongs to another patient’s record.');
      const before = canonJSON(b); Object.assign(b, patch); return canonJSON(b) !== before;
    }, null, 0);
    const r = await FB.queued('vis/' + id, async () => {
      if (known()) return update();
      const body = FB.cleanVis(Object.assign({}, fields, { created_at: new Date().toISOString() }));
      try { await FB.create('vis', id, body, { p: pid }); }
      catch (e) {
        // refused: is it there already (saved by this tab before the lock, its answer lost on the way)? Then it's updated instead
        const s = await FB.db.doc('iprVis/' + id).get().catch(() => null);
        if (!s || !s.exists) throw e;
        return update();
      }
      return { body, rev: 1, made: true, d: { p: pid, rev: 1, sid: FB.me.staffId, updatedAt: Date.now() } };
    });
    IP.made.add(id);
    const row = Object.assign(FB.visRow(id, r.body, r.d), { made: !!r.made });
    if (IP.vis.has(pid)) IP.vis.get(pid).set(id, row);
    return Object.assign({}, row);
  }
};
