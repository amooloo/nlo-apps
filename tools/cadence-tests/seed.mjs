// Seeds the emulators with a made-up office: NLO Cases logins (Firestore, project nlo-cases) and Cadence data (RTDB).
// Everything here is invented test data.
const AUTH = 'http://127.0.0.1:9099', FS = 'http://127.0.0.1:8080', DB = 'http://127.0.0.1:9000', NS = 'nlo-inventory-default-rtdb';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };

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
export async function fsSet(path, obj) {
  return j(`${FS}/v1/projects/nlo-cases/databases/(default)/documents/${path}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: fv(obj).mapValue.fields }) });
}
export async function fsGet(path) {
  return j(`${FS}/v1/projects/nlo-cases/databases/(default)/documents/${path}`, { headers: H });
}
export async function dbGet(path) { return j(`${DB}/${path}.json?ns=${NS}`, { headers: H }); }
export async function dbPut(path, v) { return j(`${DB}/${path}.json?ns=${NS}`, { method: 'PUT', headers: H, body: JSON.stringify(v) }); }
export async function dbPatch(path, v) { return j(`${DB}/${path}.json?ns=${NS}`, { method: 'PATCH', headers: H, body: JSON.stringify(v) }); }
async function signUp(email, password) {
  const r = await j(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return r.localId;
}

import fs from 'node:fs';
// the rules the apps really run under: NLO Cases' Firestore rules (with Dr. A's sign-in email, as its build fills it in) and
// the nlo-inventory Realtime Database rules for nlo/cadence as published (office Google accounts; see rtdb.rules.json)
export async function loadRules() {
  const fsRules = fs.readFileSync(new URL('../../nlo-cases-src/firestore.rules', import.meta.url), 'utf8').replace(/__OWNER_EMAIL__/g, 'akhavan.ak@gmail.com');
  await j(`${FS}/emulator/v1/projects/nlo-cases:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: fsRules }] } }) });
  await j(`${DB}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: H, body: fs.readFileSync(new URL('./rtdb.rules.json', import.meta.url), 'utf8') });
}

export const PW = 'Correct-Horse-7';
// NLO Cases side: username, member and roster
export const PEOPLE = [
  { key: 'owner', email: 'dr.owner@example.com', sid: 'amir', username: '', name: 'Amir Akhavan', role: 'owner', rid: 's_amir' },
  { key: 'gwen', sid: 'gwen', username: 'gwen', name: 'Gwen Rodis', rid: 's_gwen' },                 // by Staff Hub link
  { key: 'kaylee', sid: 'kaylee', username: 'kaylee', name: 'Kaylee Doty', rid: '' },               // by first + last name
  { key: 'sarah', sid: 'sarah', username: 'sarah', name: 'Sarah Betz', rid: 's_sarah' },            // a manager in Cadence
  { key: 'wila', sid: 'wila', username: 'wila', name: 'Maria Jordan', rid: 's_wila' },              // link wins over a different name
  { key: 'newbie', sid: 'newbie', username: 'newbie', name: 'Nora Newman', rid: '', mustSetup: true },
  { key: 'gone', sid: 'gone', username: 'gone', name: 'Gina Gone', rid: '', active: false },
  { key: 'leftie', sid: 'bri', username: 'bri', name: 'Bri Brower', rid: 's_bri' },                // Staff Hub says she left
  { key: 'alex', sid: 'alex', username: 'alex', name: 'Alex Morgan', rid: '' },                     // two Alex Morgans in Cadence
  { key: 'ghost', sid: 'ghost', username: 'ghost', name: 'Ghost Person', rid: '' },                 // not in Cadence
  { key: 'firsty', sid: 'firsty', username: 'firsty', name: 'Gwen', rid: '' },                      // a first name alone
  { key: 'stranger', sid: 'stranger', username: 'stranger', name: 'Sam Stranger', rid: '', noMember: true },
  { key: 'pinned', sid: 'pinnedx', username: 'pinned', name: 'Dr. Amir Akhavan', rid: '' },         // a staff login that names itself like Dr. A
  { key: 'angie', sid: 'angie', username: 'angie', name: 'Angie Rodriguez', rid: '' },              // Staff Hub's chair name + last name
  { key: 'newhire', sid: 'nina', username: 'nina', name: 'Nina Newhire', rid: 's_newhire' },        // on Staff Hub, not in Cadence yet
  { key: 'evie', sid: 'evie', username: 'evie', name: 'Evie P', rid: '' }                           // Dr. A links it to Eve in Sign-in check
];
// Cadence side (Staff Hub ids)
export const CAD_STAFF = [
  ['s_amir', 'Dr. Amir Akhavan', 'admin'], ['s_sarah', 'Sarah Betz', 'manager'], ['s_gwen', 'Gwen Rodis', 'active'],
  ['s_kaylee', 'Kaylee Doty', 'active'], ['s_eve', 'Eve Pavlova', 'active'], ['s_bri', 'Bri Brower', 'active'],
  ['s_wila', 'Wila Jordan', 'active'], ['s_alex1', 'Alex Morgan', 'active'], ['s_alex2', 'Alex Morgan', 'active'],
  ['s_angelika', 'Angelika Rodriguez', 'active']
];

export async function seedCases() {
  await j(`${AUTH}/emulator/v1/projects/demo-nlo/accounts`, { method: 'DELETE' });
  await j(`${FS}/emulator/v1/projects/nlo-cases/databases/(default)/documents`, { method: 'DELETE' });
  const uids = {};
  for (const p of PEOPLE) {
    const email = p.email || `${p.username}.1@staff.thenextlevelorthodontics.com`;
    const uid = await signUp(email, PW); uids[p.key] = uid; p.uid = uid; p.mail = email;
    if (p.username) await fsSet('logins/' + p.username, { email });
    if (!p.noMember) await fsSet('members/' + uid, { staffId: p.sid, username: p.username, name: p.name, role: p.role || 'staff', active: p.active !== false, mustSetup: !!p.mustSetup, gen: 1 });
    await fsSet('roster/' + p.sid, Object.assign({ name: p.name, role: p.role || 'staff', active: p.active !== false, username: p.username, gen: 1 }, p.rid ? { rid: p.rid } : {}));
  }
  await fsSet('meta/setup', { owner: uids.owner, at: new Date() });
  await fsSet('meta/keys', { current: 1 });
  await fsSet('meta/settings', { idleMin: 10 });
  return uids;
}

export async function seedCadence(state) {
  const roles = (state.roles || []).map(r => r.id);
  state.staff = CAD_STAFF.map(([id, name, status], i) => ({ id, name, initials: name.replace(/^Dr\.?\s+/, '').split(' ').map(x => x[0]).join(''), roleId: roles[i % roles.length] || '', avatarColor: '#294169', status, flags: 0 }));
  await dbPut('nlo/cadence/state', state);
  // Staff Hub's office roster: Bri has left
  const people = {};
  for (const [id, name] of CAD_STAFF) { const n = name.replace(/^Dr\.?\s+/, '').split(' '); people[id] = { id, name: n.join(' '), first: n[0], last: n[n.length - 1], nick: n[0], active: id !== 's_bri', title: 'Staff' }; }
  people.s_bri.end = '2026-09-20';
  people.s_angelika.nick = 'Angie';
  people.s_newhire = { id: 's_newhire', name: 'Nina Newhire', first: 'Nina', last: 'Newhire', nick: 'Nina', active: true, title: 'Assistant' };
  await dbPut('nlo/cadence/roster/people', people);
}
