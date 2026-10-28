// Cadence's block of the shared Firestore rules (../../nlo-cases-src/firestore.rules), on the emulator. Made-up office.
//   npx firebase emulators:exec --only firestore --project demo-nlo-cases "node rules.test.mjs"
// (or with the emulators already running: node rules.test.mjs)
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, runTransaction, serverTimestamp, deleteField } from 'firebase/firestore';

// the office's dates (US Eastern), as Cadence's screens there have them: the rules refuse a day that hasn't begun yet
const etDay = n => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); };
const YDAY = etDay(-1), TODAY = etDay(0), TMRW = etDay(1);
const rules = fs.readFileSync(new URL('../../nlo-cases-src/firestore.rules', import.meta.url), 'utf8').replace(/__OWNER_EMAIL__/g, 'akhavan.ak@gmail.com');
const env = await initializeTestEnvironment({ projectId: 'demo-nlo-cases', firestore: { rules, host: '127.0.0.1', port: 8080 } });
let pass = 0, fail = 0;
async function t(what, p) { try { await p; pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + ' — ' + String(e && e.message || e).slice(0, 200)); } }

await env.clearFirestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'meta/setup'), { owner: 'uOwner', at: new Date() });
  await setDoc(doc(db, 'meta/keys'), { current: 1 });
  await setDoc(doc(db, 'members/uOwner'), { staffId: 'amir', role: 'owner', active: true });
  await setDoc(doc(db, 'members/uGwen'), { staffId: 'gwen', role: 'staff', active: true });
  await setDoc(doc(db, 'members/uKay'), { staffId: 'kaylee', role: 'staff', active: true });
  await setDoc(doc(db, 'members/uGone'), { staffId: 'gone', role: 'staff', active: false });
  await setDoc(doc(db, 'cadState/config'), { checklists: [], staff: [], up: new Date(), upBy: 'amir' });
  await setDoc(doc(db, 'cadState/day'), { today: '2026-10-22', currentQuarter: '2026-Q4', up: new Date(), upBy: 'amir' });
  await setDoc(doc(db, 'cadInst/iPend'), { id: 'iPend', date: '2026-10-22', status: 'pending', items: {}, up: new Date(), upBy: 'amir' });
  await setDoc(doc(db, 'cadInst/iProg'), { id: 'iProg', date: '2026-10-22', status: 'in-progress', items: {}, up: new Date(), upBy: 'amir' });
  await setDoc(doc(db, 'cadInst/iCert'), { id: 'iCert', date: '2026-10-22', status: 'certified', items: {}, up: new Date(), upBy: 'amir' });
  await setDoc(doc(db, 'cadInst/iFail'), { id: 'iFail', date: '2026-10-22', status: 'failed', items: {}, up: new Date(), upBy: 'amir' });
  await setDoc(doc(db, 'cadAudit/aud_1'), { id: 'aud_1', tone: 'info', actor: 'System', message: '<b>System</b> rolled', detail: null, at: '7:30a', t0: 1, ts: new Date(), by: 'amir' });
  await setDoc(doc(db, 'cadMeta/moved'), { on: true, at: new Date() });
});
const anon = env.unauthenticatedContext().firestore();
const owner = env.authenticatedContext('uOwner', { email: 'akhavan.ak@gmail.com', email_verified: true }).firestore();
const gwen = env.authenticatedContext('uGwen', { email: 'gwen.1@staff.thenextlevelorthodontics.com' }).firestore();
const gone = env.authenticatedContext('uGone', { email: 'gone.1@staff.thenextlevelorthodontics.com' }).firestore();
const stranger = env.authenticatedContext('uStranger', { email: 'someone@thenextlevelorthodontics.com', email_verified: true }).firestore();
const ST = (who, x) => Object.assign({ up: serverTimestamp(), upBy: who }, x || {});
const inst = (id, x) => Object.assign({ id, checklistId: 'cl_1', date: '2026-10-23', assigneeId: 's_gwen', status: 'pending', items: { it1: { itemId: 'it1', checked: false, subtasksDone: {} } }, itemOrder: ['it1'], n: 5 }, x || {});

