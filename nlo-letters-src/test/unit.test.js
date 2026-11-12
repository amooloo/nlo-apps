/* The letters' wording, the teeth and the directory import, without a browser. Every person here is made up.
   node test/unit.test.js */
const { load } = require('./load');
const L = load(['core.js', 'letters.js']);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' :: got ' + JSON.stringify(a) + ' wanted ' + JSON.stringify(b));
const cfg = L.officeCfg(null);
const draft = (id, o) => Object.assign(L.blankDraft(id, cfg), { first: 'Avery', last: 'Sample', dob: '2013-04-09', doc: L.cleanDoc({ first: 'Quinn', last: 'Example', practice: 'Example Oral Surgery', addr1: '9 Test Court', city: 'Ocala, FL 34474' }) }, o || {});

// ---- teeth: every tooth has the right name and FDI number ----
eq(Object.keys(L.TEETH).length, 52, '32 permanent + 20 primary teeth');
const names = { 1: ['upper right third molar', '18'], 3: ['upper right first molar', '16'], 5: ['upper right first premolar', '14'], 6: ['upper right canine', '13'], 8: ['upper right central incisor', '11'],
  9: ['upper left central incisor', '21'], 12: ['upper left first premolar', '24'], 16: ['upper left third molar', '28'], 17: ['lower left third molar', '38'], 21: ['lower left first premolar', '34'],
  24: ['lower left central incisor', '31'], 25: ['lower right central incisor', '41'], 28: ['lower right first premolar', '44'], 30: ['lower right first molar', '46'], 32: ['lower right third molar', '48'],
  A: ['primary upper right second molar', '55'], C: ['primary upper right canine', '53'], E: ['primary upper right central incisor', '51'], F: ['primary upper left central incisor', '61'], J: ['primary upper left second molar', '65'],
  K: ['primary lower left second molar', '75'], M: ['primary lower left canine', '73'], O: ['primary lower left central incisor', '71'], P: ['primary lower right central incisor', '81'], R: ['primary lower right canine', '83'], T: ['primary lower right second molar', '85'] };
Object.keys(names).forEach(id => { eq(L.TEETH[id].name, names[id][0], 'name of ' + id); eq(L.TEETH[id].fdi, names[id][1], 'FDI of ' + id); });
eq(new Set(Object.values(L.TEETH).map(t => t.fdi)).size, 52, 'no two teeth share an FDI number');
eq(new Set(Object.values(L.TEETH).map(t => t.name)).size, 52, 'no two teeth share a name');
eq(L.CHART_ROWS.upper.concat(L.CHART_ROWS.lower).sort((a, b) => a - b).join(), Array.from({ length: 32 }, (_, i) => i + 1).join(), 'the chart shows 1–32 once each');
eq(L.CHART_ROWS.upperPrimary.concat(L.CHART_ROWS.lowerPrimary).sort().join(''), 'ABCDEFGHIJKLMNOPQRST', 'the chart shows A–T once each');
ok(L.CHART_ROWS.upper.slice(0, 8).every(id => L.TEETH[id].right) && L.CHART_ROWS.lower.slice(0, 8).every(id => L.TEETH[id].right) && L.CHART_ROWS.lowerPrimary.slice(0, 5).every(id => L.TEETH[id].right), 'the patient’s right is on the left of every row');
eq(L.teethText(['28', '5', '21', '12', '5'], 'universal'), '#5 (upper right first premolar), #12 (upper left first premolar), #21 (lower left first premolar) and #28 (lower right first premolar)', 'teeth in mouth order, each once, number + name');
eq(L.teethText(['5', '28'], 'fdi'), '#14 (upper right first premolar) and #44 (lower right first premolar)', 'FDI numbers with the same names');
eq(L.teethText(['C'], 'universal'), '#C (primary upper right canine)', 'a primary tooth');
eq(L.teethText(['99', 'Z'], 'universal'), '', 'unknown teeth are ignored');

