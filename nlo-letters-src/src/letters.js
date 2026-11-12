/* =====================================================================
   The letters themselves: the nine referral letters, the teeth, the
   doctor directory's shape and the Edge import. Pure functions — no
   page, no network — so every sentence can be tested without a browser.
   ===================================================================== */

/* What every letter is signed with. The owner can change these in Settings (kept sealed with the directory). */
const OFFICE_DEFAULTS = {
  doctor: 'Amir Akhavan, DMD, MS',
  practice: 'Next Level Orthodontics',
  addr1: '320 NW 76th Drive',
  addr2: 'Gainesville, FL 32607',
  phone: '(352) 332-7466',
  records: 'records@thenextlevelorthodontics.com',
  letterhead: 'logo',     // logo · side · plain
  notation: 'universal'   // universal · fdi
};
function officeCfg(saved) {
  const o = Object.assign({}, OFFICE_DEFAULTS);
  Object.keys(OFFICE_DEFAULTS).forEach(k => { if (saved && typeof saved[k] === 'string' && saved[k].trim()) o[k] = saved[k].trim(); });
  if (!LETTERHEADS.some(l => l[0] === o.letterhead)) o.letterhead = OFFICE_DEFAULTS.letterhead;
  if (!['universal', 'fdi'].includes(o.notation)) o.notation = OFFICE_DEFAULTS.notation;
  return o;
}
const LETTERHEADS = [
  ['logo', 'Logo centered', 'The NLO logo across the top with the address under it.'],
  ['side', 'Logo left, address right', 'A compact header that leaves more room for the letter.'],
  ['plain', 'Pre-printed paper', 'Leaves the top of the page blank for your printed letterhead.']
];

/* ---------- teeth ---------- */
/* Universal numbers 1–32 (permanent) and letters A–T (primary), as a US dental office writes them.
   Every tooth also has its plain name, and the letter always prints both — a number alone is too easy to misread. */
const TOOTH_KIND = ['third molar', 'second molar', 'first molar', 'second premolar', 'first premolar', 'canine', 'lateral incisor', 'central incisor'];
const PRIMARY_KIND = ['second molar', 'first molar', 'canine', 'lateral incisor', 'central incisor'];
const TEETH = (function () {
  const out = {};
  for (let n = 1; n <= 32; n++) {
    const upper = n <= 16, right = n <= 8 || n >= 25;
    const pos = n <= 8 ? n - 1 : n <= 16 ? 16 - n : n <= 24 ? n - 17 : 32 - n;           // 0 = third molar … 7 = central
    const quad = n <= 8 ? 1 : n <= 16 ? 2 : n <= 24 ? 3 : 4;
    out[String(n)] = { id: String(n), primary: false, upper, right, name: (upper ? 'upper ' : 'lower ') + (right ? 'right ' : 'left ') + TOOTH_KIND[pos], fdi: String(quad * 10 + (8 - pos)) };
  }
  'ABCDEFGHIJKLMNOPQRST'.split('').forEach((L, i) => {
    const upper = i < 10, right = i < 5 || i >= 15;
    const pos = i < 5 ? i : i < 10 ? 9 - i : i < 15 ? i - 10 : 19 - i;                     // 0 = second molar … 4 = central
    const quad = i < 5 ? 5 : i < 10 ? 6 : i < 15 ? 7 : 8;
    out[L] = { id: L, primary: true, upper, right, name: 'primary ' + (upper ? 'upper ' : 'lower ') + (right ? 'right ' : 'left ') + PRIMARY_KIND[pos], fdi: String(quad * 10 + (5 - pos)) };
  });
  return out;
})();
/* the chart's four rows, each left-to-right as you look at the patient (their right is on your left) */
const CHART_ROWS = {
  upper: Array.from({ length: 16 }, (_, i) => String(i + 1)),
  lower: Array.from({ length: 16 }, (_, i) => String(32 - i)),
  upperPrimary: 'ABCDEFGHIJ'.split(''),
  lowerPrimary: 'TSRQPONMLK'.split('')
};
const TOOTH_ORDER = CHART_ROWS.upper.concat(CHART_ROWS.upperPrimary, CHART_ROWS.lowerPrimary.slice().reverse(), CHART_ROWS.lower.slice().reverse());
function toothLabel(id, notation) { const t = TEETH[id]; if (!t) return ''; return '#' + (notation === 'fdi' ? t.fdi : t.id); }
function sortTeeth(ids) { return Array.from(new Set((ids || []).filter(id => TEETH[id]))).sort((a, b) => TOOTH_ORDER.indexOf(a) - TOOTH_ORDER.indexOf(b)); }
/* "#5 (upper right first premolar), #12 (upper left first premolar) and #21 (lower left first premolar)" */
function teethText(ids, notation) {
  return joinList(sortTeeth(ids).map(id => toothLabel(id, notation) + ' (' + TEETH[id].name + ')'));
}
function joinList(a) {
  a = (a || []).filter(Boolean);
  if (a.length < 2) return a[0] || '';
  if (a.length === 2) return a[0] + ' and ' + a[1];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}
