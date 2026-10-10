/* ================= Clinical data =================
   Doses are units per site of incobotulinumtoxinA (Xeomin) or onabotulinumtoxinA (Botox), which are dosed 1 : 1.
   Other products are converted with their ratio. Where the AAFE Level I course gives a starting dose, the defaults
   follow it; label and literature doses are listed under "typical".
   Coordinates: front view = patient's right side (mirrored for the left); lateral = right side.
   opt: an optional site that starts at 0 U and is drawn hollow until a dose is added. */

var GROUPS = [
  { id: 'upper', name: 'Upper face', note: 'FDA-approved in adults for Xeomin and BOTOX Cosmetic; Dysport and Jeuveau cover frown lines only. Starting doses follow the AAFE course: start low and review at 2 weeks. Label doses are under Usual dosing. Treat the forehead together with the glabella to lower the risk of brow drop.' },
  { id: 'gs', name: 'Gummy smile', note: 'Classify on a full smile (Mazzuco & Hexsel): anterior = gum shows canine to canine; posterior = gum shows at the premolars and molars with a normal front; mixed = both; asymmetric = one side shows more.' },
  { id: 'jaw', name: 'Clenching & jaw', note: 'Masseter treatment alone often reduces clenching. Add the temporalis when there is temple pain or tension headache. Always treat both sides.' },
  { id: 'lips', name: 'Lips & chin', note: 'Small doses. Treat one or two lower-face areas per visit and keep away from the mouth corners.' }
];

var IND_ORDER = ['glabella', 'forehead', 'crows', 'gs-ant', 'gs-post', 'gs-mixed', 'gs-asym', 'mass-brux', 'mass-hyp', 'temporalis', 'mentalis', 'dao', 'perioral', 'lipflip'];

