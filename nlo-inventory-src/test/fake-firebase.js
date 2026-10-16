/* A stand-in for the Firebase compat SDK (app, auth, Realtime Database, Storage) for testing NLO Inventory offline:
   an in-memory tree in window.__FAKE.store, a signed-in window.__FAKE.user ({ email, uid, emailVerified }),
   window.__FAKE.deny(path, 'read'|'write') to refuse access, window.__FAKE.log for the writes made, and
   window.__FAKE.offline = true to hold writes back. Based on the one NLO Time Off's tests use, plus transactions,
   .info/connected and Storage. */
(function () {
  if (window.firebase) return;
  var H = window.__FAKE = window.__FAKE || {};
  H.store = H.store || {}; H.log = H.log || []; H.files = H.files || {};
  var listeners = [];
  function norm(p) { return String(p || '').replace(/^\/+|\/+$/g, ''); }
  function parts(p) { return norm(p).split('/').filter(Boolean); }
  function clone(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }
  function getAt(p) { if (norm(p) === '.info/connected') return !H.offline; var o = H.store; var ks = parts(p); for (var i = 0; i < ks.length; i++) { if (o == null || typeof o !== 'object') return null; o = o[ks[i]]; } return o === undefined ? null : o; }
  function resolve(v) { if (v && typeof v === 'object') { if (v['.sv'] === 'timestamp') return Date.now(); var o = Array.isArray(v) ? [] : {}; for (var k in v) o[k] = resolve(v[k]); return o; } return v; }
  /* Firebase never stores empty objects or arrays; arrays come back as arrays when their keys are 0..n-1 */
  function tidy(v) {
    if (v == null) return null;
    if (typeof v !== 'object') return v;
    var keys = Object.keys(v), o = {}, n = 0;
    keys.forEach(function (k) { var c = tidy(v[k]); if (c != null) { o[k] = c; n++; } });
    if (!n) return null;
    var ks = Object.keys(o), isArr = ks.every(function (k, i) { return String(i) === k; });
    if (Array.isArray(v) || isArr) { if (isArr) return ks.map(function (k) { return o[k]; }); }
    return o;
  }
  function setAt(p, v) {
    v = tidy(v);
    var ks = parts(p); if (!ks.length) { H.store = v && typeof v === 'object' ? v : {}; return; }
    var o = H.store, trail = [];
    for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') { if (v == null) return; o[ks[i]] = {}; } trail.push([o, ks[i]]); o = o[ks[i]]; }
    if (v == null) { if (Array.isArray(o)) o[ks[ks.length - 1]] = undefined; delete o[ks[ks.length - 1]]; for (var j = trail.length - 1; j >= 0; j--) { var t = trail[j]; if (Object.keys(t[0][t[1]]).filter(function (k) { return t[0][t[1]][k] != null; }).length === 0) delete t[0][t[1]]; else break; } }
    else o[ks[ks.length - 1]] = v;
  }
  function snap(p) { var v = clone(getAt(p)); if (v && typeof v === 'object' && !Array.isArray(v)) v = tidy(v); return { key: parts(p).pop() || null, val: function () { return v; }, exists: function () { return v != null; },
    child: function (c) { return snap(norm(p) + '/' + c); }, forEach: function (fn) { if (v && typeof v === 'object') { var ks = Object.keys(v); for (var i = 0; i < ks.length; i++) if (fn(snap(norm(p) + '/' + ks[i])) === true) return true; } return false; } }; }
  function related(a, b) { a = norm(a); b = norm(b); return a === b || !a || !b || a.indexOf(b + '/') === 0 || b.indexOf(a + '/') === 0; }
  function notify(changed) { listeners.slice().forEach(function (l) { if (related(l.path, changed)) setTimeout(function () { if (listeners.indexOf(l) >= 0) l.cb(snap(l.path)); }, 0); }); }
  H.notifyAll = function () { listeners.slice().forEach(function (l) { setTimeout(function () { if (listeners.indexOf(l) >= 0) l.cb(snap(l.path)); }, 0); }); };
  /* a change made by "another computer" */
  H.remote = function (path, v) { setAt(path, clone(v)); notify(path); };
  function denied(p, how) { return !!(H.deny && H.deny(norm(p), how)); }
  function hold(fn) { if (!H.offline) return fn(); return new Promise(function (res, rej) { (H.queue = H.queue || []).push(function () { fn().then(res, rej); }); }); }
  H.goOnline = function () { H.offline = false; var q = H.queue || []; H.queue = []; q.forEach(function (f) { f(); }); notify('.info/connected'); };
  function ref(path) {
    path = norm(path);
    var r = {
      key: parts(path).pop() || null, path: path, toString: function () { return 'fake://' + path; },
      child: function (c) { return ref(path + '/' + c); },
      on: function (ev, cb, err) { if (denied(path, 'read')) { if (err) setTimeout(function () { err(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); }, 0); return cb; } listeners.push({ path: path, cb: cb }); setTimeout(function () { cb(snap(path)); }, 0); return cb; },
      off: function (ev, cb) { for (var i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === path && (!cb || listeners[i].cb === cb)) listeners.splice(i, 1); },
      once: function () { if (denied(path, 'read')) return Promise.reject(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); H.log.push(['once', path]); return Promise.resolve(snap(path)); },
      set: function (v) { if (denied(path, 'write')) return Promise.reject(new Error('PERMISSION_DENIED')); if (v === undefined || JSON.stringify(v) === undefined || /undefined/.test(String(H.strict && JSON.stringify(v, function (k, x) { return x === undefined ? 'undefined!' : x; })))) { if (H.strict) throw new Error('set failed: value argument contains undefined'); }
        return hold(function () { H.log.push(['set', path, clone(v)]); setAt(path, resolve(clone(v))); notify(path); return Promise.resolve(); }); },
      update: function (o) { if (denied(path, 'write')) return Promise.reject(new Error('PERMISSION_DENIED')); for (var kk in o) if (o[kk] === undefined) throw new Error('update failed: values argument contains undefined in property ' + kk);
        return hold(function () { H.log.push(['update', path, clone(o)]); for (var k in o) setAt(path + '/' + k, resolve(clone(o[k]))); notify(path); return Promise.resolve(); }); },
      remove: function () { if (denied(path, 'write')) return Promise.reject(new Error('PERMISSION_DENIED')); return hold(function () { H.log.push(['remove', path]); setAt(path, null); notify(path); return Promise.resolve(); }); },
      transaction: function (fn) { if (denied(path, 'write')) return Promise.reject(new Error('PERMISSION_DENIED'));
        return hold(function () { var cur = clone(getAt(path)); var next = fn(cur); if (next === undefined) return Promise.resolve({ committed: false, snapshot: snap(path) }); H.log.push(['transaction', path, clone(next)]); setAt(path, resolve(clone(next))); notify(path); return Promise.resolve({ committed: true, snapshot: snap(path) }); }); },
      push: function (v) { var k = '-K' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), c = ref(path + '/' + k), plain = ref(path + '/' + k), pr = v === undefined ? Promise.resolve() : c.set(v); c.then = function (a, b) { return pr.then(function () { return plain; }).then(a, b); }; c.catch = function (b) { return pr.then(function () { return plain; }).catch(b); }; return c; },
      orderByKey: function () { return r; }, limitToLast: function () { return r; }
    };
    return r;
  }
  var authCbs = [];
  var auth = { currentUser: H.user || null,
    onAuthStateChanged: function (cb) { authCbs.push(cb); setTimeout(function () { cb(auth.currentUser); }, 0); return function () { }; },
    signInWithPopup: function () { auth.currentUser = H.user || H.popupUser || null; authCbs.forEach(function (cb) { cb(auth.currentUser); }); return Promise.resolve({ user: auth.currentUser }); },
    signInWithRedirect: function () { return auth.signInWithPopup(); },
    getRedirectResult: function () { return Promise.resolve({ user: null }); },
    signOut: function () { auth.currentUser = null; authCbs.forEach(function (cb) { cb(null); }); return Promise.resolve(); },
    setPersistence: function () { return Promise.resolve(); } };
  function GoogleAuthProvider() { this.setCustomParameters = function () { }; this.addScope = function () { }; }
  var db = { ref: ref };
  function sref(p) {
    p = norm(p);
    return { fullPath: p, child: function (c) { return sref(p + '/' + c); },
      put: function (blob) { H.files[p] = { size: blob && blob.size, type: blob && blob.type }; H.log.push(['upload', p]); return Promise.resolve({ ref: sref(p) }); },
      putString: function (s) { H.files[p] = { size: String(s).length }; H.log.push(['upload', p]); return Promise.resolve({ ref: sref(p) }); },
      getDownloadURL: function () { return Promise.resolve('data:image/gif;base64,R0lGODlhAQABAAAAACw='); },
      delete: function () { delete H.files[p]; H.log.push(['deleteFile', p]); return Promise.resolve(); } };
  }
  var storage = { ref: function (p) { return sref(p || ''); } };
  var app = { name: '[DEFAULT]', options: {} };
  var fb = { apps: [], SDK_VERSION: 'fake',
    initializeApp: function (cfg) { app.options = cfg || {}; if (fb.apps.indexOf(app) < 0) fb.apps.push(app); return app; },
    app: function () { return app; } };
  fb.auth = function () { return auth; }; fb.auth.GoogleAuthProvider = GoogleAuthProvider; fb.auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
  fb.database = function () { return db; }; fb.database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  fb.storage = function () { return storage; };
  window.firebase = fb;
})();
