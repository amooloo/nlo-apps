/* =====================================================================
   NLO Time Clock — the office check (a Cloudflare Worker)

   Staff can clock in on their own phone or computer only while they're on the office's internet. A web page can't
   see which network it's on, and the database's rules can't either, so the time clock asks this small Worker right
   before each punch. It:
     • checks the person is signed in to NLO (their sign-in token, signed by Google),
     • looks at the internet address the request came from (an IPv4 address exactly; an IPv6 address by its
       network, the first half: every device on the office network has its own IPv6 address, and they change),
     • and writes down, under its own login, which network that login was on just now, with a one-time punch number
       that only the page asking gets back.
   The database's rules then take an "at the office" punch only within 2 minutes of that, only under that punch
   number (so one check is good for one punch), and only when the network is one Dr. A saved as the office
   (Time Clock → Settings → Office network → This is the office). Private Relay and VPN addresses are marked, so
   they can't be saved as the office's.

   The login inside can only write down networks: it can't read or change anyone's time, or anything in NLO Cases.
   But it is the office lock's key — whoever has it can make any login look like it's at the office — so keep this code
   to yourself, and if it ever gets out, make a new one in Time Clock → Settings (the old login stops working).

   Set up (about 5 minutes, once — Time Clock → Settings → Office network shows the same steps):
     Cloudflare dashboard → Workers & Pages → Create → Start with Hello World → name it (e.g. nlo-office-check)
     → Deploy → Edit code → select everything → paste this whole file → Deploy. Then copy the address that ends in
     workers.dev into Time Clock → Settings → Office network.
   ===================================================================== */
const VERSION = '1';
const CONFIG = /*TC_NET_CONFIG*/null; // filled in by NLO Time Clock when you copy it (Settings → Office network)

export default {
  async fetch(request) {
    try { return await handle(request); }
    catch (e) { return reply({ ok: false, error: 'internal', detail: clip(e && e.message, 200) }, 500, request); }
  }
};

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const PAGE = 'https://amooloo.github.io/nlo-apps/nlo-timeclock.html';
const authBase = () => CONFIG.authBase || 'https://identitytoolkit.googleapis.com/v1';
const fsBase = () => CONFIG.fsBase || 'https://firestore.googleapis.com/v1';
const docs = () => 'projects/' + CONFIG.projectId + '/databases/(default)/documents';
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }

/* ---------- answers (the time clock's page may read them; nobody else's) ---------- */
function corsFor(req) {
  const o = req.headers.get('Origin') || '', ok = (CONFIG && CONFIG.origins) || ['https://amooloo.github.io'];
  return ok.indexOf(o) >= 0 ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : null;
}
function reply(body, status, req) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, corsFor(req) || {}) });
}

async function handle(req) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }, corsFor(req) || {}) });
  }
  if (!CONFIG || !CONFIG.projectId || !CONFIG.apiKey || !CONFIG.botEmail || !CONFIG.botPassword) {
    return reply({ ok: false, error: 'not-configured', detail: 'This copy has no login in it: copy it again from Time Clock → Settings → Office network.' }, 500, req);
  }
  if (req.method === 'GET' && url.pathname === '/') return new Response('NLO Time Clock office check ' + VERSION + ': running.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (url.pathname !== '/check') return reply({ ok: false, error: 'not-found' }, 404, req);
  if (req.method !== 'POST') return reply({ ok: false, error: 'method' }, 405, req);
  if (!corsFor(req)) return reply({ ok: false, error: 'origin' }, 403, req);
  // the sign-in token comes as plain text (so the browser sends it straight away, without asking first)
  const token = clip(await req.text(), 5000).trim();
  if (!token || token.length > 4096) return reply({ ok: false, error: 'no-token' }, 401, req);
  let uid;
  try { uid = await verifyIdToken(token); } catch (e) { return reply({ ok: false, error: 'bad-token' }, 401, req); }
  const net = netKey(req.headers.get('CF-Connecting-IP'));
  if (!net) return reply({ ok: false, error: 'no-address' }, 400, req);
  const cf = req.cf || {};
  const org = clip(cf.asOrganization || '', 100), city = clip([cf.city, cf.region].filter(Boolean).join(', '), 60);
  const asn = Number(cf.asn) || 0, relay = relayOf(asn, org, net);
  // a one-time punch number: the rules take an "at the office" punch only under it (this page is the only one told it)
  const pid = 'p' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  let office;
  try {
    office = await isOffice(net);
    await saveSeen(uid, { net, office, org, city, pid, relay });
  } catch (e) { return reply({ ok: false, error: 'database', detail: clip(e && e.message, 200) }, 502, req); }
  return reply({ ok: true, office, net, org, city, relay, pid, bot: String(CONFIG.botEmail).split('@')[0] }, 200, req);
}
/* an address many people share that isn't the office's own internet: iCloud Private Relay (Apple, Akamai, Cloudflare,
   Fastly), Cloudflare WARP, VPNs and hosting companies — and a phone company's cellular IPv4 address, which thousands of
   phones share (their IPv6 networks are each phone's own). It can't be saved as the office's network. */
const RELAY_ASN = [714, 6185, 13335, 36183, 54113, 209242];
const MOBILE_ASN = [6167, 21928, 20057, 22394, 6430, 10507, 3651, 4181, 393387];
function relayOf(asn, org, net) {
  org = String(org || '');
  if (RELAY_ASN.indexOf(asn) >= 0) return true;
  if (/vpn|private ?relay|icloud|\b(hosting|data ?cent(er|re)|digitalocean|amazon|aws|google cloud|microsoft|azure|oracle|ovh|hetzner|linode|akamai|fastly|cloudflare|vultr|m247|datacamp|choopa|leaseweb|tefincom|packethub|clouvider|proton|surfshark|highwinds|stackpath|zenlayer|hostroyale|performive|xtom|gthost)\b/i.test(org)) return true;
  return /^v4:/.test(net || '') && (MOBILE_ASN.indexOf(asn) >= 0 || /cellco|verizon wireless|t-mobile|at&t mobility|sprint|us cellular|cricket|boost|metropcs/i.test(org));
}