console.log('not signed in');
await t('may read whether Cadence moved (cadMeta/moved)', assertSucceeds(getDoc(doc(anon, 'cadMeta/moved'))));
await t('can’t read the setup', assertFails(getDoc(doc(anon, 'cadState/config'))));
await t('can’t list the lists', assertFails(getDocs(collection(anon, 'cadInst'))));
await t('can’t read the activity log', assertFails(getDocs(collection(anon, 'cadAudit'))));
await t('can’t read the mirrors', assertFails(getDoc(doc(anon, 'cadMirror/roster'))));
await t('can’t read the move info', assertFails(getDoc(doc(anon, 'cadMeta/info'))));
await t('can’t read the rules markers', assertFails(getDoc(doc(anon, 'meta/rules_cad_1'))));
await t('… nor the second', assertFails(getDoc(doc(anon, 'meta/rules_cad_2'))));
await t('can’t write a list', assertFails(setDoc(doc(anon, 'cadInst/x1'), inst('x1', ST('gwen')))));
await t('can’t flip the move marker', assertFails(setDoc(doc(anon, 'cadMeta/moved'), { on: false, at: serverTimestamp() })));

console.log('signed in, but not an office member (no NLO Cases login / turned off)');
await t('a Google-style account with no login can’t read the setup', assertFails(getDoc(doc(stranger, 'cadState/config'))));
await t('… nor the lists', assertFails(getDocs(collection(stranger, 'cadInst'))));
await t('a turned-off login can’t read the lists', assertFails(getDocs(collection(gone, 'cadInst'))));
await t('a turned-off login can’t tick a list', assertFails(updateDoc(doc(gone, 'cadInst/iPend'), ST('gone', { status: 'in-progress' }))));

