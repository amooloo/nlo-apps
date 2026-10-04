/* =====================================================================
   Lab Rx — Specialty Appliances' Metal Rx (MKT-6, Rev 10-25), filled in from the case
   Amir, 4 Oct 2026: "Next lets use this" (Specialty's Metal Rx) — the Herbst and Retainer Rx's way (rx.js, rxret.js), for:
   - RPE and MSE cases going to Specialty (RPE routes to Specialty since 4 Oct 2026, Amir: "Switch to Specialty"; Specialty's MSE
     page says to order it on this form), and a new appliance choice, "Other metal appliance", for the rest of the form (Amir:
     "RPE, MSE + one new choice"): quad helix, E- and W-arch, distalizers, TPA, lower lingual arch, Nance, space maintainers,
     habit appliances, a fixed bite plane, Xbow, Tandem.
   - Amir, 4 Oct 2026: "all of our expanders except Herbst and MARA will have 3D printed bands" — an Rx with an expander (or the
     MSE) starts with Specialty's 3D printed / sintered box ticked, so its bands are priced as 3D printed.
   - Picking an appliance puts Specialty's standard bands on (the first molars; the bicuspids too for a Rapid Molar Distalizer,
     the second primary molar for a Halterman), and the Pendulum family's occlusal rests; tapping teeth changes them. A space
     maintainer goes on the arches: tap the space, and the band goes on the tooth behind it.
   - The MSE isn't a circle on the form: it prints as "MSE 10 mm" in the Screw Type blank, and the special instructions say so.
   - Prices from Specialty's price list MKT-41 (metals; the MSE and Horseshoe Jet from its TAD appliances); what the list doesn't
     have is named under the estimate, never guessed. Each option explains itself (point at it), from Specialty's own pages
     where they describe it (research 4 Oct 2026), else the named source.
   ===================================================================== */
const RX_MET = 'specialty-metal';
const RXM = RX_FORMS[RX_MET];
const RXM_OTHER = 'Other metal appliance';
const RXM_RPE = 'Rapid Palatal Expander (RPE)';
/* the appliances that go on this form (with the lab set to Specialty) */
const RXM_APPL = [RXM_RPE, 'MSE', RXM_OTHER];
/* the form's choices, in its order and words (® and ™ left off on screen) */
const RXM_O = {
  exp: [['hyrax', 'Hyrax RPE'], ['haas', 'Haas RPE'], ['acrylic', 'Acrylic Bonded RPE'], ['deluke', 'DeLuke Contoured RPE'], ['exspider', 'Exspider Fan Expander'],
    ['lowerFixed', 'Lower Fixed Expander'], ['qh', 'Quad Helix'], ['earch', 'E-Arch'], ['warch', 'W-Arch']],
  dist: [['pendulum', 'Pendulum Original'], ['pendex', 'Pendex (w/ Expander)'], ['trex', 'T-Rex'], ['phd', 'PHD Appliance'], ['mda', 'MDA Appliance'],
    ['rmd', 'Rapid Molar Distalizer'], ['hsjet', 'Horseshoe Jet'], ['djet', 'Distal Jet'], ['halterman', 'Halterman Appliance'], ['ipc', 'IPC (Inman Power Component)']],
  hold: [['tpa', 'Transpalatal Arch'], ['lla', 'Lingual Arch: Lower'], ['nance', 'Nance Appliance'], ['sm', 'Space Maintainer']],
  other: [['habit', 'Habit'], ['fbp', 'Fixed Bite Plane'], ['xbow', 'Xbow'], ['tandem', 'Tandem']],
  habit: [['crib', 'Crib'], ['spurs', 'Spurs'], ['bluegrass', 'Bluegrass']],
  acc: [['hg', 'Headgear Tubes'], ['lb', 'Lip Bumper Tubes'], ['sheath', 'Lingual Sheaths'], ['fm', 'Facemask Hooks'], ['debondHoles', 'Debonding Holes'], ['vent', 'Vent Holes'],
    ['roc', 'ROC (Removed Occlusal Crown)'], ['debondWires', 'Debonding Wires'], ['color', 'Acrylic Color']]
};
const RXM_K = o => RXM_O[o].map(x => x[0]);
function rxmLbl(v, lists) { for (const o of lists || Object.keys(RXM_O)) { const x = RXM_O[o].find(y => y[0] === v); if (x) return x[1]; } return v === 'mse' ? 'MSE' : v === 'awt' ? 'Archwire Tubes' : v; }
/* the upper expanders: one at a time (the MSE too); the lower fixed expander goes with any of them */
const RXM_UPPER = ['hyrax', 'haas', 'acrylic', 'deluke', 'exspider', 'qh', 'earch', 'warch'];
/* the distalizers that sit on a Nance button (with occlusal rests on the bicuspids for the Pendulum family) */
const RXM_PEND = ['pendulum', 'pendex', 'trex'];
const RXM_SINGLE = ['distR', 'distL', 'mseMm'];
const RXM_MM = ['8', '10', '12'];
/* where a space maintainer can go: the space (a missing 4, 5 or 6 — the D and E on the chart), the band on the tooth behind it */
const RXM_SM = ['UR4', 'UR5', 'UR6', 'UL4', 'UL5', 'UL6', 'LR4', 'LR5', 'LR6', 'LL4', 'LL5', 'LL6'];
const rxmBehind = id => id.slice(0, 2) + (+id[2] + 1);
const rxmSideW = s => s === 'R' ? 'right' : 'left';
/* Specialty's standard bands (and rests) for each appliance — they go on when it's picked (on teeth with nothing yet), and come off
   with it while nothing else picked needs them; a distalizer's are on its side(s); a space maintainer's on the tooth behind its space */
function rxmStd(rx) {
  const b = new Set(), r = new Set(), exp = rx.exp || [], hold = rx.hold || [], oth = rx.other || [];
  const both = (A, n) => { b.add(A + 'R' + n); b.add(A + 'L' + n); };
  if (exp.some(k => RXM_UPPER.includes(k) && k !== 'acrylic' && k !== 'deluke') || rx.mse) both('U', 6);
  if (exp.includes('lowerFixed')) both('L', 6);
  ['R', 'L'].forEach(s => { const d = rx['dist' + s]; if (!d) return;
    if (d === 'halterman') b.add('U' + s + '5'); else { b.add('U' + s + '6'); if (d === 'rmd') b.add('U' + s + '4'); } });
  if (RXM_PEND.includes(rx.distR) || RXM_PEND.includes(rx.distL)) ['UR4', 'UR5', 'UL4', 'UL5'].forEach(id => r.add(id));
  if (hold.includes('tpa') || hold.includes('nance')) both('U', 6);
  if (hold.includes('lla')) both('L', 6);
  if (oth.some(k => ['habit', 'fbp', 'xbow', 'tandem'].includes(k))) both('U', 6);
  if (oth.includes('xbow')) both('L', 6);
  (rx.sm || []).forEach(id => b.add(rxmBehind(id)));
  return { bands: b, rests: r };
}
/* an expander on the Rx (for Amir's 3D printed bands): anything under Expansion, the MSE, the distalizers built on an expansion screw
   (Pendex, T-Rex, PHD, MDA) and the appliances that carry an upper expander (Xbow, Tandem) */
const RXM_DIST_EXP = ['pendex', 'trex', 'phd', 'mda'];
const rxmHasExp = rx => !!((rx.exp || []).length || rx.mse || RXM_DIST_EXP.includes(rx.distR) || RXM_DIST_EXP.includes(rx.distL) || (rx.other || []).some(k => k === 'xbow' || k === 'tandem'));
/* what the office doesn't use (Amir, 4 Oct 2026: "we don't use pendex, t-rex, MDA or xbow, gray all of them out"): greyed out, saying
   so; an Rx that already has one keeps it tappable, so it can be taken off */
const RXM_UNUSED = { pendex: 'the Pendex', trex: 'the T-Rex', mda: 'the MDA', xbow: 'the Xbow' };
function rxmOff(g, v, rx) {
  if ((g === 'distR' || g === 'distL') && RXM_UNUSED[v] && rx[g] !== v) return 'We don’t use ' + RXM_UNUSED[v] + '.';
  if (g === 'other' && v === 'xbow' && !(rx.other || []).includes(v)) return 'We don’t use ' + RXM_UNUSED[v] + '.';
  return '';
}

/* ---------- what each option is (point at it, tab to it or tap it; Compare all) — from Specialty's own pages unless a note says
   otherwise (Specialty has no page for some: the card names its source) ---------- */
