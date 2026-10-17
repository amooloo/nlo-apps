/* The alert script (dist/nlo-inventory-alerts.gs, from robot/script.js) against the Firebase emulators (Firestore and Auth for
   NLO Inventory, the Realtime Database for the old Inventory database), with stand-ins for Google's Apps Script services
   (email, the cache, the script's properties, triggers, this Google account's token). Made-up people and supplies only.
     python3 build.py && npx firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases "node test/robot.test.js"
   What it covers: setup before and after the move (nothing copied before it); the script's own login through the rules; the
   alerts (one email for all, who did it, cleared, never twice); the copy for Staff Meeting and AISA (everything at setup and
   once a night, then only what changed; never removing anything; keys the old database can't take); a minute with no change
   (one read); an old Inventory page still open (one email an hour, its queue cleared); nights; a login that was replaced
   (the error says what to do, the warning email after 15 failed checks); when it last checked. Version 3: with the phone push
   on, someone else's cart adds go to Dr. A's phone (a stand-in for ntfy here) instead of an email, his own aren't sent, the
   rest are emailed while the email alerts are on; when ntfy can't be reached (or says "too many") the pushes go through
   ntfy's email address and the direct way rests 3 hours; the test push he asks for. Version 4: the deals — this Gmail's promo
   emails (a stand-in Gmail here) read by the AI (a stand-in for Gemini) and matched to the office's supplies; what never
   reaches the AI (orders, cases, replies, other senders, anything naming a patient); the push and the record in Inventory;
   each email once; the AI failing (tried again, then left); nights; Friday's roundup; ended deals taken off; no key. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { load, calls, urls } = require('./gas_fakes');
const P = 'demo-nlo-cases', FS = 'http://127.0.0.1:8080/v1/projects/' + P + '/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1', RT = 'http://127.0.0.1:9000';
const NTFY_PORT = 8793, NTFY = 'http://127.0.0.1:' + NTFY_PORT, TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'invbot-'));
const NTFY_LOG = path.join(TMP, 'ntfy.jsonl'), NTFY_FAIL = path.join(TMP, 'ntfy.fail');
const AI_PORT = 8796, AI = 'http://127.0.0.1:' + AI_PORT, AI_LOG = path.join(TMP, 'ai.jsonl'), AI_FAIL = path.join(TMP, 'ai.fail');
const aiCalls = () => (fs.existsSync(AI_LOG) ? fs.readFileSync(AI_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const pushes = () => (fs.existsSync(NTFY_LOG) ? fs.readFileSync(NTFY_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
let pass = 0, fail = 0;
const ok = (name, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + name + (c || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 500))); };

async function admin(method, p, body) {
  const r = await fetch(FS + '/' + p, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
  return { code: r.status, json: j };
}
function F(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(F) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, F(x)])) } };
}
const put = (p, obj) => admin('PATCH', p, { fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, F(v)])) });
const del = p => admin('DELETE', p);
async function list(coll) {
  const r = await fetch(FS + ':runQuery', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coll }] } }) });
  return (await r.json()).filter(x => x.document).map(x => x.document);
}
async function rt(method, p, body) {
  const r = await fetch(RT + p + '.json?ns=' + P, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json();
}
let rev = 0;
/* a change the page made: the record, then the counter */
async function bump() { rev++; await put('invState/rev', { n: rev, up: new Date(), upBy: 'gwen' }); }