function capFirst(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

/* ---------- the letters ---------- */
/* Each letter: who it usually goes to, whether it needs teeth picked, its clickable choices, and build(),
   which turns the choices into paragraphs. A choice is [key, button label, the words it puts in the letter].
   The wording follows the office's "Pt Extraction Request" merge letter (Edge, version 5, June 2026). */
const TEETH_NONE = 0, TEETH_OPTIONAL = 1, TEETH_REQUIRED = 2;
const LETTERS = [
  {
    id: 'extraction', label: 'Extraction', subject: 'Referral for Extraction Request', to: ['Dentist', 'Oral Surgery', 'Pediatric Dentistry'], teeth: TEETH_REQUIRED,
    blurb: 'Ask a dentist or oral surgeon to remove teeth.',
    opts: [
      { key: 'reason', label: 'Reason', multi: true, choices: [
        ['plan', 'Part of the treatment plan', 'to facilitate their orthodontic treatment'],
        ['crowding', 'Crowding', 'to relieve crowding'],
        ['retained', 'Retained primary teeth', 'because the primary teeth are retained and the permanent teeth need room to erupt'],
        ['thirds', 'Third molars', 'because the third molars lack room to erupt'],
        ['impacted', 'Impacted / ectopic', 'because the tooth is impacted or erupting out of position']] },
      { key: 'timing', label: 'Timing', choices: [
        ['soon', 'As soon as convenient', 'We would appreciate the extractions being completed at your earliest convenience so treatment can move forward.'],
        ['before', 'Before braces go on', 'Please complete the extractions before the braces are placed; we will schedule that appointment once we hear from your office.'],
        ['after', 'After braces go on', 'The braces are already in place, and space closure will begin once the extractions are complete.'],
        ['wait', 'We will call to time it', 'Please wait to schedule until our office calls to coordinate the timing.']] }
    ],
    build(c) {
      const why = joinList(c.words('reason')) || 'to facilitate their orthodontic treatment';
      return [
        'We are referring ' + c.first + ' to your office for the evaluation and extraction of the following ' + (c.one ? 'tooth' : 'teeth') + ' as part of their comprehensive orthodontic treatment plan.',
        'We are requesting the extraction of ' + c.teeth + ' ' + why + '.',
        c.word('timing'),
        'Please send your operative report and any relevant post-operative imaging to ' + c.records + '.'
      ];
    }
  },
  {
    id: 'hygiene', label: 'Oral hygiene', subject: 'Oral Hygiene During Orthodontic Treatment', to: ['Dentist', 'Pediatric Dentistry', 'Periodontics'], teeth: TEETH_NONE,
    blurb: 'Tell the dentist about hygiene problems and ask for help.',
    opts: [
      { key: 'finding', label: 'What we see', multi: true, choices: [
        ['plaque', 'Heavy plaque', 'heavy plaque accumulation'],
        ['gingivitis', 'Gingivitis', 'gingival inflammation'],
        ['overgrowth', 'Gum overgrowth', 'gingival overgrowth'],
        ['decalc', 'White spots', 'early decalcification (white spot lesions)'],
        ['calculus', 'Calculus', 'calculus buildup']] },
      { key: 'area', label: 'Where', choices: [
        ['all', 'Generalized', 'throughout the mouth'],
        ['uf', 'Upper front', 'around the upper front teeth'],
        ['lf', 'Lower front', 'around the lower front teeth'],
        ['back', 'Back teeth', 'around the back teeth'],
        ['gum', 'Along the gum line', 'along the gum line']] },
      { key: 'ask', label: 'What we are asking for', multi: true, choices: [
        ['cleaning', 'A cleaning', 'a professional cleaning'],
        ['recall', 'Shorter recall', 'a shorter recall interval (every three to four months) while the braces are on'],
        ['fluoride', 'Fluoride varnish', 'a fluoride varnish application'],
        ['paste', 'Rx fluoride toothpaste', 'a prescription-strength fluoride toothpaste'],
        ['ohi', 'Home-care coaching', 'reinforcement of home-care instructions']] },
      { key: 'note', label: 'Also say', multi: true, choices: [
        ['reviewed', 'We reviewed brushing', 'We have reviewed brushing and flossing with ' + '{first}' + ' and the family and will continue to reinforce it at each visit.'],
        ['risk', 'Treatment may stop early', 'If the hygiene does not improve, we may need to remove the braces early to protect the teeth.']] }
    ],
    build(c) {
      const seen = joinList(c.words('finding')) || 'areas of concern with the oral hygiene';
      const asks = joinList(c.words('ask')) || 'your evaluation and any care you feel is appropriate';
      return [
        'We are writing about ' + c.first + '’s oral hygiene during their orthodontic treatment.',
        'At their most recent visit we noted ' + seen + (c.word('area') ? ' ' + c.word('area') : '') + '.',
        'We would appreciate ' + asks + '.'
        , c.notes('note'), 'Please send any notes from the visit to ' + c.records + '.'
      ];
    }
  },
  {
    id: 'exposure', label: 'Exposure', subject: 'Referral for Surgical Exposure', to: ['Oral Surgery', 'Periodontics'], teeth: TEETH_REQUIRED,
    blurb: 'Ask a surgeon to uncover an impacted tooth.',
    opts: [
      { key: 'side', label: 'Where the tooth sits', choices: [
        ['buccal', 'Buccal / labial', 'The tooth appears to be positioned on the buccal (cheek) side.'],
        ['palatal', 'Palatal', 'The tooth appears to be positioned on the palatal side.'],
        ['lingual', 'Lingual', 'The tooth appears to be positioned on the lingual (tongue) side.'],
        ['unsure', 'Not certain', 'Its exact position is best confirmed on your imaging.']] },
      { key: 'how', label: 'Type of exposure', choices: [
        ['closed', 'Closed', 'We are requesting a closed exposure.'],
        ['open', 'Open', 'We are requesting an open exposure.'],
        ['either', 'Surgeon’s choice', 'We leave the choice of an open or a closed exposure to your judgment.']] },
      { key: 'chain', label: 'Attachment', choices: [
        ['chain', 'Bond a gold chain', 'Please bond a gold chain to the tooth at the time of surgery and leave the end of the chain accessible so we can begin traction.'],
        ['button', 'Bond a button', 'Please bond a button to the tooth at the time of surgery.'],
        ['none', 'We will bond it', 'No attachment is needed at surgery; we will bond one in our office once the tooth is uncovered.']] },
      { key: 'note', label: 'Also say', multi: true, choices: [
        ['space', 'Space is open', 'Space for the tooth has been opened orthodontically, and ' + '{first}' + ' is ready for the procedure.'],
        ['cbct', 'CBCT available', 'A CBCT scan taken in our office is available; please let us know if you would like it sent.'],
        ['traction', 'See us 1–2 weeks after', 'We would like to see ' + '{first}' + ' one to two weeks after surgery to begin moving the tooth.']] }
    ],
    build(c) {
      return [
        'We are referring ' + c.first + ' to your office for the evaluation and surgical exposure of ' + c.teeth + ' as part of their comprehensive orthodontic treatment plan.',
        [c.word('side'), c.word('how')].filter(Boolean).join(' '),
        c.word('chain')
        , c.notes('note'), 'Please send your operative report and any relevant post-operative imaging to ' + c.records + '.'
      ];
    }
  },
  {
    id: 'orthognathic', label: 'Orthognathic evaluation', subject: 'Referral for Orthognathic Surgery Evaluation', to: ['Oral Surgery'], teeth: TEETH_NONE,
    blurb: 'Ask an oral surgeon for a jaw-surgery opinion.',
    opts: [
      { key: 'finding', label: 'Our findings', multi: true, choices: [
        ['c2', 'Skeletal Class II', 'a skeletal Class II relationship'],
        ['c3', 'Skeletal Class III', 'a skeletal Class III relationship'],
        ['transverse', 'Narrow upper jaw', 'a maxillary transverse deficiency'],
        ['openbite', 'Open bite', 'an anterior open bite'],
        ['vme', 'Vertical excess', 'vertical maxillary excess'],
        ['asym', 'Asymmetry', 'facial asymmetry'],
        ['airway', 'Airway concern', 'a restricted airway']] },
      { key: 'ask', label: 'What we are asking for', multi: true, choices: [
        ['jaw', 'Jaw surgery opinion', 'an evaluation for orthognathic surgery'],
        ['sarpe', 'SARPE', 'an evaluation for surgically assisted palatal expansion'],
        ['airway', 'Airway evaluation', 'an airway evaluation'],
        ['tmj', 'TMJ evaluation', 'an evaluation of the temporomandibular joints']] },
      { key: 'stage', label: 'Where treatment stands', choices: [
        ['pre', 'Not started', '{First} has not started orthodontic treatment, and we would value your opinion before we finalize the treatment plan.'],
        ['mid', 'In pre-surgical braces', '{First} is currently in pre-surgical orthodontic treatment.'],
        ['ready', 'Ready for surgery planning', 'Pre-surgical orthodontic treatment is nearly complete, and ' + '{first}' + ' is ready for surgical planning.']] },
      { key: 'note', label: 'Also say', multi: true, choices: [
        ['records', 'Records available', 'Photographs, radiographs and digital models are available; please let us know what you would like sent.'],
        ['cbct', 'CBCT available', 'A CBCT scan taken in our office is available on request.']] }
    ],
    build(c) {
      const asks = joinList(c.words('ask')) || 'an evaluation for orthognathic surgery';
      const found = joinList(c.words('finding'));
      return [
        'We are referring ' + c.first + ' to your office for ' + asks + ' in conjunction with their orthodontic treatment.',
        found ? 'Our findings include ' + found + '.' : '',
        c.word('stage')
        , c.notes('note'), 'Please send your consultation report and recommendations to ' + c.records + '.'
      ];
    }
  },
  {
    id: 'bonding', label: 'Cosmetic bonding', subject: 'Referral for Cosmetic Bonding', to: ['Dentist', 'Prosthodontics'], teeth: TEETH_REQUIRED,
    blurb: 'Ask the dentist to build up or reshape teeth.',
    opts: [
      { key: 'reason', label: 'Reason', multi: true, choices: [
        ['peg', 'Peg / small laterals', 'to restore the teeth to their ideal width'],
        ['space', 'Close remaining space', 'to close the remaining spaces'],
        ['edges', 'Chipped or worn edges', 'to restore the chipped or worn incisal edges'],
        ['bolton', 'Tooth-size mismatch', 'to correct a tooth-size discrepancy between the upper and lower teeth'],
        ['shape', 'Reshape', 'to improve the shape of the teeth']] },
      { key: 'timing', label: 'Timing', choices: [
        ['during', 'Now, braces still on', 'The spaces have been set orthodontically and the braces are still in place. If it would help, we can remove the brackets from these teeth before the appointment; please have your office call us.'],
        ['debond', 'Right after braces come off', 'The braces are scheduled to come off soon, and we would like the bonding completed shortly after that visit.'],
        ['done', 'Treatment is finished', 'Orthodontic treatment is complete and retainers have been delivered. We will make new retainers once the bonding is finished.']] },
      { key: 'note', label: 'Also say', multi: true, choices: [
        ['sizes', 'Space sizes on request', 'We are glad to send the measured space for each tooth if that would be helpful.'],
        ['retainer', 'Call us when done', 'Please let us know when the bonding is complete so we can adjust or remake the retainers.']] }
    ],
    build(c) {
      const why = joinList(c.words('reason')) || 'to complete the esthetic result';
      return [
        'We are referring ' + c.first + ' to your office for cosmetic bonding in coordination with their orthodontic treatment.',
        'We are requesting bonding of ' + c.teeth + ' ' + why + '.',
        c.word('timing')
        , c.notes('note'), 'Please send a note when treatment is complete to ' + c.records + '.'
      ];
    }
  },
  {
    id: 'cavity', label: 'Evaluation for cavity', subject: 'Referral for Evaluation of Possible Decay', to: ['Dentist', 'Pediatric Dentistry'], teeth: TEETH_OPTIONAL,
    blurb: 'Ask the dentist to check a suspicious spot.',
    opts: [
      { key: 'surface', label: 'Surface', multi: true, choices: [
        ['m', 'Mesial', 'mesial'], ['d', 'Distal', 'distal'], ['o', 'Occlusal', 'occlusal'], ['b', 'Buccal / facial', 'buccal'], ['l', 'Lingual', 'lingual']] },
      { key: 'how', label: 'How we saw it', choices: [
        ['clinical', 'Looking in the mouth', 'on clinical examination'],
        ['xray', 'On an x-ray', 'on a radiograph taken in our office'],
        ['both', 'Both', 'on clinical examination and on a radiograph taken in our office']] },
      { key: 'note', label: 'Also say', multi: true, choices: [
        ['wire', 'We can remove the wire', 'We are happy to remove the archwire or a bracket before the appointment if that would help; please have your office call us.'],
        ['image', 'Image enclosed', 'The image is enclosed for your review.'],
        ['pain', 'Patient has symptoms', '{First} reports sensitivity in the area.'],
        ['hold', 'Ortho continues', 'Orthodontic treatment will continue as planned unless you advise otherwise.']] }
    ],
    build(c) {
      const surf = joinList(c.words('surface'));
      const where = c.teeth ? 'on ' + (surf ? 'the ' + surf + ' surface' + (c.words('surface').length > 1 ? 's' : '') + ' of ' : '') + c.teeth : '';
      return [
        'We are referring ' + c.first + ' to your office for the evaluation of possible decay noted during their orthodontic treatment.',
        'We noted an area of concern ' + ([where, c.word('how')].filter(Boolean).join(' ') || 'at a recent visit') + '.',
        c.notes('note'), 'Please send your findings and a note of any treatment provided to ' + c.records + '.'
      ];
    }
  },
  {
    id: 'radiolucency', label: 'Radiolucency', subject: 'Referral for Evaluation of a Radiographic Finding', to: ['Dentist', 'Oral Surgery', 'Endodontics'], teeth: TEETH_OPTIONAL,
    blurb: 'Ask for a finding on an x-ray to be evaluated.',
    opts: [
      { key: 'finding', label: 'What we saw', choices: [
        ['lucent', 'Radiolucent area', 'A radiolucent area'],
        ['opaque', 'Radiopaque area', 'A radiopaque area'],
        ['mixed', 'Mixed area', 'An area of mixed radiolucency and radiopacity']] },
      { key: 'region', label: 'Region (if not tied to a tooth)', choices: [
        ['ur', 'Upper right', 'in the upper right'], ['ua', 'Upper front', 'in the upper anterior region'], ['ul', 'Upper left', 'in the upper left'],
        ['lr', 'Lower right', 'in the lower right'], ['la', 'Lower front', 'in the lower anterior region'], ['ll', 'Lower left', 'in the lower left']] },
      { key: 'image', label: 'Seen on', choices: [
        ['pano', 'Panoramic x-ray', 'a panoramic radiograph'],
        ['cbct', 'CBCT', 'a CBCT scan'],
        ['ceph', 'Ceph', 'a cephalometric radiograph'],
        ['pa', 'Periapical', 'a periapical radiograph']] },
      { key: 'urgency', label: 'How soon', choices: [
        ['soon', 'As soon as possible', 'We recommend that ' + '{first}' + ' be seen at your earliest convenience.'],
        ['routine', 'Routine', 'This can be evaluated at ' + '{first}' + '’s next available appointment.']] },
      { key: 'symptoms', label: 'Symptoms', choices: [
        ['asym', 'None', '{First} reports no symptoms in the area.'],
        ['sym', 'Has symptoms', '{First} reports symptoms in the area.']] },
      { key: 'note', label: 'Also say', multi: true, choices: [
        ['image', 'Image enclosed', 'The image is enclosed for your review.'],
        ['hold', 'Ortho on hold there', 'Tooth movement in this area is on hold until we hear from you.']] }
    ],
    build(c) {
      const where = c.teeth ? 'near ' + c.teeth : (c.word('region') || '');
      return [
        'We are referring ' + c.first + ' to your office for the evaluation of a radiographic finding noted on imaging taken in our office.',
        (c.word('finding') || 'A radiographic finding') + ' was noted' + (where ? ' ' + where : '') + ' on ' + (c.word('image') || 'a radiograph') + '. We have not made a diagnosis and defer to your evaluation.',
        [c.word('symptoms'), c.word('urgency')].filter(Boolean).join(' '),
        c.notes('note'),
        'Please send your findings and recommendations to ' + c.records + '.'
      ];
    }
  },
  {
    id: 'tads', label: 'TAD placement', subject: 'Referral for Placement of Temporary Anchorage Devices (TADs)', to: ['Oral Surgery', 'Periodontics'], teeth: TEETH_OPTIONAL,
    blurb: 'Ask a surgeon or periodontist to place TADs.', teethHint: 'Click the teeth each TAD goes next to or between.',
    opts: [
      { key: 'count', label: 'How many', choices: [
        ['1', '1', 'one temporary anchorage device (TAD)'], ['2', '2', 'two temporary anchorage devices (TADs)'],
        ['3', '3', 'three temporary anchorage devices (TADs)'], ['4', '4', 'four temporary anchorage devices (TADs)']] },
      { key: 'site', label: 'Where', multi: true, choices: [
        ['buccal', 'Buccal, between the roots', 'on the buccal side between the roots'],
        ['palatal', 'Palatal, between the roots', 'on the palatal side between the roots'],
        ['paramedian', 'Palate, beside the midline', 'in the anterior palate beside the midline'],
        ['izc', 'Infrazygomatic crest', 'at the infrazygomatic crest'],
        ['shelf', 'Buccal shelf', 'at the mandibular buccal shelf'],
        ['anterior', 'Front, between the incisors', 'between the roots of the incisors']] },
      { key: 'purpose', label: 'What they are for', multi: true, choices: [
        ['space', 'Closing space', 'space closure'],
        ['distal', 'Distalization', 'distalization of the posterior teeth'],
        ['mesial', 'Protraction', 'protraction of the posterior teeth'],
        ['intrudeP', 'Molar intrusion', 'intrusion of the posterior teeth'],
        ['intrudeA', 'Front intrusion', 'intrusion of the anterior teeth'],
        ['traction', 'Pulling an impacted tooth', 'traction of an impacted tooth']] },
      { key: 'size', label: 'Size', choices: [
        ['s6', '6 mm', 'We suggest a length of 6 mm.'], ['s8', '8 mm', 'We suggest a length of 8 mm.'], ['s10', '10 mm', 'We suggest a length of 10 mm.'],
        ['yours', 'Their choice', 'We leave the diameter and length to your judgment.']] },
      { key: 'load', label: 'When we will use them', choices: [
        ['now', 'Right away', 'We plan to load the TADs at the next orthodontic visit, so please let us know as soon as they are in place.'],
        ['wait', 'After two weeks', 'We plan to load the TADs about two weeks after placement.']] },
      { key: 'note', label: 'Also say', multi: true, choices: [
        ['supply', 'We send the TADs', 'We will send the TADs with ' + '{first}' + ' to the appointment.'],
        ['guide', 'We send a guide', 'A printed surgical guide made from the CBCT will come with ' + '{first}' + ' to the appointment.'],
        ['cbct', 'CBCT available', 'A CBCT scan taken in our office is available; please let us know if you would like it sent.'],
        ['head', 'Head must take elastics', 'Please leave the head of each TAD exposed so we can attach elastics or a coil spring.'],
        ['braces', 'Braces are on', 'The braces are in place; we are happy to remove an archwire before the appointment if that would help.']] }
    ],
    build(c) {
      const many = (c.pick('count') || '2') !== '1';
      const what = c.word('count') || 'temporary anchorage devices (TADs)';
      const where = [joinList(c.words('site')), c.teeth ? (c.count === 2 ? 'between ' : 'next to ') + c.teeth : ''].filter(Boolean).join(', ');
      const why = joinList(c.words('purpose'));
      const fix = s => many ? s : s.replace('load the TADs', 'load the TAD').replace('as soon as they are in place', 'as soon as it is in place').replace('send the TADs', 'send the TAD').replace('the head of each TAD', 'the head of the TAD');
      return [
        'We are referring ' + c.first + ' to your office for the placement of ' + what + ' as part of their comprehensive orthodontic treatment plan.',
        where || why ? 'We are requesting placement' + (where ? ' ' + where : '') + (why ? (where ? ', ' : ' ') + 'to provide anchorage for ' + why : '') + '.' : '',
        [c.word('size'), fix(c.word('load'))].filter(Boolean).join(' '),
        fix(c.notes('note')),
        'Please send a note of the placement, including the size and position of ' + (many ? 'each TAD' : 'the TAD') + ', to ' + c.records + '.'
      ];
    }
  },
  {
    id: 'marpe', label: 'TADs for MARPE', subject: 'Referral for Placement of MARPE Miniscrews', to: ['Oral Surgery', 'Periodontics'], teeth: TEETH_NONE,
    blurb: 'Ask a surgeon to place the miniscrews for a MARPE expander.',
    opts: [
      { key: 'count', label: 'How many miniscrews', choices: [
        ['4', '4', 'four miniscrews'], ['2', '2', 'two miniscrews'], ['6', '6', 'six miniscrews']] },
      { key: 'appliance', label: 'The expander', choices: [
        ['in', 'Already cemented', 'The expander is cemented in place. Please place the miniscrews through the guide slots in the body of the expander.'],
        ['bring', 'Comes with the patient', 'The expander will come with ' + '{first}' + ' to the appointment. Please seat it on the molar bands and place the miniscrews through the guide slots in its body.'],
        ['together', 'We come and seat it', 'We would like to coordinate the appointment so that we can seat the expander ourselves just before the miniscrews are placed.']] },
      { key: 'engage', label: 'How deep', choices: [
        ['bi', 'Both cortices', 'Please engage both the palatal and the nasal cortex with each miniscrew (bicortical engagement).'],
        ['yours', 'Their choice', 'We leave the depth of engagement to your judgment.']] },
      { key: 'length', label: 'Lengths', choices: [
        ['send', 'We send the screws', 'We will send the miniscrews with ' + '{first}' + '; the lengths were chosen from measurements on the CBCT.'],
        ['listed', 'Listed below', 'The lengths we measured on the CBCT are listed below.'],
        ['yours', 'Their choice', 'We leave the lengths of the miniscrews to your judgment.']] },
      { key: 'reason', label: 'Why MARPE', multi: true, choices: [
        ['narrow', 'Narrow upper jaw', 'a maxillary transverse deficiency'],
        ['crossbite', 'Posterior crossbite', 'a posterior crossbite'],
        ['airway', 'Airway', 'a restricted nasal airway'],
        ['crowding', 'Crowding', 'crowding']] },
      { key: 'note', label: 'Also say', multi: true, choices: [
        ['noturn', 'Do not turn the screw', 'Please do not activate the expander; we will begin the turns at our office.'],
        ['cbct', 'CBCT available', 'A CBCT scan taken in our office is available; please let us know if you would like it sent.'],
        ['see', 'See us right after', 'We would like to see ' + '{first}' + ' within a few days of placement to begin expansion.'],
        ['suture', 'Suture is still open', 'The midpalatal suture appears patent on the CBCT.']] }
    ],
    build(c) {
      const why = joinList(c.words('reason'));
      return [
        'We are referring ' + c.first + ' to your office for the placement of ' + (c.word('count') || 'the miniscrews') + ' for a miniscrew-assisted rapid palatal expander (MARPE) as part of their comprehensive orthodontic treatment plan.',
        why ? 'The expander is being used to correct ' + why + '.' : '',
        c.word('appliance'),
        [c.word('engage'), c.word('length')].filter(Boolean).join(' '),
        c.notes('note'),
        'Please send a note of the placement, including the length of each miniscrew, to ' + c.records + '.'
      ];
    }
  }
];
const THANKS = 'Thank you for your expertise and collaboration in the comprehensive care of our patient.';
function letterById(id) { return LETTERS.find(l => l.id === id) || null; }

/* a blank letter in progress (never saved anywhere) */
function blankDraft(letterId, cfg) {
  return { letter: letterId || '', first: '', last: '', dob: '', rpPhone: '', docId: '', doc: null, teeth: [], opt: {}, text: '', edited: false,
    letterhead: (cfg && cfg.letterhead) || OFFICE_DEFAULTS.letterhead, notation: (cfg && cfg.notation) || OFFICE_DEFAULTS.notation, date: '', images: [] };
}
/* the choice's words, with the patient's first name filled in */
function fillName(s, first) { const f = first || 'the patient'; return String(s || '').replace(/\{First\}/g, capFirst(f)).replace(/\{first\}/g, f); }
function picked(letter, draft, key) {
  const o = letter.opts.find(x => x.key === key); if (!o) return [];
  const v = draft.opt[key]; const keys = o.multi ? (Array.isArray(v) ? v : []) : (v ? [v] : []);
  return o.choices.filter(ch => keys.includes(ch[0]));
}
/* The choices are written for the usual case (several teeth out, one tooth uncovered); this makes them agree with how many teeth were picked. */
const ONE_TOOTH = [['the extractions being completed', 'the extraction being completed'], ['complete the extractions', 'complete the extraction'], ['once the extractions are complete', 'once the extraction is complete'],
  ['because the primary teeth are retained and the permanent teeth need room', 'because the primary tooth is retained and the permanent tooth needs room'], ['because the third molars lack room', 'because the third molar lacks room'],
  ['to restore the teeth to their ideal width', 'to restore the tooth to its ideal width'], ['to improve the shape of the teeth', 'to improve the shape of the tooth'], ['remove the brackets from these teeth', 'remove the bracket from this tooth']];
const MANY_TEETH = [['The tooth appears to be positioned', 'The teeth appear to be positioned'], ['Its exact position is best confirmed', 'Their exact positions are best confirmed'],
  ['bond a gold chain to the tooth', 'bond a gold chain to each tooth'], ['leave the end of the chain accessible', 'leave the end of each chain accessible'], ['bond a button to the tooth', 'bond a button to each tooth'],
  ['we will bond one in our office once the tooth is uncovered', 'we will bond them in our office once the teeth are uncovered'], ['Space for the tooth has been opened', 'Space for the teeth has been opened'],
  ['to begin moving the tooth', 'to begin moving the teeth'], ['because the tooth is impacted or erupting out of position', 'because the teeth are impacted or erupting out of position']];
function toothCount(s, n) { (n === 1 ? ONE_TOOTH : n > 1 ? MANY_TEETH : []).forEach(([a, b]) => { s = s.split(a).join(b); }); return s; }
/* the body of the letter as paragraphs (no greeting, no closing) */
function letterBody(draft, cfg) {
  const letter = letterById(draft.letter); if (!letter) return [];
  const first = (draft.first || '').trim() || 'the patient';
  const n = sortTeeth(draft.teeth).length;
  const say = s => toothCount(fillName(s, first), n);
  const c = {
    first, records: cfg.records,
    teeth: teethText(draft.teeth, draft.notation),
    one: n === 1, count: n,
    pick: key => { const p = picked(letter, draft, key); return p.length ? p[0][0] : ''; },
    words: key => picked(letter, draft, key).map(ch => say(ch[2])),
    word: key => { const p = picked(letter, draft, key); return p.length ? say(p[0][2]) : ''; },
    notes: key => picked(letter, draft, key).map(ch => say(ch[2])).join(' ')
  };
  if (letter.teeth === TEETH_REQUIRED && !c.teeth) c.teeth = '[choose the teeth]';
  return letter.build(c).filter(Boolean).map(capFirst).concat([THANKS]);
}
function letterText(draft, cfg) { return letterBody(draft, cfg).join('\n\n'); }
/* what still has to be filled in before a letter can be printed */
function draftProblems(draft) {
  const letter = letterById(draft.letter); const out = [];
  if (!letter) return ['Pick a letter.'];
  if (!(draft.first || '').trim() || !(draft.last || '').trim()) out.push('Type the patient’s first and last name.');
  if (!draft.dob) out.push('Enter the patient’s date of birth.');
  else if (!validDob(draft.dob)) out.push('The date of birth doesn’t look right.');
  if (!draft.doc || !(docName(draft.doc) || draft.doc.practice)) out.push('Choose the doctor the letter goes to.');
  if (letter.teeth === TEETH_REQUIRED && !sortTeeth(draft.teeth).length) out.push('Pick the teeth on the chart.');
  if (/\[choose the teeth\]/.test(draft.text || '')) out.push('The letter still says “[choose the teeth]”.');
  return out;
}
function validDob(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]); const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && y >= 1900 && dt.getTime() <= Date.now();
}
function fmtDob(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[2] + '/' + m[3] + '/' + m[1] : ''; }
function fmtLong(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return '';
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

/* ---------- the doctor directory ---------- */
const DOC_TYPES = ['Dentist', 'Pediatric Dentistry', 'Oral Surgery', 'Periodontics', 'Endodontics', 'Prosthodontics', 'Orthodontics', 'Physician', 'Other'];
const DOC_FIELDS = ['type', 'first', 'last', 'practice', 'addr1', 'addr2', 'city', 'email', 'phone', 'salute', 'note'];
function blankDoc() { return { type: 'Dentist', first: '', last: '', practice: '', addr1: '', addr2: '', city: '', email: '', phone: '', salute: '', note: '', off: false }; }
function cleanDoc(d) {
  const o = blankDoc();
  DOC_FIELDS.forEach(k => { o[k] = String((d && d[k]) == null ? '' : d[k]).replace(/\s+/g, ' ').trim().slice(0, k === 'note' ? 600 : 160); });
  if (!DOC_TYPES.includes(o.type)) o.type = o.type === 'Out of Town Dentist' ? 'Dentist' : 'Other';
  o.email = o.email.toLowerCase(); o.off = !!(d && d.off);
  return o;
}
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '')); }
/* "Dr. Shaun Abolverdi" — or nothing when the record is an office, not a person */
function isOfficeRecord(d) { return !d.last || !d.first || /\b(dental|dentistry|health|center|clinic|college|department|records|group|orthodontics|surgery|out of town)\b/i.test(d.last); }
function docName(d) { if (!d || isOfficeRecord(d)) return ''; return 'Dr. ' + d.first + ' ' + d.last; }
function docListName(d) { return d.last && d.first ? d.last + ', ' + d.first : (d.last || d.first || d.practice || '(no name)'); }
function docSalute(d) {
  if (d && d.salute) return /^dear\b/i.test(d.salute) ? d.salute.replace(/[,:]\s*$/, '') : 'Dear ' + d.salute.replace(/[,:]\s*$/, '');
  if (!d || isOfficeRecord(d)) return 'Dear Doctor';
  return 'Dear Dr. ' + d.last;
}
/* the lines of the address block */
function docBlock(d) {
  if (!d) return [];
  const name = docName(d);
  const practice = d.practice && d.practice.replace(/^dr\.?\s+/i, '').toLowerCase() !== (d.first + ' ' + d.last).toLowerCase() ? d.practice : '';
  return [name, practice || (name ? '' : d.practice || [d.first, d.last].filter(Boolean).join(' ')), d.addr1, d.addr2, d.city].filter(Boolean);
}
function docKey(d) { return [d.last, d.first, d.practice, d.addr1].map(s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|'); }
function docMatches(d, q) {
  q = String(q || '').toLowerCase().trim(); if (!q) return true;
  const hay = [d.first, d.last, d.practice, d.city, d.email, d.type].join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}
function sortDocs(list) { return list.slice().sort((a, b) => docListName(a).toLowerCase() < docListName(b).toLowerCase() ? -1 : 1); }

/* ---------- import: the cleaned list made from Edge's Professional List report ---------- */
/* Columns: Type, Last, First, Practice, Address, City/State/Zip, Email, Phone, Edge note */
function docsFromCSV(text) {
  const rows = parseCSV(text); const out = []; const seen = new Set(); let skipped = 0;
  rows.forEach(r => {
    const get = k => { const key = Object.keys(r).find(h => h.toLowerCase().replace(/[^a-z]/g, '') === k); return key ? r[key] : ''; };
    const addr = String(get('address')).split(/\s*,\s*(?=(?:suite|ste|unit|#|bldg|building|floor|d\d|\d+(?:st|nd|rd|th) floor))/i);
    const d = cleanDoc({ type: get('type'), last: get('last'), first: get('first'), practice: get('practice'), addr1: addr[0] || '', addr2: addr.slice(1).join(', '),
      city: get('citystatezip') || get('city'), email: get('email'), phone: get('phone'), note: get('edgenote') || get('note') });
    if (!validEmail(d.email)) { if (d.email) d.note = [d.note, 'Email in Edge: ' + d.email].filter(Boolean).join(' · '); d.email = ''; }
    if (!d.last && !d.first && !d.practice) { skipped++; return; }
    const k = docKey(d); if (seen.has(k)) { skipped++; return; }
    seen.add(k); out.push(d);
  });
  return { docs: out, skipped };
}
function docsToCSV(list) {
  const head = ['Type', 'Last', 'First', 'Practice', 'Address', 'City/State/Zip', 'Email', 'Phone', 'Salutation', 'Note', 'Hidden'];
  return [head.join(',')].concat(sortDocs(list).map(d => [d.type, d.last, d.first, d.practice, [d.addr1, d.addr2].filter(Boolean).join(', '), d.city, d.email, d.phone, d.salute, d.note, d.off ? 'yes' : ''].map(csvCell).join(','))).join('\r\n');
}