const RXM_SRC = {
  rpe: ['Specialty: Upper RPE', 'https://specialtyappliances.com/product/upper-rpe/'],
  haas: ['Specialty: Haas', 'https://specialtyappliances.com/product/haas/'],
  deluke: ['Specialty: DeLuke Contoured Expander', 'https://specialtyappliances.com/product/deluke-contoured-expander/'],
  exspider: ['Specialty: Exspider', 'https://specialtyappliances.com/product/exspider/'],
  lower: ['Specialty: Lower Fixed', 'https://specialtyappliances.com/product/lower-fixed/'],
  qh: ['Specialty: Upper Quad Helix', 'https://specialtyappliances.com/product/upper-quad-helix/'],
  earch: ['Specialty: E-Arch', 'https://specialtyappliances.com/product/e-arch/'],
  warch: ['Specialty: W-Arch', 'https://specialtyappliances.com/product/w-arch/'],
  mse: ['Specialty: MSE Expander', 'https://specialtyappliances.com/product/mse-expander/'],
  msevs: ['Specialty: MSE vs MARPE', 'https://specialtyappliances.com/mse-vs-marpe/'],
  qc: ['QC Ortho: expansion appliances', 'https://www.qcortho.com/expansion-and-arch-development.html'],
  dyn: ['DynaFlex: fixed expanders', 'https://www.dynaflex.com/orthodontic-laboratory/fixed-appliances/fixed-expanders/'],
  odl: ['ODL: RPE with facemask hooks', 'https://odlortho.com/products/rpe-w-facemask-hooks/'],
  pend: ['Specialty: Pendulum', 'https://specialtyappliances.com/product/pendulum/'],
  pendex: ['Specialty: Pendex', 'https://specialtyappliances.com/product/pendex/'],
  trex: ['Specialty: T-Rex', 'https://specialtyappliances.com/product/t-rex/'],
  phd: ['Specialty: PHD', 'https://specialtyappliances.com/product/phd/'],
  mda: ['Specialty: MDA', 'https://specialtyappliances.com/product/mda/'],
  rmd: ['Specialty: Rapid Molar Distalizer', 'https://specialtyappliances.com/product/rapid-molar-distalizer/'],
  hsjet: ['Specialty: Horseshoe Jet', 'https://specialtyappliances.com/product/horseshoe-jet/'],
  djet: ['Specialty: Distal Jet', 'https://specialtyappliances.com/product/distal-jet/'],
  dyndist: ['DynaFlex: distalizers', 'https://www.dynaflex.com/orthodontic-laboratory/fixed-appliances/distalizers/'],
  halt: ['Space Maintainers Laboratory: Halterman', 'https://smlglobal.com/elastic-halterman-appliance-ul'],
  ipc: ['Inman Power Component', 'https://inmanpowercomponent.com/'],
  tpa: ['Specialty: Transpalatal Arch', 'https://specialtyappliances.com/product/transpalatal-arch/'],
  lla: ['Specialty: Lower Lingual Arch', 'https://specialtyappliances.com/product/lower-lingual-arch/'],
  nance: ['Specialty: Nance', 'https://specialtyappliances.com/product/upper-nance-appliance/'],
  sm: ['Specialty: Space Maintainer', 'https://specialtyappliances.com/product/space-maintainer/'],
  crib: ['Specialty: Tongue Guard (habit crib)', 'https://specialtyappliances.com/product/basic-tongue-guard/'],
  blue: ['Specialty: Bluegrass Appliance', 'https://specialtyappliances.com/product/bluegrass-appliance/'],
  spurs: ['Universal Orthodontic Lab: habit spurs', 'https://uniortholab.com/us/portfolio-item/thumb-habit-with-spursupper/'],
  fbp: ['Space Maintainers Laboratory: fixed bite plane', 'https://smlglobal.com/fixed-anterior-bite-plane'],
  xbow: ['Specialty: Xbow Class II corrector', 'https://specialtyappliances.com/product/xbow-class-ii-corrector/'],
  tandem: ['Tandem appliance (JCO 2011)', 'https://www.jco-online.com/archive/2011/06/308-early-treatment-of-skeletal-class-iii-open-bite-with-the-tandem-appliance/'],
  awt: ['Specialty: archwire tubes', 'https://specialtyappliances.com/product/022x028-archwire-tubes/'],
  onbrace: ['Specialty: OnBRACE appliances', 'https://specialtyappliances.com/onbrace-appliances/'],
  print3d: ['Specialty: 3D printed appliances', 'https://specialtyappliances.com/3d-printed-appliances'],
  color: ['Specialty: color chart', 'https://specialtyappliances.com/hawley-color-chart/']
};
const RXM_INFO = {
  exp: {
    hyrax: { short: 'All-metal RPE: a midline screw soldered to the molar bands, with support bars to the bicuspids. No acrylic.',
      sum: 'Specialty’s standard RPE (their “Upper RPE”): a tooth-borne expander with no palatal acrylic.',
      pts: ['Screws from 7 to 13 mm of expansion; the standard design has .040″ lingual support bars from the bicuspids to the first molars (Specialty).',
        'Standard screw included, a Click screw optional; 48 activations on the standard RPE, each ¼ mm (Specialty).',
        'Bands on the first molars (tap the bicuspids for a 4-band RPE).'], src: ['rpe'] },
    haas: { short: 'Tooth- and tissue-borne: the screw sits between acrylic pads on the palate.',
      sum: 'Palatal acrylic on each side of the upper vault, a 13.5 mm screw soldered to bands on the first molars — pressure on the palatal tissue and the teeth (Specialty).',
      pts: ['A 9 mm screw for a constricted arch; Click screw optional.', 'Acrylic in Specialty’s standard colors only — no custom designs or swirls.'], src: ['haas'] },
    acrylic: { short: 'An RPE whose frame is set in acrylic over the back teeth, bonded on instead of banded.',
      sum: 'Like a banded RPE, but acrylic covers the posterior segments and is bonded directly to the teeth (QC Ortho).',
      pts: ['The occlusal acrylic helps manage the vertical dimension (e.g. high-angle patients).', 'Debonding arms and facemask hooks are common options (ODL).', 'Not on Specialty’s site.'],
      note: 'Specialty has no page for it; from QC Ortho and ODL.', src: ['qc', 'odl'] },
    deluke: { short: 'Patented bonded RPE: a lingual-only frame and 3 mm pressure-formed occlusal acrylic; cemented in a moist field.',
      sum: 'Made for permanent or mixed dentition, usually with a 12 mm screw; the wire frame is on the lingual only, with a 3 mm pressure-formed acrylic occlusal surface (Specialty).',
      pts: ['Non-etch cementation, no isolation needed: placed in about 3 minutes.', 'Flexible caps lift off at removal, about like removing braces.', 'Standard screw; Mini, Mini Click and Click optional.'], src: ['deluke'] },
    exspider: { short: 'A fan expander hinged at the molars: opens mainly in front, for tapered arches with enough molar width.',
      sum: 'Activated in the front and hinged in the molar area, usually on first molar bands (Specialty).',
      pts: ['Up to 9 mm of expansion; can suit some cleft palate patients with room for the screw (Specialty).', 'Moves the front laterally with little posterior movement (QC Ortho).'], src: ['exspider', 'qc'] },
    lowerFixed: { short: 'A banded lower screw expander with a heavy lingual wire — Specialty’s most common lower expander.',
      sum: 'A 12 mm reduced-body screw soldered to bands on the lower first molars, with a .059″ lingual support wire (Specialty).',
      pts: ['Rests are generally soldered from the screw to the first bicuspids.', 'Mini screw included, Mini Click optional; a crowned version is offered.'], src: ['lower'] },
    qh: { short: 'A wire expander: .036 steel with four helices, soldered to the first molar bands. No screw.',
      sum: 'Attached to the first molars (upper or lower); the .036″ wire follows the arch with four helical loops to stimulate expansion (Specialty).',
      pts: ['Sweep arms run along the gum side of the bicuspids and cuspids; lingual extensions can reach the front teeth.', 'Can also derotate molars (DynaFlex).'], src: ['qh', 'dyn'] },
    earch: { short: 'Angle’s spring expander: a pin and tube in front with an open coil spring that works as soon as it’s in.',
      sum: 'Originally Dr. Angle’s design: a pin and tube in the front of the arch with an open coil spring for activation, which begins immediately (Specialty).',
      pts: ['No screw. Specialty lists it for the upper arch; DynaFlex makes it mostly as a lower appliance to upright tipped-in back teeth.'], src: ['earch', 'dyn'] },
    warch: { short: 'Porter’s “W” wire expander on the upper first molar bands; can expand one side only.',
      sum: 'The W (Porter) arch uses .036″ stainless steel for expansion, soldered to bands on the upper first molars (Specialty).',
      pts: ['Can be made to slide into sheaths on the molar bands (removable).', 'Unilateral expansion is possible with the right activation. No helices, unlike the quad helix.'], src: ['warch', 'qc'] },
    mse: { name: 'MSE (TAD-supported)', short: 'Dr. Moon’s expander on four palatal miniscrews: delivered first, then the TADs placed. 8, 10 or 12 mm screw.',
      sum: 'The original “TAD second” appliance: the expander is delivered and then the TADs are placed; the screw comes in 8, 10 and 12 mm (Specialty).',
      pts: ['Four bicortical miniscrews in the posterior palate — a bone-borne design (Specialty, MSE vs MARPE).',
        'Not a circle on the form: it prints in the Screw Type blank (“MSE 10 mm”) and the special instructions.',
        'Priced as the list’s MSE RPE TAD (TAD appliances).'], src: ['mse', 'msevs'] }
  },
  dist: {
    pendulum: { short: 'Nance button with rests on the bicuspids; preactivated springs swing the upper first molars back.',
      sum: 'A Nance button and occlusal rests on the first and second premolars for anchorage; the springs are preactivated in the lab (Specialty).',
      pts: ['If the second molars are fully erupted, Specialty recommends distalizing them first.', 'About 4–5 mm of distalization (QC Ortho); .032 TMA springs (DynaFlex).'], src: ['pend', 'dyndist'] },
    pendex: { short: 'A Pendulum with a midline expansion screw: expansion and distalization.',
      sum: 'Like the Pendulum, plus an expansion screw for transverse expansion with the molar distalization (Specialty).',
      pts: ['The screw sits in the acrylic (DynaFlex).', 'Not on Specialty’s price list.'], src: ['pendex', 'dyndist'] },
    trex: { short: 'A Pendex with wires locking it to the molar bands: expands as one unit, then the springs are freed to distalize.',
      sum: 'A Pendex with .032″ T-Rex wires soldered to the mesio-lingual of the first molar bands, inserted as a unit for greater molar expansion (Specialty).',
      pts: ['The screw expands first, then the preactivated springs are cut loose to distalize (DynaFlex).', 'On the list as Pendulum: T-Rex.'], src: ['trex', 'dyndist'] },
    phd: { short: 'An 8 mm screw with laser-welded sheaths: expands first, then distalizes, and can be reactivated.',
      sum: 'An 8 mm expansion screw with sheaths laser welded to it, so it can be reactivated for more distalization (Specialty).',
      pts: ['The expansion phase is finished before distalization starts; rests or bands add anchorage.', 'Not on Specialty’s price list.'], src: ['phd'] },
    mda: { short: 'The PHD idea on a 12 mm screw: a “hygienic alternative to the Pendex”.',
      sum: 'A 12 mm expansion screw with sheaths laser welded to it, reactivated for more distalization (Specialty).',
      pts: ['Expands first, then distalizes; rests or bands for anchorage.', 'On the list as MDA w/ Expander.'], src: ['mda'] },
    rmd: { short: 'Small screws on the cheek side push the molars straight back against a large Nance, ¼ mm a turn.',
      sum: 'Predictable distalization with little tipping, from small expansion screws on the buccal of the arch (Specialty).',
      pts: ['Bands on the first bicuspids and first molars (the second bicuspids and second molars if the 7s are in).', 'Turned every other day or twice a week.',
        'Say how many mm per side in the special instructions: Specialty makes the follow-up Nance at the same time.'], src: ['rmd'] },
    hsjet: { short: 'A Distal Jet on two front palatal TADs only — no anchorage from the teeth; then locks as a Nance.',
      sum: 'Pure skeletal anchorage with two anterior TADs, so there’s no anchorage loss to the teeth or the palatal vault (Specialty).',
      pts: ['Forces act close to the molars’ center of resistance.', 'Once activation is done it locks and serves as a Nance holding appliance.', 'Priced as the list’s TAD Horseshoe Jet.'], src: ['hsjet'] },
    djet: { short: 'Nance-anchored coil springs on tubes push the molars back — one side or both.',
      sum: 'Adjustable coil springs, used on one or both sides of the upper arch, with an anterior Nance for anchorage (Specialty).',
      pts: ['The second bicuspids tend to follow the molars back; expansion can be added on request.', 'The list prices the bilateral Distal Jet; one side isn’t on it.'], src: ['djet', 'dyndist'] },
    halterman: { short: 'Frees an ectopic first molar caught under the second primary molar: an elastic pulls it back.',
      sum: 'For a first molar erupting under the distal of the second primary molar: a band on the primary molar with a hook behind the first molar, a button bonded on the first molar, and elastic chain between (SML).',
      pts: ['Usually one side; the second primary molar is the only anchorage.', 'Not on Specialty’s site or price list.'], note: 'Specialty has no page for it; from Space Maintainers Laboratory.', src: ['halt'] },
    ipc: { short: 'Inman Lab’s one-way sliding lock that compresses a coil spring 1 mm a click, on a Nance-anchored distalizer.',
      sum: 'A unidirectional sliding lock: each 1 mm “click” compresses the open coil spring and it can’t slip back (Inman Lab).',
      pts: ['Used on a distalizer with a large Nance button and wires to the bicuspids (or Es).', 'On Specialty’s list as Inman Power Component.'], note: 'Specialty has no page for it; from Inman Lab.', src: ['ipc'] }
  },
  hold: {
    tpa: { short: '.036 wire across the palate with a center loop, soldered to the first molar bands.',
      sum: 'A .036″ wire with a center loop, soldered to the molar bands, relieved from the tissue (Specialty).',
      pts: ['Passive, or adjusted to widen or rotate the molars slightly.'], src: ['tpa'] },
    lla: { short: '.036 wire along the lower front teeth’s tongue side, soldered to the first molar bands: holds arch length.',
      sum: 'A .036″ wire contoured to the lingual of the teeth and soldered to bands on the lower first molars (Specialty).',
      pts: ['Adjustment loops in front of the molars are standard (a no-loop version is an option).', 'Spurs can be soldered behind the laterals to hold space.'], src: ['lla'] },
    nance: { short: 'A palatal wire with an acrylic button on the front of the palate: keeps the molars from drifting forward.',
      sum: 'The wire crosses the palate to the first bicuspid area, soldered to bands on the first molars, with an acrylic button over it in front of the palatal vault (Specialty).',
      pts: ['Prevents the molars moving forward during the transition.', 'Acrylic color can be picked.'], src: ['nance'] },
    sm: { short: 'A band and loop holding the space for a tooth that hasn’t come in.',
      sum: 'A wire loop soldered to a molar band, its front resting against the tooth in front of the space (Specialty).',
      pts: ['Upper or lower. Tap the space on the arches (the missing tooth): the band goes on the tooth behind it, and the teeth go on the form’s line.'], src: ['sm'] }
  },
  other: {
    habit: { short: 'A fixed habit appliance: a crib, spurs or a Bluegrass bead on a wire from the molar bands.',
      sum: 'A .040″ support wire soldered to the first molar bands, carrying a habit breaker behind the front teeth (Specialty’s Tongue Guard). Pick crib, spurs or Bluegrass under the row.',
      pts: ['Specialty: the cage style works for most patients; the rake style for determined thumb habits.'], src: ['crib'] },
    crib: { name: 'Habit: crib', short: 'A vertical cage just behind the lower front teeth: stops thumb sucking and tongue thrust.',
      sum: 'A vertical “cage” extending just behind the lower anteriors from a .040″ wire on the first molar bands (Specialty).', pts: ['Priced as the list’s Habit Appliance.'], src: ['crib'] },
    spurs: { name: 'Habit: spurs', short: 'Pointed spurs that deter the tongue or finger.',
      sum: 'Metal spurs used to control a tongue-thrust habit, soldered onto an appliance such as a lingual arch (Universal Orthodontic Lab).',
      note: 'Specialty has no page for habit spurs.', src: ['spurs'] },
    bluegrass: { name: 'Habit: Bluegrass', short: 'The habit appliance with a “pearl” in the palate that retrains the tongue.',
      sum: 'The habit appliance with an added pearl in the vault of the palate to retrain the tongue (Specialty).', pts: ['On the list as the Bluegrass Appliance.'], src: ['blue'] },
    fbp: { short: 'An acrylic bite plane behind the upper front teeth on a wire from the first molar bands: opens deep bites.',
      sum: 'Attached to bands on the upper first molars, with an anterior acrylic bite plane from cuspid to cuspid (SML).',
      pts: ['For deep bites, e.g. when the lower front teeth need brackets.'], note: 'Specialty has no page for it; from Space Maintainers Laboratory.', src: ['fbp'] },
    xbow: { short: 'Dr. Higgins’ fixed Class II corrector: an upper expander and lower arches joined by Forsus springs.',
      sum: 'Uses Forsus springs with a lower lingual holding arch; Gurin locks just in front of the lower first bicuspids allow further advancement (Specialty).',
      pts: ['Specialty doesn’t supply the Forsus mechanism.', 'Expansion: a 12 mm RPE screw, Mini-Expander or Click.', 'Specialty’s page points to its Functionals Rx; the Metal Rx has the circle.'], src: ['xbow'] },
    tandem: { short: 'An intraoral Class III protraction set: a fixed upper expander with hooks, a lower bite block and a facebow with elastics.',
      sum: 'Three parts, one fixed and two removable: an upper expander with buccal arms for protraction elastics, a lower appliance with occlusal coverage and headgear tubes, and a facebow (JCO 2011).',
      note: 'Specialty has no page for it; from the JCO article.', src: ['tandem'] }
  },
  acc: {
    awt: { name: 'Archwire tubes', short: '.022 × .028 tubes welded on the molar bands, so braces can be used at the same time.',
      sum: 'Weldable stainless steel archwire tubes; Specialty’s standard slot is .022 × .028.', pts: ['Pick upper, lower or both.', '$27.50 a pair on Specialty’s metals list.'], src: ['awt'] },
    hg: { short: 'A round tube on the upper molar bands for a facebow.', sum: 'A tube on the cheek side of the upper molar bands that takes a headgear facebow.', note: 'Specialty doesn’t describe it; not on its price list.' },
    lb: { short: 'A tube on the lower molar bands for a lip bumper.', sum: 'A tube on the cheek side of the lower molar bands that takes a lip bumper.', note: 'Specialty doesn’t describe it; not on its price list.' },
    sheath: { short: 'Sheaths on the tongue side of the molar bands that take a removable wire.', sum: 'Lingual sheaths on the molar bands accept a removable palatal or lingual wire (e.g. Specialty’s removable W-arch).',
      pts: ['$29.50 a pair on Specialty’s list.'], src: ['warch'] },
    fm: { short: 'Hooks on the expander for facemask elastics (Class III).', sum: 'Hooks laser welded to the appliance for a facemask that pulls the upper jaw forward (ODL).',
      pts: ['Say where on the line.'], note: 'Specialty doesn’t describe them; not on its price list.', src: ['odl'] },
    debondHoles: { short: 'Holes in the crowns to help take them off.', sum: 'Crown customization: holes in the crowns.', pts: ['Free on Specialty’s list (crown customization, holes/slits).'], note: 'Specialty doesn’t define them.' },
    vent: { short: 'Holes in the crowns that let excess cement out.', sum: 'Crown customization: vent holes in the crowns.', pts: ['Free on Specialty’s list (crown customization, holes/slits).'], note: 'Specialty doesn’t define them.' },
    roc: { short: 'Crowns with the biting surface removed: a crown’s strength, a band’s easy removal.', sum: 'ROC: a crown with its occlusal surface removed (Specialty).',
      pts: ['The crowned teeth are drawn open on top. A crown customization, free on the list.'], src: ['onbrace'] },
    debondWires: { short: 'Wire arms into the cheek fold: a leverage point for taking a bonded appliance off.', sum: 'Debonding arms laser welded from the frame into the vestibule, giving a leverage point for removal (ODL).',
      pts: ['Not on Specialty’s list by that name: it has debonding loops ($38.50 a pair) and debonding screws ($49 a pair). Dr. A can give it a price in Team & security.'], src: ['odl'] },
    color: { short: 'The acrylic’s color (Nance button, Haas pads, bite plane): Specialty colors are free.', sum: 'Specialty asks for the color on the Rx; their color chart has the names.',
      pts: ['Glitter, glow and swirl cost extra; the Haas takes standard colors only.'], src: ['color'] }
  }
};
/* each appliance's photo on Specialty's site (their product page's main picture; research 4 Oct 2026 — Amir: "can you link each
   appliance to it's photo on speciality lab"). Specialty has none for the Halterman, IPC, habit spurs, fixed bite plane or Tandem
   (the acrylic bonded RPE's is from their Ordont sister lab's page, on Specialty's own server) */
