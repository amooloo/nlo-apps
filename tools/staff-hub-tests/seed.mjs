// A made-up office on the Firebase emulators (nothing live): NLO Cases logins with real key material (project nlo-cases)
// and Staff Hub's own project (nlo-staff-hub). Also stands in for what NLO Cases itself does to Dr. A's keys
// (change password, reset + recovery code, a new recovery code), copied from nlo-cases-src/src/backend.js.
import fs from 'node:fs';
import { Crypto, normCode, recoveryCode, TE, TD } from './nccrypto.mjs';

export const AUTH = 'http://127.0.0.1:9099', FS = 'http://127.0.0.1:8080';
export const POOL = process.env.AUTH_PROJECT || 'demo-nlo';   // the sign-in pool every app shares on the emulators
const ADMIN = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };

export async function j(url, opt) {
  const r = await fetch(url, opt);
  const t = await r.text();
  if (!r.ok) throw new Error(url + ' ' + r.status + ' ' + t.slice(0, 300));
  try { return JSON.parse(t); } catch { return t; }
}
function fv(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fv) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } };
}
function js(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue || {}).values || []).map(js);
  if ('mapValue' in v) return Object.fromEntries(Object.entries((v.mapValue || {}).fields || {}).map(([k, x]) => [k, js(x)]));
  return undefined;
}
const docUrl = (project, path) => `${FS}/v1/projects/${project}/databases/(default)/documents/${path}`;
export async function fsSet(project, path, obj, mask) {
  const q = mask ? '?' + mask.map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&') : '';
  return j(docUrl(project, path) + q, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: fv(obj).mapValue.fields }) });
}
export async function fsGet(project, path) {
  const r = await fetch(docUrl(project, path), { headers: ADMIN });
  if (r.status === 404) return null;
  const d = await r.json();
  return js({ mapValue: { fields: d.fields || {} } });
}
export async function fsDelField(project, path, field) {
  return j(docUrl(project, path) + '?updateMask.fieldPaths=' + encodeURIComponent(field), { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: {} }) });
}
export async function fsList(project, coll) {
  const r = await j(docUrl(project, coll) + '?pageSize=300', { headers: ADMIN });
  return (r.documents || []).map(d => ({ id: d.name.split('/').pop(), data: js({ mapValue: { fields: d.fields || {} } }) }));
}

