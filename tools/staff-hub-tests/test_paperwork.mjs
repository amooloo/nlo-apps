// End-to-end checks of Staff Hub's Paperwork (signed forms and documents, encrypted in the browser) on the Firebase
// emulators — a made-up office, nothing live. Same setup as test_login.mjs (README.md); run after starting the emulators
// and serving the page:   NO_PROXY=localhost,127.0.0.1 node test_paperwork.mjs
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import * as E from './seed.mjs';
const { chromium } = await import('playwright');

const BASE = process.env.SH_BASE || 'http://127.0.0.1:8765/';
const PAGE = BASE + 'nlo-staff-hub.html', OLD = BASE + 'nlo-staff-hub-old.html';
const SDK = process.env.FIREBASE_SDK_DIR || new URL('./node_modules/firebase/', import.meta.url).pathname;
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const fails = [];
function ok(cond, what) { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; fails.push(what); console.log('  FAIL ' + what); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = b => createHash('sha256').update(b).digest('hex');

const WIRE = `(() => {
  let fb;
  Object.defineProperty(window, 'firebase', { configurable: true, get() { return fb; }, set(v) {
    fb = v;
    if (v && v.initializeApp && !v.__emu) {
      const orig = v.initializeApp.bind(v);
      v.initializeApp = function (cfg, name) {
        const app = orig(cfg, name);
        try { app.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); } catch (e) { console.warn('emu auth', e); }
        if (cfg && cfg.databaseURL) { try { app.database().useEmulator('127.0.0.1', 9000); } catch (e) { console.warn('emu db', e); } }
        else { try { app.firestore().useEmulator('127.0.0.1', 8080); } catch (e) { console.warn('emu fs', e); } }
        return app;
      };
      v.__emu = true;
    }
  } });
})();`;
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];
function watch(page, tag) {
  page.on('pageerror', e => { errors.push(tag + ': ' + String(e && e.stack || e)); console.log('  PAGEERROR', tag, String(e).slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|ERR_BLOCKED|identitytoolkit|valid digest in the 'integrity'/.test(m.text())) { errors.push(tag + ': ' + m.text()); console.log('  console.error', tag, m.text().slice(0, 300)); } });
}
async function device(opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }, opts));
  await ctx.addInitScript(WIRE);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return route.continue();
    const m = /gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    return route.abort();
  });
  const page = await ctx.newPage(); watch(page, 'page');
  return { ctx, page };
}
const isApp = () => typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex';
async function outcome(p, ms = 45000) {
  await p.waitForFunction(() => (typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex') ||
    (typeof NC !== 'undefined' && !NC.busy && !!document.querySelector('#authCard form') && !document.querySelector('#ncGo[disabled]')), null, { timeout: ms });
  return p.evaluate(() => (typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex') ? 'app' : NC.mode);
}
async function signIn(p, user, pw) {
  await p.waitForSelector('#ncLoginForm', { timeout: 20000 });
  await p.fill('#ncUser', user); await p.fill('#ncPw', pw);
  await p.click('#ncGo');
  return outcome(p);
}
async function synced(p, ms = 25000) { try { await p.waitForFunction(() => typeof syncState !== 'undefined' && syncState === 'synced' && !fbWriteInFlight && !shDirty(), null, { timeout: ms }); return true; } catch { return false; } }
async function hubRecord(uid, pw) {
  const d = await E.fsGet('nlo-staff-hub', 'staffhub/' + uid);
  if (!d) return null;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(d.kdf.salt, 'base64'), iterations: d.kdf.iter || 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let st = null;
  try { st = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(d.data.iv, 'base64') }, key, Buffer.from(d.data.ct, 'base64')))); } catch { }
  return { raw: d, st };
}
/* the stored pieces, raw, as Firestore keeps them (admin view of the emulator) */
const FSD = (path) => `${E.FS}/v1/projects/nlo-staff-hub/databases/(default)/documents/${path}`;
async function pieces(hubUid) {
  const r = await (await fetch(FSD('staffhub/' + hubUid + '/paper') + '?pageSize=300', { headers: { Authorization: 'Bearer owner' } })).json();
  return (r.documents || []).map(d => ({ id: d.name.split('/').pop(), fields: d.fields || {} }));
}
async function putPiece(hubUid, id, fields) {
  const r = await fetch(FSD('staffhub/' + hubUid + '/paper/' + id), { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('putPiece ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
async function delPiece(hubUid, id) { await fetch(FSD('staffhub/' + hubUid + '/paper/' + id), { method: 'DELETE', headers: { Authorization: 'Bearer owner' } }); }
const toast = p => p.evaluate(() => document.getElementById('toasts').textContent);
async function waitToast(p, re, ms = 30000) { try { await p.waitForFunction(r => new RegExp(r).test(document.getElementById('toasts').textContent), re.source, { timeout: ms }); return true; } catch { return false; } }
const noScrollX = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/* ---------- made-up paperwork ---------- */
const MARK = 'SSN 123-45-6789 ACCT 000987654321';
function pdf(text, padBytes) {
  const content = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const head = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n` +
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n` +
    `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\n5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`);
  const parts = [head];
  if (padBytes) {   /* filler that repeats the marker, so every stored piece's original holds it */
    const chunks = []; let n = 0;
    while (n < padBytes) { const c = Buffer.concat([randomBytes(60000), Buffer.from(' ' + MARK + ' ')]); chunks.push(c); n += c.length; }
    const pad = Buffer.concat(chunks);
    parts.push(Buffer.from(`6 0 obj << /Length ${pad.length} >> stream\n`), pad, Buffer.from('\nendstream endobj\n'));
  }
  parts.push(Buffer.from('trailer << /Root 1 0 R >>\n%%EOF\n'));
  return Buffer.concat(parts);
}
const FILES = {
  big: { name: 'scan_2026_10_30.pdf', mimeType: 'application/pdf', buffer: pdf(MARK, 2_300_000) },
  w4: { name: 'Brandi W4.pdf', mimeType: 'application/pdf', buffer: pdf('W-4 ' + MARK, 0) },
  packet: { name: 'Brandi packet signed.pdf', mimeType: 'application/pdf', buffer: pdf('Packet ' + MARK, 40_000) }
};

fs.mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
process.chdir(new URL('./', import.meta.url).pathname);

// ---------- 0. the made-up office, Staff Hub data made by the page as it was before the NLO Cases login ----------
console.log('0. seeding');
await E.loadRules();
const ownerUid = await E.seedOffice();
const HUB = { email: 'dr.hub@example.com', pw: 'Staff-Hub-Pass-1' };
const PW = E.PW;
let hubUid;
const dev = await device();
{
  const page = dev.page;
  await page.goto(OLD);
  await page.waitForSelector('#authToggle', { timeout: 20000 });
  await sleep(1500);
  await page.click('#authToggle');
  await page.waitForSelector('#authPw2', { timeout: 20000 });
  for (let i = 0; i < 3; i++) {
    await page.fill('#authEmail', HUB.email); await page.fill('#authPw', HUB.pw); await page.fill('#authPw2', HUB.pw); await page.check('#authAck');
    await sleep(300);
    if ((await page.inputValue('#authPw')) === HUB.pw && (await page.inputValue('#authPw2')) === HUB.pw) break;
  }
  await page.click('#authGo');
  await page.waitForFunction(isApp, null, { timeout: 90000 });
  hubUid = await page.evaluate(() => fbUser.uid);
  await page.evaluate(() => { importStaffList([{ name: 'Gwen Rodis', role: 'Orthodontic Assistant' }, { name: 'Sarah Betz', role: 'Office Coordinator' }]); });
  ok(await synced(page), 'seed: Staff Hub data made by the page as it was');
  await page.close();
}

// ---------- 1. sign in, link, and a new hire ----------
console.log('1. sign in and a new hire');
let page = await dev.ctx.newPage(); watch(page, 'new');
// the JPEG is drawn by the browser (no image library here), with the bank account in a comment segment
const jpg = await (async () => {
  await page.goto(BASE + 'nlo-home.js');
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const g = c.getContext('2d');
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#123'; g.font = '40px sans-serif'; g.fillText('DIRECT DEPOSIT — VOID', 60, 120);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgb(${i % 255},${(i * 7) % 255},${(i * 13) % 255})`; g.fillRect((i * 37) % 900, (i * 53) % 600, 3, 3); }
    return c.toDataURL('image/jpeg', 0.92).split(',')[1]; });
  const raw = Buffer.from(b64, 'base64'), com = Buffer.from('ACCT 000987654321 ROUTING 063100277');
  const seg = Buffer.concat([Buffer.from([0xFF, 0xFE, (com.length + 2) >> 8, (com.length + 2) & 255]), com]);
  return Buffer.concat([raw.subarray(0, 2), seg, raw.subarray(2)]);
})();
FILES.dep = { name: 'Brandi direct deposit.jpg', mimeType: 'image/jpeg', buffer: jpg };
await page.goto(PAGE);
ok(await signIn(page, E.OWNER.email, PW) === 'link', 'NLO Cases sign-in asks once for Staff Hub’s own password');
await page.fill('#ncHubEmail', HUB.email); await page.fill('#ncHubPw', HUB.pw); await page.click('#ncGo');
ok(await outcome(page) === 'app', 'Staff Hub opens');
const hireId = await page.evaluate(() => {
  const h = { id: uid(), status: 'active', created: Date.now(), staffId: null, inc: {}, done: {}, tasks: {}, notes: '', name: 'Brandi Testa', team: 'clinical', employment: 'Full-time', position: 'Orthodontic Assistant', start: '2026-11-02' };
  nhS().hires.push(h); act('Started onboarding for Brandi Testa'); persist();
  route.page = 'newhire'; route.nhHire = h.id; route.nhTab = 'hires'; render();
  return h.id;
});
ok(await synced(page), 'a new hire saved');
await page.waitForSelector('[data-ppzone][data-hid] .ph');
{
  const t = await page.textContent('#main');
  ok(/Signed paperwork/.test(t) && /Drop Brandi’s signed paperwork here/.test(t), 'new-hire page: a Signed paperwork panel with a drop area');
  const att = await page.$$eval('[data-act=ppAdd][data-k]', els => els.map(e => e.dataset.k));
  ok(att.includes('w4') && att.includes('i9') && att.includes('deposit') && att.includes('handbook') && !att.includes('aca'), 'each form row has Attach (W-4, I-9, Direct deposit, Policy manual …; not the notice that is only given)');
  await page.screenshot({ path: 'shots/pp-01-hire.png', fullPage: true });
}

// ---------- 2. the upload window: guesses, refusals, a packet scan ----------
console.log('2. upload window');
await page.click('[data-ppzone][data-hid] [data-act=ppAdd]:not([data-k])');
await page.waitForSelector('#ppPick', { state: 'attached' });
ok(/locked with your Staff Hub password/.test(await page.textContent('.modal')), 'window says each file is locked on this computer first');
await page.setInputFiles('#ppPick', [
  FILES.big, FILES.w4, FILES.dep, FILES.packet,
  { name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK fake') },
  { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') },
  { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) }
]);
{
  const kinds = await page.$$eval('#ppList select', els => els.map(e => e.value));
  ok(kinds.length === 4, 'four files listed; a Word file, an SVG and an empty file refused (' + kinds.length + ')');
  const t = await toast(page);
  ok(/notes\.docx: only PDFs and photos/.test(t) && /logo\.svg: only PDFs/.test(t) && /empty\.pdf is empty/.test(t), '…each refusal says why');
  ok(kinds[0] === 'other' && kinds[1] === 'w4' && kinds[2] === 'deposit' && kinds[3] === 'multi', 'guessed from the names: other, W-4, Direct deposit, a packet scan (' + kinds.join(',') + ')');
}
await page.selectOption('#ppList .ppUpRow:nth-child(1) select', 'i9');
await page.fill('#ppList .ppUpRow:nth-child(1) input[type=text]', 'with DL + SS card copies');
await page.click('#ppGo');
ok(await waitToast(page, /Tick which forms are in Brandi packet signed\.pdf/, 5000), 'a packet scan needs its forms ticked first');
await page.click('#ppList [data-act=ppMultiAll]');
{
  const ticked = await page.$$eval('#ppList .ppMulti input:checked', els => els.map(e => e.value));
  ok(['deposit', 'handbook', 'hipaa', 'hepb', 'info'].every(k => ticked.includes(k)) && !ticked.includes('w4') && !ticked.includes('offer'), '“Tick the whole packet” ticks her packet’s forms (' + ticked.length + ')');
  ok((await page.inputValue('#ppList .ppUpRow:nth-child(1) input[type=text]')) === 'with DL + SS card copies', 'a typed note survives the list redrawing');
}
await page.screenshot({ path: 'shots/pp-02-upload.png' });
await page.click('#ppGo');
ok(await waitToast(page, /4 files added to Brandi Testa’s paperwork, locked/, 60000), 'Lock & upload: “4 files added … locked with your password”');
ok(!(await page.$('#ppList')), 'window closed');
const meta = await page.evaluate(() => S.paper.map(f => ({ ...f })));
{
  const by = n => meta.find(f => f.name === n);
  ok(meta.length === 4, 'four files on the list');
  ok(by(FILES.big.name).kind === 'i9' && by(FILES.big.name).n === 3 && by(FILES.big.name).size === FILES.big.buffer.length, 'the 2.3 MB scan: I-9, stored in 3 pieces, size right');
  ok(by(FILES.big.name).note === 'with DL + SS card copies', '…with its note');
  ok(Object.values(FILES).every(F => by(F.name) && by(F.name).sha === sha(F.buffer)), 'each file’s SHA-256 matches the original');
  ok(by(FILES.packet.name).kind === 'multi' && by(FILES.packet.name).kinds.includes('handbook'), 'packet scan covers the ticked forms');
  ok(meta.every(f => f.hid === hireId && f.sid === '' && f.removed === 0 && /^pp[0-9a-f]{20}$/.test(f.id)), 'filed under her new-hire record, random ids');
  ok(by(FILES.dep.name).mime === 'image/jpeg' && by(FILES.w4.name).mime === 'application/pdf', 'types kept: JPEG, PDF');
}
ok(await synced(page), 'the list saved');

// ---------- 3. what the server holds ----------
console.log('3. on the server');
{
  const ps = await pieces(hubUid);
  ok(ps.length === 6, 'six pieces stored (3 + 1 + 1 + 1): ' + ps.length);
  ok(ps.every(p => Object.keys(p.fields).sort().join(',') === 'app,at,ct,i,iv,n,v'), 'each piece holds only app, v, i, n, iv, ct, at — no name, type or person');
  const big = meta.find(f => f.name === FILES.big.name);
  const bigPs = ps.filter(p => p.id.startsWith(big.id + '_')).sort((a, b) => a.id.localeCompare(b.id));
  ok(bigPs.length === 3 && bigPs.every((p, i) => Number(p.fields.i.integerValue) === i && Number(p.fields.n.integerValue) === 3), 'pieces numbered 0–2 of 3');
  const ct = bigPs.map(p => Buffer.from(p.fields.ct.bytesValue, 'base64'));
  ok(ct[0].length === 900 * 1024 + 16 && ct[2].length === FILES.big.buffer.length - 2 * 900 * 1024 + 16, 'each piece = 900 KB of the file + the 16-byte check (last one the rest)');
  const all = Buffer.concat(ps.map(p => Buffer.from(p.fields.ct.bytesValue || '', 'base64')));
  const depPs = ps.find(p => p.id.startsWith(meta.find(f => f.name === FILES.dep.name).id + '_'));
  ok(!all.includes(Buffer.from('123-45-6789')) && !all.includes(Buffer.from('000987654321')) && !all.includes(Buffer.from('%PDF-1.4')) &&
    !Buffer.from(depPs.fields.ct.bytesValue, 'base64').subarray(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF])),
    'no SSN, account number or PDF header anywhere in what’s stored; the photo’s piece doesn’t start like a JPEG');
  ok(new Set(ps.map(p => p.fields.iv.stringValue)).size === 6, 'every piece has its own IV');
  const rec = await hubRecord(hubUid, HUB.pw);
  ok(rec && rec.st && Array.isArray(rec.st.paper) && rec.st.paper.length === 4, 'the list is in the encrypted record');
  const rawRec = JSON.stringify(rec.raw);   /* (only long strings: a short one like "W4" turns up in base64 by chance) */
  ok(['Brandi', 'scan_2026_10_30', 'direct deposit', 'Testa'].every(x => !rawRec.includes(x)), '…which, as stored, shows no names');
  const h = rec.st.nh.hires.find(x => x.id === hireId);
  ok(['i9', 'w4', 'deposit', 'handbook', 'hipaa', 'hepb'].every(k => h.done && h.done[k]), 'her tracker marked the uploaded forms returned (I-9, W-4, Direct deposit, packet forms)');
  // another signed-in person, and nobody signed in, can't read a piece
  const intr = await E.signUp('intruder@example.com', 'Intruder-Pass-1').then(() => E.signIn('intruder@example.com', 'Intruder-Pass-1'));
  const r1 = await fetch(FSD('staffhub/' + hubUid + '/paper/' + bigPs[0].id), { headers: { Authorization: 'Bearer ' + intr.idToken } });
  const r2 = await fetch(FSD('staffhub/' + hubUid + '/paper/' + bigPs[0].id));
  const r3 = await fetch(FSD('staffhub/' + hubUid + '/paper') + '?pageSize=5', { headers: { Authorization: 'Bearer ' + intr.idToken } });
  const r4 = await fetch(FSD('staffhub/' + hubUid + '/paper/' + bigPs[0].id), { method: 'PATCH', headers: { Authorization: 'Bearer ' + intr.idToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { v: { integerValue: '9' } } }) });
  ok(r1.status === 403 && r2.status === 403 && r3.status === 403 && r4.status === 403, 'rules: another account and no account can’t read, list or change a piece (' + [r1.status, r2.status, r3.status, r4.status] + ')');
}

