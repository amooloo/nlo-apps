/* =====================================================================
   Firebase backend (the NLO Cases project: same logins, same key ring).
   What is stored: the doctor directory, one sealed record per doctor
   ("refDocs"), and the office's letter settings ("refCfg/office"), both
   encrypted in the browser with the office key. Plain fields on a record:
   v (key version), rev, by/sid, createdAt/updatedAt — nothing readable.
   Nothing about a patient or a letter is ever written here.
   ===================================================================== */
const FB = {
  emu: false, app: null, auth: null, db: null, cfg: null,
  uid: null, me: null, priv: null, ring: null, keys: null, curV: 0, ringV: 0,
  unsubs: [], pending: 0, onSync: null, queues: {},

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
    // Never keep a session across reloads: the key ring only lives in memory, so a reload means sign in again.
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
    FB.me = Object.assign({ uid: FB.uid }, m);
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
  /* owner forgot password → reset by email → recovery code restores the key ring */
  async recover(pw, code) {
    const uid = FB.uid;
    const r = (await FB.db.doc('meta/recovery').get()).data();
    let ring;
    try {
      const rpriv = await Crypto.importPriv(await Crypto.pwOpen(normCode(code), r.priv, 'recovery-priv'));
      ring = Crypto.ringFrom(await Crypto.openFrom(rpriv, r.ring, 'ring:recovery'));
    } catch (e) { throw errCode('bad-code'); }
    const pair = await Crypto.newPair(); const pub = await Crypto.pubJwk(pair); const pbytes = await Crypto.privBytes(pair);
    const priv = await Crypto.pwSeal(pw, pbytes, 'priv:' + uid);
    const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
    const v = Math.max.apply(null, Object.keys(ring).map(Number));
    await FB.db.doc('members/' + uid).update({ pub, priv, privPrev: FB.del(), ring: ringBox, ringV: v, lastLogin: FB.ts() });
    FB.priv = await Crypto.importPriv(pbytes); FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.ringV = v;
    FB.curV = (await FB.db.doc('meta/keys').get()).data().current;
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
    // keep the old sealed copy until the login password has really changed
    const privPrev = await Crypto.pwSeal(cur, bytes, 'priv:' + FB.uid);
    await FB.db.doc('members/' + FB.uid).update({ priv, privPrev });
    await u.updatePassword(next);
    await FB.db.doc('members/' + FB.uid).update({ privPrev: FB.del() });
  },
  async signOut() {
    FB.stop();
    FB.priv = FB.ring = FB.keys = FB.me = FB.uid = null; FB.curV = FB.ringV = 0; FB.queues = {};
    try { await FB.auth.signOut(); } catch (e) { }
  },
  stop() { FB.unsubs.forEach(u => { try { u(); } catch (e) { } }); FB.unsubs = []; },

  /* ---------- live data ---------- */
  async openDoc(id, d) {
    const key = FB.keys && FB.keys[d.v];
    if (!key) throw errCode('no-key', 'Missing key version ' + d.v);
    const data = cleanDoc(await Crypto.openJSON(key, d, 'ref:' + id));
    return Object.assign(data, { id, rev: d.rev, v: d.v, updatedAt: FB.tsMs(d.updatedAt), by: d.sid || '' });
  },
  start(h) {
    FB.stop();
    const uid = FB.uid;
    FB.unsubs.push(FB.db.doc('members/' + uid).onSnapshot(async s => {
      if (!s.exists || !s.data().active) return h.revoked();
      const m = s.data();
      if (m.ringV && m.ringV !== FB.ringV && m.ring) { try { await FB.loadRing(m); h.rekeyed(); } catch (e) { h.error(e); } }
    }, e => h.revoked(e)));
    FB.unsubs.push(FB.db.doc('meta/keys').onSnapshot(s => { if (s.exists) FB.curV = s.data().current; }, () => { }));
    FB.unsubs.push(FB.db.doc('meta/settings').onSnapshot(s => h.settings(s.exists ? s.data() : {}), () => { }));
    FB.unsubs.push(FB.db.collection('refDocs').onSnapshot(async snap => {
      const up = [], gone = [];
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') { gone.push(ch.doc.id); continue; }
        try { up.push(await FB.openDoc(ch.doc.id, ch.doc.data())); }
        catch (e) { up.push(Object.assign(blankDoc(), { id: ch.doc.id, locked: true, last: '(locked record)' })); }
      }
      h.docs(up, gone);
    }, e => h.docsError(e)));
    FB.unsubs.push(FB.db.doc('refCfg/office').onSnapshot(async s => {
      if (!s.exists) return h.office(null);
      try { const d = s.data(); h.office(await Crypto.openJSON(FB.keys[d.v], d, 'refcfg:office')); } catch (e) { h.office(null); }
    }, () => h.office(null)));
  },

  /* ---------- writes ---------- */
  plain(data) { const o = {}; DOC_FIELDS.forEach(k => { o[k] = data[k] || ''; }); if (data.off) o.off = true; return o; },
  async sealed(id, data) {
    const v = FB.curV; const box = await Crypto.sealJSON(FB.keys[v], FB.plain(cleanDoc(data)), 'ref:' + id);
    return { v, iv: box.iv, ct: box.ct, by: FB.uid, sid: FB.me.staffId, updatedAt: FB.ts() };
  },
  /* add a list of doctors; small batches keep each one well inside the rules' lookup limit, a few batches at a time */
  async addDocs(list, progress) {
    const PER = 5, LANES = 4; let n = 0; const ids = new Array(list.length);
    const chunks = []; for (let i = 0; i < list.length; i += PER) chunks.push(i);
    const lane = async () => {
      while (chunks.length) {
        const i = chunks.shift(); const b = FB.db.batch();
        for (let j = i; j < Math.min(i + PER, list.length); j++) {
          const ref = FB.db.collection('refDocs').doc();
          b.set(ref, Object.assign(await FB.sealed(ref.id, list[j]), { rev: 1, createdAt: FB.ts() }));
          ids[j] = ref.id;
        }
        await b.commit(); n += Math.min(PER, list.length - i); if (progress) progress(n, list.length);
      }
    };
    await FB.track(Promise.all(Array.from({ length: Math.min(LANES, chunks.length) }, lane)));
    return ids;
  },
  async addDoc(data) { return (await FB.addDocs([data]))[0]; },
  /* one person's saves to the same doctor run one after another, never racing each other */
  saveDoc(id, data) {
    const run = () => FB._save(id, data, 0);
    const p = (FB.queues[id] || Promise.resolve()).then(run, run);
    FB.queues[id] = p.catch(() => { });
    return p;
  },
  async _save(id, data, tries) {
    const ref = FB.db.doc('refDocs/' + id);
    try {
      await FB.track(FB.db.runTransaction(async tx => {
        const s = await tx.get(ref); if (!s.exists) throw errCode('gone');
        tx.update(ref, Object.assign(await FB.sealed(id, data), { rev: s.data().rev + 1 }));
      }));
    } catch (e) {
      if (tries < 2 && /permission/i.test(e.code || e.message || '')) {
        // the office key may have just been changed: refresh it and try again
        const m = (await FB.db.doc('members/' + FB.uid).get()).data();
        if (!m || !m.active) throw e;
        await FB.loadRing(m);
        await new Promise(r => setTimeout(r, 150 + Math.random() * 350));
        return FB._save(id, data, tries + 1);
      }
      throw e;
    }
  },
  /* owner only (staff hide a doctor instead) */
  async deleteDoc(id) { await FB.track(FB.db.doc('refDocs/' + id).delete()); },
  async saveOffice(cfg) {
    const v = FB.curV; const box = await Crypto.sealJSON(FB.keys[v], cfg, 'refcfg:office');
    await FB.track(FB.db.doc('refCfg/office').set({ v, iv: box.iv, ct: box.ct, by: FB.uid, updatedAt: FB.ts() }));
  },
  /* after the office key changes: put every record still under an older key under the new one (owner's app does this quietly) */
  async resealOld(progress) {
    const snap = await FB.db.collection('refDocs').where('v', '<', FB.curV).get(); let n = 0;
    for (const d of snap.docs) {
      try { const data = await FB.openDoc(d.id, d.data()); await FB._save(d.id, data, 0); } catch (e) { }
      n++; if (progress) progress(n, snap.size);
    }
    return snap.size;
  }
};
