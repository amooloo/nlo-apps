/* =====================================================================
   Firebase: the NLO Cases project (Firestore). Sign-in is NLO Cases'
   (same people, same passwords); nothing is sealed — Inventory holds no
   patient data. The rules (../nlo-cases-src/firestore.rules, "NLO
   Inventory") decide who reads and changes what.
   - one record a supply, an order, a vendor, an expense bought outside
     an order (invItems, invOrders, invVendors, invExpenses); the shared
     cart, the budget amounts, the quick-order prices, the bracket order
     and the settings each one record (invState/…); the activity log one
     record per person per month (invLog/m<YYYY-MM>~<staff id>; the moved
     entries under ~old), entries only ever added
   - every save carries who (upBy, the staff id) and when (up, the
     database's time) and moves the change counter (invState/rev) the
     alert script watches — all in the same save. The rules check the
     names on the steps too: a log entry is whoever's record it's in, an
     order's newest trail step and an expense are the saver's
   - stock counts and the cart change in transactions (two computers at
     once both count); receiving and reopening claim the order first
   - photos are records of their own (invPics), read when shown
   The demo (demo.js) answers the same calls on made-up data.
   ===================================================================== */
const PIC_MAX = 990000;   // a photo's base64 (the rules allow 1,000,000)
const LOG_MONTHS = 36;    // months of the activity log kept open on the page
const FB = {
  emu: false, cfg: null, app: null, auth: null, db: null,
  me: null, unsubs: [], pending: 0, onSync: null, h: null, alertsOn: false, pushOn: false, picCache: new Map(),

  ts() { return firebase.firestore.FieldValue.serverTimestamp(); },
  inc(n) { return firebase.firestore.FieldValue.increment(n); },
  del() { return firebase.firestore.FieldValue.delete(); },
  tsMs(t) { return t && t.toMillis ? t.toMillis() : (typeof t === 'number' ? t : 0); },
  isOwner() { return !!(FB.me && FB.me.role === 'owner'); },
  isPerm(e) { return /permission/i.test((e && (e.code || e.message)) || ''); },
  isNet(e) { return /unavailable|network|offline|timeout|deadline/i.test((e && (e.code || e.message)) || ''); },
  available() { return typeof firebase !== 'undefined' && !!firebase.initializeApp && !!firebase.firestore; },
  configured() { return FB.emu || FB_CONFIG.apiKey.indexOf('__') !== 0; },
  init(emu) {
    FB.emu = !!emu;
    FB.cfg = FB.emu ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-nlo-cases', appId: 'demo' } : FB_CONFIG;
    if (!FB.available() || !FB.configured()) return false;
    // its own named app: NLO Cases' and Time Off's sign-ins on this computer are never touched
    try { FB.app = firebase.app('inv'); } catch (e) { FB.app = firebase.initializeApp(FB.cfg, 'inv'); }
    FB.auth = FB.app.auth(); FB.db = FB.app.firestore();
    if (FB.emu) { FB.auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); FB.db.useEmulator('127.0.0.1', 8080); }
    return true;
  },
  /* never a session across reloads (as NLO Cases): a reload, or the lock, means signing in again */
  async ready() { try { await FB.auth.setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) { } },
  busy(n) { FB.pending += n; if (FB.onSync) FB.onSync(); },
  track(p) { FB.busy(1); return Promise.resolve(p).finally(() => FB.busy(-1)); },

  /* ---------- signing in (same logins as NLO Cases) ---------- */
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
    return FB.loadMe(cred.user);
  },
  async loadMe(user) {
    const ms = await FB.db.doc('members/' + user.uid).get();
    if (!ms.exists) { await FB.signOut(); throw errCode('not-member'); }
    const m = ms.data();
    if (m.active !== true) { await FB.signOut(); throw errCode('inactive'); }
    if (m.mustSetup) { await FB.signOut(); throw errCode('first-login'); }
    FB.me = { uid: user.uid, staffId: String(m.staffId || ''), role: m.role === 'owner' ? 'owner' : 'staff', name: String(m.name || ''), email: String(user.email || '') };
    FB.db.doc('members/' + user.uid).update({ lastLogin: FB.ts() }).catch(() => { });
    return FB.me;
  },
  async signOut() { FB.stop(); FB.me = null; FB.alertsOn = false; FB.pushOn = false; FB.picCache = new Map(); try { await FB.auth.signOut(); } catch (e) { } },
  sendReset(email) { return FB.auth.sendPasswordResetEmail(String(email || '').trim()); },

  /* ---------- opening: 'rules' (the database's rules don't know Inventory yet) | 'move' (Dr. A: nothing moved over yet) |
     'notyet' (staff: not moved over yet) | 'ready' ---------- */
  async open() {
    try { await FB.db.doc('meta/rules_inv_1').get(); } catch (e) { if (FB.isPerm(e)) return { st: 'rules' }; throw e; }
    const mv = await FB.db.doc('invMeta/moved').get();
    if (!mv.exists) return { st: FB.isOwner() ? 'move' : 'notyet' };
    const d = mv.data() || {};
    return { st: 'ready', moved: { at: FB.tsMs(d.up) || Number(d.at) || 0, by: d.by || '', counts: d.counts || {} } };
  },

  /* ---------- reading: everything live ---------- */
  plain(snap) { const d = Object.assign({}, snap.data() || {}); delete d.up; delete d.upBy; return d; },
  start(h) {
    FB.stop(); FB.h = h;
    const on = (ref, fn, key) => FB.unsubs.push(ref.onSnapshot(fn, e => h.error(key, e)));
    const coll = (name, key) => on(FB.db.collection(name), s => h.data(key, s.docs.map(d => Object.assign(FB.plain(d), { id: (d.data() || {}).id != null ? d.data().id : d.id }))), key);
    coll('invItems', 'items'); coll('invOrders', 'orders'); coll('invVendors', 'vendors');
    coll('invExpenses', 'expenses');
    // the activity log: the last three years of months (older months stay in the database). Whose record an entry is in says
    // who made it (the rules let each person add only to their own); the moved entries keep the old app's stamps.
    on(FB.db.collection('invLog').where('mon', '>=', shiftMonth(monthKey(Date.now()), -LOG_MONTHS)), s => h.data('log', FB.logEntries(s.docs.map(d => d.data()))), 'log');
    const one = (path, key, pick) => on(FB.db.doc(path), s => h.data(key, s.exists ? pick(FB.plain(s)) : null), key);
    // the cart's lines, and Dr. A's OK on the ones he approved (by line id)
    on(FB.db.doc('invState/cart'), s => { const d = s.exists ? FB.plain(s) : {}; h.data('cartOk', d.ok && typeof d.ok === 'object' ? d.ok : {}); h.data('cart', d.lines || []); }, 'cart');
    one('invState/bracket', 'bracketOrder', d => d.v || null);
    one('invState/budget', 'budget', d => d);
    one('invState/prices', 'elastoPrices', d => d.p || {});
    one('invState/settings', 'settings', d => { FB.alertsOn = d.alertsOn === true; FB.pushOn = d.pushOn === true; return d; });
    // NLO Cases' people (names and photos), its idle lock, and this login (turned off → locked out)
    FB.unsubs.push(FB.db.collection('roster').onSnapshot(s => h.data('roster', s.docs.map(d => Object.assign({ sid: d.id }, d.data()))), e => { console.warn('roster', e); h.data('roster', null); }));
    FB.unsubs.push(FB.db.doc('meta/settings').onSnapshot(s => h.data('cases', s.exists ? s.data() : {}), () => { }));
    FB.unsubs.push(FB.db.doc('members/' + FB.me.uid).onSnapshot(s => { if (!s.exists || s.data().active !== true) h.revoked(); }, e => { if (FB.isPerm(e)) h.revoked(); }));
  },
  /* the log records → their entries */
  logEntries(recs) {
    const all = [];
    (recs || []).forEach(r => {
      const who = String((r && r.who) || ''), e = (r && r.e) || {};
      Object.keys(e).forEach(k => { const x = e[k]; if (!x || typeof x !== 'object') return; const o = Object.assign({}, x, { id: x.id || k }); if (who && !/^old\d*$/.test(who)) o.byId = who; all.push(o); });
    });
    return all;
  },
  stop() { FB.unsubs.forEach(u => { try { u(); } catch (e) { } }); FB.unsubs = []; },

  /* ---------- writing ---------- */
  st() { return { up: FB.ts(), upBy: FB.me.staffId }; },
  /* the change counter, in the same save (a batch or a transaction) */
  bump(w) { w.set(FB.db.doc('invState/rev'), Object.assign({ n: FB.inc(1) }, FB.st()), { merge: true }); },
  save(build) { const b = FB.db.batch(); build(b); FB.bump(b); return FB.track(b.commit()); },
  /* fn(t) reads, then writes and returns what it wants back; returning FB.SKIP (or anything with skip: true) writes nothing */
  SKIP: { skip: true },
  /* (a transaction needs the database itself: with no internet it says so at once, and a very slow one is reported, not waited
     out — the error's .late is the transaction itself, for a step that has to finish its work if it goes through after all) */
  txn(fn) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.reject(errCode('unavailable', 'Can’t reach the database. Check the internet connection.'));
    const run = FB.db.runTransaction(async t => { const r = await fn(t); if (!(r && r.skip === true)) FB.bump(t); return r; });
    run.catch(() => { });
    let timer;
    const slow = new Promise((res, rej) => { timer = setTimeout(() => { const e = errCode('timeout'); e.late = run; rej(e); }, FB.TXN_MS); });
    return FB.track(Promise.race([run, slow]).finally(() => clearTimeout(timer)));
  },
  TXN_MS: 30000,
  /* what the database takes: no undefined, no NaN, no nulls kept (as the old database dropped them), no list inside a list */
  clean(v) {
    if (v === undefined) return null;
    const tidy = x => {
      if (x == null) return null;
      if (Array.isArray(x)) return x.filter(y => y != null).map(y => Array.isArray(y) ? Object.assign({}, y.map(tidy)) : tidy(y));
      if (typeof x === 'object') { const o = {}; Object.keys(x).forEach(k => { const c = tidy(x[k]); if (c != null) o[k] = c; }); return o; }
      if (typeof x === 'number' && !isFinite(x)) return null;
      return x;
    };
    return tidy(JSON.parse(JSON.stringify(v)));
  },
  /* a patch, the old database's way: each top-level field replaced as a whole, a null one removed, nothing else touched */
  patchOf(patch) { const o = {}; Object.keys(patch || {}).forEach(k => { const v = patch[k] === undefined ? null : FB.clean(patch[k]); o[k] = v == null ? FB.del() : v; }); return o; },
  setPatch(w, ref, patch, extra) {
    const data = Object.assign(FB.patchOf(patch), extra || {}, FB.st());
    w.set(ref, data, { mergeFields: Object.keys(data) });
  },
  itemRef(id) { return FB.db.doc('invItems/' + id); },
  orderRef(id) { return FB.db.doc('invOrders/' + id); },
  vendorRef(id) { return FB.db.doc('invVendors/' + id); },
  logRef(mon, who) { return FB.db.doc('invLog/m' + mon + '~' + who); },
  logMonth(e) { const k = monthKey(e && e.date); return /^\d{4}-\d{2}$/.test(k) ? k : monthKey(Date.now()); },

  /* add (or take away) stock without overwriting what another computer just did */
  addStock(itemId, delta) {
    return FB.txn(async t => {
      const ref = FB.itemRef(itemId), s = await t.get(ref);
      if (!s.exists) throw errCode('not-found', 'That supply is gone.');
      const qty = Math.max(0, Math.round(((Number(s.data().qty) || 0) + delta) * 1000) / 1000);
      t.update(ref, Object.assign({ qty }, FB.st()));
      return qty;
    });
  },
  /* several supplies' stock in one step (receiving or reopening an order): [[itemId, delta], …]; a supply that's gone is skipped */
  addStockMany(pairs) {
    const sum = {}; (pairs || []).forEach(([id, d]) => { if (id && Number(d)) sum[id] = (sum[id] || 0) + Number(d); });
    const ids = Object.keys(sum); if (!ids.length) return Promise.resolve({});
    return FB.txn(async t => {
      const snaps = await Promise.all(ids.map(id => t.get(FB.itemRef(id)))), out = {};
      snaps.forEach((s, k) => {
        if (!s.exists) { console.warn('stock: supply gone', ids[k]); return; }
        out[ids[k]] = Math.max(0, Math.round(((Number(s.data().qty) || 0) + sum[ids[k]]) * 1000) / 1000);
        t.update(FB.itemRef(ids[k]), Object.assign({ qty: out[ids[k]] }, FB.st()));
      });
      return Object.keys(out).length ? out : FB.SKIP;
    });
  },
  /* several supplies' details in one save: [[itemId, patch], …] */
  patchItems(list) {
    list = (list || []).filter(x => x && x[0]); if (!list.length) return Promise.resolve();
    return FB.save(b => list.forEach(([id, patch]) => FB.setPatch(b, FB.itemRef(id), patch)));
  },
  setStock(itemId, qty) { return FB.save(b => b.update(FB.itemRef(itemId), Object.assign({ qty }, FB.st()))); },
  patchItem(id, patch) { return FB.save(b => FB.setPatch(b, FB.itemRef(id), patch)); },
  putItem(item) { return FB.save(b => b.set(FB.itemRef(item.id), Object.assign(FB.clean(item), FB.st()))); },
  patchOrder(id, patch) { return FB.save(b => FB.setPatch(b, FB.orderRef(id), patch)); },
  putOrder(o) { return FB.save(b => b.set(FB.orderRef(o.id), Object.assign(FB.clean(o), FB.st()))); },
  /* an order's status, in one step: fn(current) gives the new one, or undefined to leave it (then this fails 'aborted');
     patchFn(the order as it is now) gives what else changes with it (a receipt, a reopen), in the same step */
  claimOrder(id, fn, patchFn) {
    return FB.txn(async t => {
      const ref = FB.orderRef(id), s = await t.get(ref), cur = s.exists ? s.data() : null;
      const next = cur ? fn(cur.status) : undefined;
      if (next === undefined) throw errCode('aborted', 'That change didn’t go through. Try again.');
      t.update(ref, Object.assign(patchFn ? FB.patchOf(patchFn(Object.assign({}, cur))) : {}, { status: next }, FB.st()));
      return next;
    });
  },
  /* an order changed in one step from what the database has now: fn(the order now) → the patch (a step on its trail made
     from the trail as it is), or undefined when it no longer applies (then this fails 'aborted') */
  orderStep(id, fn) {
    return FB.txn(async t => {
      const ref = FB.orderRef(id), s = await t.get(ref);
      if (!s.exists) throw errCode('not-found', 'That order is gone.');
      const p = fn(Object.assign({}, s.data()));
      if (p === undefined) throw errCode('aborted', 'That order just changed on another computer. Look at it again.');
      t.update(ref, Object.assign(FB.patchOf(p), FB.st()));
      return p;
    });
  },
  /* a receipt or a reopen, all in one step — it all happens, or none of it:
     claim(the order now) → the order's patch, status included, or undefined when it can't (fails 'aborted'); claimId marks
     the order as this step's, so if its reply is lost and the step is tried again, it finds itself done ({ skip, mine });
     o.stock { itemId: delta } (a supply that's gone is skipped), o.items(itemId, the supply now) → more for that supply,
     o.log entries for the signed-in person's log record, o.orders new orders (a backorder) */
  book(id, claimId, claim, o) {
    o = o || {};
    return FB.txn(async t => {
      const ref = FB.orderRef(id), s = await t.get(ref), cur = s.exists ? s.data() : null;
      if (cur && claimId && cur.claim === claimId) return { skip: true, mine: true };
      const p = cur ? claim(Object.assign({}, cur)) : undefined;
      if (p === undefined) throw errCode('aborted', 'That change didn’t go through. Try again.');
      const ids = Object.keys(o.stock || {}).filter(k => k && Number(o.stock[k]));
      const snaps = await Promise.all(ids.map(k => t.get(FB.itemRef(k))));
      t.update(ref, Object.assign(FB.patchOf(p), claimId ? { claim: claimId } : {}, FB.st()));
      snaps.forEach((sn, k) => {
        if (!sn.exists) { console.warn('stock: supply gone', ids[k]); return; }
        const it = sn.data(), qty = Math.max(0, Math.round(((Number(it.qty) || 0) + Number(o.stock[ids[k]])) * 1000) / 1000);
        const more = o.items ? o.items(ids[k], Object.assign({}, it)) : null;
        t.update(FB.itemRef(ids[k]), Object.assign(FB.patchOf(more || {}), { qty }, FB.st()));
      });
      const who = FB.me.staffId, months = {};
      (o.log || []).filter(Boolean).forEach(e => { const m = FB.logMonth(e); (months[m] = months[m] || {})[e.id] = FB.clean(Object.assign({}, e, { byId: who })); });
      Object.keys(months).forEach(m => t.set(FB.logRef(m, who), Object.assign({ e: months[m], mon: m, who }, FB.st()), { merge: true }));
      (o.orders || []).forEach(n => t.set(FB.orderRef(n.id), Object.assign(FB.clean(n), FB.st())));
      return { done: true };
    });
  },
  putVendor(v) { return FB.save(b => b.set(FB.vendorRef(v.id), Object.assign(FB.clean(v), FB.st()))); },
  /* a built-in vendor has no record until something about it is saved: this makes one */
  patchVendor(id, patch) { return FB.save(b => FB.setPatch(b, FB.vendorRef(id), patch, { id })); },
  /* the cart is one list everyone shares: every change is made to the latest copy. fn(lines, ok, also) gets the lines and
     Dr. A's OKs (by line id) and returns the lines; only he adds to or changes ok (the rules hold everyone else to that), and an
     OK whose line is gone (ordered, taken out) comes off with it. also.orders: orders saved in the same step (placing one) */
  cart(fn) {
    return FB.txn(async t => {
      const ref = FB.db.doc('invState/cart'), s = await t.get(ref), d = s.exists ? s.data() : {};
      const ok = Object.assign({}, d.ok && typeof d.ok === 'object' ? d.ok : {}), also = {};
      const next = fn(listOf(d.lines).map(x => withLineId(Object.assign({}, x))), ok, also);
      if (next === undefined) return FB.SKIP;
      const list = listOf(next), live = new Set(list.map(c => c && c.lineId).filter(Boolean));
      Object.keys(ok).forEach(k => { if (!live.has(k)) delete ok[k]; });
      t.set(ref, Object.assign({ lines: FB.clean(list) || [], ok: FB.clean(ok) || {} }, FB.st()));
      (also.orders || []).forEach(o => t.set(FB.orderRef(o.id), Object.assign(FB.clean(o), FB.st())));
      return next;
    });
  },
  /* the activity log only grows: each entry goes into the signed-in person's record for its month */
  addLog(entries) {
    entries = (entries || []).filter(Boolean); if (!entries.length) return Promise.resolve();
    const who = FB.me.staffId, months = {};
    entries.forEach(e => { const m = FB.logMonth(e); (months[m] = months[m] || {})[e.id] = FB.clean(Object.assign({}, e, { byId: who })); });
    return FB.save(b => Object.keys(months).forEach(m => b.set(FB.logRef(m, who), Object.assign({ e: months[m], mon: m, who }, FB.st()), { merge: true })));
  },
  removeLog() { return Promise.resolve(); },  // (nothing leaves the log any more)
  trimLog() { return Promise.resolve(); },
  budget(patch) { return FB.save(b => FB.setPatch(b, FB.db.doc('invState/budget'), patch)); },
  /* an expense bought outside an order: a record of its own, in the name of whoever adds it */
  addExpense(x) { return FB.save(b => b.set(FB.db.doc('invExpenses/' + x.id), Object.assign(FB.clean(Object.assign({}, x, { byId: FB.me.staffId })), FB.st()))); },
  removeExpense(id) { return FB.save(b => b.delete(FB.db.doc('invExpenses/' + id))); },
  setElastoPrice(sku, price) { return FB.save(b => b.set(FB.db.doc('invState/prices'), Object.assign({ p: { [fbKey(sku)]: { price: round2(price), date: todayISO() } } }, FB.st()), { merge: true })); },
  bracketOrder(v) { return FB.save(b => b.set(FB.db.doc('invState/bracket'), Object.assign({ v: FB.clean(v) || null }, FB.st()))); },
  /* settings: the AI keys in their own record (only Dr. A sets them); the rest in invState/settings */
  AI_FIELDS: { geminiKey: 'gemini', openaiKey: 'openai' },
  setSetting(k, v) {
    if (FB.AI_FIELDS[k]) return FB.save(b => FB.setPatch(b, FB.db.doc('invState/ai'), { [FB.AI_FIELDS[k]]: v }));
    return FB.save(b => FB.setPatch(b, FB.db.doc('invState/settings'), { [k]: v }));
  },
  /* the AI keys are read only when a step needs them, and never kept on the computer */
  async getSetting(k) {
    if (FB.AI_FIELDS[k]) { const s = await FB.db.doc('invState/ai').get(); return s.exists ? (s.data()[FB.AI_FIELDS[k]] || null) : null; }
    return (S.settings || {})[k] == null ? null : S.settings[k];
  },
  /* a photo: a record of its own (read when it's shown); the item or order keeps "pic:<id>" */
  async uploadPhoto(itemId, blob, which) {
    const m = /png/.test(blob.type) ? 'image/png' : /webp/.test(blob.type) ? 'image/webp' : 'image/jpeg';
    const b64 = await blobBase64(blob);
    if (b64.length > PIC_MAX) throw errCode('too-big', 'That photo is too big to save. Try a smaller one.');
    const id = 'p' + uid();
    await FB.save(b => b.set(FB.db.doc('invPics/' + id), Object.assign({ m, b: b64, kind: which === 'full' ? 'full' : 'thumb' }, FB.st())));
    FB.picCache.set(id, Promise.resolve('data:' + m + ';base64,' + b64));
    return { url: 'pic:' + id, path: 'pic:' + id };
  },
  /* "pic:<id>" → a data: URL ('' when it's gone) */
  pic(ref) {
    const id = String(ref || '').replace(/^pic:/, '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return Promise.resolve('');
    if (!FB.picCache.has(id)) FB.picCache.set(id, FB.db.doc('invPics/' + id).get().then(s => s.exists ? 'data:' + s.data().m + ';base64,' + s.data().b : '').catch(e => { FB.picCache.delete(id); console.warn('photo', id, e); return ''; }));
    return FB.picCache.get(id);
  },
  dropPic(ref) { const id = String(ref || '').replace(/^pic:/, ''); if (!/^p[A-Za-z0-9_-]+$/.test(id)) return Promise.resolve(); FB.picCache.delete(id); return FB.track(FB.db.doc('invPics/' + id).delete()); },
  /* the "NLO Inventory Alerts" script emails Dr. A what's left here (while the email alerts are on), and pushes the cart adds
     to his phone (while the push is on; his own adds aren't pushed) */
  alert(events) {
    const list = (events || []).filter(e => e && (e.t === 'cart' && FB.pushOn ? !FB.isOwner() : FB.alertsOn));
    if (!list.length) return;
    FB.save(b => list.forEach(e => b.set(FB.db.collection('invAlerts').doc(), Object.assign(FB.clean(e), FB.st())))).catch(err => console.warn('[alerts] not saved', err));
  },
  /* ---------- Dr. A's phone push (ntfy): the topic is his and the alert script's alone ---------- */
  async getPush() { const s = await FB.db.doc('invState/push').get(); return s.exists ? { topic: String(s.data().topic || ''), test: Number(s.data().test) || 0 } : { topic: '', test: 0 }; },
  /* the Time Clock's topic, if its phone push is set up (the same app on his phone, nothing new to subscribe to) */
  async timeClockTopic() { try { const s = await FB.db.doc('meta/tcAlerts').get(); return s.exists && typeof s.data().topic === 'string' ? s.data().topic : ''; } catch (e) { return ''; } },
  /* a topic turns the push on ('' turns it off; the topic is kept for next time) */
  setPush(topic) {
    if (!FB.isOwner()) return Promise.reject(errCode('permission'));
    return FB.save(b => {
      if (topic) FB.setPatch(b, FB.db.doc('invState/push'), { topic });
      FB.setPatch(b, FB.db.doc('invState/settings'), { pushOn: !!topic });
    });
  },
  /* the alert script sends a test push within a minute */
  testPush() { return FB.save(b => FB.setPatch(b, FB.db.doc('invState/push'), { test: Date.now() })); },

  /* ---------- Dr. A: the alert script's own login (a new one each time; the one before keeps working until the new copy runs) ---------- */
  async makeBot() {
    if (!FB.isOwner()) throw errCode('permission');
    const email = 'inv-alerts-' + hexId(6) + '@' + STAFF_DOMAIN, password = randomPassword();
    const tmp = firebase.initializeApp(FB.cfg, 'invBot' + hexId(4));
    let uid;
    try {
      if (FB.emu) tmp.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      await tmp.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
      uid = (await FB.track(tmp.auth().createUserWithEmailAndPassword(email, password))).user.uid;
      await tmp.auth().signOut();
    } finally { tmp.delete().catch(() => { }); }
    const [bots, beats] = await Promise.all([FB.db.collection('invBots').get(), FB.db.collection('invBeat').get()]);
    const beatAt = {}; beats.docs.forEach(d => { beatAt[d.id] = FB.tsMs(d.data().at); });
    const old = bots.docs.map(d => ({ ref: d.ref, at: FB.tsMs(d.data().at), beat: beatAt[d.id] || 0 }));
    // the one kept is the copy running now (the login that checked in last; with no check-in yet, the newest); others stop
    const keep = old.slice().sort((a, z) => (z.beat - a.beat) || (z.at - a.at))[0];
    const b = FB.db.batch();
    b.set(FB.db.doc('invBots/' + uid), { email, at: FB.ts() });
    old.forEach(x => { if (x !== keep) b.delete(x.ref); });
    await FB.track(b.commit());
    return { email, password, uid };
  },
  /* when the alert script last checked (null: never) */
  async beat() {
    const s = await FB.db.collection('invBeat').get();
    const list = s.docs.map(d => Object.assign({ uid: d.id }, d.data(), { at: FB.tsMs(d.data().at) })).sort((a, z) => z.at - a.at);
    return list[0] || null;
  },

  /* ---------- the one-time move (move.js): many records in a few saves ----------
     writes: [[path, data, merge]]; each save stays well inside what one request may carry (10 MiB, 500 writes) */
  MOVE_BYTES: 8 * 1024 * 1024, MOVE_OPS: 400,
  async moveWrite(writes, onStep) {
    const enc = new TextEncoder(); let done = 0, part = [], size = 0;
    const flush = async () => {
      if (!part.length) return;
      const p = part; part = []; size = 0;
      await FB.save(b => p.forEach(([path, data, merge]) => b.set(FB.db.doc(path), Object.assign({}, data, FB.st()), merge ? { merge: true } : {})));
      done += p.length; if (onStep) onStep(done, writes.length);
    };
    for (const w of writes) {
      const n = enc.encode(JSON.stringify(w[1])).length + w[0].length + 300;
      if (part.length && (size + n > FB.MOVE_BYTES || part.length >= FB.MOVE_OPS)) await flush();
      part.push(w); size += n;
    }
    await flush();
  },
  /* which of these photo records are already saved */
  async havePics(ids) {
    const have = new Set();
    for (let i = 0; i < ids.length; i += 30) {
      const part = ids.slice(i, i + 30); if (!part.length) continue;
      const s = await Promise.all(part.map(id => FB.db.doc('invPics/' + id).get().catch(() => null)));
      s.forEach((d, k) => { if (d && d.exists) have.add(part[k]); });
    }
    return have;
  },
  /* what's saved here now: the records' ids, and each log record's entries (the move adds only what's missing, then looks
     for every record it meant to save) */
  async moveState() {
    const [it, or, ve, ex, lg] = await Promise.all(['invItems', 'invOrders', 'invVendors', 'invExpenses', 'invLog'].map(c => FB.db.collection(c).get()));
    const ids = s => new Set(s.docs.map(d => d.id)), log = {};
    lg.docs.forEach(d => { log[d.id] = (d.data() || {}).e || {}; });
    return { items: ids(it), orders: ids(or), vendors: ids(ve), expenses: ids(ex), log };
  },
  async markMoved(info) { await FB.save(b => b.set(FB.db.doc('invMeta/moved'), Object.assign({}, FB.clean(info), FB.st()))); }
};
function blobBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).slice(String(r.result).indexOf(',') + 1)); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
