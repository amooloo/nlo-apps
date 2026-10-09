/* =====================================================================
   Firebase backend. Sign-in is NLO Cases' (same people, same passwords).

   Keys:
   - the office key (NLO Cases' key ring, everyone has it): who's out
     (names, dates, morning/afternoon — never why) and the feed's key;
   - each person's own key pair (their login): their copy of their own
     requests and of their HR record;
   - the HR key (only Dr. A and the people who approve): a key ring of
     its own (like A/R's), plus a key pair whose public half everyone
     seals new requests to (meta/toKeys.pub) and whose private half is
     kept sealed with the ring (toDrop/<version>).
   Plain fields in the database: whose a request is (staff id), its
   status and revision, the day it starts — never its kind, its notes or
   anyone's hours.
   ===================================================================== */
const FB = {
  emu: false, app: null, auth: null, db: null, cfg: null,
  uid: null, me: null, priv: null, ring: null, keys: null, curV: 0, ringV: 0, lastCode: '',
  hr: null,            // the HR key, for Dr. A and the people who approve: { ring, keys, curV, ringV, drop: Map(v → private key) }
  hrV: 0, hrPub: null, // the HR key's current version and public half (everyone seals new requests to it)
  feedKey: null,       // the who's-out feed's key (opened with the office key)
  rotating: false, resealing: false,
  unsubs: [], pending: 0, onSync: null, people: new Map(), queues: {},

  ts() { return firebase.firestore.FieldValue.serverTimestamp(); },
  del() { return firebase.firestore.FieldValue.delete(); },
  tsMs(t) { return t && t.toMillis ? t.toMillis() : (t || null); },
  isOwner() { return !!(FB.me && FB.me.role === 'owner'); },
  isPerm(e) { return /permission/i.test((e && (e.code || e.message)) || ''); },
  doc(p) { return FB.db.doc(p); },

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
    const snap = await FB.doc('logins/' + un).get();
    if (!snap.exists) throw errCode('no-user');
    return snap.data().email;
  },
  async signIn(login, pw) {
    const email = await FB.emailFor(login);
    const cred = await FB.auth.signInWithEmailAndPassword(email, pw);
    FB.uid = cred.user.uid;
    const ms = await FB.doc('members/' + FB.uid).get();
    if (!ms.exists) { await FB.signOut(); throw errCode('not-member'); }
    const m = ms.data();
    if (!m.active) { await FB.signOut(); throw errCode('inactive'); }
    FB.me = Object.assign({ uid: FB.uid, email: cred.user.email || '' }, m);
    if (m.mustSetup) {
      if (m.priv) { try { await FB.unlockWith(pw, m); await FB.doc('members/' + FB.uid).update({ mustSetup: false, boot: FB.del(), lastLogin: FB.ts() }); return { state: 'ok' }; } catch (e) { } }
      return { state: 'first' };
    }
    try { await FB.unlockWith(pw, m); }
    catch (e) { return { state: m.role === 'owner' ? 'recover' : e.code === 'key-mismatch' ? 'keymismatch' : 'broken' }; }
    FB.doc('members/' + FB.uid).update({ lastLogin: FB.ts() }).catch(() => { });
    return { state: 'ok' };
  },
  async unlockWith(pw, m) {
    let bytes;
    try { bytes = await Crypto.pwOpen(pw, m.priv, 'priv:' + FB.uid); }
    catch (e) { if (!m.privPrev) throw e; bytes = await Crypto.pwOpen(pw, m.privPrev, 'priv:' + FB.uid); }
    // the key the login's record names must be the one its password opens: NLO Cases never changes it in place, so a
    // record whose key was swapped (not reissued) stops here — nothing is sealed to it from this page
    let own = null; try { own = await Crypto.pubOfPriv(bytes); } catch (e) { } // a browser that can't say skips the check, never locks anyone out
    if (own && (!m.pub || own.x !== m.pub.x || own.y !== m.pub.y)) { FB.priv = null; throw errCode('key-mismatch'); }
    FB.priv = await Crypto.importPriv(bytes);
    await FB.loadRing(m);
  },
  async loadRing(m) {
    const ring = Crypto.ringFrom(await Crypto.openFrom(FB.priv, m.ring, 'ring:' + FB.uid));
    FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.ringV = m.ringV || 0;
    const k = await FB.doc('meta/keys').get();
    FB.curV = k.exists ? k.data().current : 1;
  },
  async firstSetup(tempPw, newPw) {
    const m = FB.me, uid = FB.uid;
    let ring;
    try { ring = Crypto.ringFrom(await Crypto.pwOpen(tempPw, m.boot, 'boot:' + uid)); }
    catch (e) { throw errCode('boot-failed'); }
    const cur = (await FB.doc('meta/keys').get()).data().current;
    if (!ring[cur]) throw errCode('boot-stale');
    const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), pbytes = await Crypto.privBytes(pair);
    const priv = await Crypto.pwSeal(newPw, pbytes, 'priv:' + uid);
    const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
    await FB.doc('members/' + uid).update({ pub, priv, ring: ringBox, ringV: cur });
    await FB.auth.currentUser.updatePassword(newPw);
    await FB.doc('members/' + uid).update({ mustSetup: false, boot: FB.del(), lastLogin: FB.ts() });
    FB.priv = await Crypto.importPriv(pbytes); FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.curV = cur; FB.ringV = cur;
    FB.me = Object.assign({}, FB.me, { mustSetup: false, pub });
  },
  async recover(pw, code) {
    const uid = FB.uid, r = (await FB.doc('meta/recovery').get()).data();
    let ring;
    try {
      const rpriv = await Crypto.importPriv(await Crypto.pwOpen(recoveryCodeNorm(code), r.priv, 'recovery-priv'));
      ring = Crypto.ringFrom(await Crypto.openFrom(rpriv, r.ring, 'ring:recovery'));
    } catch (e) { throw errCode('bad-code'); }
    const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), pbytes = await Crypto.privBytes(pair);
    const priv = await Crypto.pwSeal(pw, pbytes, 'priv:' + uid);
    const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
    const v = Math.max.apply(null, Object.keys(ring).map(Number));
    await FB.doc('members/' + uid).update({ pub, priv, privPrev: FB.del(), ring: ringBox, ringV: v, lastLogin: FB.ts() });
    FB.priv = await Crypto.importPriv(pbytes); FB.ring = ring; FB.keys = await Crypto.ringKeys(ring); FB.ringV = v;
    FB.curV = (await FB.doc('meta/keys').get()).data().current;
    FB.me = Object.assign({}, FB.me, { pub }); FB.lastCode = code;
  },
  async sendReset(email) { await FB.auth.sendPasswordResetEmail(email); },
  async changePassword(cur, next) {
    const u = FB.auth.currentUser;
    await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, cur));
    const m = (await FB.doc('members/' + FB.uid).get()).data();
    let bytes;
    try { bytes = await Crypto.pwOpen(cur, m.priv, 'priv:' + FB.uid); }
    catch (e) { bytes = await Crypto.pwOpen(cur, m.privPrev, 'priv:' + FB.uid); }
    const priv = await Crypto.pwSeal(next, bytes, 'priv:' + FB.uid), privPrev = await Crypto.pwSeal(cur, bytes, 'priv:' + FB.uid);
    await FB.doc('members/' + FB.uid).update({ priv, privPrev });
    await u.updatePassword(next);
    await FB.doc('members/' + FB.uid).update({ privPrev: FB.del() });
  },
  async signOut() {
    FB.stop();
    FB.priv = FB.ring = FB.keys = FB.me = FB.uid = FB.hr = FB.hrPub = FB.feedKey = FB.h = null; FB.curV = FB.ringV = FB.hrV = 0; FB.lastCode = '';
    FB.people = new Map(); FB.queues = {}; FB.lockedRaw = new Map(); FB.keyChangedNames = []; FB.impKey = null; FB.settingsCache = null; FB.reqChain = Promise.resolve(); FB.perkRaw = new Map();
    try { await FB.auth.signOut(); } catch (e) { }
  },
  stop() { FB.unsubs.forEach(u => { try { u(); } catch (e) { } }); FB.unsubs = []; },
  officeKey() { const k = FB.keys && FB.keys[FB.curV]; if (!k) throw errCode('no-key'); return k; },

  /* =====================================================================
     Opening Time Off → 'hr' (Dr. A, or someone who approves) | 'staff' |
     'setup' (Dr. A: not set up yet) | 'notyet' (staff: not set up yet) |
     'stale' (my copy of the HR key can't be opened) | 'rules' (the
     database's rules don't know Time Off yet)
     ===================================================================== */
  async toOpen() {
    try { await FB.doc('meta/rules_to_2').get(); } catch (e) { if (FB.isPerm(e)) return 'rules'; throw e; }
    const [k, g, st] = await Promise.all([FB.doc('meta/toKeys').get(), FB.doc('toAccess/' + FB.uid).get(), FB.doc('meta/settings').get()]);
    FB.settingsCache = st.exists ? st.data() : {}; // the logins whose key changed (see trusted) are known from the start
    if (!k.exists) return FB.isOwner() ? 'setup' : 'notyet';
    FB.hrV = k.data().current; FB.hrPub = k.data().pub;
    FB.registerMe().catch(() => { });
    FB.openFeedKey().catch(() => { });
    if (!g.exists) return FB.isOwner() ? 'stale' : 'staff';
    try { await FB.hrLoad(g.data()); } catch (e) { return 'stale'; }
    return 'hr';
  },
  /* the HR key, opened — built whole and only then put in place, so nothing is ever opened against a half-loaded key
     (a version's private half never changes once it's there, so the ones already loaded are kept) */
  async hrLoad(grant) {
    const ring = Crypto.ringFrom(await Crypto.openFrom(FB.priv, grant.ring, 'toring:' + FB.uid));
    let cur = FB.hrV; if (!ring[cur]) cur = Math.max.apply(null, Object.keys(ring).map(Number));
    const keys = await Crypto.ringKeys(ring), drop = new Map(FB.hr ? FB.hr.drop : []);
    await FB.loadDrops(keys, drop);
    FB.hr = { ring, keys, curV: cur, ringV: grant.ringV || 0, drop };
  },
  /* the HR key pair's private halves, one per version, sealed with the HR ring */
  async loadDrops(keys, drop) {
    keys = keys || FB.hr.keys; drop = drop || FB.hr.drop;
    const snap = await FB.db.collection('toDrop').get();
    for (const d of snap.docs) {
      const x = d.data(), key = keys[x.v]; if (!key || drop.has(x.v)) continue;
      try { drop.set(x.v, await Crypto.importPriv(await Crypto.open(key, x, 'todrop:' + x.v))); } catch (e) { }
    }
  },
  /* the HR key again (it may have changed); anything this login couldn't open is tried again */
  async hrReload() {
    const g = await FB.doc('toAccess/' + FB.uid).get(); if (!g.exists) throw errCode('permission-denied');
    await FB.hrLoad(g.data());
    if (FB.h) FB.reopenLocked(FB.h).catch(() => { });
  },
  /* my public key where the people who approve can seal my copies to it */
  async registerMe() {
    if (!FB.me || !FB.me.pub || !FB.me.staffId) return;
    const ref = FB.doc('toPeople/' + FB.me.staffId), s = await ref.get();
    if (s.exists && s.data().uid === FB.uid && s.data().pub && s.data().pub.x === FB.me.pub.x) return;
    await ref.set({ pub: { kty: FB.me.pub.kty, crv: FB.me.pub.crv, x: FB.me.pub.x, y: FB.me.pub.y }, uid: FB.uid, at: FB.ts() });
  },
  /* the feed's key (sealed with the office key) */
  async openFeedKey() {
    if (FB.feedKey) return FB.feedKey;
    const s = await FB.doc('meta/toFeedKey').get(); if (!s.exists) return null;
    const x = s.data(), k = FB.keys[x.v]; if (!k) return null;
    const o = JSON.parse(TD.decode(await Crypto.open(k, x, 'tofeedkey')));
    FB.feedKey = { b64: o.key, key: await Crypto.rawKey(o.key) };
    return FB.feedKey;
  },
  async grantDoc(uid, pub, sid, ring, v) {
    return { ring: await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'toring:' + uid), ringV: v, pubX: pub.x, sid, by: FB.uid, at: FB.ts() };
  },
  async escrowDoc(ring, v) {
    const r = await FB.doc('meta/recovery').get(); if (!r.exists || !r.data().pub) return null;
    const pub = r.data().pub;
    return { ring: await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'toring:recovery'), ringV: v, recX: pub.x, by: FB.uid, at: FB.ts() };
  },
  async newDrop(ringKeys, v) {
    const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), bytes = await Crypto.privBytes(pair);
    const box = await Crypto.seal(ringKeys[v], bytes, 'todrop:' + v);
    return { pub, priv: await Crypto.importPriv(bytes), doc: { v, iv: box.iv, ct: box.ct } };
  },
  /* Dr. A, once: the HR key, its first key pair, his own copy, the recovery copy, who approves, the feed's key */
  async toSetup() {
    if (!FB.isOwner()) throw errCode('permission');
    const ring = { '1': Crypto.newRingKey() }, keys = await Crypto.ringKeys(ring), drop = await FB.newDrop(keys, 1);
    const feed = Crypto.newRingKey(), fbox = await Crypto.seal(FB.officeKey(), TE.encode(JSON.stringify({ key: feed })), 'tofeedkey');
    const b = FB.db.batch();
    b.set(FB.doc('meta/toKeys'), { current: 1, pub: drop.pub });
    b.set(FB.doc('toDrop/1'), drop.doc);
    b.set(FB.doc('toAccess/' + FB.uid), await FB.grantDoc(FB.uid, FB.me.pub, FB.me.staffId, ring, 1));
    const esc = await FB.escrowDoc(ring, 1); if (esc) b.set(FB.doc('meta/toEscrow'), esc);
    b.set(FB.doc('meta/toTeam'), { sids: [FB.me.staffId], at: FB.ts() });
    b.set(FB.doc('meta/toFeedKey'), { v: FB.curV, iv: fbox.iv, ct: fbox.ct, at: FB.ts() });
    b.set(FB.doc('meta/toMail'), { scrubs: SCRUBS.to, at: FB.ts() }); // scrubs orders go to community@ unless Dr. A changes it
    await FB.track(b.commit());
    FB.hr = { ring, keys, curV: 1, ringV: 1, drop: new Map([[1, drop.priv]]) }; FB.hrV = 1; FB.hrPub = drop.pub;
    FB.feedKey = { b64: feed, key: await Crypto.rawKey(feed) };
    FB.registerMe().catch(() => { });
  },
  /* Dr. A: my copy can't be opened (new password via the recovery code) → open the recovery copy with the code */
  async hrRestore(code) {
    const [r, e] = await Promise.all([FB.doc('meta/recovery').get(), FB.doc('meta/toEscrow').get()]);
    if (!e.exists) throw errCode('no-escrow');
    let ring;
    try {
      const rpriv = await Crypto.importPriv(await Crypto.pwOpen(recoveryCodeNorm(code), r.data().priv, 'recovery-priv'));
      ring = Crypto.ringFrom(await Crypto.openFrom(rpriv, e.data().ring, 'toring:recovery'));
    } catch (x) { throw errCode('bad-code'); }
    const v = Math.max.apply(null, Object.keys(ring).map(Number));
    await FB.track(FB.doc('toAccess/' + FB.uid).set(await FB.grantDoc(FB.uid, FB.me.pub, FB.me.staffId, ring, v)));
    const keys = await Crypto.ringKeys(ring), drop = new Map();
    await FB.loadDrops(keys, drop);
    FB.hr = { ring, keys, curV: FB.hrV || v, ringV: v, drop };
  },
  /* Dr. A: everyone, who has the HR key, and whether the recovery copy is current */
  async hrPeople() {
    const [gs, ms, esc, rec] = await Promise.all([FB.db.collection('toAccess').get(), FB.db.collection('members').get(), FB.doc('meta/toEscrow').get(), FB.doc('meta/recovery').get()]);
    return {
      grants: gs.docs.map(d => Object.assign({ uid: d.id }, d.data())),
      members: ms.docs.map(d => Object.assign({ uid: d.id }, d.data())),
      hasRecovery: rec.exists && !!(rec.data().pub),
      escrowOk: esc.exists && rec.exists && esc.data().recX === (rec.data().pub || {}).x && esc.data().ringV === FB.hr.curV
    };
  },
  async writeTeam(grants) { await FB.track(FB.doc('meta/toTeam').set({ sids: Array.from(new Set(grants.map(g => g.sid).filter(Boolean))), at: FB.ts() })); },
  /* one change to who holds the HR key at a time, across Dr. A's screens and devices */
  withKeyLock(fn) {
    const run = () => FB._withKeyLock(fn), p = (FB.keyQueue || Promise.resolve()).then(run, run);
    FB.keyQueue = p.catch(() => { });
    return p;
  },
  async _withKeyLock(fn) {
    const ref = FB.doc('meta/toKeyLock'), me = FB.uid + ':' + uid8();
    await FB.track(FB.db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (s.exists) { const at = FB.tsMs(s.data().at); if (at && Date.now() - at < 10 * 60000) throw errCode('busy', 'The HR key is being changed on another screen. Try again in a minute.'); }
      tx.set(ref, { by: me, at: FB.ts() });
    }));
    FB.rotating = true;
    try { await FB.hrReload(); return await fn(); }
    finally { FB.rotating = false; try { const s = await ref.get(); if (s.exists && s.data().by === me) await ref.delete(); } catch (e) { } }
  },
  async hrGrant(m) {
    if (!m.pub || !m.active) throw errCode('no-pub', (m.name || 'They') + ' needs to sign in once (and choose a password) first.');
    const to = await FB.settingsTo(), flags = to.keyFlags || {}, seen = to.seenKeys || {};
    if (flags[m.uid] || (seen[m.uid] && seen[m.uid] !== m.pub.x)) throw errCode('bad', (m.name || 'This login') + '’s key changed without a reissue. Reissue the login in NLO Cases first (Team & security), then turn approving on for the new login.');
    await FB.withKeyLock(async () => {
      await FB.track(FB.doc('toAccess/' + m.uid).set(await FB.grantDoc(m.uid, m.pub, m.staffId, FB.hr.ring, FB.hr.curV)));
      const p = await FB.hrPeople(); await FB.writeTeam(p.grants);
    });
  },
  /* the key each login held when first seen here, and logins whose key changed in place since (Dr. A's own record, in
     the office settings only he writes). NLO Cases never changes a staff login's key in place — a reissue makes a new
     login — so nothing new is sealed to a key that did. */
  async settingsTo() { const st = await FB.doc('meta/settings').get(); const t = st.exists && st.data().to; return t && typeof t === 'object' ? t : {}; },
  async keyFlags() { const f = (await FB.settingsTo()).keyFlags; return f && typeof f === 'object' ? f : {}; },
  async flagKeys(uids) {
    if (!uids.length) return; const f = {}; uids.forEach(u => { f[u] = Date.now(); });
    await FB.saveSettings({ to: { keyFlags: f } });
    FB.mergeCache('keyFlags', f);
  },
  mergeCache(k, add) { const c = FB.settingsCache || {}, to = c.to || {}; FB.settingsCache = Object.assign({}, c, { to: Object.assign({}, to, { [k]: Object.assign({}, to[k] || {}, add) }) }); },
  /* the key to seal someone's own copies to: theirs as published, unless their login's key changed in place */
  trustedPub(sid) {
    if (FB.me && sid === FB.me.staffId) return FB.me.pub || null;
    const p = FB.people.get(sid); return FB.trusted(p);
  },
  trusted(p) {
    if (!p || !p.pub || !p.pub.x) return null;
    const to = (FB.settingsCache && FB.settingsCache.to) || {}, flags = to.keyFlags || {}, seen = to.seenKeys || {};
    if (flags[p.uid] || (seen[p.uid] && seen[p.uid] !== p.pub.x)) return null;
    return p.pub;
  },
  /* Dr. A's upkeep: note the key of each login seen for the first time; mark a login whose key changed in place (his
     own excepted — a recovery with his code gives him a new key, and he's the one holding it). Returns the names marked. */
  async checkKeys() {
    if (!FB.isOwner()) return [];
    const [ms, to] = await Promise.all([FB.db.collection('members').get(), FB.settingsTo()]);
    const seen = to.seenKeys || {}, flags = to.keyFlags || {}, add = {}, changed = [];
    for (const d of ms.docs) {
      const m = d.data(); if (!m.active || !m.pub || !m.pub.x) continue;
      const x = seen[d.id];
      if (d.id === FB.uid) { if (x !== m.pub.x && FB.me && FB.me.pub && m.pub.x === FB.me.pub.x) add[d.id] = m.pub.x; continue; }
      if (!x) add[d.id] = m.pub.x;
      else if (x !== m.pub.x && !flags[d.id]) changed.push({ uid: d.id, name: m.name || m.staffId || d.id });
    }
    if (Object.keys(add).length) { await FB.saveSettings({ to: { seenKeys: add } }); FB.mergeCache('seenKeys', add); }
    if (changed.length) await FB.flagKeys(changed.map(c => c.uid));
    return changed.map(c => c.name);
  },
  /* a moved request's id: the same for the same old request every time — so a move that stopped half-way and is run
     again never makes one twice — and keyed with the HR key, so it says nothing about the request */
  async importReqId(lid) {
    if (!FB.hr) throw errCode('no-key');
    if (!FB.impKey) {
      const v = Math.min.apply(null, Object.keys(FB.hr.ring).map(Number));
      const base = await crypto.subtle.importKey('raw', unb64(FB.hr.ring[v]), 'HKDF', false, ['deriveKey']);
      FB.impKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode('toimport-id') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    }
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', FB.impKey, TE.encode('toimport:' + lid)));
    return 'q' + Array.from(sig.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
  },
  async hrRevoke(uid, progress) {
    await FB.withKeyLock(async () => { await FB.track(FB.doc('toAccess/' + uid).delete()); await FB.newKey(); });
    return FB.hrReseal(progress);
  },
  async hrRotate(progress) { await FB.withKeyLock(() => FB.newKey()); return FB.hrReseal(progress); },
  /* (inside the lock) the next HR key: a new ring version for everyone still allowed and the recovery copy, then — in one
     write — its key pair's private half and the switch. Until that last write nothing uses the new version, and a retry
     simply makes it again (the private half of a version is never replaced once it's there). */
  async newKey() {
    const newV = FB.hr.curV + 1, ring2 = Object.assign({}, FB.hr.ring, { [newV]: Crypto.newRingKey() }), keys2 = await Crypto.ringKeys(ring2);
    const drop = await FB.newDrop(keys2, newV);
    const p = await FB.hrPeople(), mem = new Map(p.members.map(m => [m.uid, m])), writes = [], keep = [], changed = [];
    for (const g of p.grants) {
      const m = mem.get(g.uid);
      if (!m || !m.active || !m.pub) { writes.push(b => b.delete(FB.doc('toAccess/' + g.uid))); continue; }
      // a key that changed in place since the copy was made: no new copy (see hrFixGrants)
      if (g.uid !== FB.uid && g.pubX && g.pubX !== m.pub.x) { writes.push(b => b.delete(FB.doc('toAccess/' + g.uid))); changed.push(g.uid); FB.keyChangedNames = (FB.keyChangedNames || []).concat([m.name || g.sid]); continue; }
      const gd = await FB.grantDoc(g.uid, m.pub, m.staffId, ring2, newV);
      writes.push(b => b.set(FB.doc('toAccess/' + g.uid), gd)); keep.push(m.staffId);
    }
    await FB.flagKeys(changed); // marked first: a copy deleted but not marked could be given again
    for (let i = 0; i < writes.length; i += 5) { const b = FB.db.batch(); writes.slice(i, i + 5).forEach(w => w(b)); await FB.track(b.commit()); }
    const b2 = FB.db.batch(), esc = await FB.escrowDoc(ring2, newV);
    if (esc) b2.set(FB.doc('meta/toEscrow'), esc);
    b2.set(FB.doc('meta/toTeam'), { sids: Array.from(new Set(keep)), at: FB.ts() });
    await FB.track(b2.commit());
    const b3 = FB.db.batch();
    b3.set(FB.doc('toDrop/' + newV), drop.doc);
    b3.update(FB.doc('meta/toKeys'), { current: newV, pub: drop.pub });
    await FB.track(b3.commit());
    const dropMap = new Map(FB.hr.drop); dropMap.set(newV, drop.priv);
    FB.hr = { ring: ring2, keys: keys2, curV: newV, ringV: newV, drop: dropMap }; FB.hrV = newV; FB.hrPub = drop.pub;
  },
  /* Dr. A: everything still under an older HR key, sealed again with the newest one */
  async hrReseal(progress) {
    if (FB.resealing) return { reqs: 0, recs: 0, failed: 0 };
    FB.resealing = true;
    try {
      const v = FB.hr.curV;
      const reqs = (await FB.db.collection('toReq').get()).docs.filter(d => d.data().v < v);
      const recs = (await FB.db.collection('toHR').get()).docs.filter(d => d.data().v < v);
      let perks = []; try { perks = (await FB.db.collection('toPerk').get()).docs.filter(d => d.data().v < v); } catch (e) { if (!FB.isPerm(e)) throw e; } // rules from before scrubs: nothing to do there
      const total = reqs.length + recs.length + perks.length; let n = 0, failed = 0;
      for (const d of reqs) { try { await FB.saveReq(d.id, () => { }, { a: 'rekey' }); } catch (e) { failed++; } if (progress) progress(++n, total); }
      for (const d of perks) { try { await FB.savePerk(d.id, () => { }, { a: 'rekey' }); } catch (e) { failed++; } if (progress) progress(++n, total); }
      for (const d of recs) { try { await FB.putHR(d.id, () => { }, 'rekey', { mine: false }); } catch (e) { failed++; } if (progress) progress(++n, total); }
      return { reqs: reqs.length, recs: recs.length, failed };
    } finally { FB.resealing = false; }
  },
  /* Dr. A's upkeep: logins reissued or turned off since (their HR key copy goes and a new key is made), the recovery copy,
     and copies left behind by a key change. A login whose key changed in place never happens in NLO Cases (a reissue makes
     a new login), so that copy is taken away too — it's never sealed again to whatever key is on the login now. */
  async hrFixGrants() {
    const out = { removed: [], relogin: [], resealed: [], keyChanged: [] }; let removed = false;
    await FB.withKeyLock(async () => {
      const p = await FB.hrPeople(), mem = new Map(p.members.map(m => [m.uid, m]));
      for (const g of p.grants) {
        const m = mem.get(g.uid);
        if (m && m.active && g.uid !== FB.uid && m.pub && g.pubX !== m.pub.x) {
          await FB.flagKeys([g.uid]); await FB.track(FB.doc('toAccess/' + g.uid).delete()); removed = true; out.keyChanged.push(m.name || g.sid); continue;
        }
        if (m && m.active) {
          if (m.pub && g.uid !== FB.uid && (g.ringV || 0) < FB.hr.curV) { await FB.track(FB.doc('toAccess/' + g.uid).set(await FB.grantDoc(g.uid, m.pub, m.staffId, FB.hr.ring, FB.hr.curV))); out.resealed.push(m.name); }
          continue;
        }
        await FB.track(FB.doc('toAccess/' + g.uid).delete()); removed = true;
        const now = p.members.find(x => x.active && x.staffId === g.sid && x.uid !== g.uid);
        (now ? out.relogin : out.removed).push((now && now.name) || (m && m.name) || g.sid);
      }
      if (!p.escrowOk && p.hasRecovery) { const esc = await FB.escrowDoc(FB.hr.ring, FB.hr.curV); if (esc) await FB.track(FB.doc('meta/toEscrow').set(esc)); }
      if (removed) await FB.newKey();
    });
    if (removed) await FB.hrReseal();
    return out;
  },
  /* Dr. A: everyone's public key where the people who approve can find it (people who haven't opened Time Off yet too) */
  async publishPeople() {
    const ms = await FB.db.collection('members').get(), pp = await FB.db.collection('toPeople').get(), have = new Map(pp.docs.map(d => [d.id, d.data()]));
    let n = 0;
    for (const d of ms.docs) {
      const m = d.data(); if (!m.active || !m.pub || !m.staffId) continue;
      const h = have.get(m.staffId); if (h && h.uid === d.id && h.pub && h.pub.x === m.pub.x) continue;
      // held by another login of the same person (reissued in NLO Cases): that login publishes its own key when it signs in
      if (h && h.uid !== d.id) continue;
      await FB.track(FB.doc('toPeople/' + m.staffId).set({ pub: { kty: m.pub.kty, crv: m.pub.crv, x: m.pub.x, y: m.pub.y }, uid: d.id, at: FB.ts() })); n++;
    }
    return n;
  },

  /* =====================================================================
     Live data
     ===================================================================== */
  start(h) {
    FB.stop(); FB.h = h;
    const uid = FB.uid, hr = !!FB.hr;
    FB.unsubs.push(FB.doc('members/' + uid).onSnapshot(s => { if (!s.exists || !s.data().active) h.revoked(); }, e => h.revoked(e)));
    FB.unsubs.push(FB.doc('toAccess/' + uid).onSnapshot(async s => {
      if (!s.exists) { if (FB.hr && !FB.isOwner()) h.access('off'); return; }
      if (!FB.hr) { h.access('on'); return; }
      const g = s.data(); if (g.ringV && g.ringV !== FB.hr.ringV) { try { await FB.hrLoad(g); h.rekeyed(); await FB.reopenLocked(h); } catch (e) { h.error(e); } }
    }, () => { }));
    FB.unsubs.push(FB.doc('meta/toKeys').onSnapshot(async s => {
      if (!s.exists) return; const x = s.data(); FB.hrV = x.current; FB.hrPub = x.pub;
      if (FB.hr && !FB.hr.drop.has(x.current)) { try { await FB.hrReload(); await FB.reopenLocked(h); } catch (e) { } }
    }, () => { }));
    FB.unsubs.push(FB.doc('meta/settings').onSnapshot(s => { FB.settingsCache = s.exists ? s.data() : {}; h.settings(FB.settingsCache); }, () => { }));
    FB.unsubs.push(FB.doc('meta/toTeam').onSnapshot(s => h.team(s.exists ? (s.data().sids || []) : []), () => h.team([])));
    FB.unsubs.push(FB.db.collection('roster').onSnapshot(s => h.roster(s.docs.map(d => Object.assign({ sid: d.id }, d.data()))), e => h.error(e)));
    FB.unsubs.push(FB.db.collection('toPeople').onSnapshot(s => { FB.people = new Map(s.docs.map(d => [d.id, d.data()])); h.people(FB.people); }, () => { }));
    // who's out (the office key)
    FB.unsubs.push(FB.db.collection('toOut').onSnapshot(async snap => {
      const list = [];
      for (const d of snap.docs) { try { const x = d.data(); list.push(Object.assign(await Crypto.openJSON(FB.keys[x.v], x, 'toout:' + d.id), { id: d.id })); } catch (e) { } }
      h.board(list);
    }, e => h.loadError(e)));
    // requests: everyone's for the people who approve, my own for everyone else
    const q = hr ? FB.db.collection('toReq') : FB.db.collection('toReq').where('sid', '==', FB.me.staffId);
    // one batch of changes at a time, in the order they came (opening takes a moment; a later copy never loses to an older one)
    FB.unsubs.push(q.onSnapshot(snap => FB.inOrder(async () => {
      const up = [], gone = [];
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') { gone.push(ch.doc.id); FB.lockedRaw.delete(ch.doc.id); continue; }
        const r = await FB.openReq(ch.doc.id, ch.doc.data()); up.push(r);
        if (r.locked) FB.lockedRaw.set(ch.doc.id, ch.doc.data()); else FB.lockedRaw.delete(ch.doc.id);
      }
      h.reqs(up, gone, snap.metadata.fromCache);
    }), e => h.loadError(e)));
    // scrubs requests: everyone's for the people who approve, my own for everyone else (few, so all are opened again on a change)
    FB.perkRaw = new Map();
    const pq = hr ? FB.db.collection('toPerk') : FB.db.collection('toPerk').where('sid', '==', FB.me.staffId);
    FB.unsubs.push(pq.onSnapshot(snap => FB.inOrder(async () => {
      snap.docChanges().forEach(ch => { if (ch.type === 'removed') FB.perkRaw.delete(ch.doc.id); else FB.perkRaw.set(ch.doc.id, ch.doc.data()); });
      await FB.emitPerks(h);
    }), () => h.perks([])));
    // my own HR record (balances), sealed to me
    FB.unsubs.push(FB.doc('toMine/' + FB.me.staffId).onSnapshot(async s => {
      if (!s.exists) { h.mine(null); return; }
      try { h.mine(await Crypto.openJSONFrom(FB.priv, s.data().box, 'tomine:' + FB.me.staffId)); } catch (e) { h.mine({ locked: true }); }
    }, () => h.mine(null)));
    if (hr) FB.unsubs.push(FB.db.collection('toHR').onSnapshot(async snap => {
      const list = [];
      for (const d of snap.docs) { try { list.push(await FB.openHR(d.id, d.data())); } catch (e) { list.push({ sid: d.id, locked: true }); } }
      h.hr(list);
    }, e => h.loadError(e)));
  },
  lockedRaw: new Map(),
  reqChain: Promise.resolve(),
  inOrder(fn) { const p = FB.reqChain.then(fn, fn); FB.reqChain = p.catch(() => { }); return p; },
  /* after a key reload: the requests this login couldn't open, tried again — in line with the listener, so what's
     tried is always the newest copy seen */
  reopenLocked(h) {
    return FB.inOrder(async () => {
      const up = [];
      for (const [id, d] of Array.from(FB.lockedRaw)) {
        const r = await FB.openReq(id, d);
        if (!r.locked && FB.lockedRaw.get(id) === d) { FB.lockedRaw.delete(id); up.push(r); }
      }
      if (up.length) h.reqs(up, []);
      if (FB.perkRaw && FB.perkRaw.size) await FB.emitPerks(h);
    });
  },
  async emitPerks(h) {
    const list = [];
    for (const [id, d] of Array.from(FB.perkRaw || [])) list.push(await FB.openPerk(id, d));
    if (h && h.perks) h.perks(list);
  },
  /* a scrubs request, opened like a time-off request: the HR copy for the people who approve, the person's own for them */
  async openPerk(id, d) {
    const base = { id, sid: d.sid, status: d.status, rev: d.rev, v: d.v, year: d.year, pubX: d.pub ? d.pub.x : '', by: d.bsid || '', updatedAt: FB.tsMs(d.updatedAt), createdAtSrv: FB.tsMs(d.createdAt), hasMe: !!d.me };
    try {
      let c;
      if (FB.hr && FB.hr.drop.has(d.v)) c = await Crypto.openJSONFrom(FB.hr.drop.get(d.v), d.hr, 'toperk:' + id);
      else if (d.me && d.sid === FB.me.staffId) c = await Crypto.openJSONFrom(FB.priv, d.me, 'toperkme:' + id);
      else return Object.assign(base, { locked: true });
      if (c.sid !== d.sid || !okPerk(c)) return Object.assign(base, { locked: true, odd: 'bad' });
      return Object.assign({}, c, base);
    } catch (e) { return Object.assign(base, { locked: true }); }
  },
  newPerkId() { return 'p' + hexId(12); },
  /* saving a scrubs request: fn(content) changes the sealed content and may return { status }. opts: { create: { sid, year }, rev, a } */
  async savePerk(id, fn, opts) {
    opts = opts || {};
    const run = () => FB._savePerk(id, fn, opts, 0);
    const p = (FB.queues['p:' + id] || Promise.resolve()).then(run, run);
    FB.queues['p:' + id] = p.catch(() => { });
    return p;
  },
  async _savePerk(id, fn, opts, tries) {
    const ref = FB.doc('toPerk/' + id);
    // the order email (approved scrubs): a note for NLO Cases' email robot, only when it can send it to the right place
    let note = null;
    if (opts.mail) { const m = await FB.scrubsMailState().catch(() => null); if (m && m.ok) note = await FB.outboxNote(opts.mail, m.n); }
    try {
      await FB.track(FB.db.runTransaction(async tx => {
        const hrPub = FB.hrPub, hrV = FB.hrV; // read together: the copy is always sealed to the version it says
        const s = await tx.get(ref);
        if (!hrPub || !hrV) throw errCode('no-key', 'Time Off isn’t set up yet.');
        let cur = null, rev = 1;
        if (s.exists) {
          const d = s.data(); if (opts.rev && d.rev !== opts.rev) throw errCode('changed', 'This request was just changed — look at it again.');
          cur = await FB.openPerk(id, d); if (cur.locked) throw errCode('locked', 'This request can’t be opened on this login.');
          rev = d.rev + 1;
        } else if (!opts.create) throw errCode('gone');
        const content = FB.clean(cur || { sid: opts.create.sid, kind: 'scrubs', events: [] }); delete content.year;
        const prev = cur ? cur.status : null, r = fn(content, { mailed: !!note }) || {}, status = r.status || prev || 'pending';
        if (content.sid !== (cur ? cur.sid : opts.create.sid)) throw errCode('bad', 'A request can’t change hands.');
        if (!okPerk(content)) throw errCode('bad', 'Say how many pairs and why.');
        let mine = FB.trustedPub(content.sid);
        if (!mine && content.sid !== FB.me.staffId && !FB.people.has(content.sid)) { const pp = await tx.get(FB.doc('toPeople/' + content.sid)); if (pp.exists) mine = FB.trusted(pp.data()); }
        const hrBox = await Crypto.sealJSONTo(hrPub, content, 'toperk:' + id), meBox = mine ? await Crypto.sealJSONTo(mine, content, 'toperkme:' + id) : null;
        const doc = { sid: content.sid, status, rev, by: FB.uid, bsid: FB.me.staffId, v: hrV, pub: mine ? { kty: mine.kty, crv: mine.crv, x: mine.x, y: mine.y } : null, year: cur ? cur.year : opts.create.year, hr: hrBox, me: meBox, updatedAt: FB.ts() };
        if (s.exists) tx.update(ref, Object.assign(doc, { createdAt: s.data().createdAt })); else tx.set(ref, Object.assign(doc, { createdAt: FB.ts() }));
        if (note) tx.set(note.ref, note.data);
      }));
    } catch (e) {
      if (tries < 2 && (FB.isPerm(e) || e.code === 'no-key')) {
        try { const k = await FB.doc('meta/toKeys').get(); if (k.exists) { FB.hrV = k.data().current; FB.hrPub = k.data().pub; } if (FB.hr) await FB.hrReload(); } catch (x) { }
        await new Promise(r => setTimeout(r, 150 + Math.random() * 350));
        return FB._savePerk(id, fn, opts, tries + 1);
      }
      throw e;
    }
    return { id, mailed: !!note };
  },
  /* where scrubs orders go (meta/toMail, which only Dr. A writes and the email robot reads), and whether the robot can send
     them: it sends the front-desk notices; its script is new enough (v3) to send these to that address and nowhere else; it has
     checked in lately (NLO Cases calls a robot late after 40 minutes); and the key notes are sealed to (meta/inbox) is the one
     it has now — after the robot is set up afresh, NLO Cases picks up its new key only when Dr. A next opens it */
  async scrubsMailState() {
    const [m, n] = await Promise.all([FB.doc('meta/toMail').get(), FB.frontDesk()]);
    const to = m.exists && typeof m.data().scrubs === 'string' ? m.data().scrubs : '';
    let ver = 0, fresh = false, keyOk = false;
    if (n && n.box) {
      try {
        const b = await FB.doc('mailbeat/' + n.box).get();
        if (b.exists) { const d = b.data(), at = FB.tsMs(d.at); ver = Number(d.ver) || 0; fresh = !!at && Date.now() - at < 40 * 60000; keyOk = !!(d.pub && n.pub && d.pub.x === n.pub.x && d.pub.y === n.pub.y); }
      } catch (e) { }
    }
    return { to, on: !!n, ver, fresh, keyOk, n, ok: !!(to && n && ver >= 3 && fresh && keyOk) };
  },
  async setScrubsMail(to) { await FB.track(FB.doc('meta/toMail').set({ scrubs: to, at: FB.ts() })); },
  /* a request, opened: the HR copy for the people who approve, the person's own copy for them */
  async openReq(id, d) {
    const base = { id, sid: d.sid, status: d.status, rev: d.rev, v: d.v, startMs: d.startMs, pubX: d.pub ? d.pub.x : '', by: d.bsid || '', updatedAt: FB.tsMs(d.updatedAt), createdAtSrv: FB.tsMs(d.createdAt), hasMe: !!d.me };
    try {
      let c;
      if (FB.hr && FB.hr.drop.has(d.v)) c = await Crypto.openJSONFrom(FB.hr.drop.get(d.v), d.hr, 'toreq:' + id);
      else if (d.me && d.sid === FB.me.staffId) c = await Crypto.openJSONFrom(FB.priv, d.me, 'toreqme:' + id);
      else return Object.assign(base, { locked: true });
      if (c.sid !== d.sid) return Object.assign(base, { locked: true, odd: 'sid' });
      if (!okContent(c)) return Object.assign(base, { locked: true, odd: 'bad' });
      return Object.assign({}, c, base);
    } catch (e) { return Object.assign(base, { locked: true }); }
  },
  async openHR(sid, d) {
    const key = FB.hr && FB.hr.keys[d.v]; if (!key) throw errCode('no-key');
    return Object.assign(await Crypto.openJSON(key, d, 'tohr:' + sid), { sid, rev: d.rev, v: d.v, updatedAt: FB.tsMs(d.updatedAt) });
  },
  clean(c) { const o = Object.assign({}, c); ['id', 'status', 'rev', 'v', 'startMs', 'pubX', 'by', 'updatedAt', 'createdAtSrv', 'hasMe', 'locked', 'odd'].forEach(k => delete o[k]); return o; },

  /* =====================================================================
     Saving a request. fn(content) changes the sealed content and returns
     nothing, or { status } for a new status. In the same save: its
     history entry (the copy it replaced), its who's-out entry (approved
     only), and a note for the front-desk email when asked.
     opts: { a: history word, create: { sid } for a new one, mail: { subject, text } (the front desk), feed: true }
     ===================================================================== */
  async saveReq(id, fn, opts) {
    opts = opts || {};
    const run = () => FB._saveReq(id, fn, opts, 0);
    const p = (FB.queues[id] || Promise.resolve()).then(run, run);
    FB.queues[id] = p.catch(() => { });
    return p;
  },
  async _saveReq(id, fn, opts, tries) {
    const ref = FB.doc('toReq/' + id);
    let note = null;
    if (opts.mail) { const n = await FB.frontDesk().catch(() => null); if (n) note = await FB.outboxNote(opts.mail, n); }
    try {
      await FB.track(FB.db.runTransaction(async tx => {
        const hrPub = FB.hrPub, hrV = FB.hrV; // read together: the copy is always sealed to the version it says
        const s = await tx.get(ref);
        if (!hrPub || !hrV) throw errCode('no-key', 'Time Off isn’t set up yet.');
        let cur = null, rev = 1;
        if (s.exists) {
          if (opts.fresh) throw errCode('exists', 'This request is already here.');
          const d = s.data(); if (opts.rev && d.rev !== opts.rev) throw errCode('changed', 'This request was just changed — look at it again.');
          // taking back one that can't be opened: only if it still can't, with every key this login has
          if (opts.unreadable && !(await FB.openReq(id, d)).locked) throw errCode('opens', 'This request opens now — it’s back in the lists. Nothing was taken back.');
          cur = opts.unreadable ? null : await FB.openReq(id, d);
          if (cur && cur.locked) throw errCode('locked', 'This request can’t be opened on this login.');
          rev = d.rev + 1;
          if (opts.unreadable) { const day = isoOfMs(d.startMs) || todayISO(); cur = { sid: d.sid, status: d.status, start: day, end: day, type: 'other', paid: false, part: 'full', note: '', events: [] }; }
        }
        else if (!opts.create) throw errCode('gone');
        const content = FB.clean(cur || { sid: opts.create.sid, status: 'pending', events: [] });
        if (opts.unreadable) delete content.status;
        const prevStatus = cur ? cur.status : null;
        const r = fn(content) || {}; const status = r.status || prevStatus || 'pending';
        if (content.sid !== (cur ? cur.sid : opts.create.sid)) throw errCode('bad', 'A request can’t change hands.');
        if (!isISO(content.start) || !isISO(content.end)) throw errCode('bad', 'A request needs its dates.');
        // the person's copy: sealed to their public key (theirs, or the one on toPeople for someone else — unless that
        // login's key changed in place, when there's no copy for them until the login is reissued)
        let mine = FB.trustedPub(content.sid);
        if (!mine && content.sid !== FB.me.staffId && !FB.people.has(content.sid)) { const pp = await tx.get(FB.doc('toPeople/' + content.sid)); if (pp.exists) mine = FB.trusted(pp.data()); }
        const hrBox = await Crypto.sealJSONTo(hrPub, content, 'toreq:' + id);
        const meBox = mine ? await Crypto.sealJSONTo(mine, content, 'toreqme:' + id) : null;
        const doc = { sid: content.sid, status, rev, by: FB.uid, bsid: FB.me.staffId, v: hrV, pub: mine ? { kty: mine.kty, crv: mine.crv, x: mine.x, y: mine.y } : null, startMs: dayStartMs(content.start), hr: hrBox, me: meBox, updatedAt: FB.ts() };
        if (s.exists) { tx.update(ref, Object.assign(doc, { createdAt: s.data().createdAt })); }
        else tx.set(ref, Object.assign(doc, { createdAt: FB.ts() }));
        const d0 = s.exists ? s.data() : null;
        tx.set(FB.doc('toLog/' + id + '_' + rev), { reqId: id, rev, uid: FB.uid, sid: FB.me.staffId, osid: content.sid, a: String(opts.a || 'save').slice(0, 20), at: FB.ts(),
          prev: d0 ? { v: d0.v, hr: d0.hr, me: d0.me === undefined ? null : d0.me, status: d0.status } : null });
        // who's out: an entry while it's approved, none otherwise
        const outRef = FB.doc('toOut/' + id);
        if (status === 'approved') {
          const box = await Crypto.sealJSON(FB.officeKey(), { sid: content.sid, start: content.start, end: content.end, part: content.part || 'full' }, 'toout:' + id);
          tx.set(outRef, { v: FB.curV, iv: box.iv, ct: box.ct, at: FB.ts() });
        } else if (prevStatus === 'approved') tx.delete(outRef);
        if (note) tx.set(note.ref, note.data);
      }));
    } catch (e) {
      if (tries < 2 && (FB.isPerm(e) || e.code === 'no-key')) { // the HR key may have just changed
        try { const k = await FB.doc('meta/toKeys').get(); if (k.exists) { FB.hrV = k.data().current; FB.hrPub = k.data().pub; } if (FB.hr) await FB.hrReload(); } catch (x) { }
        await new Promise(r => setTimeout(r, 150 + Math.random() * 350));
        return FB._saveReq(id, fn, opts, tries + 1);
      }
      throw e;
    }
    return id;
  },
  newReqId() { return 'q' + hexId(12); },
  /* one that can't be opened (sealed wrong, or its content doesn't make sense): taken back, with what the database shows */
  async archiveUnreadable(id) {
    if (FB.hr) { try { await FB.hrReload(); } catch (e) { } } // every key this login has, freshly loaded, first
    const me = FB.me.staffId, now = Date.now();
    try { return await FB.saveReq(id, c => { c.events = [{ a: 'takeback', by: me, at: now, note: 'It couldn’t be opened, so it was taken back.' }]; c.decision = { s: 'archived', by: me, at: now, note: 'It couldn’t be opened.' }; return { status: 'archived' }; }, { a: 'takeback', unreadable: true }); }
    catch (e) { if (e.code === 'opens' && FB.h) await FB.reopenLocked(FB.h); throw e; }
  },
  /* a request at a moved request's id counts as moved only if Dr. A's own import made it, for the same person */
  async importedHere(id, sid) {
    const [r, l] = await Promise.all([FB.doc('toReq/' + id).get(), FB.doc('toLog/' + id + '_1').get()]);
    return r.exists && r.data().sid === sid && l.exists && l.data().a === 'import' && l.data().uid === FB.uid;
  },
  /* a request's history (who did what, when) */
  async reqLog(id, osid) {
    const q = FB.hr ? FB.db.collection('toLog').where('reqId', '==', id) : FB.db.collection('toLog').where('osid', '==', osid).where('reqId', '==', id);
    const snap = await q.get();
    return snap.docs.map(d => { const x = d.data(); return { rev: x.rev, a: x.a, sid: x.sid, at: FB.tsMs(x.at) }; }).sort((a, b) => a.rev - b.rev);
  },

  /* ---------- HR records (Dr. A writes; the HR key) ---------- */
  async putHR(sid, fn, a, opts) {
    opts = opts || {};
    const ref = FB.doc('toHR/' + sid);
    let saved = null;
    await FB.track(FB.db.runTransaction(async tx => {
      const s = await tx.get(ref), v = FB.hr.curV, key = FB.hr.keys[v]; if (!key) throw errCode('no-key');
      let data = s.exists ? await FB.openHR(sid, s.data()) : { sid };
      ['rev', 'v', 'updatedAt'].forEach(k => delete data[k]); data.sid = sid;
      fn(data);
      const box = await Crypto.sealJSON(key, data, 'tohr:' + sid), rev = s.exists ? s.data().rev + 1 : 1;
      tx.set(ref, { v, iv: box.iv, ct: box.ct, rev, by: FB.uid, updatedAt: FB.ts() });
      tx.set(FB.doc('toHRLog/' + sid + '_' + rev), { hsid: sid, rev, uid: FB.uid, at: FB.ts(), a: String(a || 'save').slice(0, 20), prev: s.exists ? { v: s.data().v, iv: s.data().iv, ct: s.data().ct } : null });
      if (opts.mine !== false) { const m = await FB.mineDoc(sid, data); if (m) tx.set(FB.doc('toMine/' + sid), m); }
      saved = data;
    }));
    return saved;
  },
  /* the person's own copy of their HR record, sealed to them */
  async mineDoc(sid, data) {
    const pub = FB.trustedPub(sid); if (!pub) return null;
    const c = { sid, hire: data.hire || '', orient: data.orient || '', type: data.type || 'FT', left: data.left || '', open: data.open || null, adj: data.adj || [], settled: data.settled || [], ben: data.ben || {}, at: Date.now() };
    return { box: await Crypto.sealJSONTo(pub, c, 'tomine:' + sid), pubX: pub.x, at: FB.ts(), by: FB.uid };
  },
  /* which key each person's copy is sealed to (Dr. A's upkeep re-seals one whose person has a new key) */
  async mineXs() { const snap = await FB.db.collection('toMine').get(); return new Map(snap.docs.map(d => [d.id, d.data().pubX])); },
  async writeMine(sid, data) { const m = await FB.mineDoc(sid, data); if (m) await FB.track(FB.doc('toMine/' + sid).set(m)); return !!m; },
  async hrLog(sid) {
    const snap = await FB.db.collection('toHRLog').where('hsid', '==', sid).get();
    return snap.docs.map(d => { const x = d.data(); return { rev: x.rev, a: x.a, at: FB.tsMs(x.at), uid: x.uid }; }).sort((a, b) => a.rev - b.rev);
  },

  /* ---------- the who's-out feed (CADANCe and the office calendar) ---------- */
  async writeFeed(obj) {
    const fk = await FB.openFeedKey(); if (!fk) return false;
    const box = await Crypto.sealJSON(fk.key, obj, 'tofeed');
    await FB.track(FB.doc('toFeed/live').set({ iv: box.iv, ct: box.ct, at: FB.ts() }));
    return true;
  },
  async readFeed() {
    const fk = await FB.openFeedKey(); if (!fk) return null;
    const s = await FB.doc('toFeed/live').get(); if (!s.exists) return null;
    try { return await Crypto.openJSON(fk.key, s.data(), 'tofeed'); } catch (e) { return null; }
  },
  /* Dr. A: a new feed key (if the link got out) */
  async newFeedKey() {
    const feed = Crypto.newRingKey(), fbox = await Crypto.seal(FB.officeKey(), TE.encode(JSON.stringify({ key: feed })), 'tofeedkey');
    await FB.track(FB.doc('meta/toFeedKey').set({ v: FB.curV, iv: fbox.iv, ct: fbox.ct, at: FB.ts() }));
    FB.feedKey = { b64: feed, key: await Crypto.rawKey(feed) };
  },

  /* ---------- the front-desk email (NLO Cases' Gmail robot sends it) ---------- */
  async frontDesk() {
    const s = await FB.doc('meta/inbox').get(); const n = s.exists ? s.data().notify : null;
    return n && n.on && n.box && n.pub ? n : null;
  },
  async outboxNote(msg, n) {
    const id = 'o' + hexId(16), box = await Crypto.sealTo(n.pub, TE.encode(JSON.stringify(msg)), 'outbox:' + id);
    return { ref: FB.doc('outbox/' + id), data: { box: n.box, epk: box.epk, iv: box.iv, ct: box.ct, at: FB.ts() } };
  },

  /* whether NLO Cases' email robot sends notices, and to whom (Settings shows it) */
  async deskStatus() { const s = await FB.doc('meta/inbox').get(); const n = s.exists ? s.data().notify : null; return { on: !!(n && n.on && n.box && n.pub), to: n && n.to ? n.to : '' }; },
  feedKeyB64() { return FB.feedKey ? FB.feedKey.b64 : ''; },
  projectId() { return FB.cfg ? FB.cfg.projectId : ''; },

  async saveSettings(patch) { await FB.track(FB.doc('meta/settings').set(patch, { merge: true })); }
};