var IND = {
  glabella: {
    group: 'upper', name: 'Glabella: frown lines', chip: 'Glabella', consent: 'glabella', view: 'front', upper: true, step: 0.5,
    aim: 'Vertical "11" lines between the brows from the corrugators and procerus.',
    hi: ['procerus', 'corrugator'], caution: ['levator'], marks: ['rim1cm'],
    points: [
      { id: 'proc', name: 'Procerus', muscle: 'Procerus', mid: true, x: 200, y: 172, dose: 4, min: 2, max: 8, pref: 'b', depth: 'Intramuscular' },
      { id: 'cmed', name: 'Corrugator, medial', muscle: 'Corrugator', x: 182, y: 152, dose: 4, min: 2, max: 8, pref: 'l', depth: 'Intramuscular' },
      { id: 'clat', name: 'Corrugator, lateral', muscle: 'Corrugator', x: 160, y: 136, dose: 4, min: 2, max: 8, pref: 'l', depth: 'Intramuscular, at least 1 cm above the rim' }
    ],
    typical: 'AAFE: 4 U at each of 5 sites (20 U); total range 10–30 U (women about 20–25, men 20–30). This is also the label dose: 20 U as 5 × 4 U (0.1 mL each).',
    technique: [
      'Have the patient frown to show the corrugators and procerus.',
      'Procerus: one midline site where lines from each medial brow to the opposite inner eye corner cross.',
      'Corrugator: one site just above the medial brow and one lateral site at least 1 cm above the bony supraorbital ridge. Never closer than 1 cm above the central eyebrow.',
      'Intramuscular, perpendicular (90°). For the corrugator sites, seal the upper orbital rim with your thumb so toxin does not track down toward the eyelid levator.',
      'Inject slowly in small volumes, and do not massage afterward.'
    ],
    cautions: [
      'Eyelid ptosis if toxin reaches the levator palpebrae: injections too low, too lateral or in large volume, especially with a big brow-depressor complex.',
      'Inner (medial) brow drop if frown-line toxin reaches the lower inner frontalis: procerus or inner corrugator injected too high or too shallow. Keep the procerus site at the nasal root.'
    ],
    onset: 'Starts in 1–2 days and builds over the first week; full effect at about 2 weeks.',
    duration: 'About 3–4 months.',
    refs: ['aafe', 'pi', 'xeoPi', 'hong']
  },
  forehead: {
    group: 'upper', name: 'Forehead lines', chip: 'Forehead', consent: 'forehead', view: 'front', upper: true, step: 0.5,
    aim: 'Horizontal forehead lines from the frontalis, the only muscle that lifts the brow. Treat with the glabella so the brow is not pulled down.',
    hi: ['frontalis'], caution: ['brow-band'], marks: ['brow2cm'],
    points: [
      { id: 'lowM', name: 'Frontalis, lower center', muscle: 'Frontalis', mid: true, x: 200, y: 116, dose: 2, min: 1, max: 4, pref: 't', depth: 'Intramuscular, superficial' },
      { id: 'lowL', name: 'Frontalis, lower lateral', muscle: 'Frontalis', x: 132, y: 116, dose: 2, min: 1, max: 4, pref: 'l', depth: 'Intramuscular, superficial' },
      { id: 'up', name: 'Frontalis, upper', muscle: 'Frontalis', x: 166, y: 102, dose: 2, min: 1, max: 4, pref: 't', depth: 'Intramuscular, superficial' }
    ],
    typical: 'AAFE: 1–2 U per site over 4–14 sites; 4–16 U total (women 4–14, men 10–20). The 5 sites here at 2 U give 10 U. Label: 20 U as 5 × 4 U, given with 20 U to the glabella (40 U total).',
    technique: [
      'Ask the patient to raise the brows. The top of frontalis activity is about 1 cm above the highest forehead line.',
      'Lower row: midway between that top margin and the brow, at least 2 cm above the brow and 1.5 cm above any glabellar site. One site at the midline and one 0.5–1.5 cm medial to each temporal crest.',
      'Upper row: midway between the top margin and the lower row, one site on each side halfway between the lower-row sites.',
      'Intramuscular, perpendicular. Cover the whole active muscle; a wide forehead may need more sites (record them under Notes).',
      'Treat the glabella at the same visit.'
    ],
    cautions: [
      'Brow drop or a heavy, hooded brow if the frontalis is over-treated, injected too low (closer than 2 cm to the brow) or treated without the glabella. Check brow position before treating.',
      'A peaked lateral brow ("Spock brow") if the lateral frontalis is left active; balance with 1–2 U above the peak at the 2-week visit.'
    ],
    onset: '2–4 days; full effect at about 2 weeks.',
    duration: 'About 3–4 months.',
    refs: ['aafe', 'pi', 'xeoPi']
  },
  crows: {
    group: 'upper', name: 'Crow’s feet: lateral canthal lines', chip: 'Crow’s feet', consent: 'crows', view: 'front', upper: true, step: 0.5,
    aim: 'Lines fanning out from the outer eye corner, from the lateral orbicularis oculi.',
    hi: ['oculi'], caution: ['orbit', 'zmj'], marks: ['canthus'],
    points: [
      { id: 'a', name: 'Lateral canthal, center', muscle: 'Orbicularis oculi', x: 100, y: 190, dose: 2, min: 1, max: 5, pref: 'l', depth: 'Just under the skin, angled away from the eye' },
      { id: 'b', name: 'Lateral canthal, upper', muscle: 'Orbicularis oculi', x: 105, y: 168, dose: 2, min: 1, max: 5, pref: 'tl', depth: 'Just under the skin, angled away from the eye' },
      { id: 'c', name: 'Lateral canthal, lower', muscle: 'Orbicularis oculi', x: 107, y: 212, dose: 2, min: 1, max: 5, pref: 'bl', depth: 'Just under the skin, angled away from the eye' }
    ],
    typical: 'AAFE: 4–12 U per side over 1–5 sites about 1 cm apart (men up to 16). The 3 sites here at 2 U give 6 U per side. Label: 3 × 4 U per side (24 U total).',
    technique: [
      'Have the patient smile hard to show the lines.',
      'First site about 1.5 cm outside the lateral canthus (label: 1.5–2 cm), or 1 cm outside the orbital rim. Add sites about 1 cm apart along the lines, above and below (or both below if the lines sit mainly below the canthus).',
      'Superficial: just under the skin, with the needle at 30–45° pointing away from the eye.',
      'Small veins are common here. If a bruise starts, press gently, pushing away from the eye.'
    ],
    cautions: [
      'Stay outside the orbital rim: dry eye, lower-lid weakness or double vision if toxin reaches the inner orbicularis or eye muscles.',
      'Low injections near the cheekbone can reach the zygomaticus major and change the smile.'
    ],
    onset: '2–4 days; full effect at about 2 weeks.',
    duration: 'About 3–4 months.',
    refs: ['aafe', 'pi', 'xeoPi']
  },
  'gs-ant': {
    group: 'gs', name: 'Anterior gummy smile', chip: 'Gummy smile, anterior', consent: 'gs', view: 'front', step: 0.5,
    aim: 'Gum shows from canine to canine on a full smile. LLSAN and LLS lift the lip too far.',
    hi: ['llsan', 'lls', 'zmi'], caution: ['zmj'], marks: ['yonsei', 'lipline'],
    points: [
      { id: 'yonsei', name: 'Yonsei point', muscle: 'LLS, LLSAN, zyg. minor', x: 152, y: 252, dose: 2, min: 1, max: 5, pref: 'l', depth: 'Shallow intramuscular' }
    ],
    typical: '2–2.5 U per side to start. Men and strong elevators may need 3–5 U per side.',
    technique: [
      'Mark with the patient holding a full smile.',
      'Yonsei point: about 1 cm lateral to the alar crease and 3 cm above the commissure line, where LLS, LLSAN and zygomaticus minor converge. One injection reaches all three.',
      'Shallow intramuscular injection, 30–32G. The fat over the point is thin.',
      'Measure gum display again at 2 weeks and add 0.5–1 U per side if needed.'
    ],
    cautions: [
      'Too much, or too lateral, drops or lengthens the upper lip and flattens the smile. Nothing reverses it, so start low.',
      'A skeletal cause (vertical maxillary excess) needs orthodontic or surgical correction. Toxin treats only the muscular part.'
    ],
    onset: 'Starts in 2–4 days; full effect at 1–2 weeks.',
    duration: 'About 3–4 months; gum display often returns by 4–6 months.',
    refs: ['hwang', 'polo', 'fatani', 'muszalska', 'hong']
  },
  'gs-post': {
    group: 'gs', name: 'Posterior gummy smile', chip: 'Gummy smile, posterior', consent: 'gs', view: 'front', step: 0.5,
    aim: 'Gum shows at the premolars and molars while the front is normal. Zygomaticus minor and major pull the lip up and back.',
    hi: ['zmi', 'zmj'], caution: [], marks: ['nlf'],
    points: [
      { id: 'nlf', name: 'Nasolabial fold point', muscle: 'Zyg. minor and major', x: 158, y: 280, dose: 1.5, min: 1, max: 2.5, pref: 'l', depth: 'Shallow intramuscular' },
      { id: 'lat', name: 'Lateral point', muscle: 'Zyg. major', x: 128, y: 266, dose: 1.5, min: 1, max: 2.5, pref: 'tl', depth: 'Shallow intramuscular' }
    ],
    typical: 'About 1.5 U at each of two points per side. Published totals run 4–10 U for both sides.',
    technique: [
      'Point 1: where the nasolabial fold bunches most on a full smile.',
      'Point 2: about 2 cm lateral to point 1, on the zygomaticus major, toward the tragus.',
      'Shallow injections, 30–32G.',
      'Check at 2 weeks before adding more.'
    ],
    cautions: [
      'Weakening the zygomaticus major can lower or flatten the smile and make it uneven. Keep doses low and the same on both sides.'
    ],
    onset: 'Starts in 2–4 days; full effect at 1–2 weeks.',
    duration: 'About 3–4 months.',
    refs: ['muszalska', 'hexsel', 'fatani', 'mazzuco']
  },
  'gs-mixed': {
    group: 'gs', name: 'Mixed gummy smile', chip: 'Gummy smile, mixed', consent: 'gs', view: 'front', step: 0.5,
    aim: 'Gum shows in front and at the back. Use the anterior and posterior points, with the anterior dose halved.',
    hi: ['llsan', 'lls', 'zmi', 'zmj'], caution: [], marks: ['yonsei', 'nlf'],
    points: [
      { id: 'yonsei', name: 'Yonsei point', muscle: 'LLS, LLSAN, zyg. minor', x: 152, y: 252, dose: 1, min: 0.5, max: 2.5, pref: 'tl', depth: 'Shallow intramuscular' },
      { id: 'nlf', name: 'Nasolabial fold point', muscle: 'Zyg. minor and major', x: 158, y: 280, dose: 1.5, min: 1, max: 2.5, pref: 'l', depth: 'Shallow intramuscular' },
      { id: 'lat', name: 'Lateral point', muscle: 'Zyg. major', x: 128, y: 266, dose: 1.5, min: 1, max: 2.5, pref: 'bl', depth: 'Shallow intramuscular' }
    ],
    typical: 'Per side: about 1 U at the Yonsei point (half the anterior dose) and 1.5 U at each posterior point.',
    technique: [
      'Combine the anterior and posterior techniques.',
      'Halve the Yonsei-point dose, because the posterior points also lower the lip.',
      'Shallow injections, 30–32G.'
    ],
    cautions: [
      'Three points per side add up. Watch for a dropped upper lip; start low and adjust at 2 weeks.'
    ],
    onset: 'Starts in 2–4 days; full effect at 1–2 weeks.',
    duration: 'About 3–4 months.',
    refs: ['muszalska', 'fatani']
  },
  'gs-asym': {
    group: 'gs', name: 'Asymmetric gummy smile', chip: 'Gummy smile, asymmetric', consent: 'gs', view: 'front', step: 0.5,
    aim: 'One side lifts higher, from uneven pull of the lip elevators (front of the smile) or the zygomatic muscles (back). Treat both sides, with a clearly lower dose on the side that shows less gum.',
    hi: ['llsan', 'lls', 'zmi', 'zmj'], caution: [], marks: ['yonsei', 'nlf'],
    points: [
      { id: 'yonsei', name: 'Yonsei point', muscle: 'LLS, LLSAN, zyg. minor', x: 152, y: 252, doseR: 2, doseL: 1, min: 0, max: 5, pref: 'l', depth: 'Shallow intramuscular' },
      { id: 'nlf', name: 'Nasolabial fold point', muscle: 'Zyg. minor and major', x: 158, y: 280, dose: 0, min: 0, max: 2.5, pref: 'l', depth: 'Shallow intramuscular', opt: true },
      { id: 'lat', name: 'Lateral point', muscle: 'Zyg. major', x: 128, y: 266, dose: 0, min: 0, max: 2.5, pref: 'bl', depth: 'Shallow intramuscular', opt: true }
    ],
    typical: 'Front uneven: Yonsei point, 2–2.5 U on the higher side and about half on the other. Back uneven: use the fold and lateral points (optional here) the same way, about 1.5 U each on the higher side. Set up for a higher right side; use Swap sides if the left is higher.',
    technique: [
      'Photograph and measure gum display on each side on a full smile, and note whether the front or the back is uneven.',
      'Front: the Yonsei point on both sides, same landmarks as the anterior pattern. Back: the fold and lateral points, as in the posterior pattern.',
      'Re-check symmetry at 2 weeks and balance with 0.5–1 U where needed.'
    ],
    cautions: [
      'Asymmetry from facial-nerve weakness is the exception. Evaluate it before treating, and do not inject the weak side.',
      'Weakening the zygomaticus major can lower or flatten the smile. Keep the back-of-smile doses low.'
    ],
    onset: 'Starts in 2–4 days; full effect at 1–2 weeks.',
    duration: 'About 3–4 months.',
    refs: ['fatani', 'muszalska']
  },
  'mass-brux': {
    group: 'jaw', name: 'Masseter: bruxism and clenching', chip: 'Masseter, bruxism', consent: 'brux', view: 'lat', step: 1,
    aim: 'Clenching, grinding or masseter muscle pain. Add the temporalis when there is temple pain.',
    hi: ['masseter'], caution: ['ant', 'parotid', 'facial-a', 'mm-nerve'], marks: ['safe', 'tc', 'low1', 'ant1'],
    points: [
      { id: 'up', name: 'Masseter, upper', muscle: 'Masseter', x: 196, y: 276, dose: 0, min: 0, max: 10, pref: 'tl', depth: 'Deep, then superficial (split the dose)', opt: true },
      { id: 'ctr', name: 'Masseter, center', muscle: 'Masseter', x: 199, y: 298, dose: 10, min: 5, max: 15, pref: 'l', depth: 'Deep, then superficial (split the dose)' },
      { id: 'low', name: 'Masseter, lower', muscle: 'Masseter', x: 206, y: 315, dose: 0, min: 0, max: 10, pref: 'bl', depth: 'Deep, then superficial (split the dose)', opt: true }
    ],
    typical: 'AAFE: start with 10 U per side in one central site and allow up to 4 weeks to judge. Most studies use 20–30 U per side over 2–3 sites (add the optional upper and lower sites). A sleep-bruxism RCT used 60 U per masseter with 40 U per temporalis (Ondo 2018).',
    technique: [
      'Have the patient clench. Palpate and mark the anterior border and the bulk of the muscle.',
      'Safe zone: below the line from the tragus to the mouth corner, at least 1 cm behind the anterior border, and at least 1.5 cm above the lower border of the mandible.',
      'Inject perpendicular (90°) into the bulkiest part with a 30G ½-inch needle. Go to bone, withdraw slightly and give part of the dose, then give the rest more superficially as you withdraw.',
      'Extra sites at least 1 cm apart. Always treat both sides.'
    ],
    cautions: [
      'A deep tendon inside the muscle blocks spread between its layers. Deep-only injection leaves the superficial layer working, and it can bulge on clenching; treat a bulge with a small superficial dose.',
      'Too far forward, near the anterior border, reaches the risorius or zygomaticus major and makes the smile uneven.',
      'Above the tragus-to-commissure line: parotid gland and duct.',
      'Near the lower border: marginal mandibular nerve. Facial artery and vein cross the jaw at the antegonial notch.',
      'Tough foods may tire the jaw for a few weeks.'
    ],
    onset: 'Less clenching and pain within 1–2 weeks; allow up to 4 weeks before adding more.',
    duration: '3–6 months.',
    refs: ['aafe', 'hong', 'lee2017', 'rathod', 'ondo', 'mdedgeBrux']
  },
  'mass-hyp': {
    group: 'jaw', name: 'Masseter: hypertrophy (jaw contour)', chip: 'Masseter, contour', consent: 'contour', view: 'lat', step: 1,
    aim: 'An enlarged masseter squares the lower face. Toxin shrinks the muscle over 1–3 months.',
    hi: ['masseter'], caution: ['ant', 'parotid', 'facial-a', 'mm-nerve'], marks: ['safe', 'tc', 'low1', 'ant1'],
    points: [
      { id: 'u1', name: 'Masseter, upper front', muscle: 'Masseter', x: 192, y: 280, dose: 5, min: 3, max: 12, pref: 'l', depth: 'Deep and superficial' },
      { id: 'u2', name: 'Masseter, upper back', muscle: 'Masseter', x: 208, y: 270, dose: 5, min: 3, max: 12, pref: 'tr', depth: 'Deep and superficial' },
      { id: 'm1', name: 'Masseter, middle front', muscle: 'Masseter', x: 192, y: 303, dose: 5, min: 3, max: 12, pref: 'l', depth: 'Deep and superficial' },
      { id: 'm2', name: 'Masseter, middle back', muscle: 'Masseter', x: 208, y: 295, dose: 5, min: 3, max: 12, pref: 'r', depth: 'Deep and superficial' },
      { id: 'lo', name: 'Masseter, lower', muscle: 'Masseter', x: 202, y: 318, dose: 5, min: 3, max: 12, pref: 'bl', depth: 'Deep and superficial' }
    ],
    typical: '25–30 U per side over 4–6 sites, often more on the larger side. The Phase 3 trial now under FDA review used 36 U per side: 3 sites of 12 U about 1 cm apart, each split between the deep and superficial layers (Sun 2026).',
    technique: [
      'Have the patient clench; mark the anterior border and the bulge.',
      'Stay inside the same safe zone as for bruxism, spreading the dose over the bulk of the muscle.',
      'Give every site at both deep and superficial levels. A deep tendon inside the muscle blocks spread, so deep-only injection can leave the superficial layer to bulge.',
      'Sites at least 1 cm apart, 30G ½-inch needle.'
    ],
    cautions: [
      'Too far forward or too high can hollow the cheek and make the smile uneven.',
      'Above the tragus-to-commissure line: parotid gland and duct. Near the lower border: marginal mandibular nerve.',
      'Tough foods may tire the jaw for a few weeks.'
    ],
    onset: 'The muscle shrinks gradually: the change begins at 4–6 weeks and is greatest at about 3 months.',
    duration: '4–6 months; often longer after repeat sessions.',
    refs: ['hong', 'sun2026', 'lee2017', 'rathod', 'sbla']
  },
  temporalis: {
    group: 'jaw', name: 'Temporalis: bruxism and tension', chip: 'Temporalis', consent: 'brux', view: 'lat', step: 1,
    aim: 'Clenching with temple pain or tension headache. Usually added to masseter treatment.',
    hi: ['temporalis'], caution: ['tendon', 'sta'], marks: ['thumb'],
    points: [
      { id: 'a', name: 'Temporalis, front', muscle: 'Temporalis', x: 164, y: 134, dose: 5, min: 2, max: 15, pref: 'l', depth: 'Deep, through the fascia to bone' },
      { id: 'm', name: 'Temporalis, middle', muscle: 'Temporalis', x: 192, y: 124, dose: 5, min: 2, max: 15, pref: 't', depth: 'Deep, through the fascia to bone' },
      { id: 'p', name: 'Temporalis, back', muscle: 'Temporalis', x: 220, y: 128, dose: 0, min: 0, max: 15, pref: 'r', depth: 'Deep, through the fascia to bone', opt: true }
    ],
    typical: 'AAFE: start at 10 U per side over 1–3 sites (here 5 U front and 5 U middle; the back site is optional) and titrate; usual range 10–50 U per side. Headache and bruxism reports use 15–20 U per side; the Ondo 2018 RCT used 40 U per temporalis.',
    technique: [
      'Feel the muscle tighten while the patient clenches. Place sites in the bulkiest part or at tender trigger points.',
      'Stay in the muscle belly, about 4.5 cm or more above the zygomatic arch; lower down the temporalis is mostly tendon. Choi’s hand guide: lay your hand flat on the temple with the middle finger on the lower edge of the zygomatic arch, and the thumb tip lands about 4.5 cm above its upper edge. Check it against your own hand.',
      'Feel for the superficial temporal artery pulse and keep clear of it.',
      'Inject deep, through the temporal fascia, perpendicular (90°) to the bone. Always treat both sides.'
    ],
    cautions: [
      'The temple bruises easily.',
      'Keep injections deep and away from the lateral brow so toxin does not reach the frontalis (brow drop).'
    ],
    onset: '1–2 weeks.',
    duration: '3–4 months.',
    refs: ['aafe', 'choi', 'ondo', 'mdedgeBrux']
  },
  mentalis: {
    group: 'lips', name: 'Mentalis: chin dimpling and strain', chip: 'Mentalis', consent: 'chin', view: 'front', step: 0.5,
    aim: 'A dimpled ("cobblestone") chin or a chin that strains to close the lips.',
    hi: ['mentalis'], caution: ['oo-low', 'dli'], marks: ['sulcus'],
    points: [
      { id: 'ment', name: 'Mentalis', muscle: 'Mentalis', x: 191, y: 366, dose: 4, min: 2, max: 5, pref: 'bl', depth: '3 U deep on bone, then 1 U under the skin' }
    ],
    typical: '4 U per side (3 U deep + 1 U superficial), 8 U total. Published totals run 4–10 U.',
    technique: [
      'One point on each side, 0.5 cm from the pogonion, low on the chin.',
      'Deep: advance to bone, withdraw slightly and inject 3 U slowly. Then 1 U just under the skin at the same point.',
      'Stay at least 1 cm below the mentolabial sulcus.'
    ],
    cautions: [
      'Too high reaches the orbicularis oris: weak lip seal, drooling, trouble with "p" and "b".',
      'Too lateral reaches the depressor labii inferioris and makes the lower lip uneven.',
      'With lip incompetence, chin strain is a symptom of the skeletal or dental pattern. Toxin smooths the chin but does not fix the cause.'
    ],
    onset: '3–7 days; full effect at 2 weeks.',
    duration: '3–4 months.',
    refs: ['yi', 'hong', 'hexsel']
  },
  dao: {
    group: 'lips', name: 'Depressor anguli oris: downturned corners', chip: 'DAO, mouth corners', consent: 'corners', view: 'front', step: 0.5,
    aim: 'Mouth corners that pull down at rest or when talking; deep marionette lines.',
    hi: ['dao'], caution: ['dli'], marks: ['marionette'],
    points: [
      { id: 'mid', name: 'DAO, middle third', muscle: 'DAO', x: 155, y: 340, dose: 2, min: 1, max: 3, pref: 'l', depth: 'On the fold, 4–5 mm deep' },
      { id: 'low', name: 'DAO, lower third', muscle: 'DAO', x: 153, y: 358, dose: 2, min: 1, max: 3, pref: 'bl', depth: 'On the fold, 4–5 mm deep' }
    ],
    typical: '2 U at each of two sites per side (4 U per side), as in Zhang 2024. Many start with 2–3 U per side.',
    technique: [
      'Have the patient pull the mouth corners down to show the muscle.',
      'Inject on the marionette (labiomandibular) fold in its middle and lower thirds; in most people the fold lies over the DAO. Near the mouth corner the DAO is often missing.',
      'Intramuscular, 4–5 mm deep, 30G.'
    ],
    cautions: [
      'The depressor labii inferioris lies under and medial to the DAO. Injecting medial to the fold, or too deep, gives an uneven lower lip and trouble sipping.',
      'Too close to the mouth corner can make the smile uneven.'
    ],
    onset: '3–7 days.',
    duration: '3–4 months.',
    refs: ['zhang', 'hong']
  },
  perioral: {
    group: 'lips', name: 'Perioral lines', chip: 'Lip lines', consent: 'lips', view: 'front', step: 0.5,
    aim: 'Vertical lines above and below the lips ("smoker’s" or "water-bottle" lines) from the orbicularis oris.',
    hi: ['oo'], caution: ['corners'], marks: [],
    points: [
      { id: 'ui', name: 'Upper lip, inner', muscle: 'Orbicularis oris', x: 190, y: 290, dose: 0.5, min: 0.5, max: 1, pref: 't', depth: 'Shallow, no more than ½ needle depth' },
      { id: 'uo', name: 'Upper lip, outer', muscle: 'Orbicularis oris', x: 181, y: 292, dose: 0.5, min: 0.5, max: 1, pref: 'tl', depth: 'Shallow, no more than ½ needle depth' },
      { id: 'lo', name: 'Lower lip, side', muscle: 'Orbicularis oris', x: 186, y: 331, dose: 0.5, min: 0.5, max: 1, pref: 'bl', depth: 'Shallow, no more than ½ needle depth' },
      { id: 'lm', name: 'Lower lip, center', muscle: 'Orbicularis oris', mid: true, x: 200, y: 332, dose: 0.5, min: 0.5, max: 1, pref: 'b', depth: 'Shallow, no more than ½ needle depth' }
    ],
    typical: 'AAFE: 7 sites (4 upper lip, 3 lower lip) at ½–1 U each: 3.5–7 U total (women 4–7, men 5–8). Start at the low end.',
    technique: [
      'Inject just outside the vermilion border, about 2–3 mm from it: 4 sites in the upper lip and 3 in the lower lip, so the whole muscle softens evenly and the lips still seal.',
      'Intramuscular but shallow: no more than half the needle depth, at 45–90°.',
      'Keep every site at least 1.5 cm from the mouth corners and off the philtral columns.',
      'Use the lowest dose that softens the lines. Filler helps deeper lines.'
    ],
    cautions: [
      'Straws, whistling, wind instruments and "p" or "b" sounds may feel different for a few weeks.',
      'Too much weakens the lip seal and flattens or lengthens the lip.'
    ],
    onset: '3–7 days.',
    duration: 'Shorter than other areas, often 2–3 months.',
    refs: ['aafe', 'hexsel', 'hong', 'dt2006']
  },
  lipflip: {
    group: 'lips', name: 'Lip flip', chip: 'Lip flip', consent: 'lips', view: 'front', step: 0.5,
    aim: 'Relaxing the upper orbicularis oris lets the upper lip roll out slightly and show more red lip.',
    hi: ['oo'], caution: ['corners'], marks: [],
    points: [
      { id: 'in', name: 'Upper vermilion, inner', muscle: 'Orbicularis oris', x: 191, y: 295, dose: 1, min: 0.5, max: 1.5, pref: 't', depth: 'Superficial' },
      { id: 'out', name: 'Upper vermilion, outer', muscle: 'Orbicularis oris', x: 182, y: 296.5, dose: 1, min: 0.5, max: 1.5, pref: 'tl', depth: 'Superficial' }
    ],
    typical: '4–6 U total across the upper lip.',
    technique: [
      'Two sites on each side of the philtrum, at the vermilion border, into the orbicularis oris.',
      'Stay 1.5 cm from the mouth corners.',
      'Small, superficial injections, 30–32G.'
    ],
    cautions: [
      'Drinking through a straw and whistling may be harder for a few weeks.',
      'Not for wind-instrument players or singers who rely on lip control.'
    ],
    onset: '3–7 days.',
    duration: 'About 2–3 months.',
    refs: ['pitchford']
  }
};

