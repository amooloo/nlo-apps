/* Stand-ins for Google's Apps Script services, for running the alert script (a .gs file) in Node: synchronous HTTP (through
   curl, as UrlFetchApp is synchronous), email (recorded), the cache, the script's properties, triggers, Utilities, Session.
   load(scriptText, config, mailbox, clock) runs the script in its own context; clock.off moves its "now". */
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), crypto = require('crypto');
let httpCalls = 0;
/* ---------- synchronous HTTP (Apps Script's UrlFetchApp is synchronous) ---------- */
function syncFetch(url, opt) {
  opt = opt || {}; httpCalls++;
  const args = ['-s', '-o', '-', '-w', '\n%{http_code}', '-X', String(opt.method || 'get').toUpperCase()];
  Object.entries(opt.headers || {}).forEach(([k, v]) => args.push('-H', k + ': ' + v));
  if (opt.contentType) args.push('-H', 'Content-Type: ' + opt.contentType);
  if (opt.payload != null) args.push('--data-binary', '@-');
  args.push(url);
  const out = cp.execFileSync('curl', args, { input: opt.payload != null ? String(opt.payload) : undefined, env: Object.assign({}, process.env, { NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }), maxBuffer: 20e6 }).toString();
  const i = out.lastIndexOf('\n'), body = out.slice(0, i), code = Number(out.slice(i + 1));
  if (!code) throw new Error('Address unavailable: ' + url);
  return { getResponseCode: () => code, getContentText: () => body };
}
/* ---------- Apps Script stand-ins: one "copy" of the script = its own properties and cache, sharing the mailbox ---------- */
function services(box, clock) {
  const props = {}, cache = {}, triggers = [], mail = [], logs = [];
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) };
  const CacheService = { getScriptCache: () => ({
    get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; },
    putAll: o => { Object.entries(o).forEach(([k, v]) => { cache[k] = String(v); }); }, getAll: ks => Object.fromEntries(ks.filter(k => k in cache).map(k => [k, cache[k]]))
  }) };
  const MailApp = {
    getRemainingDailyQuota: () => 100,
    sendEmail: (a, b, c, d) => { mail.push(typeof a === 'object' ? a : Object.assign({ to: a, subject: b, body: c }, d || {})); }
  };
  const ScriptApp = {
    newTrigger: fn => { const t = { fn, every: 0 }; const b = { timeBased: () => b, everyMinutes: n => { t.every = n; return b; }, create: () => { triggers.push(t); return t; } }; return b; },
    getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t.fn, _t: t })),
    deleteTrigger: x => { const i = triggers.indexOf(x._t); if (i >= 0) triggers.splice(i, 1); }
  };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(),
    newBlob: (data, type, name) => ({ name, type, text: String(data), getName: () => name, getContentType: () => type, getDataAsString: () => String(data) }),
    formatDate: (d, tz, pat) => {
      if (pat !== 'yyyy-MM-dd-HH-mm') throw new Error('unexpected pattern ' + pat);
      const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(x => { o[x.type] = x.value; });
      return o.year + '-' + o.month + '-' + o.day + '-' + o.hour + '-' + o.minute;
    }
  };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + clock.off); } static now() { return Date.now() + clock.off; } }
  return {
    props, cache, triggers, mail, logs,
    g: {
      PropertiesService, CacheService, MailApp, ScriptApp, Utilities,
      UrlFetchApp: { fetch: syncFetch }, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) },
      Session: { getEffectiveUser: () => ({ getEmail: () => box }) }, Logger: { log: m => logs.push(String(m)) },
      Date: FakeDate, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set, Intl, encodeURIComponent, parseInt, isNaN, console
    }
  };
}
function load(cfg, box, clock, text) {
  const sv = services(box, clock || { off: 0 });
  const raw = text || fs.readFileSync(path.join(__dirname, '..', 'dist', 'nlo-timeclock-alerts.gs'), 'utf8');
  const src = cfg === undefined ? raw : raw.replace('/*TC_CONFIG*/null', JSON.stringify(cfg));
  const ctx = vm.createContext(Object.assign({}, sv.g));
  vm.runInContext(src, ctx, { filename: 'nlo-timeclock-alerts.gs' });
  sv.run = fn => vm.runInContext(fn, ctx);
  sv.ctx = ctx;
  return sv;
}
module.exports = { syncFetch, services, load, calls: () => httpCalls };