const RXM_PHOTO_AT = 'https://specialtyappliances.com/wp-content/uploads/2023/12/';
const RXM_PHOTO = {
  hyrax: 'Upper-RPE-1.png', haas: 'Haas.png', acrylic: 'Bonded-RPE.png', deluke: 'DeLuke-4.png', exspider: 'Exspider-1.png', lowerFixed: 'Lower-Fixed.png',
  qh: 'Quad-Helix-Blue-BG-Cropped-3.jpg', earch: 'E-Arch-1.png', warch: 'W-Arch-1.png', mse: 'MSE.png',
  pendulum: 'Pendulum.png', pendex: 'Pendex.png', trex: 'T-Rex.png', phd: 'PHD-Blue-BG-Cropped-3-e1743780205810.jpg', mda: 'MDA-Blue-BG-Cropped-3-e1743771635918.jpg',
  rmd: 'Rapid-Molar-Distalizer-Blue-BG-Cropped-3.jpg', hsjet: 'Horseshoe-Jet-1-2.png', djet: 'Distal-Jet-.png',
  tpa: 'TPA.png', lla: 'Lower-Lingual-Arch-1.png', nance: 'Upper-Nance.png', sm: 'Space-Maintainer-1.png',
  habit: 'Tongue-Guard.png', crib: 'Basic-Tongue-Guard_Vertical-Habit-Crib.jpg', bluegrass: 'Bluegrass.png', xbow: 'Xbow-Blue-BG-Cropped-4.jpg'
};
Object.keys(RXM_INFO).forEach(g => Object.keys(RXM_INFO[g]).forEach(k => { if (RXM_PHOTO[k]) RXM_INFO[g][k].photo = RXM_PHOTO_AT + RXM_PHOTO[k]; }));

/* ---------- prices: Specialty's price list MKT-41 (Rev 01-26, updated 1-27-26): metals (expanders, distalizers, other designs,
   custom design options); the MSE and Horseshoe Jet from its TAD appliances. Bands, crowns, 3D printing, the TPA and the quad helix
   are the same on the list as with the Herbst (one price each, with the Herbst Rx's in Team & security). Everything else is
   unpriced until Dr. A enters a price — the form's debonding wires too (the list has debonding loops and screws, not wires) and a
   one-sided Distal Jet (the list's is bilateral). ---------- */
const RXM_PRICES = [
  ['hyrax', 'RPE: Hyrax design', 109.00], ['haas', 'RPE: Haas design', 146.00], ['rpeAcr', 'RPE: Acrylic design', 157.50],
  ['exspider', 'Exspider appliance (fan)', 213.00], ['earch', 'E-Arch', 103.00], ['mse', 'MSE RPE TAD (TAD appliances)', 489.50],
  ['pendulum', 'Pendulum: Original', 169.00], ['trex', 'Pendulum: T-Rex', 217.00], ['mda', 'MDA w/ expander', 216.00], ['rmd', 'Rapid Molar Distalizer', 224.00],
  ['djet', 'Distal Jet: bilateral', 242.50], ['ipc', 'Inman Power Component', 230.50], ['hsjet', 'TAD Horseshoe Jet (TAD appliances)', 225.00],
  ['habitApp', 'Habit appliance', 103.00], ['bluegrass', 'Bluegrass appliance', 140.50], ['nance', 'Nance: lingual button', 96.00], ['lla', 'Fixed lingual arch', 77.00],
  ['sm', 'Space maintainer', 76.00], ['xbow', 'X-Bow', 267.50], ['xbowGurin', 'X-Bow with 2 Gurin locks', 386.50], ['fbp', 'Fixed bite plane', 128.50],
  ['awtPr', 'Archwire tubes, pair', 27.50], ['sheath', 'Lingual sheaths, pair', 29.50],
  // not on the price list
  ['deluke', 'DeLuke contoured RPE', null], ['lowerFixed', 'Lower fixed expander', null], ['warch', 'W-Arch', null], ['pendex', 'Pendex (w/ expander)', null],
  ['phd', 'PHD appliance', null], ['halterman', 'Halterman appliance', null], ['tandem', 'Tandem', null],
  ['hgTubes', 'Headgear tubes', null], ['lbTubes', 'Lip bumper tubes', null], ['fmHooks', 'Facemask hooks', null],
  ['debondWires', 'Debonding wires, pair (the list has debonding loops $38.50/pr and debonding screws $49/pr)', null], ['djetUni', 'Distal Jet, one side (the list prices it bilateral)', null]
];
rxAddPrices(RXM_PRICES);
/* each choice's price key (the TPA and quad helix are the Herbst Rx's: the same on the list) */
const RXM_PK = { hyrax: 'hyrax', haas: 'haas', acrylic: 'rpeAcr', deluke: 'deluke', exspider: 'exspider', lowerFixed: 'lowerFixed', qh: 'qh', earch: 'earch', warch: 'warch',
  pendulum: 'pendulum', pendex: 'pendex', trex: 'trex', phd: 'phd', mda: 'mda', rmd: 'rmd', hsjet: 'hsjet', djet: 'djet', halterman: 'halterman', ipc: 'ipc',
  tpa: 'tpa', lla: 'lla', nance: 'nance', sm: 'sm', fbp: 'fbp', xbow: 'xbow', tandem: 'tandem', hg: 'hgTubes', lb: 'lbTubes', fm: 'fmHooks', sheath: 'sheath', debondWires: 'debondWires', mse: 'mse' };
const RXM_NOTE = { trex: 'the list’s Pendulum: T-Rex', mda: 'the list’s MDA w/ Expander', hsjet: 'the list’s TAD Horseshoe Jet', ipc: 'the list’s Inman Power Component', nance: 'the list’s Nance: Lingual Button', lla: 'the list’s Fixed Lingual Arch' };