// ---- the extraction letter follows the office's Edge letter ----
let d = draft('extraction', { teeth: ['5', '12'], opt: { reason: ['crowding'], timing: 'before' } });
let body = L.letterBody(d, cfg);
eq(body[0], 'We are referring Avery to your office for the evaluation and extraction of the following teeth as part of their comprehensive orthodontic treatment plan.', 'extraction opening');
eq(body[1], 'We are requesting the extraction of #5 (upper right first premolar) and #12 (upper left first premolar) to relieve crowding.', 'extraction request');
ok(/before the braces are placed/.test(body[2]), 'timing sentence');
eq(body[body.length - 2], 'Please send your operative report and any relevant post-operative imaging to records@thenextlevelorthodontics.com.', 'report request');
eq(body[body.length - 1], 'Thank you for your expertise and collaboration in the comprehensive care of our patient.', 'closing');
d = draft('extraction', { teeth: ['5'] });
ok(/to facilitate their orthodontic treatment\.$/.test(L.letterBody(d, cfg)[1]), 'no reason picked → the Edge letter’s own reason');
d = draft('extraction');
ok(/\[choose the teeth\]/.test(L.letterText(d, cfg)), 'no teeth yet → a visible gap, not an empty sentence');
ok(L.draftProblems(Object.assign(d, { text: L.letterText(d, cfg) })).some(p => /teeth/.test(p)), 'and it is listed as a problem');

