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
// people: Dr. A (owner: the only one who changes settings and OKs the cart), Sarah (the office coordinator — on the old app's
// list of people who changed settings, which means nothing now), Gwen and Kim (assistants), Lee (left), a stranger with a
// login of their own, and the alert script's login
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
      await setDoc(doc(db, 'roster/' + SID[uid]), Object.assign({ name: SID[uid], initials: 'X', role, active, username: SID[uid], gen: 0 }, uid === 'ca2' ? { rid: 's_kim' } : {}));
    }
    await setDoc(doc(db, 'invBots/bot1'), { email: 'invbot@example.com', at: T });
    await setDoc(doc(db, 'invState/rev'), { n: 5, up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/settings'), { locations: ['Lab'], invAdmins: ['amir', 'sarah'], alertsOn: true, up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/budget'), { monthly: 8000, categories: {}, up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invExpenses/x1'), { id: 'x1', date: '2026-10-01', amount: 12.5, category: 'misc', vendor: 'Walmart', by: 'Kim', byId: 'kim', up: T, upBy: 'kim' });
    await setDoc(doc(db, 'invExpenses/x-old'), { id: 'x-old', date: '2026-09-01', amount: 40, category: 'misc', by: 'Kim', byId: 's_kim', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/ai'), { gemini: 'AIzaTEST', openai: '', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/cart'), { lines: [], up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invState/push'), { topic: 'nlo-inv-test1', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invItems/ppe-1'), { id: 'ppe-1', name: 'Gloves SM', qty: 4, min: 2, cat: 'infection-control', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invOrders/order-1'), { id: 'order-1', vendor: 'SunSurgical', status: 'open', items: [], orderedById: 'sarah', trail: [{ t: 'ordered', by: 'Sarah', byId: 'sarah', at: '2026-10-01T10:00:00Z' }], up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invOrders/order-2'), { id: 'order-2', vendor: 'SunSurgical', status: 'received', items: [{ itemId: 'ppe-1', qty: 2, price: 9 }], discount: 1, shipping: 5, receivedById: 'sarah', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invVendors/v-1'), { id: 'v-1', name: 'Acme', acct: '', phone: '555', address: '1 Main St', up: T, upBy: 'amir' });
    await setDoc(doc(db, 'invLog/m2026-10~gwen'), { e: { a1: { id: 'a1', type: 'use', delta: -1, byId: 'gwen' } }, mon: '2026-10', who: 'gwen', up: T, upBy: 'gwen' });
    await setDoc(doc(db, 'invLog/m2026-10~old'), { e: { o1: { id: 'o1', type: 'receive', amount: 10, byId: 's_kim' } }, mon: '2026-10', who: 'old', up: T, upBy: 'amir' });
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
  await ok(who + ' reads the expenses', getDocs(collection(db, 'invExpenses')));
  await ok(who + ' reads the settings', getDoc(doc(db, 'invState/settings')));
  await ok(who + ' reads the AI keys (to read packing slips)', getDoc(doc(db, 'invState/ai')));
  await ok(who + ' reads a photo', getDoc(doc(db, 'invPics/p1')));
  await ok(who + ' reads the rules marker', getDoc(doc(db, 'meta/rules_inv_1')));
  await ok(who + ' reads whether Inventory moved', getDoc(doc(db, 'invMeta/moved')));
}
await no('Gwen can’t read the alerts waiting to go', getDocs(collection(as('ca'), 'invAlerts')));
await no('Gwen can’t read Dr. A’s phone-push topic', getDoc(doc(as('ca'), 'invState/push')));
await no('…nor Sarah', getDoc(doc(as('fc'), 'invState/push')));
await ok('Dr. A reads it', getDoc(doc(as('owner'), 'invState/push')));
await no('Sarah can’t read the alerts waiting to go', getDoc(doc(as('fc'), 'invAlerts/al1')));
await ok('Dr. A reads the alerts waiting to go', getDocs(collection(as('owner'), 'invAlerts')));
await no('Gwen can’t list the alert script’s logins', getDocs(collection(as('ca'), 'invBots')));
await ok('Dr. A lists the alert script’s logins', getDocs(collection(as('owner'), 'invBots')));
for (const [who, db] of [['someone who left', as('gone')], ['a stranger with a login', as('stranger')], ['nobody signed in', anon()]]) {
  await no(who + ': no supplies', getDocs(collection(db, 'invItems')));
  await no(who + ': no orders', getDoc(doc(db, 'invOrders/order-1')));
  await no(who + ': no log', getDocs(collection(db, 'invLog')));
  await no(who + ': no cart', getDoc(doc(db, 'invState/cart')));
  await no(who + ': no expenses', getDocs(collection(db, 'invExpenses')));
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
  await ok('script reads the expenses', getDocs(collection(bot, 'invExpenses')));
  await ok('script reads the change counter', getDoc(doc(bot, 'invState/rev')));
  await ok('script reads the settings (alerts on?)', getDoc(doc(bot, 'invState/settings')));
  await ok('script reads the alerts', getDocs(collection(bot, 'invAlerts')));
  await ok('script reads the rules marker', getDoc(doc(bot, 'meta/rules_inv_1')));
  await ok('script reads its own login record', getDoc(doc(bot, 'invBots/bot1')));
  await ok('script reads the AI keys (to copy them where Staff Meeting and Month-End read them)', getDoc(doc(bot, 'invState/ai')));
  await ok('script reads the phone-push topic', getDoc(doc(bot, 'invState/push')));
  await no('script can’t change it', setDoc(doc(bot, 'invState/push'), { topic: 'evil', up: serverTimestamp(), upBy: 'bot1' }));
  await no('script can’t change the AI keys', setDoc(doc(bot, 'invState/ai'), { gemini: 'x', up: serverTimestamp(), upBy: 'bot1' }));
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
  await no('Sarah can’t archive it either (on the old list or not: only Dr. A)', save(s, 'fc', [['update', 'invItems/ppe-1', { archived: true, archivedBy: 'Sarah' }]]));
  await ok('Dr. A archives it', save(a, 'owner', [['update', 'invItems/ppe-1', { archived: true, archivedBy: 'Dr. A' }]]));
  await ok('Dr. A deletes (hides) one', save(a, 'owner', [['update', 'invItems/custom-1', { deleted: true, deletedBy: 'Dr. A' }]]));
  await ok('Dr. A can add one already hidden (the move from the old database)', save(a, 'owner', [['set', 'invItems/old-9', { id: 'old-9', name: 'Old', deleted: true }]]));
  await no('nobody removes a supply for good', save(a, 'owner', [['delete', 'invItems/custom-1']]));
  await no('a supply with too many fields', save(g, 'ca', [['set', 'invItems/big', Object.assign({ id: 'big' }, Object.fromEntries(Array.from({ length: 130 }, (_, i) => ['f' + i, i])))]]));
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'invState/settings')); });
  await no('with no settings at all, Sarah still can’t bring it back', save(s, 'fc', [['update', 'invItems/ppe-1', { archived: false }]]));
  await ok('…Dr. A does', save(a, 'owner', [['update', 'invItems/ppe-1', { archived: false }]]));
}

