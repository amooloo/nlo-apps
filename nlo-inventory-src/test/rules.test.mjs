// Security rules for NLO Inventory (the same rules file as NLO Cases, Leads, A/R, Time Off and the Time Clock): every write
// Inventory makes, and what someone else would try — a coworker going beyond their part, someone who left, a stranger with a
// login of their own, the alert script going beyond reading and clearing alerts. Made-up people only. Run inside the emulators:
//   python3 build.py && npx firebase emulators:exec --only firestore --project demo-nlo-cases "node test/rules.test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, increment, Timestamp, deleteField } from 'firebase/firestore';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
async function t(name, p, expectOk) {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const ok = (n, p) => t(n, p, true), no = (n, p) => t(n, p, false);
const is = (name, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + name + (c ? '' : ' :: ' + JSON.stringify(extra))); };
const env = await initializeTestEnvironment({ projectId: 'demo-nlo-cases', firestore: { rules: readFileSync('dist/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
const as = uid => env.authenticatedContext(uid, { email: uid + '@example.com', email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
// people: Dr. A (owner), Sarah (ticked in Settings: changes settings), Gwen and Kim (assistants), Lee (left), a stranger
// with a login of their own, and the alert script's login
const SID = { owner: 'amir', fc: 'sarah', ca: 'gwen', ca2: 'kim', gone: 'lee' };

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore(), T = Timestamp.now();
    await setDoc(doc(db, 'meta/setup'), { owner: 'owner', at: T });
    await setDoc(doc(db, 'meta/keys'), { current: 1 });
    await setDoc(doc(db, 'meta/settings'), { idleMin: 10 });
    for (const [uid, role, active] of [['owner', 'owner', true], ['fc', 'staff', true], ['ca', 'staff', true], ['ca2', 'staff', true], ['gone', 'staff', false]]) {
      await setDoc(doc(db, 'members/' + uid), { staffId: SID[uid], role, active, name: SID[uid] });
      await setDoc(doc(db, 'roster/' + SID[uid]), { name: SID[uid], initials: 'X', role, active, username: SID[uid], gen: 0 });
    }
    await setDoc(doc(db, 'invBots/bot1'), { email: 'invbot@example.com', at: T });
    await setDoc(doc(db, 'invState/rev'), { n: 5, up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/settings'), { locations: ['Lab'], invAdmins: ['amir', 'sarah'], alertsOn: true, up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/budget'), { monthly: 8000, categories: {}, expenses: [], up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/ai'), { gemini: 'AIzaTEST', openai: '', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/cart'), { lines: [], up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invItems/ppe-1'), { id: 'ppe-1', name: 'Gloves SM', qty: 4, min: 2, cat: 'infection-control', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invOrders/order-1'), { id: 'order-1', vendor: 'SunSurgical', status: 'open', items: [], up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invOrders/order-2'), { id: 'order-2', vendor: 'SunSurgical', status: 'received', items: [], up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invVendors/v-1'), { id: 'v-1', name: 'Acme', acct: '', phone: '555', address: '1 Main St', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invLog/m2026-10'), { e: { a1: { id: 'a1', type: 'use', delta: -1 } }, up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invAlerts/al1'), { t: 'cart', at: 1, by: 'Gwen', lines: [], up: T, upBy: 'gwen' });
    await setDoc(doc(db, 'invPics/p1'), { m: 'image/jpeg', b: 'AAAA', kind: 'thumb', up: T, upBy: 'amir' });
  });
}
async function raw(path) { let d; await env.withSecurityRulesDisabled(async c => { const s = await getDoc(doc(c.firestore(), path)); d = s.exists() ? s.data() : null; }); return d; }
async function put(path, data) { await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), path), data); }); }