/* ratio = product units for one onabotulinumtoxinA unit, from each label's glabellar dose (20 U Botox).
   Units are not interchangeable; the ratio is only used to convert a plan when the product changes. */
var PRODUCTS = {
  xeomin: { name: 'Xeomin', brand: 'Xeomin', generic: 'incobotulinumtoxinA', vials: [50, 100, 200], label: { 50: 1.25, 100: 2.5, 200: 5 }, onLabel: [50, 100, 200], ratio: 1, useHrs: 24, glabellar: 20, note: 'Merz. No accessory proteins. Unopened vials can be kept at room temperature until mixed (see the label for other storage options).' },
  botox: { name: 'Botox', brand: 'BOTOX Cosmetic', generic: 'onabotulinumtoxinA', vials: [50, 100, 200], label: { 50: 1.25, 100: 2.5, 200: 5 }, onLabel: [50, 100], ratio: 1, useHrs: 24, glabellar: 20, note: 'Allergan Aesthetics. Unopened vials are refrigerated. The 200 U vial is the therapeutic product.' },
  jeuveau: { name: 'Jeuveau', brand: 'Jeuveau', generic: 'prabotulinumtoxinA-xvfs', vials: [100], label: { 100: 2.5 }, onLabel: [100], ratio: 1, useHrs: 24, glabellar: 20, note: 'Keep in the original carton, protected from light.' },
  dysport: { name: 'Dysport', brand: 'Dysport', generic: 'abobotulinumtoxinA', vials: [300, 500], label: { 300: 1.5, 500: 2.5 }, onLabel: [300, 500], ratio: 2.5, useHrs: 24, glabellar: 50, note: 'Contraindicated with cow’s milk protein allergy. Its units are much smaller than Botox units. Keep the mixed vial refrigerated and protected from light.' }
};
var PRODUCT_ORDER = ['xeomin', 'botox', 'jeuveau', 'dysport'];