// ---------- 4. the new-hire page now ----------
console.log('4. the new-hire page');
{
  const t = await page.textContent('#main');
  ok(/4 files/.test(t) && /Form I-9/.test(t) && /Signed packet \(one scan\)/.test(t) && /Covers 13 forms: .* and 10 more/.test(t), 'Signed paperwork lists the 4 files (I-9, the packet with what it covers …)');
  const secs = await page.$$eval('[data-ppzone][data-hid] .nhSubHd', els => els.map(e => e.textContent));
  ok(secs.some(s => /Payroll & tax/.test(s)) && secs.some(s => /I-9 & ID copies/.test(s) && /kept apart/.test(s)) && secs.some(s => /Medical|Hiring/.test(s)), 'grouped: Hiring & personnel / Payroll & tax / I-9 & ID copies (kept apart) …: ' + secs.join(' | '));
  const on = await page.$$eval('.ppOn', els => els.length), att = await page.$$eval('[data-act=ppAdd][data-k]', els => els.map(e => e.dataset.k));
  ok(on >= 6 && !att.includes('w4') && !att.includes('i9') && !att.includes('deposit') && att.includes('offer'), 'form rows: “Signed copy” where on file (' + on + '), Attach where not (offer letter)');
  const prog = await page.evaluate(id => nhProgress(nhHire(id)), hireId);
  ok(prog.done >= 6, 'progress counts them: ' + prog.done + ' of ' + prog.total);
  await page.screenshot({ path: 'shots/pp-03-hire-files.png', fullPage: true });
}