/* the way Inventory saves: the record(s) and the change counter, in one save */
const st = uid => ({ up: serverTimestamp(), upBy: SID[uid] || uid });
function save(db, uid, writes, opt) {
  opt = opt || {};
  const b = writeBatch(db);
  writes.forEach(([kind, path, data, o]) => {
    if (kind === 'set') b.set(doc(db, path), Object.assign({}, data, opt.noStamp ? {} : st(uid)), o || {});
    else if (kind === 'update') b.update(doc(db, path), Object.assign({}, data, opt.noStamp ? {} : st(uid)));
    else if (kind === 'delete') b.delete(doc(db, path));
  });
  if (!opt.noBump) b.set(doc(db, 'invState/rev'), Object.assign({ n: increment(opt.by || 1) }, st(uid)), { merge: true });
  return b.commit();
}

/* ---------- reading ---------- */
await seed();
for (const [who, db] of [['Gwen', as('ca')], ['Sarah', as('fc')], ['Dr. A', as('owner')]]) {
  await ok(who + ' reads the supplies', getDocs(collection(db, 'invItems')));
  await ok(who + ' reads the orders', getDocs(collection(db, 'invOrders')));
  await ok(who + ' reads the vendors', getDocs(collection(db, 'invVendors')));
  await ok(who + ' reads the activity log', getDocs(collection(db, 'invLog')));
  await ok(who + ' reads the cart', getDoc(doc(db, 'invState/cart')));
  await ok(who + ' reads the budget', getDoc(doc(db, 'invState/budget')));
  await ok(who + ' reads the settings', getDoc(doc(db, 'invState/settings')));
  await ok(who + ' reads the AI keys (to read packing slips)', getDoc(doc(db, 'invState/ai')));
  await ok(who + ' reads a photo', getDoc(doc(db, 'invPics/p1')));
  await ok(who + ' reads the rules marker', getDoc(doc(db, 'meta/rules_inv_1')));
  await ok(who + ' reads whether Inventory moved', getDoc(doc(db, 'invMeta/moved')));
}
await no('Gwen can’t read the alerts waiting to go', getDocs(collection(as('ca'), 'invAlerts')));
await no('Sarah can’t read the alerts waiting to go', getDoc(doc(as('fc'), 'invAlerts/al1')));
await ok('Dr. A reads the alerts waiting to go', getDocs(collection(as('owner'), 'invAlerts')));
await no('Gwen can’t list the alert script’s logins', getDocs(collection(as('ca'), 'invBots')));
await ok('Dr. A lists the alert script’s logins', getDocs(collection(as('owner'), 'invBots')));
for (const [who, db] of [['someone who left', as('gone')], ['a stranger with a login', as('stranger')], ['nobody signed in', anon()]]) {
  await no(who + ': no supplies', getDocs(collection(db, 'invItems')));
  await no(who + ': no orders', getDoc(doc(db, 'invOrders/order-1')));
  await no(who + ': no log', getDocs(collection(db, 'invLog')));
  await no(who + ': no cart', getDoc(doc(db, 'invState/cart')));
  await no(who + ': no AI keys', getDoc(doc(db, 'invState/ai')));
  await no(who + ': no photos', getDoc(doc(db, 'invPics/p1')));
  await no(who + ': no rules marker', getDoc(doc(db, 'meta/rules_inv_1')));
  await no(who + ': can’t add a supply', save(db, 'stranger', [['set', 'invItems/x1', { id: 'x1', name: 'X', qty: 1 }]]));
  await no(who + ': can’t add to the cart', save(db, 'stranger', [['set', 'invState/cart', { lines: [{ itemId: 'ppe-1', qty: 1 }] }]]));
}
// the alert script's login: reads what it copies and sends, nothing else
{
  const bot = as('bot1');
  await ok('script reads the supplies', getDocs(collection(bot, 'invItems')));
  await ok('script reads the orders', getDocs(collection(bot, 'invOrders')));
  await ok('script reads the log', getDocs(collection(bot, 'invLog')));
  await ok('script reads the budget', getDoc(doc(bot, 'invState/budget')));
  await ok('script reads the change counter', getDoc(doc(bot, 'invState/rev')));
  await ok('script reads the settings (alerts on?)', getDoc(doc(bot, 'invState/settings')));
  await ok('script reads the alerts', getDocs(collection(bot, 'invAlerts')));
  await ok('script reads the rules marker', getDoc(doc(bot, 'meta/rules_inv_1')));
  await ok('script reads its own login record', getDoc(doc(bot, 'invBots/bot1')));
  await no('script can’t read the AI keys', getDoc(doc(bot, 'invState/ai')));
  await no('script can’t read photos', getDoc(doc(bot, 'invPics/p1')));
  await no('script can’t read the people', getDocs(collection(bot, 'members')));
  await no('script can’t change a supply', updateDoc(doc(bot, 'invItems/ppe-1'), { qty: 99 }));
  await no('script can’t add an alert', setDoc(doc(bot, 'invAlerts/x'), { t: 'cart', up: serverTimestamp(), upBy: 'bot1' }));
  await ok('script clears an alert it sent', deleteDoc(doc(bot, 'invAlerts/al1')));
  await ok('script notes when it checked', setDoc(doc(bot, 'invBeat/bot1'), { at: serverTimestamp(), ver: '2', err: '', sent: 1, copied: 3 }));
  await no('script can’t note for another login', setDoc(doc(bot, 'invBeat/bot2'), { at: serverTimestamp(), ver: '2', err: '', sent: 1, copied: 3 }));
  await no('script can’t make itself another login', setDoc(doc(bot, 'invBots/bot9'), { email: 'x@example.com', at: serverTimestamp() }));
  await ok('Dr. A sees when the script checked', getDoc(doc(as('owner'), 'invBeat/bot1')));
  await no('Gwen doesn’t', getDoc(doc(as('ca'), 'invBeat/bot1')));
}

