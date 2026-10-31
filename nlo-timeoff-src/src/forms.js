/* =====================================================================
   Staff forms (Dr. A, 31 Oct 2026: "create a section under benefit
   tracker … that would have other forms for the staff to submit"). The
   forms are data: each one's parts, fields, who reads it and how it's
   decided. The checks every copy goes through are here too; the screens
   and the printout are in formsui.js.

   A form someone sends is kept like a scrubs request (toPerk, kind
   'form'): sealed in the browser to the person, and either to the HR
   key (Dr. A and the people who approve time off) or to Dr. A's own
   forms key, which only he holds (aud 'owner': complaints, accommodation,
   money). In the clear only whose it is, its status and its year — never
   which form it is. The doctor's certifications are printouts: filled
   in on screen, printed, never saved.

   The wording is the office's own, in plain words, following the order
   and fields of the Bent Ericksen forms Dr. A uses (their text isn't
   copied into this public code).
   ===================================================================== */
const OFFICE_ADDR = '320 NW 76th Drive, Gainesville, FL 32607', OFFICE_PHONE = '(352) 332-7466';
/* a form's sealed content, as JSON: the database takes each sealed copy up to 8,000 characters — 5,984 bytes before
   sealing (base64 of the bytes and the 16-byte seal) — so a little under that; and at most 40 lines of history */
const FORM_MAX = 5950;
const FORM_EVENTS = 40;
const CE_ITEMS = [['air', 'Airfare'], ['meals', 'Meals'], ['lodging', 'Accommodations'], ['ground', 'Ground transportation (fare, mileage, rentals)'], ['tuition', 'Tuition'], ['supplies', 'Supplies'], ['tips', 'Tips'], ['other', 'Other']];
const PAY_PER = [['period', 'Per pay period'], ['month', 'Per month']];
const COVERAGE = [['medical', 'Medical'], ['dental', 'Dental'], ['vision', 'Vision']];
const HAZARDS = [['cond', 'Hazardous condition'], ['proc', 'Hazardous procedure'], ['rules', 'Safety rules not followed']];

/* Field types: text, area, date, time, num, money, yesno, pick (one of opts), checks (any of opts), check (a box), dates
   (1–max days), pay (repayment rows {d, a}), say (a sentence of the form; {name}/{employer} filled in), aud (who reads it).
   need: required to send (staff part) or to sign/file (office part). if: 'k' (k is yes/ticked/has anything), ['k', v] (k is v,
   or k's list holds v). half/third: side by side on a computer. */