export async function loadRules() {
  const cases = fs.readFileSync(new URL('../../nlo-cases-src/firestore.rules', import.meta.url), 'utf8').replace(/__OWNER_EMAIL__/g, 'dr.owner@example.com');
  const hub = fs.readFileSync(new URL('../../staff-hub-firestore.rules', import.meta.url), 'utf8');
  for (const [p, content] of [['nlo-cases', cases], ['nlo-staff-hub', hub]])
    await j(`${FS}/emulator/v1/projects/${p}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) });
}

/* ---------- accounts ---------- */
export async function signUp(email, password) {
  const r = await j(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return r.localId;
}
export async function signIn(email, password) {
  return j(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
}
/* what "Change password" (or a reset link) does to the sign-in itself */
export async function setPassword(email, oldPw, newPw) {
  const s = await signIn(email, oldPw);
  await j(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: s.idToken, password: newPw, returnSecureToken: true }) });
}

/* ---------- the made-up office ---------- */
export const PW = 'Correct-Horse-7';                 // everyone's NLO Cases password to start with
export const REC = 'ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2';  // the office recovery code to start with
export const OWNER = { email: 'dr.owner@example.com', sid: 'amir', name: 'Amir Akhavan' };
export const STAFF = [
  { username: 'gwen', name: 'Gwen Rodis' },
  { username: 'newbie', name: 'Nora Newman', mustSetup: true },
  { username: 'gone', name: 'Gina Gone', active: false }
];
const office = { ring: null, uid: null };
export function ownerUid() { return office.uid; }

export async function seedOffice() {
  await j(`${AUTH}/emulator/v1/projects/${POOL}/accounts`, { method: 'DELETE' });
  for (const p of ['nlo-cases', 'nlo-staff-hub']) await j(`${FS}/emulator/v1/projects/${p}/databases/(default)/documents`, { method: 'DELETE' });
  const uid = await signUp(OWNER.email, PW); office.uid = uid;
  // as NLO Cases' setupOwner: a key pair (private key sealed with the password), the office key ring sealed to it, the recovery box
  const ring = { '1': Crypto.newRingKey() }; office.ring = ring;
  const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), pbytes = await Crypto.privBytes(pair);
  const priv = await Crypto.pwSeal(PW, pbytes, 'priv:' + uid);
  const ringBox = await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + uid);
  await fsSet('nlo-cases', 'members/' + uid, { staffId: OWNER.sid, username: '', name: OWNER.name, role: 'owner', active: true, mustSetup: false, pub, priv, ring: ringBox, ringV: 1, gen: 0 });
  await fsSet('nlo-cases', 'roster/' + OWNER.sid, { name: OWNER.name, role: 'owner', active: true, username: '', gen: 0 });
  await fsSet('nlo-cases', 'meta/setup', { owner: uid, at: new Date() });
  await fsSet('nlo-cases', 'meta/keys', { current: 1 });
  await fsSet('nlo-cases', 'meta/settings', { idleMin: 10 });
  await fsSet('nlo-cases', 'meta/recovery', await recoveryDoc(REC, ring));
  for (const p of STAFF) {
    const email = p.username + '.1@staff.example.com';
    const suid = await signUp(email, PW); p.uid = suid;
    await fsSet('nlo-cases', 'logins/' + p.username, { email });
    await fsSet('nlo-cases', 'members/' + suid, { staffId: p.username, username: p.username, name: p.name, role: 'staff', active: p.active !== false, mustSetup: !!p.mustSetup, gen: 1 });
    await fsSet('nlo-cases', 'roster/' + p.username, { name: p.name, role: 'staff', active: p.active !== false, username: p.username, gen: 1 });
  }
  return uid;
}
async function recoveryDoc(code, ring) {
  const rpair = await Crypto.newPair(), rpub = await Crypto.pubJwk(rpair);
  const rpriv = await Crypto.pwSeal(normCode(code), await Crypto.privBytes(rpair), 'recovery-priv');
  const rring = await Crypto.sealTo(rpub, Crypto.ringBytes(ring), 'ring:recovery');
  return { pub: rpub, priv: rpriv, ring: rring, ringV: Math.max.apply(null, Object.keys(ring).map(Number)) };
}

/* ---------- what NLO Cases does to Dr. A's keys ---------- */
async function ownerPriv(pw) {
  const m = await fsGet('nlo-cases', 'members/' + office.uid);
  return Crypto.importPriv(await Crypto.pwOpen(pw, m.priv, 'priv:' + office.uid));
}
// My account → Change password (backend.js changePassword): same key pair, private key sealed with the new password
export async function casesChangePassword(cur, next) {
  const m = await fsGet('nlo-cases', 'members/' + office.uid);
  const bytes = await Crypto.pwOpen(cur, m.priv, 'priv:' + office.uid);
  await fsSet('nlo-cases', 'members/' + office.uid, { priv: await Crypto.pwSeal(next, bytes, 'priv:' + office.uid), privPrev: await Crypto.pwSeal(cur, bytes, 'priv:' + office.uid) }, ['priv', 'privPrev']);
  await setPassword(OWNER.email, cur, next);
  await fsDelField('nlo-cases', 'members/' + office.uid, 'privPrev');
}
// "Dr. A: reset by email", then NLO Cases' recovery code (backend.js recover): a NEW key pair
export async function casesRecover(newPw, code) {
  const r = await fsGet('nlo-cases', 'meta/recovery');
  const rpriv = await Crypto.importPriv(await Crypto.pwOpen(normCode(code), r.priv, 'recovery-priv'));
  const ring = Crypto.ringFrom(await Crypto.openFrom(rpriv, r.ring, 'ring:recovery'));
  const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), pbytes = await Crypto.privBytes(pair);
  await fsSet('nlo-cases', 'members/' + office.uid, { pub, priv: await Crypto.pwSeal(newPw, pbytes, 'priv:' + office.uid), ring: await Crypto.sealTo(pub, Crypto.ringBytes(ring), 'ring:' + office.uid), ringV: 1 }, ['pub', 'priv', 'ring', 'ringV']);
  await fsDelField('nlo-cases', 'members/' + office.uid, 'privPrev');
  return pub;
}
// Team & security → a new recovery code (backend.js rotateRecovery): a new recovery key pair
export async function casesNewRecoveryCode() {
  const code = recoveryCode();
  await fsSet('nlo-cases', 'meta/recovery', await recoveryDoc(code, office.ring));
  return code;
}

/* ---------- reading Staff Hub's link the way only Dr. A (or the recovery code) can ---------- */
export async function openLinkBox(pw) {
  const m = await fsGet('nlo-cases', 'members/' + office.uid);
  if (!m.shLink) return null;
  return JSON.parse(TD.decode(await Crypto.openFrom(await ownerPriv(pw), m.shLink.box, 'staffhub:' + office.uid)));
}
export async function openLinkEscrow(code) {
  const m = await fsGet('nlo-cases', 'members/' + office.uid), r = await fsGet('nlo-cases', 'meta/recovery');
  if (!m.shLink || !m.shLink.esc) return null;
  const rpriv = await Crypto.importPriv(await Crypto.pwOpen(normCode(code), r.priv, 'recovery-priv'));
  return JSON.parse(TD.decode(await Crypto.openFrom(rpriv, m.shLink.esc, 'staffhub:recovery')));
}
export { TE, TD };