/* ---------- every write: who and when, and the change counter ---------- */
await seed();
{
  const g = as('ca');
  await ok('Gwen counts a supply (stamped, counter +1)', save(g, 'ca', [['update', 'invItems/ppe-1', { qty: 3 }]]));
  is('counter went 5 → 6', (await raw('invState/rev')).n === 6, await raw('invState/rev'));
  await no('…not without moving the counter', save(g, 'ca', [['update', 'invItems/ppe-1', { qty: 2 }]], { noBump: true }));
  await no('…not moving it by 2', save(g, 'ca', [['update', 'invItems/ppe-1', { qty: 2 }]], { by: 2 }));
  await no('…not without who and when', save(g, 'ca', [['update', 'invItems/ppe-1', { qty: 2 }]], { noStamp: true }));
  await no('…not in someone else’s name', (() => { const b = writeBatch(g); b.update(doc(g, 'invItems/ppe-1'), { qty: 2, up: serverTimestamp(), upBy: 'sarah' }); b.set(doc(g, 'invState/rev'), { n: increment(1), up: serverTimestamp(), upBy: 'gwen' }, { merge: true }); return b.commit(); })());
  await no('…not with a time of her own', (() => { const b = writeBatch(g); b.update(doc(g, 'invItems/ppe-1'), { qty: 2, up: Timestamp.fromMillis(Date.now() - 6e5), upBy: 'gwen' }); b.set(doc(g, 'invState/rev'), { n: increment(1), up: serverTimestamp(), upBy: 'gwen' }, { merge: true }); return b.commit(); })());
  await no('the counter can’t jump', setDoc(doc(g, 'invState/rev'), { n: 50, up: serverTimestamp(), upBy: 'gwen' }));
  await no('the counter can’t go back', setDoc(doc(g, 'invState/rev'), { n: 1, up: serverTimestamp(), upBy: 'gwen' }));
  await no('the counter can’t carry anything else', setDoc(doc(g, 'invState/rev'), { n: increment(1), up: serverTimestamp(), upBy: 'gwen', x: 1 }, { merge: true }));
  await no('the counter can’t be removed', deleteDoc(doc(g, 'invState/rev')));
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'invState/rev')); });
  await ok('a first save starts the counter at 1', save(g, 'ca', [['update', 'invItems/ppe-1', { qty: 2 }]]));
  is('counter is 1', (await raw('invState/rev')).n === 1, await raw('invState/rev'));
  // two saves at once (two computers): both count
  await ok('two computers at once: both go through', Promise.all([save(g, 'ca', [['update', 'invItems/ppe-1', { qty: 7 }]]), save(as('ca2'), 'ca2', [['set', 'invItems/x2', { id: 'x2', name: 'Cotton rolls', qty: 1 }]])]));
  is('counter is 3', (await raw('invState/rev')).n === 3, await raw('invState/rev'));
}