/* ---------- which network: 'v4:203.0.113.7' (the address), or 'v6:2600:1700:abcd:12' (the first four groups) ---------- */
function netKey(ip) {
  ip = String(ip || '').trim().toLowerCase();
  const m4 = ip.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) { const p = m4.slice(1).map(Number); return p.every(x => x <= 255) ? 'v4:' + p.join('.') : ''; }
  if (!/^[0-9a-f:]{2,39}$/.test(ip) || ip.indexOf(':') < 0) return '';
  const halves = ip.split('::');
  if (halves.length > 2) return '';
  const head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 && fill < 1) return '';
  const groups = head.concat(new Array(fill).fill('0'), tail);
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return '';
  return 'v6:' + groups.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(':');
}

/* ---------- the person's sign-in token: Google's signature, this project, not expired ---------- */
const enc = new TextEncoder();
function b64url(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64json = s => JSON.parse(new TextDecoder().decode(b64url(s)));
let KEYS = null; // Google's current public keys, kept as long as Google says they're good
async function googleKey(kid) {
  const now = Date.now();
  if (!KEYS || now > KEYS.until || (!KEYS.jwk[kid] && now > KEYS.got + 60000)) {
    const r = await fetch(JWKS_URL);
    if (!r.ok) throw new Error('Google’s keys: ' + r.status);
    const j = await r.json(), m = String(r.headers.get('Cache-Control') || '').match(/max-age=(\d+)/);
    KEYS = { got: now, until: now + (m ? Math.min(Number(m[1]), 86400) * 1000 : 3600000), jwk: Object.create(null), key: Object.create(null) };
    (j.keys || []).forEach(k => { if (k && k.kty === 'RSA' && typeof k.kid === 'string') KEYS.jwk[k.kid] = k; });
  }
  const jwk = KEYS.jwk[kid];
  if (!jwk) throw new Error('unknown key');
  if (!KEYS.key[kid]) KEYS.key[kid] = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return KEYS.key[kid];
}
async function verifyIdToken(token) {
  const p = token.split('.');
  if (p.length !== 3) throw new Error('shape');
  const head = b64json(p[0]), body = b64json(p[1]);
  if (CONFIG.emulator) { if (head.alg !== 'none' && head.alg !== 'RS256') throw new Error('alg'); } // (tests: the emulator's tokens aren't signed)
  else {
    if (head.alg !== 'RS256' || typeof head.kid !== 'string') throw new Error('alg');
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await googleKey(head.kid), b64url(p[2]), enc.encode(p[0] + '.' + p[1]));
    if (!ok) throw new Error('signature');
  }
  const now = Math.floor(Date.now() / 1000), P = CONFIG.projectId;
  if (body.aud !== P || body.iss !== 'https://securetoken.google.com/' + P) throw new Error('project');
  if (!(body.exp > now) || !(body.iat <= now + 300) || !(body.auth_time <= now + 300)) throw new Error('time');
  if (typeof body.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.sub)) throw new Error('user');
  return body.sub;
}

/* ---------- its own login, and the two things it does in the database ---------- */
let BOT = null;
function hdrs(token) {
  const h = { 'Content-Type': 'application/json', Referer: CONFIG.referer || PAGE };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}
async function botToken(fresh) {
  if (!fresh && BOT && Date.now() < BOT.until) return BOT.token;
  const r = await fetch(authBase() + '/accounts:signInWithPassword?key=' + encodeURIComponent(CONFIG.apiKey),
    { method: 'POST', headers: hdrs(), body: JSON.stringify({ email: CONFIG.botEmail, password: CONFIG.botPassword, returnSecureToken: true }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.idToken) throw new Error('the office check’s login was refused (' + ((j.error && j.error.message) || r.status) + '): make a new one in Time Clock → Settings');
  BOT = { token: j.idToken, until: Date.now() + Math.max(300, Number(j.expiresIn) || 3600) * 1000 - 240000 };
  return BOT.token;
}
async function fs(method, url, body) {
  let r;
  for (let i = 0; i < 2; i++) {
    r = await fetch(url, { method, headers: hdrs(await botToken(i > 0)), body: body ? JSON.stringify(body) : undefined });
    if (r.status !== 401) break; // (its token ran out early: sign in again, once)
  }
  return r;
}
// a network Dr. A saved as the office
async function isOffice(net) {
  const r = await fs('GET', fsBase() + '/' + docs() + '/tcOffice/' + encodeURIComponent(net) + '?mask.fieldPaths=name');
  if (r.status === 200) return true;
  if (r.status === 404) return false;
  throw new Error('reading the office networks: ' + r.status + ' ' + clip(await r.text(), 120));
}
// which network this login was on, with the database's own time (the rules take an "at the office" punch for 2 minutes)
async function saveSeen(uid, o) {
  const r = await fs('POST', fsBase() + '/' + docs() + ':commit', { writes: [{
    update: { name: docs() + '/tcNetSeen/' + uid, fields: { net: { stringValue: o.net }, office: { booleanValue: !!o.office }, org: { stringValue: o.org }, city: { stringValue: o.city }, pid: { stringValue: o.pid }, relay: { booleanValue: !!o.relay } } },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }]
  }] });
  if (!r.ok) throw new Error('saving the network: ' + r.status + ' ' + clip(await r.text(), 120));
}