// ---- every letter reads as whole sentences with nothing picked and with everything picked ----
L.LETTERS.forEach(letter => {
  const none = draft(letter.id, { teeth: letter.teeth === L.TEETH_REQUIRED ? ['8'] : [] });
  const all = draft(letter.id, { teeth: letter.teeth === L.TEETH_NONE ? [] : ['8', '9'], opt: Object.fromEntries(letter.opts.map(o => [o.key, o.multi ? o.choices.map(c => c[0]) : o.choices[0][0]])) });
  [none, all].forEach((dr, i) => {
    const paras = L.letterBody(dr, cfg), text = paras.join('\n\n'), tag = letter.id + (i ? ' (all picked)' : ' (nothing picked)');
    ok(paras.length >= 3, tag + ' has an opening, a request and a closing');
    ok(paras.every(p => /^[A-Z“]/.test(p) && /[.]$/.test(p)), tag + ' every paragraph starts with a capital and ends with a full stop :: ' + JSON.stringify(paras.filter(p => !(/^[A-Z“]/.test(p) && /[.]$/.test(p)))));
    ok(!/undefined|null|\{first\}|\{First\}|  |\s[.,]| \.|\.\./.test(text), tag + ' has no gaps or leftovers :: ' + text);
    ok(text.includes('Avery'), tag + ' names the patient');
    ok(text.includes(cfg.records), tag + ' says where to send the report');
    ok(!/\b(he|she|his|her|him)\b/i.test(text), tag + ' never guesses the patient’s gender');
  });
  ok(letter.opts.every(o => new Set(o.choices.map(c => c[0])).size === o.choices.length), letter.id + ' choice keys are unique');
});
eq(L.LETTERS.map(l => l.id), ['extraction', 'hygiene', 'exposure', 'orthognathic', 'bonding', 'cavity', 'radiographic', 'tads', 'marpe'], 'the nine letters Dr. A asked for');
d = draft('cavity', { teeth: ['30'], opt: { surface: ['m', 'o'], how: 'xray' } });
ok(L.letterBody(d, cfg)[1] === 'We noted an area of concern on the mesial and occlusal surfaces of #30 (lower right first molar) on a radiograph taken in our office.', 'cavity: surfaces + tooth + how :: ' + L.letterBody(d, cfg)[1]);
d = draft('radiographic', { opt: { finding: 'lucent', region: 'lr', image: 'pano' } });
ok(L.letterBody(d, cfg)[1].startsWith('A radiolucent area was noted in the lower right on a panoramic radiograph.') && /have not made a diagnosis/.test(L.letterBody(d, cfg)[1]), 'radiographic evaluation: region when no tooth; no diagnosis offered');
d = draft('radiographic', { teeth: ['19'], opt: { region: 'lr' } });
ok(/noted near #19 \(lower left first molar\)/.test(L.letterBody(d, cfg)[1]), 'radiographic evaluation: a picked tooth wins over the region');
d = draft('hygiene', { first: '' });
ok(L.letterBody(d, cfg)[0].includes('the patient’s oral hygiene'), 'no first name yet → “the patient”');

// ---- one tooth / several teeth ----
d = draft('extraction', { teeth: ['1'], opt: { reason: ['thirds'], timing: 'soon' } }); body = L.letterBody(d, cfg);
ok(/extraction of the following tooth as part/.test(body[0]) && /because the third molar lacks room/.test(body[1]) && /the extraction being completed/.test(body[2]), 'one tooth: singular all the way through :: ' + body.join(' | '));
d = draft('extraction', { teeth: ['1', '16'], opt: { reason: ['thirds'], timing: 'soon' } }); body = L.letterBody(d, cfg);
ok(/following teeth/.test(body[0]) && /third molars lack room/.test(body[1]) && /the extractions being completed/.test(body[2]), 'several teeth: plural');
d = draft('exposure', { teeth: ['6'], opt: { side: 'palatal', how: 'closed', chain: 'chain', note: ['space', 'traction'] } }); body = L.letterBody(d, cfg);
ok(/The tooth appears/.test(body[1]) && /chain to the tooth/.test(body[2]) && /Space for the tooth has/.test(body[3]) && /moving the tooth\.$/.test(body[3]), 'exposure, one tooth; the extra notes share a paragraph :: ' + body.join(' | '));
d.teeth = ['6', '11']; body = L.letterBody(d, cfg);
ok(/The teeth appear/.test(body[1]) && /chain to each tooth/.test(body[2]) && /end of each chain/.test(body[2]) && /Space for the teeth has/.test(body[3]) && /moving the teeth\.$/.test(body[3]), 'exposure, two teeth :: ' + body.join(' | '));
d = draft('bonding', { teeth: ['7'], opt: { reason: ['peg'], timing: 'during' } }); body = L.letterBody(d, cfg);
ok(/restore the tooth to its ideal width/.test(body[1]) && /remove the bracket from this tooth/.test(body[2]), 'bonding, one tooth');
d = draft('radiographic', { opt: { symptoms: 'asym', urgency: 'routine' } });
ok(L.letterBody(d, cfg)[2] === 'Avery reports no symptoms in the area. This can be evaluated at Avery’s next available appointment.', 'radiographic evaluation: symptoms are one or the other');

// ---- TADs and MARPE ----
d = draft('tads', { teeth: ['3', '4'], opt: { count: '1', site: ['buccal'], purpose: ['intrudeP'], size: 's8', load: 'now', note: ['supply', 'head'] } }); body = L.letterBody(d, cfg);
eq(body[0], 'We are referring Avery to your office for the placement of one temporary anchorage device (TAD) as part of their comprehensive orthodontic treatment plan.', 'TAD opening');
eq(body[1], 'We are requesting placement on the buccal side between the roots, between #3 (upper right first molar) and #4 (upper right second premolar), to provide anchorage for intrusion of the posterior teeth.', 'TAD site: two teeth → between them');
ok(/length of 8 mm\. We plan to load the TAD at the next orthodontic visit, so please let us know as soon as it is in place\./.test(body[2]) && /send the TAD with Avery/.test(body[3]) && /head of the TAD exposed/.test(body[3]) && /position of the TAD, to/.test(body[4]), 'one TAD: singular throughout :: ' + body.join(' | '));
d = draft('tads', { teeth: ['3'], opt: { count: '2', load: 'wait', note: ['supply'] } }); body = L.letterBody(d, cfg);
ok(/two temporary anchorage devices \(TADs\)/.test(body[0]) && body[1] === 'We are requesting placement next to #3 (upper right first molar).' && /load the TADs about two weeks/.test(body[2]) && /send the TADs with/.test(body[3]) && /each TAD/.test(body[4]), 'two TADs, one tooth → next to it :: ' + body.join(' | '));
d = draft('tads', { opt: { purpose: ['space'] } });
eq(L.letterBody(d, cfg)[1], 'We are requesting placement to provide anchorage for space closure.', 'TADs: purpose alone');
d = draft('marpe', { opt: { count: '4', appliance: 'in', engage: 'bi', length: 'send', reason: ['narrow', 'airway'], note: ['noturn', 'see'] } }); body = L.letterBody(d, cfg);
eq(body[0], 'We are referring Avery to your office for the placement of four miniscrews for a miniscrew-assisted rapid palatal expander (MARPE) as part of their comprehensive orthodontic treatment plan.', 'MARPE opening');
ok(body[1] === 'The expander is being used to correct a maxillary transverse deficiency and a restricted nasal airway.' && /through the guide slots/.test(body[2]) && /bicortical engagement\)\. We will send the miniscrews with Avery/.test(body[3]) && /do not activate the expander/.test(body[4]) && /length of each miniscrew/.test(body[5]), 'MARPE body :: ' + body.join(' | '));

