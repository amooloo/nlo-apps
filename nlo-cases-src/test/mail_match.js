// Reading lab emails and finding the case, without a browser: src/core.js + src/mail.js in a sandbox, made-up patients only.
//   node test/mail_match.js            (MAIL_JS=<file> runs it against another copy of mail.js)
// (12 Oct 2026) a refinement's Angel email was swallowed by the patient's first case; a uLab order confirmation could move a
// case to Shipped; a Partners/Specialty "First L." row moved a case that wasn't at that lab yet, or wasn't theirs.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const ctx = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, console, URL, ADMIN_ACTS: {}, window: {}, localStorage: { getItem: () => null, setItem: () => { } } });
const src = f => fs.readFileSync(f, 'utf8');
vm.runInContext(src(path.join(__dirname, '..', 'src', 'core.js')), ctx, { filename: 'core.js' });
vm.runInContext(src(process.env.MAIL_JS || path.join(__dirname, '..', 'src', 'mail.js')), ctx, { filename: 'mail.js' });
const T = vm.runInContext('({ mailParse, mailMatch, mailEffect })', ctx);

let n = 0;
const kase = o => Object.assign({ id: 'c' + (++n), comments: [], createdAt: Date.now() }, o);
const at = Date.now();
const one = mail => { const evs = T.mailParse(mail); return evs.length === 1 ? Object.assign(evs[0], { at, key: 'k' + (++n) + ':0' }) : null; };
const match = (ev, open, closed) => ev ? T.mailMatch(ev, open, closed || []) : {};

console.log('\n# Angel: one patient # for every refinement');
const angelPlan = { from: 'iOrtho.America@angelaligner.com', subject: 'Angel Aligner: Treatment Plan to be Reviewed',
  text: 'Dear Dr. Amir Akhavan,\nYour treatment plan for patient (patient:Maria Lopez #A12345 ) is ready for review. Please login to iOrtho to review.' };
const angelShip = { from: 'iOrtho.America@angelaligner.com', subject: 'Angel Aligner: Your case has shipped', text: 'Your case for patient Maria Lopez #A12345 has shipped.' };
{
  const first = kase({ type: 'angel', patient: 'Maria Lopez', stage: 'arrived', labRef: 'A12345' });
  const refine = kase({ type: 'angel', patient: 'Maria Lopez', stage: 'submit' });
  const m = match(one(angelPlan), [first, refine]);
  check(m.c === refine, 'a refinement’s “ready for review” goes to the refinement, not the first case still open at Arrived');
  const ev = one(angelPlan), eff = T.mailEffect(refine, ev);
  check(eff.to === 'dra' && eff.set.labRef === 'A12345', '…which moves to Dr. A action and takes Angel’s patient #');
  const refineMfg = kase({ type: 'angel', patient: 'Maria Lopez', stage: 'mfg' });
  check(match(one(angelShip), [first, refineMfg]).c === refineMfg, 'the refinement’s “has shipped” goes to the refinement too');
  check(match(one(angelPlan), [first]).c === first, 'with no other case open, it’s still the first case (nothing to move: a repeat email)');
  const firstSubmit = kase({ type: 'angel', patient: 'Maria Lopez', stage: 'submit', labRef: 'A12345' });
  check(match(one(angelPlan), [firstSubmit, refine]).c === firstSubmit, 'when the case with the saved # can move, it wins');
  const other = kase({ type: 'angel', patient: 'Maria Lopez', stage: 'submit', labRef: 'B99999' });
  check(match(one(angelPlan), [first, other]).c === first, 'a case with a different saved # is never picked');
}