/* ---------- the Rx: one way to save it ---------- */
function rxmCanon(rx) {
  const o = { form: RX_MET }, { one, list, flag } = rxCanonKit(rx, o);
  list('exp', RXM_K('exp'));
  flag('mse'); if (o.mse) one('mseMm', RXM_MM);
  // one upper expander at a time, and none with the MSE (the lower fixed expander goes with any)
  if (o.exp) { const up = o.exp.filter(k => RXM_UPPER.includes(k)); if (o.mse || up.length > 1) { o.exp = o.exp.filter(k => !RXM_UPPER.includes(k) || (!o.mse && k === up[0])); if (!o.exp.length) delete o.exp; } }
  one('screw', null, 40);
  one('distR', RXM_K('dist')); one('distL', RXM_K('dist'));
  // space maintainers: the spaces tapped tick the circle
  const sm = (Array.isArray(rx.sm) ? rx.sm : []).filter(id => RXM_SM.includes(id));
  const hold = new Set(Array.isArray(rx.hold) ? rx.hold : []); if (sm.length) hold.add('sm');
  const hu = RXM_K('hold').filter(v => hold.has(v)); if (hu.length) o.hold = hu;
  if (sm.length && hold.has('sm')) o.sm = RXM_SM.filter(x => sm.includes(x));
  if (hold.has('sm')) one('smTxt', null, 40);
  list('other', RXM_K('other')); if ((o.other || []).includes('habit')) list('habit', RXM_K('habit'));
  if ((o.other || []).includes('xbow')) flag('gurin');
  list('awt', ['U', 'L']);
  const acc = new Set(Array.isArray(rx.acc) ? rx.acc : []); if (String(rx.colorTxt || '').trim()) acc.add('color'); if (String(rx.fmTxt || '').trim()) acc.add('fm');
  const au = RXM_K('acc').filter(v => acc.has(v)); if (au.length) o.acc = au;
  if (acc.has('fm')) one('fmTxt', null, 40); one('colorTxt', null, 40);
  const t = {}; RX_GRID.forEach(id => { const v = (rx.teeth || {})[id]; if (RX_KEYS('anch').includes(v)) t[id] = v; }); if (Object.keys(t).length) o.teeth = t;
  list('occl', RX_GRID);
  // the bands and rests the rules put on (not by hand): they come off when nothing picked needs them any more
  const sb = Array.isArray(rx.stdB) ? rx.stdB : [], sr = Array.isArray(rx.stdR) ? rx.stdR : [];
  const b2 = RX_GRID.filter(id => sb.includes(id) && t[id] === 'band'), r2 = RX_GRID.filter(id => sr.includes(id) && (o.occl || []).includes(id));
  if (b2.length) o.stdB = b2; if (r2.length) o.stdR = r2;
  flag('enclosed'); flag('printed3d'); flag('rush');
  rxCanonTail(rx, o, RXM);
  return o;
}
/* the appliances on the Rx, in words (what an "Other metal appliance" case is: its detail line and chart note) */
function rxmItems(rx) {
  rx = rx || {}; const out = [];
  if (rx.mse) out.push('MSE' + (rx.mseMm ? ' ' + rx.mseMm + ' mm' : ''));
  (rx.exp || []).forEach(k => out.push(rxmLbl(k, ['exp'])));
  const dk = {}; ['R', 'L'].forEach(s => { const v = rx['dist' + s]; if (v) (dk[v] = dk[v] || []).push(s); });
  Object.keys(dk).forEach(k => out.push(rxmLbl(k, ['dist']).replace(/ \(.*\)$/, '') + (dk[k].length === 2 ? '' : ' (' + rxmSideW(dk[k][0]) + ')')));
  (rx.hold || []).forEach(k => out.push(k === 'sm' ? ((rx.sm || []).length > 1 ? rx.sm.length + ' Space Maintainers' : 'Space Maintainer') : rxmLbl(k, ['hold'])));
  (rx.other || []).forEach(k => out.push(k === 'habit' ? 'Habit' + ((rx.habit || []).length ? ' (' + rx.habit.map(h => rxmLbl(h, ['habit']).toLowerCase()).join(', ') + ')' : '') : rxmLbl(k, ['other'])));
  return out;
}
/* … less what the case's other appliance choices already say (with RPE picked too: its expander; with MSE: the MSE) */
const RXM_RPE_K = ['hyrax', 'haas', 'acrylic', 'deluke', 'exspider'];
function rxmWhat(rx, appl) {
  if (!rx || typeof rx !== 'object') return ''; const r = rxCanon(Object.assign({}, rx, { form: RX_MET })); appl = appl || [];
  if (appl.includes(RXM_RPE)) r.exp = (r.exp || []).filter(k => !RXM_RPE_K.includes(k));
  if (appl.includes('MSE')) delete r.mse;
  return rxmItems(r).join(', ');
}
/* "Other metal appliance" on a case: what its Metal Rx says it is ("Nance Appliance, Lingual Arch: Lower"), until then its own name */
function rxmOtherText(c) { return rxmWhat(c && c.rxMet, c && c.appliances) || RXM_OTHER; }
/* "Hyrax RPE · 2 bands (3D printed)" */
function rxmSummary(rx) {
  const n = {}; Object.values(rx.teeth || {}).forEach(v => { n[v] = (n[v] || 0) + 1; });
  const anch = RXO.anch.filter(([k]) => n[k]).map(([k, l]) => n[k] + ' ' + (k === 'onbrace' ? 'OnBRACE' : k === 'roc' ? 'ROC' + (n[k] > 1 ? 's' : '') : l.toLowerCase() + (n[k] > 1 ? 's' : ''))).join(', ');
  return rxmItems(rx).concat(anch ? [anch + (rx.printed3d && !rx.enclosed ? ' (3D printed)' : '')] : []).join(' · ') || 'Nothing picked yet';
}
function rxmEstimate(rx, c) {
  const E = rxEst(), add = E.add, inc = E.inc, P = RXM_PK;
  (rx.exp || []).forEach(k => add(rxmLbl(k, ['exp']), P[k], 1, k === 'qh' ? 'the list’s Quad Helix: Fixed' : ''));
  if (rx.mse) add('MSE expander' + (rx.mseMm ? ' · ' + rx.mseMm + ' mm screw' : ''), 'mse', 1, 'the list’s MSE RPE TAD (TAD appliances)');
  // a distalizer on both sides is one appliance
  const dk = {}; ['R', 'L'].forEach(s => { const v = rx['dist' + s]; if (v) (dk[v] = dk[v] || []).push(s); });
  Object.keys(dk).forEach(k => { const sd = dk[k], where = sd.length === 2 ? 'right & left' : rxmSideW(sd[0]);
    add(rxmLbl(k, ['dist']) + ' · ' + where, k === 'djet' && sd.length === 1 ? 'djetUni' : P[k], 1, RXM_NOTE[k] || ''); }); // (the list prices the Distal Jet bilateral only)
  (rx.hold || []).forEach(k => { if (k === 'sm') { const q = Math.max(1, (rx.sm || []).length); add('Space maintainer' + (q > 1 ? ' × ' + q : ''), 'sm', q); }
    else add(rxmLbl(k, ['hold']), P[k], 1, k === 'tpa' ? 'the list’s Transpalatal Arch' : RXM_NOTE[k] || ''); });
  (rx.other || []).forEach(k => {
    if (k === 'habit') { const h = rx.habit || []; if (h.includes('bluegrass')) add('Bluegrass appliance' + (h.length > 1 ? ' (' + h.map(x => rxmLbl(x, ['habit']).toLowerCase()).join(', ') + ')' : ''), 'bluegrass');
      else add('Habit appliance' + (h.length ? ' (' + h.map(x => rxmLbl(x, ['habit']).toLowerCase()).join(', ') + ')' : ''), 'habitApp'); }
    else if (k === 'xbow') add(rx.gurin ? 'Xbow with 2 Gurin locks' : 'Xbow', rx.gurin ? 'xbowGurin' : 'xbow', 1, 'Specialty doesn’t supply the Forsus springs');
    else add(rxmLbl(k, ['other']), P[k]);
  });
  // anchorage (as the Herbst's): enclosed bands/crowns are free; Specialty's are priced each, 3D printed or not
  const n = { band: 0, crown: 0, roc: 0, onbrace: 0 }; Object.values(rx.teeth || {}).forEach(v => { n[v]++; });
  if (rx.enclosed && (n.band || n.crown || n.roc)) inc('Bands / crowns enclosed with the case', 'No charge');
  else { const d3 = rx.printed3d;
    if (n.band) add((d3 ? '3D printed bands' : 'Bands provided and fit') + ' × ' + n.band, d3 ? 'band3d' : 'band', n.band);
    if (n.crown + n.roc) add((d3 ? '3D printed crowns' : 'Crowns provided and fit') + ' × ' + (n.crown + n.roc) + (n.roc ? ' (' + n.roc + ' ROC)' : ''), d3 ? 'crown3d' : 'crown', n.crown + n.roc); }
  if (n.onbrace) add('OnBRACE × ' + n.onbrace, 'onbrace', n.onbrace);
  if ((rx.occl || []).length) inc('Occlusal rests × ' + rx.occl.length, 'With the appliance');
  // accessories
  const awt = rx.awt || []; if (awt.length) add('Archwire tubes · ' + (awt.length === 2 ? 'upper & lower' : awt[0] === 'U' ? 'upper' : 'lower') + ' × ' + awt.length + ' pr', 'awtPr', awt.length);
  const acc = rx.acc || [];
  [['hg', 'Headgear tubes'], ['lb', 'Lip bumper tubes'], ['fm', 'Facemask hooks']].forEach(([k, l]) => { if (acc.includes(k)) add(l, P[k]); });
  if (acc.includes('sheath')) { const pr = Math.max(1, ['U', 'L'].filter(A => ['R', 'L'].some(s => (rx.teeth || {})[rxAnchorOn(rx, A, s, [6, 7])])).length);
    add('Lingual sheaths × ' + pr + ' pr', 'sheath', pr, pr > 1 ? 'upper and lower molars' : ''); }
  if (acc.includes('debondWires')) add('Debonding wires × 1 pr', 'debondWires');
  const cust = ['debondHoles', 'vent', 'roc'].filter(k => acc.includes(k));
  if (cust.length) inc(cust.map(k => rxmLbl(k, ['acc'])).join(', '), 'Free (crown customization)');
  const col = String(rx.colorTxt || '').trim();
  if (col || acc.includes('color')) { if (/glitter|glow|swirl/i.test(col)) add('Acrylic: ' + col, 'glitter'); else inc('Acrylic' + (col ? ': ' + col : ' color'), 'Free (Specialty colors)'); }
  if (rx.rush) add('Expedited manufacturing and shipping', 'rush', 1, 'Specialty’s fee for under 10 business days');
  return E.done();
}