// ---- exposure: adult teeth to uncover, plus teeth to remove at the same visit ----
d = draft('exposure', { teeth: ['6'], teeth2: ['C'], opt: { how: 'closed', chain: 'chain' } }); body = L.letterBody(d, cfg);
ok(/surgical exposure of #6 \(upper right canine\) as part/.test(body[0]), 'exposure names the adult tooth');
ok(body.includes('As part of the same plan, we are also requesting the extraction of #C (primary upper right canine) at the same visit.'), 'and asks for the baby tooth to come out at the same visit :: ' + body.join(' | '));
eq(L.letterSubject(d), 'Referral for Surgical Exposure and Extraction', 'the subject says both');
ok(/The tooth appears|chain to the tooth/.test(body.join(' ')), 'one tooth to uncover stays singular even with teeth to remove');
d = draft('exposure', { teeth: ['6'], teeth2: ['C', '5'] });
ok(L.letterBody(d, cfg).some(p => p.includes('extraction of #5 (upper right first premolar) and #C (primary upper right canine) at the same visit')), 'adult teeth can be removed too');
d = draft('exposure', { teeth: ['6'] });
ok(!/extraction/.test(L.letterText(d, cfg)) && L.letterSubject(d) === 'Referral for Surgical Exposure', 'nothing to remove → no extraction sentence, plain subject');
d = draft('exposure', { teeth: ['C'] });
ok(/\[choose the teeth\]/.test(L.letterText(d, cfg)) && L.draftProblems(d).some(p => /Pick the teeth/.test(p)), 'a baby tooth is never the tooth to uncover');
d = draft('exposure', { teeth: ['6'], teeth2: ['6'] });
ok(L.draftProblems(d).some(p => /both to uncover and to remove/.test(p)), 'the same tooth marked both ways is flagged');
d = draft('extraction', { teeth: ['C'], teeth2: ['5'] });
ok(!/#5/.test(L.letterText(d, cfg)) && L.letterSubject(d) === 'Referral for Extraction Request', 'other letters ignore the second list');

// ---- problems before printing ----
eq(L.draftProblems(L.blankDraft('', cfg)), ['Pick a letter.'], 'nothing picked');
d = draft('hygiene'); d.text = L.letterText(d, cfg);
eq(L.draftProblems(d), [], 'a complete hygiene letter has no problems');
ok(L.draftProblems(Object.assign(draft('hygiene'), { dob: '2099-01-01' })).some(p => /date of birth/.test(p)), 'a birth date in the future is caught');
ok(!L.validDob('2013-02-30') && L.validDob('2012-02-29') && !L.validDob('1850-01-01'), 'impossible dates are caught');
eq(L.fmtDob('2013-04-09'), '04/09/2013', 'DOB as Edge prints it');
eq(L.fmtLong('2026-11-12'), 'November 12, 2026', 'long date');

// ---- doctors ----
const doc = L.cleanDoc({ type: 'Oral Surgery', first: ' Quinn ', last: 'Example', practice: 'Example Oral Surgery', addr1: '9 Test Court', addr2: 'Suite 2', city: 'Ocala,  FL 34474', email: 'Surgery@ExampleOS.example.com' });
eq(L.docBlock(doc), ['Dr. Quinn Example', 'Example Oral Surgery', '9 Test Court', 'Suite 2', 'Ocala, FL 34474'], 'address block');
eq(L.docSalute(doc), 'Dear Dr. Example', 'greeting');
eq(doc.email, 'surgery@exampleos.example.com', 'email lower-cased');
const office = L.cleanDoc({ last: 'Dental', first: 'Aspen', practice: 'Aspen Dental', addr1: '1 Main St', city: 'Ocala, FL 34474' });
eq(L.docSalute(office), 'Dear Doctor', 'an office record (Edge files “Aspen Dental” as last/first) gets “Dear Doctor”');
eq(L.docBlock(office)[0], 'Aspen Dental', 'and is addressed to the office, not “Dr. Aspen Dental”');
eq(L.docSalute(L.cleanDoc({ last: 'Example', first: 'Quinn', salute: 'Quinn' })), 'Dear Quinn', 'a custom greeting');
eq(L.docSalute(null), 'Dear Doctor', 'no doctor yet');
eq(L.docBlock(L.cleanDoc({ first: 'Reeve', last: 'Sample', practice: 'Dr. Reeve Sample', addr1: '1 A St' })), ['Dr. Reeve Sample', '1 A St'], 'an office named after the doctor isn’t printed twice');
eq(L.cleanDoc({ type: 'Out of Town Dentist' }).type, 'Dentist', 'Edge’s “Out of Town Dentist” becomes Dentist');
ok(L.docMatches(doc, 'ocala quinn') && !L.docMatches(doc, 'gainesville'), 'search matches every word');

// ---- import from the Edge list ----
const csv = 'Type,Last,First,Practice,Address,City/State/Zip,Email,Phone,Edge note\r\n' +
  'Dentist,Sample,Jordan,Sample Family Dentistry,"100 Example Street, Suite B","Gainesville, FL 32608",office@sample.example.com,,\r\n' +
  'Dentist,Sample,Jordan,Sample Family Dentistry,"100 Example Street, Suite B","Gainesville, FL 32608",office@sample.example.com,,\r\n' +
  'Oral Surgery,Demo,Casey,,"1 Test Rd","Ocala, FL 34471",,(352) 555-0100,\r\n' +
  'Dentist,Mock,Riley,Mock Dental,"2 Test Rd","Ocala, FL 34471",mockdental.example.com,,office does not use email\r\n' +
  'Dentist,,,,,,,,\r\n';
const imp = L.docsFromCSV(csv);
eq(imp.docs.length, 3, 'three doctors (one repeat, one blank row dropped)'); eq(imp.skipped, 2, 'two rows skipped');
eq([imp.docs[0].addr1, imp.docs[0].addr2], ['100 Example Street', 'Suite B'], 'the suite goes on its own line');
eq(imp.docs[1].phone, '(352) 555-0100', 'phone kept');
ok(imp.docs[2].email === '' && /mockdental\.example\.com/.test(imp.docs[2].note) && /office does not use email/.test(imp.docs[2].note), 'a bad email is kept as a note, not as an email');
const back = L.docsFromCSV(L.docsToCSV(imp.docs));
eq(back.docs.map(L.docKey).sort(), imp.docs.map(L.docKey).sort(), 'export → import gives the same doctors');
ok(L.docsToCSV([L.cleanDoc({ last: '=HYPERLINK("x")' })]).includes('"\'=HYPERLINK'), 'export can’t smuggle a spreadsheet formula');

// ---- settings ----
eq(L.officeCfg({ doctor: '  ', records: 'x@example.com', letterhead: 'nope', notation: 'fdi' }), Object.assign({}, L.OFFICE_DEFAULTS, { records: 'x@example.com', notation: 'fdi' }), 'blank or unknown settings fall back to the defaults');

console.log((fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
