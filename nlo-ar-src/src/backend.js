/* =====================================================================
   Firebase backend. Sign-in is NLO Cases' (same people, same passwords).
   A/R data is sealed with the A/R key: a key ring of its own, sealed to
   each person Dr. A gives A/R to (with their own key pair, so only they
   can open their copy), plus one copy sealed to the office recovery key
   so Dr. A can never lose it.
   Plain fields in the database: dates, counts, open/done, who saved —
   never a name, a phone number or an amount.
   ===================================================================== */
const FB = {
  emu: false, app: null, auth: null, db: null, cfg: null,
  uid: null, me: null, priv: null, ring: null, keys: null, curV: 0, ringV: 0, lastCode: '',
  ar: null, // { ring, keys, curV, ringV, idx }
  rotating: false, resealing: false, // (owner) the A/R key is being changed / everything is being sealed again
  unsubs: [], pending: 0, onSync: null,

  ts() { return firebase.firestore.FieldValue.serverTimestamp(); },
  del() { return firebase.firestore.FieldValue.delete(); },
  tsMs(t) { return t && t.toMillis ? t.toMillis() : (t || null); },
  isOwner() { return !!(FB.me && FB.me.role === 'owner'); },

  available() { return typeof firebase !== 'undefined' && !!firebase.initializeApp; },
  configured() { return FB.emu || FB_CONFIG.apiKey.indexOf('__') !== 0; },
  init(emu) {
    FB.emu = !!emu;
    FB.cfg = FB.emu ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-nlo-cases', appId: 'demo' } : FB_CONFIG;
    if (!FB.available() || !FB.configured()) return false;
    FB.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FB.cfg);
    FB.auth = firebase.auth(); FB.db = firebase.firestore();
    if (FB.emu) { FB.auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); FB.db.useEmulator('127.0.0.1', 8080); }
    return true;
  },
  async ready() {
    // Never keep a session across reloads: the keys only live in memory, so a reload means sign in again.
    try { await FB.auth.setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) { }
  },
  busy(n) { FB.pending += n; if (FB.onSync) FB.onSync(); },
  async track(p) { FB.busy(1); try { return await p; } finally { FB.busy(-1); } },

  /* ---------- sign in (same logins as NLO Cases) ---------- */
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
    FB.me = Object.assign({ uid: FB.uid, email: cred.user.email || '' }, m);
    if (m.mustSetup) {
      if (m.priv) { // set a password already but didn't finish: try it
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
  /* first sign-in with a temporary password: choose a real one */
  async firstSetup(tempPw, newPw) {
    const m = FB.me; const uid = FB.uid;
    let ring;
    try { ring = Crypto.ringFrom(await Crypto.pwOpen(tempPw, m.boot, 'boot:' + uid)); }
    catch (e) { throw errCode('boot-failed'); }
    const cur = (await FB.db.doc('meta/keys').get()).data().current;
    if (!ring[cur]) throw errCode('boot-stale');
    const pair = await Crypto.newPair(); const pub = await Crypto.pubJwk(pair);
    const pbytes = await Crypto.privBytes(pair);
    const priv = await Crypto.pwSeal(newPw, pbytes, 'priv:' + uid);
    const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
    await FB.db.doc('members/' + uid).update({ pub, priv, ring: ringBox, ringV: cur });
    await FB.auth.currentUser.updatePassword(newPw);
    await FB.db.doc('members/' + uid).update({ mustSetup: false, boot: FB.del(), lastLogin: FB.ts() });
    FB.priv = await Crypto.importPriv(pbytes); FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.curV = cur; FB.ringV = cur;
    FB.me = Object.assign({}, FB.me, { mustSetup: false, pub });
  },
  /* owner forgot password → reset by email → recovery code restores the office key (and, kept for a moment, A/R's) */
  async recover(pw, code) {
    const uid = FB.uid;
    const r = (await FB.db.doc('meta/recovery').get()).data();
    let ring;
    try {
      const rpriv = await Crypto.importPriv(await Crypto.pwOpen(recoveryCodeNorm(code), r.priv, 'recovery-priv'));
      ring = Crypto.ringFrom(await Crypto.openFrom(rpriv, r.ring, 'ring:recovery'));
    } catch (e) { throw errCode('bad-code'); }
    const pair = await Crypto.newPair(); const pub = await Crypto.pubJwk(pair); const pbytes = await Crypto.privBytes(pair);
    const priv = await Crypto.pwSeal(pw, pbytes, 'priv:' + uid);
    const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
    const v = Math.max.apply(null, Object.keys(ring).map(Number));
    await FB.db.doc('members/' + uid).update({ pub, priv, privPrev: FB.del(), ring: ringBox, ringV: v, lastLogin: FB.ts() });
    FB.priv = await Crypto.importPriv(pbytes); FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.ringV = v;
    FB.curV = (await FB.db.doc('meta/keys').get()).data().current;
    FB.me = Object.assign({}, FB.me, { pub }); FB.lastCode = code;
  },
  async sendReset(email) { await FB.auth.sendPasswordResetEmail(email); },
  async changePassword(cur, next) {
    const u = FB.auth.currentUser;
    await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, cur));
    const m = (await FB.db.doc('members/' + FB.uid).get()).data();
    let bytes;
    try { bytes = await Crypto.pwOpen(cur, m.priv, 'priv:' + FB.uid); }
    catch (e) { bytes = await Crypto.pwOpen(cur, m.privPrev, 'priv:' + FB.uid); }
    const priv = await Crypto.pwSeal(next, bytes, 'priv:' + FB.uid);
    const privPrev = await Crypto.pwSeal(cur, bytes, 'priv:' + FB.uid);
    await FB.db.doc('members/' + FB.uid).update({ priv, privPrev });
    await u.updatePassword(next);
    await FB.db.doc('members/' + FB.uid).update({ privPrev: FB.del() });
  },
  async signOut() {
    FB.stop();
    FB.priv = FB.ring = FB.keys = FB.me = FB.uid = FB.ar = null; FB.curV = FB.ringV = 0; FB.lastCode = ''; FB.queues = {};
    try { await FB.auth.signOut(); } catch (e) { }
  },
  stop() { FB.unsubs.forEach(u => { try { u(); } catch (e) { } }); FB.unsubs = []; },

  /* =====================================================================
     The A/R key
     ===================================================================== */
  isPerm(e) { return /permission/i.test((e && (e.code || e.message)) || ''); },
  /* open my copy of the A/R key. → 'ok' | 'none' (not given A/R) | 'setup' (owner: A/R not set up yet)
     | 'stale' (my copy was sealed to an older key pair of mine) | 'rules' (the database's rules don't know A/R yet) */
  async arOpen() {
    let g, keys;
    try { [g, keys] = await Promise.all([FB.db.doc('arAccess/' + FB.uid).get(), FB.db.doc('meta/arKeys').get().catch(e => { if (FB.isOwner()) throw e; return null; })]); }
    catch (e) { if (FB.isPerm(e)) return FB.isOwner() ? 'rules' : 'none'; throw e; }
    if (!g.exists) return FB.isOwner() ? (keys && keys.exists ? 'stale' : 'setup') : 'none';
    try { await FB.arLoad(g.data(), keys && keys.exists ? keys.data().current : null); }
    catch (e) { return 'stale'; }
    return 'ok';
  },
  async arLoad(grant, cur) {
    const ring = Crypto.ringFrom(await Crypto.openFrom(FB.priv, grant.ring, 'arring:' + FB.uid));
    if (cur == null) { const k = await FB.db.doc('meta/arKeys').get(); cur = k.exists ? k.data().current : 1; }
    if (!ring[cur]) cur = Math.max.apply(null, Object.keys(ring).map(Number)); // my copy isn't sealed again yet: the rules say when
    FB.ar = { ring, keys: await Crypto.ringKeys(ring), curV: cur, ringV: grant.ringV || 0, idx: await Crypto.idxKey(ring) };
  },
  /* fetch my copy of the A/R key again (after the key changed) */
  async arReload() {
    const g = await FB.db.doc('arAccess/' + FB.uid).get(); if (!g.exists) throw errCode('permission-denied');
    await FB.arLoad(g.data());
  },
  /* owner, once: make the A/R key */
  async arSetup() {
    if (!FB.isOwner()) throw errCode('permission');
    const ring = { '1': Crypto.newRingKey() }, b = FB.db.batch();
    b.set(FB.db.doc('meta/arKeys'), { current: 1 });
    b.set(FB.db.doc('arAccess/' + FB.uid), await FB.grantDoc(FB.uid, FB.me.pub, FB.me.staffId, ring, 1));
    const esc = await FB.escrowDoc(ring, 1); if (esc) b.set(FB.db.doc('meta/arEscrow'), esc);
    b.set(FB.db.doc('meta/arTeam'), { sids: [FB.me.staffId], at: FB.ts() });
    await FB.track(b.commit());
    FB.ar = { ring, keys: await Crypto.ringKeys(ring), curV: 1, ringV: 1, idx: await Crypto.idxKey(ring) };
  },
  async grantDoc(uid, pub, sid, ring, v) {
    return { ring: await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'arring:' + uid), ringV: v, pubX: pub.x, sid, by: FB.uid, at: FB.ts() };
  },
  /* a copy of the A/R key sealed to the office recovery key (owner only) */
  async escrowDoc(ring, v) {
    const r = await FB.db.doc('meta/recovery').get(); if (!r.exists || !r.data().pub) return null;
    const pub = r.data().pub;
    return { ring: await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'arring:recovery'), ringV: v, recX: pub.x, by: FB.uid, at: FB.ts() };
  },
  /* owner: my copy can't be opened (new password via the recovery code) → open the recovery copy with the code */
  async arRestore(code) {
    const [r, e] = await Promise.all([FB.db.doc('meta/recovery').get(), FB.db.doc('meta/arEscrow').get()]);
    if (!e.exists) throw errCode('no-escrow');
    let ring;
    try {
      const rpriv = await Crypto.importPriv(await Crypto.pwOpen(recoveryCodeNorm(code), r.data().priv, 'recovery-priv'));
      ring = Crypto.ringFrom(await Crypto.openFrom(rpriv, e.data().ring, 'arring:recovery'));
    } catch (x) { throw errCode('bad-code'); }
    const v = Math.max.apply(null, Object.keys(ring).map(Number));
    await FB.track(FB.db.doc('arAccess/' + FB.uid).set(await FB.grantDoc(FB.uid, FB.me.pub, FB.me.staffId, ring, v)));
    const k = await FB.db.doc('meta/arKeys').get();
    FB.ar = { ring, keys: await Crypto.ringKeys(ring), curV: k.exists ? k.data().current : v, ringV: v, idx: await Crypto.idxKey(ring) };
  },
  /* owner: everyone with A/R, the office team, and whether the recovery copy is current */
  async arPeople() {
    const [gs, ms, esc, rec] = await Promise.all([FB.db.collection('arAccess').get(), FB.db.collection('members').get(), FB.db.doc('meta/arEscrow').get(), FB.db.doc('meta/recovery').get()]);
    return {
      grants: gs.docs.map(d => Object.assign({ uid: d.id }, d.data())),
      members: ms.docs.map(d => Object.assign({ uid: d.id }, d.data())),
      hasRecovery: rec.exists && !!(rec.data().pub),
      escrowOk: esc.exists && rec.exists && esc.data().recX === (rec.data().pub || {}).x && esc.data().ringV === FB.ar.curV
    };
  },
  async writeTeam(grantsAfter) {
    const sids = Array.from(new Set(grantsAfter.map(g => g.sid).filter(Boolean)));
    await FB.db.doc('meta/arTeam').set({ sids, at: FB.ts() });
  },
  /* owner: give someone A/R (they need to have signed in once, so they have a key pair) */
  /* One change to who holds the A/R key at a time — across tabs and Dr. A's devices. Two key changes at once could leave
     things sealed with a key nobody was given, so each takes a short lock (a document only Dr. A can write; one left behind
     by a closed tab is ignored after 10 minutes), starts from the current key, and lets go before re-sealing. */
  async withKeyLock(fn) {
    const ref = FB.db.doc('meta/arKeyLock'), me = FB.uid + ':' + uid8();
    await FB.track(FB.db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (s.exists) { const at = FB.tsMs(s.data().at); if (at && Date.now() - at < 10 * 60000) throw errCode('busy', 'A/R’s key is being changed on another screen. Try again in a minute.'); }
      tx.set(ref, { by: me, at: FB.ts() });
    }));
    FB.rotating = true;
    try { await FB.arReload(); return await fn(); }
    finally {
      FB.rotating = false;
      try { const s = await ref.get(); if (s.exists && s.data().by === me) await ref.delete(); } catch (e) { }
    }
  },
  /* owner: give someone A/R (they need to have signed in once, so they have a key pair) */
  async arGrant(m) {
    if (!m.pub || !m.active) throw errCode('no-pub', (m.name || 'They') + ' needs to sign in once (and choose a password) first.');
    await FB.withKeyLock(async () => {
      await FB.track(FB.db.doc('arAccess/' + m.uid).set(await FB.grantDoc(m.uid, m.pub, m.staffId, FB.ar.ring, FB.ar.curV)));
      const p = await FB.arPeople(); await FB.writeTeam(p.grants);
    });
  },
  /* owner: take A/R away — their copy is deleted (the database refuses them at once), then a new A/R key is made and
     everything is sealed again under it, so nothing they could have kept opens anything saved from now on */
  async arRevoke(uid, progress) {
    await FB.withKeyLock(async () => { await FB.track(FB.db.doc('arAccess/' + uid).delete()); await FB.newKey(); });
    return FB.arReseal(progress);
  },
  async arRotate(progress) {
    await FB.withKeyLock(() => FB.newKey());
    return FB.arReseal(progress);
  },
  /* (inside the lock) a new key version for everyone still allowed, then the recovery copy and the team, then the switch */
  async newKey() {
    const newV = FB.ar.curV + 1, ring2 = Object.assign({}, FB.ar.ring, { [newV]: Crypto.newRingKey() });
    const p = await FB.arPeople(), mem = new Map(p.members.map(m => [m.uid, m])), writes = [], keep = [];
    for (const g of p.grants) {
      const m = mem.get(g.uid);
      if (!m || !m.active || !m.pub) { writes.push(b => b.delete(FB.db.doc('arAccess/' + g.uid))); continue; }
      const gd = await FB.grantDoc(g.uid, m.pub, m.staffId, ring2, newV);
      writes.push(b => b.set(FB.db.doc('arAccess/' + g.uid), gd)); keep.push(m.staffId);
    }
    // a few per batch: each one's rule looks the person up, and one batch may only look up so many documents
    for (let i = 0; i < writes.length; i += 5) { const b = FB.db.batch(); writes.slice(i, i + 5).forEach(w => w(b)); await FB.track(b.commit()); }
    const b2 = FB.db.batch(), esc = await FB.escrowDoc(ring2, newV);
    if (esc) b2.set(FB.db.doc('meta/arEscrow'), esc);
    b2.set(FB.db.doc('meta/arTeam'), { sids: Array.from(new Set(keep)), at: FB.ts() });
    await FB.track(b2.commit());
    // only now does anything get sealed with the new key (everyone who keeps A/R already has it)
    await FB.track(FB.db.doc('meta/arKeys').update({ current: newV }));
    FB.ar = { ring: ring2, keys: await Crypto.ringKeys(ring2), curV: newV, ringV: newV, idx: FB.ar.idx };
  },
  /* owner: seal everything still under an older A/R key with the newest one */
  async arReseal(progress) {
    if (FB.resealing) return { reports: 0, items: 0, failed: 0 };
    FB.resealing = true;
    try { return await FB._reseal(progress); } finally { FB.resealing = false; }
  },
  async _reseal(progress) {
    const v = FB.ar.curV, key = FB.ar.keys[v];
    const reps = (await FB.db.collection('arReports').get()).docs.filter(d => d.data().v < v);
    const items = (await FB.db.collection('arItems').get()).docs.filter(d => d.data().v < v);
    const total = reps.length + items.length; let n = 0, failed = 0;
    for (const d of reps) {
      try {
        const x = d.data(), dataRef = FB.db.doc('arReportData/' + d.id), big = (await dataRef.get()).data();
        const rep = await Crypto.openBig(FB.ar.keys[big.v], big, 'arrep:' + d.id), sum = await Crypto.openJSON(FB.ar.keys[x.v], x.sum, 'arsum:' + d.id);
        const b = FB.db.batch(), box = await Crypto.sealBig(key, rep, 'arrep:' + d.id), sbox = await Crypto.sealJSON(key, sum, 'arsum:' + d.id);
        b.set(dataRef, { v, iv: box.iv, ct: box.ct });
        b.update(d.ref, { v, sum: sbox });
        await FB.track(b.commit());
      } catch (e) { failed++; }
      if (progress) progress(++n, total);
    }
    for (let i = 0; i < items.length; i += 10) {
      await Promise.all(items.slice(i, i + 10).map(d => FB.mutateItem(d.id, () => { }, { a: 'rekey' }).catch(() => { failed++; })));
      n += Math.min(10, items.length - i); if (progress) progress(n, total);
    }
    return { reports: reps.length, items: items.length, failed };
  },
  /* owner, after someone's login was reissued (a new key pair, a new sign-in id): move their A/R to the new one */
  async arFixGrants() {
    const out = { removed: [], relogin: [], resealed: [] }; let removed = false;
    await FB.withKeyLock(async () => {
      const p = await FB.arPeople(), mem = new Map(p.members.map(m => [m.uid, m]));
      for (const g of p.grants) {
        const m = mem.get(g.uid);
        if (m && m.active) {
          // same login, but its copy is for an older key pair or an older key: seal it again
          if (m.pub && g.uid !== FB.uid && (g.pubX !== m.pub.x || (g.ringV || 0) < FB.ar.curV)) { await FB.track(FB.db.doc('arAccess/' + g.uid).set(await FB.grantDoc(g.uid, m.pub, m.staffId, FB.ar.ring, FB.ar.curV))); out.resealed.push(m.name); }
          continue;
        }
        // the login was turned off (removed, or reissued as a new login): its copy goes and a new key is made.
        // A new login with the same username may be the same person or someone new, so Dr. A turns A/R on again himself.
        await FB.track(FB.db.doc('arAccess/' + g.uid).delete()); removed = true;
        const now = p.members.find(x => x.active && x.staffId === g.sid && x.uid !== g.uid);
        (now ? out.relogin : out.removed).push((now && now.name) || (m && m.name) || g.sid);
      }
      if (!p.escrowOk && p.hasRecovery) { const esc = await FB.escrowDoc(FB.ar.ring, FB.ar.curV); if (esc) await FB.track(FB.db.doc('meta/arEscrow').set(esc)); }
      if (removed) await FB.newKey();
    });
    if (removed) await FB.arReseal();
    return out;
  },

  /* =====================================================================
     Live data
     ===================================================================== */
  start(h) {
    FB.stop();
    const uid = FB.uid;
    FB.unsubs.push(FB.db.doc('members/' + uid).onSnapshot(s => { if (!s.exists || !s.data().active) h.revoked(); }, e => h.revoked(e)));
    // my copy of the A/R key: taken away (revoked), or sealed again under a new key (re-load it)
    FB.unsubs.push(FB.db.doc('arAccess/' + uid).onSnapshot(async s => {
      if (!s.exists) { if (!FB.isOwner()) h.revoked('ar'); return; }
      const g = s.data();
      if (FB.ar && g.ringV && g.ringV !== FB.ar.ringV) { try { await FB.arLoad(g); h.rekeyed(); } catch (e) { h.error(e); } }
    }, e => { if (!FB.isOwner()) h.revoked('ar'); }));
    FB.unsubs.push(FB.db.doc('meta/arKeys').onSnapshot(s => {
      if (!s.exists || !FB.ar) return; const cur = s.data().current;
      if (FB.ar.keys[cur]) FB.ar.curV = cur; else FB.arReload().catch(() => { });
    }, () => { }));
    FB.unsubs.push(FB.db.doc('meta/settings').onSnapshot(s => h.settings(s.exists ? s.data() : {}), () => { }));
    FB.unsubs.push(FB.db.doc('meta/arTeam').onSnapshot(s => h.team(s.exists ? (s.data().sids || []) : []), () => h.team([])));
    FB.unsubs.push(FB.db.collection('roster').onSnapshot(s => h.roster(s.docs.map(d => Object.assign({ sid: d.id }, d.data()))), e => h.error(e)));
    FB.unsubs.push(FB.db.collection('arReports').onSnapshot(async snap => {
      const list = [];
      for (const d of snap.docs) list.push(await FB.repMeta(d.id, d.data()));
      h.reports(list.sort((a, b) => (b.asOf > a.asOf ? 1 : b.asOf < a.asOf ? -1 : (b.at || 0) - (a.at || 0))));
    }, e => h.loadError(e)));
    FB.unsubs.push(FB.db.collection('arItems').where('status', '==', 'open').onSnapshot(async snap => {
      const up = [], gone = [], left = [];
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') { left.push(ch.doc.id); continue; }
        try { up.push(await FB.decryptItem(ch.doc.id, ch.doc.data())); }
        catch (e) { up.push({ id: ch.doc.id, locked: true, state: 'open', log: [] }); }
      }
      // an account that left the open list was resolved: fetch it as it is now, so it shows as resolved
      for (const id of left) { let it = null; try { it = await FB.getItem(id); } catch (e) { } if (it) up.push(it); else gone.push(id); }
      h.items(up, gone, snap.metadata.fromCache);
    }, e => h.loadError(e)));
  },
  async repMeta(id, x) {
    let sum = null; try { sum = await Crypto.openJSON(FB.ar.keys[x.v], x.sum, 'arsum:' + id); } catch (e) { }
    return { id, asOf: x.asOf, n: x.n, at: FB.tsMs(x.at), by: x.uid, sid: x.sid, v: x.v, sum, locked: !sum };
  },
  /* one saved report, opened */
  async loadReport(id) {
    const s = await FB.db.doc('arReportData/' + id).get(); if (!s.exists) throw errCode('gone');
    const x = s.data(); const key = FB.ar.keys[x.v]; if (!key) throw errCode('no-key');
    return Crypto.openBig(key, x, 'arrep:' + id);
  },
  /* save an imported report: the sealed report and its sealed totals, together */
  async saveReport(rep, totals) {
    try { return await FB._saveReport(rep, totals); }
    catch (e) { if (!(FB.isPerm(e) || e.code === 'no-key')) throw e; await FB.arReload(); return FB._saveReport(rep, totals); }
  },
  async _saveReport(rep, totals) {
    const ref = FB.db.collection('arReports').doc(), id = ref.id, v = FB.ar.curV, key = FB.ar.keys[v];
    if (!key) throw errCode('no-key');
    const box = await Crypto.sealBig(key, rep, 'arrep:' + id), sbox = await Crypto.sealJSON(key, totals, 'arsum:' + id);
    if (box.ct.length > 950000) throw errCode('too-big', 'This report is too large to save in one piece. In Edge, tick “Exclude Zero Dollar Balances” and run it again.');
    await Crypto.openBig(key, box, 'arrep:' + id); // never store what can't be opened
    const b = FB.db.batch();
    b.set(FB.db.doc('arReportData/' + id), { v, iv: box.iv, ct: box.ct });
    b.set(ref, { v, sum: sbox, asOf: rep.asOf, n: rep.rows.length, uid: FB.uid, sid: FB.me.staffId, at: FB.ts() });
    await FB.track(b.commit());
    return id;
  },
  async deleteReport(id) {
    const b = FB.db.batch(); b.delete(FB.db.doc('arReports/' + id)); b.delete(FB.db.doc('arReportData/' + id));
    await FB.track(b.commit());
  },

  /* =====================================================================
     Worked accounts: sealed; every save keeps the copy it replaced
     ===================================================================== */
  async itemId(key) { return 'a' + b64url(await Crypto.hmac(FB.ar.idx, key)).slice(0, 22); },
  async decryptItem(id, d) {
    const key = FB.ar && FB.ar.keys[d.v]; if (!key) throw errCode('no-key');
    const data = await Crypto.openJSON(key, d, 'aritem:' + id);
    return Object.assign(data, { id, rev: d.rev, v: d.v, status: d.status, by: d.sid || '', updatedAt: FB.tsMs(d.updatedAt), createdAtSrv: FB.tsMs(d.createdAt) });
  },
  async getItem(id) { const s = await FB.db.doc('arItems/' + id).get(); return s.exists ? FB.decryptItem(id, s.data()) : null; },
  async loadDone(days) {
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
    const snap = await FB.db.collection('arItems').where('updatedAt', '>=', since).get(), out = [];
    for (const d of snap.docs) { if (d.data().status !== 'done') continue; try { out.push(await FB.decryptItem(d.id, d.data())); } catch (e) { } }
    return out;
  },
  clean(data) { const o = Object.assign({}, data); ['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'createdAtSrv', 'locked'].forEach(k => delete o[k]); return o; },
  async logOps(bt, itemId, rev, prev, action) {
    const lid = itemId + '_' + rev, v = FB.ar.curV;
    const box = await Crypto.sealJSON(FB.ar.keys[v], action, 'arlog:' + lid);
    bt.set(FB.db.doc('arLog/' + lid), { itemId, rev, uid: FB.uid, sid: FB.me.staffId, at: FB.ts(), v, iv: box.iv, ct: box.ct, prev: prev || null });
  },
  queues: {},
  /* create the account's record if it isn't there yet, then apply fn — one person's writes to one account run in order */
  mutateItem(id, fn, action, base) {
    const run = () => FB._mutate(id, fn, action, base, 0);
    const p = (FB.queues[id] || Promise.resolve()).then(run, run);
    FB.queues[id] = p.catch(() => { });
    return p;
  },
  async _mutate(id, fn, action, base, tries) {
    const ref = FB.db.doc('arItems/' + id);
    try {
      await FB.track(FB.db.runTransaction(async tx => {
        const s = await tx.get(ref), v = FB.ar.curV; if (!FB.ar.keys[v]) throw errCode('no-key');
        if (!s.exists) {
          if (!base) throw errCode('gone');
          const data = FB.clean(JSON.parse(JSON.stringify(base))); fn(data);
          const box = await Crypto.sealJSON(FB.ar.keys[v], data, 'aritem:' + id);
          tx.set(ref, { v, iv: box.iv, ct: box.ct, status: data.state === 'done' ? 'done' : 'open', rev: 1, by: FB.uid, sid: FB.me.staffId, createdAt: FB.ts(), updatedAt: FB.ts() });
          await FB.logOps(tx, id, 1, null, action || { a: 'create' });
          return;
        }
        const d = s.data(), data = FB.clean(await FB.decryptItem(id, d)); fn(data);
        const box = await Crypto.sealJSON(FB.ar.keys[v], data, 'aritem:' + id);
        tx.update(ref, { v, iv: box.iv, ct: box.ct, status: data.state === 'done' ? 'done' : 'open', rev: d.rev + 1, by: FB.uid, sid: FB.me.staffId, updatedAt: FB.ts() });
        await FB.logOps(tx, id, d.rev + 1, { v: d.v, iv: d.iv, ct: d.ct }, action || { a: 'save' });
      }));
    } catch (e) {
      if (tries < 2 && (FB.isPerm(e) || e.code === 'no-key')) {
        // the A/R key may have just been changed: fetch my copy again and retry
        const g = await FB.db.doc('arAccess/' + FB.uid).get(); if (!g.exists) throw e;
        await FB.arLoad(g.data());
        await new Promise(r => setTimeout(r, 150 + Math.random() * 350));
        return FB._mutate(id, fn, action, base, tries + 1);
      }
      throw e;
    }
  },
  async itemLog(id) {
    const snap = await FB.db.collection('arLog').where('itemId', '==', id).get(), out = [];
    for (const d of snap.docs) { const x = d.data(); try { out.push(Object.assign(await Crypto.openJSON(FB.ar.keys[x.v], x, 'arlog:' + d.id), { at: FB.tsMs(x.at), sid: x.sid, rev: x.rev })); } catch (e) { } }
    return out.sort((a, b) => (a.rev || 0) - (b.rev || 0));
  },
  /* every saved version of one account's record, newest first (the copy each save replaced) */
  async itemVersions(id) {
    const snap = await FB.db.collection('arLog').where('itemId', '==', id).get(), out = [];
    for (const d of snap.docs) {
      const x = d.data(); if (!x.prev) continue;
      let who = null; try { who = await Crypto.openJSON(FB.ar.keys[x.v], x, 'arlog:' + d.id); } catch (e) { }
      let data = null; try { data = await Crypto.openJSON(FB.ar.keys[x.prev.v], x.prev, 'aritem:' + id); } catch (e) { }
      out.push({ rev: x.rev - 1, replacedAt: FB.tsMs(x.at), replacedBy: x.sid, replacedHow: who && who.a, data });
    }
    return out.sort((a, b) => b.rev - a.rev);
  },
  async restoreVersion(id, data) { const keep = FB.clean(data); return FB.mutateItem(id, d => { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, keep); }, { a: 'restore' }); },
  /* recent activity (owner): who did what, last N days */
  async activity(days) {
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
    const snap = await FB.db.collection('arLog').where('at', '>=', since).get(), out = [];
    for (const d of snap.docs) { const x = d.data(); try { out.push(Object.assign(await Crypto.openJSON(FB.ar.keys[x.v], x, 'arlog:' + d.id), { at: FB.tsMs(x.at), sid: x.sid, itemId: x.itemId })); } catch (e) { } }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  },
  async saveSettings(patch) { await FB.track(FB.db.doc('meta/settings').set(patch, { merge: true })); }
};