console.log('staff (Gwen)');
await t('reads the setup', assertSucceeds(getDoc(doc(gwen, 'cadState/config'))));
await t('reads the day', assertSucceeds(getDoc(doc(gwen, 'cadState/day'))));
await t('lists the lists from a date on', assertSucceeds(getDocs(query(collection(gwen, 'cadInst'), where('date', '>=', '2026-07-01')))));
await t('reads the activity log', assertSucceeds(getDocs(collection(gwen, 'cadAudit'))));
await t('reads the mirrors', assertSucceeds(getDoc(doc(gwen, 'cadMirror/roster'))));
await t('reads the rules markers', assertSucceeds(getDoc(doc(gwen, 'meta/rules_cad_1'))));
await t('… and the second (the updated rules)', assertSucceeds(getDoc(doc(gwen, 'meta/rules_cad_2'))));
await t('reads the move info', assertSucceeds(getDoc(doc(gwen, 'cadMeta/info'))));
await t('can’t change the setup (checklists, staff, rotations)', assertFails(updateDoc(doc(gwen, 'cadState/config'), ST('gwen', { checklists: [{ id: 'x' }] }))));
await t('can’t make a new setup either', assertFails(setDoc(doc(gwen, 'cadState/config'), ST('gwen', { checklists: [] }))));
await t('rolls the day (stamped)', assertSucceeds(setDoc(doc(gwen, 'cadState/day'), ST('gwen', { today: YDAY, currentQuarter: '2026-Q4' }))));
await t('… to today', assertSucceeds(setDoc(doc(gwen, 'cadState/day'), ST('gwen', { today: TODAY, currentQuarter: '2026-Q4' }))));
await t('… not to a day that hasn’t begun (a clock running ahead)', assertFails(setDoc(doc(gwen, 'cadState/day'), ST('gwen', { today: TMRW, currentQuarter: '2026-Q4' }))));
await t('… not without the database’s time', assertFails(setDoc(doc(gwen, 'cadState/day'), { today: YDAY, currentQuarter: '2026-Q4', up: new Date(), upBy: 'gwen' })));
await t('… not in someone else’s name', assertFails(setDoc(doc(gwen, 'cadState/day'), ST('kaylee', { today: YDAY, currentQuarter: '2026-Q4' }))));
await t('… not with a made-up date', assertFails(setDoc(doc(gwen, 'cadState/day'), ST('gwen', { today: 'tomorrow', currentQuarter: '2026-Q4' }))));
await t('… not with extra fields', assertFails(setDoc(doc(gwen, 'cadState/day'), ST('gwen', { today: YDAY, currentQuarter: '2026-Q4', checklists: [] }))));
await t('keeps the out-of-office board', assertSucceeds(setDoc(doc(gwen, 'cadState/timeoff'), ST('gwen', { e: { to_1: { id: 'to_1', staffId: 's_gwen', date: '2026-10-26', scope: 'full' } } }), { merge: true })));
await t('… takes one off', assertSucceeds(setDoc(doc(gwen, 'cadState/timeoff'), ST('gwen', { e: { to_1: deleteField() } }), { merge: true })));
await t('can’t write some other cadState record', assertFails(setDoc(doc(gwen, 'cadState/other'), ST('gwen', { x: 1 }))));
await t('makes a list (stamped)', assertSucceeds(setDoc(doc(gwen, 'cadInst/x1'), inst('x1', ST('gwen')))));
await t('… not without the stamp', assertFails(setDoc(doc(gwen, 'cadInst/x2'), inst('x2'))));
await t('… not in someone else’s name', assertFails(setDoc(doc(gwen, 'cadInst/x2'), inst('x2', ST('kaylee')))));
await t('… not under another id', assertFails(setDoc(doc(gwen, 'cadInst/x2'), inst('x3', ST('gwen')))));
await t('… not with its items as a list', assertFails(setDoc(doc(gwen, 'cadInst/x2'), inst('x2', ST('gwen', { items: [{ itemId: 'it1' }] })))));
await t('ticks an item (one field)', assertSucceeds(updateDoc(doc(gwen, 'cadInst/x1'), 'items.it1.checked', true, 'up', serverTimestamp(), 'upBy', 'gwen')));
await t('… not without the stamp', assertFails(updateDoc(doc(gwen, 'cadInst/x1'), 'items.it1.checked', false)));
await t('… not with an unknown status', assertFails(updateDoc(doc(gwen, 'cadInst/x1'), ST('gwen', { status: 'hacked' }))));
await t('… not with an assignee that isn’t text', assertFails(updateDoc(doc(gwen, 'cadInst/x1'), ST('gwen', { assigneeId: { x: 1 } }))));
await t('… not onto another checklist', assertFails(updateDoc(doc(gwen, 'cadInst/x1'), ST('gwen', { checklistId: 'cl_2' }))));
await t('… not onto another day', assertFails(updateDoc(doc(gwen, 'cadInst/x1'), ST('gwen', { date: '2026-10-01' }))));
await t('certifies', assertSucceeds(updateDoc(doc(gwen, 'cadInst/x1'), ST('gwen', { status: 'certified', certifiedBy: 's_gwen', certifiedAt: '8:01a' }))));
await t('can’t un-certify it', assertFails(updateDoc(doc(gwen, 'cadInst/x1'), ST('gwen', { certifiedAt: null, certifiedBy: null }))));
await t('… may set it back to re-work (a failed inspection)', assertSucceeds(updateDoc(doc(gwen, 'cadInst/x1'), ST('gwen', { status: 'in-progress' }))));
await t('takes off a list still to do', assertSucceeds(deleteDoc(doc(gwen, 'cadInst/iPend'))));
await t('… or in progress', assertSucceeds(deleteDoc(doc(gwen, 'cadInst/iProg'))));
await t('… or one that’s already gone', assertSucceeds(deleteDoc(doc(gwen, 'cadInst/nope'))));
await t('can’t take off a certified list', assertFails(deleteDoc(doc(gwen, 'cadInst/iCert'))));
await t('can’t take off a failed one', assertFails(deleteDoc(doc(gwen, 'cadInst/iFail'))));
await t('can’t take off the one she certified, even back in progress', assertFails(deleteDoc(doc(gwen, 'cadInst/x1'))));
const aud = (id, x) => Object.assign({ id, tone: 'success', actor: 'Gwen Rodis', message: '<b>Gwen Rodis</b> certified <b>Opening</b>', detail: '8:01a · on time', at: '8:01a', t0: Date.now(), ts: serverTimestamp(), by: 'gwen' }, x || {});
await t('adds to the activity log', assertSucceeds(setDoc(doc(gwen, 'cadAudit/aud_g1'), aud('aud_g1'))));
await t('… not in someone else’s name', assertFails(setDoc(doc(gwen, 'cadAudit/aud_g2'), aud('aud_g2', { by: 'kaylee' }))));
await t('… not with a made-up time', assertFails(setDoc(doc(gwen, 'cadAudit/aud_g2'), aud('aud_g2', { ts: new Date() }))));
await t('… not with extra fields', assertFails(setDoc(doc(gwen, 'cadAudit/aud_g2'), aud('aud_g2', { evil: 1 }))));
await t('… not under another id', assertFails(setDoc(doc(gwen, 'cadAudit/aud_g2'), aud('aud_g3'))));
await t('… not with a detail that isn’t text (it would break the log screen)', assertFails(setDoc(doc(gwen, 'cadAudit/aud_g2'), aud('aud_g2', { detail: { x: 1 } }))));
await t('… not with a name that isn’t text', assertFails(setDoc(doc(gwen, 'cadAudit/aud_g2'), aud('aud_g2', { actor: ['x'] }))));
await t('… dated by a device whose clock runs a few minutes fast', assertSucceeds(setDoc(doc(gwen, 'cadAudit/aud_g3'), aud('aud_g3', { t0: Date.now() + 5 * 6e4 }))));
await t('… not dated days ahead (it would sit on top of the log)', assertFails(setDoc(doc(gwen, 'cadAudit/aud_g2'), aud('aud_g2', { t0: Date.now() + 2 * 864e5 }))));
await t('can’t change an entry', assertFails(updateDoc(doc(gwen, 'cadAudit/aud_1'), { message: 'changed' })));
await t('can’t overwrite an entry', assertFails(setDoc(doc(gwen, 'cadAudit/aud_1'), aud('aud_1'))));
await t('can’t delete an entry', assertFails(deleteDoc(doc(gwen, 'cadAudit/aud_1'))));
await t('can’t write the roster mirror', assertFails(setDoc(doc(gwen, 'cadMirror/roster'), ST('gwen', { people: [] }))));
await t('can’t write Time Off’s feed key', assertFails(setDoc(doc(gwen, 'cadMirror/tofeed'), ST('gwen', { key: 'x' }))));
await t('can’t flip the move marker', assertFails(setDoc(doc(gwen, 'cadMeta/moved'), { on: false, at: serverTimestamp() })));
await t('can’t pause the screens', assertFails(setDoc(doc(gwen, 'cadMeta/moved'), { on: true, pause: true, at: serverTimestamp() })));
await t('can’t write the move info', assertFails(setDoc(doc(gwen, 'cadMeta/info'), ST('gwen', { counts: {} }))));
// a day's lists in one go (a batch of 450, then the roll as a transaction): the rules' lookups stay inside Firestore's limits
await t('saves 450 lists in one batch', (async () => { const b = writeBatch(gwen); for (let i = 0; i < 450; i++) b.set(doc(gwen, 'cadInst/b' + i), inst('b' + i, ST('gwen'))); await assertSucceeds(b.commit()); })());
await t('rolls the day with its lists and log entry in one transaction', assertSucceeds(runTransaction(gwen, async tx => {
  const d = await tx.get(doc(gwen, 'cadState/day'));
  if (!d.exists()) throw new Error('no day');
  tx.set(doc(gwen, 'cadState/day'), ST('gwen', { today: TODAY, currentQuarter: '2026-Q4' }));
  for (let i = 0; i < 40; i++) tx.set(doc(gwen, 'cadInst/r' + i), inst('r' + i, ST('gwen', { date: TODAY })));
  tx.set(doc(gwen, 'cadAudit/aud_roll'), aud('aud_roll', { actor: 'System', message: '<b>System</b> rolled the day to <b>' + TODAY + '</b>' }));
})));