// ---------- 5. open, download, and the tamper checks ----------
console.log('5. open and download');
{
  const w4 = meta.find(f => f.name === FILES.w4.name), dep = meta.find(f => f.name === FILES.dep.name), big = meta.find(f => f.name === FILES.big.name);
  await page.click(`.ppRow [data-act=ppOpen][data-id="${w4.id}"].nhLink`);
  await page.waitForSelector('#ppViewer iframe.certPdf', { timeout: 20000 });
  ok(/^blob:/.test(await page.getAttribute('#ppViewer iframe', 'src')) && /Unlocked on this screen only/.test(await page.textContent('.modal')), 'a PDF opens in the viewer from an in-memory copy (“Unlocked on this screen only”)');
  await page.click('.modal [data-act=closeModal].x');
  await sleep(200);
  ok(await page.evaluate(() => ppViewUrl === null), 'closing the viewer drops the unlocked copy');
  await page.click(`.ppRow [data-act=ppOpen][data-id="${dep.id}"].nhLink`);
  await page.waitForSelector('#ppViewImg', { timeout: 20000 });
  await page.waitForFunction(() => { const i = document.getElementById('ppViewImg'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  ok(true, 'a photo opens and shows');
  await page.screenshot({ path: 'shots/pp-04-viewer.png' });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal [data-act=ppDownload]')]);
  const got = fs.readFileSync(await dl.path());
  ok(got.equals(FILES.dep.buffer), 'Download gives back the exact file');
  ok(dl.suggestedFilename() === 'Brandi Testa - Direct Deposit Authorization.jpg', 'named after her and the form: ' + dl.suggestedFilename());
  ok(await waitToast(page, /Delete it from Downloads when you’re done/, 5000), '…and reminds to delete the unlocked copy');
  await page.click('.modal [data-act=closeModal].x');
  // a big file, opened fresh: every piece checks out
  ok(await page.evaluate(async id => { ppCache.clear(); const b = await ppGet(ppById(id)); return (await ppSha(await b.arrayBuffer())) === ppById(id).sha; }, big.id), 'the 3-piece file comes back whole (SHA-256 checked)');
  const ps = (await pieces(hubUid)).filter(p => p.id.startsWith(big.id + '_')).sort((a, b) => a.id.localeCompare(b.id));
  const tryOpen = () => page.evaluate(async id => { ppCache.clear(); try { await ppGet(ppById(id)); return 'opened'; } catch (e) { return e.message; } }, big.id);
  // one byte changed on the server
  const orig1 = ps[1].fields;
  const bad = Buffer.from(orig1.ct.bytesValue, 'base64'); bad[5000] ^= 1;
  await putPiece(hubUid, ps[1].id, { ...orig1, ct: { bytesValue: bad.toString('base64') } });
  ok(/tamper check/.test(await tryOpen()), 'a piece changed on the server → refuses to open (“didn’t pass its tamper check”)');
  // two pieces swapped
  await putPiece(hubUid, ps[1].id, ps[0].fields); await putPiece(hubUid, ps[0].id, orig1);
  ok(/tamper check/.test(await tryOpen()), 'two pieces swapped → refuses');
  // a piece missing
  await putPiece(hubUid, ps[0].id, ps[0].fields); await putPiece(hubUid, ps[1].id, orig1);
  ok(await tryOpen() === 'opened', 'put back as they were → opens');
  await delPiece(hubUid, ps[2].id);
  ok(/missing/.test(await tryOpen()), 'a piece missing → says part of the file is missing');
  await putPiece(hubUid, ps[2].id, ps[2].fields);
  ok(await tryOpen() === 'opened', 'restored → opens');
  // a piece from another file under this one's name
  const other = (await pieces(hubUid)).find(p => p.id.startsWith(w4.id + '_'));
  await putPiece(hubUid, ps[2].id, other.fields);
  ok(/tamper check/.test(await tryOpen()), 'another file’s piece put in its place → refuses');
  await putPiece(hubUid, ps[2].id, ps[2].fields);
}

// ---------- 6. the same file again, and changing what a file is ----------
console.log('6. duplicates and changes');
{
  await page.click('[data-ppzone][data-hid] [data-act=ppAdd]:not([data-k])');
  await page.waitForSelector('#ppPick', { state: 'attached' });
  await page.setInputFiles('#ppPick', [FILES.w4]);
  await page.click('#ppGo');
  ok(await waitToast(page, /Already on file, skipped: Brandi W4\.pdf/, 20000), 'the same file again is skipped (“Already on file”)');
  ok((await page.evaluate(() => S.paper.length)) === 4, '…nothing added');
  const dep = meta.find(f => f.name === FILES.dep.name);
  await page.click(`.ppRow [data-act=ppEdit][data-id="${dep.id}"]`);
  await page.waitForSelector('#ppEdKind');
  await page.selectOption('#ppEdKind', 'bank');
  await page.fill('#ppEdNote', 'voided check');
  await page.click('#ppEdSave');
  const d2 = await page.evaluate(id => ({ ...ppById(id), label: ppLabel(ppById(id)) }), dep.id);
  ok(d2.kind === 'bank' && d2.note === 'voided check' && d2.label === 'Voided check or bank letter', 'Change: now a voided check, with a note');
}

// ---------- 7. onto the staff roster: the Paperwork tab ----------
console.log('7. the staff profile');
let sid;
{
  await page.click('[data-act=nhRoster]');
  await page.waitForFunction(id => !!nhHire(id).staffId, hireId);
  sid = await page.evaluate(id => nhHire(id).staffId, hireId);
  ok(await page.evaluate(id => S.paper.every(f => f.sid === id), sid), 'added to the roster: her files go with her');
  await page.evaluate(id => goStaff(id, 'paper'), sid);
  await page.waitForSelector('.ppBar');
  const tab = await page.$eval('.stab.on', e => e.textContent);
  ok(tab === 'Paperwork (4)', 'staff profile has a Paperwork tab: “' + tab + '”');
  const t = await page.textContent('#main');
  ok(/Locked with your password/.test(t) && /never goes to the AI or to the other office apps/.test(t), 'it says how the files are kept');
  const chips = await page.$$eval('.ppEss .ppChip', els => els.map(e => (e.classList.contains('on') ? '+' : '-') + e.textContent.trim()));
  ok(chips.join('|') === '+W-4|+I-9|+Direct deposit|+Policy manual|+HIPAA agreement|+Hep B record', 'On file: W-4, I-9, Direct deposit, Policy manual, HIPAA, Hep B (clinical) — ' + chips.join(' '));
  ok((await page.$$('.ppRow')).length === 4, 'four files listed');
  await page.screenshot({ path: 'shots/pp-05-staff.png', fullPage: true });
  // a file dropped on the tab
  await page.evaluate(() => {
    const z = document.querySelector('.panel[data-ppzone]'), dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 37, 69, 79, 70])], 'Brandi handbook ack.pdf', { type: 'application/pdf' }));
    z.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('#ppList select');
  ok((await page.$eval('#ppList select', e => e.value)) === 'handbook', 'a PDF dropped on the tab opens the upload window, guessed: Policy Manual Acknowledgment');
  await page.click('#ppGo');
  ok(await waitToast(page, /1 file added to Brandi Testa’s paperwork/, 20000), '…and uploads');
  // a file let go outside a drop area doesn't open in the tab
  const leftOpen = await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); document.querySelector('#side').dispatchEvent(ev); return ev.defaultPrevented; });
  ok(leftOpen && await waitToast(page, /Drop paperwork on someone’s Paperwork tab/, 5000), 'a file dropped elsewhere is kept from opening in the tab, and it says where to drop');
  // on a phone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(id => goStaff(id, 'paper'), sid);
  await sleep(300);
  ok(await noScrollX(page), 'phone: the Paperwork tab fits the screen');
  await page.screenshot({ path: 'shots/pp-06-phone.png', fullPage: true });
  await page.click('[data-act=ppAdd][data-sid]:not([data-k])');
  await page.setInputFiles('#ppPick', [FILES.packet]);
  await sleep(200);
  ok(await noScrollX(page), 'phone: the upload window fits');
  await page.screenshot({ path: 'shots/pp-07-phone-upload.png' });
  await page.click('.modal [data-act=ppCancel].x');
  await page.setViewportSize({ width: 1280, height: 900 });
}

