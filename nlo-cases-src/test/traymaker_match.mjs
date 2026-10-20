// A case made in the Tray Maker without clicking it in the To make list is still tied to its NLO Cases case by name (a slip
// like Julianna / Juliana too, when the last name, the arch and what is made agree), and Send to Trimlign / the print files
// send the note with how = orthofactory / printer - NLO Cases then moves the case to Printing (traymaker.js tmSync).
// Run: NO_PROXY=localhost,127.0.0.1 TM_UPPER=<upper scan> TM_LOWER=<lower scan> npx firebase emulators:exec --only
// firestore,auth --project demo-nlo-cases "node test/traymaker_match.mjs"   (TM_DIR=<the Tray Maker folder with its base>)
import path from 'path'; import { fileURLToPath } from 'url'; const __dirname = path.dirname(fileURLToPath(import.meta.url)); const TM = process.env.TM_DIR || path.resolve(__dirname, '../../nlo-bleachtray');
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection, Timestamp, serverTimestamp } from 'firebase/firestore';
import { readFileSync, rmSync } from 'fs';
import { spawn } from 'child_process';
const TE = new TextEncoder(), TD = new TextDecoder();
const b64 = u => Buffer.from(u).toString('base64'), unb64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const EC = { name: 'ECDH', namedCurve: 'P-256' };
async function boxKey(bits, info) { const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function sealTo(pub, bytes, info) { const pk = await crypto.subtle.importKey('jwk', { ...pub, ext: true }, EC, false, []); const eph = await crypto.subtle.generateKey(EC, true, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pk }, eph.privateKey, 256); const k = await boxKey(bits, info); const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(info) }, k, bytes); const j = await crypto.subtle.exportKey('jwk', eph.publicKey); return { epk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, iv: b64(iv), ct: b64(new Uint8Array(ct)) }; }
async function openFrom(priv, box, info) { const epk = await crypto.subtle.importKey('jwk', { ...box.epk, ext: true }, EC, false, []); const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256); const k = await boxKey(bits, info); return TD.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: TE.encode(info) }, k, unb64(box.ct))); }
const PROJECT = 'demo-nlo-cases', API = 'fake-key', U = 'http://127.0.0.1:8765';
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
rmSync(path.join(TM, 'jobs/tracker.dat'), { force: true }); rmSync(path.join(TM, 'jobs/tracker_queue.json'), { force: true });
const srv = spawn('python3', ['run_app.py'], { cwd: TM, env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdio: ['ignore', 'ignore', 'pipe'] });
let serr = ''; srv.stderr.on('data', d => { serr += d; });
for (let i = 0; i < 60; i++) { try { if ((await fetch(U + '/')).ok) break; } catch (e) { } await new Promise(r => setTimeout(r, 1000)); }
const wait = async (jid) => { for (let i = 0; i < 400; i++) { const j = await (await fetch(U + '/api/jobs/' + jid)).json(); if (j.status === 'done' || j.status === 'error') return j; await new Promise(r => setTimeout(r, 2000)); } };
const post = (u, form) => fetch(U + u, { method: 'POST', body: form });
const newJob = async (file, arch, make, first, last) => { const fd = new FormData(); fd.append('files', new Blob([readFileSync(file)]), path.basename(file)); fd.append('arches', JSON.stringify([arch])); fd.append('makes', JSON.stringify([[make]])); fd.append('braces', '[false]'); fd.append('one_case', '1'); fd.append('preset', 'both'); fd.append('params', JSON.stringify({ patient_first: first, patient_last: last })); return (await (await post('/api/jobs', fd)).json()).id; };
try {
  const r = await (await post('/api/tracker/link', new URLSearchParams({ code }))).json(); console.log('linked:', r.linked);
  let keys = []; await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), 'labqkeys'))).forEach(d => keys.push({ id: d.id, ...d.data() })); });
  const items = [{ v: 1, case: 'caseMG', patient: 'Juliana Testpatient', type: 'mouthguard', arches: ['Upper'], retKinds: [], stage: 'print' },
                 { v: 1, case: 'caseTT', patient: 'Oliver Example', type: 'retainer', arches: ['Lower'], retKinds: ['TT’s'], stage: 'print' }];
  for (const b of items) { const box = await sealTo(keys[0].pub, TE.encode(JSON.stringify(b)), 'labq:' + b.case); await setDoc(doc(env.authenticatedContext('gwen').firestore(), 'labq/' + b.case), { kid: keys[0].kid, epk: box.epk, iv: box.iv, ct: box.ct, at: serverTimestamp() }); }
  await post('/api/tracker/refresh', new URLSearchParams()); await new Promise(r => setTimeout(r, 2500));
  console.log('queue:', (await (await fetch(U + '/api/queue')).json()).items.map(i => i.patient + ' ' + i.make.join('+')));
  const jA = await newJob(process.env.TM_UPPER, 'upper', 'MG', 'Julianna', 'Testpatient');          // a typo, mouthguard upper
  const jB = await newJob(process.env.TM_LOWER, 'lower', 'TT', 'Oliver', 'Example');            // the exact name
  const jC = await newJob(process.env.TM_LOWER, 'lower', 'TT', 'Oliver', 'Sample');            // another patient
  for (const [n, id] of [['Julianna Testpatient', jA], ['Oliver Example', jB], ['Oliver Sample', jC]]) { const j = await (await fetch(U + '/api/jobs/' + id)).json(); console.log(n, '-> tracker_case', JSON.stringify((j.params || {}).tracker_case || ''), '|', (j.log || []).filter(l => /NLO Cases/.test(l)).join(' / ')); }
  for (const id of [jA, jB]) console.log('run', id, (await wait(id)).status);
  const s1 = await (await post('/api/jobs/' + jB + '/approve', new URLSearchParams())).json(); console.log('Oliver sent:', s1.review);
  const s2 = await post('/api/jobs/' + jA + '/prints', new URLSearchParams()); console.log('Juliana print files:', s2.status);
  await post('/api/jobs/' + jA + '/prints', new URLSearchParams());   // again: told once
  for (const id of [jA, jB]) { const j = await (await fetch(U + '/api/jobs/' + id)).json(); console.log(id, 'log:', (j.log || []).filter(l => /NLO Cases/.test(l))); }
  let notes = []; await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), 'inbox'))).forEach(d => notes.push({ id: d.id, ...d.data() })); });
  console.log('inbox notes:', notes.length); for (const n of notes) console.log('  ', await openFrom(inbox.privateKey, n, 'inbox:' + n.id));
} finally { srv.kill(); await env.cleanup(); if (serr.includes('Traceback')) console.log('server stderr:', serr.slice(-1500)); }