var REFS = {
  aafe: { t: 'American Academy of Facial Esthetics. Level I Botulinum Toxin Live Patient Training, course handout: starting doses and sites by area, reconstitution with bacteriostatic saline and storage.' },
  pi: { t: 'BOTOX Cosmetic (onabotulinumtoxinA) prescribing information and Medication Guide. AbbVie, revised 10/2024: glabellar, forehead and lateral canthal sites and doses, platysma bands, reconstitution, use within 24 hours, boxed warning.', u: 'https://www.rxabbvie.com/pdf/botox-cosmetic_pi.pdf' },
  xeoPi: { t: 'XEOMIN (incobotulinumtoxinA) prescribing information. Merz. DailyMed.', u: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3f35d6e0-3450-4abc-a0da-cc7b277e7c6e' },
  dysPi: { t: 'DYSPORT (abobotulinumtoxinA) prescribing information. Ipsen. DailyMed.', u: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=71313a04-1349-4c26-b840-a39e4a3ddaed' },
  jeuPi: { t: 'JEUVEAU (prabotulinumtoxinA-xvfs) prescribing information. Evolus. DailyMed.', u: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=17a914c1-e54b-4b50-965d-b0fd9111bba4' },
  hwang: { t: 'Hwang WS, Hur MS, Hu KS, et al. Surface anatomy of the lip elevator muscles for the treatment of gummy smile using botulinum toxin. Angle Orthod. 2009;79(1):70–77.', u: 'https://angle-orthodontist.kglmeridian.com/view/journals/angl/79/1/article-p70.xml' },
  polo: { t: 'Polo M. Botulinum toxin type A (Botox) for the neuromuscular correction of excessive gingival display on smiling (gummy smile). Am J Orthod Dentofacial Orthop. 2008;133(2):195–203.', u: 'https://doi.org/10.1016/j.ajodo.2007.04.033' },
  mazzuco: { t: 'Mazzuco R, Hexsel D. Gummy smile and botulinum toxin: a new approach based on the gingival exposure area. J Am Acad Dermatol. 2010;63(6):1042–1051. Their doses are in abobotulinumtoxinA (Dysport) units.', u: 'https://doi.org/10.1016/j.jaad.2010.02.053' },
  fatani: { t: 'Fatani B. An approach for gummy smile treatment using botulinum toxin A: a narrative review of the literature. Cureus. 2023;15(1):e34032.', u: 'https://doi.org/10.7759/cureus.34032' },
  muszalska: { t: 'Muszalska M, Przybylska P, Piwowarek M, Komisarek O, Matthews-Brzozowska T. Botulinum toxin in the treatment of gummy smile. J Face Aesthet. 2020;3(2):133–138.', u: 'https://doi.org/10.20883/jofa.38' },
  hong: { t: 'Hong SO. Cosmetic treatment using botulinum toxin in the oral and maxillofacial area: a narrative review of esthetic techniques. Toxins. 2023;15(2):82.', u: 'https://doi.org/10.3390/toxins15020082' },
  rathod: { t: 'Rathod NN, John RS. Botulinum toxin injection for masseteric hypertrophy using 6 point injection technique: a case report. Clin Cosmet Investig Dent. 2023;15:45–49. Kept injections 1.5–2 cm from the lower border of the mandible.', u: 'https://doi.org/10.2147/CCIDE.S396057' },
  lee2017: { t: 'Lee HJ, Kang IW, Seo KK, et al. The anatomical basis of paradoxical masseteric bulging after botulinum neurotoxin type A injection. Toxins. 2017;9(1):14.', u: 'https://doi.org/10.3390/toxins9010014' },
  sun2026: { t: 'Sun et al. OnabotulinumtoxinA treatment for masseter muscle prominence: 6-month safety and efficacy results, including patient-reported outcomes, from a phase 3, randomized, placebo-controlled, multiregional trial. Aesthet Surg J. 2026;46(5):486.', u: 'https://doi.org/10.1093/asj/sjaf204' },
  ondo: { t: 'Ondo WG, Simmons JH, Shahid MH, et al. Onabotulinum toxin-A injections for sleep bruxism: a double-blind, placebo-controlled study. Neurology. 2018;90(7):e559–e564.', u: 'https://doi.org/10.1212/WNL.0000000000004951' },
  mdedgeBrux: { t: 'Talakoub L, Wesley NO. Treating the effects of bruxism with botulinum toxin. MDedge / The Hospitalist (opinion column; reports 50 U per masseter and 15–20 U per temporalis).', u: 'https://blogs.the-hospitalist.org/index.php/content/treating-effects-bruxism-botulinum-toxin' },
  choi: { t: 'Choi YJ, Lee WJ, Lee HJ, Lee KW, Kim HJ, Hu KS. Effective botulinum toxin injection guide for treatment of temporal headache. Toxins. 2016;8(9):265.', u: 'https://www.mdpi.com/2072-6651/8/9/265' },
  yi: { t: 'Yi KH, Lee JH, Hu HW, et al. Novel anatomical guidelines for botulinum neurotoxin injection in the mentalis muscle: a review. Anat Cell Biol. 2023;56(3):293–298.', u: 'https://doi.org/10.5115/acb.22.266' },
  zhang: { t: 'Zhang M, Yang Y, Dong R, et al. Deciphering depressor anguli oris for lower face rejuvenation: a prospective ultrasound-based investigation. Aesthet Surg J. 2024;44(8):880–888. Injected on the labiomandibular fold, middle and lower thirds, 4–5 mm deep, 2 U per site.', u: 'https://doi.org/10.1093/asj/sjae037' },
  hexsel: { t: 'McNamara D. Botulinum toxin: less is more in the lower face. MDedge Dermatology, January 11, 2012 (reporting a talk by Dr. Doris Hexsel).', u: 'https://mdedge.com/content/botulinum-toxin-less-more-lower-face' },
  dt2006: { t: 'Treating the lower face with botulinum toxin. Dermatology Times, 2006.', u: 'https://www.dermatologytimes.com/view/treating-lower-face-botulinum-toxin' },
  pitchford: { t: 'Pitchford CA, Desrosiers AS, Tolkachjov SN. The lip flip: a systematic review of botulinum toxin lip augmentation. Arch Dermatol Res. 2025;317:765.', u: 'https://link.springer.com/article/10.1007/s00403-025-04265-0' },
  alam2015: { t: 'Alam M, Bolotin D, Carruthers J, et al. Consensus statement regarding storage and reuse of previously reconstituted neuromodulators. Dermatol Surg. 2015;41(3):321–326.', u: 'https://pubmed.ncbi.nlm.nih.gov/25705950/' },
  recon: { t: 'On-label reconstitution for BOTOX Cosmetic, DYSPORT, XEOMIN, JEUVEAU and DAXXIFY, summarized from each label. Empire Medical Training.', u: 'https://www.empiremedicaltraining.com/aesthetic-workshops/resources/neurotoxin-dosing/on-label-neurotoxin-reconstitution-chart/' },
  sbla: { t: 'FDA accepts sBLA for BOTOX Cosmetic in masseter muscle prominence (under review, not approved). BioPharm International, Aug 4, 2026.', u: 'https://www.biopharminternational.com/view/fda-accepts-sbla-for-botox-cosmetic-in-masseter-muscle-prominence' }
};
