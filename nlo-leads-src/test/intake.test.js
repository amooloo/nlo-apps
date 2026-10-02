/* The receiving service end to end against the Firestore emulator: what it stores, that only the app's
   key opens it, every reason it refuses a request, and that the website always gets its 200.
   Made-up data only. Run inside the emulators:
   npx firebase emulators:exec --only firestore --project demo-nlo-cases "node test/intake.test.js" */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GOOGLE_CLOUD_PROJECT = 'demo-nlo-cases';
const http = require('http');
const svc = require('../intake/server.js');
const db = require('../intake/firestore.js');
const { sha256hex } = require('../intake/seal');
const { load } = require('./load');
const C = load(['core.js', 'leads.js']);
const EMU = 'http://' + process.env.FIRESTORE_EMULATOR_HOST + '/v1/projects/demo-nlo-cases/databases/(default)/documents';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const enc = o => Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
const FORM = enc({ 'fields[name][title]': 'Patient Name', 'fields[name][type]': 'text', 'fields[name][value]': 'Avery Sample', 'fields[f2][title]': 'Parent Name', 'fields[f2][value]': 'Jordan Sample',
  'fields[email][title]': 'Email', 'fields[email][type]': 'email', 'fields[email][value]': 'jordan.sample@example.com', 'fields[f4][title]': 'Phone', 'fields[f4][type]': 'tel', 'fields[f4][value]': '352-555-0101',
  'fields[message][title]': 'Message', 'fields[message][type]': 'textarea', 'fields[message][value]': 'Consult please — marker-zx81', 'meta[remote_ip][value]': '203.0.113.7', 'meta[page_url][value]': 'https://thenextlevelorthodontics.com/request-an-appointment/' });
const body = s => () => Promise.resolve(Buffer.from(s, 'utf8'));
async function list(col) { const j = await (await fetch(EMU + '/' + col + '?pageSize=1000', { headers: { Authorization: 'Bearer owner' } })).json(); return (j.documents || []).map(d => ({ id: d.name.split('/').pop(), raw: d, data: db.dec({ mapValue: { fields: d.fields || {} } }) })); }
async function wipe() { await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/demo-nlo-cases/databases/(default)/documents', { method: 'DELETE' }); }
async function stats() { return (await db.getDocs(['meta/intakeStats']))['meta/intakeStats'] || {}; }
function request(port, method, path, data, headers) {
  return new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: headers || {} }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', e => resolve({ status: 0, error: e.code }));
    if (data && typeof data.pipe === 'function') data.pipe(r); else { if (data) r.write(data); r.end(); }
  });
}