(async () => {
  // the stand-in for ntfy, in its own process (the script's calls block this one); NTFY_FAIL holds a status to answer with
  const ntfy = cp.spawn(process.execPath, ['-e', `
    const http = require('http'), fs = require('fs');
    http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
      if (fs.existsSync(${JSON.stringify(NTFY_FAIL)})) { r.statusCode = Number(fs.readFileSync(${JSON.stringify(NTFY_FAIL)}, 'utf8')) || 500; return r.end('down'); }
      fs.appendFileSync(${JSON.stringify(NTFY_LOG)}, b.replace(/\\n/g, ' ') + '\\n'); r.end('{}'); }); }).listen(${NTFY_PORT}, '127.0.0.1');`], { stdio: 'inherit' });
  // the stand-in for Gemini: answers by what the email says (FLAKY fails while AI_FAIL exists); logs each prompt
  const ai = cp.spawn(process.execPath, ['-e', `
    const http = require('http'), fs = require('fs');
    http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
      const body = JSON.parse(b || '{}'), text = (((body.contents || [])[0] || {}).parts || [])[0].text || '';
      const subj = (/\\nSubject: (.*)/.exec(text) || [])[1] || '';
      fs.appendFileSync(${JSON.stringify(AI_LOG)}, JSON.stringify({ url: q.url, subj, text, gen: body.generationConfig }) + '\\n');
      if (/FLAKY/.test(text) && fs.existsSync(${JSON.stringify(AI_FAIL)})) { r.statusCode = 503; return r.end('{}'); }
      let a = { promo: false };
      if (/PULSE20/.test(text)) a = { promo: true, vendor: 'SunSurgical', title: '20% off Pulse Nitrile gloves', ends: '2099-10-31', how: 'Use code PULSE20 online', items: [{ id: 'ppe-1', what: '20% off every box', price: '$7.30' }] };
      else if (/MARIS NEWSLETTER/.test(text)) a = { promo: true, vendor: 'Mari\\u2019s List', title: '15% off intraoral scanners', ends: '', how: 'Ask Mari', items: [] };
      else if (/BADID/.test(text)) a = { promo: true, vendor: '', title: 'Buy 10, get 2 free: o-ties', ends: 'soon', how: '', items: [{ id: 'nope', what: 'x' }, { id: 'el-1', what: 'buy 10 get 2 free' }, { id: 'el-1', what: 'again' }] };
      else if (/FLAKY/.test(text)) a = { promo: true, vendor: 'Ortho Shop', title: 'Flash sale: o-ties', ends: '', how: '', items: [{ id: 'el-1', what: 'flash sale' }] };
      r.setHeader('Content-Type', 'application/json');
      r.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '\`\`\`json\\n' + JSON.stringify(a) + '\\n\`\`\`' }] } }] }));
    }); }).listen(${AI_PORT}, '127.0.0.1');`], { stdio: 'inherit' });
  process.on('exit', () => { try { ntfy.kill(); } catch (e) { } try { ai.kill(); } catch (e) { } });
  await new Promise(r => setTimeout(r, 400));
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + P + '/accounts', { method: 'DELETE' });
  await fetch(RT + '/.settings/rules.json?ns=' + P, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify({ rules: { '.read': 'auth != null', '.write': 'auth != null' } }) });
  // the old database as the old app left it (Staff Meeting reads items, orders, log and budget; the old page's alert queue)
  await rt('PUT', '/', { nlo: { items: { 'ppe-1': { id: 'ppe-1', name: 'Gloves SM', qty: 14 }, 'old-only': { id: 'old-only', name: 'Only in the old one', qty: 1 } },
    orders: { 'o-1': { id: 'o-1', vendor: 'SunSurgical', status: 'open' } }, log: { l1: { id: 'l1', type: 'use', delta: -1, date: '2026-10-01T12:00:00.000Z' } },
    budget: { monthly: 8000, months: { '2026-09': { total: 1 } } }, settings: { alertsOn: true, geminiKey: 'AIzaKEEP', aisaAdminKey: 'keep-me' }, cadence: { roster: { v: 1 } } } });
  // the office: Dr. A, Gwen; the script's login (as Inventory → Settings → Email alerts makes it)
  const signup = async (email, pw) => (await (await fetch(AUTH + '/accounts:signUp?key=any', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, returnSecureToken: true }) })).json()).localId;
  const owner = await signup('dr.test@example.com', 'owner-pass-1');
  await put('meta/setup', { owner, at: new Date() }); await put('members/' + owner, { staffId: 'amir', role: 'owner', active: true, name: 'Dr. Test' });
  const botEmail = 'inv-alerts-abc123@staff.thenextlevelorthodontics.com', botPassword = 'robot-pass-123456789';
  const bot = await signup(botEmail, botPassword);
  await put('invBots/' + bot, { email: botEmail, at: new Date() });
  const CFG = { apiKey: 'any', projectId: P, botEmail, botPassword, authBase: AUTH, fsBase: 'http://127.0.0.1:8080/v1', dbUrl: RT, dbNs: P, ntfyBase: NTFY, ntfyMail: 'ntfy-{topic}@ntfy.test', aiBase: AI };
  const clock = { off: 0 };
  // 10 AM office time today (the script's day and night follow the office's clock)
  const tenAm = (() => { const d = new Date(); const s = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false }); const h = Number(/, (\d+):/.exec(s)[1]); return -(((h - 10) * 60 + d.getMinutes()) * 60000); })();
  clock.off = tenAm;
  const sv = load(CFG, 'dr.test@example.com', clock);

  /* ---------- before the move ---------- */
  let r; try { r = sv.run('setup()'); } catch (e) { r = { error: e.message }; }
  ok('setup (before the move): runs', r && !r.error, r);
  ok('setup: the every-minute check is on', sv.triggers.length === 1 && sv.triggers[0].fn === 'checkInventoryAlerts' && sv.triggers[0].every === 1, sv.triggers);
  ok('setup: says nothing was copied yet (not moved)', /hasn’t been moved over yet/.test(sv.logs.join(' ')), sv.logs);
  ok('setup: the old database untouched', (await rt('GET', '/nlo/items/old-only')).name === 'Only in the old one' && (await rt('GET', '/nlo/items/ppe-1')).qty === 14);
  ok('setup: saved its login in its own properties', JSON.parse(sv.props.INV_CFG || '{}').botEmail === botEmail);

  /* ---------- moved: everything copied once ---------- */
  const T = new Date();
  await put('invItems/ppe-1', { id: 'ppe-1', name: 'Gloves SM', qty: 12, sources: [{ vendor: 'SunSurgical', price: 9.13 }], note: null, up: T, upBy: 'gwen' });
  await put('invItems/ad.1', { id: 'ad.1', name: 'Odd id', qty: 3, up: T, upBy: 'gwen' });
  await put('invOrders/o-1', { id: 'o-1', vendor: 'SunSurgical', status: 'received', items: [{ itemId: 'ppe-1', qty: 2, price: 9.13 }], up: T, upBy: 'gwen' });
  // the log: the moved entries (as the old app stamped them) and Gwen's own record (one entry naming someone else: it's hers)
  await put('invLog/m2026-10~old', { e: { l1: { id: 'l1', type: 'use', delta: -1, date: '2026-10-01T12:00:00.000Z', byId: 's_kim' } }, mon: '2026-10', who: 'old', up: T, upBy: 'amir' });
  await put('invLog/m2026-10~gwen', { e: { l2: { id: 'l2', type: 'receive', delta: 2, amount: 18.26, orderId: 'o-1', date: '2026-10-15T15:00:00.000Z', by: 'Sarah B.', byId: 'sarah' } }, mon: '2026-10', who: 'gwen', up: T, upBy: 'gwen' });
  await put('invState/budget', { monthly: 8500, categories: { misc: 100 }, up: T, upBy: 'sarah' });
  await put('invExpenses/x1', { id: 'x1', amount: 12, date: '2026-10-02', category: 'misc', byId: 'gwen', addedAt: '2026-10-02T10:00:00Z', up: T, upBy: 'gwen' });
  await put('invMeta/moved', { at: Date.now(), up: T, upBy: 'amir' });
  await put('invState/settings', { alertsOn: true, locations: [], up: T, upBy: 'amir' });   // (the page leaves alerts only while they're on)
  await bump();
  r = sv.run('setup()');
  ok('setup (after the move): copied everything', r.moved === true && r.copied >= 6, r);
  const items = await rt('GET', '/nlo/items');
  ok('copy: the supply as Inventory has it now', items['ppe-1'] && items['ppe-1'].qty === 12 && items['ppe-1'].sources[0].price === 9.13 && !('up' in items['ppe-1']) && !('upBy' in items['ppe-1']), items['ppe-1']);
  ok('copy: no nulls in the old database', !('note' in items['ppe-1']));
  ok('copy: a key the old database can’t take is made safe', items['ad_1'] && items['ad_1'].id === 'ad.1', Object.keys(items));
  ok('copy: nothing removed from the old database', items['old-only'] && items['old-only'].name === 'Only in the old one');
  ok('copy: orders', (await rt('GET', '/nlo/orders/o-1')).status === 'received');
  const log = await rt('GET', '/nlo/log');
  ok('copy: the log, entry by entry', log.l2 && log.l2.amount === 18.26 && log.l1.delta === -1, log);
  ok('copy: an entry in Gwen’s record is Gwen’s, whatever name it carries; a moved one keeps its old stamp', log.l2.byId === 'gwen' && log.l1.byId === 's_kim', log);
  const bud = await rt('GET', '/nlo/budget');
  ok('copy: the budget, its expenses as the list Staff Meeting reads', bud.monthly === 8500 && bud.expenses && bud.expenses[0].amount === 12 && !('up' in bud) && !('up' in bud.expenses[0]), bud);
  ok('copy: a budget key the app doesn’t keep stays as it was', bud.months && bud.months['2026-09'].total === 1, bud);
  ok('copy: the rest of the old database untouched (keys, roster)', (await rt('GET', '/nlo/settings/geminiKey')) === 'AIzaKEEP' && (await rt('GET', '/nlo/settings/aisaAdminKey')) === 'keep-me' && (await rt('GET', '/nlo/cadence/roster/v')) === 1);
  const beat = (await list('invBeat'))[0];
  ok('setup: noted when it checked (version 4)', beat && beat.fields.ver.stringValue === '4' && beat.name.endsWith('/' + bot), beat);

  /* ---------- alerts ---------- */
  sv.mail.length = 0;
  await put('invAlerts/a1', { t: 'cart', at: Date.now() - 30000, by: 'Gwen R.', lines: [{ n: 'Gloves SM', q: 2, u: 'box', p: 18.26, v: 'SunSurgical' }], inCart: 3, up: new Date(), upBy: 'gwen' });
  await put('invAlerts/a2', { t: 'ordered', at: Date.now() - 10000, by: 'Sarah B.', vendor: 'SunSurgical', lines: [{ n: 'Gloves SM', q: 2, p: 18.26 }], total: 18.26, id: 'o-2', up: new Date(), upBy: 'sarah' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('alerts: both sent in one email', r.sent === 2 && sv.mail.length === 1, { r, mail: sv.mail.map(m => m.subject) });
  const m0 = sv.mail[0] || {};
  ok('alerts: the subject counts them', m0.subject === 'Inventory: 1 added to cart, 1 open order', m0.subject);
  ok('alerts: each says who did it', /Gwen R\. added Gloves SM ×2 to the cart/.test(m0.body) && /Sarah B\. moved an order to Open Orders: SunSurgical/.test(m0.body), m0.body);
  ok('alerts: the link opens the new Inventory', /amooloo\.github\.io\/nlo-apps\/nlo-inventory\.html/.test(m0.body) && /Settings → Email alerts → Turn off/.test(m0.htmlBody), m0.htmlBody && m0.htmlBody.slice(-300));
  ok('alerts: cleared once sent', (await list('invAlerts')).length === 0);
  r = sv.run('checkInventoryAlerts()');
  ok('alerts: nothing new, nothing sent', r.sent === 0 && sv.mail.length === 1, r);

  /* ---------- a minute with no change: one read ---------- */
  const c0 = calls();
  r = sv.run('checkInventoryAlerts()');
  const n = calls() - c0;
  ok('no change: only the change counter (and the old page’s queue) read', r.copied === 0 && n <= 3, { r, n, urls: urls.slice(-n) });

  /* ---------- only what changed ---------- */
  await new Promise(res => setTimeout(res, 20));
  await put('invItems/ppe-1', { id: 'ppe-1', name: 'Gloves SM', qty: 9, up: new Date(), upBy: 'gwen' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('changed: one supply copied', r.copied === 1 && (await rt('GET', '/nlo/items/ppe-1')).qty === 9, r);
  ok('changed: the others left as they were', (await rt('GET', '/nlo/items/ad_1')).qty === 3);
  await put('invLog/m2026-10~gwen', { e: { l2: { id: 'l2', type: 'receive', delta: 2, amount: 18.26, orderId: 'o-1', date: '2026-10-15T15:00:00.000Z', byId: 'gwen' }, l3: { id: 'l3', type: 'tax', amount: 1.1, orderId: 'o-1', date: '2026-10-16T15:00:00.000Z', byId: 'gwen' } }, mon: '2026-10', who: 'gwen', up: new Date(), upBy: 'gwen' });
  await put('invState/budget', { monthly: 9000, categories: {}, up: new Date(), upBy: 'sarah' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('changed: a new log entry and the budget', (await rt('GET', '/nlo/log/l3')).amount === 1.1 && (await rt('GET', '/nlo/budget/monthly')) === 9000, r);
  // an expense taken off here comes off the list there
  await del('invExpenses/x1'); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('changed: an expense taken off comes off the list Staff Meeting reads', !(await rt('GET', '/nlo/budget')).expenses && (await rt('GET', '/nlo/budget/months/2026-09/total')) === 1, await rt('GET', '/nlo/budget'));
  // the AI keys: copied where Staff Meeting and Month-End read them
  await put('invState/ai', { gemini: 'AIzaNEW', up: new Date(), upBy: 'amir' }); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('changed: the Gemini key copied for Staff Meeting and Month-End (the other settings left alone)', (await rt('GET', '/nlo/settings/geminiKey')) === 'AIzaNEW' && (await rt('GET', '/nlo/settings/aisaAdminKey')) === 'keep-me', r);
  // a save sent a moment before the last one copied but that landed after it: the next copy still finds it
  const last = JSON.parse(sv.props.INV_UP).invItems;
  await put('invItems/late-1', { id: 'late-1', name: 'Landed late', qty: 5, up: new Date(last - 60000), upBy: 'gwen' }); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('changed: a save that landed late is still copied (each copy looks 5 minutes back)', (await rt('GET', '/nlo/items/late-1')).qty === 5, r);

  /* ---------- many alerts at once: a few emails; a huge one; Gmail's daily limit; a mail failure ---------- */
  sv.mail.length = 0;
  for (let i = 0; i < 60; i++) await put('invAlerts/m' + String(i).padStart(2, '0'), { t: 'cart', at: Date.now() - 60000 + i, by: 'Gwen R.', lines: [{ n: 'Item ' + i, q: 1 }], up: new Date(), upBy: 'gwen' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('many: 60 alerts come as 3 emails (25, 25, 10)', r.sent === 60 && sv.mail.length === 3 && /^Inventory: 25 added to cart/.test(sv.mail[0].subject) && /^Inventory: 10 added to cart/.test(sv.mail[2].subject), { r, subjects: sv.mail.map(m => m.subject) });
  ok('many: all cleared', (await list('invAlerts')).length === 0);
  // more than a check takes at once (200): the rest go the next minute, with no new change needed
  sv.mail.length = 0;
  for (let i = 0; i < 210; i++) await put('invAlerts/p' + String(i).padStart(3, '0'), { t: 'cart', at: Date.now() - 300000 + i, by: 'Gwen R.', lines: [{ n: 'Item ' + i, q: 1 }], up: new Date(), upBy: 'gwen' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('over 200: the first 200 go (in emails of 25)', r.sent === 200 && sv.mail.length === 8 && (await list('invAlerts')).length === 10, { r, n: sv.mail.length });
  r = sv.run('checkInventoryAlerts()');
  ok('over 200: the rest go the next minute, with no new change', r.sent === 10 && sv.mail.length === 9 && (await list('invAlerts')).length === 0, r);
  // two addresses get the alerts: each email counts twice against Gmail's daily limit
  sv.mail.length = 0; sv.props.ALERT_EMAIL = 'dr.test@example.com, office@example.com'; sv.mailCtl.quota = 1;
  await put('invAlerts/r1', { t: 'cart', at: Date.now(), by: 'Gwen R.', lines: [{ n: 'Masks', q: 1 }], up: new Date(), upBy: 'gwen' }); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('two addresses, room for one more email: it waits (no failure)', r.sent === 0 && r.waiting === 1 && !sv.props.FAILS && sv.mail.length === 0, { r, fails: sv.props.FAILS });
  sv.mailCtl.quota = 100;
  r = sv.run('checkInventoryAlerts()');
  ok('two addresses: sent once there’s room', r.sent === 1 && sv.mail.length === 1, r);
  delete sv.props.ALERT_EMAIL;
  sv.mail.length = 0;
  const huge = Array.from({ length: 300 }, (_, i) => ({ n: 'A very long supply name '.repeat(20) + i, q: 1, u: 'box', p: 1, v: 'Vendor '.repeat(30) }));
  for (let i = 0; i < 3; i++) await put('invAlerts/h' + i, { t: 'received', at: Date.now() + i, by: 'Gwen R. '.repeat(40), vendor: 'V'.repeat(5000), note: 'N'.repeat(100000), lines: huge, up: new Date(), upBy: 'gwen' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('huge: three oversized alerts still go out, each email under Gmail’s size', r.sent === 3 && sv.mail.length >= 1 && sv.mail.every(m => m.htmlBody.length + m.body.length < 200 * 1024), { r, sizes: sv.mail.map(m => m.htmlBody.length + m.body.length) });
  ok('huge: a long alert is cut short (60 lines, and it says how many more)', /and 240 more line\(s\)/.test(sv.mail[0] && sv.mail[0].body || ''), (sv.mail[0] && sv.mail[0].body || '').slice(-300));
  // Gmail's daily limit used up: the alerts wait (not cleared), the copy goes on, the check-in says why
  sv.mail.length = 0; sv.mailCtl.quota = 0;
  await put('invAlerts/q1', { t: 'cart', at: Date.now(), by: 'Gwen R.', lines: [{ n: 'Masks', q: 1 }], up: new Date(), upBy: 'gwen' });
  await put('invItems/ppe-1', { id: 'ppe-1', name: 'Gloves SM', qty: 8, up: new Date(), upBy: 'gwen' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  const beat2 = (await list('invBeat'))[0].fields;
  ok('out of email: nothing sent, the alert waits, the copy still goes', r.sent === 0 && r.waiting === 1 && (await list('invAlerts')).length === 1 && (await rt('GET', '/nlo/items/ppe-1')).qty === 8, r);
  ok('out of email: the check-in says why (Settings shows it)', /daily email limit/.test(beat2.err.stringValue) && !sv.props.FAILS, beat2.err);
  sv.mailCtl.quota = 100;
  r = sv.run('checkInventoryAlerts()');
  ok('out of email: the next check sends it', r.sent === 1 && sv.mail.length === 1 && (await list('invAlerts')).length === 0, r);
  // an email that fails: the copy still goes; nothing is sent twice when it works again
  sv.mail.length = 0; sv.mailCtl.fail = true;
  await put('invAlerts/f1', { t: 'cart', at: Date.now(), by: 'Gwen R.', lines: [{ n: 'Cups', q: 1 }], up: new Date(), upBy: 'gwen' });
  await put('invItems/ppe-1', { id: 'ppe-1', name: 'Gloves SM', qty: 7, up: new Date(), upBy: 'gwen' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('mail fails: the copy still goes (Staff Meeting and AISA don’t stall)', (await rt('GET', '/nlo/items/ppe-1')).qty === 7 && Number(sv.props.FAILS) === 1 && (await list('invAlerts')).length === 1, { r, fails: sv.props.FAILS });
  sv.mailCtl.fail = false;
  r = sv.run('checkInventoryAlerts()');
  ok('mail fails: the next check sends it, once', r.sent === 1 && sv.mail.length === 1 && (await list('invAlerts')).length === 0 && !sv.props.FAILS, r);

  /* ---------- the phone push (version 3) ---------- */
  sv.mail.length = 0;
  const cartAlert = (id, upBy, by, extra) => put('invAlerts/' + id, Object.assign({ t: 'cart', at: Date.now(), by, lines: [{ n: 'Gloves SM', q: 2, u: 'case', p: 91.3, v: 'SunSurgical' }], inCart: 2, up: new Date(), upBy }, extra || {}));
  const toNtfyMail = m => m.to === 'ntfy-nlo-inv-test1@ntfy.test', sNow = () => Date.now() + clock.off;   // (the script's clock)
  const beatErr = async () => (await list('invBeat'))[0].fields.err.stringValue;
  await put('invState/push', { topic: 'nlo-inv-test1', up: new Date(), upBy: 'amir' });
  await put('invState/settings', { alertsOn: true, pushOn: true, locations: [], up: new Date(), upBy: 'amir' });
  await cartAlert('n1', 'gwen', 'Gwen R.');
  await cartAlert('n2', 'amir', 'Dr. A');
  await put('invAlerts/n3', { t: 'ordered', at: Date.now(), by: 'Gwen R.', vendor: 'SunSurgical', lines: [{ n: 'Masks', q: 1, p: 9 }], total: 9, id: 'o-9', up: new Date(), upBy: 'gwen' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  let ps = pushes();
  ok('push: Gwen’s cart add goes to Dr. A’s phone (who, what, that it needs his OK; tapping it opens the cart)', ps.length === 1 && ps[0].topic === 'nlo-inv-test1' && ps[0].title === 'Gwen R. added to the cart' && /Gloves SM — 2 case \(SunSurgical\)/.test(ps[0].message) && /Needs your OK/.test(ps[0].message) && /nlo-inventory\.html#cart$/.test(ps[0].click) && ps[0].tags[0] === 'shopping_cart', ps);
  ok('push: …not emailed as well; the order is (the email alerts are on)', sv.mail.length === 1 && /^Open order: SunSurgical/.test(sv.mail[0].subject) && !/Gloves/.test(sv.mail[0].body), sv.mail.map(m => m.subject));
  ok('push: Dr. A’s own cart add isn’t sent at all, and every one of them is cleared', !ps.some(x => /Dr\. A/.test(x.title)) && (await list('invAlerts')).length === 0 && r.sent === 2, r);
  // more than 4 at once: one push for all of them, each with its item
  for (let i = 0; i < 5; i++) await cartAlert('n5' + i, 'gwen', 'Gwen R.', { lines: [{ n: 'Item ' + i, q: 1 }] });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ps = pushes();
  ok('push: five cart adds at once come as one push, each line with its item', ps.length === 2 && ps[1].title === '5 cart adds need your OK' && /Gwen R\.: Item 0 — 1/.test(ps[1].message) && /Gwen R\.: Item 4 — 1/.test(ps[1].message) && r.sent === 5, ps[1]);
  // a line changed after Dr. A's OK (another vendor, a higher price, more of it)
  await cartAlert('nc', 'kim', 'Kim T.', { note: 'changed' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ps = pushes();
  ok('push: a line changed after his OK says so', ps.length === 3 && ps[2].title === 'Kim T. changed a line in the cart' && /Needs your OK again/.test(ps[2].message), ps[2]);
  // the email alerts off, the push on: cart adds still pushed; the rest cleared unsent
  sv.mail.length = 0;
  await put('invState/settings', { alertsOn: false, pushOn: true, locations: [], up: new Date(), upBy: 'amir' });
  await cartAlert('n6', 'kim', 'Kim T.');
  await put('invAlerts/n7', { t: 'received', at: Date.now(), by: 'Kim T.', vendor: 'SunSurgical', lines: [], up: new Date(), upBy: 'kim' });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('push on, emails off: the cart add is pushed, the delivery cleared without an email', pushes().length === 4 && sv.mail.length === 0 && (await list('invAlerts')).length === 0, { r, mail: sv.mail.length });
  // both off: cleared, nothing sent
  await put('invState/settings', { alertsOn: false, pushOn: false, locations: [], up: new Date(), upBy: 'amir' });
  await cartAlert('n6b', 'kim', 'Kim T.'); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('push and emails both off: cleared, nothing sent', pushes().length === 4 && sv.mail.length === 0 && (await list('invAlerts')).length === 0, r);
  // the push off, the emails on: cart adds are emailed again (a changed line too, saying so)
  await put('invState/settings', { alertsOn: true, pushOn: false, locations: [], up: new Date(), upBy: 'amir' });
  await cartAlert('n8', 'gwen', 'Gwen R.');
  await cartAlert('n8c', 'gwen', 'Gwen R.', { note: 'changed', lines: [{ n: 'Cups', q: 3 }] });
  await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('push off: cart adds are emailed again', pushes().length === 4 && sv.mail.length === 1 && /Gwen R\. added Gloves SM ×2 to the cart/.test(sv.mail[0].body) && /Gwen R\. changed Cups ×3 in the cart \(it needs your OK again\)/.test(sv.mail[0].body), sv.mail.map(m => m.body));
  // the push on, but no topic: emailed (nothing to push to)
  sv.mail.length = 0;
  await put('invState/push', { topic: '', up: new Date(), upBy: 'amir' });
  await put('invState/settings', { alertsOn: true, pushOn: true, locations: [], up: new Date(), upBy: 'amir' });
  await cartAlert('n8e', 'gwen', 'Gwen R.'); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('push on with no topic: the cart add is emailed', pushes().length === 4 && sv.mail.length === 1 && /^Added to cart/.test(sv.mail[0].subject), sv.mail.map(m => m.subject));
  await put('invState/push', { topic: 'nlo-inv-test1', up: new Date(), upBy: 'amir' });
  // the test push Dr. A asks for: once; one that didn't go is tried again
  fs.writeFileSync(NTFY_FAIL, '500');
  const asked = Date.now();
  await put('invState/push', { topic: 'nlo-inv-test1', test: asked, up: new Date(), upBy: 'amir' }); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('test push: ntfy answers 500 — not sent, the check-in says why', pushes().length === 4 && r.waiting === 1 && /test push didn’t go/.test(await beatErr()), { r, err: await beatErr() });
  fs.unlinkSync(NTFY_FAIL);
  r = sv.run('checkInventoryAlerts()');
  ok('test push: tried again next minute — sent', pushes().length === 5 && pushes()[4].title === 'NLO Inventory: test push', pushes()[4]);
  await bump(); r = sv.run('checkInventoryAlerts()');
  ok('test push: once', pushes().length === 5);
  // ntfy can't be reached from Google's servers: through ntfy's email address, and the direct way rests 3 hours
  sv.mail.length = 0;
  const cfgNow = JSON.parse(sv.props.INV_CFG);
  sv.props.INV_CFG = JSON.stringify(Object.assign({}, cfgNow, { ntfyBase: 'http://127.0.0.1:8792' }));   // (nothing there)
  await cartAlert('n9', 'gwen', 'Gwen R.');
  await bump();
  r = sv.run('checkInventoryAlerts()');
  const restA = Number(sv.props.INV_NTFY_REST || 0);
  ok('ntfy unreachable: the push goes by email to ntfy’s address for the topic (its subject the title)', r.sent === 1 && sv.mail.length === 1 && toNtfyMail(sv.mail[0]) && sv.mail[0].subject === 'Gwen R. added to the cart' && /Needs your OK/.test(sv.mail[0].body) && (await list('invAlerts')).length === 0, { r, mail: sv.mail.map(m => [m.to, m.subject]) });
  ok('ntfy unreachable: the direct way rests about 3 hours, with no problem reported', restA > sNow() + 2.5 * 3600000 && !sv.props.FAILS && !(await beatErr()), { restA, err: await beatErr() });
  sv.props.INV_CFG = JSON.stringify(cfgNow);
  // while it rests: no direct try; the email way at most every 10 minutes (the waiting ones together)
  const urls0 = urls.length;
  await cartAlert('n10', 'gwen', 'Gwen R.'); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('while it rests, within 10 minutes of the last such email: the push waits (no problem), no direct try', r.sent === 0 && r.waiting === 1 && sv.mail.length === 1 && !(await beatErr()) && !urls.slice(urls0).some(u => u.includes(':' + NTFY_PORT)), { r, err: await beatErr() });
  await cartAlert('n10b', 'kim', 'Kim T.'); await bump();
  clock.off += 11 * 60000;
  r = sv.run('checkInventoryAlerts()');
  ok('…11 minutes on: both go in one email to ntfy’s address', r.sent === 2 && sv.mail.length === 2 && toNtfyMail(sv.mail[1]) && sv.mail[1].subject === '2 cart adds need your OK' && /Gwen R\.: Gloves SM/.test(sv.mail[1].body) && /Kim T\.: Gloves SM/.test(sv.mail[1].body) && !urls.slice(urls0).some(u => u.includes(':' + NTFY_PORT)), { r, mail: sv.mail.map(m => [m.to, m.subject, m.body]) });
  // Gmail's emails nearly used up: the push waits, keeping them for the alerts themselves
  clock.off += 11 * 60000; sv.mailCtl.quota = 5;
  await cartAlert('n10c', 'gwen', 'Gwen R.'); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('fewer than 11 emails left today: the push waits, and says why', r.sent === 0 && r.waiting === 1 && sv.mail.length === 2 && /nearly used up/.test(await beatErr()), { r, err: await beatErr() });
  sv.mailCtl.quota = 100;
  r = sv.run('checkInventoryAlerts()');
  ok('…with room again it goes', r.sent === 1 && sv.mail.length === 3 && toNtfyMail(sv.mail[2]), r);
  // back to the direct way once the rest is over; "too many" (429) works like no answer
  clock.off += 11 * 60000;
  sv.props.INV_NTFY_REST = String(sNow() - 1000);
  fs.writeFileSync(NTFY_FAIL, '429');
  await cartAlert('n11', 'gwen', 'Gwen R.'); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('ntfy answers 429 (too many): through ntfy’s email address too, and the direct way rests', r.sent === 1 && sv.mail.length === 4 && toNtfyMail(sv.mail[3]) && Number(sv.props.INV_NTFY_REST) > sNow() + 2 * 3600000, { r, rest: sv.props.INV_NTFY_REST });
  // ntfy itself answers 500: that's no Google problem — no email to its address; the alert waits and the problem shows
  clock.off += 11 * 60000;
  sv.props.INV_NTFY_REST = String(sNow() - 1000);
  fs.writeFileSync(NTFY_FAIL, '500');
  await cartAlert('n12', 'gwen', 'Gwen R.'); await bump();
  r = sv.run('checkInventoryAlerts()');
  ok('ntfy answers 500: no email to its address, the alert waits, the problem shows in Settings', r.sent === 0 && r.waiting === 1 && sv.mail.length === 4 && (await list('invAlerts')).length === 1 && /Phone push: ntfy answered 500/.test(await beatErr()) && !(Number(sv.props.INV_NTFY_REST) > sNow()), { r, err: await beatErr() });
  fs.unlinkSync(NTFY_FAIL);
  r = sv.run('checkInventoryAlerts()');
  ok('…the next check pushes it, once', r.sent === 1 && pushes().filter(x => x.title === 'Gwen R. added to the cart').length === 2 && (await list('invAlerts')).length === 0, r);
  clock.off = tenAm;
  // ntfy's email address: ntfy.sh's own, none for another ntfy server
  const cf = c => { const x = load(Object.assign({}, CFG, { ntfyBase: undefined, ntfyMail: undefined }, c), 'dr.test@example.com', clock); return JSON.parse(x.run('JSON.stringify(cfg_(PropertiesService.getScriptProperties()))')); };
  ok('ntfy’s email address: ntfy.sh’s (ntfy-<topic>@ntfy.sh), none for another server', cf({}).ntfyMail === 'ntfy-{topic}@ntfy.sh' && cf({ ntfyBase: 'https://ntfy.sh/' }).ntfyMail === 'ntfy-{topic}@ntfy.sh' && cf({ ntfyBase: 'https://push.example.com' }).ntfyMail === '', [cf({}).ntfyMail, cf({ ntfyBase: 'https://push.example.com' }).ntfyMail]);
  await put('invState/settings', { alertsOn: true, pushOn: false, locations: [], up: new Date(), upBy: 'amir' });

  /* ---------- an old Inventory page still open somewhere ---------- */
  sv.mail.length = 0;
  await rt('POST', '/nlo/settings/alertQueue', { t: 'cart', at: Date.now(), by: 'Kim T.', lines: [{ n: 'Cotton rolls', q: 1 }] });
  r = sv.run('checkInventoryAlerts()');
  ok('old page: Dr. A is told to reload that computer', r.old === 1 && sv.mail.length === 1 && /old Inventory page is still open/.test(sv.mail[0].subject) && /Kim T\. added Cotton rolls ×1 to the cart/.test(sv.mail[0].body), { r, mail: sv.mail });
  ok('old page: its queue cleared', (await rt('GET', '/nlo/settings/alertQueue')) === null);
  await rt('POST', '/nlo/settings/alertQueue', { t: 'cart', at: Date.now(), by: 'Kim T.', lines: [{ n: 'Masks', q: 1 }] });
  r = sv.run('checkInventoryAlerts()');
  ok('old page: no second email within the hour (queue still cleared)', r.old === 1 && sv.mail.length === 1 && (await rt('GET', '/nlo/settings/alertQueue')) === null, r);

  /* ---------- nights: every 10 minutes ---------- */
  clock.off = tenAm + 13 * 3600000;   // 11 PM
  r = sv.run('checkInventoryAlerts()');
  ok('night: a check runs', !r.quiet, r);
  clock.off += 4 * 60000;
  r = sv.run('checkInventoryAlerts()');
  ok('night: 4 minutes later it rests', r.quiet === true, r);
  clock.off += 7 * 60000;
  r = sv.run('checkInventoryAlerts()');
  ok('night: 11 minutes later it checks again', !r.quiet, r);

  /* ---------- the whole copy once a night (after 3 AM) ---------- */
  clock.off = tenAm + 18 * 3600000;   // 4 AM tomorrow
  await rt('PUT', '/nlo/items/ppe-1/qty', 999);   // (drift in the old database)
  r = sv.run('checkInventoryAlerts()');
  ok('nightly: everything copied again (drift put right)', r.copied >= 6 && (await rt('GET', '/nlo/items/ppe-1/qty')) === 7, r);
  clock.off += 11 * 60000;   // (still night: every 10 minutes)
  r = sv.run('checkInventoryAlerts()');
  ok('nightly: once (the next check copies nothing)', !r.quiet && r.copied === 0, r);

  /* ---------- deals (version 4): the promo emails, matched to the office's supplies ---------- */
  // the script's clock at a wall time, office time, some days from today (right across a daylight-saving change too)
  const nyParts = t => { const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).forEach(x => { o[x.type] = x.value; }); return o; };
  const wallAt = (days, hh, mm) => { const off = tenAm + days * 864e5, p = nyParts(Date.now() + off); return off + ((hh * 60 + (mm || 0)) - (Number(p.hour) * 60 + Number(p.minute))) * 60000; };
  let thu = 1; while (nyParts(Date.now() + wallAt(thu, 10)).weekday !== 'Thu') thu++;   // the first Thursday after today
  const sTime = () => Date.now() + clock.off;
  await put('invState/push', { topic: 'nlo-inv-test1', up: new Date(), upBy: 'amir' });
  await put('invState/settings', { alertsOn: true, pushOn: true, locations: [], up: new Date(), upBy: 'amir' });
  await put('invItems/ppe-1', { id: 'ppe-1', name: 'Gloves SM', qty: 7, sources: [{ vendor: 'SunSurgical', sku: '177102', price: 9.13 }], up: new Date(), upBy: 'gwen' });
  await put('invItems/el-1', { id: 'el-1', name: 'O-ties clear', qty: 3, sources: [{ vendor: 'Ortho Shop', sku: 'OT-1', src: 'https://shop.orthoshop.example/o-ties' }], up: new Date(), upBy: 'gwen' });
  await put('invItems/gone-9', { id: 'gone-9', name: 'Archived thing', archived: true, up: new Date(), upBy: 'gwen' });
  await put('invVendors/v-os', { id: 'v-os', name: 'Ortho Shop', email: 'sales@orthoshop.example', up: new Date(), upBy: 'amir' });
  delete sv.cache['deal_catalog'];
  clock.off = wallAt(thu, 10);
  const t0 = sTime() - 2 * 3600000, mailTo = (id, from, subject, body, mins) => sv.gmail.push({ id, from, subject, body, date: t0 + (mins || 0) * 60000 });
  mailTo('g1', 'SunSurgical <deals@sunsurgical.com>', '20% off Pulse Nitrile gloves this week', 'Use PULSE20 at checkout. 20% off every box through Oct 31.', 1);
  mailTo('g2', 'SunSurgical <orders@sunsurgical.com>', 'Order #4815 confirmed', 'Thank you for your order. 20% off your next one!', 2);
  mailTo('g3', 'uLab <noreply@ulabsystems.com>', 'Your uAssist Case is ready', 'Patient Name: Jane Doe. Your plan is ready.', 3);
  mailTo('g3b', 'uLab <dave@ulabsystems.com>', 'Big savings this month', 'Free retainer trial for every new start. Patient Name: Jane Doe', 4);
  mailTo('g4', 'Mari’s List <mari@marislist.com>', 'October member specials', 'MARIS NEWSLETTER: members save 15% on scanners.', 5);
  mailTo('g4b', 'Mari’s List <portal@marislist.com>', 'X3363e is your Mari’s List login code', 'Copy and paste your temporary login code.', 6);
  mailTo('g5', 'Shoe Store <sale@shoes.example>', '50% off shoes', 'Huge sale, 50% off.', 7);
  mailTo('g6', 'Ortho Shop <sales@orthoshop.example>', 'Re: your quote', 'Here is 10% off as discussed.', 8);
  mailTo('g7', 'Ortho Shop <news@orthoshop.example>', 'Our new catalog is here', 'Browse the new catalog online.', 9);
  mailTo('g8', 'Ortho Shop <promo@orthoshop.example>', 'Buy 10 get 2 free o-ties', 'BADID this week only.', 10);
  mailTo('g9', 'Ortho Shop <promo@orthoshop.example>', 'Flash sale on o-ties', 'FLAKY flash sale today.', 11);
  fs.writeFileSync(AI_FAIL, '1');
  sv.props.DEALS_AT = String(sTime() - 61 * 60000);
  const ps0 = pushes().length;
  r = sv.run('checkInventoryAlerts()');
  const asked1 = aiCalls().map(c => c.subj);
  ok('deals: the offers from vendors and Mari’s List went to the AI', ['20% off Pulse Nitrile gloves this week', 'October member specials', 'Buy 10 get 2 free o-ties', 'Flash sale on o-ties'].every(x => asked1.includes(x)), asked1);
  ok('deals: never to the AI — an order, a case, anything naming a patient, a login code, another store, a reply, a catalog with no offer', !['Order #4815 confirmed', 'Your uAssist Case is ready', 'Big savings this month', 'X3363e is your Mari’s List login code', '50% off shoes', 'Re: your quote', 'Our new catalog is here'].some(x => asked1.includes(x)) && !aiCalls().some(c => /Jane Doe/.test(c.text)), asked1);
  const p1 = aiCalls()[0] || {};
  ok('deals: the AI gets the office’s supplies (not the archived ones) and the email', /ppe-1 \| Gloves SM \| SunSurgical \| #177102/.test(p1.text) && /el-1 \| O-ties clear \| Ortho Shop \| #OT-1/.test(p1.text) && !/gone-9/.test(p1.text) && /PULSE20/.test(p1.text) && /^\/v1beta\/models\/gemini-2\.5-flash:generateContent\?key=AIzaNEW$/.test(p1.url) && p1.gen && p1.gen.responseMimeType === 'application/json', { url: p1.url, gen: p1.gen });
  ok('deals: the Gmail search asks for the vendors (Inventory’s too) and Mari’s List, and nothing sent', /after:\d+/.test(sv.gmailQ.slice(-1)[0]) && /from:orthoshop\.example/.test(sv.gmailQ.slice(-1)[0]) && /from:sunsurgical\.com/.test(sv.gmailQ.slice(-1)[0]) && /"Mari's List"/.test(sv.gmailQ.slice(-1)[0]) && /-in:sent/.test(sv.gmailQ.slice(-1)[0]), sv.gmailQ.slice(-1)[0]);
  let dl = await list('invDeals');
  const d1 = dl.find(d => d.name.endsWith('/g1')), d8 = dl.find(d => d.name.endsWith('/g8'));
  ok('deals: two saved in Inventory — the gloves and the o-ties — under the email’s id', r.deals === 2 && dl.length === 2 && d1 && d8, { r, n: dl.length });
  ok('deals: what, until when, how, which supply, and a link to the email', d1 && d1.fields.title.stringValue === '20% off Pulse Nitrile gloves' && d1.fields.ends.stringValue === '2099-10-31' && d1.fields.how.stringValue === 'Use code PULSE20 online' && d1.fields.items.arrayValue.values[0].mapValue.fields.id.stringValue === 'ppe-1' && /authuser=dr\.test%40example\.com#all\/g1$/.test(d1.fields.mail.stringValue) && d1.fields.src.stringValue === 'email' && d1.fields.at.timestampValue, d1 && d1.fields);
  ok('deals: only supplies from the office’s list, each once; no end date unless it’s a date; the sender for a missing vendor', d8 && d8.fields.items.arrayValue.values.length === 1 && d8.fields.items.arrayValue.values[0].mapValue.fields.id.stringValue === 'el-1' && d8.fields.ends.stringValue === '' && d8.fields.vendor.stringValue === 'Ortho Shop', d8 && d8.fields);
  ps = pushes().slice(ps0);
  ok('deals: a push for each (tapping it opens the email)', ps.length === 2 && ps[0].title === 'Deal: SunSurgical' && /20% off Pulse Nitrile gloves \(ends 10\/31\)/.test(ps[0].message) && /For: Gloves SM/.test(ps[0].message) && /#all\/g1$/.test(ps[0].click) && ps[0].tags[0] === 'moneybag', ps);
  ok('deals: the Mari’s List offer on nothing the office buys: no push, no record (it waits for Friday’s roundup)', !dl.some(d => d.name.endsWith('/g4')) && JSON.parse(sv.props.DEALS_WEEK).map(e => e.id).join() === 'g1,g4,g8', sv.props.DEALS_WEEK);
  ok('deals: the AI failing on one: noted, that email waits for the next look', /AI couldn’t read an offer/.test(await beatErr()) && JSON.parse(sv.props.DEALS_TRIES).g9 === 1 && !JSON.parse(sv.props.DEALS_SEEN).includes('g9'), { err: await beatErr(), tries: sv.props.DEALS_TRIES });
  // a minute later: no new look (once an hour)
  const n1 = aiCalls().length; clock.off += 60000;
  r = sv.run('checkInventoryAlerts()');
  ok('deals: a minute later, no new look', aiCalls().length === n1 && r.deals === 0, r);
  // an hour later, the AI working again: the waiting one is read; the others aren't read twice
  fs.unlinkSync(AI_FAIL); clock.off += 61 * 60000;
  r = sv.run('checkInventoryAlerts()');
  const asked2 = aiCalls().slice(n1).map(c => c.subj);
  ok('deals: an hour later the one that waited is read (and only it)', asked2.join() === 'Flash sale on o-ties' && r.deals === 1 && (await list('invDeals')).length === 3, { asked2, r });
  ok('deals: …and pushed', pushes().slice(ps0).length === 3);
  // an email the AI can't read three times running is left
  fs.writeFileSync(AI_FAIL, '1');
  mailTo('g10', 'Ortho Shop <promo@orthoshop.example>', 'Another FLAKY sale', 'FLAKY again', 200);
  for (let i = 0; i < 3; i++) { clock.off += 61 * 60000; sv.run('checkInventoryAlerts()'); }
  const triesNow = JSON.parse(sv.props.DEALS_TRIES);
  ok('deals: an email the AI couldn’t read three times is left', JSON.parse(sv.props.DEALS_SEEN).includes('g10') && !('g10' in triesNow), { seen: sv.props.DEALS_SEEN, tries: sv.props.DEALS_TRIES });
  fs.unlinkSync(AI_FAIL);
  const n3 = aiCalls().length; clock.off += 61 * 60000; sv.run('checkInventoryAlerts()');
  ok('…and not read again', aiCalls().length === n3);
  // nights: no look
  mailTo('g11', 'SunSurgical <deals@sunsurgical.com>', 'Night sale', 'PULSE20 overnight', 400);
  const n4 = aiCalls().length; clock.off = wallAt(thu, 22);
  r = sv.run('checkInventoryAlerts()');
  ok('deals: no look at night', aiCalls().length === n4, r);
  // ended deals come off (once a day); the rest stay
  await put('invDeals/old1', { at: new Date(sTime() - 3 * 864e5), vendor: 'X', title: 'Ended', ends: '2020-01-01', how: '', items: [{ id: 'ppe-1', what: 'x', price: '' }], subject: '', from: '', mail: '', src: 'email' });
  await put('invDeals/old2', { at: new Date(sTime() - 30 * 864e5), vendor: 'X', title: 'No end, a month old', ends: '', how: '', items: [{ id: 'ppe-1', what: 'x', price: '' }], subject: '', from: '', mail: '', src: 'email' });
  sv.props.DEALS_TIDY = '2020-01-01';
  clock.off = wallAt(thu + 1, 6, 30);   // Friday 6:30 AM: a look (by day), before the roundup's hour
  sv.props.DEALS_AT = String(sTime() - 61 * 60000);
  sv.mail.length = 0;
  r = sv.run('checkInventoryAlerts()');
  dl = await list('invDeals');
  ok('deals: ended ones taken off (and one with no end date after 3 weeks); the others stay', !dl.some(d => /\/old[12]$/.test(d.name)) && dl.some(d => d.name.endsWith('/g1')) && dl.some(d => d.name.endsWith('/g11')), dl.map(d => d.name.split('/').pop()));
  ok('deals: no roundup before 7 AM Friday', !sv.mail.some(m => /This week’s deals/.test(m.subject)), sv.mail.map(m => m.subject));
  // Friday's roundup: the week's offers, the ones on the office's supplies first; once
  clock.off = wallAt(thu + 1, 9);
  r = sv.run('checkInventoryAlerts()');
  const ru = sv.mail.find(m => /This week’s deals/.test(m.subject));
  ok('roundup: Friday morning, one email with the week’s offers', ru && ru.subject === 'This week’s deals: 4 on things you buy, 1 more' && /On things you buy/.test(ru.htmlBody) && /Other offers this week/.test(ru.htmlBody) && /15% off intraoral scanners/.test(ru.body) && /For: Gloves SM/.test(ru.htmlBody) && /#all\/g4/.test(ru.htmlBody), ru && [ru.subject, ru.body]);
  ok('roundup: the list starts over', sv.props.DEALS_WEEK === '[]');
  clock.off += 3 * 3600000; sv.mail.length = 0;
  r = sv.run('checkInventoryAlerts()');
  ok('roundup: once', !sv.mail.some(m => /This week’s deals/.test(m.subject)));
  // no Gemini key: no look, and Settings says why; the alerts go on
  await put('invState/ai', { gemini: '', up: new Date(), upBy: 'amir' }); await bump();
  const n5 = aiCalls().length; clock.off += 61 * 60000;
  r = sv.run('checkInventoryAlerts()');
  ok('deals: no Gemini key — nothing read, the check-in says why, the rest of the check fine', aiCalls().length === n5 && /no Gemini key yet/.test(await beatErr()) && !sv.props.FAILS, { err: await beatErr(), r });
  await put('invState/ai', { gemini: 'AIzaNEW', up: new Date(), upBy: 'amir' }); await bump();
  await put('invState/settings', { alertsOn: true, pushOn: false, locations: [], up: new Date(), upBy: 'amir' });
  clock.off = tenAm;

  /* ---------- a login that was replaced ---------- */
  clock.off = tenAm;
  await del('invBots/' + bot);
  sv.cache['inv_login'] && delete sv.cache['inv_login'];
  sv.mail.length = 0;
  r = sv.run('checkInventoryAlerts()');
  ok('replaced login: the check fails quietly the first time', Number(sv.props.FAILS) === 1 && sv.mail.length === 0, sv.props.FAILS);
  let err = '';
  try { sv.run('setup()'); } catch (e) { err = e.message; }
  ok('replaced login: setup says to copy the script again', /copy the script again/i.test(err), err);
  for (let i = 0; i < 15; i++) sv.run('checkInventoryAlerts()');
  ok('replaced login: one warning email after 15 failed checks', sv.mail.length === 1 && /not working/.test(sv.mail[0].subject), sv.mail.map(m => m.subject));
  sv.run('checkInventoryAlerts()');
  ok('replaced login: only one warning a day', sv.mail.length === 1);

  /* ---------- test alert, stop ---------- */
  sv.mail.length = 0; sv.run('sendTestAlert()');
  ok('test alert: marked TEST', sv.mail.length === 1 && /^TEST — Added to cart/.test(sv.mail[0].subject), sv.mail[0] && sv.mail[0].subject);
  sv.run('stopAlerts()');
  ok('stop: the every-minute check is off', sv.triggers.length === 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