const FORMS = {
  accident: {
    id: 'accident', title: 'Accident report', be: '412', icon: 'warn',
    blurb: 'An accident or injury at work. Fill it out the same day.',
    kind: 'send', aud: 'hr', sign: { staff: false, hr: true }, decide: 'file', act: 'Sign and file', done: 'Filed',
    parts: [
      { by: 'staff', fields: [
        { k: 'position', t: 'text', l: 'Your position', p: 'Position', need: true, max: 80, ph: 'e.g. Clinical assistant' },
        { k: 'day', t: 'date', l: 'Date of the accident', need: true, past: true, half: true },
        { k: 'time', t: 'time', l: 'Time', need: true, half: true },
        { k: 'where', t: 'text', l: 'Where it happened', need: true, max: 150, ph: 'e.g. Sterilization, by the autoclave' },
        { k: 'witness', t: 'text', l: 'Witness', max: 120, hint: 'Who saw it. Leave blank if nobody did.' },
        { k: 'how', t: 'area', l: 'What happened', need: true, max: 1200, hint: 'How the accident happened, step by step.' },
        { k: 'cause', t: 'area', l: 'What caused the accident or injury', need: true, max: 600 },
        { k: 'injury', t: 'area', l: 'Type of illness or injury', need: true, max: 400, rows: 2, ph: 'e.g. Cut on the left index finger' },
        { k: 'treated', t: 'yesno', l: 'Did you get medical treatment?', p: 'Medical treatment received?', need: true },
        { k: 'treatedBy', t: 'text', l: 'Treated by', need: true, max: 150, if: 'treated' },
        { k: 'doctor', t: 'area', l: 'Doctor’s name, address and phone', max: 300, rows: 2, if: 'treated' }
      ] },
      { by: 'hr', h: 'Office use', fields: [
        { k: 'authorized', t: 'yesno', l: 'Treatment authorized by the office?', need: true },
        { k: 'leave', t: 'yesno', l: 'Sick leave or unpaid leave used?', need: true },
        { k: 'leaveFrom', t: 'date', l: 'First day of leave', half: true, if: 'leave' },
        { k: 'backOn', t: 'date', l: 'Back at work on', half: true, if: 'leave' },
        { k: 'sickDays', t: 'num', l: 'Days of sick leave used', half: true, min: 0, max: 365, step: 0.5, if: 'leave' },
        { k: 'unpaidDays', t: 'num', l: 'Days of unpaid leave used', half: true, min: 0, max: 365, step: 0.5, if: 'leave' },
        { k: 'prevent', t: 'area', l: 'Steps taken so it doesn’t happen again', need: true, max: 800 },
        { k: 'unsafe', t: 'yesno', l: 'Is there still an unsafe condition?', need: true },
        { k: 'wc', t: 'date', l: 'Reported to the workers’ comp insurer on', hint: 'Florida: an employer reports a work injury to its workers’ comp insurer within 7 days of learning about it.' }
      ] }
    ],
    sum: f => [f.day ? fmtDate(f.day) : '', f.where].filter(Boolean).join(' · ')
  },
  hazard: {
    id: 'hazard', title: 'Safety or health hazard report', short: 'Hazard report', be: '411', icon: 'warn',
    blurb: 'An unsafe condition, an unsafe way of doing something, or safety rules not being followed.',
    kind: 'send', aud: 'hr', anon: true, sign: { staff: false, hr: true }, decide: 'file', act: 'Sign and close', done: 'Closed',
    parts: [
      { by: 'staff', fields: [
        { k: 'anon', t: 'check', l: 'Leave my name off this report', hint: 'Your name won’t show on it in the app or on the printout. The database still records which login sent it, so it isn’t fully anonymous.' },
        { k: 'type', t: 'checks', l: 'Type of hazard', need: true, opts: HAZARDS },
        { k: 'time', t: 'time', l: 'Time noticed', half: true },
        { k: 'place', t: 'text', l: 'Place', need: true, max: 120, half: true },
        { k: 'desc', t: 'area', l: 'Description of the hazard', need: true, max: 1000 },
        { k: 'rec', t: 'area', l: 'What you recommend', p: 'Action recommended', max: 800 }
      ] },
      { by: 'hr', h: 'Action taken by the employer', fields: [
        { k: 'disp', t: 'area', l: 'What was done about it', need: true, max: 1000 },
        { k: 'final', t: 'date', l: 'Date of final disposition', need: true, half: true },
        { k: 'told', t: 'date', l: 'Staff told how it was handled on', half: true }
      ] }
    ],
    pr: { received: true },
    sum: f => [f.place, (f.type || []).map(k => optLabel(HAZARDS, k).toLowerCase()).join(', ')].filter(Boolean).join(' · ')
  },
  overtime: {
    id: 'overtime', title: 'Request to work overtime', short: 'Overtime request', be: '431', icon: 'clock',
    blurb: 'Ask before working more than 40 hours in a week.',
    kind: 'send', aud: 'hr', sign: { staff: true, hr: true }, decide: 'approve', act: 'Approve and sign', done: 'Approved', denyL: 'Explanation',
    parts: [
      { by: 'staff', fields: [
        { k: 'days', t: 'dates', l: 'Date or dates', need: true, max: 3 },
        { k: 'why', t: 'area', l: 'Why the overtime is needed', need: true, max: 600 },
        { k: 'overDay', t: 'num', l: 'Hours over 8 in a day', min: 0, max: 24, step: 0.25, third: true, hint: 'If it applies.' },
        { k: 'overWeek', t: 'num', l: 'Hours over 40 in the week', min: 0, max: 80, step: 0.25, third: true },
        { k: 'total', t: 'num', l: 'Total overtime hours', need: true, min: 0.25, max: 100, step: 0.25, third: true }
      ] }
    ],
    sum: f => (f.days || []).map(fmtDate).join(', ') + (f.total ? ' · ' + hrs(f.total) + ' h' : '')
  },
  ce: {
    id: 'ce', title: 'Continuing education reimbursement', short: 'CE reimbursement', be: '407', icon: 'money',
    blurb: 'Before a course or seminar: agree on which costs the office pays back.',
    kind: 'send', aud: 'hr', sign: { staff: true, hr: true }, decide: 'approve', act: 'Approve and sign', done: 'Approved',
    parts: [
      { by: 'staff', fields: [
        { k: 'course', t: 'text', l: 'Course, seminar or training (its title)', need: true, max: 200 },
        { k: 'from', t: 'date', l: 'First day', need: true, half: true },
        { k: 'to', t: 'date', l: 'Last day', half: true, hint: 'If it’s more than one day.' },
        { k: 'where', t: 'text', l: 'Where', max: 120, ph: 'City, or online' },
        { k: 'items', t: 'checks', l: 'Costs to be paid back', need: true, opts: CE_ITEMS },
        { k: 'itemsOther', t: 'text', l: 'Other cost', need: true, max: 120, if: ['items', 'other'] },
        { k: 'cost', t: 'money', l: 'About how much in all', max: 100000, hint: 'Optional. It helps Dr. A decide.' },
        { t: 'say', s: 'I pay these costs first and then ask to be paid back. Agreed costs are paid back within a reasonable time after I show that I finished the course and give copies of my receipts.' }
      ] },
      { by: 'hr', h: 'Office use', fields: [
        { k: 'ok', t: 'checks', l: 'Costs the office will pay back', opts: CE_ITEMS, from: 'items', hint: 'Untick any the office won’t pay.' },
        { k: 'perDiem', t: 'money', l: 'Per-diem for daily costs such as meals', max: 10000, hint: 'Paid instead of dollar for dollar for those costs. Leave blank for none.' }
      ] }
    ],
    sum: f => [f.course, f.from ? fmtDate(f.from) + (f.to && f.to !== f.from ? '–' + fmtDate(f.to) : '') : ''].filter(Boolean).join(' · ')
  },
  deduct: {
    id: 'deduct', title: 'Payroll deduction authorization', short: 'Payroll deduction', be: '425', icon: 'money',
    blurb: 'Your share of a medical, dental or vision premium, taken out of your paycheck.',
    kind: 'send', aud: 'owner', sign: { staff: true, hr: false }, decide: 'file', act: 'Mark as set up in payroll', done: 'Set up',
    one: ['self', 'fam'], oneMsg: 'Tick employee only, employee plus family, or both.',
    parts: [
      { by: 'staff', fields: [
        { t: 'say', s: 'I, {name}, authorize {employer} to take the following out of my paycheck:' },
        { k: 'self', t: 'check', l: 'Employee-only group insurance premium' },
        { k: 'selfAmt', t: 'money', l: 'Amount', need: true, half: true, max: 5000, if: 'self' },
        { k: 'selfPer', t: 'pick', l: 'How often', need: true, half: true, opts: PAY_PER, if: 'self' },
        { k: 'selfCov', t: 'checks', l: 'Coverage', need: true, opts: COVERAGE, if: 'self' },
        { k: 'fam', t: 'check', l: 'Employee plus spouse and/or dependents group insurance premium' },
        { k: 'famAmt', t: 'money', l: 'Amount', need: true, half: true, max: 5000, if: 'fam' },
        { k: 'famPer', t: 'pick', l: 'How often', need: true, half: true, opts: PAY_PER, if: 'fam' },
        { k: 'famCov', t: 'checks', l: 'Coverage', need: true, opts: COVERAGE, if: 'fam' },
        { t: 'say', s: 'The deduction starts on the first payday after I enroll in the plan.' },
        { t: 'say', s: 'If one paycheck is too small to cover it, what’s left comes out of later paychecks.' },
        { t: 'say', s: 'If the premium goes up, I authorize the office to change the deduction from the day the new premium starts.' },
        { t: 'say', s: 'If I leave the practice, my coverage lasts until the end of that month, so my share of that whole month, less anything already deducted that month, comes out of my last paycheck. Deductions will never take my hourly pay below the state minimum wage.' }
      ] }
    ],
    sum: f => [f.self ? money(f.selfAmt || 0) + ' ' + optLabel(PAY_PER, f.selfPer).toLowerCase() + ', employee only' : '', f.fam ? money(f.famAmt || 0) + ' ' + optLabel(PAY_PER, f.famPer).toLowerCase() + ', with family' : ''].filter(Boolean).join(' + ')
  },
  advance: {
    id: 'advance', title: 'Salary advance request', short: 'Salary advance', be: '', icon: 'money',
    blurb: 'Ask for an advance on your pay, and choose how you’ll pay it back.',
    kind: 'send', aud: 'owner', sign: { staff: true, hr: true }, decide: 'approve', act: 'Approve and sign', done: 'Approved',
    parts: [
      { by: 'staff', fields: [
        { k: 'amount', t: 'money', l: 'Amount', need: true, min: 1, max: 100000 },
        { k: 'repay', t: 'pick', l: 'How you’ll pay it back', p: 'Repayment', need: true, opts: [['pto', 'With paid time off as I earn it'], ['pay', 'With separate payments (cash or check)']] },
        { t: 'say', if: ['repay', 'pto'], s: 'As I earn paid time off, it goes toward the advance. I can’t use paid time off until the advance is paid back.' },
        { t: 'say', if: ['repay', 'pay'], s: 'I’ll pay it back in separate payments by cash or check, as in the table below, until nothing is owed. No interest is charged.' },
        { k: 'pays', t: 'pay', l: 'Payments', need: true, max: 6, of: 'amount', if: ['repay', 'pay'] },
        { t: 'say', s: 'I agree to this arrangement, which means I’ll owe this money to my employer.' },
        { t: 'say', s: 'I can pay faster or pay it all off early. A longer payment period or smaller payments have to be agreed in writing by both of us.' },
        { t: 'say', s: 'If my job ends for any reason before it’s paid back, what I still owe is due right away, and it may be taken out of my last paycheck as state and federal wage laws allow. If I don’t pay back what I owe, my employer may take legal action to collect it.' }
      ] }
    ],
    sum: f => money(f.amount || 0) + (f.repay === 'pto' ? ' · from paid time off' : f.repay === 'pay' ? ' · ' + plural((f.pays || []).length, 'payment') : '')
  },
  concern: {
    id: 'concern', title: 'Problem or concern', be: '', icon: 'note',
    blurb: 'Put a problem or concern in writing so it’s reviewed under the problem resolution procedure.',
    kind: 'send', aud: { def: 'owner', l: 'Directed to', owner: 'The employer (only Dr. A reads it)', hr: 'My manager', pr: true }, sign: { staff: true, hr: true }, decide: 'file', act: 'Sign the answer', done: 'Answered',
    parts: [
      { by: 'staff', fields: [
        { k: 'position', t: 'text', l: 'Your position', p: 'Position', need: true, max: 80 },
        { t: 'aud' },
        { t: 'say', s: 'This is my problem or concern, in writing. I ask that it be reviewed under the problem resolution procedure in the personnel policy manual.' },
        { k: 'reason', t: 'area', l: 'The reason for my concern', need: true, max: 1500 },
        { k: 'witness', t: 'area', l: 'Witnesses who can confirm what I’ve said', max: 300, rows: 2 },
        { k: 'fix', t: 'area', l: 'What I think would fix it', max: 800 }
      ] },
      { by: 'hr', h: 'Action taken by the employer', fields: [
        { k: 'action', t: 'area', l: 'What the office did', need: true, max: 1200 }
      ] }
    ],
    pr: { cc: true },
    sum: f => clip(f.reason, 90)
  },
  harass: {
    id: 'harass', title: 'Harassment or discrimination report', short: 'Harassment report', be: '421', icon: 'shield',
    blurb: 'Report harassment or discrimination. Only Dr. A reads it unless you choose otherwise.',
    kind: 'send', aud: { def: 'owner', l: 'Submitted to', pr: true }, sign: { staff: true, hr: true }, decide: 'file', act: 'Sign the resolution', done: 'Resolved',
    parts: [
      { by: 'staff', fields: [
        { k: 'day', t: 'date', l: 'Date of the incident', need: true, past: true, half: true },
        { k: 'witness', t: 'text', l: 'Witnesses', max: 200, half: true },
        { k: 'position', t: 'text', l: 'Your position', p: 'Position', need: true, max: 80, half: true },
        { k: 'manager', t: 'text', l: 'Your immediate manager or administrator', p: 'Immediate manager or administrator', max: 80, half: true },
        { t: 'aud' },
        { k: 'complaint', t: 'area', l: 'Your complaint', p: 'Statement of complaint', need: true, max: 600, hint: 'Be specific: the dates, times and names of the people involved.' },
        { k: 'what', t: 'area', l: 'What happened', p: 'Description of the incident(s)', need: true, max: 1400, hint: 'What each person did or said, you included.' },
        { k: 'acted', t: 'area', l: 'What you’ve done about it', p: 'Action taken', need: true, max: 1000, hint: 'What you said or did to resolve it yourself, and what happened after. If nothing, say why.' }
      ] },
      { by: 'hr', h: 'Complaint resolution', fields: [
        { k: 'resolution', t: 'area', l: 'How the complaint was resolved', need: true, max: 900, hint: 'Filled in by the person who looked into it.' }
      ] }
    ],
    pr: { received: true },
    sum: f => f.day ? 'Incident on ' + fmtDate(f.day) : ''
  },
  religious: {
    id: 'religious', title: 'Religious accommodation request', short: 'Religious accommodation', be: '429D', icon: 'heart',
    blurb: 'Ask for an accommodation because of a sincerely held religious belief.',
    kind: 'send', aud: { def: 'owner', l: 'Who reads it' }, sign: { staff: true, hr: false }, decide: 'file', act: 'Mark as received', done: 'Received', noteL: 'Reply',
    parts: [
      { by: 'staff', fields: [
        { k: 'title', t: 'text', l: 'Your job title', p: 'Job title', need: true, max: 80 },
        { t: 'aud' },
        { t: 'say', s: 'I ask for a reasonable accommodation because of my sincerely held religious belief. Because of that belief, I can’t follow these requirements of my job:' },
        { k: 'reqs', t: 'area', l: 'The requirements', p: 'Job requirements', need: true, max: 1200 },
        { k: 'belief', t: 'area', l: 'Your sincerely held religious belief', p: 'Statement of the sincerely held religious belief', need: true, max: 1500, hint: 'A statement or explanation of it.' },
        { k: 'docs', t: 'check', l: 'I’m giving Dr. A more documentation about my belief separately' }
      ] }
    ],
    sum: f => clip(f.reqs, 90)
  },
  /* printouts for a health care provider: Sections 1 and 2 filled in on screen; never saved */
  pregnancy: {
    id: 'pregnancy', title: 'Pregnancy leave or accommodation: provider’s certification', short: 'Pregnancy certification', be: '429B', icon: 'med',
    blurb: 'Print it for your health care provider to fill out and sign, then bring it back to Dr. A.',
    kind: 'print',
    parts: [
      { by: 'emp', h: 'Section 1 — the employer', fields: [
        { k: 'employer', t: 'text', l: 'Employer', max: 120, def: 'employer' },
        { k: 'contact', t: 'text', l: 'Employer contact', max: 120, def: 'contact' },
        { k: 'title', t: 'text', l: 'Your job title', max: 80, half: true },
        { k: 'sched', t: 'text', l: 'Regular work schedule', max: 120, half: true, def: 'sched' }
      ] },
      { by: 'staff', h: 'Section 2 — the employee', fields: [
        { k: 'name', t: 'text', l: 'Your name', max: 80, half: true, def: 'name' },
        { k: 'date', t: 'date', l: 'Date', half: true, def: 'today' },
        { k: 'reach', t: 'text', l: 'How to reach you (phone or email)', max: 120 }
      ] }
    ]
  },
  family: {
    id: 'family', title: 'Family member’s medical condition: provider’s certification', short: 'Family medical certification', be: '429A', icon: 'med',
    blurb: 'For leave to care for a seriously ill family member. Print it for their health care provider.',
    kind: 'print',
    parts: [
      { by: 'emp', h: 'Section 1 — the employer', fields: [
        { k: 'employer', t: 'text', l: 'Employer', max: 120, def: 'employer' },
        { k: 'contact', t: 'text', l: 'Employer contact', max: 120, def: 'contact' },
        { k: 'title', t: 'text', l: 'Your job title', max: 80, half: true },
        { k: 'sched', t: 'text', l: 'Regular work schedule', max: 120, half: true, def: 'sched' },
        { k: 'delay', t: 'text', l: 'If something keeps you from returning it in 15 days, contact', max: 120, def: 'contact' }
      ] },
      { by: 'staff', h: 'Section 2 — the employee', fields: [
        { k: 'patient', t: 'text', l: 'Name of the family member you’ll care for', max: 80 },
        { k: 'rel', t: 'pick', l: 'Their relationship to you', opts: [['close', 'Child under 18 (or 18 or older and unable to care for themselves because of a disability), parent or spouse'], ['other', 'Adult child able to care for themselves, parent-in-law, grandparent, grandchild, sibling, domestic partner, or someone else with a blood or family-like relationship to you (a “designated person”)']] },
        { k: 'name', t: 'text', l: 'Your name', max: 80, half: true, def: 'name' },
        { k: 'date', t: 'date', l: 'Date', half: true, def: 'today' }
      ] }
    ]
  }
};
const FORM_ORDER = ['accident', 'hazard', 'overtime', 'ce', 'deduct', 'advance', 'concern', 'harass', 'religious', 'pregnancy', 'family'];
const FORM_GROUPS = [['Report something', ['accident', 'hazard', 'concern', 'harass']], ['Ask or authorize', ['overtime', 'ce', 'advance', 'deduct', 'religious']], ['Print for a health care provider', ['pregnancy', 'family']]];

