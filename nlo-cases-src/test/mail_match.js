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

console.log('\n# Partners’ Airway Department: the Zoom call for a MARPE design (Amir, 30 Oct 2026) — made-up patients, invites in the real format');
// (a reader that doesn't know the invites — MAIL_JS=<an older mail.js> — stops this section with a FAIL, not a stack trace)
try {
  const Z = 'https://us06web.zoom.us/j/81234500001?pwd=AbCdEfGhIjKlMnOpQrStUvWx.1';
  const gr = u => 'https://www.google.com/url?q=' + encodeURIComponent(u) + '&sa=D&source=calendar&usd=2&usg=AOvVaw0';
  const invite = o => ({ from: 'airway@partnersdentalstudio.com', subject: (o.pre || 'Invitation') + ': Amir Akhavan and Airway Department @ ' + (o.when || 'Fri Dec 4, 2026 11:30am - 12:30pm (EST)') + ' (akhavan.ak@gmail.com)',
    text: 'Amir Akhavan and Airway Department\n' + (o.body || 'Friday Dec 4, 2026 ⋅ 11:30am – 12:30pm\nEastern Time - New York') + '\n\nLocation\n' + (o.link || Z) + '\t\n' + gr(o.link || Z) +
      '\n\nEvent Name\n' + (o.title || 'CBCT Consultation') + '\n\nDuring this meeting we will digitally plan your custom appliance(s) with\nthe assistance of our Lead Specialist at Partners Dental Studio.\n\n' +
      '* Prescription\n* IO Scan with full palate\n* CBCT in DICOM format (https://www.beamreaders.com/help/submitting-cases\n(https://calendly.com/url?q=https%3A%2F%2Fwww.beamreaders.com&amp;stage=1)\n)\n\n' +
      'Location: This is a Zoom web conference.\n\nYou can join this meeting from your computer, tablet, or smartphone.\n' + (o.link || Z) + '\n\nPassword: 123456\n\nMeeting ID: 812-345-00001\n\n' +
      (o.names != null ? 'How many patients would you like to review? (maximum of 4 patients per\nmeeting): 3\n\nProvide first and last name for the patient(s):' + o.names + '\n\n' : '') +
      'If you have a link from an external sharing service to download the CBCT,\nplease add it below : Sent all CBCT on portal\n\nName of doctor and practice:\nDr. Amir Akhavan\nNext Level Orthodontics\n\n' +
      'Need to make changes to this event?\nCancel:\nhttps://calendly.com/cancellations/0000\nReschedule:\nhttps://calendly.com/reschedulings/0000\n\nPowered by Calendly.com\n\nGuests\nakhavan.ak@gmail.com\n' +
      'View all guest info\nhttps://calendar.google.com/calendar/event?action=VIEW&eid=xyz' });
  const all = m => T.mailParse(m).map((e, i) => Object.assign(e, { at, key: 'z' + (++n) + ':' + i }));
  let evs = all(invite({ names: '\nWendell Zoomer\nTobyas Quarrington\nHarriet Nomatch' }));
  check(evs.length === 3 && evs.every(e => e.co === 'partners' && e.kind === 'zoom') && evs.map(e => e.name).join('|') === 'Wendell Zoomer|Tobyas Quarrington|Harriet Nomatch',
    'an invite naming three patients (one per line under the question) → three Zoom updates (' + evs.map(e => e.name).join(', ') + ')');
  check(evs.every(e => e.zoomDate === '2026-12-04' && e.zoomTime === '11:30' && e.zoomUrl === Z && e.meet === '81234500001' && e.title === 'CBCT Consultation'),
    'each has the call: Dec 4, 11:30 AM, the Zoom join link with its passcode (not the Calendly, beamreaders or Google links), and the event name');
  evs = all(invite({ names: ' Wendell Zoomer' }));
  check(evs.length === 1 && evs[0].name === 'Wendell Zoomer', 'one patient on the same line as the question (Partners’ August invite)');
  evs = all(invite({ names: null, title: 'CBCT Consult with Dr. Akhavan' }));
  check(evs.length === 1 && evs[0].name === '' && evs[0].zoomUrl === Z && evs[0].zoomDate === '2026-12-04', 'an invite with no patient question (“CBCT Consult with Dr. Akhavan”) → one update with no name, kept for Today');
  // times: the subject's zone (Dr. A's Google Calendar is Eastern); another zone is changed to the office's
  check(all(invite({ names: ' W Z', when: 'Fri Sep 18, 2026 11:30am - 12:30pm (EDT)' }))[0].zoomTime === '11:30', 'EDT stays 11:30');
  check(all(invite({ names: ' W Z', when: 'Fri Sep 18, 2026 10:30am - 11:30am (CDT)' }))[0].zoomTime === '11:30', 'a time in CDT (the lab’s) → 11:30 in the office');
  check(all(invite({ names: ' W Z', when: 'Fri Dec 4, 2026 12pm - 1pm (EST)' }))[0].zoomTime === '12:00', '“12pm” (no minutes) → 12:00');
  check(all(invite({ names: ' W Z', when: 'Fri Dec 4, 2026 12:15am - 1am (EST)' }))[0].zoomTime === '00:15', '“12:15am” → 00:15');
  { const e = all(invite({ names: ' W Z', when: 'Fri Dec 4, 2026 11pm - 12am (PST)' }))[0]; check(e.zoomDate === '2026-12-05' && e.zoomTime === '02:00', '11 PM Pacific → 2 AM the next day in the office (' + e.zoomDate + ' ' + e.zoomTime + ')'); }
  { const e = all(invite({ names: ' W Z', when: 'Fri Dec 4, 2026 (EST)' }))[0]; check(e.zoomDate === '2026-12-04' && e.zoomTime === '', 'an all-day invite: the date, no time'); }
  { const e = all(invite({ names: ' W Z', when: 'later', body: 'Friday Dec 4, 2026 ⋅ 10:30am – 11:30am\nCentral Time - Chicago' }))[0];
    check(e.zoomDate === '2026-12-04' && e.zoomTime === '11:30', 'no date in the subject: the invite’s first lines, its zone too (Central 10:30 → 11:30)'); }
  check(all(invite({ pre: 'Updated invitation', names: ' W Z', when: 'Fri Dec 11, 2026 11:30am - 12:30pm (EST)' }))[0].zoomDate === '2026-12-11', 'an “Updated invitation” (rescheduled) is read too');
  check(!all(invite({ pre: 'Canceled event', names: ' W Z' })).length, 'a cancellation isn’t read (left unread)');
  check(!all({ from: 'airway@partnersdentalstudio.com', subject: 'URGENT: Zoom Call Today', text: 'We have a meeting scheduled for 10:30 AM CT today.\n' + Z }).length
    && !all({ from: 'airway@partnersdentalstudio.com', subject: 'Follow up (PENDING): A. Smith', text: 'Hello' }).length, 'the “URGENT: Zoom Call Today” reminder and follow-ups aren’t read');
  check(!all({ from: 'airway@partnersdentalstudio.com', subject: 'Invitation: Lunch & learn @ Fri Dec 4, 2026 12pm - 1pm (EST) (akhavan.ak@gmail.com)', text: 'At the office. No video link.\nProvide first and last name for the patient(s): Wendell Zoomer' }).length,
    'a Partners calendar invite with no Zoom link (a lunch & learn) isn’t read as a case’s call');
  check(all({ from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html: '<p>Cases Shipped Today</p><table><tr><th>Patient Name</th><th>Invoice Number</th></tr><tr><td>Emma S.</td><td>1</td></tr></table>' })[0].kind === 'shipped',
    'Partners’ daily summary is still read as before');
  // matching
  const ready = kase({ type: 'marpe', patient: 'Wendell Zoomer', stage: 'submitted', lab: 'Partners Dental Solutions', records: ['stl', 'cbct'] });
  const typo = kase({ type: 'marpe', patient: 'Tobias Quarrington', stage: 'records', lab: 'Partners Dental Solutions', records: ['stl'] });
  const other = kase({ type: 'appliance', patient: 'Harriet Nomatch', stage: 'submitted', lab: 'Partners Dental Solutions', appliances: ['Herbst'] });
  const open = [ready, typo, other];
  evs = all(invite({ names: '\nWendell Zoomer\nTobyas Quarrington\nHarriet Nomatch' }));
  check(match(evs[0], open).c === ready, 'the full name of an open MARPE case at Partners → that case, by itself');
  const m2 = match(evs[1], open);
  check(!m2.c && m2.check && m2.many.length === 1 && m2.many[0] === typo, 'a misspelled first name (Tobyas / Tobias) → suggested on Today by the last name, never applied by itself');
  check(match(evs[2], open).none, 'a patient with no MARPE case (only an appliance case) → nothing to suggest');
  const e0 = T.mailEffect(ready, evs[0]);
  check(e0.to === 'zoom' && e0.set.zoomDate === '2026-12-04' && e0.set.zoomTime === '11:30' && e0.set.zoomUrl === Z && e0.set.zoomAt === at, 'applied: the date, time and link, and Zoom call scheduled (both records on file)');
  const e1 = T.mailEffect(typo, evs[1]);
  check(!e1.to && e1.set.zoomDate === '2026-12-04' && e1.set.zoomUrl === Z, 'a case still missing its CBCT gets the call, but stays at Records (it can’t go to the lab without it)');
  check(!T.mailEffect(other, evs[2]).to && !Object.keys(T.mailEffect(other, evs[2]).set).length, 'an appliance case picked for it by mistake: nothing changes (not even its lab)');
  const twin = kase({ type: 'marpe', patient: 'Wendell Zoomer', stage: 'records', lab: 'Partners Dental Solutions' });
  check((match(evs[0], [ready, twin]).many || []).length === 2, 'two open MARPE cases with the name → someone picks');
  const approved = kase({ type: 'marpe', patient: 'Wendell Zoomer', stage: 'approved', lab: 'Partners Dental Solutions' });
  check(match(evs[0], [approved]).done, 'the patient’s design is already approved → nothing to do (cleared)');
  check(match(evs[0], [], [Object.assign(kase({ type: 'marpe', patient: 'Wendell Zoomer', stage: 'milestones', lab: 'Partners Dental Solutions' }), { closedAt: at + 1000 })]).done, '…or the case was completed after the invite');
  const spec = kase({ type: 'marpe', patient: 'Wendell Zoomer', stage: 'submitted', lab: 'Specialty Orthodontic Lab', records: ['stl', 'cbct'] });
  check(match(evs[0], [spec]).none, 'a MARPE case at Specialty is never matched to Partners’ invite');
  const noLab = kase({ type: 'marpe', patient: 'Wendell Zoomer', stage: 'submitted', records: ['stl', 'cbct'] });
  check(match(evs[0], [noLab]).c === noLab && T.mailEffect(noLab, evs[0]).set.lab === 'Partners Dental Solutions', 'a MARPE case with no lab yet → matched, and gets Partners as its lab');
  // no name (Partners' "CBCT Consult with Dr. Akhavan" booking). Days from today: a call that's over is left alone
  const W = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = k => { const d = new Date(Date.now() + k * 864e5), md = M[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    return { iso: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), subj: W[d.getDay()].slice(0, 3) + ' ' + md, body: W[d.getDay()] + ' ' + md }; };
  const nnOn = k => { const d = day(k); return all(invite({ names: null, title: 'CBCT Consult with Dr. Akhavan', when: d.subj + ' 10:30am - 11:30am', body: d.body + ' ⋅ 10:30am – 11:30am\nEastern Time - New York' }))[0]; };
  const fu = day(40), nn = nnOn(40);
  check(nn.name === '' && nn.zoomDate === fu.iso && nn.zoomTime === '10:30', 'the invite with no name: its day and time (' + nn.zoomDate + ' ' + nn.zoomTime + ')');
  const waiting = kase({ type: 'marpe', patient: 'Nell Waiting', stage: 'submitted', lab: 'Partners Dental Solutions', records: ['stl', 'cbct'] });
  const dated = kase({ type: 'marpe', patient: 'Dora Dated', stage: 'submitted', lab: 'Partners Dental Solutions', records: ['stl', 'cbct'], zoomDate: day(47).iso });
  const recs = kase({ type: 'marpe', patient: 'Rita Records', stage: 'records', lab: 'Partners Dental Solutions', records: ['stl'] });
  const mn = match(nn, [waiting, dated, ready, recs]);
  check(!mn.c && mn.check === 'wait' && mn.many.map(c => c.patient).join() === 'Nell Waiting,Wendell Zoomer,Rita Records,Dora Dated',
    'an invite that names no one → never applied by itself; suggests the MARPE cases waiting for a Zoom date (at Records or Submitted), then the one with a call booked (a call rebooked on Calendly comes as a new invite)');
  // …unless the call is on a case already (put in by hand from the same invite)
  const pasted = kase({ type: 'marpe', patient: 'Paula Pasted', stage: 'zoom', lab: 'Partners Dental Solutions', records: ['stl', 'cbct'], zoomDate: fu.iso, zoomUrl: Z, zoomAt: at + 5000 });
  check(match(nn, [waiting, pasted]).c === pasted, 'no name, but its Zoom link is on a case already (pasted in) → that case');
  const ep = T.mailEffect(pasted, nn);
  check(ep.set.zoomTime === '10:30' && !ep.set.zoomDate && !ep.set.zoomUrl && !ep.to, '…which gets only what it’s missing (the time)');
  const pasted2 = Object.assign({}, pasted, { id: 'pp2', patient: 'Pat Pasted' }), m2l = match(nn, [pasted, pasted2]);
  check(m2l.cs && m2l.cs.length === 2 && !m2l.c, 'the link on two cases already (two patients on the call) → both get it by themselves');
  const slotCase = kase({ type: 'marpe', patient: 'Tess Typed', stage: 'submitted', lab: 'Partners Dental Solutions', records: ['stl', 'cbct'], zoomDate: fu.iso, zoomTime: '10:30', zoomAt: at + 5000 });
  const es = T.mailEffect(slotCase, nn);
  check(match(nn, [waiting, slotCase]).c === slotCase && es.set.zoomUrl === Z && !es.to, 'no name, and a case has the call’s day and time typed in (no link yet) → that case gets the link (its step stays: the invite is older than the typing)');
  const dayOnly = Object.assign({}, slotCase, { zoomTime: '' }), md = match(nn, [waiting, dayOnly]);
  check(!md.c && md.check && md.many.length === 1 && md.many[0] === dayOnly, '…only the day typed in → suggested on Today, not applied by itself');
  const otherCall = match(nn, [waiting, Object.assign({}, slotCase, { zoomTime: '14:00' })]);
  check(!otherCall.c && otherCall.check === 'wait' && otherCall.many[0] === waiting, '…a case with another call that day (2 PM) isn’t taken for this one (only listed after the case waiting for a date)');
  check(match(nnOn(-3), [waiting]).done, 'no name, for a call that’s over → nothing to do (nothing says which case it was)');
  // older and newer invites: a later change is never undone
  const later = Object.assign({}, ready, { zoomDate: '2026-12-11', zoomTime: '09:00', zoomAt: at + 5000 }); // (rescheduled by hand after the invite)
  const eOld = T.mailEffect(later, evs[0]), mOld = match(evs[0], [later]);
  check(!eOld.set.zoomDate && !eOld.set.zoomTime && !eOld.set.zoomUrl, 'an invite older than the last change to the call (a different day typed in later): changes nothing by itself');
  check(!mOld.c && mOld.check === 'later' && mOld.many[0] === later, '…it waits on Today instead (“Its Zoom call was set by hand…”), for someone to apply or dismiss');
  const eHand = T.mailEffect(later, Object.assign({}, evs[0], { hand: 1 }));
  check(eHand.set.zoomDate === '2026-12-04' && eHand.set.zoomTime === '11:30' && eHand.set.zoomUrl === Z && eHand.to === 'zoom' && eHand.set.zoomAt >= at, '…and Apply there puts the invite’s call on, all of it (a person’s choice, timed now)');
  const typed = Object.assign({}, ready, { zoomDate: '2026-12-04', zoomTime: '', zoomAt: at + 5000 }); // (the date typed in from the invite, nothing else)
  const eFill = T.mailEffect(typed, evs[0]);
  check(eFill.set.zoomTime === '11:30' && eFill.set.zoomUrl === Z && !eFill.set.zoomDate && !('zoomAt' in eFill.set) && !eFill.to && (eFill.set.zoomInv || []).length === 1,
    '…an older invite for the same day fills in only what’s missing (the time, the link), and doesn’t move the step');
  const resched = all(invite({ pre: 'Updated invitation', names: '\nWendell Zoomer', when: 'Fri Dec 11, 2026 1pm - 2pm (EST)', link: 'https://us06web.zoom.us/j/81234500002?pwd=Zz.1' }))[0];
  resched.at = at + 9000;
  const set1 = Object.assign({}, ready, e0.set, { stage: 'zoom' }), eNew = T.mailEffect(set1, resched);
  check(eNew.set.zoomDate === '2026-12-11' && eNew.set.zoomTime === '13:00' && /81234500002/.test(eNew.set.zoomUrl) && !eNew.to, 'a newer “Updated invitation” moves the call (Dec 11, 1 PM, new link); the case is already at Zoom call scheduled');
  const same = T.mailEffect(Object.assign({}, set1, eNew.set), Object.assign({}, resched, { at: at + 9500 }));
  check(!same.to && !Object.keys(same.set).length, 'the same invite again (the other mailbox’s copy): nothing to change');
  // (independent review, 30 Oct 2026)
  // 1. a call typed in before this version (no zoomAt): an invite isn't taken as newer
  const legacy = Object.assign({}, ready, { zoomDate: '2026-12-18', zoomTime: '15:00' }), mLeg = match(evs[0], [legacy]);
  check(!mLeg.c && mLeg.check === 'later' && !Object.keys(T.mailEffect(legacy, evs[0]).set).length, 'a call typed in before the app read invites (another day): the invite waits on Today, nothing is overwritten');
  const legSame = Object.assign({}, ready, { zoomDate: '2026-12-04' }), eLeg = T.mailEffect(legSame, evs[0]);
  check(match(evs[0], [legSame]).c === legSame && eLeg.set.zoomTime === '11:30' && eLeg.set.zoomUrl === Z && !eLeg.set.zoomDate && !eLeg.to, '…the same day typed in before: the time and link are filled in, the step isn’t moved');
  // 2. initials are only suggested
  const ini = all(invite({ names: '\nW. Zoomer\nWendell Z.' }));
  const mi1 = match(ini[0], [ready]), mi2 = match(ini[1], [ready]);
  check(!mi1.c && mi1.check === 'initial' && mi1.many[0] === ready && !mi2.c && mi2.check === 'initial', 'initials (“W. Zoomer”, “Wendell Z.”) → suggested on Today, never applied by themselves (a brother or sister?)');
  // 3. an updated invitation for a call whose link is on two cases moves both
  const upd2 = Object.assign({}, nnOn(40), { at: at + 9000, upd: 1, zoomDate: day(44).iso });
  const p1 = Object.assign({}, pasted, { zoomTime: '10:30', zoomAt: at, zoomInvAt: at, zoomInv: [] }), p2 = Object.assign({}, p1, { id: 'pp3', patient: 'Pat Pasted' }), mu = match(upd2, [p1, p2]);
  check(mu.cs && mu.cs.length === 2 && T.mailEffect(p1, upd2).set.zoomDate === day(44).iso && T.mailEffect(p2, upd2).set.zoomDate === day(44).iso, 'an updated invite (no name) for a call whose link is on two cases: both move to the new day');
  // 4. the list of names
  const nm = t => all(invite({ names: t })).map(e => e.name).join('|');
  check(nm('\nWendell Zoomer DOB: 01/02/2012\nTobyas Quarrington') === 'Wendell Zoomer|Tobyas Quarrington', 'a date of birth after a name is left off, and the names after it are still read');
  check(nm('\nWendell Zoomer 10:30\nTobyas Quarrington') === 'Wendell Zoomer|Tobyas Quarrington', 'a time after the first name doesn’t make it an invite with no names');
  { const lf = all(invite({ names: '\nZoomer, Wendell' })); check(lf.length === 1 && match(lf[0], [ready]).c === ready, '“Zoomer, Wendell” is one name (last, first) → matched'); }
  check(nm(' Wendell Zoomer, Tobyas Quarrington') === 'Wendell Zoomer|Tobyas Quarrington' && nm('\n1. Wendell Zoomer\n2) Tobyas Quarrington (sibling)') === 'Wendell Zoomer|Tobyas Quarrington', 'full names split on commas; numbering and a note in brackets are left off');
  // 5. a change by hand isn't undone by a copy of an invite applied before
  const ap = Object.assign({}, ready, e0.set, { stage: 'zoom' }); // (the invite applied)
  const noLink = Object.assign({}, ap, { zoomUrl: '', zoomAt: at + 7000 }); // (the link taken off by hand since)
  check(!Object.keys(T.mailEffect(noLink, Object.assign({}, evs[0], { at: at + 100 })).set).length, 'the link taken off by hand: a late copy of the invite doesn’t put it back');
  const back = Object.assign({}, ap, { stage: 'submitted' }); // (moved back by hand, the date kept)
  check(!T.mailEffect(back, Object.assign({}, evs[0], { at: at + 100 })).to, 'a case moved back to Submitted by hand: a copy of the invite doesn’t move it on again');
  const handLater = Object.assign({}, ap, { zoomDate: '2026-12-10', zoomAt: at + 7000 }), updOld = Object.assign({}, resched, { at: at + 6000 });
  check(match(updOld, [handLater]).check === 'later', 'an “Updated invitation” sent before a change by hand (another day): Today, not lost and not applied');
  // superseded: the newer of two invites applied first, then the older one
  const newer = Object.assign({}, ready, T.mailEffect(ready, resched).set, { stage: 'zoom' });
  check(!Object.keys(T.mailEffect(newer, evs[0]).set).length && match(evs[0], [newer]).c === newer, 'the older invite read after the newer one: nothing changes (no Today row either)');
  // 6. only calls booked on Partners' Calendly
  const web = invite({ names: null, title: 'Partners webinar' }); web.text = web.text.replace(/https:\/\/calendly\.com\/\S+/g, '').replace(/Powered by Calendly\.com/, '');
  check(!all(web).length, 'a Partners calendar invite with a Zoom link that isn’t a Calendly booking (a webinar) isn’t read');
  const updNo = Object.assign({}, nnOn(40), { upd: 1, meet: '81299999999', zoomUrl: 'https://us06web.zoom.us/j/81299999999', zoomDate: day(45).iso }), mUpd = match(updNo, [waiting, p1]);
  check(mUpd.check === 'moved' && mUpd.many.length === 1 && mUpd.many[0] === p1, 'an updated invite with no name and a new link: Today suggests the case with a call booked, not the one waiting for a date');
  // 7. times
  { const e = all(invite({ names: ' W Z', when: 'later', body: 'Friday Dec 4, 2026 ⋅ 1:30 – 2:30pm\nEastern Time - New York' }))[0]; check(e.zoomTime === '13:30', '“1:30 – 2:30pm” (am/pm once) → 1:30 PM'); }
  { const e = all(invite({ names: ' W Z', when: 'later', body: 'Friday Dec 4, 2026 ⋅ 11:30 – 12:30pm\nEastern Time - New York' }))[0]; check(e.zoomTime === '11:30', '“11:30 – 12:30pm” → 11:30 AM'); }
  { const e = all(invite({ names: ' W Z', when: 'Fri Dec 4, 2026 10:30am - 11:30am (GMT-06:00)' }))[0]; check(e.zoomTime === '11:30', 'a zone written “GMT-06:00” → 11:30 in the office'); }
  { const e = all(invite({ names: ' W Z', when: 'Fri Dec 4, 2026 10:30am - 11:30am (XYZ)', body: 'Friday Dec 4, 2026 ⋅ 10:30am – 11:30am\nCentral Time - Chicago' }))[0]; check(e.zoomTime === '11:30', 'a zone it doesn’t know in the subject: the invite’s “Central Time” line'); }
  // (second review, 30 Oct 2026)
  // N1. one case on a call changed by hand: the others still move; only that one waits on Today
  { const u = Object.assign({}, nnOn(40), { at: at + 9000, upd: 1, zoomDate: day(46).iso });
    const a1 = Object.assign({}, pasted, { id: 'q1', zoomTime: '10:30', zoomAt: at, zoomInvAt: at, zoomInv: [] }), a2 = Object.assign({}, a1, { id: 'q2' }), a3 = Object.assign({}, a1, { id: 'q3', zoomTime: '08:00', zoomAt: at + 9500 });
    const mm = match(u, [a1, a2, a3]);
    check(mm.cs && mm.cs.map(c => c.id).join() === 'q1,q2' && mm.many && mm.many.map(c => c.id).join() === 'q3' && mm.check === 'later', 'a call moved for three patients, one of whose time was changed by hand since: the other two move by themselves, that one waits on Today');
    check(T.mailEffect(a3, u).ask === true && !Object.keys(T.mailEffect(a3, u).set).length, '…and if the change by hand lands after the match, writing it says so (it goes to Today, it isn’t lost)'); }
  // N2. names as people type them
  check(nm('\nJan Dvořák\nŁukasz Nowak') === 'Jan Dvořák|Łukasz Nowak', 'names in any alphabet are read whole (“Jan Dvořák”, “Łukasz Nowak”)');
  check(nm('\nMax Born\nAnna Birthe Jensen') === 'Max Born|Anna Birthe Jensen', '“Born” and “Birthe” in a name stay (only “born 1/2/2012” is cut)');
  check(nm('\n#1 Wendell Zoomer\n#2 Tobyas Quarrington') === 'Wendell Zoomer|Tobyas Quarrington', '“#1 …” numbering is taken off');
  check(nm('\nChristopherson Montgomery-Smith DOB: 01/02/2012\nWendell Zoomer') === 'Christopherson Montgomery-Smith|Wendell Zoomer', 'a long name with a date of birth doesn’t end the list');
  check(nm('\nWendell\nTobyas & Rita Records') === 'Wendell|Tobyas|Rita Records', 'one-word answers are kept (they wait on Today), “A & B C” gives both');
  { const jr = all(invite({ names: '\nWendell Zoomer, Jr.' })); check(jr.length === 1 && jr[0].name === 'Wendell Zoomer' && match(jr[0], [ready]).c === ready, '“Wendell Zoomer, Jr.” → Wendell Zoomer, matched by itself'); }
  { const one = all(invite({ names: '\nWendell' }))[0]; const m1 = match(one, [ready]); check(!m1.c, 'a one-word name is never applied by itself'); }
  // N3. a case with only the link pasted in: the same meeting's invite gives it the day and time
  { const lk = kase({ type: 'marpe', patient: 'Lena Linked', stage: 'submitted', lab: 'Partners Dental Solutions', records: ['stl', 'cbct'], zoomUrl: Z, zoomAt: at + 5000 });
    const ml = match(nn, [lk]), el = T.mailEffect(lk, nn);
    const eh = T.mailEffect(lk, Object.assign({}, nn, { hand: 1 }));
    check(!ml.c && ml.check === 'later' && ml.many[0] === lk && !Object.keys(el.set).length && eh.set.zoomDate === fu.iso && eh.set.zoomTime === '10:30',
      'only this meeting’s Zoom link on a case (no day): Today (“…Apply adds the day and time”), and Apply there does');
    const cleared = Object.assign({}, lk, { zoomAt: at + 8000 }); // (its day cleared by hand — “Clear the date” keeps the link — after the invite was sent)
    check(!Object.keys(T.mailEffect(cleared, nn).set).length && match(nn, [cleared]).check === 'later', 'a call cleared by hand (link kept): an older invite for it never puts the day back by itself'); }
  check(nm('\nRobert (Bob) Quarrington\nN/A') === 'Robert Quarrington', 'a nickname in brackets is taken out (“Robert (Bob) Quarrington” → Robert Quarrington); “N/A” isn’t a name');
  // #6. a new invite with no name, a case waiting and one with a call booked: both offered, none picked for you
  { const bk = kase({ type: 'marpe', patient: 'Bo Booked', stage: 'zoom', lab: 'Partners Dental Solutions', records: ['stl', 'cbct'], zoomDate: day(41).iso, zoomTime: '09:00', zoomUrl: 'https://us06web.zoom.us/j/81277777777', zoomAt: at - 1000 });
    const mb = match(nnOn(40), [waiting, bk]); check(mb.many.length === 2 && mb.many[0] === waiting && mb.many[1] === bk, 'a new invite with no name while another case has a call booked: both are offered (it may be that call rebooked), none picked for you'); }
  const fpA = vm.runInContext('mailFp', ctx)(evs[0]), fpB = vm.runInContext('mailFp', ctx)(resched);
  check(fpA !== fpB && vm.runInContext('mailFp', ctx)(Object.assign({}, evs[0], { at: at + 1 })) === fpA, 'a rescheduled call is a new update; a copy of the same invite is the same one');
  check(vm.runInContext('mailFp', ctx)({ co: 'partners', kind: 'shipped', name: 'Emma S.', tracking: '1Z' }) === 'partners|shipped|emma s||1Z||', 'other updates keep the fingerprint they had (dismissed ones stay dismissed)');
} catch (e) { check(false, 'the Zoom invite checks stopped: ' + e.message); }

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