console.log('Dr. A (the NLO Cases owner)');
await t('changes the setup', assertSucceeds(setDoc(doc(owner, 'cadState/config'), ST('amir', { checklists: [{ id: 'cl_1', name: 'Opening' }], staff: [], roles: [] }), { merge: true })));
await t('… stamped (not without)', assertFails(setDoc(doc(owner, 'cadState/config'), { checklists: [] }, { merge: true })));
await t('writes the mirrors', assertSucceeds(setDoc(doc(owner, 'cadMirror/roster'), ST('amir', { people: [{ id: 's_gwen', name: 'Gwen Rodis' }] }))));
await t('… only the three it has', assertFails(setDoc(doc(owner, 'cadMirror/other'), ST('amir', { x: 1 }))));
await t('takes off a certified list', assertSucceeds(deleteDoc(doc(owner, 'cadInst/iCert'))));
await t('… and one certified earlier (back in progress)', assertSucceeds(deleteDoc(doc(owner, 'cadInst/x1'))));
await t('pauses the screens for the move', assertSucceeds(setDoc(doc(owner, 'cadMeta/moved'), { on: false, pause: true, at: serverTimestamp() })));
await t('flips the move marker', assertSucceeds(setDoc(doc(owner, 'cadMeta/moved'), { on: true, at: serverTimestamp() })));
await t('… holding nothing else', assertFails(setDoc(doc(owner, 'cadMeta/moved'), { on: true, at: serverTimestamp(), by: 'amir' })));
await t('… with the database’s time', assertFails(setDoc(doc(owner, 'cadMeta/moved'), { on: true, at: new Date() })));
await t('writes the move info', assertSucceeds(setDoc(doc(owner, 'cadMeta/info'), ST('amir', { counts: { inst: 3 } }))));
await t('can’t delete the move marker', assertFails(deleteDoc(doc(owner, 'cadMeta/moved'))));
await t('can’t delete the setup', assertFails(deleteDoc(doc(owner, 'cadState/config'))));
await t('can’t change the activity log either', assertFails(updateDoc(doc(owner, 'cadAudit/aud_1'), { message: 'x' })));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
