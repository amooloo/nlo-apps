/* =====================================================================
   Firebase backend. Nothing readable about a patient ever leaves the
   browser: case bodies and history are sealed with the office key ring.
   Plain fields on a case doc: v (key version), status, rev, by/sid,
   createdAt/updatedAt/closedAt, and pn/pc (the patient index: keyed
   hashes, meaningless without the office key) — none of them identify a patient.
   ===================================================================== */
function errCode(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

const FB = {
  emu: false, app: null, auth: null, db: null, cfg: null,
  uid: null, me: null, priv: null, ring: null, keys: null, curV: 0, ringV: 0,
  unsubs: [], pending: 0, onSync: null,
  idxOn: false, idxKey: null, // the patient index (see idxFields): written once the live rules allow it

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

  /* ---------- sign in ---------- */
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

  /* ---------- first-time office setup (owner) ---------- */
  /* step 1: create (or reuse) the owner's account and make sure the email is verified */
  async setupAccount(email, pw) {
    let cred;
    try { cred = await FB.auth.createUserWithEmailAndPassword(email, pw); }
    catch (e) { if (/email-already-in-use/.test(e.code || '')) cred = await FB.auth.signInWithEmailAndPassword(email, pw); else throw e; }
    FB.uid = cred.user.uid;
    if (!cred.user.emailVerified) await cred.user.sendEmailVerification();
    return cred.user.emailVerified;
  },
  async setupVerified() {
    const u = FB.auth.currentUser; if (!u) return false;
    await u.reload(); await u.getIdToken(true);
    return FB.auth.currentUser.emailVerified;
  },
  async resendVerify() { const u = FB.auth.currentUser; if (u) await u.sendEmailVerification(); },
  /* step 2: create the office (key ring, owner record, recovery code) */
  async setupOwner(name, pw) {
    const uid = FB.uid = FB.auth.currentUser.uid;
    const sid = slug(name.split(/\s+/)[0]) || 'owner';
    const ring = { '1': Crypto.newRingKey() };
    const pair = await Crypto.newPair(); const pub = await Crypto.pubJwk(pair); const pbytes = await Crypto.privBytes(pair);
    const priv = await Crypto.pwSeal(pw, pbytes, 'priv:' + uid);
    const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
    const code = recoveryCode();
    const rec = await FB.recoveryDoc(code, ring);
    const b = FB.db.batch();
    b.set(FB.db.doc('members/' + uid), { staffId: sid, username: '', name, role: 'owner', active: true, mustSetup: false, pub, priv, ring: ringBox, ringV: 1, gen: 0, createdAt: FB.ts(), lastLogin: FB.ts() });
    b.set(FB.db.doc('meta/setup'), { owner: uid, at: FB.ts() });
    b.set(FB.db.doc('meta/keys'), { current: 1 });
    b.set(FB.db.doc('meta/settings'), { idleMin: 10 });
    b.set(FB.db.doc('meta/recovery'), rec);
    b.set(FB.db.doc('roster/' + sid), { name, initials: initials(name), role: 'owner', active: true, username: '', gen: 0 });
    await b.commit();
    FB.me = { uid, staffId: sid, username: '', name, role: 'owner', active: true, pub };
    FB.priv = await Crypto.importPriv(pbytes); FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.curV = 1; FB.ringV = 1;
    return code;
  },
  async recoveryDoc(code, ring) {
    const rpair = await Crypto.newPair(); const rpub = await Crypto.pubJwk(rpair);
    const rpriv = await Crypto.pwSeal(normCode(code), await Crypto.privBytes(rpair), 'recovery-priv');
    const rring = await Crypto.sealTo(rpub, Crypto.ringBytes(ring), 'ring:recovery');
    return { pub: rpub, priv: rpriv, ring: rring, ringV: Math.max.apply(null, Object.keys(ring).map(Number)) };
  },
  async newRecoveryCode() {
    const code = recoveryCode();
    await FB.db.doc('meta/recovery').set(await FB.recoveryDoc(code, FB.ring));
    return code;
  },

  async signOut() {
    FB.stop();
    FB.priv = FB.ring = FB.keys = FB.me = FB.uid = FB.inboxPriv = FB.idxKey = null; FB.curV = FB.ringV = 0; FB.idxOn = false;
    try { await FB.auth.signOut(); } catch (e) { }
  },
  stop() { FB.unsubs.forEach(u => { try { u(); } catch (e) { } }); FB.unsubs = []; },

  /* ---------- live data ---------- */
  async decryptDoc(id, d) {
    const key = FB.keys && FB.keys[d.v];
    if (!key) throw errCode('no-key', 'Missing key version ' + d.v);
    const data = await Crypto.openJSON(key, d, 'case:' + id);
    return Object.assign(data, { id, rev: d.rev, v: d.v, status: d.status, by: d.sid || '', updatedAt: FB.tsMs(d.updatedAt), createdAtSrv: FB.tsMs(d.createdAt), closedAt: FB.tsMs(d.closedAt) });
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
    FB.unsubs.push(FB.db.collection('roster').onSnapshot(s => h.roster(s.docs.map(d => Object.assign({ sid: d.id }, d.data()))), e => h.error(e)));
    FB.unsubs.push(FB.db.collection('cases').where('status', '==', 'open').onSnapshot(async snap => {
      const up = [], gone = [];
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') { gone.push(ch.doc.id); continue; }
        try { up.push(await FB.decryptDoc(ch.doc.id, ch.doc.data())); }
        catch (e) { up.push({ id: ch.doc.id, locked: true, status: 'open', type: 'misc', patient: '(locked case)', stage: '' }); }
      }
      h.cases(up, gone, snap.metadata.fromCache);
    }, e => h.error(e)));
    if (FB.isOwner()) {
      FB.unsubs.push(FB.db.collection('members').onSnapshot(s => h.members(s.docs.map(d => Object.assign({ uid: d.id }, d.data()))), e => h.error(e)));
    }
    // lab emails arriving from the email script (sealed); the app reads and applies them (mail.js)
    if (h.inbox) FB.unsubs.push(FB.db.collection('inbox').onSnapshot(() => h.inbox(), () => { }));
    // each mailbox's last check, live on Team & security (owner)
    if (h.mailbeat && FB.isOwner()) FB.unsubs.push(FB.db.collection('mailbeat').onSnapshot(s => h.mailbeat(s.docs.map(d => Object.assign({ id: d.id }, d.data(), { at: FB.tsMs(d.data().at) }))), () => { }));
  },

  /* ---------- lab-email updates (see mail.js and mail/script.js) ---------- */
  async mailState() {
    const [ib, beats, bots] = await Promise.all([FB.db.doc('meta/inbox').get(), FB.db.collection('mailbeat').get(), FB.isOwner() ? FB.db.collection('mailbots').get() : null]);
    // (the robot logins are the email robot's and the lab PC's — lab.js; "on" is the email robot's)
    const list = bots ? bots.docs.map(d => ({ uid: d.id, email: d.data().email })) : [];
    return { on: ib.exists && (!bots || list.some(x => !labBot(x))), pub: ib.exists ? ib.data() : null,
      beats: beats.docs.map(d => Object.assign({ id: d.id }, d.data(), { at: FB.tsMs(d.data().at) })), bots: list };
  },
  /* the inbox key pair: the script seals to its public half; the private half is sealed with the office key */
  async inboxKeyPair() {
    const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), kid = 'k' + uid8();
    const box = await Crypto.seal(FB.keys[FB.curV], await Crypto.privBytes(pair), 'inboxkey:' + kid);
    const cur = await FB.db.doc('meta/inboxKey').get();
    const keys = Object.assign({}, cur.exists ? cur.data().keys : {}, { [kid]: { v: FB.curV, iv: box.iv, ct: box.ct } });
    await FB.track(FB.db.doc('meta/inboxKey').set({ keys, cur: kid }));
    await FB.track(FB.db.doc('meta/inbox').set({ pub, kid, senders: MAIL_SENDERS, at: FB.ts() }, { merge: true })); // (keeps the front-desk email settings)
    FB.inboxPriv = null;
  },
  /* a robot's login (made in a second, throwaway Firebase app, so the owner stays signed in): its uid */
  async robotLogin(email, password) {
    const sec = firebase.initializeApp(FB.cfg, 'bot' + Date.now()); let uid;
    try {
      const sa = sec.auth();
      if (FB.emu) sa.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      try { await sa.setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) { }
      uid = (await sa.createUserWithEmailAndPassword(email, password)).user.uid;
      await sa.signOut();
    } finally { try { await sec.delete(); } catch (e) { } }
    return uid;
  },
  /* owner: a login for the email robot (it can only add sealed items to the inbox) — one at a time (the lab PC's is its own) */
  async mailSetup() {
    if (!(await FB.db.doc('meta/inbox').get()).exists) await FB.inboxKeyPair();
    const email = 'mailbot.' + randChars(10).toLowerCase() + '@' + STAFF_DOMAIN, password = randChars(32);
    const uid = await FB.robotLogin(email, password);
    const old = await FB.db.collection('mailbots').get();
    const box = await Crypto.sealJSON(FB.keys[FB.curV], { email, password, uid }, 'mailbot');
    const b = FB.db.batch();
    old.docs.filter(d => !labBot(d.data())).forEach(d => b.delete(d.ref));
    b.set(FB.db.doc('mailbots/' + uid), { email, at: FB.ts() });
    b.set(FB.db.doc('meta/mailbot'), { v: FB.curV, iv: box.iv, ct: box.ct });
    await FB.track(b.commit());
    return { email, password };
  },
  async mailCreds() { const s = await FB.db.doc('meta/mailbot').get(); if (!s.exists) return null; const d = s.data(); return Crypto.openJSON(FB.keys[d.v], d, 'mailbot'); },
  async mailOff() {
    const old = await FB.db.collection('mailbots').get(); const b = FB.db.batch();
    old.docs.filter(d => !labBot(d.data())).forEach(d => b.delete(d.ref)); b.delete(FB.db.doc('meta/mailbot'));
    await FB.track(b.commit());
  },
  /* owner: the lab PC's login (lab.js) — like the email robot's, it can only add sealed items to the inbox and note its check-in.
     Shown once, in the setup code (not kept: a new code replaces it) */
  async labSetup() {
    if (!(await FB.db.doc('meta/inbox').get()).exists) await FB.inboxKeyPair();
    const email = LAB_BOT + randChars(10).toLowerCase() + '@' + STAFF_DOMAIN, password = randChars(32);
    const uid = await FB.robotLogin(email, password);
    const [old, beats] = await Promise.all([FB.db.collection('mailbots').get(), FB.db.collection('mailbeat').get()]); const b = FB.db.batch();
    old.docs.filter(d => labBot(d.data())).forEach(d => b.delete(d.ref));
    beats.docs.filter(d => labBeat(d.data())).forEach(d => b.delete(d.ref)); // (the old login's check-ins: the new one checks in afresh)
    b.set(FB.db.doc('mailbots/' + uid), { email, at: FB.ts() });
    await FB.track(b.commit());
    return { email, password };
  },
  async labOff() {
    const [old, beats] = await Promise.all([FB.db.collection('mailbots').get(), FB.db.collection('mailbeat').get()]); const b = FB.db.batch();
    old.docs.filter(d => labBot(d.data())).forEach(d => b.delete(d.ref));
    beats.docs.filter(d => labBeat(d.data())).forEach(d => b.delete(d.ref)); // (its check-ins: nothing to show once it's off)
    await FB.track(b.commit());
  },
  async mailSenders(list) { await FB.db.doc('meta/inbox').update({ senders: list }); },
  /* ---------- the front-desk email for a case not shipped in time (noship.js) ----------
     The owner's settings sit with the inbox key the scripts read (meta/inbox.notify: on, to, box, pub, names); a note for the sending
     mailbox's script is sealed to that script's own key and goes in the same save that marks the case as emailed for this appt */
  async notifyCfg() { const s = await FB.db.doc('meta/inbox').get(); return s.exists ? (s.data().notify || null) : null; },
  async notifySet(n) { await FB.track(FB.db.doc('meta/inbox').update({ notify: n })); },
  async outboxNote(msg, n) {
    const id = 'o' + Array.from(rnd(16), b => b.toString(16).padStart(2, '0')).join(''), box = await Crypto.sealTo(n.pub, TE.encode(JSON.stringify(msg)), 'outbox:' + id);
    return { ref: FB.db.doc('outbox/' + id), data: { box: n.box, epk: box.epk, iv: box.iv, ct: box.ct, at: FB.ts() } };
  },
  async noshipSend(id, appt, msg, n) {
    const note = await FB.outboxNote(msg, n);
    return FB.mutateCase(id, d => { if (d.noshipMail === appt) return 'skip'; d.noshipMail = appt; }, { a: 'noship', appt, addr: n.to }, tx => { tx.set(note.ref, note.data); });
  },
  async noshipTest(msg, n) { const note = await FB.outboxNote(msg, n); await FB.track(note.ref.set(note.data)); },
  /* every inbox item, opened: [{ id, at, done, mail }] (mail = null when it can't be opened) */
  async inboxLoad() {
    const snap = await FB.db.collection('inbox').get(), out = [];
    // the private half of the inbox key, opened once (again if an email uses a key set up since)
    FB.inboxNoKid = FB.inboxNoKid || new Set(); // (a key id that isn't in meta/inboxKey: looked for once a session, not every sync)
    if (!FB.inboxPriv || snap.docs.some(d => !FB.inboxPriv[d.data().kid] && !FB.inboxNoKid.has(String(d.data().kid)))) {
      const priv = {}; const s = await FB.db.doc('meta/inboxKey').get();
      if (s.exists) for (const kid of Object.keys(s.data().keys || {})) {
        const box = s.data().keys[kid];
        try { priv[kid] = await Crypto.importPriv(await Crypto.open(FB.keys[box.v], box, 'inboxkey:' + kid)); } catch (e) { }
      }
      FB.inboxPriv = priv; snap.docs.forEach(d => { if (!priv[d.data().kid]) FB.inboxNoKid.add(String(d.data().kid)); });
    }
    for (const d of snap.docs) {
      const x = d.data(); let mail = null;
      try { mail = JSON.parse(TD.decode(await Crypto.openFrom(FB.inboxPriv[x.kid], { epk: x.epk, iv: x.iv, ct: x.ct }, 'inbox:' + d.id))); } catch (e) { }
      out.push({ id: d.id, at: FB.tsMs(x.at), done: x.done || [], mail });
    }
    return out;
  },
  /* only one open app handles an email at a time: a claim lasts a minute (a closed or stuck app's claim runs out) */
  sess: uid8(),
  async inboxClaim(id) {
    const ref = FB.db.doc('inbox/' + id);
    try {
      return await FB.db.runTransaction(async tx => {
        const s = await tx.get(ref); if (!s.exists) return false;
        const c = s.data().claim, at = c && FB.tsMs(c.at);
        if (c && c.by !== FB.sess && at && Date.now() - at < 60000) return false;
        tx.update(ref, { claim: { by: FB.sess, at: FB.ts() } }); return true;
      });
    } catch (e) { return false; }
  },
  async inboxDone(id, idx) { // (gone already = someone else finished it)
    const ref = FB.db.doc('inbox/' + id);
    await FB.db.runTransaction(async tx => { const s = await tx.get(ref); if (s.exists) tx.update(ref, { done: firebase.firestore.FieldValue.arrayUnion.apply(null, idx) }); });
  },
  async inboxDelete(id) { await FB.db.doc('inbox/' + id).delete(); },
  async loadClosed(days) {
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
    const snap = await FB.db.collection('cases').where('closedAt', '>=', since).get();
    const out = [];
    for (const d of snap.docs) { try { out.push(await FB.decryptDoc(d.id, d.data())); } catch (e) { } }
    return out;
  },
  /* every case saved in the last `days` days, open or completed (Removed duplicates: one removed from a completed case keeps its
     old completion date) */
  async loadChanged(days) {
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
    const snap = await FB.db.collection('cases').where('updatedAt', '>=', since).get();
    const out = [];
    for (const d of snap.docs) { try { out.push(await FB.decryptDoc(d.id, d.data())); } catch (e) { } }
    return out;
  },
  async loadAll() {
    const snap = await FB.db.collection('cases').get();
    const out = [];
    for (const d of snap.docs) { try { out.push(await FB.decryptDoc(d.id, d.data())); } catch (e) { } }
    return out;
  },
  async caseLog(id) {
    const snap = await FB.db.collection('log').where('caseId', '==', id).get();
    const out = [];
    for (const d of snap.docs) {
      const x = d.data(); const key = FB.keys[x.v];
      // (rev: which version of the case the entry made — a sticker on a step someone did names it, stickers.js)
      try { out.push(Object.assign(await Crypto.openJSON(key, x, 'log:' + d.id), { at: FB.tsMs(x.at), sid: x.sid, rev: x.rev })); } catch (e) { }
    }
    return out.sort((a, b) => (a.at || 0) - (b.at || 0));
  },
  async activity(days) {
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
    const snap = await FB.db.collection('log').where('at', '>=', since).get();
    const out = [];
    for (const d of snap.docs) {
      const x = d.data(); const key = FB.keys[x.v];
      try { out.push(Object.assign(await Crypto.openJSON(key, x, 'log:' + d.id), { at: FB.tsMs(x.at), sid: x.sid, caseId: x.caseId })); } catch (e) { }
    }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  },
  /* the history the Workload page counts (work.js), from `since` (and before `until`): who, when and what was done — not the copy of
     the case each entry also keeps (`prev`, most of an entry's size). Firestore's REST query can leave fields out and the SDK can't,
     so it asks that way first (same login, same rules) and falls back to the SDK's query, whole entries, if that fails.
     [{ id, caseId, at, sid, a, from, to, … }]; FB.wlVia says which way the last one went. */
  async workLog(since, until) {
    try { const out = await FB.workLogRest(since, until); FB.wlVia = 'rest'; return out; } catch (e) { }
    let q = FB.db.collection('log').where('at', '>=', firebase.firestore.Timestamp.fromMillis(since));
    if (until) q = q.where('at', '<', firebase.firestore.Timestamp.fromMillis(until));
    const snap = await q.get(), out = [];
    for (const d of snap.docs) {
      const x = d.data(), key = FB.keys[x.v]; if (!key) continue;
      try { out.push(Object.assign(await Crypto.openJSON(key, x, 'log:' + d.id), { id: d.id, at: FB.tsMs(x.at), sid: x.sid || '', caseId: x.caseId || '' })); } catch (e) { }
    }
    FB.wlVia = 'sdk'; return out;
  },
  async workLogRest(since, until) {
    const u = FB.auth.currentUser; if (!u) throw errCode('signed-out');
    const tok = await u.getIdToken();
    const url = (FB.emu ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com') + '/v1/projects/' + encodeURIComponent(FB.cfg.projectId) + '/databases/(default)/documents:runQuery';
    const at = (op, ms) => ({ fieldFilter: { field: { fieldPath: 'at' }, op, value: { timestampValue: new Date(ms).toISOString() } } });
    const where = until ? { compositeFilter: { op: 'AND', filters: [at('GREATER_THAN_OR_EQUAL', since), at('LESS_THAN', until)] } } : at('GREATER_THAN_OR_EQUAL', since);
    const body = { structuredQuery: { from: [{ collectionId: 'log' }], where, select: { fields: ['caseId', 'sid', 'at', 'v', 'iv', 'ct'].map(fieldPath => ({ fieldPath })) } } };
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
    if (!r.ok) throw errCode('rest', 'Firestore said ' + r.status);
    const rows = await r.json(); if (!Array.isArray(rows)) throw errCode('rest');
    const val = f => !f ? null : f.stringValue != null ? f.stringValue : f.integerValue != null ? f.integerValue : f.timestampValue != null ? f.timestampValue : null;
    const out = [];
    for (const row of rows) {
      const d = row && row.document; if (!d) continue;
      const F = d.fields || {}, id = String(d.name || '').split('/').pop(), key = FB.keys[Number(val(F.v))]; if (!key) continue;
      try { out.push(Object.assign(await Crypto.openJSON(key, { iv: val(F.iv), ct: val(F.ct) }, 'log:' + id), { id, at: Date.parse(val(F.at)) || 0, sid: val(F.sid) || '', caseId: val(F.caseId) || '' })); } catch (e) { }
    }
    return out;
  },

  /* ---------- writes ---------- */
  clean(data) { const o = Object.assign({}, data); ['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'createdAtSrv', 'closedAt', 'locked', 'assigneeLabel'].forEach(k => delete o[k]); return o; },
  /* history entry at the fixed id "<case>_<rev>"; prev = the encrypted copy this write replaces */
  async logOps(batchOrTx, caseId, rev, prev, action, extra) {
    const lid = caseId + '_' + rev; const ref = FB.db.doc('log/' + lid);
    const box = await Crypto.sealJSON(FB.keys[FB.curV], action, 'log:' + lid);
    batchOrTx.set(ref, Object.assign({ caseId, rev, uid: FB.uid, sid: FB.me.staffId, at: FB.ts(), v: FB.curV, iv: box.iv, ct: box.ct, prev: prev || null }, extra || {}));
  },
  async createCases(list, progress) {
    // list: [{data, status:'open'|'done', closedAt:ms, photo?:bytes}]; small batches keep each one well inside the rules' lookup limit
    const PER = 5; let n = 0;
    for (let i = 0; i < list.length; i += PER) {
      const ops = [], rec = { set: (r, d) => ops.push([r, d]) }; // (kept, so the batch can be sent again without the patient index)
      for (const item of list.slice(i, i + PER)) {
        const ref = FB.db.collection('cases').doc();
        const v = FB.curV, body = FB.clean(item.data);
        // a patient photo goes in with the new case (same batch), under its own version id
        let ph = null; if (item.photo) { body.photo = uid8(); ph = await FB.photoBox(ref.id, item.photo, body.photo); }
        const box = await Crypto.sealJSON(FB.keys[v], body, 'case:' + ref.id);
        const done = item.status === 'done';
        const doc = { v, iv: box.iv, ct: box.ct, status: done ? 'done' : 'open', rev: 1, by: FB.uid, sid: FB.me.staffId, createdAt: FB.ts(), updatedAt: FB.ts(), closedAt: done ? firebase.firestore.Timestamp.fromMillis(item.closedAt || Date.now()) : null };
        if (FB.idxOn) { const ix = await FB.idxFields(body); if (ix.pn) doc.pn = ix.pn; if (ix.pc) doc.pc = ix.pc; }
        rec.set(ref, doc);
        await FB.logOps(rec, ref.id, 1, null, item.action || { a: 'create' });
        if (ph) rec.set(FB.db.doc('photos/' + ref.id), ph);
        item.id = ref.id; item.photoV = body.photo || '';
      }
      const send = () => { const b = FB.db.batch(); ops.forEach(([r, d]) => b.set(r, d)); return FB.track(b.commit()); };
      try { await send(); }
      catch (e) { // refused with the index: the live rules may be older than this app thinks — check, and send it without
        if (!FB.idxOn || !/permission/i.test(String(e.code || e.message || '')) || await FB.idxRecheck()) throw e;
        ops.forEach(([, d]) => { delete d.pn; delete d.pc; }); await send();
      }
      n += Math.min(PER, list.length - i); if (progress) progress(n, list.length);
    }
    return list.map(x => x.id);
  },
  async createCase(data, photo) { const ids = await FB.createCases([{ data, status: 'open', photo: photo || null }]); return ids[0]; },
  /* fn(data) edits the latest decrypted copy in place; return 'done' / 'open' to change status.
     ops(tx), if given, adds other writes that must land together with this save (e.g. the case's photo) */
  /* one person's writes to the same case run one after another, never racing each other */
  queues: {},
  mutateCase(id, fn, action, ops) {
    const run = () => FB._mutate(id, fn, action, 0, ops);
    const p = (FB.queues[id] || Promise.resolve()).then(run, run);
    FB.queues[id] = p.catch(() => { });
    return p;
  },
  async _mutate(id, fn, action, tries, ops) {
    const ref = FB.db.doc('cases/' + id);
    try {
      await FB.track(FB.db.runTransaction(async tx => {
        const s = await tx.get(ref); if (!s.exists) throw errCode('gone');
        const d = s.data(); const data = FB.clean(await FB.decryptDoc(id, d));
        const st = fn(data); if (st === 'skip') throw errCode('skip'); // nothing to change: write nothing
        const status = st === 'done' || st === 'open' ? st : d.status;
        const v = FB.curV; const box = await Crypto.sealJSON(FB.keys[v], data, 'case:' + id);
        const closedAt = status === 'done' ? (d.status === 'done' && d.closedAt ? d.closedAt : FB.ts()) : null;
        const upd = { v, iv: box.iv, ct: box.ct, status, rev: d.rev + 1, by: FB.uid, sid: FB.me.staffId, updatedAt: FB.ts(), closedAt };
        if (FB.idxOn) { const ix = await FB.idxFields(data); upd.pn = ix.pn || FB.del(); upd.pc = ix.pc || FB.del(); }
        tx.update(ref, upd);
        await FB.logOps(tx, id, d.rev + 1, { v: d.v, iv: d.iv, ct: d.ct }, action || { a: 'save' });
        if (ops) await ops(tx, data);
      }));
    } catch (e) {
      if (tries < 2 && /permission/i.test(e.code || e.message || '')) {
        // the office key may have just been changed, or the live rules are older than this app thinks: refresh and try again
        if (FB.idxOn) await FB.idxRecheck();
        const m = (await FB.db.doc('members/' + FB.uid).get()).data();
        if (!m || !m.active) throw e;
        await FB.loadRing(m);
        await new Promise(r => setTimeout(r, 150 + Math.random() * 350));
        return FB._mutate(id, fn, action, tries + 1, ops);
      }
      throw e;
    }
  },
  /* owner only; the last encrypted copy stays in history, so a delete can be undone (its photo goes with it). The history
     entry is marked (del), so Deleted cases can find it without reading every recent entry. */
  async deleteCase(id, tries) {
    const ref = FB.db.doc('cases/' + id);
    try {
      await FB.track(FB.db.runTransaction(async tx => {
        const s = await tx.get(ref); if (!s.exists) throw errCode('gone'); const d = s.data();
        await FB.logOps(tx, id, d.rev + 1, { v: d.v, iv: d.iv, ct: d.ct }, { a: 'delete' }, FB.idxOn ? { del: true } : null);
        tx.delete(ref); tx.delete(FB.db.doc('photos/' + id));
      }));
    } catch (e) {
      if (!tries && FB.idxOn && /permission/i.test(String(e.code || e.message || '')) && !(await FB.idxRecheck())) return FB.deleteCase(id, 1);
      throw e;
    }
  },
  /* ---------- patient photos: one small picture per case (photos/{caseId}), sealed with the office key like the case.
     The case's own `photo` field holds the picture's version id, so the picture changes together with a case save
     (and shows in its history), and an open app knows when its copy is out of date. ---------- */
  async photoBox(id, bytes, pv) {
    const v = FB.curV; const box = await Crypto.seal(FB.keys[v], bytes, 'photo:' + id);
    return { v, iv: box.iv, ct: box.ct, pv, at: FB.ts(), by: FB.uid };
  },
  /* which of the security rules this version needs are live: 0 = older than patient photos and email updates, 1 = those but
     not the patient index and marked deletes (4 Oct 2026), 2 = those but not the front-desk email (8 Oct 2026), 3 = all of them.
     An older set refuses the read that checks. */
  async rulesLevel() {
    const can = async p => { try { await FB.db.doc(p).get(); return true; } catch (e) { return !/permission/i.test(String((e && (e.code || e.message)) || '')); } };
    let lv = !(await can('photos/_rules_check')) ? 0 : (await can('meta/rules_20261004')) ? 2 : 1;
    if (lv === 2 && await can('meta/rules_20261008')) lv = 3;
    FB.idxOn = lv >= 2; return lv;
  },
  /* a save was refused while writing the index: are the newer rules really live? (false = they aren't; saves go without it) */
  async idxRecheck() { try { await FB.rulesLevel(); } catch (e) { FB.idxOn = false; } return FB.idxOn; },

  /* ---------- the patient index (Amir, 4 Oct 2026: "data gets large enough that something bad will happen") ----------
     Each case carries pn / pc: a keyed hash of its patient's name and chart # (HMAC with a key derived from the office
     key's first version, so it stays the same through key changes). With them an app fetches the earlier cases of the
     patients it shows, instead of every completed case at every sign-in. Without the office key they reveal nothing. */
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
  /* { pn, pc } for a case body (null when it has no name / chart #) — the same keys as histKeys() in ui.js */
  async idxFields(d) {
    if (d && d.dup) return { pn: null, pc: null }; // a case removed as a duplicate isn't part of the patient's history (dupes.js)
    const n = normName(d && d.patient), c = normChart(d && d.chart);
    return { pn: n ? await FB.idxHash('n:' + n) : null, pc: c ? await FB.idxHash('c:' + c) : null };
  },
  /* every case (open and completed) of these patients: keys 'n:<normalized name>' / 'c:<normalized chart #>' */
  async loadPatients(keys) {
    const want = { pn: [], pc: [] };
    for (const k of keys) want[k[0] === 'c' ? 'pc' : 'pn'].push(await FB.idxHash(k));
    const docs = new Map();
    for (const f of ['pn', 'pc']) for (let i = 0; i < want[f].length; i += 30) {
      const s = await FB.db.collection('cases').where(f, 'in', want[f].slice(i, i + 30)).get();
      s.docs.forEach(d => docs.set(d.id, d));
    }
    const out = [];
    for (const d of docs.values()) { try { out.push(await FB.decryptDoc(d.id, d.data())); } catch (e) { } }
    return out;
  },
  /* owner: give cases their index — every case (since = 0), or the ones saved since a time (an app opened before the newer
     rules were live saves without it). Index-only writes, no new version; each names the revision it was worked out from,
     so one that raced a save is refused instead of putting back an old name. */
  async indexCases(since, progress) {
    let q = FB.db.collection('cases'); if (since) q = q.where('updatedAt', '>=', firebase.firestore.Timestamp.fromMillis(since));
    const snap = await q.get(), todo = [];
    for (const d of snap.docs) {
      const x = d.data(); if (!FB.keys[x.v]) continue;
      let body; try { body = await Crypto.openJSON(FB.keys[x.v], x, 'case:' + d.id); } catch (e) { continue; }
      const ix = await FB.idxFields(body);
      if ((x.pn || null) !== ix.pn || (x.pc || null) !== ix.pc) todo.push([d.ref, { pn: ix.pn || FB.del(), pc: ix.pc || FB.del(), rev: x.rev }]);
    }
    let done = 0, missed = 0;
    for (let i = 0; i < todo.length; i += 20) {
      await Promise.all(todo.slice(i, i + 20).map(([r, u]) => FB.track(r.update(u)).then(() => { done++; }, () => { missed++; })));
      if (progress) progress(Math.min(i + 20, todo.length), todo.length);
    }
    return { seen: snap.size, fixed: done, missed };
  },
  /* { pv, bytes } or null */
  async getPhoto(id) {
    const s = await FB.db.doc('photos/' + id).get(); if (!s.exists) return null;
    const x = s.data(); if (!FB.keys[x.v]) throw errCode('no-key');
    return { pv: x.pv, bytes: await Crypto.open(FB.keys[x.v], x, 'photo:' + id) };
  },
  /* set (bytes) or remove (null) a case's photo; returns the new version id ('' when removed) */
  async setPhoto(id, bytes, action) {
    const pv = bytes ? uid8() : '';
    await FB.mutateCase(id, d => { if (!bytes && !d.photo) return 'skip'; d.photo = pv; }, action || { a: 'photo', how: bytes ? 'add' : 'remove' },
      async tx => { const ref = FB.db.doc('photos/' + id); if (bytes) tx.set(ref, await FB.photoBox(id, bytes, pv)); else tx.delete(ref); });
    return pv;
  },
  /* every saved version of one case, newest first (the copy each write replaced, plus the current one) */
  async caseVersions(id) {
    const snap = await FB.db.collection('log').where('caseId', '==', id).get();
    const out = [];
    for (const d of snap.docs) {
      const x = d.data(); if (!x.prev) continue;
      let who = null; try { who = await Crypto.openJSON(FB.keys[x.v], x, 'log:' + d.id); } catch (e) { }
      let data = null; try { data = await Crypto.openJSON(FB.keys[x.prev.v], x.prev, 'case:' + id); } catch (e) { }
      out.push({ rev: x.rev - 1, replacedAt: FB.tsMs(x.at), replacedBy: x.sid, replacedHow: who && who.a, data });
    }
    return out.sort((a, b) => b.rev - a.rev);
  },
  async restoreVersion(id, data) {
    const keep = FB.clean(data);
    return FB.mutateCase(id, d => { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, keep); }, { a: 'restore' });
  },
  /* cases deleted in the last N days, recovered from their history entry. Deletes are marked (del) since the rules of 4 Oct
     2026: only those entries are read — plus, until that's N days ago, every entry from before the marks began (markedFrom:
     when the office was indexed), as before */
  async deletedCases(days, markedFrom) {
    const from = Date.now() - days * 86400000, T = ms => firebase.firestore.Timestamp.fromMillis(ms);
    const docs = new Map(), add = s => s.docs.forEach(d => docs.set(d.id, d));
    if (FB.idxOn && markedFrom) {
      add(await FB.db.collection('log').where('del', '==', true).get());
      if (markedFrom > from) add(await FB.db.collection('log').where('at', '>=', T(from)).where('at', '<', T(markedFrom)).get());
    } else add(await FB.db.collection('log').where('at', '>=', T(from)).get());
    const out = [];
    for (const d of docs.values()) {
      const x = d.data(); if (!x.prev || (FB.tsMs(x.at) || 0) < from) continue;
      let act = null; try { act = await Crypto.openJSON(FB.keys[x.v], x, 'log:' + d.id); } catch (e) { continue; }
      if (!act || act.a !== 'delete') continue;
      const still = await FB.db.doc('cases/' + x.caseId).get(); if (still.exists) continue;
      try { out.push({ caseId: x.caseId, at: FB.tsMs(x.at), sid: x.sid, data: await Crypto.openJSON(FB.keys[x.prev.v], x.prev, 'case:' + x.caseId) }); } catch (e) { }
    }
    // one brought back already (it comes back under a new id) isn't offered again: same patient, type and creation time
    if (FB.idxOn && out.length) {
      try {
        const keys = Array.from(new Set(out.map(x => normName(x.data.patient)).filter(Boolean).map(n => 'n:' + n)));
        const here = new Set((await FB.loadPatients(keys)).map(caseSig).filter(Boolean));
        return out.filter(x => !here.has(caseSig(x.data))).sort((a, b) => b.at - a.at);
      } catch (e) { }
    }
    return out.sort((a, b) => b.at - a.at);
  },
  // (a restored case comes back as a new case; its photo was removed with it)
  async undelete(item) { const data = Object.assign({}, item.data); delete data.photo; return FB.createCases([{ data, status: 'open', action: { a: 'restore' } }]); },
  async saveSettings(patch) { await FB.track(FB.db.doc('meta/settings').set(patch, { merge: true })); },

  /* ---------- backups (owner; Amir, 4 Oct 2026: "how can this app back it self up?") ----------
     Every case as it is now (open and completed), its photo, the team list, the settings and the recovery box — all exactly
     as stored, so the file is no more readable than the database: it opens with this office's key, or with the recovery
     code that was current when it was made. Earlier versions stay in the database (and in Google's daily backups). */
  async backupDump() {
    const ms = t => FB.tsMs(t) || null;
    const [cs, ps, rs, st, ks, rc] = await Promise.all([FB.db.collection('cases').get(), FB.db.collection('photos').get(), FB.db.collection('roster').get(),
      FB.db.doc('meta/settings').get(), FB.db.doc('meta/keys').get(), FB.db.doc('meta/recovery').get()]);
    return {
      cases: cs.docs.map(d => { const x = d.data(); return { id: d.id, v: x.v, iv: x.iv, ct: x.ct, status: x.status, rev: x.rev, sid: x.sid || '', createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt), closedAt: ms(x.closedAt) }; }),
      photos: ps.docs.map(d => { const x = d.data(); return { id: d.id, v: x.v, iv: x.iv, ct: x.ct, pv: x.pv }; }).filter(p => p.ct),
      roster: rs.docs.map(d => Object.assign({ sid: d.id }, d.data())),
      settings: st.exists ? st.data() : {}, keys: ks.exists ? ks.data() : {}, recovery: rc.exists ? rc.data() : null
    };
  },
  /* a backup's cases and photos, opened: with this office's keys, or (one from another office — rebuilt after a loss) with the
     recovery code that was current when it was made. code missing when it's needed: errCode('backup-needs-code') */
  async backupOpen(file, code) {
    const list = file.cases || [], first = list.find(x => x && x.ct);
    const opens = async ks => { if (!first) return true; try { await Crypto.openJSON(ks[first.v], first, 'case:' + first.id); return true; } catch (e) { return false; } };
    let keys = FB.keys, foreign = false;
    if (first && !(FB.keys[first.v] && await opens(FB.keys))) {
      if (!file.recovery || !file.recovery.priv) throw errCode('backup-no-key');
      if (!code) throw errCode('backup-needs-code');
      try {
        const rpriv = await Crypto.importPriv(await Crypto.pwOpen(normCode(code), file.recovery.priv, 'recovery-priv'));
        keys = await Crypto.ringKeys(Crypto.ringFrom(await Crypto.openFrom(rpriv, file.recovery.ring, 'ring:recovery')));
      } catch (e) { throw errCode('bad-code'); }
      if (!(await opens(keys))) throw errCode('bad-code');
      foreign = true;
    }
    const cases = [], photos = new Map();
    for (const x of list) {
      try { cases.push({ id: x.id, status: x.status === 'done' ? 'done' : 'open', closedAt: x.closedAt || null, data: await Crypto.openJSON(keys[x.v], x, 'case:' + x.id) }); }
      catch (e) { cases.push({ id: x.id, locked: true }); }
    }
    for (const p of file.photos || []) { try { photos.set(p.id, await Crypto.open(keys[p.v], p, 'photo:' + p.id)); } catch (e) { } }
    return { cases, photos, foreign };
  },

  /* ---------- team (owner) ---------- */
  async issue(o, extra) { // o.rid: the person's id in Staff Hub's office roster, when added from it
    const email = o.username + '.' + o.gen + '@' + STAFF_DOMAIN;
    const temp = tempPassword();
    const sec = firebase.initializeApp(FB.cfg, 'issue' + Date.now());
    let newUid;
    try {
      const sa = sec.auth();
      if (FB.emu) sa.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      try { await sa.setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) { }
      const c = await sa.createUserWithEmailAndPassword(email, temp); newUid = c.user.uid;
      await sa.signOut();
    } finally { try { await sec.delete(); } catch (e) { } }
    const boot = await Crypto.pwSeal(temp, Crypto.ringBytes(FB.ring), 'boot:' + newUid);
    const b = FB.db.batch();
    b.set(FB.db.doc('members/' + newUid), { staffId: o.sid, username: o.username, name: o.name, role: 'staff', active: true, mustSetup: true, boot, ringV: FB.curV, gen: o.gen, createdAt: FB.ts() });
    // (a reissued login keeps the person's staff photo and Staff Hub link — they used to be cleared here, 5 Oct 2026)
    b.set(FB.db.doc('roster/' + o.sid), Object.assign({ name: o.name, initials: initials(o.name), role: 'staff', active: true, username: o.username, gen: o.gen }, o.rid ? { rid: o.rid } : {},
      o.photo ? { photo: o.photo, photoSrc: o.photoSrc || '' } : {}));
    b.set(FB.db.doc('logins/' + o.username), { email });
    if (extra) extra(b);
    await FB.track(b.commit());
    return { temp, username: o.username };
  },
  async addStaff(name, username, rid) {
    username = slug(username);
    if (!/^[a-z0-9][a-z0-9.\-]{1,29}$/.test(username)) throw errCode('bad-username');
    const [lg, rs] = await Promise.all([FB.db.doc('logins/' + username).get(), FB.db.doc('roster/' + username).get()]);
    if (lg.exists || (rs.exists && rs.data().active)) throw errCode('taken');
    const gen = (rs.exists ? (rs.data().gen || 0) : 0) + 1;
    return FB.issue({ sid: username, name: name.trim(), username, gen, rid: rid || '' });
  },
  /* owner: a staff photo from Staff Hub (a small data: URL, not patient data) on the person's roster entry; '' removes it */
  async setStaffPhoto(sid, photo, src) {
    await FB.track(FB.db.doc('roster/' + sid).update(photo ? { photo, photoSrc: src } : { photo: FB.del(), photoSrc: FB.del() }));
  },
  async reissue(sid) {
    const rs = (await FB.db.doc('roster/' + sid).get()).data();
    const olds = (await FB.db.collection('members').where('staffId', '==', sid).get()).docs.filter(d => d.data().active);
    return FB.issue({ sid, name: rs.name, username: rs.username || sid, gen: (rs.gen || 1) + 1, rid: rs.rid || '', photo: rs.photo || '', photoSrc: rs.photoSrc || '' }, b => olds.forEach(d => b.update(d.ref, { active: false })));
  },
  async removeStaff(sid) {
    const rs = (await FB.db.doc('roster/' + sid).get()).data();
    const olds = (await FB.db.collection('members').where('staffId', '==', sid).get()).docs;
    const b = FB.db.batch();
    olds.forEach(d => { if (d.data().active) b.update(d.ref, { active: false }); });
    b.update(FB.db.doc('roster/' + sid), { active: false });
    if (rs.username) b.delete(FB.db.doc('logins/' + rs.username));
    await FB.track(b.commit());
  },
  /* new office key; everyone still active gets it; every case is re-sealed under it */
  async rotate(progress) {
    const newV = FB.curV + 1;
    const ring2 = Object.assign({}, FB.ring, { [newV]: Crypto.newRingKey() });
    const ms = await FB.db.collection('members').get();
    const b = FB.db.batch(); let pendingInvites = 0; const badKeys = [];
    for (const d of ms.docs) {
      const m = d.data(); if (!m.active) continue;
      if (m.pub && m.ring) {
        try { b.update(d.ref, { ring: await Crypto.sealTo(m.pub, Crypto.ringBytes(ring2), 'ring:' + d.id), ringV: newV }); }
        catch (e) { badKeys.push(m.name || m.staffId); }
      } else pendingInvites++;
    }
    const rec = (await FB.db.doc('meta/recovery').get()).data();
    b.update(FB.db.doc('meta/recovery'), { ring: await Crypto.sealTo(rec.pub, Crypto.ringBytes(ring2), 'ring:recovery'), ringV: newV });
    await FB.track(b.commit());
    await FB.track(FB.db.doc('meta/keys').update({ current: newV }));
    FB.ring = ring2; FB.keys = await Crypto.ringKeys(ring2); FB.curV = newV; FB.ringV = newV;
    const all = (await FB.db.collection('cases').get()).docs.filter(d => d.data().v < newV);
    // patient photos are re-sealed too (same picture, same version id); one whose case is gone is removed
    const pics = (await FB.db.collection('photos').get()).docs.filter(d => d.data().v < newV);
    const total = all.length + pics.length;
    let n = 0, failed = 0;
    for (let i = 0; i < all.length; i += 15) {
      await Promise.all(all.slice(i, i + 15).map(d => FB.mutateCase(d.id, () => { }, { a: 'rekey' }).catch(() => { failed++; })));
      n += Math.min(15, all.length - i); if (progress) progress(n, total);
    }
    for (let i = 0; i < pics.length; i += 15) {
      await Promise.all(pics.slice(i, i + 15).map(async d => {
        try {
          const x = d.data(), bytes = await Crypto.open(FB.keys[x.v], x, 'photo:' + d.id), box = await Crypto.seal(FB.keys[newV], bytes, 'photo:' + d.id);
          if (!(await FB.db.doc('cases/' + d.id).get()).exists) { await d.ref.delete(); return; }
          await FB.track(d.ref.update({ v: newV, iv: box.iv, ct: box.ct, at: FB.ts(), by: FB.uid }));
        } catch (e) { failed++; }
      }));
      n += Math.min(15, pics.length - i); if (progress) progress(n, total);
    }
    if (failed) throw errCode('rekey-partial', failed + ' case(s) or photo(s) could not be re-sealed yet');
    return { cases: all.length, photos: pics.length, pendingInvites, badKeys };
  }
};