// ---------- 8. remove, put back, deleted for good ----------
console.log('8. remove');
{
  await page.evaluate(id => goStaff(id, 'paper'), sid);
  const w4 = meta.find(f => f.name === FILES.w4.name);
  await page.click(`.ppRow [data-act=ppRemove][data-id="${w4.id}"]`);
  await page.click('#cmYes');
  ok(await page.evaluate(id => !!ppById(id).removed, w4.id) && /Removed \(1\)/.test(await page.textContent('#main')), 'Remove → under “Removed (1)”, kept 30 days');
  ok((await page.$$eval('.ppEss .ppChip.on', els => els.map(e => e.textContent.trim()))).indexOf('W-4') < 0, '…and W-4 is no longer “on file”');
  await page.click('details.ppGone summary');
  await page.click(`[data-act=ppRestore][data-id="${w4.id}"]`);
  ok(await page.evaluate(id => ppById(id).removed === 0, w4.id), 'Put back');
  await page.click(`.ppRow [data-act=ppRemove][data-id="${w4.id}"]`);
  await page.click('#cmYes');
  await page.evaluate(id => { ppById(id).removed = Date.now() - 31 * 864e5; }, w4.id);
  const gone = await page.evaluate(() => ppPurgeOld());
  ok(gone === 1 && !(await page.evaluate(id => !!ppById(id), w4.id)), 'removed over 30 days ago → deleted for good');
  ok(!(await pieces(hubUid)).some(p => p.id.startsWith(w4.id + '_')), '…its stored piece is gone from the server');
  ok(await synced(page), 'saved');
  const dropped = await page.evaluate(() => S.paper.find(f => /handbook ack/.test(f.name)).id);
  await page.click(`.ppRow [data-act=ppRemove][data-id="${dropped}"]`); await page.click('#cmYes');
  await page.click('details.ppGone summary');
  await page.click(`[data-act=ppPurge][data-id="${dropped}"]`); await page.click('#cmYes');
  await page.waitForFunction(id => !ppById(id), dropped);
  ok(!(await pieces(hubUid)).some(p => p.id.startsWith(dropped + '_')), 'Delete now → erased from the server at once');
}