/* ---------- supplies ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  await ok('Gwen adds a supply', save(g, 'ca', [['set', 'invItems/custom-1', { id: 'custom-1', name: 'Cheek retractors', qty: 0, min: 2, createdBy: 'Gwen' }]]));
  await no('…its id has to match', save(g, 'ca', [['set', 'invItems/custom-2', { id: 'custom-3', name: 'X' }]]));
  await no('…not one already hidden', save(g, 'ca', [['set', 'invItems/custom-4', { id: 'custom-4', name: 'X', deleted: true }]]));
  await no('…not one already archived', save(g, 'ca', [['set', 'invItems/custom-5', { id: 'custom-5', name: 'X', archived: true }]]));
  await ok('Gwen edits a supply (name, prices, bought by the case)', save(g, 'ca', [['update', 'invItems/ppe-1', { name: 'Gloves — SM', buyUnit: 'case', perBuy: 10, sources: [{ vendor: 'SunSurgical', price: 9.1 }] }]]));
  await no('Gwen can’t archive a supply', save(g, 'ca', [['update', 'invItems/ppe-1', { archived: true, archivedBy: 'Gwen' }]]));
  await no('Gwen can’t delete (hide) a supply', save(g, 'ca', [['update', 'invItems/ppe-1', { deleted: true }]]));
  await ok('Sarah (ticked) archives it', save(s, 'fc', [['update', 'invItems/ppe-1', { archived: true, archivedBy: 'Sarah' }]]));
  await ok('Dr. A deletes (hides) one', save(a, 'owner', [['update', 'invItems/custom-1', { deleted: true, deletedBy: 'Dr. A' }]]));
  await ok('Dr. A can add one already hidden (the move from the old database)', save(a, 'owner', [['set', 'invItems/old-9', { id: 'old-9', name: 'Old', deleted: true }]]));
  await no('nobody removes a supply for good', save(a, 'owner', [['delete', 'invItems/custom-1']]));
  await no('a supply with too many fields', save(g, 'ca', [['set', 'invItems/big', Object.assign({ id: 'big' }, Object.fromEntries(Array.from({ length: 130 }, (_, i) => ['f' + i, i])))]]));
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'invState/settings'), { invAdmins: ['amir'], up: Timestamp.now(), upBy: 'amir' }); });
  await no('Sarah, no longer ticked, can’t archive', save(s, 'fc', [['update', 'invItems/ppe-1', { archived: false }]]));
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'invState/settings')); });
  await no('with no settings yet, only Dr. A archives', save(s, 'fc', [['update', 'invItems/ppe-1', { archived: false }]]));
  await ok('…Dr. A does', save(a, 'owner', [['update', 'invItems/ppe-1', { archived: false }]]));
}

/* ---------- orders ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  await ok('Gwen places an order (open)', save(g, 'ca', [['set', 'invOrders/order-9', { id: 'order-9', vendor: 'Henry Schein', status: 'open', items: [{ itemId: 'ppe-1', qty: 2 }], orderedBy: 'Gwen' }]]));
  await ok('…files one already received (a packing slip with no order)', save(g, 'ca', [['set', 'invOrders/order-10', { id: 'order-10', status: 'received', items: [] }]]));
  await no('…not a voided one', save(g, 'ca', [['set', 'invOrders/order-11', { id: 'order-11', status: 'voided', items: [] }]]));
  await no('…not under another id', save(g, 'ca', [['set', 'invOrders/order-12', { id: 'order-13', status: 'open', items: [] }]]));
  await ok('Gwen marks it backordered', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'backordered' }]]));
  await ok('…and back', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'open' }]]));
  await ok('Gwen receives it', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'received', receivedBy: 'Gwen' }]]));
  await ok('…and fills in what came (status unchanged)', save(g, 'ca', [['update', 'invOrders/order-1', { items: [{ itemId: 'ppe-1', qty: 2, price: 9 }], invoiceNumber: 'INV-1' }]]));
  await no('Gwen can’t reopen a received order', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'open' }]]));
  await no('Gwen can’t void an order', save(g, 'ca', [['update', 'invOrders/order-9', { status: 'voided' }]]));
  await no('…or make up a status', save(g, 'ca', [['update', 'invOrders/order-9', { status: 'lost' }]]));
  await ok('Sarah (ticked) reopens it', save(s, 'fc', [['update', 'invOrders/order-1', { status: 'open' }]]));
  await ok('Sarah voids one', save(s, 'fc', [['update', 'invOrders/order-9', { status: 'voided' }]]));
  await ok('Dr. A files an old order as it was (the move)', save(a, 'owner', [['set', 'invOrders/old-1', { id: 'old-1', status: 'voided', items: [] }]]));
  await no('nobody deletes an order', save(a, 'owner', [['delete', 'invOrders/order-2']]));
}

/* ---------- vendors ---------- */
await seed();
{
  const g = as('ca'), s = as('fc');
  await ok('Gwen adds a vendor (typed on a supply)', save(g, 'ca', [['set', 'invVendors/v-9', { id: 'v-9', name: 'Amazon', acct: null, phone: null }]]));
  await no('…not a removed one', save(g, 'ca', [['set', 'invVendors/v-10', { id: 'v-10', name: 'X', deleted: true }]]));
  await ok('a packing slip fills in a missing account number', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', acct: '12345' }, { merge: true }]]));
  await no('…but doesn’t change one already there', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', acct: '99999' }, { merge: true }]]));
  await no('…or an address already there', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', address: '9 Elm St' }, { merge: true }]]));
  await no('Gwen can’t change a vendor’s phone', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', phone: '666' }, { merge: true }]]));
  await no('Gwen can’t remove a vendor', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', deleted: true }, { merge: true }]]));
  await ok('a built-in vendor gets its first saved account number (a new record)', save(g, 'ca', [['set', 'invVendors/henry-schein', { id: 'henry-schein', acct: '555' }, { merge: true }]]));
  await ok('Sarah (ticked) changes a vendor', save(s, 'fc', [['set', 'invVendors/v-1', { id: 'v-1', phone: '777', rep: 'Pat' }, { merge: true }]]));
  await ok('Sarah removes one (a flag)', save(s, 'fc', [['set', 'invVendors/v-9', { id: 'v-9', deleted: true }, { merge: true }]]));
  await no('nobody deletes a vendor record', save(s, 'fc', [['delete', 'invVendors/v-1']]));
}

/* ---------- the activity log: only grows ---------- */
await seed();
{
  const g = as('ca'), a = as('owner');
  const e = id => ({ id, date: new Date().toISOString(), by: 'Gwen', byId: 'gwen', type: 'use', delta: -1, itemId: 'ppe-1' });
  await ok('Gwen adds an entry to this month', save(g, 'ca', [['set', 'invLog/m2026-10', { e: { b1: e('b1') } }, { merge: true }]]));
  is('…the month keeps both', Object.keys((await raw('invLog/m2026-10')).e).sort().join() === 'a1,b1', await raw('invLog/m2026-10'));
  await ok('…starts a new month', save(g, 'ca', [['set', 'invLog/m2026-11', { e: { c1: e('c1') } }, { merge: true }]]));
  await ok('…adds to two months in one save (a receipt and its reversal)', save(g, 'ca', [['set', 'invLog/m2026-10', { e: { d1: e('d1') } }, { merge: true }], ['set', 'invLog/m2026-11', { e: { d2: e('d2') } }, { merge: true }]]));
  await no('…can’t change an entry', save(g, 'ca', [['set', 'invLog/m2026-10', { e: { a1: e('a1') } }, { merge: true }]]));
  await no('…can’t remove one', save(g, 'ca', [['update', 'invLog/m2026-10', { 'e.a1': deleteField() }]]));
  await no('Dr. A can’t either', save(a, 'owner', [['update', 'invLog/m2026-10', { 'e.a1': deleteField() }]]));
  await no('…or replace the month', save(a, 'owner', [['set', 'invLog/m2026-10', { e: { z: e('z') } }]]));
  await no('a month has to be named m<year>-<month>', save(g, 'ca', [['set', 'invLog/october', { e: { x: e('x') } }, { merge: true }]]));
  await no('nothing else in a month', save(g, 'ca', [['set', 'invLog/m2026-12', { e: { x: e('x') }, note: 'hi' }, { merge: true }]]));
  await no('nobody deletes a month', save(a, 'owner', [['delete', 'invLog/m2026-10']]));
}

/* ---------- the cart, prices, the bracket order ---------- */
await seed();
{
  const g = as('ca');
  await ok('Gwen changes the cart', save(g, 'ca', [['set', 'invState/cart', { lines: [{ itemId: 'ppe-1', qty: 2, addedBy: 'Gwen' }] }]]));
  await no('…it’s a list', save(g, 'ca', [['set', 'invState/cart', { lines: { a: 1 } }]]));
  await no('…and nothing else', save(g, 'ca', [['set', 'invState/cart', { lines: [], note: 'x' }]]));
  await ok('Gwen saves an elastic’s price', save(g, 'ca', [['set', 'invState/prices', { p: { '854-100': { price: 3.1, date: '2026-10-16' } } }, { merge: true }]]));
  await ok('Gwen saves the bracket order', save(g, 'ca', [['set', 'invState/bracket', { v: { teeth: { 'UR1': 2 } } }]]));
  await no('nobody deletes the cart', save(g, 'ca', [['delete', 'invState/cart']]));
  await no('an unknown state record', save(g, 'ca', [['set', 'invState/other', { x: 1 }]]));
}

/* ---------- the budget ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  await ok('Gwen adds an expense', save(g, 'ca', [['set', 'invState/budget', { expenses: [{ id: 'x1', amount: 12.5, by: 'Gwen' }] }, { merge: true }]]));
  await no('Gwen can’t change the monthly budget', save(g, 'ca', [['set', 'invState/budget', { monthly: 20000 }, { merge: true }]]));
  await no('…or the categories', save(g, 'ca', [['set', 'invState/budget', { categories: { misc: 1 } }, { merge: true }]]));
  await ok('Sarah (ticked) changes the budget', save(s, 'fc', [['set', 'invState/budget', { monthly: 9000, categories: { misc: 500 }, changedBy: 'Sarah' }, { merge: true }]]));
  await no('…nothing else goes in it', save(s, 'fc', [['set', 'invState/budget', { note: 'x' }, { merge: true }]]));
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'invState/budget')); });
  await no('Gwen can’t start the budget', save(g, 'ca', [['set', 'invState/budget', { expenses: [] }]]));
  await ok('Dr. A starts it (the move)', save(a, 'owner', [['set', 'invState/budget', { monthly: 8000, categories: {}, expenses: [], history: [] }]]));
}

/* ---------- settings and the AI keys ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  await ok('Sarah (ticked) adds a storage location', save(s, 'fc', [['set', 'invState/settings', { locations: ['Lab', 'Sterilization'] }, { merge: true }]]));
  await no('Gwen can’t', save(g, 'ca', [['set', 'invState/settings', { locations: ['X'] }, { merge: true }]]));
  await no('Sarah can’t change who changes settings', save(s, 'fc', [['set', 'invState/settings', { invAdmins: ['amir', 'sarah', 'gwen'] }, { merge: true }]]));
  await no('…or the alert switch', save(s, 'fc', [['set', 'invState/settings', { alertsOn: false }, { merge: true }]]));
  await no('…or where packing slips are read', save(s, 'fc', [['set', 'invState/settings', { geminiProxyUrl: 'https://evil.example' }, { merge: true }]]));
  await ok('Dr. A changes who changes settings', save(a, 'owner', [['set', 'invState/settings', { invAdmins: ['amir', 'gwen'] }, { merge: true }]]));
  await ok('…now Gwen adds a location', save(g, 'ca', [['set', 'invState/settings', { locations: ['Lab', 'Front'] }, { merge: true }]]));
  await no('…and Sarah can’t', save(s, 'fc', [['set', 'invState/settings', { locations: ['Lab'] }, { merge: true }]]));
  await ok('Dr. A turns the alerts off', save(a, 'owner', [['set', 'invState/settings', { alertsOn: false }, { merge: true }]]));
  await no('nothing else goes in the settings', save(a, 'owner', [['set', 'invState/settings', { other: 1 }, { merge: true }]]));
  await no('Gwen can’t set the AI keys', save(g, 'ca', [['set', 'invState/ai', { gemini: 'AIzaEVIL' }, { merge: true }]]));
  await no('Sarah can’t either', save(s, 'fc', [['set', 'invState/ai', { gemini: 'AIzaEVIL' }, { merge: true }]]));
  await ok('Dr. A sets them', save(a, 'owner', [['set', 'invState/ai', { gemini: 'AIzaNEW', openai: 'sk-x' }, { merge: true }]]));
  await no('…nothing else in them', save(a, 'owner', [['set', 'invState/ai', { other: 'x' }, { merge: true }]]));
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'invState/settings')); });
  await no('only Dr. A starts the settings', save(s, 'fc', [['set', 'invState/settings', { locations: [] }]]));
  await ok('…Dr. A does', save(a, 'owner', [['set', 'invState/settings', { locations: [], invAdmins: ['amir'], alertsOn: true }]]));
}

/* ---------- alerts, photos ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  await ok('Gwen’s cart add leaves an alert', save(g, 'ca', [['set', 'invAlerts/al2', { t: 'cart', at: Date.now(), by: 'Gwen', lines: [{ n: 'Gloves', q: 2 }], inCart: 3 }]]));
  for (const tt of ['ordered', 'reopened', 'received']) await ok('…an alert: ' + tt, save(g, 'ca', [['set', 'invAlerts/al-' + tt, { t: tt, at: Date.now(), by: 'Gwen', lines: [] }]]));
  await no('…not a made-up kind', save(g, 'ca', [['set', 'invAlerts/al3', { t: 'spam', at: Date.now() }]]));
  await no('…not a huge one', save(g, 'ca', [['set', 'invAlerts/al4', Object.assign({ t: 'cart' }, Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['f' + i, i])))]]));
  await no('Gwen can’t take one back', deleteDoc(doc(g, 'invAlerts/al2')));
  await no('…or change it', save(g, 'ca', [['set', 'invAlerts/al2', { t: 'cart', by: 'Someone else' }]]));
  await ok('Dr. A can clear one', deleteDoc(doc(a, 'invAlerts/al2')));
  await ok('Gwen saves a photo', save(g, 'ca', [['set', 'invPics/p2', { m: 'image/webp', b: 'UklGRg==', kind: 'thumb' }]]));
  await no('…only a picture', save(g, 'ca', [['set', 'invPics/p3', { m: 'text/html', b: 'PHNjcmlwdD4=', kind: 'thumb' }]]));
  await no('…not over the size', save(g, 'ca', [['set', 'invPics/p4', { m: 'image/jpeg', b: 'A'.repeat(1000001), kind: 'full' }]]));
  await no('…photos aren’t changed', save(g, 'ca', [['set', 'invPics/p2', { m: 'image/webp', b: 'AAAA', kind: 'thumb' }]]));
  await no('Gwen can’t delete a photo', deleteDoc(doc(g, 'invPics/p1')));
  await ok('Sarah (ticked) removes an old slip photo', deleteDoc(doc(s, 'invPics/p1')));
}

/* ---------- the move, the script's login ---------- */
await seed();
{
  const g = as('ca'), a = as('owner');
  await no('Gwen can’t mark Inventory moved', save(g, 'ca', [['set', 'invMeta/moved', { at: Date.now(), counts: { items: 1 } }]]));
  await ok('Dr. A marks it moved', save(a, 'owner', [['set', 'invMeta/moved', { at: Date.now(), counts: { items: 1 } }]]));
  await no('…once', save(a, 'owner', [['set', 'invMeta/moved', { at: Date.now(), counts: { items: 2 } }]]));
  await no('…and it stays', deleteDoc(doc(a, 'invMeta/moved')));
  await no('Gwen can’t make the script a login', setDoc(doc(g, 'invBots/gwenbot'), { email: 'g@example.com', at: serverTimestamp() }));
  await ok('Dr. A makes the script a login', setDoc(doc(a, 'invBots/bot2'), { email: 'inv-alerts-1@example.com', at: serverTimestamp() }));
  await ok('…and removes an older one', deleteDoc(doc(a, 'invBots/bot1')));
  await no('the removed login reads nothing now', getDocs(collection(as('bot1'), 'invItems')));
  await ok('the new one does', getDocs(collection(as('bot2'), 'invItems')));
}

/* ---------- the move's big saves stay inside the database's limits ---------- */
await seed();
{
  const a = as('owner');
  const writes = [];
  for (let i = 0; i < 150; i++) writes.push(['set', 'invItems/m-' + i, { id: 'm-' + i, name: 'Supply ' + i, qty: i, sources: [{ vendor: 'Acme', price: 1 }] }]);
  for (let i = 0; i < 100; i++) writes.push(['set', 'invOrders/mo-' + i, { id: 'mo-' + i, status: i % 3 ? 'received' : 'open', items: [{ itemId: 'm-' + i, qty: 1 }] }]);
  for (let i = 0; i < 24; i++) writes.push(['set', 'invLog/m2025-' + String(1 + (i % 12)).padStart(2, '0') + (i < 12 ? '' : 'x'), { e: { ['e' + i]: { id: 'e' + i } } }]);
  await no('(a month name with extra letters is refused even in a big save)', save(a, 'owner', writes));
  writes.splice(250);
  for (let i = 0; i < 12; i++) writes.push(['set', 'invLog/m2025-' + String(1 + i).padStart(2, '0'), { e: { ['e' + i]: { id: 'e' + i } } }]);
  for (let i = 0; i < 30; i++) writes.push(['set', 'invVendors/mv-' + i, { id: 'mv-' + i, name: 'Vendor ' + i }]);
  writes.push(['set', 'invState/cart', { lines: [] }], ['set', 'invState/budget', { monthly: 8000, categories: {}, expenses: [], history: [] }], ['set', 'invState/prices', { p: {} }]);
  await ok('Dr. A saves 295 records in one go (the move)', save(a, 'owner', writes));
  is('…all there', (await getDocs(collection(a, 'invItems'))).size === 151 && (await getDocs(collection(a, 'invOrders'))).size === 102, '');
  const big = []; for (let i = 0; i < 450; i++) big.push(['set', 'invItems/b-' + i, { id: 'b-' + i, name: 'S' + i }]);
  await ok('…and 450 supplies in one go', save(a, 'owner', big));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await env.cleanup();
process.exit(fail ? 1 : 0);
