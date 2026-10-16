/* Stand-ins for Google's Apps Script services, for running the alert script (a .gs file) in Node: synchronous HTTP (through
   curl, as UrlFetchApp is synchronous), email (recorded), the cache, the script's properties, triggers, Utilities, Session, and
   this Google account's token for the old database ('owner': the emulator's admin, as the real account is the project's owner).
   load(config, mailbox, clock, text) runs the script in its own context; clock.off moves its "now". (Adapted from NLO Time
   Clock's test/gas_fakes.js.) */
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), crypto = require('crypto');
let httpCalls = 0; const urls = [];
function syncFetch(url, opt) {
  opt = opt || {}; httpCalls++; urls.push(String(opt.method || 'get').toUpperCase() + ' ' + url);
  const args = ['-s', '-o', '-', '-w', '\n%{http_code}', '-X', String(opt.method || 'get').toUpperCase()];
  Object.entries(opt.headers || {}).forEach(([k, v]) => args.push('-H', k + ': ' + v));
  if (opt.contentType) args.push('-H', 'Content-Type: ' + opt.contentType);
  if (opt.payload != null) args.push('--data-binary', '@-');
  args.push(url);
  const out = cp.execFileSync('curl', args, { input: opt.payload != null ? String(opt.payload) : undefined, env: Object.assign({}, process.env, { NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }), maxBuffer: 50e6 }).toString();
  const i = out.lastIndexOf('\n'), body = out.slice(0, i), code = Number(out.slice(i + 1));
  if (!code) throw new Error('Address unavailable: ' + url);
  return { getResponseCode: () => code, getContentText: () => body };
}
function services(box, clock) {
  const props = {}, cache = {}, triggers = [], mail = [], logs = [];
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) };
  const CacheService = { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; } }) };
  const MailApp = { getRemainingDailyQuota: () => 100, sendEmail: (a, b, c, d) => { mail.push(typeof a === 'object' ? a : Object.assign({ to: a, subject: b, body: c }, d || {})); } };
  const ScriptApp = {
    newTrigger: fn => { const t = { fn, every: 0 }; const b = { timeBased: () => b, everyMinutes: n => { t.every = n; return b; }, create: () => { triggers.push(t); return t; } }; return b; },
    getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t.fn, _t: t })),
    deleteTrigger: x => { const i = triggers.indexOf(x._t); if (i >= 0) triggers.splice(i, 1); },
    getOAuthToken: () => 'owner'
  };
  const parts = (d, tz) => { const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).forEach(x => { o[x.type] = x.value; }); return o; };
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    base64Decode: s => Array.from(Buffer.from(String(s), 'base64')).map(b => (b > 127 ? b - 256 : b)),
    newBlob: (data) => ({ getDataAsString: () => Array.isArray(data) ? Buffer.from(data.map(b => (b < 0 ? b + 256 : b))).toString('utf8') : String(data) }),
    formatDate: (d, tz, pat) => {
      const o = parts(d, tz), h = Number(o.hour);
      if (pat === 'H') return String(h);
      if (pat === 'yyyy-MM-dd') return o.year + '-' + o.month + '-' + o.day;
      const h12 = (h % 12) || 12, ap = h < 12 ? 'AM' : 'PM';
      if (pat === 'h:mm a') return h12 + ':' + o.minute + ' ' + ap;
      if (pat === 'EEE M/d, h:mm a') return o.weekday + ' ' + Number(o.month) + '/' + Number(o.day) + ', ' + h12 + ':' + o.minute + ' ' + ap;
      throw new Error('unexpected pattern ' + pat);
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
  const raw = text || fs.readFileSync(path.join(__dirname, '..', 'dist', 'nlo-inventory-alerts.gs'), 'utf8');
  const src = cfg === undefined ? raw : raw.replace('/*INV_CONFIG*/null', JSON.stringify(cfg));
  const ctx = vm.createContext(Object.assign({}, sv.g));
  vm.runInContext(src, ctx, { filename: 'nlo-inventory-alerts.gs' });
  sv.run = fn => vm.runInContext(fn, ctx);
  sv.ctx = ctx;
  return sv;
}
module.exports = { syncFetch, services, load, calls: () => httpCalls, urls };
