// The office check (worker/office-check.js, the Cloudflare Worker) run under Node against the emulators, as filled in
// by the page: its own login signs in, reads the office's networks and writes down where a login is, under the shared
// rules. Also Google's real token signature (RS256) with a key made here. Made-up people only.
//   npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/worker.test.mjs"
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { generateKeyPairSync, createSign } from 'crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = 'demo-nlo-cases', FS = 'http://127.0.0.1:8080/v1/projects/' + P + '/databases/(default)/documents';
const AUTHB = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1', ORIGIN = 'https://amooloo.github.io';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let pass = 0, fail = 0;
const is = (name, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + name + (c ? '' : ' :: ' + JSON.stringify(extra).slice(0, 500))); };

const realFetch = globalThis.fetch;
async function rest(method, url, body, token) {
  const r = await realFetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token == null ? 'owner' : token) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, body: j };
}
const sv = s => ({ stringValue: s });
async function put(path, fields) { return rest('PATCH', FS + '/' + path, { fields }); }
async function get(path) { const r = await rest('GET', FS + '/' + path); return r.status === 200 ? r.body.fields : null; }
async function signUp(email, pw) { const r = await rest('POST', AUTHB + '/accounts:signUp?key=any', { email, password: pw, returnSecureToken: true }, ''); return r.body; }

/* a copy of the Worker, filled in the way the page fills it in */
const SRC = readFileSync(join(HERE, '..', 'worker', 'office-check.js'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'nlo-check-'));
let nWorker = 0;
async function worker(cfg) {
  if (SRC.split('/*TC_NET_CONFIG*/null').length !== 2) throw new Error('the Worker has no config spot');
  const f = join(dir, 'w' + (++nWorker) + '.mjs');
  writeFileSync(f, SRC.replace('/*TC_NET_CONFIG*/null', JSON.stringify(cfg)));
  return (await import(pathToFileURL(f).href)).default;
}
function req(w, o) {
  o = o || {};
  const h = { 'Content-Type': 'text/plain' };
  if (o.origin !== null) h.Origin = o.origin || ORIGIN;
  if (o.ip !== null) h['CF-Connecting-IP'] = o.ip || '203.0.113.10';
  const r = new Request('https://nlo-office-check.test.workers.dev' + (o.path || '/check'), { method: o.method || 'POST', headers: h, body: (o.method || 'POST') === 'POST' ? (o.token || '') : undefined });
  Object.defineProperty(r, 'cf', { value: o.cf === undefined ? { asOrganization: 'Cox Business', city: 'Gainesville', region: 'Florida' } : o.cf });
  return w.fetch(r);
}
async function json(res) { const t = await res.text(); try { return JSON.parse(t); } catch (e) { return t; } }
const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function unsigned(claims) { return b64u(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claims)) + '.'; }
const nowS = () => Math.floor(Date.now() / 1000);
const claims = (o) => Object.assign({ iss: 'https://securetoken.google.com/' + P, aud: P, sub: 'someone1', iat: nowS() - 10, exp: nowS() + 3600, auth_time: nowS() - 10 }, o || {});

// start empty
await rest('DELETE', 'http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents');
await rest('DELETE', 'http://127.0.0.1:9099/emulator/v1/projects/' + P + '/accounts');
const bot = await signUp('tc-check-abc123@staff.thenextlevelorthodontics.com', 'bot-pass-123456');
await put('tcNetBot/' + bot.localId, { email: sv('tc-check-abc123@staff.thenextlevelorthodontics.com'), at: { timestampValue: new Date().toISOString() } });
await put('tcOffice/v4:203.0.113.10', { name: sv('Office Wi-Fi'), org: sv(''), city: sv(''), by: sv('owner'), at: { timestampValue: new Date().toISOString() } });
await put('tcOffice/v6:2600:1700:abcd:12', { name: sv('Office (IPv6)'), org: sv(''), city: sv(''), by: sv('owner'), at: { timestampValue: new Date().toISOString() } });
const cfg = { projectId: P, apiKey: 'any', botEmail: 'tc-check-abc123@staff.thenextlevelorthodontics.com', botPassword: 'bot-pass-123456', origins: [ORIGIN], authBase: AUTHB, fsBase: 'http://127.0.0.1:8080/v1', emulator: true };
const W = await worker(cfg);
const gwen = await signUp('gwen.1@staff.thenextlevelorthodontics.com', 'gwen-pass-1');
const stranger = await signUp('someone@example.com', 'stranger-pass-1');
// the office's people (the rules write down a network only for them, its time clocks and its laptops)
for (const uid of [gwen.localId, 'someone1', 'signedUser1']) await put('members/' + uid, { staffId: sv('gwen'), role: sv('staff'), active: { booleanValue: true }, name: sv('gwen') });

