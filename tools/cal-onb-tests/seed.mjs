// A made-up office for the Office Calendar's and Onboarding's moves (emulators only): NLO Cases logins (from
// ../staff-hub-tests/seed.mjs) with each person's Staff Hub roster id, Staff Hub's roster in the old database, and the
// calendar's and onboarding's data in the old database as the live pages keep it.
import fs from 'node:fs';
import * as E from '../staff-hub-tests/seed.mjs';
export * from '../staff-hub-tests/seed.mjs';

export const NS = 'nlo-inventory-default-rtdb', DBU = 'http://127.0.0.1:9000';
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
export const dbGet = path => E.j(`${DBU}/${path}.json?ns=${NS}`, { headers: H });
export const dbPut = (path, v) => E.j(`${DBU}/${path}.json?ns=${NS}`, { method: 'PUT', headers: H, body: JSON.stringify(v) });
export const dbPatch = (path, v) => E.j(`${DBU}/${path}.json?ns=${NS}`, { method: 'PATCH', headers: H, body: JSON.stringify(v) });
export const dbDelete = path => E.j(`${DBU}/${path}.json?ns=${NS}`, { method: 'DELETE', headers: H });

/* the nlo-inventory Realtime Database rules (office Google accounts; the calendar's and onboarding's parts) */
export async function loadRtdbRules() {
  await E.j(`${DBU}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: H, body: fs.readFileSync(new URL('./rtdb.rules.json', import.meta.url), 'utf8') });
}
/* NLO Cases rules without the roster / calendar / onboarding blocks (as live before these moves) */
export async function loadOlderCasesRules() {
  const full = E.casesRules();
  const i = full.indexOf("    // =====================================================================\n    // ---------- Staff Hub's office roster on the NLO Cases system");
  if (i < 0) throw new Error('block not found');
  await E.putRules('nlo-cases', full.slice(0, i) + '  }\n}\n');
}

/* the full rules but with one match left out (a database that has only partly taken in the new rules, as right after Publish) */
export async function loadRulesWithout(match) {
  const full = E.casesRules();
  const i = full.indexOf('    match /' + match + ' {');
  if (i < 0) throw new Error('match not found: ' + match);
  const j = full.indexOf('\n    }\n', i) + 7;
  await E.putRules('nlo-cases', full.slice(0, i) + full.slice(j));
}

/* Staff Hub's roster as it publishes it (nlo/cadence/roster): the ids the office apps use */
export const PEOPLE = {
  s_amir: { id: 's_amir', name: 'Dr. Amir Akhavan', first: 'Amir', last: 'Akhavan', nick: 'Dr. A', short: 'Dr. A', title: 'Orthodontist / Owner', chairside: true, active: true },
  s_gwen: { id: 's_gwen', name: 'Gwen Rodis', first: 'Gwen', last: 'Rodis', nick: 'Gwen', short: 'Gwen R.', title: 'Orthodontic Assistant', chairside: true, active: true, start: '2025-03-10', employment: 'Full-time (hourly)' },
  s_nora: { id: 's_nora', name: 'Nora Newman', first: 'Nora', last: 'Newman', nick: 'Nora', short: 'Nora N.', title: 'Orthodontic Assistant', chairside: true, active: true, start: '2026-10-20' },
  s_bri: { id: 's_bri', name: 'Bri Brower', first: 'Bri', last: 'Brower', nick: 'Bri', short: 'Bri B.', title: 'Orthodontic Assistant', chairside: true, active: false, end: '2026-09-15' }
};
export const ROSTER = { v: 1, source: 'staff-hub', updatedAt: 1761900000000, people: PEOPLE, dates: { s_gwen: { start: '2025-03-10', review: '2026-12-01', certs: [{ name: 'CPR / BLS', expires: '2027-03-01' }] } } };
export const FEED_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';   // 32 bytes, base64 (a made-up key)

const DAY = 86400000;
const ymd = t => new Date(t).toISOString().slice(0, 10);
export function calendarData(now = Date.now()) {
  return {
    events: {
      e1700000000001: { type: 'event', title: 'Team lunch', startDate: ymd(now + 2 * DAY), endDate: ymd(now + 2 * DAY), time: '12:00', notes: 'Tacos', recurrence: null },
      e1700000000002: { type: 'task', title: 'Order gloves', startDate: ymd(now + DAY), endDate: ymd(now + DAY), time: null, notes: '', recurrence: null, doneDates: { [ymd(now - 6 * DAY)]: now - 6 * DAY } },
      e1700000000003: { type: 'pto', staffId: 's_gwen', staffName: 'Gwen Rodis', startDate: ymd(now + 9 * DAY), endDate: ymd(now + 10 * DAY), time: null, notes: '' },
      e1700000000004: { type: 'event', title: 'Staff meeting', startDate: ymd(now + 20 * DAY), endDate: ymd(now + 20 * DAY), time: '08:00', notes: '', recurrence: 'monthly' }
    },
    staff: {
      s_amir: { name: 'Dr. Akhavan', active: true, birthday: '1985-06-14' },
      s_gwen: { name: 'Gwen (OA)', active: true, birthday: '1996-02-02', hireDate: '2025-03-10' },
      s_savannah: { name: 'Savannah (AC)', active: true, birthday: '1999-11-20' }
    },
    settings: { adminPin: '2468', blackoutDates: { [ymd(now + 30 * DAY)]: true }, closures: { [ymd(now + 15 * DAY)]: 'Winter Holidays' } },
    adminDays: { [ymd(now + 3 * DAY)]: 'admin' },
    stickers: { stk1: { date: ymd(now + 2 * DAY), emoji: '🌮', label: 'Taco day', at: now - DAY } }
  };
}
export function onboardingData(now = Date.now()) {
  const start = ymd(now - 8 * DAY);
  return {
    catalog: {
      meta: { version: '1761800000000-seed', updatedAt: now - 20 * DAY, by: 's_amir' },
      tracks: {
        core: { id: 'core', name: 'NLO Foundations', short: 'Core', desc: 'Everyone', color: 'navy', icon: 'star', order: 1 },
        clinic: { id: 'clinic', name: 'Clinical Assistant', short: 'Clinic', desc: 'Chairside', color: 'mint', icon: 'tooth', order: 2 }
      },
      modules: {
        'core-welcome': { id: 'core-welcome', tracks: ['core'], title: 'Welcome to NLO', desc: 'Who we are', day: 1, minutes: 20, order: 0, lessons: [
          { id: 'l-read1', kind: 'read', title: 'Our story', body: '## Welcome\nNext Level Orthodontics opened in Gainesville.' },
          { id: 'l-quiz1', kind: 'quiz', title: 'Quick check', pass: 80, questions: [{ q: 'Where is NLO?', options: ['Gainesville', 'Ocala'], answer: 0, why: 'Gainesville, FL' }] },
          { id: 'l-ack1', kind: 'ack', title: 'Handbook', body: 'Read the handbook.', statement: 'I have read the handbook.' }
        ], sources: [] },
        'clinic-steri': { id: 'clinic-steri', tracks: ['clinic'], title: 'Sterilization basics', desc: 'The autoclave', day: 2, minutes: 40, order: 0, lessons: [
          { id: 'l-task1', kind: 'task', title: 'Run a cycle', body: 'Do each step.', steps: ['Load the pouches', 'Start the cycle', 'Log it'] },
          { id: 'l-skill1', kind: 'skill', title: 'Wrap an instrument tray', body: 'Show your trainer.', criteria: ['Indicator inside', 'Sealed flat'], where: 'lab' }
        ], sources: [] }
      }
    },
    people: {
      s_nora: { plan: { tracks: { core: true, clinic: true }, start, lead: 's_gwen', status: 'active', name: 'Nora Newman', title: 'Orthodontic Assistant', assignedAt: now - 9 * DAY, assignedBy: 's_amir', updatedAt: now - 9 * DAY, updatedBy: 's_amir' },
        progress: { 'core-welcome': { 'l-read1': { opened: now - 7 * DAY, done: now - 7 * DAY, by: 's_nora' } }, 'clinic-steri': { 'l-skill1': { opened: now - 2 * DAY, ready: now - DAY } } },
        signoffs: {},
        log: { '-Nx000000000000000a1': { at: now - 7 * DAY, t: 'done', m: 'core-welcome', l: 'l-read1', by: 's_nora' }, '-Nx000000000000000a2': { at: now - DAY, t: 'ready', m: 'clinic-steri', l: 'l-skill1', by: 's_nora' } } }
    },
    roles: { trainers: { s_gwen: true }, managers: {} },
    pins: { s_gwen: { s: 'salt', k: 'p2', i: 150000, h: 'deadbeef', at: now - 30 * DAY } },
    keys: { abcdefghjkmnpqrs: { rid: 's_nora', at: now - 9 * DAY, by: 's_amir' } },
    devices: {},
    settings: { officeDays: [1, 2, 3, 4], pass: 80, aisa: true, idleMin: 10 }
  };
}
/* the old database as the live pages see it */
export async function seedOld(now = Date.now()) {
  await E.j(`${DBU}/.json?ns=${NS}`, { method: 'DELETE', headers: H });
  await dbPut('nlo/cadence/roster', ROSTER);
  await dbPut('nlo/cadence/timeOffFeed', { key: FEED_KEY, at: now - 5 * DAY, by: 'akhavan.ak@gmail.com' });
  await dbPut('nlo/calendar', calendarData(now));
  await dbPut('nlo/onboarding', onboardingData(now));
}
/* each NLO Cases login's Staff Hub person (roster/<sid>.rid), as NLO Cases keeps it */
export async function linkRoster() {
  await E.fsSet('nlo-cases', 'roster/amir', { rid: 's_amir' }, ['rid']);
  await E.fsSet('nlo-cases', 'roster/gwen', { rid: 's_gwen' }, ['rid']);
  await E.fsSet('nlo-cases', 'roster/newbie', { rid: 's_nora' }, ['rid']);
}