/* ---------- small helpers ---------- */
function optLabel(opts, k) { const x = (opts || []).find(o => o[0] === k); return x ? x[1] : (k == null ? '' : String(k)); }
function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
function formDef(id) { return Object.prototype.hasOwnProperty.call(FORMS, id) ? FORMS[id] : null; }
function formShort(id) { const D = formDef(id); return D ? D.short || D.title : 'Form'; }
/* every field with a key, in order, with the part it's in */
function formFields(D) { const out = []; (D.parts || []).forEach(p => (p.fields || []).forEach(fd => { if (fd.k) out.push(Object.assign({ by: p.by }, fd)); })); return out; }
function formField(D, k) { return formFields(D).find(fd => fd.k === k) || null; }
/* the audience a form can have: fixed ('hr' or 'owner'), or the person's pick (aud is an object with a default) */
function audPick(D) { return !!(D && D.aud && typeof D.aud === 'object'); }
function audDefault(D) { return audPick(D) ? D.aud.def : D && D.aud === 'owner' ? 'owner' : 'hr'; }
function audOk(D, a) { return audPick(D) ? (a === 'owner' || a === 'hr') : a === audDefault(D); }

/* whether a field shows, given the answers */
function fieldShown(fd, f) {
  if (!fd.if) return true;
  if (typeof fd.if === 'string') { const v = f[fd.if]; return Array.isArray(v) ? v.length > 0 : v === true || (typeof v === 'string' && v !== '') || (typeof v === 'number'); }
  const v = f[fd.if[0]], want = fd.if[1];
  if (Array.isArray(v)) return Array.isArray(want) ? want.some(w => v.includes(w)) : v.includes(want);
  return Array.isArray(want) ? want.includes(v) : v === want;
}
/* a value is filled in */
function filled(fd, v) {
  if (v == null) return false;
  switch (fd.t) {
    case 'text': case 'area': return typeof v === 'string' && v.trim() !== '';
    case 'yesno': return typeof v === 'boolean';
    case 'check': return v === true;
    case 'checks': case 'dates': case 'pay': return Array.isArray(v) && v.length > 0;
    case 'num': case 'money': return typeof v === 'number' && isFinite(v);
    default: return v !== '';
  }
}
/* a value is the right kind of thing (blank counts as fine; whether it's needed is formMissing's job) */
function okValue(fd, v) {
  if (v == null || v === '') return true;
  const max = fd.max;
  switch (fd.t) {
    case 'text': return typeof v === 'string' && v.length <= (max || 200);
    case 'area': return typeof v === 'string' && v.length <= (max || 1000);
    case 'date': return isISO(v);
    case 'time': return isHM(v);
    case 'num': return typeof v === 'number' && isFinite(v) && v >= (fd.min != null ? fd.min : 0) && v <= (max != null ? max : 1000);
    case 'money': return typeof v === 'number' && isFinite(v) && v >= 0 && v <= (max != null ? max : 1000000) && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
    case 'yesno': case 'check': return typeof v === 'boolean';
    case 'pick': return (fd.opts || []).some(o => o[0] === v);
    case 'checks': return Array.isArray(v) && v.length <= (fd.opts || []).length && v.every(x => (fd.opts || []).some(o => o[0] === x)) && new Set(v).size === v.length;
    case 'dates': return Array.isArray(v) && v.length <= (fd.max || 3) && v.every(isISO) && new Set(v).size === v.length;
    case 'pay': return Array.isArray(v) && v.length <= (fd.max || 6) && v.every(r => r && typeof r === 'object' && isISO(r.d) && typeof r.a === 'number' && isFinite(r.a) && r.a > 0 && r.a <= 100000);
    default: return false;
  }
}
/* what's still needed before it can be sent ('staff') or signed and filed ('hr'): [{k, l, msg?}] */
function formMissing(D, f, by) {
  const out = [];
  formFields(D).filter(fd => fd.by === by && fieldShown(fd, f)).forEach(fd => {
    const v = f[fd.k];
    if (fd.need && !filled(fd, v)) out.push({ k: fd.k, l: fd.l });
    else if (filled(fd, v) && !okValue(fd, v)) out.push({ k: fd.k, l: fd.l, msg: fd.l + ' doesn’t look right.' });
    else if (fd.t === 'date' && fd.past && isISO(v) && v > todayISO()) out.push({ k: fd.k, l: fd.l, msg: fd.l + ' can’t be in the future.' });
    else if (fd.t === 'pay' && filled(fd, v) && fd.of) { const total = round2(v.reduce((s, r) => s + r.a, 0)), owed = Number(f[fd.of]) || 0; if (Math.abs(total - owed) > 0.004) out.push({ k: fd.k, l: fd.l, msg: 'The payments add up to ' + money(total) + ', not ' + money(owed) + '.' }); }
  });
  if (by === 'staff' && D.one && !D.one.some(k => f[k] === true)) out.push({ k: D.one[0], l: '', msg: D.oneMsg || 'Pick at least one.' });
  return out;
}
function bytesOf(o) { return TE.encode(JSON.stringify(o)).length; }
/* a form's sealed content makes sense (anything else is treated like one that can't be opened) */
function okFormShape(c) {
  const D = c && formDef(c.form);
  if (!D || D.kind !== 'send' || c.kind !== 'form' || !c.f || typeof c.f !== 'object' || Array.isArray(c.f)) return false;
  if (!audOk(D, c.aud)) return false;
  for (const k of Object.keys(c.f)) {
    const fd = formField(D, k), v = c.f[k];
    if (fd) { if (!okValue(fd, v)) return false; }
    else if (!(v == null || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.length <= 2000))) return false; // a field from a newer copy of Time Off
  }
  const who = x => x == null || (typeof x === 'object' && typeof x.by === 'string' && x.by.length <= 40 && typeof x.at === 'number' && (x.n == null || (typeof x.n === 'string' && x.n.length <= 80)));
  if (c.sign != null && (typeof c.sign !== 'object' || !who(c.sign.staff) || !who(c.sign.hr))) return false;
  if (c.back != null && (!who(c.back) || (c.back.note != null && (typeof c.back.note !== 'string' || c.back.note.length > 600)))) return false;
  if (c.decision != null && (!who(c.decision) || (c.decision.note != null && (typeof c.decision.note !== 'string' || c.decision.note.length > 600)))) return false;
  if (c.events != null && (!Array.isArray(c.events) || c.events.length > 80 || !c.events.every(e => e && typeof e.a === 'string' && e.a.length <= 20))) return false;
  return typeof c.at === 'number';
}
function okForm(c) { return okFormShape(c) && bytesOf(c) <= FORM_MAX; }
/* why a form can't be saved, in words: the box the person saving it can shorten — by 'staff' (the sender: their part) or
   'hr' (the office: its part, or the note just written) */