console.log('\n# the basics');
{
  const r = await req(W, { method: 'GET', path: '/' });
  is('GET / says it’s running', r.status === 200 && /running/.test(await r.text()), r.status);
  const r2 = await req(W, { origin: null, token: gwen.idToken });
  is('a check from no page is refused', r2.status === 403 && !r2.headers.get('Access-Control-Allow-Origin'), r2.status);
  const r3 = await req(W, { origin: 'https://evil.example.com', token: gwen.idToken });
  is('…and from another site', r3.status === 403 && !r3.headers.get('Access-Control-Allow-Origin'), r3.status);
  const r4 = await req(W, { token: '' });
  is('no sign-in token: refused', r4.status === 401 && (await json(r4)).error === 'no-token');
  const r5 = await req(W, { token: 'not.a.token' });
  is('a bad token: refused', r5.status === 401 && (await json(r5)).error === 'bad-token');
  const r6 = await req(W, { method: 'OPTIONS' });
  is('the browser’s “may I” (OPTIONS) is answered for the page', r6.status === 204 && r6.headers.get('Access-Control-Allow-Origin') === ORIGIN);
  const r7 = await req(W, { path: '/other', token: gwen.idToken });
  is('another address: not found', r7.status === 404);
  const r8 = await req(W, { method: 'GET', token: gwen.idToken });
  is('a check has to be sent (POST)', r8.status === 405);
}

