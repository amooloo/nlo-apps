// The Tray Maker's queue on its page, against the emulators (its server is started from ../nlo-bleachtray, or TM_DIR): link from
// Settings, a member's sealed case shows under To make, click, drop the scan (TM_SCAN=<an upper scan>; without it the test stops
// there), run, Send -> the note in the inbox. Run: NO_PROXY=localhost,127.0.0.1 TM_SCAN=... npx firebase emulators:exec --only
// firestore,auth --project demo-nlo-cases "node test/traymaker_page.mjs" (TM_CHROME=<a chromium> when playwright has none).
// The Tray Maker's queue on the page, against the emulators: seed a bot + a member's sealed queue item, start the Tray
// Maker server, link it from Settings, see the item under "To make", click it, drop the scan, run, Send -> the note.
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
import path from 'path'; import { fileURLToPath } from 'url'; const __dirname = path.dirname(fileURLToPath(import.meta.url)); const TM = process.env.TM_DIR || path.resolve(__dirname, '../../nlo-bleachtray');
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection, Timestamp, serverTimestamp } from 'firebase/firestore';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { chromium } from 'playwright';
const TE = new TextEncoder(), TD = new TextDecoder();
const b64 = u => Buffer.from(u).toString('base64'), unb64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const EC = { name: 'ECDH', namedCurve: 'P-256' };
async function boxKey(bits, info) { const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function sealTo(pub, bytes, info) { const pk = await crypto.subtle.importKey('jwk', { ...pub, ext: true }, EC, false, []); const eph = await crypto.subtle.generateKey(EC, true, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pk }, eph.privateKey, 256); const k = await boxKey(bits, info); const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(info) }, k, bytes); const j = await crypto.subtle.exportKey('jwk', eph.publicKey); return { epk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, iv: b64(iv), ct: b64(new Uint8Array(ct)) }; }
async function openFrom(priv, box, info) { const epk = await crypto.subtle.importKey('jwk', { ...box.epk, ext: true }, EC, false, []); const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256); const k = await boxKey(bits, info); return TD.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: TE.encode(info) }, k, unb64(box.ct))); }
const PROJECT = 'demo-nlo-cases', API = 'fake-key', U = 'http://127.0.0.1:8765', SCAN = process.env.TM_SCAN || '', SHOTS = process.env.TM_SHOTS || (process.env.TMPDIR || '/tmp');
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync(path.resolve(__dirname, '../dist/firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();
const su = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'labbot.t3st@staff.example', password: 'pw-123456', returnSecureToken: true }) }).then(r => r.json());
const inbox = await crypto.subtle.generateKey(EC, true, ['deriveBits']); const ij = await crypto.subtle.exportKey('jwk', inbox.publicKey);
await env.withSecurityRulesDisabled(async c => { const d = c.firestore();
  await setDoc(doc(d, 'meta/setup'), { owner: 'owner', at: Timestamp.now() }); await setDoc(doc(d, 'meta/keys'), { current: 1 });
  await setDoc(doc(d, 'members/gwen'), { staffId: 'gwen', role: 'staff', active: true, name: 'Gwen' });
  await setDoc(doc(d, 'mailbots/' + su.localId), { email: 'labbot.t3st@staff.example', at: Timestamp.now() });
  await setDoc(doc(d, 'meta/inbox'), { pub: { kty: ij.kty, crv: ij.crv, x: ij.x, y: ij.y }, kid: 'k1', senders: [], at: Timestamp.now() }); });