/* ---------- orders ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  const step = (t, byId) => ({ t, by: byId, byId, at: new Date().toISOString() });
  await ok('Gwen places an order (open, in her name)', save(g, 'ca', [['set', 'invOrders/order-9', { id: 'order-9', vendor: 'Henry Schein', status: 'open', items: [{ itemId: 'ppe-1', qty: 2 }], orderedBy: 'Gwen', orderedById: 'gwen', trail: [step('ordered', 'gwen')] }]]));
  await no('…not in Sarah’s name', save(g, 'ca', [['set', 'invOrders/order-9b', { id: 'order-9b', status: 'open', items: [], orderedBy: 'Sarah', orderedById: 'sarah', trail: [step('ordered', 'gwen')] }]]));
  await no('…not with a step by Sarah', save(g, 'ca', [['set', 'invOrders/order-9c', { id: 'order-9c', status: 'open', items: [], orderedById: 'gwen', trail: [step('ordered', 'sarah')] }]]));
  await no('…not with a made-up history', save(g, 'ca', [['set', 'invOrders/order-9d', { id: 'order-9d', status: 'open', items: [], orderedById: 'gwen', trail: [step('ordered', 'sarah'), step('edited', 'gwen')] }]]));
  await ok('…the backorder for what didn’t come (ordered by whoever ordered the first one)', save(g, 'ca', [['set', 'invOrders/order-bo', { id: 'order-bo', status: 'open', items: [], orderedById: 'sarah', backorderOf: 'order-1', trail: [step('backorder', 'gwen')] }]]));
  await ok('…files one already received (a packing slip with no order)', save(g, 'ca', [['set', 'invOrders/order-10', { id: 'order-10', status: 'received', items: [], trail: [step('scanned', 'gwen')] }]]));
  await no('…not one with no step on it', save(g, 'ca', [['set', 'invOrders/order-10b', { id: 'order-10b', status: 'open', items: [], orderedBy: 'Sarah B.' }]]));
  await no('…not one already received in Kim’s name', save(g, 'ca', [['set', 'invOrders/order-10c', { id: 'order-10c', status: 'received', receivedById: 'kim', items: [], trail: [step('scanned', 'gwen')] }]]));
  await no('…not a voided one', save(g, 'ca', [['set', 'invOrders/order-11', { id: 'order-11', status: 'voided', items: [] }]]));
  await no('…not under another id', save(g, 'ca', [['set', 'invOrders/order-12', { id: 'order-13', status: 'open', items: [] }]]));
  const t1 = (await raw('invOrders/order-1')).trail;
  await ok('Gwen marks it backordered (her step on the trail)', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'backordered', trail: t1.concat([step('backordered', 'gwen')]) }]]));
  const t2 = (await raw('invOrders/order-1')).trail;
  await no('…not a step in Sarah’s name', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'open', trail: t2.concat([step('unbackordered', 'sarah')]) }]]));
  await no('…not changing a step already there', save(g, 'ca', [['update', 'invOrders/order-1', { trail: [Object.assign({}, t2[0], { byId: 'gwen' }), t2[1]] }]]));
  await no('…not dropping steps', save(g, 'ca', [['update', 'invOrders/order-1', { trail: [] }]]));
  await ok('…and back', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'open', trail: t2.concat([step('unbackordered', 'gwen')]) }]]));
  await no('Gwen can’t receive it in Kim’s name', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'received', receivedBy: 'Kim', receivedById: 'kim' }]]));
  const t3 = (await raw('invOrders/order-1')).trail;
  await no('…or with no id and no step of hers (a name typed in)', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'received', receivedBy: 'Sarah B.' }]]));
  await no('…or her id without her “received” step', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'received', receivedBy: 'Gwen', receivedById: 'gwen', trail: t3.concat([step('edited', 'gwen')]) }]]));
  await ok('Gwen receives it (the receipt in one step: who, what came, the trail)', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'received', receivedBy: 'Gwen', receivedById: 'gwen', items: [{ itemId: 'ppe-1', qty: 2, price: 9 }], discount: 1, trail: t3.concat([step('received', 'gwen')]) }]]));
  await ok('…and adds the paperwork after (invoice numbers, the slip photo)', save(g, 'ca', [['update', 'invOrders/order-1', { invoiceNumber: 'INV-1', invoiceTaxes: 1.2, slipPhoto: 'pic:p1' }]]));
  await no('…but changes its lines only with her step on the trail', save(g, 'ca', [['update', 'invOrders/order-1', { items: [{ itemId: 'ppe-1', qty: 2, price: 9.5 }] }]]));
  await ok('…prices from the invoice, with her step', save(g, 'ca', [['update', 'invOrders/order-1', { items: [{ itemId: 'ppe-1', qty: 2, price: 9.5 }], trail: (await raw('invOrders/order-1')).trail.concat([step('invoice', 'gwen')]) }]]));
  await no('…but not its discount', save(g, 'ca', [['update', 'invOrders/order-1', { discount: 0 }]]));
  await no('…or its shipping', save(g, 'ca', [['update', 'invOrders/order-1', { shipping: 0 }]]));
  await no('…or its vendor', save(g, 'ca', [['update', 'invOrders/order-1', { vendor: 'Someone else' }]]));
  await no('…or who received it', save(g, 'ca', [['update', 'invOrders/order-2', { receivedById: 'gwen', receivedBy: 'Gwen' }]]));
  await no('Gwen can’t reopen a received order', save(g, 'ca', [['update', 'invOrders/order-1', { status: 'open' }]]));
  await no('Gwen can’t void an order', save(g, 'ca', [['update', 'invOrders/order-9', { status: 'voided' }]]));
  await no('…or make up a status', save(g, 'ca', [['update', 'invOrders/order-9', { status: 'lost' }]]));
  const t4 = (await raw('invOrders/order-1')).trail;
  await no('Sarah can’t reopen it (only Dr. A)', save(s, 'fc', [['update', 'invOrders/order-1', { status: 'open', dateReceived: null, trail: t4.concat([step('reopened', 'sarah')]) }]]));
  await ok('Dr. A reopens it, his step on the trail', save(a, 'owner', [['update', 'invOrders/order-1', { status: 'open', dateReceived: null, trail: t4.concat([step('reopened', 'amir')]) }]]));
  await no('Sarah can’t change a received order’s numbers', save(s, 'fc', [['update', 'invOrders/order-2', { discount: 2, shipping: 6 }]]));
  await ok('…Dr. A does', save(a, 'owner', [['update', 'invOrders/order-2', { discount: 2, shipping: 6 }]]));
  await no('Sarah can’t void one', save(s, 'fc', [['update', 'invOrders/order-9', { status: 'voided', voidedById: 'sarah', trail: (await raw('invOrders/order-9')).trail.concat([step('voided', 'sarah')]) }]]));
  await ok('…Dr. A voids it', save(a, 'owner', [['update', 'invOrders/order-9', { status: 'voided', voidedById: 'amir', trail: (await raw('invOrders/order-9')).trail.concat([step('voided', 'amir')]) }]]));
  // a long trail: the oldest step drops off at 40
  const long = Array.from({ length: 40 }, (_, i) => step('edited', i % 2 ? 'sarah' : 'gwen'));
  await put('invOrders/order-long', { id: 'order-long', status: 'open', items: [], trail: long, up: Timestamp.now(), upBy: 'amir' });
  await ok('a trail of 40: the newest step goes on, the oldest drops off', save(g, 'ca', [['update', 'invOrders/order-long', { trail: long.slice(1).concat([step('edited', 'gwen')]) }]]));
  await ok('Dr. A files an old order as it was (the move: the old app’s stamps)', save(a, 'owner', [['set', 'invOrders/old-1', { id: 'old-1', status: 'voided', items: [], orderedById: 's_sarah', trail: [step('ordered', 's_sarah'), step('voided', 's_kim')] }]]));
  await no('nobody deletes an order', save(a, 'owner', [['delete', 'invOrders/order-2']]));
}

/* ---------- vendors ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  await ok('Gwen adds a vendor (typed on a supply: a new v-… record, its name)', save(g, 'ca', [['set', 'invVendors/v-9', { id: 'v-9', name: 'Amazon' }]]));
  await no('…not with a website', save(g, 'ca', [['set', 'invVendors/v-9b', { id: 'v-9b', name: 'Amazon', portal: 'https://example.com' }]]));
  await no('…or an order email or phone', save(g, 'ca', [['set', 'invVendors/v-9c', { id: 'v-9c', name: 'Amazon', email: 'orders@example.com', phone: '555' }]]));
  await no('…not a built-in vendor’s record with a website of its own', save(g, 'ca', [['set', 'invVendors/henry-schein', { id: 'henry-schein', portal: 'https://example.com/look-alike' }, { merge: true }]]));
  await no('…or a name of its own', save(g, 'ca', [['set', 'invVendors/henry-schein', { id: 'henry-schein', name: 'Henry Schein (new)' }, { merge: true }]]));
  await no('…not a removed one', save(g, 'ca', [['set', 'invVendors/v-10', { id: 'v-10', name: 'X', deleted: true }]]));
  await ok('a packing slip fills in a missing account number', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', acct: '12345' }, { merge: true }]]));
  await no('…but doesn’t change one already there', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', acct: '99999' }, { merge: true }]]));
  await no('…or an address already there', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', address: '9 Elm St' }, { merge: true }]]));
  await no('Gwen can’t change a vendor’s phone', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', phone: '666' }, { merge: true }]]));
  await no('Gwen can’t remove a vendor', save(g, 'ca', [['set', 'invVendors/v-1', { id: 'v-1', deleted: true }, { merge: true }]]));
  await ok('a built-in vendor gets its first saved account number (a new record)', save(g, 'ca', [['set', 'invVendors/henry-schein', { id: 'henry-schein', acct: '555' }, { merge: true }]]));
  await no('Sarah can’t change a vendor’s phone either', save(s, 'fc', [['set', 'invVendors/v-1', { id: 'v-1', phone: '777', rep: 'Pat' }, { merge: true }]]));
  await ok('Dr. A changes a vendor', save(a, 'owner', [['set', 'invVendors/v-1', { id: 'v-1', phone: '777', rep: 'Pat' }, { merge: true }]]));
  await no('Sarah can’t remove one', save(s, 'fc', [['set', 'invVendors/v-9', { id: 'v-9', deleted: true }, { merge: true }]]));
  await ok('Dr. A removes one (a flag)', save(a, 'owner', [['set', 'invVendors/v-9', { id: 'v-9', deleted: true }, { merge: true }]]));
  await no('nobody deletes a vendor record', save(a, 'owner', [['delete', 'invVendors/v-1']]));
}

/* ---------- the activity log: one record per person per month, only grows ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  const e = (id, byId) => ({ id, date: new Date().toISOString(), by: 'Gwen', byId: byId || 'gwen', type: 'use', delta: -1, itemId: 'ppe-1' });
  const rec = (mon, who, entries) => Object.assign({ e: entries, mon, who });
  await ok('Gwen adds an entry to her record for this month', save(g, 'ca', [['set', 'invLog/m2026-10~gwen', rec('2026-10', 'gwen', { b1: e('b1') }), { merge: true }]]));
  is('…her record keeps both', Object.keys((await raw('invLog/m2026-10~gwen')).e).sort().join() === 'a1,b1', await raw('invLog/m2026-10~gwen'));
  await ok('…starts her record for a new month', save(g, 'ca', [['set', 'invLog/m2026-11~gwen', rec('2026-11', 'gwen', { c1: e('c1') }), { merge: true }]]));
  await ok('…adds to two months in one save (a receipt and its reversal)', save(g, 'ca', [['set', 'invLog/m2026-10~gwen', rec('2026-10', 'gwen', { d1: e('d1') }), { merge: true }], ['set', 'invLog/m2026-11~gwen', rec('2026-11', 'gwen', { d2: e('d2') }), { merge: true }]]));
  await no('Gwen can’t add to Sarah’s record', save(g, 'ca', [['set', 'invLog/m2026-10~sarah', rec('2026-10', 'sarah', { f1: e('f1', 'sarah') }), { merge: true }]]));
  await no('…or start one in her name', save(g, 'ca', [['set', 'invLog/m2026-12~sarah', rec('2026-12', 'sarah', { f2: e('f2', 'sarah') }), { merge: true }]]));
  await no('…or add to the moved entries', save(g, 'ca', [['set', 'invLog/m2026-10~old', rec('2026-10', 'old', { f3: e('f3') }), { merge: true }]]));
  await no('…or name a record one thing and say it’s another’s', save(g, 'ca', [['set', 'invLog/m2026-10~gwen', rec('2026-10', 'sarah', { f4: e('f4') }), { merge: true }]]));
  await no('…or file it under another month', save(g, 'ca', [['set', 'invLog/m2026-10~gwen', rec('2026-09', 'gwen', { f5: e('f5') }), { merge: true }]]));
  await no('…can’t change an entry', save(g, 'ca', [['set', 'invLog/m2026-10~gwen', rec('2026-10', 'gwen', { a1: e('a1') }), { merge: true }]]));
  await no('…can’t remove one', save(g, 'ca', [['update', 'invLog/m2026-10~gwen', { 'e.a1': deleteField() }]]));
  await ok('Sarah adds to her own', save(s, 'fc', [['set', 'invLog/m2026-10~sarah', rec('2026-10', 'sarah', { s1: e('s1', 'sarah') }), { merge: true }]]));
  await no('Dr. A can’t remove an entry either', save(a, 'owner', [['update', 'invLog/m2026-10~gwen', { 'e.a1': deleteField() }]]));
  await no('…or replace a record', save(a, 'owner', [['set', 'invLog/m2026-10~gwen', rec('2026-10', 'gwen', { z: e('z') })]]));
  await ok('Dr. A adds the moved entries (the old app’s stamps, under old)', save(a, 'owner', [['set', 'invLog/m2026-10~old', rec('2026-10', 'old', { o2: e('o2', 's_kim') }), { merge: true }], ['set', 'invLog/m2026-10~old2', rec('2026-10', 'old2', { o3: e('o3', 's_kim') })]]));
  await no('a record has to be named m<year>-<month>~<who>', save(g, 'ca', [['set', 'invLog/october~gwen', rec('2026-10', 'gwen', { x: e('x') }), { merge: true }]]));
  await no('…its month a month', save(g, 'ca', [['set', 'invLog/m2026-1x~gwen', rec('2026-1x', 'gwen', { x: e('x') }), { merge: true }]]));
  await no('nothing else in a record', save(g, 'ca', [['set', 'invLog/m2026-12~gwen', Object.assign(rec('2026-12', 'gwen', { x: e('x') }), { note: 'hi' }), { merge: true }]]));
  await no('nobody deletes a record', save(a, 'owner', [['delete', 'invLog/m2026-10~gwen']]));
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

/* ---------- the budget and the expenses ---------- */
await seed();
{
  const g = as('ca'), k = as('ca2'), s = as('fc'), a = as('owner');
  const x = (id, byId, extra) => Object.assign({ id, date: '2026-10-16', amount: 12.5, category: 'misc', vendor: 'Walmart', note: 'Cups', by: 'Gwen', byId, addedAt: new Date().toISOString() }, extra || {});
  await ok('Gwen adds an expense, in her name', save(g, 'ca', [['set', 'invExpenses/x2', x('x2', 'gwen')]]));
  await no('…not in Kim’s', save(g, 'ca', [['set', 'invExpenses/x3', x('x3', 'kim')]]));
  await no('…not under another id', save(g, 'ca', [['set', 'invExpenses/x4', x('x5', 'gwen')]]));
  await no('…not a made-up amount', save(g, 'ca', [['set', 'invExpenses/x6', x('x6', 'gwen', { amount: 'lots' })]]));
  await no('…not a huge one', save(g, 'ca', [['set', 'invExpenses/x7', x('x7', 'gwen', { amount: 2e6 })]]));
  await no('…nothing else in it', save(g, 'ca', [['set', 'invExpenses/x8', x('x8', 'gwen', { other: 1 })]]));
  await no('…expenses aren’t changed (take one off and add it again)', save(g, 'ca', [['set', 'invExpenses/x2', x('x2', 'gwen', { amount: 1 })]]));
  await no('Gwen can’t take off Kim’s', save(g, 'ca', [['delete', 'invExpenses/x1']]));
  await no('…not without the change counter', save(g, 'ca', [['delete', 'invExpenses/x2']], { noBump: true }));
  await ok('…she takes off her own', save(g, 'ca', [['delete', 'invExpenses/x2']]));
  await ok('Kim takes off one the old app stamped with her Staff Hub id', save(k, 'ca2', [['delete', 'invExpenses/x-old']]));
  await no('Sarah can’t take off Kim’s', save(s, 'fc', [['delete', 'invExpenses/x1']]));
  await ok('Dr. A takes off anyone’s', save(a, 'owner', [['delete', 'invExpenses/x1']]));
  await ok('Dr. A adds the moved ones (the old app’s stamps, any shape)', save(a, 'owner', [['set', 'invExpenses/x9', { id: 'x9', amount: '12.40', by: 'Kim', category: 'misc' }]]));
  await no('Gwen can’t change the monthly budget', save(g, 'ca', [['set', 'invState/budget', { monthly: 20000 }, { merge: true }]]));
  await no('…or the categories', save(g, 'ca', [['set', 'invState/budget', { categories: { misc: 1 } }, { merge: true }]]));
  await no('…and expenses don’t go in the budget any more', save(s, 'fc', [['set', 'invState/budget', { expenses: [] }, { merge: true }]]));
  await no('Sarah can’t change the budget', save(s, 'fc', [['set', 'invState/budget', { monthly: 9000, categories: { misc: 500 }, changedBy: 'Sarah' }, { merge: true }]]));
  await ok('Dr. A changes the budget', save(a, 'owner', [['set', 'invState/budget', { monthly: 9000, categories: { misc: 500 }, changedBy: 'Dr. A' }, { merge: true }]]));
  await no('…nothing else goes in it', save(a, 'owner', [['set', 'invState/budget', { note: 'x' }, { merge: true }]]));
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'invState/budget')); });
  await no('Gwen can’t start the budget', save(g, 'ca', [['set', 'invState/budget', { monthly: 1 }]]));
  await ok('Dr. A starts it (the move)', save(a, 'owner', [['set', 'invState/budget', { monthly: 8000, categories: {}, history: [] }]]));
}

