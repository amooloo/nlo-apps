'use strict';
/* =====================================================================
   NLO Leads — receiving service for the website's appointment form.
   The form's "Webhook" action posts each request to …/?k=<secret>.
   The request is read, sealed to the office's website-feed PUBLIC key
   and stored in `leadInbox`. This service can lock requests but can
   never open them: only signed-in staff browsers hold the private key.
   - Plain Node, no dependencies. The secret is checked before the body
     is read, and at most 64 KB is ever read.
   - Every POST gets a 200: the website shows its "thank you" only for a
     200, and each request also reaches the office by email. Refusals are
     noted (a time and a reason word) for the app's Settings page.
   - Nothing about the person is ever logged.
   ===================================================================== */
const http = require('http');
const { parseBody, mapFields } = require('./parse');
const { sealTo, sha256hex, sameHex } = require('./seal');
const db = require('./firestore');

const MAX_BODY = 64 * 1024;   // a form post is a few KB
const MAX_WAITING = 300;      // stop taking more if this many sit unopened (someone flooding the address)
const CACHE_MS = Number(process.env.INTAKE_CACHE_MS) || 10000; // how long the feed's key and on/off are remembered
let cache = { at: 0 };
let lastNote = {};

async function feed() {
  if (Date.now() - cache.at < CACHE_MS) return cache;
  const d = await db.getDocs(['meta/intake', 'meta/intakeSecret']);
  cache = { at: Date.now(), intake: d['meta/intake'], secret: d['meta/intakeSecret'] };
  return cache;
}
/* when the last request was taken or refused (no more than once every 10 s per kind) */
async function note(ok, why) {
  const k = ok ? 'ok' : 'bad:' + why; if (Date.now() - (lastNote[k] || 0) < 10000) return; lastNote[k] = Date.now();
  try { await (ok ? db.merge('meta/intakeStats', {}, 'okAt') : db.merge('meta/intakeStats', { badWhy: why }, 'badAt')); } catch (e) { /* not important */ }
}
function randomId() {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s = '';
  while (s.length < 20) for (const b of require('crypto').randomBytes(32)) { if (b < 248 && s.length < 20) s += A[b % 62]; }
  return s;
}
/* readBody() gives the body, or null when it is larger than MAX_BODY */
async function receive(k, readBody, ctype) {
  const c = await feed();
  if (!c.intake || !c.intake.pub || !c.secret) { await note(false, 'setup'); return 'setup'; }
  if (!k || !sameHex(sha256hex(k), c.secret.hash)) { await note(false, 'key'); return 'key'; }
  if (c.secret.on === false) { await note(false, 'off'); return 'off'; }
  const raw = await readBody();
  if (raw === null) { await note(false, 'big'); return 'big'; }
  if (await db.count('leadInbox', MAX_WAITING) >= MAX_WAITING) { await note(false, 'full'); return 'full'; }
  const lead = mapFields(parseBody(raw.toString('utf8'), ctype));
  const id = randomId();
  const box = await sealTo(c.intake.pub, Buffer.from(JSON.stringify(Object.assign({ v: 1, at: Date.now() }, lead)), 'utf8'), 'inbox:' + id);
  await db.create('leadInbox/' + id, { kid: c.intake.kid, epk: box.epk, iv: box.iv, ct: box.ct }, 'at');
  await note(true);
  return 'ok';
}
function readCapped(req) {
  return new Promise(resolve => {
    const parts = []; let n = 0, done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    req.on('data', c => { if (done) return; n += c.length; if (n > MAX_BODY) finish(null); else parts.push(c); });
    req.on('end', () => finish(Buffer.concat(parts)));
    req.on('error', () => finish(null)); req.on('aborted', () => finish(null));
  });
}
function handler(req, res) {
  const reply = (code, body) => {
    if (res.headersSent) return;
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(body);
  };
  // anything left unread (refused before reading, or too large) is dropped with the connection
  res.on('finish', () => { if (!req.complete) req.destroy(); });
  if (req.method !== 'POST') { reply(405, '{"error":"POST only"}'); return; }
  let k = '';
  try { k = new URL(req.url, 'http://local').searchParams.get('k') || ''; } catch (e) { /* odd URL: no secret */ }
  const len = Number(req.headers['content-length']);
  receive(k, () => (len > MAX_BODY ? Promise.resolve(null) : readCapped(req)), String(req.headers['content-type'] || ''))
    .catch(e => { console.error('intake error', (e && e.code) || (e && e.name) || 'unknown'); return note(false, 'error'); })
    .then(() => reply(200, '{"ok":true}'));
}
if (require.main === module) {
  const server = http.createServer(handler);
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT) || 8080, () => console.log('NLO Leads intake listening'));
}
module.exports = { receive, handler, _reset() { cache = { at: 0 }; lastNote = {}; } };