const code = 'NLOLAB1.' + Buffer.from(JSON.stringify({ p: PROJECT, k: API, e: 'labbot.t3st@staff.example', w: 'pw-123456', ab: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1', tb: 'http://127.0.0.1:9099/securetoken.googleapis.com/v1', fb: 'http://127.0.0.1:8080/v1' })).toString('base64url');
// the Tray Maker server (its tracker file lives in jobs/; any earlier link is removed first)
rmSync(path.join(TM, 'jobs/tracker.dat'), { force: true }); rmSync(path.join(TM, 'jobs/tracker_queue.json'), { force: true });
const srv = spawn('python3', ['run_app.py'], { cwd: TM, env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdio: ['ignore', 'ignore', 'pipe'] });
let serr = ''; srv.stderr.on('data', d => { serr += d; });
for (let i = 0; i < 60; i++) { try { if ((await fetch(U + '/')).ok) break; } catch (e) { } await new Promise(r => setTimeout(r, 1000)); }
const wait = async (jid) => { for (let i = 0; i < 300; i++) { const j = await (await fetch(U + '/api/jobs/' + jid)).json(); if (j.status === 'done' || j.status === 'error') return j; await new Promise(r => setTimeout(r, 2000)); } };
try {
  const b = await chromium.launch({ ...(process.env.TM_CHROME ? { executablePath: process.env.TM_CHROME } : {}), args: ['--use-gl=swiftshader'] }); const page = await b.new_page ? await b.new_page() : await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(U + '/'); await page.waitForTimeout(1500);
  console.log('queue box before link hidden:', await page.evaluate("getComputedStyle(document.querySelector('#queuebox')).display === 'none'"));
  // link from Settings
  await page.evaluate(c => { document.querySelector('#tracker_code').value = c; }, code);
  await page.evaluate("document.querySelector('#tracker_link').click()"); await page.waitForTimeout(3000);
  console.log('settings state:', (await page.evaluate("document.querySelector('#tracker_state').textContent")).slice(0, 120));
  // the member seals a case to the published key
  let keys = []; await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), 'labqkeys'))).forEach(d => keys.push({ id: d.id, ...d.data() })); });
  const body = { v: 1, case: 'case1', patient: 'Isabella Pope', chart: '123', type: 'retainer', arches: ['Upper'], retKinds: ['TT’s', 'WT’s'], remake: '', scanOnFile: false, dueDate: '2026-10-22', deliveryDate: '', stage: 'print', createdAt: '', assignee: 'Gwen', by: 'Owner' };
  const box = await sealTo(keys[0].pub, TE.encode(JSON.stringify(body)), 'labq:case1');
  await setDoc(doc(env.authenticatedContext('gwen').firestore(), 'labq/case1'), { kid: keys[0].kid, epk: box.epk, iv: box.iv, ct: box.ct, at: serverTimestamp() });
  await fetch(U + '/api/tracker/refresh', { method: 'POST' }); await new Promise(r => setTimeout(r, 2500));
  await page.evaluate("window.__view.refreshQueue()"); await page.waitForTimeout(800);
  console.log('queue rows:', await page.evaluate("[...document.querySelectorAll('#queue .job.q')].map(e => e.querySelector('.nm').textContent + ' | ' + e.querySelector('.pill').textContent)"), '| count:', await page.evaluate("document.querySelector('#queuecount').textContent"));
  await page.screenshot({ path: path.join(SHOTS, 'traymaker_01_queue.png') });
  // click the case: names filled, hint says From NLO Cases
  console.log('item as the page has it:', JSON.stringify(await page.evaluate("window.__view.queue().items[0]")));
  await page.evaluate("document.querySelector('#queue .job.q').click()"); await page.waitForTimeout(400);
  console.log('after click: tracker', JSON.stringify(await page.evaluate("window.__view.tracker()")), 'picked', await page.evaluate("window.__view.queue().picked"));
  console.log('names:', await page.evaluate("[document.querySelector('#pfirst').value, document.querySelector('#plast').value]"), '| hint:', (await page.evaluate("document.querySelector('#filehint').textContent")).slice(0, 90));
  // drop the upper scan -> the pop-up -> Start
  if (!SCAN) { console.log('TM_SCAN not set: stopping before the drop'); await b.close(); throw Object.assign(new Error('stopped'), { stopped: true }); }
  await page.setInputFiles('#file', [SCAN]); await page.waitForTimeout(800);
  console.log('pop-up names:', await page.evaluate("[document.querySelector('#pfirst').value, document.querySelector('#plast').value]"), 'rows:', await page.evaluate("[...document.querySelectorAll('#setuplist .scanrow')].map(r => [...r.querySelectorAll('.ck')].map(l => l.textContent.trim() + (l.querySelector('input').checked ? '*' : '')).join(', '))"));
  await page.click('#startcase'); await page.waitForTimeout(2500);
  const jobs = await (await fetch(U + '/api/jobs')).json(); const jid = jobs[0].id;
  console.log('job', jid, 'tracker_case:', jobs[0].tracker_case, '| TRACKER used up:', await page.evaluate("window.__view.tracker() === null"));
  await page.evaluate("window.__view.refreshQueue()"); await page.waitForTimeout(600);
  console.log('queue row now:', await page.evaluate("[...document.querySelectorAll('#queue .job.q')].map(e => e.querySelector('.pill').textContent)"));
  const j = await wait(jid); console.log('run:', j.status);
  await page.waitForTimeout(6000);
  // Send
  await page.click('.tab[data-tab="result"]'); await page.waitForTimeout(400);
  await page.evaluate("document.querySelector('#sendbtn').click()"); await page.waitForTimeout(4000);
  const j2 = await (await fetch(U + '/api/jobs/' + jid)).json();
  console.log('sent:', j2.review, '| told:', !!j2.tracker_told, '| log:', (j2.log || []).filter(l => /NLO Cases/.test(l)));
  await page.evaluate("window.__view.refreshQueue()"); await page.waitForTimeout(600);
  console.log('queue after send:', await page.evaluate("document.querySelector('#queuecount').textContent"), '|', await page.evaluate("document.querySelector('#queue').textContent.trim().slice(0, 60)"));
  let notes = []; await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), 'inbox'))).forEach(d => notes.push({ id: d.id, ...d.data() })); });
  for (const n of notes) console.log('inbox note ->', await openFrom(inbox.privateKey, n, 'inbox:' + n.id));
  await page.screenshot({ path: path.join(SHOTS, 'traymaker_02_sent.png') });
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
} catch (e) { if (!e.stopped) throw e; } finally { srv.kill(); await env.cleanup(); if (serr.includes('Traceback')) console.log('server stderr:', serr.slice(-800)); }