// ---------- 9. nothing goes to the AI or the office roster ----------
console.log('9. AI and roster');
{
  const r = await page.evaluate(id => { const p = staffById(id); return { ai: ctxStaff(p) + '\n' + ctxTeam(), ros: JSON.stringify(rosterPerson(p)) }; }, sid);
  ok(!/W-?4|I-9|paperwork|deposit|scan_2026|\.pdf|\.jpg/i.test(r.ai), 'the AI’s notes on her and on the team carry nothing about her paperwork');
  ok(!/paper|scan|pdf|jpg|i9|w4/i.test(r.ros), 'the office roster entry carries nothing about it');
}

// ---------- 10. Lock: nothing opened stays behind; and back in ----------
console.log('10. lock');
{
  const dep = meta.find(f => f.name === FILES.dep.name);
  await page.evaluate(async id => { await ppGet(ppById(id)); await loadPhotoDoc('nothing'); }, dep.id);
  await page.click(`.ppRow [data-act=ppOpen][data-id="${dep.id}"].nhLink`);
  await page.waitForSelector('#ppViewImg');
  await page.evaluate(() => lockNow('Locked after 10 minutes without activity.'));   /* the idle lock, with the viewer open */
  await page.waitForSelector('#ncLoginForm');
  ok(await page.evaluate(() => S === null && cryptoKey === null && ppCache.size === 0 && ppViewUrl === null && Object.keys(photoCache).length === 0 && ppUp === null && !document.getElementById('ppViewer')), 'Lock: no opened file, viewer or certificate copy left in memory');
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'sign in again');
  ok(await page.evaluate(async id => { const b = await ppGet(ppById(id)); return b.size; }, dep.id) === FILES.dep.buffer.length, 'files open again after signing back in');
  // locked in the middle of an upload: nothing half-done is listed
  const before = await page.evaluate(() => S.paper.length);
  await page.evaluate(id => goStaff(id, 'paper'), sid);
  await page.click('[data-act=ppAdd][data-sid]:not([data-k])');
  await page.setInputFiles('#ppPick', [{ name: 'big again.pdf', mimeType: 'application/pdf', buffer: pdf('again', 2_000_000) }]);
  await page.click('#ppGo');
  await page.waitForFunction(() => /part 1 of 3|part 2 of 3/.test((document.getElementById('ppStat') || {}).textContent || ''), null, { timeout: 30000 });
  await page.evaluate(() => lockNow('Locked during upload.'));
  await page.waitForSelector('#ncLoginForm');
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'locked mid-upload, signed in again');
  ok((await page.evaluate(() => S.paper.length)) === before, '…no half-uploaded file on the list');
}

