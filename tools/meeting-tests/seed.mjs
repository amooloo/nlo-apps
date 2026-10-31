// A made-up office for the Staff Meeting Hub's move (emulators only): NLO Cases logins (from ../staff-hub-tests/seed.mjs),
// the Hub's data in the old database as the live Hub keeps it, Staff Hub's roster in both places, a little of Cadence and
// Inventory on the NLO Cases system.
import fs from 'node:fs';
import * as E from '../staff-hub-tests/seed.mjs';
export * from '../staff-hub-tests/seed.mjs';

export const NS = 'nlo-inventory-default-rtdb', DBU = 'http://127.0.0.1:9000';
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
export const dbGet = path => E.j(`${DBU}/${path}.json?ns=${NS}`, { headers: H });
export const dbPut = (path, v) => E.j(`${DBU}/${path}.json?ns=${NS}`, { method: 'PUT', headers: H, body: JSON.stringify(v) });
export const dbPatch = (path, v) => E.j(`${DBU}/${path}.json?ns=${NS}`, { method: 'PATCH', headers: H, body: JSON.stringify(v) });

/* the nlo-inventory Realtime Database rules as published (office Google accounts only) */
export async function loadRtdbRules() {
  await E.j(`${DBU}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: H, body: fs.readFileSync(new URL('../cadence-tests/rtdb.rules.json', import.meta.url), 'utf8') });
}
/* NLO Cases rules without this block (as live before the move) */
export async function loadOlderCasesRules() {
  const full = E.casesRules();
  const i = full.indexOf('    // =====================================================================\n    // ---------- the Staff Meeting Hub + Month-End Numbers');
  if (i < 0) throw new Error('block not found');
  await E.putRules('nlo-cases', full.slice(0, i) + '  }\n}\n');
}

export const PEOPLE = [
  { id: 's_amir', name: 'Dr. Amir Akhavan', first: 'Amir', last: 'Akhavan', nick: 'Dr. A', short: 'Dr. A', title: 'Orthodontist / Owner', active: true },
  { id: 's_gwen', name: 'Gwen Rodis', first: 'Gwen', last: 'Rodis', title: 'Orthodontic Assistant', active: true },
  { id: 's_kaylee', name: 'Kaylee Doty', first: 'Kaylee', last: 'Doty', title: 'Orthodontic Assistant', active: true },
  { id: 's_sarah', name: 'Sarah Betz', first: 'Sarah', last: 'Betz', title: 'Office Coordinator', active: true },
  { id: 's_bri', name: 'Bri Brower', first: 'Bri', last: 'Brower', title: 'Orthodontic Assistant', active: false, end: '2026-09-15' }
];
const DAY = 86400000;
export function hubData(now = Date.now()) {
  const ymd = t => new Date(t).toISOString().slice(0, 10);
  const next = ymd(now + 6 * DAY), prev = ymd(now - 24 * DAY);
  return {
    inbox: {
      '-Nq0aaaaaaaaaaaaaaa1': { text: 'Chart notes are piling up on Thursdays', cat: 'issue', auto: true, personId: 's_gwen', name: 'Gwen Rodis', via: 'quick-note', status: 'open', star: false, parked: 0, createdAt: now - 3 * DAY },
      '-Nq0aaaaaaaaaaaaaaa2': { text: 'We are out of medium gloves', cat: 'action', auto: true, personId: 's_kaylee', name: 'Kaylee Doty', via: 'hub', status: 'open', star: true, parked: 0, createdAt: now - 2 * DAY, trail: { '-Nq0trail00000000001': { kind: 'pushed', date: prev, at: now - 2 * DAY, by: 'Dr. A' } } },
      '-Nq0aaaaaaaaaaaaaaa3': { text: 'Shout-out to Sarah for the new check-in flow', cat: 'kudos', auto: false, personId: 's_amir', name: 'Dr. Amir Akhavan', via: 'hub', status: 'closed', star: false, parked: 0, createdAt: now - 30 * DAY, outcome: { type: 'covered', meetingId: prev, at: now - 24 * DAY } }
    },
    actionItems: {
      '-Nq0act0000000000001': { text: 'Order medium gloves', owner: 'Kaylee', ownerId: 's_kaylee', status: 'open', due: ymd(now + 3 * DAY), createdAt: now - 24 * DAY, meetingId: prev, carried: 1 },
      '-Nq0act0000000000002': { text: 'Fix the Thursday chart backlog', owner: 'Everyone', ownerId: 'team', status: 'done', completedAt: now - DAY, createdAt: now - 24 * DAY, meetingId: prev, carried: 0 },
      '-Nq0act0000000000003': { text: 'Restock the bonding trays', owner: 'Gwen', ownerId: 's_gwen', status: 'open', due: ymd(now + 2 * DAY), createdAt: now - 24 * DAY, meetingId: prev, carried: 0 }
    },
    decisions: { '-Nq0dec0000000000001': { text: 'Huddle at 7:50 every morning', meetingId: prev, date: prev, raisedBy: 'Dr. A', createdAt: now - 24 * DAY } },
    kpiDefs: {
      tc_starts: { role: 'Treatment Coordinator', label: 'Case starts', goal: '20', goalNum: 20, unit: '#', dir: 'up', core: true, enabled: true, order: 1 },
      fc_coll: { role: 'Financial Coordinator', label: 'Collections', goal: '$95,000', goalNum: 95000, unit: '$', dir: 'up', core: true, enabled: true, order: 2 }
    },
    meetings: {
      [prev]: { meta: { date: prev, title: 'Monthly Staff Meeting', status: 'done', createdAt: now - 40 * DAY, endedAt: now - 24 * DAY }, run: { attendance: { s_gwen: true, s_kaylee: true, s_sarah: false } }, kpis: { tc_starts: 18 }, transcript: { text: 'Dr. A: let us start with the huddle…', savedAt: now - 24 * DAY } },
      [next]: { meta: { date: next, title: 'Monthly Staff Meeting', status: 'collecting', createdAt: now - 24 * DAY, after: prev, dateSource: 'manual' } }
    },
    currentMeetingId: next,
    config: { endpoint: 'https://aisa-worker.example/ask', sources: { cadence: true, spend: true, out: true, newhires: false }, migratedV2: { at: now - 60 * DAY, by: 'akhavan.ak@gmail.com' } },
    monthEnd: {
      months: { '2026-09': { np: 14, net_coll: 91234, final: { at: now - 20 * DAY, id: 's_sarah', name: 'Sarah' }, totals: { np: 14, conv: 50 } } },
      years: { 2026: { goal_np: 180 } },
      config: { tcs: [{ id: 's_sarah', name: 'Sarah' }], due: 5 }
    }
  };
}
/* the Hub's data and the roster in the old database; the roster copy, a little Cadence and Inventory on the NLO Cases side */
export async function seedHub() {
  await dbPut('nlo', null);
  await dbPut('nlo/staffMeeting', hubData());
  await dbPut('nlo/cadence/roster/people', Object.fromEntries(PEOPLE.map(p => [p.id, p])));
  await dbPut('nlo/settings', { aisaAdminKey: 'aisa-shared-key-1', geminiKey: 'AIzaFAKE-gemini-key-0123456789' });
  await dbPut('nlo/onboarding/people', {});
  for (const c of ['mtgInbox', 'mtgActions', 'mtgDecisions', 'mtgKpiDefs', 'mtgMeetings', 'mtgTexts', 'mtgState', 'meMonths', 'meState', 'mtgMeta']) {
    const docs = await E.fsList('nlo-cases', c).catch(() => []);
    for (const d of docs) await fetch(`${E.FS}/v1/projects/nlo-cases/databases/(default)/documents/${c}/${d.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  }
  const now = new Date();
  await E.fsSet('nlo-cases', 'cadMirror/roster', { people: PEOPLE.map(p => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'photo'))), up: now, upBy: 'amir' });
  await E.fsSet('nlo-cases', 'cadState/config', { staff: [{ id: 'c_gwen', name: 'Gwen Rodis', status: 'active' }], checklists: [{ id: 'cl1', name: 'Opening', schedule: { kind: 'daily', dueTime: '08:00' } }], up: now, upBy: 'amir' });
  await E.fsSet('nlo-cases', 'cadState/timeoff', { e: {}, up: now, upBy: 'amir' });
  await E.fsSet('nlo-cases', 'invState/ai', { gemini: 'AIzaFAKE-gemini-key-0123456789', up: now, upBy: 'amir' });
  await E.fsSet('nlo-cases', 'invState/budget', { monthly: 8500, categories: {}, up: now, upBy: 'amir' });
  // Gwen's NLO Cases login is linked to her Staff Hub person; Kaylee has no login
  await E.fsSet('nlo-cases', 'roster/gwen', { rid: 's_gwen' }, ['rid']);
}