console.log('\n# where someone is');
{
  const r = await req(W, { token: gwen.idToken, ip: '203.0.113.10' });
  const j = await json(r), s = await get('tcNetSeen/' + gwen.localId);
  is('on the office network: office', r.status === 200 && j.ok && j.office === true && j.net === 'v4:203.0.113.10' && j.org === 'Cox Business' && j.city === 'Gainesville, Florida', j);
  is('…the page may read the answer', r.headers.get('Access-Control-Allow-Origin') === ORIGIN && /no-store/.test(r.headers.get('Cache-Control')));
  is('…and it’s written down for her login, with the database’s time', s && s.net.stringValue === 'v4:203.0.113.10' && s.office.booleanValue === true && Math.abs(Date.parse(s.at.timestampValue) - Date.now()) < 60000, s);
  is('…with a one-time punch number, told only to the page that asked', /^p[0-9a-f]{24}$/.test(j.pid || '') && s.pid.stringValue === j.pid, [j.pid, s.pid]);
  is('…not an address many people share', j.relay === false && s.relay.booleanValue === false, [j.relay, s.relay]);
  is('…and which login it runs with (Settings turns the older ones off once the newest answers)', j.bot === 'tc-check-abc123', j.bot);
  const r2 = await req(W, { token: gwen.idToken, ip: '198.51.100.7' });
  const j2 = await json(r2), s2 = await get('tcNetSeen/' + gwen.localId);
  is('at home: not the office', r2.status === 200 && j2.office === false && j2.net === 'v4:198.51.100.7', j2);
  is('…written down too (the rules then refuse an office punch)', s2.net.stringValue === 'v4:198.51.100.7' && s2.office.booleanValue === false, s2);
  is('…each check a new punch number (the one before stops counting)', /^p[0-9a-f]{24}$/.test(j2.pid || '') && j2.pid !== j.pid && s2.pid.stringValue === j2.pid, [j.pid, j2.pid]);
  for (const [cf, why] of [[{ asOrganization: 'Apple Inc.', asn: 714 }, 'iCloud Private Relay (Apple)'], [{ asOrganization: 'Akamai International B.V.', asn: 36183 }, '…(Akamai)'],
    [{ asOrganization: 'Cloudflare, Inc.', asn: 13335 }, '…(Cloudflare)'], [{ asOrganization: 'Fastly, Inc.', asn: 54113 }, '…(Fastly)'], [{ asOrganization: 'NordVPN S.A.', asn: 1 }, 'a VPN'],
    [{ asOrganization: 'DigitalOcean, LLC', asn: 14061 }, 'a hosting company']]) {
    const r = await req(W, { token: gwen.idToken, ip: '172.225.10.4', cf: Object.assign({ city: 'Gainesville', region: 'Florida' }, cf) });
    const jr = await json(r), sr = await get('tcNetSeen/' + gwen.localId);
    is('shared address marked: ' + why, r.status === 200 && jr.relay === true && sr.relay.booleanValue === true, jr);
  }
  for (const org of ['Comcast Cable Communications, LLC', 'Cox Communications Inc.', 'AT&T Services, Inc.', 'Charter Communications Inc', 'Verizon Business', 'Google Fiber Inc.']) {
    const jr = await json(await req(W, { token: gwen.idToken, ip: '203.0.113.50', cf: { asOrganization: org, asn: 7922 } }));
    is('…an ordinary internet provider isn’t: ' + org, jr.ok && jr.relay === false, jr);
  }
  for (const [cf, why] of [[{ asOrganization: 'T-Mobile USA, Inc.', asn: 21928 }, 'T-Mobile'], [{ asOrganization: 'Cellco Partnership DBA Verizon Wireless', asn: 6167 }, 'Verizon Wireless'], [{ asOrganization: 'AT&T Mobility LLC', asn: 20057 }, 'AT&T Mobility']]) {
    const jr = await json(await req(W, { token: gwen.idToken, ip: '172.58.10.20', cf }));
    is('a phone company’s cellular IPv4 address (thousands share it) is marked shared: ' + why, jr.ok && jr.relay === true, jr);
  }
  const j6 = await json(await req(W, { token: gwen.idToken, ip: '2607:fb90:1234:5678::1', cf: { asOrganization: 'T-Mobile USA, Inc.', asn: 21928 } }));
  is('…its IPv6 network isn’t (each phone has its own)', j6.ok && j6.relay === false && j6.net === 'v6:2607:fb90:1234:5678', j6);
  const rs = await req(W, { token: stranger.idToken });
  is('someone who isn’t the office’s (any login anyone can make): nothing written down', rs.status === 502 && (await json(rs)).error === 'database' && !(await get('tcNetSeen/' + stranger.localId)), rs.status);
  const a = await json(await req(W, { token: gwen.idToken, ip: '2600:1700:ABCD:0012:1111:2222:3333:4444' }));
  const b = await json(await req(W, { token: gwen.idToken, ip: '2600:1700:abcd:12::99' }));
  is('IPv6: two addresses on the office network are the same network', a.net === 'v6:2600:1700:abcd:12' && b.net === 'v6:2600:1700:abcd:12' && a.office && b.office, [a, b]);
  const c = await json(await req(W, { token: gwen.idToken, ip: '2600:1700:abcd:13::1' }));
  is('…the next network over isn’t', c.net === 'v6:2600:1700:abcd:13' && c.office === false, c);
  const d = await json(await req(W, { token: gwen.idToken, ip: '::ffff:203.0.113.10' }));
  is('an IPv4 address written the IPv6 way is the IPv4 one', d.net === 'v4:203.0.113.10' && d.office, d);
  for (const [ip, why] of [['not-an-ip', 'not an address'], ['300.1.1.1', 'a number over 255'], ['1:2:3', 'too short'], ['1::2::3', 'two gaps'], ['1:2:3:4:5:6:7:8:9', 'too long']]) {
    const r = await req(W, { token: gwen.idToken, ip });
    is('no network from ' + why, r.status === 400 && (await json(r)).error === 'no-address', ip);
  }
  const r3 = await req(W, { token: gwen.idToken, ip: null });
  is('…or with no address at all', r3.status === 400);
  const r4 = await req(W, { token: gwen.idToken, cf: {} });
  const j4 = await json(r4);
  is('no internet provider known: still fine', r4.status === 200 && j4.org === '' && j4.city === '', j4);
}