/* ---------- settings and the AI keys ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  await no('Sarah (on the old list) can’t add a storage location', save(s, 'fc', [['set', 'invState/settings', { locations: ['Lab', 'Sterilization'] }, { merge: true }]]));
  await no('Gwen can’t', save(g, 'ca', [['set', 'invState/settings', { locations: ['X'] }, { merge: true }]]));
  await ok('Dr. A does', save(a, 'owner', [['set', 'invState/settings', { locations: ['Lab', 'Sterilization'] }, { merge: true }]]));
  await no('Sarah can’t put herself on the old list', save(s, 'fc', [['set', 'invState/settings', { invAdmins: ['amir', 'sarah', 'gwen'] }, { merge: true }]]));
  await no('…or turn the alerts off', save(s, 'fc', [['set', 'invState/settings', { alertsOn: false }, { merge: true }]]));
  await no('…or the phone push', save(s, 'fc', [['set', 'invState/settings', { pushOn: false }, { merge: true }]]));
  await no('…or change where packing slips are read', save(s, 'fc', [['set', 'invState/settings', { geminiProxyUrl: 'https://evil.example' }, { merge: true }]]));
  await ok('Dr. A turns the alerts off', save(a, 'owner', [['set', 'invState/settings', { alertsOn: false }, { merge: true }]]));
  await ok('…and the phone push on', save(a, 'owner', [['set', 'invState/settings', { pushOn: true }, { merge: true }]]));
  await no('…the push switch is a yes or no', save(a, 'owner', [['set', 'invState/settings', { pushOn: 'yes' }, { merge: true }]]));
  await no('Gwen can’t change the phone-push topic', save(g, 'ca', [['set', 'invState/push', { topic: 'gwens-topic' }, { merge: true }]]));
  await ok('Dr. A sets a topic (the Time Clock’s, or one of its own)', save(a, 'owner', [['set', 'invState/push', { topic: 'nlo-clock-abc123' }, { merge: true }]]));
  await ok('…asks for a test push', save(a, 'owner', [['set', 'invState/push', { test: Date.now() }, { merge: true }]]));
  await no('…a topic ntfy takes (letters, digits, - and _)', save(a, 'owner', [['set', 'invState/push', { topic: 'has spaces/and slashes' }, { merge: true }]]));
  await no('…nothing else in it', save(a, 'owner', [['set', 'invState/push', { topic: 'ok-topic', email: 'x@example.com' }, { merge: true }]]));
  await no('nothing else goes in the settings', save(a, 'owner', [['set', 'invState/settings', { other: 1 }, { merge: true }]]));
  await no('Gwen can’t set the AI keys', save(g, 'ca', [['set', 'invState/ai', { gemini: 'AIzaEVIL' }, { merge: true }]]));
  await no('Sarah can’t either', save(s, 'fc', [['set', 'invState/ai', { gemini: 'AIzaEVIL' }, { merge: true }]]));
  await ok('Dr. A sets them', save(a, 'owner', [['set', 'invState/ai', { gemini: 'AIzaNEW', openai: 'sk-x' }, { merge: true }]]));
  await no('…nothing else in them', save(a, 'owner', [['set', 'invState/ai', { other: 'x' }, { merge: true }]]));
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'invState/settings')); });
  await no('only Dr. A starts the settings', save(s, 'fc', [['set', 'invState/settings', { locations: [] }]]));
  await ok('…Dr. A does', save(a, 'owner', [['set', 'invState/settings', { locations: [], alertsOn: true, pushOn: false }]]));
}

/* ---------- alerts, photos ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  await ok('Gwen’s cart add leaves an alert', save(g, 'ca', [['set', 'invAlerts/al2', { t: 'cart', at: Date.now(), by: 'Gwen', lines: [{ n: 'Gloves', q: 2 }], inCart: 3 }]]));
  for (const tt of ['ordered', 'reopened', 'received']) await ok('…an alert: ' + tt, save(g, 'ca', [['set', 'invAlerts/al-' + tt, { t: tt, at: Date.now(), by: 'Gwen', lines: [] }]]));
  await no('…not a made-up kind', save(g, 'ca', [['set', 'invAlerts/al3', { t: 'spam', at: Date.now() }]]));
  await no('…not a huge one', save(g, 'ca', [['set', 'invAlerts/al4', Object.assign({ t: 'cart' }, Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['f' + i, i])))]]));
  await no('…not one with a long note', save(g, 'ca', [['set', 'invAlerts/al5', { t: 'received', at: Date.now(), by: 'Gwen', note: 'x'.repeat(301), lines: [] }]]));
  await no('…or more than 60 lines', save(g, 'ca', [['set', 'invAlerts/al6', { t: 'cart', at: Date.now(), by: 'Gwen', lines: Array.from({ length: 61 }, () => ({ n: 'X', q: 1 })) }]]));
  await no('…or something else in it', save(g, 'ca', [['set', 'invAlerts/al7', { t: 'cart', at: Date.now(), by: 'Gwen', lines: [], html: '<b>x</b>' }]]));
  await no('Gwen can’t take one back', deleteDoc(doc(g, 'invAlerts/al2')));
  await no('…or change it', save(g, 'ca', [['set', 'invAlerts/al2', { t: 'cart', by: 'Someone else' }]]));
  await ok('Dr. A can clear one', deleteDoc(doc(a, 'invAlerts/al2')));
  await ok('Gwen saves a photo', save(g, 'ca', [['set', 'invPics/p2', { m: 'image/webp', b: 'UklGRg==', kind: 'thumb' }]]));
  await no('…only a picture', save(g, 'ca', [['set', 'invPics/p3', { m: 'text/html', b: 'PHNjcmlwdD4=', kind: 'thumb' }]]));
  await no('…not over the size', save(g, 'ca', [['set', 'invPics/p4', { m: 'image/jpeg', b: 'A'.repeat(1000001), kind: 'full' }]]));
  await no('…photos aren’t changed', save(g, 'ca', [['set', 'invPics/p2', { m: 'image/webp', b: 'AAAA', kind: 'thumb' }]]));
  await no('Gwen can’t delete a photo', deleteDoc(doc(g, 'invPics/p1')));
  await no('Sarah can’t either', deleteDoc(doc(s, 'invPics/p1')));
  await ok('Dr. A removes an old slip photo', deleteDoc(doc(a, 'invPics/p1')));
}

/* ---------- the cart: everyone adds; Dr. A's OKs are his ---------- */
await seed();
{
  const g = as('ca'), s = as('fc'), a = as('owner');
  const line = (id, itemId, qty, byId) => ({ lineId: id, itemId, name: itemId, qty, unit: 'box', addedBy: byId, addedById: byId, addedAt: '2026-10-16T12:00:00Z' });
  const okd = (n, it) => ({ by: 'Dr. A', byId: 'amir', at: '2026-10-16T12:05:00Z', n, it });
  const L1 = line('c-1', 'ppe-1', 2, 'gwen'), L2 = line('c-2', 'adh-1', 1, 'kim');
  await ok('Gwen adds to the cart', save(g, 'ca', [['set', 'invState/cart', { lines: [L1], ok: {} }]]));
  await no('…but can’t OK her own line', save(g, 'ca', [['set', 'invState/cart', { lines: [L1], ok: { 'c-1': okd(2, 'ppe-1') } }]]));
  await no('…not even in Dr. A’s name with his id', save(g, 'ca', [['set', 'invState/cart', { lines: [L1], ok: { 'c-1': okd(20, 'ppe-1') } }]]));
  await no('Sarah can’t OK it either', save(s, 'fc', [['set', 'invState/cart', { lines: [L1], ok: { 'c-1': okd(2, 'ppe-1') } }]]));
  await ok('Dr. A OKs it', save(a, 'owner', [['set', 'invState/cart', { lines: [L1], ok: { 'c-1': okd(2, 'ppe-1') } }]]));
  await ok('Kim adds a line (Dr. A’s OK stays as it was)', save(as('ca2'), 'ca2', [['set', 'invState/cart', { lines: [L1, L2], ok: { 'c-1': okd(2, 'ppe-1') } }]]));
  await no('…she can’t raise what Dr. A OK’d', save(as('ca2'), 'ca2', [['set', 'invState/cart', { lines: [L1, L2], ok: { 'c-1': okd(9, 'ppe-1') } }]]));
  await no('…or move his OK to her line', save(as('ca2'), 'ca2', [['set', 'invState/cart', { lines: [L1, L2], ok: { 'c-1': okd(2, 'ppe-1'), 'c-2': okd(2, 'ppe-1') } }]]));
  await no('…or drop the OKs from the cart while keeping them (not a map)', save(as('ca2'), 'ca2', [['set', 'invState/cart', { lines: [L1, L2], ok: [] }]]));
  await no('…or put something else in the cart', save(as('ca2'), 'ca2', [['set', 'invState/cart', { lines: [L1, L2], ok: {}, note: 'x' }]]));
  await ok('Gwen orders the OK’d line: it leaves the cart and its OK comes off with it', save(g, 'ca', [['set', 'invState/cart', { lines: [L2], ok: {} }]]));
  await ok('Dr. A’s save may change his OKs any way', save(a, 'owner', [['set', 'invState/cart', { lines: [L2], ok: { 'c-2': okd(1, 'adh-1') } }]]));
  is('…the cart holds his OK', (await raw('invState/cart')).ok['c-2'].n === 1, await raw('invState/cart'));
  await ok('a cart saved before 5.0 (no OKs on it): Gwen’s save keeps it that way', (async () => { await put('invState/cart', { lines: [L1], up: Timestamp.now(), upBy: 'amir' }); return save(g, 'ca', [['set', 'invState/cart', { lines: [L1, L2] }]]); })());
  await no('…and can’t start them', save(g, 'ca', [['set', 'invState/cart', { lines: [L1, L2], ok: { 'c-1': okd(2, 'ppe-1') } }]]));
  await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'invState/cart')); });
  await no('a new cart can’t start with an OK from Gwen', save(g, 'ca', [['set', 'invState/cart', { lines: [L1], ok: { 'c-1': okd(2, 'ppe-1') } }]]));
  await ok('…or with none', save(g, 'ca', [['set', 'invState/cart', { lines: [L1], ok: {} }]]));
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
  for (let i = 0; i < 24; i++) { const mon = '2025-' + String(1 + (i % 12)).padStart(2, '0'); writes.push(['set', 'invLog/m' + mon + '~old' + (i < 12 ? '' : 'x'), { e: { ['e' + i]: { id: 'e' + i } }, mon, who: 'old' }]); }
  await no('(a record named for one person and saying another is refused even in a big save)', save(a, 'owner', writes));
  writes.splice(250);
  for (let i = 0; i < 12; i++) { const mon = '2025-' + String(1 + i).padStart(2, '0'); writes.push(['set', 'invLog/m' + mon + '~old', { e: { ['e' + i]: { id: 'e' + i } }, mon, who: 'old' }]); }
  for (let i = 0; i < 30; i++) writes.push(['set', 'invVendors/mv-' + i, { id: 'mv-' + i, name: 'Vendor ' + i }]);
  writes.push(['set', 'invState/cart', { lines: [] }], ['set', 'invState/budget', { monthly: 8000, categories: {}, history: [] }], ['set', 'invState/prices', { p: {} }]);
  await ok('Dr. A saves 295 records in one go (the move)', save(a, 'owner', writes));
  is('…all there', (await getDocs(collection(a, 'invItems'))).size === 151 && (await getDocs(collection(a, 'invOrders'))).size === 102, '');
  const big = []; for (let i = 0; i < 450; i++) big.push(['set', 'invItems/b-' + i, { id: 'b-' + i, name: 'S' + i }]);
  await ok('…and 450 supplies in one go', save(a, 'owner', big));
}

