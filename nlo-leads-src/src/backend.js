/* =====================================================================
   Firebase backend. Nothing readable about a lead ever leaves the
   browser: lead bodies and history are sealed with the office key ring.
   Plain fields on a lead doc: v (key version), status, rev, by/sid,
   createdAt/updatedAt/closedAt — none of them identify anyone.
   Website requests arrive by email: the NLO Cases email reader seals them into
   `inbox` and a signed-in browser opens and files them. (The optional instant
   feed puts them in `leadInbox`, sealed to the intake public key.)
   ===================================================================== */
const FB = {
  emu: false, app: null, auth: null, db: null, cfg: null,
  uid: null, me: null, priv: null, ring: null, keys: null, curV: 0, ringV: 0,
  intake: null, inboxDocs: new Map(), mailDocs: new Map(), mailPriv: null,
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
    FB.priv = FB.ring = FB.keys = FB.me = FB.uid = FB.intake = FB.mailPriv = null; FB.curV = FB.ringV = 0; FB.inboxDocs = new Map(); FB.mailDocs = new Map();
    try { await FB.auth.signOut(); } catch (e) { }
  },
  stop() { FB.unsubs.forEach(u => { try { u(); } catch (e) { } }); FB.unsubs = []; },

  /* ---------- live data ---------- */
  async decryptLead(id, d) {
    const key = FB.keys && FB.keys[d.v];
    if (!key) throw errCode('no-key', 'Missing key version ' + d.v);
    const data = await Crypto.openJSON(key, d, 'lead:' + id);
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
    FB.unsubs.push(FB.db.collection('leads').where('status', '==', 'open').onSnapshot(async snap => {
      const up = [], gone = [];
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') { gone.push(ch.doc.id); continue; }
        try { up.push(await FB.decryptLead(ch.doc.id, ch.doc.data())); }
        catch (e) { up.push({ id: ch.doc.id, locked: true, status: 'open', name: '(locked lead)', steps: [], stage: 'new', flag: '', src: {} }); }
      }
      h.leads(up, gone, snap.metadata.fromCache);
    }, e => h.leadsError(e)));
    // website requests waiting to be filed, and the key that opens them (errors are fine before the rules are published)
    FB.unsubs.push(FB.db.collection('leadInbox').onSnapshot(s => {
      FB.inboxDocs = new Map(s.docs.map(d => [d.id, d.data()]));
      h.inbox(s.docs.map(d => ({ id: d.id, at: FB.tsMs(d.data().at) || 0, kid: d.data().kid })).sort((a, b) => a.at - b.at));
    }, () => { FB.inboxDocs = new Map(); h.inbox([]); }));
    FB.unsubs.push(FB.db.doc('meta/intake').onSnapshot(async s => { await FB.loadIntake(s.exists ? s.data() : null); h.intake(FB.intake); }, () => { FB.intake = null; h.intake(null); }));
    // website requests that came by email: the NLO Cases email reader seals every email it forwards into `inbox`
    // (lab emails too — those are NLO Cases' and are never changed here) and lists which senders it forwards in meta/inbox
    FB.unsubs.push(FB.db.collection('inbox').onSnapshot(s => {
      FB.mailDocs = new Map(s.docs.map(d => [d.id, d.data()]));
      h.mail(s.docs.map(d => ({ id: d.id, at: FB.tsMs(d.data().at) || 0 })).sort((a, b) => a.at - b.at));
    }, () => { FB.mailDocs = new Map(); h.mail([]); }));
    FB.unsubs.push(FB.db.doc('meta/inbox').onSnapshot(s => h.mailRoute(s.exists ? { senders: (s.data().senders || []).map(String) } : null), () => h.mailRoute(null)));
    if (FB.isOwner()) {
      FB.unsubs.push(FB.db.collection('members').onSnapshot(s => h.members(s.docs.map(d => Object.assign({ uid: d.id }, d.data()))), e => h.error(e)));
    }
  },
  async loadClosed(days) {
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
    const snap = await FB.db.collection('leads').where('closedAt', '>=', since).get();
    const out = [];
    for (const d of snap.docs) { try { out.push(await FB.decryptLead(d.id, d.data())); } catch (e) { } }
    return out;
  },
  async loadAll() {
    const snap = await FB.db.collection('leads').get();
    const out = [];
    for (const d of snap.docs) { try { out.push(await FB.decryptLead(d.id, d.data())); } catch (e) { } }
    return out;
  },
  async leadLog(id) {
    const snap = await FB.db.collection('leadLog').where('leadId', '==', id).get();
    const out = [];
    for (const d of snap.docs) {
      const x = d.data(); const key = FB.keys[x.v];
      try { out.push(Object.assign(await Crypto.openJSON(key, x, 'leadlog:' + d.id), { at: FB.tsMs(x.at), sid: x.sid })); } catch (e) { }
    }
    return out.sort((a, b) => (a.at || 0) - (b.at || 0));
  },
  async activity(days) {
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
    const snap = await FB.db.collection('leadLog').where('at', '>=', since).get();
    const out = [];
    for (const d of snap.docs) {
      const x = d.data(); const key = FB.keys[x.v];
      try { out.push(Object.assign(await Crypto.openJSON(key, x, 'leadlog:' + d.id), { at: FB.tsMs(x.at), sid: x.sid, leadId: x.leadId })); } catch (e) { }
    }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  },

  /* ---------- writes ---------- */
  clean(data) { const o = Object.assign({}, data); ['id', 'rev', 'v', 'status', 'by', 'updatedAt', 'createdAtSrv', 'closedAt', 'locked'].forEach(k => delete o[k]); return o; },
  /* history entry at the fixed id "<lead>_<rev>"; prev = the encrypted copy this write replaces */
  async logOps(batchOrTx, leadId, rev, prev, action) {
    const lid = leadId + '_' + rev; const ref = FB.db.doc('leadLog/' + lid);
    const box = await Crypto.sealJSON(FB.keys[FB.curV], action, 'leadlog:' + lid);
    batchOrTx.set(ref, { leadId, rev, uid: FB.uid, sid: FB.me.staffId, at: FB.ts(), v: FB.curV, iv: box.iv, ct: box.ct, prev: prev || null });
  },
  async createLeads(list, progress) {
    // list: [{data, status:'open'|'done', closedAt:ms, action}]; small batches keep each one well inside the rules' lookup limit
    const PER = 5; let n = 0;
    for (let i = 0; i < list.length; i += PER) {
      const b = FB.db.batch();
      for (const item of list.slice(i, i + PER)) {
        const ref = FB.db.collection('leads').doc();
        const v = FB.curV; const box = await Crypto.sealJSON(FB.keys[v], FB.clean(item.data), 'lead:' + ref.id);
        const done = item.status === 'done';
        b.set(ref, { v, iv: box.iv, ct: box.ct, status: done ? 'done' : 'open', rev: 1, by: FB.uid, sid: FB.me.staffId, createdAt: FB.ts(), updatedAt: FB.ts(), closedAt: done ? firebase.firestore.Timestamp.fromMillis(item.closedAt || Date.now()) : null });
        await FB.logOps(b, ref.id, 1, null, item.action || { a: 'create' });
        item.id = ref.id;
      }
      await FB.track(b.commit()); n += Math.min(PER, list.length - i); if (progress) progress(n, list.length);
    }
    return list.map(x => x.id);
  },
  async createLead(data, action) { const ids = await FB.createLeads([{ data, status: 'open', action }]); return ids[0]; },
  /* fn(data) edits the latest decrypted copy in place; return 'done' / 'open' to change status */
  /* one person's writes to the same lead run one after another, never racing each other */
  queues: {},
  mutateLead(id, fn, action) {
    const run = () => FB._mutate(id, fn, action, 0);
    const p = (FB.queues[id] || Promise.resolve()).then(run, run);
    FB.queues[id] = p.catch(() => { });
    return p;
  },
  async _mutate(id, fn, action, tries) {
    const ref = FB.db.doc('leads/' + id);
    try {
      await FB.track(FB.db.runTransaction(async tx => {
        const s = await tx.get(ref); if (!s.exists) throw errCode('gone');
        const d = s.data(); const data = FB.clean(await FB.decryptLead(id, d));
        const st = fn(data); const status = st === 'done' || st === 'open' ? st : d.status;
        const v = FB.curV; const box = await Crypto.sealJSON(FB.keys[v], data, 'lead:' + id);
        const closedAt = status === 'done' ? (d.status === 'done' && d.closedAt ? d.closedAt : FB.ts()) : null;
        tx.update(ref, { v, iv: box.iv, ct: box.ct, status, rev: d.rev + 1, by: FB.uid, sid: FB.me.staffId, updatedAt: FB.ts(), closedAt });
        await FB.logOps(tx, id, d.rev + 1, { v: d.v, iv: d.iv, ct: d.ct }, action || { a: 'save' });
      }));
    } catch (e) {
      if (tries < 2 && /permission/i.test(e.code || e.message || '')) {
        // the office key may have just been changed: refresh it and try again
        const m = (await FB.db.doc('members/' + FB.uid).get()).data();
        if (!m || !m.active) throw e;
        await FB.loadRing(m);
        await new Promise(r => setTimeout(r, 150 + Math.random() * 350));
        return FB._mutate(id, fn, action, tries + 1);
      }
      throw e;
    }
  },
  /* owner only; the last encrypted copy stays in history, so a delete can be undone */
  async deleteLead(id) {
    const ref = FB.db.doc('leads/' + id);
    await FB.track(FB.db.runTransaction(async tx => {
      const s = await tx.get(ref); if (!s.exists) throw errCode('gone'); const d = s.data();
      await FB.logOps(tx, id, d.rev + 1, { v: d.v, iv: d.iv, ct: d.ct }, { a: 'delete' });
      tx.delete(ref);
    }));
  },
  /* every saved version of one lead, newest first (the copy each write replaced) */
  async leadVersions(id) {
    const snap = await FB.db.collection('leadLog').where('leadId', '==', id).get();
    const out = [];
    for (const d of snap.docs) {
      const x = d.data(); if (!x.prev) continue;
      let who = null; try { who = await Crypto.openJSON(FB.keys[x.v], x, 'leadlog:' + d.id); } catch (e) { }
      let data = null; try { data = await Crypto.openJSON(FB.keys[x.prev.v], x.prev, 'lead:' + id); } catch (e) { }
      out.push({ rev: x.rev - 1, replacedAt: FB.tsMs(x.at), replacedBy: x.sid, replacedHow: who && who.a, data });
    }
    return out.sort((a, b) => b.rev - a.rev);
  },
  async restoreVersion(id, data) {
    const keep = FB.clean(data);
    return FB.mutateLead(id, d => { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, keep); return keep.closeWhy ? 'done' : 'open'; }, { a: 'restore' });
  },
  /* leads deleted in the last N days, recovered from their history entry */
  async deletedLeads(days) {
    const since = firebase.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
    const snap = await FB.db.collection('leadLog').where('at', '>=', since).get();
    const out = [];
    for (const d of snap.docs) {
      const x = d.data(); if (!x.prev) continue;
      let act = null; try { act = await Crypto.openJSON(FB.keys[x.v], x, 'leadlog:' + d.id); } catch (e) { continue; }
      if (!act || act.a !== 'delete') continue;
      const still = await FB.db.doc('leads/' + x.leadId).get(); if (still.exists) continue;
      try { out.push({ leadId: x.leadId, at: FB.tsMs(x.at), sid: x.sid, data: await Crypto.openJSON(FB.keys[x.prev.v], x.prev, 'lead:' + x.leadId) }); } catch (e) { }
    }
    return out.sort((a, b) => b.at - a.at);
  },
  async undelete(item) { return FB.createLeads([{ data: item.data, status: item.data.closeWhy ? 'done' : 'open', closedAt: Date.now(), action: { a: 'restore' } }]); },
  /* office settings live in meta/settings (owner only); the leads settings sit under "leads" */
  async saveSettings(patch) { await FB.track(FB.db.doc('meta/settings').set(patch, { merge: true })); },

  /* ---------- website requests ---------- */
  async loadIntake(d) {
    if (!d) { FB.intake = null; return; }
    try {
      const bytes = await Crypto.open(FB.keys[d.priv.v], d.priv, 'intake-priv');
      FB.intake = { kid: d.kid, pub: d.pub, key: await Crypto.importPriv(bytes), at: FB.tsMs(d.at), v: d.priv.v };
    } catch (e) { FB.intake = { kid: d.kid, pub: d.pub, key: null, bad: true, at: FB.tsMs(d.at), v: d.priv && d.priv.v }; }
  },
  canIngest() { return !!(FB.intake && FB.intake.key); },
  /* open one waiting request with the intake key */
  async openInbox(id) {
    const d = FB.inboxDocs.get(id); if (!d) throw errCode('gone');
    if (!FB.canIngest()) throw errCode('no-intake-key');
    if (d.kid !== FB.intake.kid) throw errCode('unreadable', 'Locked with an older intake key');
    let payload;
    try { payload = JSON.parse(TD.decode(await Crypto.openFrom(FB.intake.key, { epk: d.epk, iv: d.iv, ct: d.ct }, 'inbox:' + id))); }
    catch (e) { throw errCode('unreadable', 'This request could not be opened'); }
    return { payload, at: FB.tsMs(d.at) || Date.now() };
  },
  /* file it as a lead (same id as the request) and clear it from the inbox — all or nothing. The copy is opened again first, so a request is never removed unless the lead can be read. */
  async commitIntake(id, data, retried) {
    const v = FB.curV, box = await Crypto.sealJSON(FB.keys[v], FB.clean(data), 'lead:' + id);
    await Crypto.openJSON(FB.keys[v], box, 'lead:' + id);
    const b = FB.db.batch();
    b.set(FB.db.doc('leads/' + id), { v, iv: box.iv, ct: box.ct, status: 'open', rev: 1, by: FB.uid, sid: FB.me.staffId, createdAt: FB.ts(), updatedAt: FB.ts(), closedAt: null });
    await FB.logOps(b, id, 1, null, { a: 'create', how: 'website' });
    b.delete(FB.db.doc('leadInbox/' + id));
    try { await FB.track(b.commit()); }
    catch (e) {
      // refused: either another computer filed it first, or the office key changed a moment ago (refresh it and try once more)
      if (retried || !/permission/i.test(e.code || e.message || '') || await FB.leadExists(id)) throw e;
      const m = (await FB.db.doc('members/' + FB.uid).get()).data(); if (!m || !m.active) throw e;
      await FB.loadRing(m);
      return FB.commitIntake(id, data, true);
    }
  },
  async leadExists(id) { return (await FB.db.doc('leads/' + id).get()).exists; },
  async dismissInbox(id) { await FB.track(FB.db.doc('leadInbox/' + id).delete()); },

  /* ---------- website requests that came by email ---------- */
  /* the private half of NLO Cases' inbox key, sealed with the office key: opened once (again for a key set up since) */
  async mailKey(kid) {
    if (!FB.mailPriv || !FB.mailPriv[kid]) {
      const priv = {}, s = await FB.db.doc('meta/inboxKey').get();
      if (s.exists) for (const k of Object.keys(s.data().keys || {})) {
        const box = s.data().keys[k];
        try { priv[k] = await Crypto.importPriv(await Crypto.open(FB.keys[box.v], box, 'inboxkey:' + k)); } catch (e) { priv[k] = null; }
      }
      FB.mailPriv = priv;
    }
    return FB.mailPriv[kid] || null;
  },
  async openMail(id) {
    const d = FB.mailDocs.get(id); if (!d) throw errCode('gone');
    const key = await FB.mailKey(d.kid); if (!key) throw errCode('unreadable', 'Locked with a key this login can’t open');
    try { return { mail: JSON.parse(TD.decode(await Crypto.openFrom(key, { epk: d.epk, iv: d.iv, ct: d.ct }, 'inbox:' + id))), at: FB.tsMs(d.at) || Date.now() }; }
    catch (e) { throw errCode('unreadable', 'This email could not be opened'); }
  },
  /* file it as a new lead under the id made from the email, and take that copy out of the inbox — all or nothing */
  async commitMailLead(mailId, id, data, retried) {
    const v = FB.curV, box = await Crypto.sealJSON(FB.keys[v], FB.clean(data), 'lead:' + id);
    await Crypto.openJSON(FB.keys[v], box, 'lead:' + id);
    const b = FB.db.batch();
    b.set(FB.db.doc('leads/' + id), { v, iv: box.iv, ct: box.ct, status: 'open', rev: 1, by: FB.uid, sid: FB.me.staffId, createdAt: FB.ts(), updatedAt: FB.ts(), closedAt: null });
    await FB.logOps(b, id, 1, null, { a: 'create', how: 'website' });
    b.delete(FB.db.doc('inbox/' + mailId));
    try { await FB.track(b.commit()); }
    catch (e) {
      // refused: another computer (or the other inbox's copy) got there first, or the office key changed a moment ago
      if (retried || !/permission/i.test(e.code || e.message || '') || await FB.leadUsed(id)) throw e;
      const m = (await FB.db.doc('members/' + FB.uid).get()).data(); if (!m || !m.active) throw e;
      await FB.loadRing(m);
      return FB.commitMailLead(mailId, id, data, true);
    }
  },
  /* this id was filed before (even if the lead was deleted since, its first history entry stays) */
  async leadUsed(id) {
    const [a, b] = await Promise.all([FB.db.doc('leads/' + id).get(), FB.db.doc('leadLog/' + id + '_1').get()]);
    return a.exists || b.exists;
  },
  /* take a website email out of the inbox without a lead: the other inbox's copy, Asana's notice, or one from before this went live */
  async dropMail(id) { await FB.track(FB.db.doc('inbox/' + id).delete()); },
  /* owner: put the website's mailer back on NLO Cases' email-reader list (rules: owner only, same key and fields) */
  async addMailSender(s) { await FB.track(FB.db.doc('meta/inbox').update({ senders: firebase.firestore.FieldValue.arrayUnion(s) })); },
  /* when each inbox's email reader last checked (no patient data) */
  async mailBeats() {
    const s = await FB.db.collection('mailbeat').get();
    return s.docs.map(d => ({ box: d.data().box || '', at: FB.tsMs(d.data().at) || 0, err: d.data().err || '' })).sort((a, b) => a.box.localeCompare(b.box));
  },
  /* owner: create the intake key pair and the secret that goes in the website's webhook address */
  async setupIntake() {
    if (!FB.isOwner()) throw errCode('permission');
    // never replace a working key pair: requests already sealed to it could no longer be opened
    if ((await FB.db.doc('meta/intake').get()).exists) throw errCode('exists', 'The website feed is already set up.');
    const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), pbytes = await Crypto.privBytes(pair);
    const v = FB.curV, key = FB.keys[v], secret = Crypto.newSecret();
    const priv = Object.assign({ v }, await Crypto.seal(key, pbytes, 'intake-priv'));
    const box = Object.assign({ v }, await Crypto.seal(key, TE.encode(secret), 'intake-secret'));
    const b = FB.db.batch();
    b.set(FB.db.doc('meta/intake'), { kid: 'k' + Date.now().toString(36), pub, priv, at: FB.ts() });
    b.set(FB.db.doc('meta/intakeSecret'), { hash: await Crypto.sha256hex(secret), box, on: true, at: FB.ts() });
    await FB.track(b.commit());
    return secret;
  },
  async intakeSecretDoc() { const s = await FB.db.doc('meta/intakeSecret').get(); return s.exists ? s.data() : null; },
  async readSecret() {
    const d = await FB.intakeSecretDoc(); if (!d || !d.box) return null;
    return TD.decode(await Crypto.open(FB.keys[d.box.v], d.box, 'intake-secret'));
  },
  async rotateSecret() {
    const d = await FB.intakeSecretDoc(); const secret = Crypto.newSecret(), v = FB.curV;
    const box = Object.assign({ v }, await Crypto.seal(FB.keys[v], TE.encode(secret), 'intake-secret'));
    await FB.track(FB.db.doc('meta/intakeSecret').set({ hash: await Crypto.sha256hex(secret), box, on: d ? d.on !== false : true, at: FB.ts() }));
    return secret;
  },
  async setFeedOn(on) { await FB.track(FB.db.doc('meta/intakeSecret').update({ on: !!on, at: FB.ts() })); },
  /* when the function last took (or refused) a request — times and a reason word only, nothing about anyone */
  async intakeStats() { const s = await FB.db.doc('meta/intakeStats').get(); if (!s.exists) return null; const d = s.data(); return { okAt: FB.tsMs(d.okAt), badAt: FB.tsMs(d.badAt), badWhy: d.badWhy || '' }; },
  /* a made-up request, sent the way the website form sends one (the answer can't be read from here; the test lead appearing is the proof) */
  async sendTest(url) {
    await fetch(url, { method: 'POST', mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ test: true, fields: { name: 'Test Request', email: 'test@example.com', phone: '352-555-0199', message: 'Test request sent from NLO Leads settings.' } }) });
  },
  /* after the office key changed: seal everything under the newest key (owner; quietly runs when the owner opens Leads) */
  async resealAll(progress) {
    const out = { leads: 0, failed: 0, intake: false };
    const old = (await FB.db.collection('leads').get()).docs.filter(d => d.data().v < FB.curV);
    let n = 0;
    for (let i = 0; i < old.length; i += 15) {
      await Promise.all(old.slice(i, i + 15).map(d => FB.mutateLead(d.id, () => { }, { a: 'rekey' }).then(() => { out.leads++; }, () => { out.failed++; })));
      n += Math.min(15, old.length - i); if (progress) progress(n, old.length);
    }
    const ik = await FB.db.doc('meta/intake').get();
    if (ik.exists && ik.data().priv.v < FB.curV) {
      const d = ik.data(); const bytes = await Crypto.open(FB.keys[d.priv.v], d.priv, 'intake-priv');
      await FB.db.doc('meta/intake').update({ priv: Object.assign({ v: FB.curV }, await Crypto.seal(FB.keys[FB.curV], bytes, 'intake-priv')) }); out.intake = true;
    }
    const sd = await FB.intakeSecretDoc();
    if (sd && sd.box && sd.box.v < FB.curV) {
      const bytes = await Crypto.open(FB.keys[sd.box.v], sd.box, 'intake-secret');
      await FB.db.doc('meta/intakeSecret').update({ box: Object.assign({ v: FB.curV }, await Crypto.seal(FB.keys[FB.curV], bytes, 'intake-secret')) }); out.intake = true;
    }
    return out;
  },
  /* anything still sealed under an older office key? (a quick check, no decrypting) */
  async oldCount() { return (await FB.db.collection('leads').where('v', '<', FB.curV).get()).size; }
};