/* ---------- the arch diagram: the appliance drawn from the choices (RXG = this form while rxAuto draws) ---------- */
function rxmAuto(rx, c) {
  const out = [], teeth = rx.teeth || {}, S2 = ['R', 'L'], exp = rx.exp || [], hold = rx.hold || [], oth = rx.other || [], acc = rx.acc || [];
  const stroke = (d, w, col, dash) => out.push(Object.assign({ d, s: col || RX_METAL, w }, dash ? { dash } : {}));
  const fill = (d, col, s, w) => out.push({ d, f: col, s: s || '', w: w || 0 });
  const dot = (p, r) => fill(RXP.circle(p[0], p[1], r || 1.1), RX_METAL);
  const ring = (p, r, w) => fill(RXP.circle(p[0], p[1], r), '#FFFFFF', RX_METAL, w || .8);
  const wire = (pts, w) => stroke(pts.length > 2 ? RXP.smooth(pts) : RXP.poly(pts), w || 1.1);
  const mid = (a, b, t) => [a[0] + (b[0] - a[0]) * (t == null ? .5 : t), a[1] + (b[1] - a[1]) * (t == null ? .5 : t)];
  const L = (id, gap, along) => rxrL(id, gap == null ? 1 : gap, along || 0), Bc = (id, gap, along) => rxrB(id, gap == null ? 1 : gap, along || 0);
  const tn = rxrTint(rx.colorTxt || ''), acr = (d) => fill(d, tn.f, tn.s, .6);
  const molar = (A, s) => rxAnchorOn(rx, A, s, [6, 7]);
  const dist = s => rx['dist' + s];
  // the palate: from between the upper central incisors to between the 7s
  const front = mid(L('UR1', 1), L('UL1', 1)), back = mid(rxT('UR7').c, rxT('UL7').c);
  const ax = (() => { const dx = back[0] - front[0], dy = back[1] - front[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; })(); // toward the back
  const along = (p, k) => [p[0] + ax[0] * k, p[1] + ax[1] * k];
  // an expansion screw (expands across): its body, the slot and the arrows
  const screw = (cpt, w, h) => { const [cx, cy] = cpt; w = w || 11; h = h || 7;
    fill(RXP.poly([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], true), '#E5E7EB', RX_METAL, 1);
    stroke(RXP.line([cx - w * .3, cy], [cx + w * .3, cy]), .7);
    fill(RXP.poly([[cx - w * .42, cy], [cx - w * .25, cy - 1.3], [cx - w * .25, cy + 1.3]], true), RX_METAL); fill(RXP.poly([[cx + w * .42, cy], [cx + w * .25, cy - 1.3], [cx + w * .25, cy + 1.3]], true), RX_METAL); };
  const coil = (a, b, n, amp) => { const dx = b[0] - a[0], dy = b[1] - a[1], Lz = Math.hypot(dx, dy) || 1, ux = dx / Lz, uy = dy / Lz, nx = -uy, ny = ux, pts = [a]; n = n || 7; amp = amp || 1.3;
    for (let i = 1; i < n; i++) { const t = i / n, s = i % 2 ? amp : -amp; pts.push([a[0] + dx * t + nx * s, a[1] + dy * t + ny * s]); } pts.push(b); stroke(RXP.poly(pts), .7); };
  const tad = p => { ring(p, 1.55, .8); stroke(RXP.line([p[0] - .9, p[1] - .9], [p[0] + .9, p[1] + .9]), .5); stroke(RXP.line([p[0] - .9, p[1] + .9], [p[0] + .9, p[1] - .9]), .5); };
  const cap = (id, k) => { const p = rxPoly(id, k || 1.08); stroke(rxHatch(p, 45, 1.6), .35, tn.s); fill(RXP.poly(p, true), tn.f + '99', tn.s, .5); };
  const rest = id => { const r = rxT(id).r, seven = id.slice(-1) === '7', p = rxPt(id, seven ? r * .1 : r * .42, 0); stroke(RXP.line(p, seven ? rxPt(id, r * 1.05, 0) : rxPt(id, r * .42, -r * .95)), .8); dot(p, 1.5); };
  // the Nance button (acrylic on the front of the palate) and its wires to the anchored molars (or to `to`)
  const nanceC = () => along(mid(L('UR3', 2.5), L('UL3', 2.5)), 6.5);
  const nance = (big, to) => { const c0 = nanceC(), wdt = Math.hypot(L('UR4', 2)[0] - L('UL4', 2)[0], L('UR4', 2)[1] - L('UL4', 2)[1]) * (big ? .36 : .28), ht = big ? 8 : 6;
    (to || S2.map(s => L(molar('U', s), 1.2))).forEach(p => { wire([p, mid(p, c0, .55), [c0[0] + Math.sign(p[0] - c0[0]) * wdt * .55, c0[1]]], 1.1); dot(p, 1.1); });
    acr(RXP.ellipse(c0[0], c0[1], wdt, ht)); return { c: c0, w: wdt, h: ht }; };
  // anchorage: band = a ring, crown = filled, ROC = crown with the occlusal open, OnBRACE = hatched (as the Herbst Rx)
  Object.keys(teeth).forEach(id => { const k = teeth[id], r = rxT(id).r, rocAll = acc.includes('roc');
    if (k === 'band') stroke(RXP.poly(rxPoly(id, (r + .9) / r), true), 1.6);
    else if (k === 'crown' || k === 'roc') { fill(RXP.poly(rxPoly(id, 1.05), true), '#C9D6EA', RX_METAL, 1.1); if (k === 'roc' || rocAll) fill(RXP.poly(rxPoly(id, .48), true), '#FFFFFF', RX_METAL, .6);
      if (acc.includes('vent') && k !== 'roc' && !rocAll) fill(RXP.circle(...rxPt(id, -r * .22, -r * .1), .75), '#FFFFFF', RX_METAL, .5);
      if (acc.includes('debondHoles')) fill(RXP.circle(...rxPt(id, 0, r * .6), .75), '#FFFFFF', RX_METAL, .5); }
    else if (k === 'onbrace') { const p = rxPoly(id, 1.05); stroke(rxHatch(p, 45, 1.5), .5); stroke(RXP.poly(p, true), 1.15); }
    if (acc.includes('debondWires') && +id[2] >= 4) { const t = rxT(id), a = Bc(id, .6, -r * .2), b = [a[0] + t.b[0] * 3.6, a[1] + t.b[1] * 3.6]; stroke(RXP.poly([a, b, [b[0] + t.m[0] * 2, b[1] + t.m[1] * 2]]), .8); }
  });
  (rx.occl || []).forEach(rest);
  // ---- expansion (upper): the screw between the 5s and 6s, arms to the molars and support bars along the bicuspids
  const upE = exp.filter(k => RXM_UPPER.includes(k))[0] || (rx.mse ? 'mse' : '');
  const scC = () => { const a = mid(rxT('UR5').c, rxT('UR6').c), b = mid(rxT('UL5').c, rxT('UL6').c); return mid(a, b); };
  const armsTo = (c0, w, h, ids) => ids.forEach(id => { const p = L(id, 1); stroke(RXP.line([c0[0] + (p[0] < c0[0] ? -w / 2 : w / 2), c0[1] + (p[1] < c0[1] ? -h / 2 + 1 : h / 2 - 1)], p), 1.2); dot(p, 1.1); });
  const bars = () => S2.forEach(s => { const m = molar('U', s); if (rxT(m)) wire([L(m, 1.1), L('U' + s + '5', 1.2), L('U' + s + '4', 1.2)], 1.0); });
  const prem = s => ['U' + s + '4', 'U' + s + '5'].find(id => teeth[id]);
  if (['hyrax', 'haas', 'deluke', 'acrylic'].includes(upE)) {
    const c0 = scC(), ids = S2.map(s => molar('U', s)).concat(S2.map(prem).filter(Boolean));
    if (upE === 'haas') S2.forEach(s => { const o = [L('U' + s + '4', 1.4), L('U' + s + '5', 1.4), L('U' + s + '6', 1.4)], i = o.map(p => [p[0] + (c0[0] - p[0]) * .58, p[1]]).reverse(); acr(RXP.smooth(o.concat(i, [o[0]]))); });
    if (upE === 'acrylic' || upE === 'deluke') S2.forEach(s => [4, 5, 6].concat(upE === 'acrylic' ? [3] : []).forEach(n => cap('U' + s + n, upE === 'deluke' ? 1.02 : 1.1)));
    if (upE === 'deluke') S2.forEach(s => wire([L('U' + s + '3', 1), L('U' + s + '4', 1), L('U' + s + '5', 1), L('U' + s + '6', 1)], .9));
    armsTo(c0, 11, 7, upE === 'acrylic' || upE === 'deluke' ? S2.map(s => 'U' + s + '5') : ids); if (upE !== 'acrylic' && upE !== 'deluke') bars(); screw(c0);
  }
  if (upE === 'exspider') { // hinged at the molars, the screw in front
    const hg = along(scC(), 7), sc = along(mid(L('UR3', 3), L('UL3', 3)), 4);
    S2.forEach(s => { const m = L(molar('U', s), 1); wire([m, hg], 1.1); dot(m); const side = [sc[0] + (s === 'R' ? -5.5 : 5.5), sc[1]]; wire([hg, mid(hg, side), side], 1.1); wire([side, L('U' + s + '4', 1.2), L('U' + s + '3', 1.2)], .9); });
    ring(hg, 1.8, 1); screw(sc);
  }
  if (upE === 'mse') { // the screw body in the back of the palate on four miniscrews
    const c0 = along(scC(), 3), w = 13, h = 8;
    S2.forEach(s => { const m = molar('U', s); if (teeth[m]) armsTo(c0, w, h, [m]); });
    screw(c0, w, h); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => tad([c0[0] + sx * (w / 2 + 2.4), c0[1] + sy * (h / 2 + 1.6)]));
  }
  if (upE === 'qh') { // outer arms along the bicuspids, a helix behind each molar and two in front, the bridge between (as the Herbst Rx)
    const side = s => { const m = molar('U', s), t = rxT(m), at = rxPt(m, 0, -(t.r + 1.2));
      return { arm: [rxPt('U' + s + '3', 0, -(rxT('U' + s + '3').r + 1.4)), rxPt('U' + s + '4', 0, -(rxT('U' + s + '4').r + 1.4)), rxPt('U' + s + '5', 0, -(rxT('U' + s + '5').r + 1.4)), at], at,
        hp: [at[0] - t.b[0] * 4 - t.m[0] * 3.5, at[1] - t.b[1] * 4 - t.m[1] * 3.5], ha: rxPt('U' + s + '4', 0, -(rxT('U' + s + '4').r + 9)) }; };
    const R = side('R'), Lf = side('L');
    [R, Lf].forEach(q => { wire(q.arm, 1.2); stroke(RXP.line(q.at, q.hp), 1.2); stroke(RXP.line(q.hp, q.ha), 1.2); });
    const my = Math.min(R.ha[1], Lf.ha[1]) - 3; stroke([['M', R.ha[0], R.ha[1]], ['C', R.ha[0] + 6, my, Lf.ha[0] - 6, my, Lf.ha[0], Lf.ha[1]]], 1.2);
    [R.hp, R.ha, Lf.hp, Lf.ha].forEach(p => ring(p, 2.1, 1)); dot(R.at, 1.2); dot(Lf.at, 1.2);
  }
  if (upE === 'earch') { // a lingual frame from the molars to the front, the pin in its tube with an open coil spring at the middle
    const f = along(front, 7); S2.forEach(s => { const m = L(molar('U', s), 1.1); dot(m); wire([m, L('U' + s + '5', 1.4), L('U' + s + '4', 1.6), L('U' + s + '3', 2), [f[0] + (s === 'R' ? -4 : 4), f[1]]], 1.1); });
    fill(RXP.bar([f[0] - 1.5, f[1]], [1, 0], 5, 2), '#E5E7EB', RX_METAL, .8); coil([f[0] + 1, f[1]], [f[0] + 4, f[1]], 5, 1.1);
  }
  if (upE === 'warch') { // Porter's W: the arms along the bicuspids and, between the molars, the palatal wire bent forward to the middle
    const mR = L(molar('U', 'R'), 1.1), mL = L(molar('U', 'L'), 1.1), cm = mid(mR, mL);
    wire([mR, along(mid(mR, cm, .55), -6.5), along(cm, -15), along(mid(cm, mL, .45), -6.5), mL], 1.2); dot(mR); dot(mL);
    S2.forEach(s => wire([L(molar('U', s), 1.1), L('U' + s + '5', 1.3), L('U' + s + '4', 1.3), L('U' + s + '3', 1.4)], 1.0));
  }
  if (exp.includes('lowerFixed')) { // the screw behind the lower front teeth, a heavy lingual wire to the molars, rests to the first bicuspids
    const c0 = mid(L('LR1', 7), L('LL1', 7));
    S2.forEach(s => { const m = L(molar('L', s), 1.1); dot(m); wire([m, L('L' + s + '5', 1.4), L('L' + s + '4', 1.6), L('L' + s + '3', 2.2), [c0[0] + (s === 'R' ? -5.5 : 5.5), c0[1]]], 1.6);
      const r4 = rxT('L' + s + '4').r; stroke(RXP.line(L('L' + s + '4', 1.6), rxPt('L' + s + '4', r4 * .2, 0)), .8); dot(rxPt('L' + s + '4', r4 * .2, 0), 1.2); });
    screw(c0, 11, 6);
  }
  // ---- distalization (upper): each side's appliance
  const dsides = S2.filter(s => dist(s)), dk = new Set(dsides.map(dist));
  const nanceFam = ['pendulum', 'pendex', 'trex', 'djet', 'ipc', 'rmd'].some(k => dk.has(k));
  if (nanceFam) { // (a Nance picked under Holding too — e.g. the RMD's follow-up Nance — is this button: one is drawn)
    const big = dk.has('rmd') || dk.has('ipc'), to = S2.map(s => L(dk.has('djet') || dk.has('ipc') || dk.has('rmd') ? 'U' + s + '4' : 'U' + s + '5', 1.2)), nb = nance(big, to);
    if (dk.has('pendex') || dk.has('trex')) screw(nb.c, 9, 6);
    dsides.forEach(s => { const k = dist(s), m = L(molar('U', s), 1.2), sg = s === 'R' ? -1 : 1;
      if (RXM_PEND.includes(k)) { const a = [nb.c[0] + sg * nb.w * .35, nb.c[1] + nb.h * .8], hc = mid(a, m, .4); wire([a, hc], 1); ring(hc, 2.2, .9); wire([hc, mid(hc, m, .6), m], 1); dot(m, 1.2);
        if (k === 'trex') { const mm = rxPt(molar('U', s), rxT(molar('U', s)).r * .55, -rxT(molar('U', s)).r - 1); wire([[nb.c[0] + sg * 3, nb.c[1] + 2], mm], .9); } }
      else if (k === 'djet' || k === 'ipc') { const a = [nb.c[0] + sg * nb.w * .5, nb.c[1] + nb.h * .4], p5 = L('U' + s + '5', 4);
        fill(RXP.bar(mid(a, p5), [p5[0] - a[0], p5[1] - a[1]].map(v => v / (Math.hypot(p5[0] - a[0], p5[1] - a[1]) || 1)), Math.hypot(p5[0] - a[0], p5[1] - a[1]), 1.7), '#E5E7EB', RX_METAL, .7);
        coil(p5, m, 6, 1.2); if (k === 'ipc') fill(RXP.bar(p5, [m[0] - p5[0], m[1] - p5[1]].map(v => v / (Math.hypot(m[0] - p5[0], m[1] - p5[1]) || 1)), 2.6, 2.6), RX_METAL); dot(m, 1.2); }
      else if (k === 'rmd') { const t5 = rxT('U' + s + '5'), b5 = Bc('U' + s + '5', 2.6); fill(RXP.bar(b5, t5.m, 7, 2.4), '#E5E7EB', RX_METAL, .8); stroke(RXP.line([b5[0] - t5.m[0] * 2.5, b5[1] - t5.m[1] * 2.5], [b5[0] + t5.m[0] * 2.5, b5[1] + t5.m[1] * 2.5]), .6);
        wire([Bc('U' + s + '4', 1.2), [b5[0] + t5.m[0] * 3.5, b5[1] + t5.m[1] * 3.5]], .9); wire([[b5[0] - t5.m[0] * 3.5, b5[1] - t5.m[1] * 3.5], Bc(molar('U', s), 1.2)], .9); }
    });
  }
  // the PHD and MDA expand first: their screw (8 or 12 mm) between the molars, unless an expander is already drawn there
  const pm = dsides.map(dist).filter(k => k === 'phd' || k === 'mda');
  if (pm.length && !upE) { const sw = pm.includes('mda') ? 12 : 9, c0 = scC(); armsTo(c0, sw, 7, S2.map(s => molar('U', s))); screw(c0, sw, 7); }
  dsides.forEach(s => { const k = dist(s), m = molar('U', s), lm = L(m, 1.2);
    if (k === 'phd' || k === 'mda') { // the sheath on the screw's arm and the spring that pushes the molar back
      const p5 = L('U' + s + '5', 1.4); fill(RXP.bar(mid(p5, lm, .75), [lm[0] - p5[0], lm[1] - p5[1]].map(v => v / (Math.hypot(lm[0] - p5[0], lm[1] - p5[1]) || 1)), 3, 2.2), '#E5E7EB', RX_METAL, .7); coil(p5, mid(p5, lm, .6), 5, 1.1); }
    if (k === 'hsjet') { const tp = [front[0] + (s === 'R' ? -4 : 4), front[1] + 9]; tad(tp); const f5 = L('U' + s + '5', 4.5); wire([tp, along(mid(tp, f5), -2), f5], 1.2); coil(f5, lm, 6, 1.2); dot(lm, 1.2); }
    if (k === 'halterman') { const e = 'U' + s + '5', te = rxT(e), b = Bc(e, 1.4), h = Bc(m, 2.2, -rxT(m).r * 1.15), btn = rxPt(m, 0, 0);
      wire([b, Bc(m, 2.4, rxT(m).r * .2), h], 1.0); stroke(RXP.poly([h, [h[0] - te.m[0] * 1.8, h[1] - te.m[1] * 1.8], [h[0] - te.m[0] * 1.8 - te.b[0] * 1.4, h[1] - te.m[1] * 1.8 - te.b[1] * 1.4]]), .9);
      ring(btn, 1.6, .9); stroke(RXP.line(h, btn), .9, '#7C3AED', [1.4, 1]); }
  });
  // ---- holding
  if (hold.includes('tpa')) { const a = L(molar('U', 'R'), 1.2), b = L(molar('U', 'L'), 1.2), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + 2;
    stroke([['M', a[0], a[1]], ['L', mx - 4, my], ['C', mx - 4, my - 9, mx + 4, my - 9, mx + 4, my], ['L', b[0], b[1]]], 1.2); dot(a, 1.2); dot(b, 1.2); }
  if (hold.includes('lla') || oth.includes('xbow')) { const mR = molar('L', 'R'), mL = molar('L', 'L');
    const pts = [L(mR, 1.4)].concat([5, 4, 3, 2, 1].map(n => L('LR' + n, 1.6)), [1, 2, 3, 4, 5].map(n => L('LL' + n, 1.6)), [L(mL, 1.4)]); wire(pts, 1.2); dot(pts[0], 1.2); dot(pts[pts.length - 1], 1.2);
    if (hold.includes('lla')) S2.forEach(s => ring(L('L' + s + '5', 2.8), 1.5, .9)); } // its adjustment loops in front of the molars
  if (hold.includes('nance') && !nanceFam) nance(false);
  (rx.sm || []).forEach(id => { const bk = rxmBehind(id), fr = rxrNext(id, 1), r = rxT(id).r; if (!rxT(bk) || !fr) return;
    const pts = [Bc(bk, 1, rxT(bk).r * .45), Bc(id, 1.8, 0), mid(rxrGap(id, fr, 1, .8), rxrGap(id, fr, -1, .8), .5), L(id, 1.8, 0), L(bk, 1, rxT(bk).r * .45)];
    pts[2] = rxPt(id, r * 1.05, 0); wire(pts, 1.1); });
  // ---- other appliances
  if (oth.includes('habit') || oth.includes('fbp')) { // the support wire from the molars to behind the front teeth
    S2.forEach(s => { const m = L(molar('U', s), 1.2); dot(m); wire([m, L('U' + s + '5', 2.4), L('U' + s + '4', 2.6), L('U' + s + '3', 3)], 1.1); });
  }
  if (oth.includes('habit')) { const h = rx.habit || [], inc = ['UR3', 'UR2', 'UR1', 'UL1', 'UL2', 'UL3'];
    // the crib: a wire behind the front teeth with its cage (seen from above, a zigzag toward the palate)
    if (h.includes('crib') || !h.length) { const pc = mid(rxT('UR5').c, rxT('UL5').c), b = inc.map(id => L(id, 3, 0)), nrm = q => { const dx = pc[0] - q[0], dy = pc[1] - q[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; };
      const z = []; b.forEach((q, i) => { if (i === b.length - 1) { z.push(q); return; } [0, .5].forEach(f => { const a = mid(q, b[i + 1], f), n = nrm(a), k = z.length % 2 ? 4.4 : 0; z.push([a[0] + n[0] * k, a[1] + n[1] * k]); }); });
      wire(b, 1.1); stroke(RXP.poly(z), .8); }
    if (h.includes('spurs')) ['UR2', 'UR1', 'UL1', 'UL2'].forEach(id => { const a = L(id, 3, 0), b = L(id, 6.8, 0); stroke(RXP.line(a, b), .9); dot(b, .7); });
    if (h.includes('bluegrass')) { const a = L('UR5', 1.4), b = L('UL5', 1.4), cc = mid(a, b); stroke(RXP.line(a, b), .9); fill(RXP.poly([0, 1, 2, 3, 4, 5].map(i => [cc[0] + 2.8 * Math.cos(i * Math.PI / 3), cc[1] + 2.8 * Math.sin(i * Math.PI / 3)]), true), '#FFFFFF', RX_METAL, .9); }
  }
  if (oth.includes('fbp')) { const ids = ['UR3', 'UR2', 'UR1', 'UL1', 'UL2', 'UL3'], o = ids.map(id => L(id, .9)), i = ids.map(id => L(id, 7.5)).reverse(), poly = o.concat(i);
    stroke(rxHatch(poly, 45, 1.5), .35, tn.s); fill(RXP.poly(poly, true), tn.f + 'B3', tn.s, .6); }
  if (oth.includes('xbow')) { // an upper expander; the lower labial arch across the front teeth with its Gurin locks in front of the first bicuspids
    if (!upE) { const c0 = scC(); armsTo(c0, 11, 7, S2.map(s => molar('U', s))); bars(); screw(c0); }
    const mR = molar('L', 'R'), mL = molar('L', 'L'), lab = [Bc(mR, 1.6)].concat(['LR5', 'LR4', 'LR3', 'LR2', 'LR1', 'LL1', 'LL2', 'LL3', 'LL4', 'LL5'].map(id => Bc(id, +id[2] >= 4 ? 1.8 : 1.3)), [Bc(mL, 1.6)]);
    wire(lab, 1.2); dot(lab[0], 1.2); dot(lab[lab.length - 1], 1.2);
    if (rx.gurin) S2.forEach(s => { const id = 'L' + s + '4', t = rxT(id); fill(RXP.bar(Bc(id, 1.8, t.r * .8), t.m, 3.4, 2.6), RX_METAL); }); // just in front of the first bicuspids
  }
  if (oth.includes('tandem')) { // the upper expander (unless one's drawn) with buccal arms and hooks; the lower bite block with headgear tubes
    if (!upE && !oth.includes('xbow')) { const c0 = scC(); armsTo(c0, 11, 7, S2.map(s => molar('U', s))); bars(); screw(c0); }
    S2.forEach(s => { const m = molar('U', s), t3 = rxT('U' + s + '3'), a = Bc(m, 1.4), h = Bc('U' + s + '3', 2.6); wire([a, Bc('U' + s + '5', 2.2), Bc('U' + s + '4', 2.4), h], 1.0);
      stroke(RXP.poly([h, [h[0] + t3.b[0] * 1.8, h[1] + t3.b[1] * 1.8], [h[0] + t3.b[0] * 1.8 - t3.m[0] * 1.6, h[1] + t3.b[1] * 1.8 - t3.m[1] * 1.6]]), .9); });
    S2.forEach(s => [4, 5, 6, 7].forEach(n => cap('L' + s + n, 1.08)));
    S2.forEach(s => { const m = molar('L', s), t = rxT(m); fill(RXP.bar(Bc(m, 1.6), t.m, 5.2, 2.4), RX_METAL); });
  }
  // ---- accessories on the bands
  // (outside the band's ring: the archwire tube, then a headgear or lip bumper tube; the sheaths on the tongue side, toward the back)
  (rx.awt || []).forEach(A => S2.forEach(s => { const id = molar(A, s), t = rxT(id); fill(RXP.bar(Bc(id, 2.4), t.m, 5.6, 2), RX_METAL); }));
  if (acc.includes('hg')) S2.forEach(s => { const id = molar('U', s), t = rxT(id), p = Bc(id, (rx.awt || []).includes('U') ? 5 : 2.4); fill(RXP.bar(p, t.m, 6.4, 2.6), '#E5E7EB', RX_METAL, .9); });
  if (acc.includes('lb')) S2.forEach(s => { const id = molar('L', s), t = rxT(id), p = Bc(id, (rx.awt || []).includes('L') ? 5 : 2.4); fill(RXP.bar(p, t.m, 6, 2.4), '#E5E7EB', RX_METAL, .9); });
  if (acc.includes('sheath')) ['U', 'L'].forEach(A => S2.forEach(s => { const id = molar(A, s); if (!teeth[id]) return; const t = rxT(id); fill(RXP.bar(L(id, 2.4, -t.r * .35), t.m, 4.4, 2), '#E5E7EB', RX_METAL, .8); }));
  if (acc.includes('fm')) S2.forEach(s => { const id = molar('U', s), t3 = rxT('U' + s + '3'), h = Bc('U' + s + '3', 2.4, -t3.r * .4);
    wire([Bc(id, 1.6, rxT(id).r * .3), Bc('U' + s + '5', 2.2), Bc('U' + s + '4', 2.4), h], .9);
    stroke(RXP.poly([h, [h[0] + t3.b[0] * 2, h[1] + t3.b[1] * 2], [h[0] + t3.b[0] * 2 - t3.m[0] * 1.8, h[1] + t3.b[1] * 2 - t3.m[1] * 1.8]]), .9); });
  return out;
}

/* ---------- the form's circles and blanks ---------- */
function rxmSmTxt(id) { return id + ' space (band ' + rxmBehind(id) + ')'; }
function rxmFill(c, rx, put, box, circ) {
  (rx.exp || []).forEach(k => box.add('exp.' + k));
  put('screw', [rx.mse ? 'MSE' + (rx.mseMm ? ' ' + rx.mseMm + ' mm' : '') : '', rx.screw].filter(Boolean).join(', '), 'H', 9);
  ['R', 'L'].forEach(s => { const v = rx['dist' + s]; if (v) box.add('dist.' + v + '.' + s); });
  (rx.hold || []).forEach(k => box.add('hold.' + k));
  const sm = rx.sm || []; put('smTxt', [sm.length === 1 ? sm[0] + ' (band ' + rxmBehind(sm[0]) + ')' : sm.join(', '), rx.smTxt].filter(Boolean).join(' · '), 'H', 9);
  (rx.other || []).forEach(k => box.add('other.' + k)); (rx.habit || []).forEach(k => box.add('habit.' + k));
  if ((rx.awt || []).length) { box.add('acc.awt'); rx.awt.forEach(a => box.add('awt.' + a)); }
  (rx.acc || []).forEach(k => box.add('acc.' + k));
  put('fmTxt', rx.fmTxt, 'H', 9); put('colorTxt', rx.colorTxt, 'H', 9);
  const kinds = new Set(Object.values(rx.teeth || {}));
  if (kinds.size) { if (rx.enclosed) box.add('enclosed'); else { box.add('provides'); kinds.forEach(k => box.add('anch.' + k)); } }
  if (rx.printed3d && !rx.enclosed) box.add('printed3d');
  Object.keys(rx.teeth || {}).forEach(id => circ.push(['anch', id])); (rx.occl || []).forEach(id => circ.push(['occl', id]));
}
/* what the answers write into the special instructions: the MSE (no circle for it on the form), the Xbow's Gurin locks, two or more
   space maintainers (their line on the form is short) */
function rxmAutoNotes(rx) {
  const out = [];
  if (rx.mse) out.push('MSE expander (TADs placed after delivery)' + (rx.mseMm ? ', ' + rx.mseMm + ' mm screw' : '') + '.');
  if ((rx.other || []).includes('xbow') && rx.gurin) out.push('Xbow with 2 Gurin locks.');
  if ((rx.sm || []).length > 1) out.push('Space maintainers: ' + rx.sm.map(id => id + ' space, band on ' + rxmBehind(id)).join('; ') + '.');
  return out;
}

/* ---------- a new Metal Rx: Dr. A's usual for the kind of case (RPE, MSE, anything else) as he saved it, when he has; otherwise an
   RPE starts as Specialty's standard Hyrax RPE and an MSE as the MSE (10 mm) — each on first molar bands, 3D printed (Amir: our
   expanders have 3D printed bands) ---------- */
const RXM_US = { rpe: RX_MET + ':rpe', mse: RX_MET + ':mse' };
function rxmUsualOf(c) { const ap = (c && c.appliances) || []; return ap.includes('MSE') ? RXM_US.mse : ap.includes(RXM_RPE) ? RXM_US.rpe : RX_MET; }
function rxmStartFor(slot) {
  const d = rxDefaults(slot), rx = d ? JSON.parse(JSON.stringify(d)) : { form: RX_MET };
  if (!d) { if (slot === RXM_US.mse) { rx.mse = true; rx.mseMm = '10'; } else if (slot === RXM_US.rpe) rx.exp = ['hyrax'];
    rxmStdApply(rx, { bands: new Set(), rests: new Set() }); if (rxmHasExp(rx)) rx.printed3d = true; }
  return rxCanon(rx);
}
function rxmStart(c) { return rxmStartFor(rxmUsualOf(c)); }
/* the case switched between RPE and MSE (`was`: the kind of case the Rx was written for): an Rx still exactly as it started for that
   kind starts again for this one (New case / Edit) … */
function rxmFormFix(c, rx, was) {
  const want = rxmUsualOf(c); if (want === RX_MET || was === want || ![RXM_US.rpe, RXM_US.mse].includes(was) || rxEmpty(rx)) return null;
  return JSON.stringify(rxCanon(rx)) === JSON.stringify(rxmStartFor(was)) ? rxmStartFor(want) : null;
}
/* … and one that doesn't have what the case is (an RPE, the MSE, any appliance at all) says so, on the form and the case */
function rxmMismatch(c, rx) {
  const ap = (c && c.appliances) || [], up = (rx.exp || []).filter(k => RXM_RPE_K.includes(k));
  if (ap.includes('MSE') && !rx.mse) return up.length ? 'This Metal Rx is for a ' + rxmLbl(up[0], ['exp']) + ', but the case is an MSE — edit the Rx.' : 'No MSE on this Metal Rx yet — tick MSE under Expansion.';
  if (ap.includes(RXM_RPE) && !up.length) return rx.mse ? 'This Metal Rx is for the MSE, but the case is an RPE — edit the Rx.' : 'No RPE on this Metal Rx yet — pick it under Expansion.';
  if (!rxmItems(rx).length) return 'No appliance picked on this Metal Rx yet.';
  return '';
}
/* the standard bands and rests after a change: put on what it newly needs (on teeth with nothing), take off the ones the rules put on
   that nothing needs any more (still as put); what was placed or changed by hand stays (rx.stdB / rx.stdR: what the rules put on) */
function rxmStdApply(rx, before) {
  const now = rxmStd(rx), t = rx.teeth = Object.assign({}, rx.teeth), occl = new Set(rx.occl || []), sb = new Set(rx.stdB || []), sr = new Set(rx.stdR || []);
  before.bands.forEach(id => { if (!now.bands.has(id) && sb.has(id)) { if (t[id] === 'band') delete t[id]; sb.delete(id); } });
  before.rests.forEach(id => { if (!now.rests.has(id) && sr.has(id)) { occl.delete(id); sr.delete(id); } });
  now.bands.forEach(id => { if (!before.bands.has(id) && !t[id]) { t[id] = 'band'; sb.add(id); } });
  now.rests.forEach(id => { if (!before.rests.has(id) && !occl.has(id)) { occl.add(id); sr.add(id); } });
  rx.occl = RX_GRID.filter(id => occl.has(id)); rx.stdB = RX_GRID.filter(id => sb.has(id) && t[id] === 'band'); rx.stdR = RX_GRID.filter(id => sr.has(id) && occl.has(id));
}

/* ---------- the editor's left side ---------- */
function rxmFoldSum(g, rx) {
  let s = '';
  if (g === 'dist') { const dk = {}; ['R', 'L'].forEach(x => { const v = rx['dist' + x]; if (v) (dk[v] = dk[v] || []).push(x); });
    s = Object.keys(dk).map(k => rxmLbl(k, ['dist']).replace(/ \(.*\)$/, '') + (dk[k].length === 2 ? ', right & left' : ', ' + rxmSideW(dk[k][0]))).join(' · '); }
  if (g === 'hold') s = (rx.hold || []).map(k => rxmLbl(k, ['hold'])).join(' · ');
  if (g === 'other') s = (rx.other || []).map(k => rxmLbl(k, ['other'])).join(' · ');
  if (g === 'acc') s = ((rx.awt || []).length ? ['Archwire tubes'] : []).concat((rx.acc || []).map(k => rxmLbl(k, ['acc']))).join(' · ');
  return s;
}
const rxmRow = (g, v, label, tag) => '<div class="rxUL" data-rxinfo="dist:' + v + '"><span class="rxULn">' + esc(label) + (tag ? '<em>' + esc(tag) + '</em>' : '') + '</span>' +
  ['R', 'L'].map(s => '<button type="button" class="rxB rxU" data-rxg="dist' + s + '" data-v="' + v + '" aria-pressed="false" aria-label="' + esc(label) + ', ' + rxmSideW(s) + '"><span>' + s + '</span></button>').join('') + '</div>';
function rxmSecs(rx) {
  const tag = (k, unit) => rxTag(k, false, unit), P = RXM_PK;
  const ex = (k, l) => rxBtn('exp', k, l, (rx.exp || []).includes(k), tag(P[k]));
  return rxInfoSec('exp', 'Expansion',
      '<div class="rxBs">' + RXM_O.exp.filter(([k]) => k !== 'qh' && k !== 'earch' && k !== 'warch').map(([k, l]) => ex(k, l)).join('') + '</div>' +
      '<div class="rxBs">' + ['qh', 'earch', 'warch'].map(k => ex(k, rxmLbl(k, ['exp']))).join('') + '</div>' +
      '<div class="rxBs">' + rxBtn('flag', 'mse', 'MSE (TAD-supported)', rx.mse, tag('mse')) + '<span class="rxSub" data-show="mse"><span class="rxLbl">Screw</span>' + RXM_MM.map(m => rxBtn('mseMm', m, m + ' mm', rx.mseMm === m)).join('') + '</span></div>' +
      '<div class="rxRow">' + rxField('screw', 'Screw type', 'text', ' maxlength="40" placeholder="e.g. Click screw, 12 mm"') + '</div>' +
      '<div class="small muted">One upper expander at a time (the lower fixed expander goes with any). Our expanders get 3D printed bands.</div>') +
    rxInfoSec('dist', 'Distalization', '<div class="rxULh"><span></span><span>Right</span><span>Left</span></div>' + RXM_O.dist.map(([k, l]) => rxmRow('dist', k, l, RXM_UNUSED[k] ? 'not used' : tag(P[k]))).join(''), '', !!rxmFoldSum('dist', rx)) +
    rxInfoSec('hold', 'Holding', '<div class="rxBs">' + RXM_O.hold.map(([k, l]) => rxBtn('hold', k, l, (rx.hold || []).includes(k), tag(P[k]))).join('') + '</div>' +
      '<div class="rxSub" data-show="sm"><div class="small muted">Tap the space on the arches with Space maintainer (the band goes on the tooth behind it).</div><div class="rxRow">' + rxField('smTxt', 'More about it', 'text', ' maxlength="40"') + '</div></div>', '', !!rxmFoldSum('hold', rx)) +
    rxInfoSec('other', 'Other appliances', '<div class="rxBs">' + RXM_O.other.map(([k, l]) => rxBtn('other', k, l, (rx.other || []).includes(k), RXM_UNUSED[k] ? 'not used' : tag(k === 'habit' ? 'habitApp' : P[k]))).join('') + '</div>' +
      '<div class="rxBs rxSub" data-show="habit"><span class="rxLbl">Habit</span>' + RXM_O.habit.map(([k, l]) => rxBtn('habit', k, l, (rx.habit || []).includes(k), k === 'bluegrass' ? tag('bluegrass') : '')).join('') + '</div>' +
      '<div class="rxBs rxSub" data-show="xbow">' + rxBtn('flag', 'gurin', 'With 2 Gurin locks', rx.gurin, tag('xbowGurin')) + '</div>', '', !!rxmFoldSum('other', rx)) +
    rxSec('Anchorage', '<div class="small muted" style="margin-bottom:6px">Picking an appliance puts Specialty’s standard bands on; tap the teeth to change them (4s to 7s, as on Specialty’s chart).</div><div class="rxBs">' +
      RXO.anch.map(([k, l]) => rxBtn('tool', k, l, RXE.tool === k, rxTag(k === 'band' ? (rx.printed3d ? 'band3d' : 'band') : k === 'onbrace' ? 'onbrace' : (rx.printed3d ? 'crown3d' : 'crown'), false, ' ea'))).join('') +
      rxBtn('tool', 'rest', 'Occlusal rest', RXE.tool === 'rest', 'with it') + rxBtn('tool', 'sm', 'Space maintainer', RXE.tool === 'sm', tag('sm')) + '</div>' +
      '<div class="rxTeeth small" id="rxTeethSum"></div><div class="rxBs">' + rxBtn('flag', 'printed3d', '3D printed / sintered bands, ROCs and crowns', rx.printed3d) + rxBtn('flag', 'enclosed', 'Bands or crowns enclosed with case', rx.enclosed, 'no charge') + '</div>' +
      '<div class="small muted">3D printed (Specialty): no separators and a better first fit; the printed parts can’t be adjusted.</div>') +
    rxInfoSec('acc', 'Accessories', '<div class="rxBs" data-rxinfo="acc:awt"><span class="rxLbl">Archwire tubes</span>' + rxBtn('awt', 'U', 'Upper', (rx.awt || []).includes('U'), tag('awtPr', '/pr')) + rxBtn('awt', 'L', 'Lower', (rx.awt || []).includes('L'), tag('awtPr', '/pr')) + '</div>' +
      '<div class="rxBs">' + RXM_O.acc.filter(([k]) => k !== 'color').map(([k, l]) => rxBtn('acc', k, l, (rx.acc || []).includes(k), ['debondHoles', 'vent', 'roc'].includes(k) ? 'free' : k === 'debondWires' ? tag('debondWires', '/pr') : k === 'sheath' ? tag('sheath', '/pr') : tag(P[k]))).join('') + '</div>' +
      '<div class="rxRow rxSub" data-show="fm">' + rxField('fmTxt', 'Facemask hooks: where', 'text', ' maxlength="40"') + '</div>' +
      '<div class="rxRow" data-rxinfo="acc:color">' + rxField('colorTxt', 'Acrylic color (Specialty colors free · glitter ' + tag('glitter') + ')', 'text', ' maxlength="40" placeholder="—"') + '</div>', '', !!rxmFoldSum('acc', rx));
}
function rxmTeethSum(rx) {
  const t = rx.teeth || {}, by = {}; Object.keys(t).forEach(id => { (by[t[id]] = by[t[id]] || []).push(id); });
  const parts = RXO.anch.filter(([k]) => by[k]).map(([k, l]) => '<b>' + esc(l) + (by[k].length > 1 && k !== 'onbrace' ? 's' : '') + ':</b> ' + esc(by[k].join(', ')));
  if ((rx.occl || []).length) parts.push('<b>Occlusal rests:</b> ' + esc(rx.occl.join(', ')));
  if ((rx.sm || []).length) parts.push('<b>Space maintainers:</b> ' + esc(rx.sm.map(rxmSmTxt).join(', ')));
  return parts.join(' · ') || '<span class="muted">No teeth picked yet.</span>';
}
function rxmTap(id, rx, tool) {
  if (!RX_GRID.includes(id)) { toast('Specialty’s chart takes bands, crowns and rests on the 4s to 7s'); return false; }
  if (tool === 'sm') {
    if (!RXM_SM.includes(id)) { toast('Tap the space: a missing 4, 5 or 6 (the band goes on the tooth behind it)'); return false; }
    // (the first space ticks Space Maintainer; taking the last one off unticks it)
    const before = rxmStd(rx), s = new Set(rx.sm || []);
    if (s.has(id)) { s.delete(id); if (!s.size) rx.hold = (rx.hold || []).filter(x => x !== 'sm');
      before.bands.delete(id); before.rests.delete(id); } // (the tooth is back: what the picks want on it goes back on)
    else {
      // two missing teeth side by side aren't a band and loop: one space can't hold the band for another, or be the tooth behind one
      const holder = Array.from(s).find(x => rxmBehind(x) === id);
      if (holder || s.has(rxmBehind(id))) { toast((holder ? id + ' has the band for the ' + holder + ' space' : rxmBehind(id) + ' is a space too') + ' — for two missing teeth side by side, say what’s wanted in the special instructions'); return false; }
      s.add(id); rx.teeth = Object.assign({}, rx.teeth); delete rx.teeth[id]; rx.occl = (rx.occl || []).filter(x => x !== id); rx.hold = Array.from(new Set((rx.hold || []).concat(['sm']))); }
    rx.sm = RXM_SM.filter(x => s.has(x)); rxmStdApply(rx, before); return true;
  }
  // a tooth tapped by hand is the doctor's: it no longer comes off with an appliance
  if (tool === 'rest') { const o = new Set(rx.occl || []); if (o.has(id)) o.delete(id); else o.add(id); rx.occl = Array.from(o); rx.stdR = (rx.stdR || []).filter(x => x !== id); return true; }
  if (RX_KEYS('anch').includes(tool)) { rx.teeth = Object.assign({}, rx.teeth); if (rx.teeth[id] === tool) delete rx.teeth[id]; else rx.teeth[id] = tool; rx.stdB = (rx.stdB || []).filter(x => x !== id); return true; }
  return false;
}
/* the rules after a tap: one upper expander at a time (the MSE too); the standard bands and rests follow the picks; an expander
   picked (none before) ticks 3D printed — Amir: our expanders have 3D printed bands */
function rxmClick(g, v, on, rx) {
  if (!['exp', 'distR', 'distL', 'hold', 'other', 'flag'].includes(g)) return false;
  if (g === 'flag' && v !== 'mse') return false;
  const before = rxmStd(rx), hadExp = rxmHasExp(rx);
  if (g === 'flag') { rx.mse = on ? true : ''; if (on) rx.exp = (rx.exp || []).filter(k => !RXM_UPPER.includes(k)); if (on && !rx.mseMm) rx.mseMm = '10'; }
  else if (g === 'exp') { const s = new Set(rx.exp || []); if (on) { if (RXM_UPPER.includes(v)) { RXM_UPPER.forEach(k => s.delete(k)); rx.mse = ''; } s.add(v); } else s.delete(v); rx.exp = Array.from(s); }
  else if (g === 'distR' || g === 'distL') rx[g] = on ? v : '';
  else { const s = new Set(rx[g] || []); if (on) s.add(v); else s.delete(v); rx[g] = Array.from(s); if (g === 'hold' && v === 'sm' && !on) rx.sm = []; }
  rxmStdApply(rx, before);
  if (!hadExp && rxmHasExp(rx) && !rx.enclosed) rx.printed3d = true;
  return true;
}
RXK[RX_MET] = {
  form: RX_MET, key: 'met', field: 'rxMet', ds: 'rxMet', title: 'Metal Rx', usual: 'our usual metal appliance',
  usuals: [[RXM_US.rpe, 'our usual RPE', 'RPE Rx'], [RXM_US.mse, 'our usual MSE', 'MSE Rx'], [RX_MET, 'our usual metal appliance', 'Metal Rx']], usualOf: rxmUsualOf,
  saveDefTip: 'New Metal Rx start from these choices and teeth (not this patient’s dates, space maintainers, colors, notes or drawings)',
  caseIntro: 'Specialty’s Metal Rx, filled in from this case: tap the appliance, the bands and extras, and it gives the PDF to upload with the scan, and the lab cost.',
  costEmpty: 'Pick the appliance — the prices add up here.',
  priceNote: 'Bands, crowns and 3D printing, the TPA and the quad helix: the prices with the Herbst Rx (the same on the list). The MSE and Horseshoe Jet are on the list’s TAD appliances.',
  prices: RXM_PRICES, appl: RXM_APPL,
  applies: c => !!c && c.type === 'appliance' && labName(c.lab) === LAB_SPEC && (c.appliances || []).some(a => RXM_APPL.includes(a)),
  scanners: [['itero', /itero/i], ['trios', /trios/i], ['medit', /medit/i], ['carestream', /carestream/i], ['cerec', /cerec|primescan|sirona/i]],
  canon: rxmCanon, summary: rxmSummary, estimate: rxmEstimate, auto: rxmAuto, fill: rxmFill, start: rxmStart, autoNotes: rxmAutoNotes,
  single: RXM_SINGLE, tools: ['band', 'crown', 'roc', 'onbrace', 'rest', 'sm'], tool0: 'band',
  defDrop: ['sm', 'smTxt', 'colorTxt', 'fmTxt'],
  // the usual keeps the space maintainer choice, not this patient's spaces or the bands behind them …
  defClean: d => { const std = rxmStd(Object.assign({}, d, { sm: [] })).bands; (d.sm || []).map(rxmBehind).forEach(id => { if (d.teeth && d.teeth[id] === 'band' && !std.has(id)) delete d.teeth[id]; }); },
  // … and starting from it keeps this Rx's spaces with the band behind each (as it was), nothing on the space itself
  defKeep: (cur, next) => { const sm = cur.sm || []; if (!sm.length) return; next.teeth = Object.assign({}, next.teeth);
    sm.forEach(id => { delete next.teeth[id]; const bk = rxmBehind(id), v = (cur.teeth || {})[bk]; if (v && !next.teeth[bk]) { next.teeth[bk] = v; if ((cur.stdB || []).includes(bk)) next.stdB = (next.stdB || []).concat([bk]); } });
    next.occl = (next.occl || []).filter(id => !sm.includes(id)); },
  formFix: rxmFormFix, mismatch: rxmMismatch,
  secHTML: rxmSecs, foldSum: rxmFoldSum, teethSum: rxmTeethSum, tap: rxmTap, tappable: id => RX_GRID.includes(id), click: rxmClick,
  toolsHTML: () => rxToolBtn('band', 'Band', 'Tap a tooth (4s to 7s) to band it') + rxToolBtn('crown', 'Crown', 'Tap a tooth to crown it') + rxToolBtn('roc', 'ROC', 'Crown with the occlusal removed') +
    rxToolBtn('onbrace', 'OnBRACE', 'OnBRACE on the tooth') + rxToolBtn('rest', 'Rest', 'Occlusal rest on the tooth') + rxToolBtn('sm', 'Space maint.', 'Tap the space (the missing tooth): a band and loop'),
  hint: tool => tool === 'rest' ? 'Tap the teeth that get an occlusal rest.' : tool === 'sm' ? 'Tap the space — the missing 4, 5 or 6: the band goes on the tooth behind it.' : 'Tap the teeth that get a ' + ((RXO.anch.find(x => x[0] === tool) || [])[1] || tool) + '.',
  tip: (id, rx) => { const t = rx.teeth || {}, oc = rx.occl || [], sm = (rx.sm || []).includes(id), bits = [];
    if (t[id]) bits.push((RXO.anch.find(x => x[0] === t[id]) || [])[1]); if (oc.includes(id)) bits.push('occlusal rest'); if (sm) bits.push('space maintainer (the space)');
    return id + (bits.length ? ': ' + bits.join(', ') : ''); },
  subShow: (k, rx) => k === 'mse' ? !!rx.mse : k === 'sm' ? (rx.hold || []).includes('sm') : k === 'habit' ? (rx.other || []).includes('habit') : k === 'xbow' ? (rx.other || []).includes('xbow') : k === 'fm' ? (rx.acc || []).includes('fm') || !!rx.fmTxt : !!rx[k],
  // facemask hooks taken off take their "where" with them (typing a where puts them on); the bands are 3D printed by Specialty or
  // enclosed by the office, not both
  after: (g, v, on, prev, rx) => { if (g === 'acc' && v === 'fm' && !on) rx.fmTxt = '';
    if (g === 'flag' && on && v === 'enclosed') rx.printed3d = ''; if (g === 'flag' && on && v === 'printed3d') rx.enclosed = ''; },
  // the anchorage prices follow the 3D printed switch
  syncMore: (w, rx) => { $$('.rxB[data-rxg="tool"]', w).forEach(x => { const em = $('em', x); if (!em || ['onbrace', 'rest', 'sm'].includes(x.dataset.v)) return; em.textContent = rxTag(x.dataset.v === 'band' ? (rx.printed3d ? 'band3d' : 'band') : (rx.printed3d ? 'crown3d' : 'crown'), false, ' ea'); });
    // a distalizer we don't use: its whole row greys out, not just its Right / Left buttons
    $$('.rxUL[data-rxinfo^="dist:"]', w).forEach(r => r.classList.toggle('off', $$('.rxB', r).every(b => b.getAttribute('aria-disabled') === 'true'))); },
  off: rxmOff,
  leadDays: () => 10,
  info: RXM_INFO, src: RXM_SRC,
  infoKeys: g => ({ exp: RXM_K('exp').concat(['mse']), dist: RXM_K('dist'), hold: RXM_K('hold'), other: RXM_K('other').concat(['crib', 'spurs', 'bluegrass']), acc: ['awt'].concat(RXM_K('acc')) })[g] || [],
  infoName: (g, v) => rxmLbl(v),
  infoTag: (g, v) => { const P = RXM_PK;
    if (g === 'exp') return v === 'mse' ? rxTag('mse') : rxTag(P[v]);
    if (RXM_UNUSED[v] && (g === 'dist' || g === 'other')) return 'not used';
    if (g === 'dist' || g === 'hold') return rxTag(P[v]);
    if (g === 'other') return v === 'habit' || v === 'crib' || v === 'spurs' ? rxTag('habitApp') : v === 'bluegrass' ? rxTag('bluegrass') : rxTag(P[v]);
    if (g === 'acc') return v === 'awt' ? rxTag('awtPr', false, '/pr') : ['debondHoles', 'vent', 'roc'].includes(v) ? 'free' : v === 'color' ? 'free · glitter ' + rxTag('glitter') : v === 'debondWires' ? rxTag('debondWires', false, '/pr') : v === 'sheath' ? rxTag('sheath', false, '/pr') : rxTag(P[v]);
    return ''; },
  infoSel: (g, rx) => { if (g === 'exp') return (rx.exp || []).find(k => RXM_UPPER.includes(k)) || (rx.mse ? 'mse' : (rx.exp || [])[0] || '');
    if (g === 'dist') return rx.distR || rx.distL || ''; if (g === 'hold') return (rx.hold || [])[0] || ''; if (g === 'other') return (rx.other || [])[0] || '';
    return (rx.awt || []).length ? 'awt' : (rx.acc || [])[0] || ''; },
  infoOf: b => { const g = b.dataset.rxg, v = b.dataset.v;
    if (g === 'exp') return ['exp', v]; if (g === 'flag' && v === 'mse') return ['exp', 'mse']; if (g === 'mseMm') return ['exp', 'mse']; if (g === 'distR' || g === 'distL') return ['dist', v];
    if (g === 'hold' || g === 'other') return [g, v]; if (g === 'habit') return ['other', v]; if (g === 'flag' && v === 'gurin') return ['other', 'xbow']; if (g === 'acc') return ['acc', v]; if (g === 'awt') return ['acc', 'awt'];
    return null; },
  infoPrompt: g => ({ exp: 'an expander', dist: 'a distalizer', hold: 'a holding appliance', other: 'an appliance', acc: 'an accessory' })[g] || 'an option',
  cmpKeys: g => ({ exp: RXM_K('exp').concat(['mse']), dist: RXM_K('dist'), hold: RXM_K('hold') })[g] || null
};