(async () => {
  await wipe();
  const SECRET = C.Crypto.newSecret();
  const pair = await C.Crypto.newPair(), pub = await C.Crypto.pubJwk(pair), priv = await C.Crypto.importPriv(await C.Crypto.privBytes(pair));

  console.log('\n# Before the feed is set up');
  svc._reset();
  ok(await svc.receive(SECRET, body(FORM), 'application/x-www-form-urlencoded') === 'setup' && (await list('leadInbox')).length === 0, 'nothing is stored until the office sets up the feed');

  await db.merge('meta/intake', { kid: 'k1', pub, priv: { v: 1, iv: 'aXY=', ct: 'Y3Q=' } }, 'at');
  await db.merge('meta/intakeSecret', { hash: sha256hex(SECRET), box: { v: 1, iv: 'aXY=', ct: 'Y3Q=' }, on: true }, 'at');

  console.log('\n# A request from the website');
  svc._reset();
  ok(await svc.receive(SECRET, body(FORM), 'application/x-www-form-urlencoded') === 'ok', 'accepted with the right address');
  const docs = await list('leadInbox'); ok(docs.length === 1 && /^[A-Za-z0-9]{20}$/.test(docs[0].id), 'one request waiting, under a random id');
  const d = docs[0].data;
  ok(JSON.stringify(Object.keys(d).sort()) === JSON.stringify(['at', 'ct', 'epk', 'iv', 'kid']) && docs[0].raw.fields.at.timestampValue, 'stored fields: server time, key id, one-time key, nonce, ciphertext — nothing else');
  ok(!/Avery|Jordan|example\.com|555-0101|marker-zx81|203\.0\.113/.test(JSON.stringify(docs[0].raw)), 'nothing readable about the person is stored');
  const p = JSON.parse(new TextDecoder().decode(await C.Crypto.openFrom(priv, { epk: d.epk, iv: d.iv, ct: d.ct }, 'inbox:' + docs[0].id)));
  ok(p.name === 'Avery Sample' && p.parent === 'Jordan Sample' && p.email === 'jordan.sample@example.com' && p.phone === '352-555-0101' && /marker-zx81/.test(p.message), 'the app’s key opens it and the fields are right');
  ok(p.page === 'https://thenextlevelorthodontics.com/request-an-appointment/' && !JSON.stringify(p).includes('203.0.113'), 'page kept, visitor IP dropped');
  let opened = true; try { await C.Crypto.openFrom(priv, { epk: d.epk, iv: d.iv, ct: d.ct }, 'inbox:someOtherId'); } catch (e) { opened = false; }
  ok(!opened, 'the sealed box only opens under its own id');
  const other = await C.Crypto.newPair(); const otherPriv = await C.Crypto.importPriv(await C.Crypto.privBytes(other));
  opened = true; try { await C.Crypto.openFrom(otherPriv, { epk: d.epk, iv: d.iv, ct: d.ct }, 'inbox:' + docs[0].id); } catch (e) { opened = false; }
  ok(!opened, 'any other key cannot open it');
  ok(!!(await stats()).okAt, 'the time of the last request is noted for Settings');
  const lead = C.leadFromInbox(p, Date.now(), C.leadCfg({}), 'savannah', []);
  ok(lead.steps.length === 5 && lead.flag === '', 'and it becomes a clean lead with five attempts');

  console.log('\n# Requests it refuses');
  svc._reset();
  ok(await svc.receive('wrong-' + SECRET, body(FORM), '') === 'key', 'wrong address (secret) → refused');
  ok(await svc.receive('', body(FORM), '') === 'key', 'no secret → refused');
  ok((await stats()).badWhy === 'key', 'the reason is noted for Settings');
  ok(await svc.receive(SECRET, () => Promise.resolve(null), '') === 'big', 'too large → refused');
  ok((await stats()).badWhy === 'big', 'each different reason is noted');
  await db.merge('meta/intakeSecret', { on: false }); svc._reset();
  ok(await svc.receive(SECRET, body(FORM), '') === 'off', 'feed turned off → refused');
  await db.merge('meta/intakeSecret', { on: true }); svc._reset();
  ok((await list('leadInbox')).length === 1, 'refused requests stored nothing');

  console.log('\n# Flooding is capped');
  for (let i = 0; i < 300; i++) await db.create('leadInbox/fill' + i, { kid: 'k1', epk: pub, iv: 'aXY=', ct: 'Y3Q=' }, 'at');
  svc._reset();
  ok(await svc.receive(SECRET, body(FORM), '') === 'full', 'with 300 waiting, more are refused');
  await wipe();
  await db.merge('meta/intake', { kid: 'k1', pub, priv: { v: 1, iv: 'aXY=', ct: 'Y3Q=' } }, 'at');
  await db.merge('meta/intakeSecret', { hash: sha256hex(SECRET), box: { v: 1, iv: 'aXY=', ct: 'Y3Q=' }, on: true }, 'at'); svc._reset();
  ok(await svc.receive(SECRET, body(FORM), '') === 'ok', 'accepts again once they are filed');

  console.log('\n# Over HTTP: the website always gets a 200, the secret is checked before anything is read');
  const server = http.createServer(svc.handler); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
  svc._reset();
  const n0 = (await list('leadInbox')).length;
  ok((await request(port, 'GET', '/?k=' + SECRET)).status === 405, 'GET → 405');
  ok((await request(port, 'POST', '/?k=' + SECRET, FORM, { 'content-type': 'application/x-www-form-urlencoded' })).status === 200, 'a good request → 200');
  ok((await request(port, 'POST', '/?k=nope', FORM, { 'content-type': 'application/x-www-form-urlencoded' })).status === 200, 'a wrong secret → still 200');
  ok((await request(port, 'POST', '/?k=' + SECRET, '{"broken json', { 'content-type': 'application/json' })).status === 200, 'broken JSON → 200 (kept, flagged for a look)');
  ok((await request(port, 'POST', '/?k=' + SECRET, 'Name=Sam+Sample&Email=sam%40example.com', { 'content-type': 'application/x-www-form-urlencoded; charset=koi8-r' })).status === 200, 'an odd character set → 200');
  const big = 'x='.padEnd(200 * 1024, 'a');
  ok((await request(port, 'POST', '/?k=' + SECRET, big, { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(big)) })).status === 200, 'a 200 KB body → 200 without reading it');
  const { Readable } = require('stream');
  const chunked = Readable.from((function* () { for (let i = 0; i < 100; i++) yield Buffer.alloc(4096, 97); })());
  const rc = await request(port, 'POST', '/?k=' + SECRET, chunked, { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' });
  ok(rc.status === 200 || rc.error === 'ECONNRESET' || rc.error === 'EPIPE', 'a 400 KB streamed body is cut off at 64 KB (' + (rc.status || rc.error) + ')');
  const huge = 'x='.padEnd(1024 * 1024, 'b');
  ok((await request(port, 'POST', '/?k=wrong', huge, { 'content-type': 'application/x-www-form-urlencoded' })).status === 200, 'a wrong secret with a 1 MB body → 200, body never read');
  await new Promise(r => setTimeout(r, 300));
  const n1 = (await list('leadInbox')).length;
  ok(n1 - n0 === 3, 'exactly the three acceptable posts were stored (' + (n1 - n0) + ')');
  server.close();

  console.log('\n# JSON (the app’s own test request)');
  svc._reset();
  ok(await svc.receive(SECRET, body(JSON.stringify({ test: true, fields: { name: 'Test Request', email: 'test@example.com' } })), 'text/plain') === 'ok', 'test request accepted');
  const payloads = [];
  for (const x of await list('leadInbox')) payloads.push(JSON.parse(new TextDecoder().decode(await C.Crypto.openFrom(priv, { epk: x.data.epk, iv: x.data.iv, ct: x.data.ct }, 'inbox:' + x.id))));
  ok(payloads.some(q => q.test === true && q.flags.some(f => f.k === 'test')), 'the test request is marked as a test');
  ok(payloads.some(q => q.flags.some(f => f.k === 'check')), 'the broken one waits for a look');

  console.log('\nPASS ' + pass + '  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