console.log('\n# uLab: only an email that says the order shipped');
{
  const u = kase({ type: 'ulab', patient: 'Ulysses Marchetti', stage: 'dra' });
  const shipped = { from: 'uLab Systems <noreply@ulabsystems.com>', subject: 'Your uLab order ZQ88 has shipped.',
    text: 'Your Order Has Shipped!\nGreat news! The following order is on the way to your office:\nOrder Number: ZQ88\nPatient Name: Ulysses Marchetti\nClick here to track your order: 777766665555' };
  const ev = one(shipped);
  check(!!ev && ev.kind === 'shipped' && ev.ref === 'ZQ88' && match(ev, [u]).c === u, '“Your uLab order … has shipped.” → shipped, on the right case');
  const confirm = { from: 'uLab Systems <noreply@ulabsystems.com>', subject: 'Your uLab order ZQ90 has been received',
    text: 'Thank you! Your aligners will be shipped within 5–7 business days.\nOrder Number: ZQ90\nPatient Name: Ulysses Marchetti' };
  check(T.mailParse(confirm).length === 0, 'an order confirmation that says it “will be shipped” isn’t read as a shipment');
  const later = { from: 'noreply@ulabsystems.com', subject: 'Your order will be shipped soon', text: 'Order Number: ZQ91\nPatient Name: Ulysses Marchetti' };
  check(T.mailParse(later).length === 0, '…nor one whose subject says it will be shipped');
  const notYet = { from: 'noreply@ulabsystems.com', subject: 'Order ZQ92 not shipped: missing scan', text: 'Order Number: ZQ92\nPatient Name: Ulysses Marchetti' };
  check(T.mailParse(notYet).length === 0, '…nor “not shipped”');
}

console.log('\n# Partners / Specialty daily summaries: “First L.” with no case #');
const partnersShip = nm => ({ from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html:
  '<p>No Cases Received Today</p><p>Cases Shipped Today</p><table><tr><th>Patient Name</th><th>Invoice Number</th><th>Tracking Number</th><th>Carrier</th></tr><tr><td>' + nm + '</td><td>228635</td><td>1Z7F167A0211300001</td><td>UPS</td></tr></table>' });
{
  const atLab = kase({ type: 'appliance', patient: 'Emma Smith', stage: 'mfg', lab: 'Partners Dental Solutions' });
  check(match(one(partnersShip('Emma S.')), [atLab]).c === atLab, 'a case at Partners, in Manufacturing → moved by itself');
  const oldName = kase({ type: 'appliance', patient: 'Priya Quillfeather', stage: 'submitted', lab: 'Partner Dental Studios' });
  check(match(one(partnersShip('Priya Q.')), [oldName]).c === oldName, 'a case saved under Partners’ old name, Submitted → moved by itself');
  const notSent = kase({ type: 'appliance', patient: 'Emma Smith', stage: 'submit', lab: 'Partners Dental Solutions' });
  const m1 = match(one(partnersShip('Emma S.')), [notSent]);
  check(!m1.c && m1.many && m1.many[0] === notSent && m1.check, 'a case not sent to the lab yet → waits on Today with the case suggested, not moved to Shipped');
  const noLab = kase({ type: 'appliance', patient: 'Emma Smith', stage: 'mfg' });
  const m2 = match(one(partnersShip('Emma S.')), [noLab]);
  check(!m2.c && m2.many && m2.many[0] === noLab && m2.check, 'a case with no lab set (it would count for both labs) → waits with the case suggested');
  const eff = T.mailEffect(noLab, one(partnersShip('Emma S.')));
  check(eff.to === 'shipped' && eff.set.lab === 'Partners Dental Solutions', '…and once someone applies it, the case gets Partners as its lab, so its next rows match by themselves');
  const spec = kase({ type: 'appliance', patient: 'Emma Smith', stage: 'mfg', lab: 'Specialty Orthodontic Lab' });
  check(match(one(partnersShip('Emma S.')), [spec]).none, 'a case at Specialty is never matched to Partners’ summary');
  const hold = { from: 'Specialty Appliances <cases@specialtyappliances.com>', subject: 'Daily Case Summary', text: '', html:
    '<p>Cases On Hold in the last 7 Days</p><table><tr><th>Patient Name</th><th>Case Number</th><th>Hold Date</th><th>Hold Reason</th></tr><tr><td>Mira H.</td><td>55120</td><td>10-01-2026</td><td>Need lower jaw in the CBCT</td></tr></table>' };
  const mira = kase({ type: 'marpe', patient: 'Mira Holdsworth', stage: 'submitted', lab: 'Specialty Orthodontic Lab' });
  check(match(one(hold), [mira]).c === mira, 'a Specialty hold for a MARPE at Specialty, Submitted → noted by itself');
  const recv = { from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html:
    '<p>Cases Received Today</p><table><tr><th>Patient Name</th><th>Case Number</th></tr><tr><td>Yara Q.</td><td>56001</td></tr></table>' };
  const yara = kase({ type: 'appliance', patient: 'Yara Quinn', stage: 'submit', lab: 'Partners Dental Solutions' });
  check(match(one(recv), [yara]).c === yara, 'a “received” row for a case at Partners → Manufacturing by itself, whatever step it was at');
}

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
