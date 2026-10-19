// The Tray Maker's link (traymaker.js / nlo-bleachtray app/tracker.py) against the emulators: the lab robot login publishes
// its key, a member seals a queue item to it, the Python side opens it and sends the note back, opened here with the inbox key.
// Run: NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/traymaker_link.mjs"
// (needs python3 with the Tray Maker's requirements next door in ../nlo-bleachtray, or TM_DIR=<its folder>)
// End to end against the emulators: a lab robot login (auth emulator) + mailbots entry (so it isBot), a member who
// seals a queue item to the Tray Maker's published key, then the Python Tracker polls, opens it and sends the note back,
// which this script opens with the inbox private key.
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
import path from 'path'; import { fileURLToPath } from 'url'; const __dirname = path.dirname(fileURLToPath(import.meta.url)); const TM = process.env.TM_DIR || path.resolve(__dirname, '../../nlo-bleachtray');
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, Timestamp, serverTimestamp } from 'firebase/firestore';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
const TE = new TextEncoder(), TD = new TextDecoder();
const b64 = u => Buffer.from(u).toString('base64'), unb64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const EC = { name: 'ECDH', namedCurve: 'P-256' };
async function boxKey(bits, info) { const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function sealTo(pub, bytes, info) { const pk = await crypto.subtle.importKey('jwk', { ...pub, ext: true }, EC, false, []); const eph = await crypto.subtle.generateKey(EC, true, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pk }, eph.privateKey, 256); const k = await boxKey(bits, info); const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(info) }, k, bytes); const j = await crypto.subtle.exportKey('jwk', eph.publicKey); return { epk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, iv: b64(iv), ct: b64(new Uint8Array(ct)) }; }
async function openFrom(priv, box, info) { const epk = await crypto.subtle.importKey('jwk', { ...box.epk, ext: true }, EC, false, []); const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256); const k = await boxKey(bits, info); return TD.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: TE.encode(info) }, k, unb64(box.ct))); }
const PROJECT = 'demo-nlo-cases', API = 'fake-key';
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync(path.resolve(__dirname, '../dist/firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();
// the lab robot's login in the auth emulator
const su = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'labbot.t3st@staff.example', password: 'pw-123456', returnSecureToken: true }) }).then(r => r.json());
const botUid = su.localId; console.log('bot uid', botUid);
const inbox = await crypto.subtle.generateKey(EC, true, ['deriveBits']); const ij = await crypto.subtle.exportKey('jwk', inbox.publicKey);
await env.withSecurityRulesDisabled(async c => { const d = c.firestore();
  await setDoc(doc(d, 'meta/setup'), { owner: 'owner', at: Timestamp.now() }); await setDoc(doc(d, 'meta/keys'), { current: 1 });
  await setDoc(doc(d, 'members/gwen'), { staffId: 'gwen', role: 'staff', active: true, name: 'Gwen' });
  await setDoc(doc(d, 'mailbots/' + botUid), { email: 'labbot.t3st@staff.example', at: Timestamp.now() });
  await setDoc(doc(d, 'meta/inbox'), { pub: { kty: ij.kty, crv: ij.crv, x: ij.x, y: ij.y }, kid: 'k1', senders: [], at: Timestamp.now() });
});
// the setup code, the way NLO Cases makes it (pointing at the emulators)
const code = 'NLOLAB1.' + Buffer.from(JSON.stringify({ p: PROJECT, k: API, e: 'labbot.t3st@staff.example', w: 'pw-123456', ab: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1', tb: 'http://127.0.0.1:9099/securetoken.googleapis.com/v1', fb: 'http://127.0.0.1:8080/v1' })).toString('base64url');
const DATA = path.join(process.env.TMPDIR || '/tmp', 'trk_data_' + process.pid); mkdirSync(DATA, { recursive: true });
const py = (script) => { const r = spawnSync('python3', ['-c', script], { cwd: TM, encoding: 'utf8', env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' } }); if (r.status) console.log(r.stderr); return r.stdout.trim(); };
// 1. link (sign in, make the key, publish it)
console.log(py(`
import sys, json; sys.path.insert(0, '.'); from app.tracker import Tracker
t = Tracker(${JSON.stringify(DATA)}, log=print); st = t.link(${JSON.stringify(code)}); t.stop(); print('linked', st['linked'], st['email'], 'kid', st['kid'])`));
const keys = await (async () => { const out = []; await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), 'labqkeys'))).forEach(d => out.push({ id: d.id, ...d.data() })); }); return out; })();
console.log('published keys:', keys.map(k => k.id + ' ' + k.kid + ' ' + k.name + ' at=' + (k.at && k.at.toMillis ? 'server' : k.at)));
if (keys[0].id !== botUid) throw new Error('key under the wrong login');
// 2. a member seals a case to that key, like traymaker.js
const body = { v: 1, case: 'case1', patient: 'Jane Doe', chart: '123', type: 'retainer', arches: ['Upper', 'Lower'], retKinds: ['TT’s', 'WT’s'], remake: '', scanOnFile: false, dueDate: '2026-10-22', deliveryDate: '', stage: 'print', createdAt: '', assignee: 'Gwen', by: 'Owner' };
const box = await sealTo(keys[0].pub, TE.encode(JSON.stringify(body)), 'labq:case1');
const gdb = env.authenticatedContext('gwen').firestore();
await setDoc(doc(gdb, 'labq/case1'), { kid: keys[0].kid, epk: box.epk, iv: box.iv, ct: box.ct, at: serverTimestamp() });
const box2 = await sealTo(keys[0].pub, TE.encode(JSON.stringify({ ...body, case: 'case2', patient: 'Tom Cat', type: 'mouthguard', arches: ['Upper'], retKinds: [] })), 'labq:case2');
await setDoc(doc(gdb, 'labq/case2'), { kid: 'otherkid', epk: box2.epk, iv: box2.iv, ct: box2.ct, at: serverTimestamp() });
// 3. the Tray Maker polls and sends the note back
console.log(py(`
import sys, json; sys.path.insert(0, '.'); from app.tracker import Tracker
t = Tracker(${JSON.stringify(DATA)}, log=print); t.poll(); q = t.queue(); print('queue:', json.dumps([(x['case'], x['patient'], x['arches'], x['make'], x['due']) for x in q])); print('state:', json.dumps({k: t.state()[k] for k in ('n', 'skipped', 'last_err')}))
print('sent:', t.sent_models('case1', 'Jane Doe', ['upper WT', 'upper TT', 'lower WT', 'lower TT'])); print('hidden after send:', [x['case'] for x in t.queue() if x['sent_here']]); t.stop()`));
// 4. the note, opened with the inbox private key
let notes = []; await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), 'inbox'))).forEach(d => notes.push({ id: d.id, ...d.data() })); });
for (const n of notes) console.log('inbox', n.id.slice(0, 6), 'kid', n.kid, 'at', n.at && n.at.toMillis ? 'server' : n.at, '->', await openFrom(inbox.privateKey, n, 'inbox:' + n.id));
await env.cleanup(); rmSync(DATA, { recursive: true, force: true });