console.log('\n# whose token');
{
  for (const [o, why] of [[{ aud: 'other-project' }, 'another project'], [{ iss: 'https://securetoken.google.com/other' }, 'another issuer'], [{ exp: nowS() - 5 }, 'expired'],
    [{ iat: nowS() + 3600 }, 'from the future'], [{ sub: '' }, 'nobody'], [{ sub: 'a/b' }, 'a strange user id'], [{ auth_time: nowS() + 3600 }, 'signed in in the future']]) {
    const r = await req(W, { token: unsigned(claims(o)) });
    is('refused: ' + why, r.status === 401, o);
  }
  const r = await req(W, { token: unsigned(claims({ sub: 'someone1' })) });
  is('(the emulator’s own unsigned tokens work here only because this copy says emulator)', r.status === 200);
}

console.log('\n# its own login');
{
  await rest('DELETE', FS + '/tcNetBot/' + bot.localId);
  const W2 = await worker(Object.assign({}, cfg));
  const r = await req(W2, { token: gwen.idToken });
  const j = await json(r);
  is('a login Dr. A replaced (or never saved) can’t write anything', r.status === 502 && j.error === 'database', j);
  await put('tcNetBot/' + bot.localId, { email: sv('x@example.com'), at: { timestampValue: new Date().toISOString() } });
  const W3 = await worker(Object.assign({}, cfg, { botPassword: 'wrong-password' }));
  const r3 = await req(W3, { token: gwen.idToken });
  const j3 = await json(r3);
  is('a wrong password says the login was refused', r3.status === 502 && /login was refused/.test(j3.detail || ''), j3);
  const W4 = await worker(null);
  const r4 = await req(W4, { token: gwen.idToken });
  is('a copy with no login in it says so', r4.status === 500 && (await json(r4)).error === 'not-configured');
  const seen = await rest('PATCH', FS + '/tcNetSeen/' + gwen.localId, { fields: { net: sv('v4:203.0.113.10'), office: { booleanValue: true }, org: sv(''), city: sv(''), at: { timestampValue: new Date().toISOString() } } }, gwen.idToken);
  is('(and nobody else can write down a network: Gwen can’t write her own)', seen.status === 403, seen.status);
}

console.log('\n# Google’s signature (RS256), with a key made here');
{
  const mk = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
  const k = mk(), other = mk(), jwk = Object.assign(k.publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
  let keyFetches = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === JWKS_URL) { keyFetches++; return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } }); }
    return realFetch(url, init);
  };
  const sign = (c, key, head) => {
    const h = b64u(JSON.stringify(Object.assign({ alg: 'RS256', kid: 'k1', typ: 'JWT' }, head || {}))), p = b64u(JSON.stringify(c));
    const s = createSign('RSA-SHA256').update(h + '.' + p).sign(key || k.privateKey);
    return h + '.' + p + '.' + b64u(s);
  };
  const WR = await worker(Object.assign({}, cfg, { emulator: false }));
  const r = await req(WR, { token: sign(claims({ sub: 'signedUser1' })) });
  const j = await json(r), s = await get('tcNetSeen/signedUser1');
  is('a token Google signed: checked, and written down for that login', r.status === 200 && j.office === true && s && s.net.stringValue === 'v4:203.0.113.10', [r.status, j]);
  const good = sign(claims({ sub: 'signedUser1' })), parts = good.split('.');
  const forged = parts[0] + '.' + b64u(JSON.stringify(claims({ sub: 'someoneElse' }))) + '.' + parts[2];
  is('the same signature on someone else’s name: refused', (await req(WR, { token: forged })).status === 401);
  is('signed with another key: refused', (await req(WR, { token: sign(claims(), other.privateKey) })).status === 401);
  is('an unsigned token: refused here (not the emulator)', (await req(WR, { token: unsigned(claims()) })).status === 401);
  is('a token saying another kind of signature: refused', (await req(WR, { token: sign(claims(), null, { alg: 'HS256' }) })).status === 401);
  is('…or with no key named', (await req(WR, { token: sign(claims(), null, { kid: undefined }) })).status === 401);
  const before = keyFetches;
  is('a key Google doesn’t have: refused', (await req(WR, { token: sign(claims(), null, { kid: 'nope' }) })).status === 401);
  await req(WR, { token: sign(claims(), null, { kid: 'nope2' }) });
  is('…and Google’s keys aren’t fetched again for every unknown one (once a minute at most)', keyFetches - before <= 1, keyFetches - before);
  is('Google’s keys are kept between checks', keyFetches <= 2, keyFetches);
  is('signed but for another project: refused', (await req(WR, { token: sign(claims({ aud: 'other' })) })).status === 401);
  globalThis.fetch = realFetch;
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