// ---------- 11. the hire record can't be deleted out from under its paperwork ----------
console.log('11. deleting onboarding records');
{
  const h2 = await page.evaluate(() => { const h = { id: uid(), status: 'active', created: Date.now(), staffId: null, inc: {}, done: {}, tasks: {}, notes: '', name: 'Casey Temp', team: 'admin' };
    nhS().hires.push(h); S.paper.push({ id: 'pp00000000000000000001', sid: '', hid: h.id, kind: 'w4', name: 'x.pdf', mime: 'application/pdf', size: 3, n: 1, sha: 'x', added: Date.now(), removed: 0 });
    route.page = 'newhire'; route.nhHire = h.id; route.nhTab = 'hires'; render(); return h.id; });
  await page.click(`[data-act=nhDelHire][data-id="${h2}"]`);
  ok(await waitToast(page, /Casey Temp has 1 signed paperwork file\. Add them to the staff roster first/, 5000) && await page.evaluate(id => !!nhHire(id), h2), 'a hire with paperwork not on the roster: Delete says to add them first, nothing deleted');
  await page.evaluate(() => { S.paper = S.paper.filter(f => f.id !== 'pp00000000000000000001'); });
  await page.evaluate(id => { route.nhHire = id; render(); }, hireId);
  await page.click(`[data-act=nhDelHire][data-id="${hireId}"]`);
  ok(/Their signed paperwork stays on their staff profile/.test(await page.textContent('.modal')), 'Brandi’s record (on the roster): Delete says her paperwork stays on her profile');
  await page.click('#cmYes');
  await page.evaluate(id => goStaff(id, 'paper'), sid);
  ok((await page.$$('.ppRow')).length === 3, '…and it does (3 files)');
}

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