function formTooBig(c, by) {
  const over = bytesOf(c) - FORM_MAX; if (over <= 0) return '';
  const D = formDef(c && c.form), f = (c && c.f) || {}, part = by === 'hr' ? 'hr' : 'staff', n = ' by about ' + Math.max(10, Math.ceil(over / 10) * 10) + ' characters.';
  const boxes = D ? formFields(D).filter(fd => fd.t === 'area' && fd.by === part && typeof f[fd.k] === 'string').map(fd => [fd.l, f[fd.k].length]) : [];
  const last = Array.isArray(c.events) ? c.events[c.events.length - 1] : null;
  if (part === 'hr' && last && typeof last.note === 'string' && last.note) boxes.push(['', last.note.length]);
  const top = boxes.sort((a, b) => b[1] - a[1])[0];
  return 'This form is longer than it can hold' + (!top ? '.' : top[0] ? ' — shorten “' + top[0] + '”' + n : ' — shorten your note' + n);
}

/* ---------- history ---------- */
/* one more event; a run of changes by the same person within half an hour counts once (the latest time) */
function formEvent(events, e) {
  const L = Array.isArray(events) ? events.slice() : [], last = L[L.length - 1];
  if (last && (e.a === 'edit' || e.a === 'save') && last.a === e.a && last.by === e.by && e.at - last.at < 30 * 60000) { L[L.length - 1] = Object.assign({}, last, { at: e.at }); return L; }
  L.push(e);
  // a long history keeps its first line (sent) and the latest ones, so the form always fits
  return L.length > FORM_EVENTS ? [L[0]].concat(L.slice(L.length - FORM_EVENTS + 1)) : L;
}
const FORM_EVT = { send: 'sent it', edit: 'changed it', resend: 'sent it again', back: 'sent it back for a change', save: 'saved the office part', file: 'signed and filed it', approve: 'approved and signed it', deny: 'didn’t approve it', withdraw: 'took it back', cancel: 'cancelled it', reseal: 'sealed it again', rekey: 'sealed it again (new HR key)' };
/* where a form stands: [words, the status chip's look] */
function formStatus(x) {
  const D = formDef(x.form) || {};
  if (x.status === 'pending') return x.back ? ['Sent back', 'bad'] : ['Waiting', 'wait'];
  if (x.status === 'approved') return [D.done || 'Done', 'ok'];
  if (x.status === 'denied') return ['Not approved', 'bad'];
  if (x.status === 'cancelled') return [x.decision && x.decision.by === x.sid ? 'Taken back' : 'Cancelled', 'off'];
  return [String(x.status || ''), 'off'];
}
/* a sentence of the form, with the person's name and the employer filled in */
function formSay(s, ctx) { return String(s).replace(/\{name\}/g, (ctx && ctx.name) || '________').replace(/\{employer\}/g, (ctx && ctx.employer) || OFFICE_NAME); }
