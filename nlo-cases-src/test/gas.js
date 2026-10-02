// A stand-in for Google Apps Script, enough to run mail/nlo-cases-mail.gs in Node:
// GmailApp (from a list of made-up emails), UrlFetchApp (real HTTP through curl, or a fake), Properties/Cache/Lock,
// ScriptApp triggers, Utilities (UUID + SHA-256 as Java's signed bytes), Session, MailApp, Logger.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const nodeCrypto = require('crypto');

function curlFetch(url, opt) {
  opt = opt || {};
  const args = ['-s', '-S', '-X', String(opt.method || 'get').toUpperCase(), url, '-w', '\n%{http_code}'];
  Object.entries(opt.headers || {}).forEach(([k, v]) => args.push('-H', k + ': ' + v));
  if (opt.contentType) args.push('-H', 'Content-Type: ' + opt.contentType);
  if (opt.payload != null) args.push('--data-binary', '@-');
  const out = execFileSync('curl', args, { input: opt.payload == null ? '' : String(opt.payload), env: Object.assign({}, process.env, { NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }), maxBuffer: 64 << 20 }).toString();
  const i = out.lastIndexOf('\n');
  return { code: Number(out.slice(i + 1)), body: out.slice(0, i) };
}

function makeGas(o) {
  o = o || {};
  const props = new Map(), cache = new Map(), triggers = [], mails = [], logs = [];
  const messages = o.messages || [];
  const msgObj = m => ({ getId: () => m.id, getDate: () => new Date(m.date), getFrom: () => m.from, getTo: () => m.to || 'office@example.com', getSubject: () => m.subject,
    getPlainBody: () => m.text || '', getBody: () => m.html || '' });
  const GmailApp = {
    search(q, start, max) {
      GmailApp.lastQuery = q;
      const senders = Array.from(q.matchAll(/from:([^\s{}]+)/g)).map(x => x[1].toLowerCase());
      const after = Number((/after:(\d+)/.exec(q) || [])[1] || 0) * 1000, wantLabel = /label:lab-update/.test(q);
      // from:domain matches anyone at that domain; from:name@domain matches that one address (as in Gmail)
      const fromHit = f => senders.some(d => d.includes('@') ? f.includes(d) : f.includes('@' + d) || f.includes('.' + d));
      const hit = messages.filter(m => m.date >= after && (fromHit(m.from.toLowerCase()) || (wantLabel && (m.labels || []).includes('Lab Update'))));
      // one thread per subject, like Gmail's conversation view; a thread comes back whole (replies from anyone included)
      const subjects = new Set(hit.map(m => m.subject));
      const threads = {}; messages.filter(m => subjects.has(m.subject)).forEach(m => { (threads[m.subject] = threads[m.subject] || []).push(m); });
      return Object.values(threads).slice(start || 0, (start || 0) + (max || 100)).map(list => ({ getMessages: () => list.map(msgObj) }));
    }
  };
  const fetcher = o.fetch || ((url, opt) => { const r = curlFetch(url, opt); return { getResponseCode: () => r.code, getContentText: () => r.body }; });
  const ctx = vm.createContext({
    console,
    GmailApp,
    UrlFetchApp: { fetch: fetcher },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => { props.set(k, String(v)); }, deleteProperty: k => props.delete(k) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => { cache.set(k, String(v)); }, removeAll: ks => ks.forEach(k => cache.delete(k)) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: fn => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => { const t = { fn, n, getHandlerFunction: () => fn }; triggers.push(t); return t; } }) }) })
    },
    Utilities: {
      getUuid: () => nodeCrypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256', SHA_1: 'sha1' }, Charset: { UTF_8: 'utf8' },
      // Java returns signed bytes
      computeDigest: (alg, s) => Array.from(nodeCrypto.createHash(alg).update(String(s), 'utf8').digest()).map(b => b > 127 ? b - 256 : b)
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => o.user || 'office@example.com' }) },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
    Logger: { log: s => logs.push(String(s)) }
  });
  // o.source: a script exactly as NLO Cases hands it out (its settings already filled in)
  const src = o.source || fs.readFileSync(path.join(__dirname, '..', 'mail', 'nlo-cases-mail.gs'), 'utf8').replace('/*NLO_CONFIG*/null', JSON.stringify(o.config || null));
  vm.runInContext(src, ctx, { filename: 'nlo-cases-mail.gs' });
  return { ctx, props, cache, triggers, mails, logs, GmailApp, messages };
}
module.exports = { makeGas, curlFetch };