/* ---------- Mari's List (17 Oct 2026): the office's member prices — everyone signed in reads them, only Dr. A loads them and
   links them to supplies ---------- */
await seed();
{
  const a = as('owner'), g = as('ca'), f = as('fc');
  const mst = uid => ({ up: serverTimestamp(), upBy: SID[uid] || uid });
  const info = o => Object.assign({ ver: 'kx1abc2d', at: '2026-10-16', src: 'Mari’s List member portal', vendors: [{ id: 'acme', name: 'Acme Test', code: 'TESTCODE10', deal: '10% off' }], parts: 2, rows: 3, loadedAt: '2026-10-17T12:00:00Z', loadedBy: 'Dr. A' }, mst('owner'), o || {});
  const part = (t, o) => Object.assign({ t }, mst('owner'), o || {});
  await ok('Dr. A saves a set’s first part', setDoc(doc(a, 'invMl/pkx1abc2d_1'), part('[["acme","T-100","TEST PLIER","EA",10.5,12,"","",0]]')));
  await ok('…and its second', setDoc(doc(a, 'invMl/pkx1abc2d_2'), part('[]')));
  await ok('…then info, which points at them', setDoc(doc(a, 'invMl/info'), info()));
  await ok('…and the links to supplies', setDoc(doc(a, 'invMl/match'), Object.assign({ m: { 'ppe-1': [{ k: 'acme|T-100|ea', x: 1, p: 10.5 }] } }, mst('owner'))));
  await ok('Gwen reads info', getDoc(doc(g, 'invMl/info')));
  await ok('…the prices', getDoc(doc(g, 'invMl/pkx1abc2d_1')));
  await ok('…and the links', getDoc(doc(g, 'invMl/match')));
  await ok('Sarah reads them too', getDoc(doc(f, 'invMl/info')));
  await no('someone who left doesn’t', getDoc(doc(as('gone'), 'invMl/info')));
  await no('nor a stranger', getDoc(doc(as('stranger'), 'invMl/pkx1abc2d_1')));
  await no('nor anyone signed out', getDoc(doc(anon(), 'invMl/info')));
  await no('nor the alert script (it doesn’t need them)', getDoc(doc(as('bot1'), 'invMl/info')));
  await no('Gwen can’t load prices', setDoc(doc(g, 'invMl/pzz9_1'), part('[]', mst('ca'))));
  await no('…nor change info', setDoc(doc(g, 'invMl/info'), info(mst('ca'))));
  await no('…nor link a price to a supply', setDoc(doc(g, 'invMl/match'), Object.assign({ m: {} }, mst('ca'))));
  await no('…nor take a part away', deleteDoc(doc(g, 'invMl/pkx1abc2d_1')));
  await no('Dr. A’s save carries his name and the time', setDoc(doc(a, 'invMl/info'), info({ upBy: 'gwen' })));
  await no('…not a made-up time', setDoc(doc(a, 'invMl/info'), info({ up: Timestamp.fromMillis(Date.now() - 864e5) })));
  await no('info with something extra is refused', setDoc(doc(a, 'invMl/info'), info({ evil: true })));
  await no('…or an odd set name', setDoc(doc(a, 'invMl/info'), info({ ver: 'A B' })));
  await no('…or parts that aren’t a number', setDoc(doc(a, 'invMl/info'), info({ parts: '2' })));
  await no('a part with something extra is refused', setDoc(doc(a, 'invMl/pkx1abc2d_3'), part('[]', { x: 1 })));
  await no('…or one too big', setDoc(doc(a, 'invMl/pkx1abc2d_4'), part('x'.repeat(1000001))));
  await no('…or under an odd name', setDoc(doc(a, 'invMl/other'), part('[]')));
  await no('links that aren’t a map are refused', setDoc(doc(a, 'invMl/match'), Object.assign({ m: [] }, mst('owner'))));
  await ok('Dr. A takes an old set’s part away', deleteDoc(doc(a, 'invMl/pkx1abc2d_2')));
  await no('…but never info or the links', deleteDoc(doc(a, 'invMl/info')));
  await no('…(the links)', deleteDoc(doc(a, 'invMl/match')));
  const before = (await raw('invState/rev')).n;
  await ok('Mari’s List saves don’t need the change counter', setDoc(doc(a, 'invMl/match'), Object.assign({ m: {} }, mst('owner'))));
  is('…and don’t move it', (await raw('invState/rev')).n === before, await raw('invState/rev'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await env.cleanup();
process.exit(fail ? 1 : 0);
