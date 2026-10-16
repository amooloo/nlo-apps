/* =====================================================================
   Firebase: Google sign-in (office accounts only) and the Realtime
   Database at nlo/*. Every write touches only what changed:
   - one record at a time for items, orders and vendors (never a whole list)
   - stock counts change by a transaction (two computers receiving at once
     both count), and so does the cart (two people adding at once both stay)
   - the activity log only grows here; old entries are trimmed the same way
     the old app trimmed them (receipts kept first)
   The same calls are made by the demo backend (demo.js) on made-up data.
   ===================================================================== */
const NODES = ['items', 'orders', 'vendors', 'log', 'cart', 'bracketOrder', 'budget', 'elastoPrices'];
/* the quick-order price list isn't in the database rules published in Sept 2026: until it is, it reads as empty — noted on Quick order, not a red banner on every screen */
const OPTIONAL_NODES = ['elastoPrices'];
const ALERT_QUEUE = 'nlo/settings/alertQueue';
const FB = {
  app: null, db: null, user: null, pending: 0, subs: [], userCbs: [], started: false, alertsOn: false,
  init(emu) {
    if (!window.firebase || !firebase.initializeApp) return false;
    try { FB.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FB_CONFIG); } catch (e) { console.error(e); return false; }
    FB.db = firebase.database();
    firebase.auth().onAuthStateChanged(u => { FB.user = u || null; FB.userCbs.forEach(cb => cb(FB.user)); });
    firebase.auth().getRedirectResult && firebase.auth().getRedirectResult().catch(e => console.warn('redirect sign-in', e));
    return true;
  },
  onUser(cb) { FB.userCbs.push(cb); cb(undefined); },
  allowed(u) { return !!u && !!u.email && ALLOWED_EMAILS.includes(String(u.email).toLowerCase()) && u.emailVerified !== false; },
  async signIn() {
    const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    try { await firebase.auth().signInWithPopup(p); }
    catch (e) { if (/popup-blocked|operation-not-supported/.test(e && e.code || '')) return firebase.auth().signInWithRedirect(p); throw e; }
  },
  signOut() { FB.stop(); return firebase.auth().signOut(); },

  /* ---------- reading ---------- */
  start(h) {
    FB.stop(); FB.started = true; FB.h = h;
    let loaded = 0;
    const listen = (path, key, required) => {
      const ref = FB.db.ref(path); let first = true;
      const cb = ref.on('value', snap => {
        h.data(key, snap.val());
        if (first) { first = false; if (required && ++loaded === NODES.length) h.loaded(); }
      }, err => { if (OPTIONAL_NODES.includes(key)) { console.warn(key, err); if (h.soft) h.soft(key, err); } else h.error(key, err); if (first && required) { first = false; h.data(key, null); if (++loaded === NODES.length) h.loaded(); } });
      FB.subs.push(() => ref.off('value', cb));
    };
    NODES.forEach(k => listen('nlo/' + k, k, true));
    /* settings: each piece on its own (the alert queue lives under settings too, and isn't wanted here) */
    const set = {};
    ['locations', 'invAdmins', 'alertsOn', 'geminiProxyUrl', 'invPrefs'].forEach(k => {
      const ref = FB.db.ref('nlo/settings/' + k);
      const cb = ref.on('value', s => { set[k] = s.val(); if (k === 'alertsOn') FB.alertsOn = s.val() === true; h.data('settings', Object.assign({}, set)); }, () => { });
      FB.subs.push(() => ref.off('value', cb));
    });
    const roster = FB.db.ref('nlo/cadence/roster');
    const rcb = roster.on('value', s => h.data('roster', s.val()), e => { console.warn('roster', e); h.data('roster', null); });
    FB.subs.push(() => roster.off('value', rcb));
    const con = FB.db.ref('.info/connected');
    const ccb = con.on('value', s => h.online(s.val() === true));
    FB.subs.push(() => con.off('value', ccb));
  },
  stop() { FB.subs.forEach(f => { try { f(); } catch (e) { } }); FB.subs = []; FB.started = false; },
  /* the AI keys are read only when they're needed, and never kept on the computer */
  async getSetting(k) { const s = await FB.db.ref('nlo/settings/' + k).once('value'); return s.val(); },

  /* ---------- writing ---------- */
  track(p) { FB.pending++; renderSync(); return Promise.resolve(p).finally(() => { FB.pending--; renderSync(); }); },
  update(path, patch) { return FB.track(FB.db.ref(path).update(fbSafe(patch))); },
  set(path, v) { return FB.track(FB.db.ref(path).set(fbSafe(v))); },
  tx(path, fn) {
    return FB.track(FB.db.ref(path).transaction(cur => fbSafe(fn(cur)))).then(r => { if (r && r.committed === false) throw new Error('That change didn’t go through. Try again.'); return r; });
  },
  /* add (or take away) stock without overwriting what another computer just did */
  addStock(itemId, delta) { return FB.tx('nlo/items/' + itemId + '/qty', cur => Math.max(0, Math.round(((Number(cur) || 0) + delta) * 1000) / 1000)); },
  setStock(itemId, qty) { return FB.set('nlo/items/' + itemId + '/qty', qty); },
  patchItem(id, patch) { return FB.update('nlo/items/' + id, patch); },
  putItem(item) { return FB.set('nlo/items/' + item.id, item); },
  patchOrder(id, patch) { return FB.update('nlo/orders/' + id, patch); },
  putOrder(o) { return FB.set('nlo/orders/' + o.id, o); },
  putVendor(v) { return FB.set('nlo/vendors/' + v.id, v); },
  patchVendor(id, patch) { return FB.update('nlo/vendors/' + id, patch); },
  /* the cart is one list everyone shares: every change is made to the latest copy */
  cart(fn) { return FB.tx('nlo/cart', cur => fn(listOf(cur))); },
  addLog(entries) {
    entries = (entries || []).filter(Boolean); if (!entries.length) return Promise.resolve();
    const up = {}; entries.forEach(e => { up[e.id] = e; });
    return FB.update('nlo/log', up).then(() => FB.trimLog());
  },
  removeLog(ids) { const up = {}; ids.forEach(id => { up[id] = null; }); return FB.update('nlo/log', up); },
  /* the same trim as before: keep receipts first, never more than ~40% in one go */
  trimLog() {
    const all = S.D.log; if (all.length <= LOG_CAP) return Promise.resolve();
    const keep = new Set(pruneLog(all).map(e => e.id)), gone = all.filter(e => !keep.has(e.id)).map(e => e.id);
    return gone.length ? FB.removeLog(gone) : Promise.resolve();
  },
  budget(patch) { return FB.update('nlo/budget', patch); },
  budgetTx(key, fn) { return FB.tx('nlo/budget/' + key, cur => fn(cur)); },
  setElastoPrice(sku, price) { return FB.set('nlo/elastoPrices/' + fbKey(sku), { price: round2(price), date: todayISO() }); },
  bracketOrder(v) { return FB.set('nlo/bracketOrder', v || null); },
  setSetting(k, v) { return FB.set('nlo/settings/' + k, v); },
  /* a photo: to Cloud Storage, so it isn't downloaded with every item on every computer */
  /* same folder the old app's photo optimizer used (itemPhotos/), so the storage rules already allow it */
  async uploadPhoto(itemId, blob, which) {
    const ext = /png/.test(blob.type) ? 'png' : /jpe?g/.test(blob.type) ? 'jpg' : 'webp';
    const path = 'itemPhotos/' + itemId + '-' + Date.now().toString(36) + (which === 'full' ? '_full' : '') + '.' + ext;
    const ref = firebase.storage().ref(path);
    await FB.track(ref.put(blob, { contentType: blob.type || 'image/webp', cacheControl: 'public,max-age=31536000' }));
    return { url: await ref.getDownloadURL(), path };
  },
  /* the "NLO Inventory Alerts" script emails Dr. A whatever is queued here (when alerts are on) */
  alert(events) {
    if (!FB.alertsOn || !events || !events.length) return;
    const ref = FB.db.ref(ALERT_QUEUE);
    events.forEach(e => { try { const r = ref.push(fbSafe(e)); if (r && typeof r.catch === 'function') r.catch(err => console.warn('[alerts] queue write failed', err)); } catch (err) { console.warn('[alerts] queue write failed', err); } });
  }
};
