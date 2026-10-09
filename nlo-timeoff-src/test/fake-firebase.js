/* A stand-in for the Firebase compat SDK (app, auth, Realtime Database) for testing pages offline: an in-memory tree in
   window.__FAKE.store, a signed-in window.__FAKE.user, and window.__FAKE.deny(path, 'read'|'write') to refuse access. */
(function () {
  if (window.firebase) return;
  var H = window.__FAKE = window.__FAKE || {};
  H.store = H.store || {}; H.log = H.log || [];
  var listeners = [];
  function norm(p) { return String(p || '').replace(/^\/+|\/+$/g, ''); }
  function parts(p) { return norm(p).split('/').filter(Boolean); }
  function clone(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }
  function getAt(p) { var o = H.store; var ks = parts(p); for (var i = 0; i < ks.length; i++) { if (o == null || typeof o !== 'object') return null; o = o[ks[i]]; } return o === undefined ? null : o; }
  function resolve(v) { if (v && typeof v === 'object') { if (v['.sv'] === 'timestamp') return Date.now(); var o = Array.isArray(v) ? [] : {}; for (var k in v) o[k] = resolve(v[k]); return o; } return v; }
  function setAt(p, v) {
    var ks = parts(p); if (!ks.length) { H.store = v && typeof v === 'object' ? v : {}; return; }
    var o = H.store, trail = [];
    for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') { if (v == null) return; o[ks[i]] = {}; } trail.push([o, ks[i]]); o = o[ks[i]]; }
    if (v == null) { delete o[ks[ks.length - 1]]; for (var j = trail.length - 1; j >= 0; j--) { var t = trail[j]; if (Object.keys(t[0][t[1]]).length === 0) delete t[0][t[1]]; else break; } }
    else o[ks[ks.length - 1]] = v;
  }
  function snap(p) { var v = clone(getAt(p)); return { key: parts(p).pop() || null, val: function () { return v; }, exists: function () { return v != null; },
    child: function (c) { return snap(norm(p) + '/' + c); }, forEach: function (fn) { if (v && typeof v === 'object') { var ks = Object.keys(v); for (var i = 0; i < ks.length; i++) if (fn(snap(norm(p) + '/' + ks[i])) === true) return true; } return false; } }; }
  function related(a, b) { a = norm(a); b = norm(b); return a === b || !a || !b || a.indexOf(b + '/') === 0 || b.indexOf(a + '/') === 0; }
  function notify(changed) { listeners.slice().forEach(function (l) { if (related(l.path, changed)) setTimeout(function () { if (listeners.indexOf(l) >= 0) l.cb(snap(l.path)); }, 0); }); }
  function denied(p, how) { return !!(H.deny && H.deny(norm(p), how)); }
  function ref(path) {
    path = norm(path);
    var r = {
      key: parts(path).pop() || null, path: path, toString: function () { return 'fake://' + path; },
      child: function (c) { return ref(path + '/' + c); },
      on: function (ev, cb, err) { if (denied(path, 'read')) { if (err) setTimeout(function () { err(new Error('permission_denied')); }, 0); return cb; } listeners.push({ path: path, cb: cb }); setTimeout(function () { cb(snap(path)); }, 0); return cb; },
      off: function (ev, cb) { for (var i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === path && (!cb || listeners[i].cb === cb)) listeners.splice(i, 1); },
      once: function () { if (denied(path, 'read')) return Promise.reject(new Error('permission_denied')); H.log.push(['once', path]); return Promise.resolve(snap(path)); },
      set: function (v) { if (denied(path, 'write')) return Promise.reject(new Error('permission_denied')); H.log.push(['set', path]); setAt(path, resolve(clone(v))); notify(path); return Promise.resolve(); },
      update: function (o) { if (denied(path, 'write')) return Promise.reject(new Error('permission_denied')); H.log.push(['update', path]); for (var k in o) setAt(path + '/' + k, resolve(clone(o[k]))); notify(path); return Promise.resolve(); },
      remove: function () { if (denied(path, 'write')) return Promise.reject(new Error('permission_denied')); H.log.push(['remove', path]); setAt(path, null); notify(path); return Promise.resolve(); },
      push: function (v) { var k = '-K' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), c = ref(path + '/' + k), pr = v === undefined ? Promise.resolve() : c.set(v); c.then = function (a, b) { return pr.then(function () { return c; }).then(a, b); }; return c; }
    };
    return r;
  }
  var authCbs = [];
  var auth = { currentUser: H.user || null,
    onAuthStateChanged: function (cb) { authCbs.push(cb); setTimeout(function () { cb(auth.currentUser); }, 0); return function () { }; },
    signInWithPopup: function () { return Promise.resolve({ user: auth.currentUser }); },
    signOut: function () { auth.currentUser = null; authCbs.forEach(function (cb) { cb(null); }); return Promise.resolve(); },
    setPersistence: function () { return Promise.resolve(); } };
  function GoogleAuthProvider() { this.setCustomParameters = function () { }; this.addScope = function () { }; }
  var db = { ref: ref };
  var app = { name: '[DEFAULT]', options: {} };
  var fb = { apps: [], SDK_VERSION: 'fake',
    initializeApp: function (cfg) { app.options = cfg || {}; if (fb.apps.indexOf(app) < 0) fb.apps.push(app); return app; },
    app: function () { return app; } };
  fb.auth = function () { return auth; }; fb.auth.GoogleAuthProvider = GoogleAuthProvider;
  fb.database = function () { return db; }; fb.database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  window.firebase = fb;
})();
