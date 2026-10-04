/* =====================================================================
   Lab Rx — Specialty Appliances' Retainer Rx (MKT-7, Rev 2-25), filled in from the case
   Amir, 4 Oct 2026: "here is the Rx for hawley. do the same" — the Herbst Rx's way (rx.js) on Specialty's Retainer Rx:
   - Shows on a case once Hawley retainers (or a finger spring with no labial bow) go to Specialty. It starts filled in from
     the case: the patient, scanner, dates, Dr. A's details, a Hawley on each arch the case picked (with Specialty's standard
     clasps) and the case's acrylic color.
   - Every part of the form is a tap: the designs and spring designs, horseshoe / full palate, the reset diagram, clasping,
     accessories, acrylic options, fixed lingual retainers and invisible retainers (upper and lower, as on the paper).
     Clasps, pontics, finger springs, holding spurs and resets also go on the teeth: tap them on the arches.
   - The retainer draws itself on Specialty's arch diagram (the plate in the acrylic's color, the bow, clasps, pontics,
     springs, bonded retainers, clear retainers); the pen, line and arrow add anything else. The result is Specialty's own
     two-page form as a PDF (the arches and choices on page 1; page 2 is their IR Express notes).
   - Prices from Specialty's price list MKT-41 (retainers, custom design options, acrylic colors, Guardian); what the list
     doesn't have is named under the estimate, never guessed. Each option explains itself (point at it), from Specialty's
     own pages where they describe it.
   Amir, 4 Oct 2026 (what we built on the NLO Lab Rx page, brought onto this form): his Hawley pictures on the designs and his clasp
   pictures (with their drawings) on the clasps; Dr. A's take on each clasp for the design (Adams preferred on a Hawley; badges);
   Adams on the first molars to start; Delta and Arrowhead clasps, written out with their teeth (the form has no circle for them);
   Specialty's color guide as swatches; a pontic's shade required; holding spurs facing distal or mesial (tap again to turn one).
   ===================================================================== */
const RXR = RX_FORMS[RX_RET];
/* the appliances that go on this form (with the lab set to Specialty) */
const RXR_APPL = ['Hawley retainers', 'Finger spring with no labial bow'];
/* the form's choices, in its order and words (™ and ® left off on screen) */
const RXR_O = {
  design: [['hawley', 'Hawley'], ['flatHawley', 'Flat Bow Hawley'], ['wrap', 'Standard Wraparound'], ['flatWrap', 'Flat Bow Wraparound'], ['tremont', 'Tremont Wraparound'], ['specWrap', 'Specialty Wrap Design'],
    ['bowSold', 'Labial Bow Soldered to Clasps'], ['flatSold', 'Flat Bow Soldered to Clasps'], ['clearbow', 'ClearBow Hawley'], ['flipper', 'Flipper (no bow)']],
  spring: [['spring3', 'Spring Hawley 3x3'], ['spring4', 'Spring Hawley 4x4'], ['springSM', 'Super Modified Spring Hawley']],
  palate: [['horseshoe', 'Horseshoe'], ['full', 'Full Palate']],
  resetHow: [['none', 'Do Not Reset Teeth'], ['ideal', 'Reset Teeth Ideally'], ['compromise', 'Compromise Reset']],
  clasp: [['c', 'C-Clasps'], ['adams', 'Adams Clasps'], ['ball', 'Ball Clasps'], ['solc', 'Soldered C-Clasps'], ['delta', 'Delta Clasps'], ['arrowhead', 'Arrowhead Clasps']],
  acc: [['finger', 'Finger Spring'], ['solder', 'Soldered Spring'], ['closing', 'Closing Spring'], ['spurs', 'Holding Spurs'], ['helical', 'Helical Bow'], ['cuspHook', 'Soldered Cuspid Hook'], ['habit', 'Habit']],
  habit: [['crib', 'Crib'], ['spurs', 'Spurs'], ['bluegrass', 'Bluegrass']],
  acr: [['bowAcr', 'Add Acrylic to Bow'], ['abp', 'Anterior Bite Plane'], ['pbp', 'Posterior Bite Plane'], ['scallop', 'Scallop Anteriors'], ['saddle', 'Acrylic Saddle'], ['pontic', 'Pontic']],
  flr: [['cc', 'Central – Central'], ['ll', 'Lateral – Lateral'], ['c3', 'Cuspid – Cuspid']],
  pads: [['compEach', 'Composite Pads on Each Tooth'], ['compDist', 'Composite Pads on Distal Most Teeth'], ['meshEach', 'Mesh Pads on Each Tooth'], ['meshDist', 'Mesh Pads on Distal Most Teeth']],
  wire: [['r028', 'Round .028'], ['braided', '.016 × .022 Braided'], ['solid', '.016 × .022 Solid Stainless Steel']],
  ir: [['single', 'Single Invisible Retainer'], ['g2', 'Guardian 2'], ['g3', 'Guardian 3'], ['g4', 'Guardian 4'], ['express', 'IR Express']]
};
const RXR_K = o => RXR_O[o].map(x => x[0]);
const RXR_DESIGNS = RXR_K('design').concat(RXR_K('spring'));
const RXR_ACC = RXR_K('acc'), RXR_ACR = RXR_K('acr');
function rxrLbl(v, lists) { for (const o of lists || Object.keys(RXR_O)) { const x = RXR_O[o].find(y => y[0] === v); if (x) return x[1]; } return v; }
const rxrDesignName = v => rxrLbl(v, ['design', 'spring']);
const RXR_ARCH = ['U', 'L'];
const rxrArchWord = A => A === 'U' ? 'upper' : 'lower';
/* what goes on a tooth: the clasps, a pontic, a finger spring, a holding spur facing distal (spur) or mesial (spurM; Amir, 4 Oct 2026:
   "spurs on the diagram are always facing distal. but it should also be able to switch to mesial … click once and click twice")
   — and the flag it ticks on the form. Delta and arrowhead clasps have no circle on the form: they're written out (RXR_WRITTEN) */
const RXR_CLASPS = ['c', 'adams', 'ball', 'solc', 'delta', 'arrowhead'];
const RXR_WRITTEN = ['delta', 'arrowhead'];
const RXR_TOOTH = RXR_CLASPS.concat(['pontic', 'finger', 'spur', 'spurM']);
const RXR_TOOTH_FLAG = { finger: ['acc', 'finger'], spur: ['acc', 'spurs'], spurM: ['acc', 'spurs'], pontic: ['acr', 'pontic'] };
const RXR_TOOTH_L = { c: 'C-clasp', adams: 'Adams clasp', ball: 'Ball clasp (behind it)', solc: 'Soldered C-clasp', delta: 'Delta clasp', arrowhead: 'Arrowhead clasp',
  pontic: 'Pontic', finger: 'Finger spring', spur: 'Holding spur, facing distal', spurM: 'Holding spur, facing mesial' };
const RXR_SPURS = ['spur', 'spurM'];
const RXR_TEETH = Object.keys(RXR.teeth);
/* the reset diagram's teeth (3 to 3, upper over lower) */
const RXR_RESET = ['UR3', 'UR2', 'UR1', 'UL1', 'UL2', 'UL3', 'LR3', 'LR2', 'LR1', 'LL1', 'LL2', 'LL3'];
const RXR_SPAN = { cc: '1–1', ll: '2–2', c3: '3–3' };
const RXR_PADS_S = { compEach: 'composite pads on each tooth', compDist: 'composite pads on the end teeth', meshEach: 'mesh pads on each tooth', meshDist: 'mesh pads on the end teeth' };
const RXR_SINGLE = ['palate', 'designU', 'designL', 'resetHow', 'flrU', 'flrL', 'flrPadsU', 'flrPadsL', 'flrWireU', 'flrWireL', 'irU', 'irL'];
const RXR_TEXTS = ['claspOther', 'fingerTxt', 'solderTxt', 'closingTxt', 'spursTxt', 'screwTxt', 'saddleTxt', 'ponticTxt', 'colorU', 'colorL'];
/* Specialty's standard clasps for a design (Specialty: the standard upper Hawley has C-clasps on the first molars; the Specialty
   Wrap has C-clasps on the first molars; the Labial Bow Soldered to Clasps has Adams clasps on the upper first molars). They go on
   when the design is picked on an arch with no clasps yet; the Hawley's and the Specialty Wrap's come with the design (no charge). */
const RXR_STD = { hawley: { U: 'c' }, flatHawley: { U: 'c' }, clearbow: { U: 'c' }, specWrap: { U: 'c', L: 'c' }, bowSold: { U: 'adams' }, flatSold: { U: 'adams' } };
const RXR_STD_INCL = ['hawley', 'flatHawley', 'clearbow', 'specWrap'];
/* the standard lower Hawley has first-molar occlusal rests instead of clasps (Specialty) — drawn while the lower 6s have no clasp */
const RXR_LOWER_RESTS = ['hawley', 'flatHawley', 'clearbow'];
/* Universal tooth numbers (#1–#32) for the lab's blanks: UR1 = #8, UL1 = #9, LL1 = #24, LR1 = #25 */
function rxrNum(id) { const q = id.slice(0, 2), n = +id[2]; return '#' + ({ UR: 9 - n, UL: 8 + n, LL: 25 - n, LR: 24 + n }[q]); }

/* ---------- what each option is (point at it, tab to it or tap it; Compare all) — from Specialty's own pages unless a note
   says otherwise. Amir, 4 Oct 2026 (for the Herbst): "when they kind of hover over it or click on something, they can get more
   information like that, what the difference is between those options" ---------- */
const RXR_SRC = {
  hawley: ['Specialty: Standard Hawley', 'https://specialtyappliances.com/product/standard-hawley/'],
  wrap: ['Specialty: Wraparound Hawley', 'https://specialtyappliances.com/product/wraparound-hawley/'],
  swrap: ['Specialty: The Specialty Wrap', 'https://specialtyappliances.com/product/the-specialty-wrap/'],
  slb: ['Specialty: Labial Bow Soldered to Adams Clasps', 'https://specialtyappliances.com/product/soldered-labial-bow/'],
  scc: ['Specialty: Labial Bow Soldered to C-Clasp', 'https://specialtyappliances.com/product/soldered-c-clasp/'],
  spring: ['Specialty: Spring Hawley', 'https://specialtyappliances.com/product/spring-hawley/'],
  super: ['Specialty: Super Modified Spring Hawley', 'https://specialtyappliances.com/product/super-modified-spring-retainer/'],
  helix: ['Specialty: Helical Bow Spring Hawley', 'https://specialtyappliances.com/product/helical-bow-spring-hawley/'],
  cflr: ['Specialty: Composite FLR', 'https://specialtyappliances.com/product/composite-fixed-lingual-retainers/'],
  mflr: ['Specialty: Mesh Pad FLR', 'https://specialtyappliances.com/product/mesh-fixed-lingual-retainers/'],
  invis: ['Specialty: Invisible Retainers', 'https://specialtyappliances.com/product/invisible-retainers/'],
  guard: ['Specialty: Guardian', 'https://specialtyappliances.com/product/guardian/'],
  irx: ['Specialty: IR Express', 'https://specialtyappliances.com/product/ir-express'],
  crib: ['Specialty: Tongue Guard (habit crib)', 'https://specialtyappliances.com/product/basic-tongue-guard/'],
  blue: ['Specialty: Bluegrass Appliance', 'https://specialtyappliances.com/product/bluegrass-appliance/'],
  color: ['Specialty: Hawley color chart', 'https://specialtyappliances.com/hawley-color-chart/'],
  odl: ['ODL: Tremont Cantilever', 'https://odlortho.com/products/hawley-wraparound/'],
  accu: ['Accutech: Tremont Cantilever Wrap Around', 'https://www.accutechortho.com/orthodontic-laboratory-products/retainers/tremont-cantilever-wrap-around-appliance'],
  clearbow: ['Bryn Mawr Ortho Lab: Clear Bow', 'https://www.brynmawrortholab.com/appliances/clear-bow/'],
  flatbow: ['JAW Products: flat labial Hawley bow', 'https://jawproducts.com/products/preformed-flat-labial-hawley-bow-wires'],
  guide: ['Flora Dental: Hawley retainers', 'https://floradental.co.uk/hawley-retainers-guide/'],
  pontic: ['Great Lakes: Hawley with pontic', 'https://www.greatlakesdentaltech.com/media/wysiwyg/resources/Hawley_with_Pontic.pdf'],
  removable: ['Removable appliances (ScienceDirect)', 'https://www.sciencedirect.com/topics/medicine-and-dentistry/removable-appliance'],
  bdj: ['Bonded retainers (BDJ Team, 2015)', 'https://www.nature.com/articles/bdjteam201554']
};
const RXR_USUAL = 'Specialty’s site doesn’t describe it; this is the usual meaning.';
/* the delta and arrowhead clasps (from the clasp guide on Dr. A's Lab Rx, 4 Oct 2026; his photos and the drawings), shared with the
   Functional Rx */
const RXC_INFO = {
  delta: { name: 'Delta clasp', pic: 'clasp-delta', draw: 'delta', short: 'Clark’s Adams with closed triangular loops: it holds its shape through months of insertions.',
    sum: 'Clark’s version of the Adams, designed for Twin Blocks: closed triangular loops replace the arrowheads, so the clasp holds its shape and fatigues less with repeated insertion.',
    pts: ['Grips the MB and DB line-angle undercuts of one molar. 0.7 mm wire on molars; 0.6 mm on premolars and primary molars.',
      'Goes on the first molars, the loops just gingival to the height of contour (or a composite bump).',
      'Specialty’s form has no circle for it: it’s written out with its teeth (and spelled out in the special instructions). Not on the price list.'] },
  arrowhead: { name: 'Arrowhead (Schwarz) clasp', pic: 'clasp-arrowhead', draw: 'arrowhead', short: 'Schwarz’s own clasp: arrow bends wedge into the cheek-side embrasures, joined by a running wire.',
    sum: 'Schwarz’s clasp for his plates: arrow-shaped bends wedge into the buccal interdental embrasures and are joined by a running buccal wire.',
    pts: ['Grips the interdental undercuts just gingival to the contacts, across two teeth (e.g. D–E and E–6 in the mixed dentition). 0.7 mm wire.',
      'On the arches, tap a tooth: the arrows go in the embrasures on both sides of it; tap the next tooth to run the clasp on.',
      'Priced with C and ball clasps (“arrows”), by the pair.'] }
};
const RXR_INFO = {
  design: {
    hawley: { pic: 'hawley-standard', short: 'Specialty’s standard: a .032 labial bow crossing behind the canines; C-clasps on the upper first molars.',
      sum: 'The standard Hawley: an acrylic plate with a .032″ labial bow and a set of clasps for retention.',
      pts: ['The bow crosses the bite behind the canines; its loops make it adjustable.',
        'Upper: C-clasps on the first molars. Lower: first-molar occlusal rests instead of clasps, unless you pick clasping (Specialty).'],
      src: ['hawley'] },
    flatHawley: { short: 'A Hawley with a flattened front bow, for more contact with the front teeth.',
      sum: 'A Hawley whose labial bow is flat across the front teeth instead of round.',
      pts: ['A flat bow has a flattened front section and round back sections: better surface contact, stability and control (JAW Products).',
        'Priced as the standard Hawley plus Specialty’s flat bow labial wire.'],
      note: 'Specialty’s site doesn’t describe this design.', src: ['flatbow'] },
    wrap: { pic: 'hawley-wrap', short: 'A .036 bow around all the teeth to the last molar — no wire crosses the bite in between; full palate standard.',
      sum: 'Circumferential retention: a .036 wire runs around the outside of the arch to the last teeth, so the teeth can settle after treatment.',
      pts: ['A support wire in the bicuspid area holds the bow up (Specialty).', 'Full palatal acrylic is standard; no clasps.'],
      src: ['wrap'] },
    flatWrap: { short: 'Specialty’s wraparound with a flattened front bow.',
      sum: 'A wraparound (the bow runs around the whole arch) with a flat labial bow across the front teeth.',
      pts: ['Priced as the wraparound plus the flat bow labial wire.'],
      note: 'Specialty’s site doesn’t describe this design.', src: ['wrap', 'flatbow'] },
    tremont: { short: 'A wraparound held by a cantilever arm welded to its loops, instead of support wires between the teeth.',
      sum: 'A wraparound whose bow is held by a .036 wire laser-welded to the back of its omega loops, so no support wires cross between the teeth (ODL).',
      pts: ['Adjusted with three-prong pliers to move the front of the bow toward the edges or the gums.',
        'For upper retention with a well-finished bite that includes the second molars (Accutech).', 'Not on Specialty’s price list.'],
      note: 'Specialty’s site doesn’t describe it; this is how ODL and Accutech describe the Tremont.', src: ['odl', 'accu'] },
    specWrap: { short: 'Specialty’s own wraparound with a clear bow instead of wire and C-clasps on the first molars: no wire crosses the bite.',
      sum: 'A circumferential design with a clear labial bow instead of a wire bow, adapted to the teeth with C-clasps on the first molars.',
      pts: ['No wires cross the bite, so the bow is nearly invisible and stain-proof (Specialty).',
        'Upper and lower; clasping can be C, Adams, Ball or Soldered C-clasps.', 'The priciest retainer design on the list.'],
      src: ['swrap'] },
    bowSold: { short: 'The bow is soldered to the molar clasps, so no wire crosses between the premolars and they can settle.',
      sum: 'Specialty’s design: Adams clasps on the upper first molars with a .036 labial bow soldered to them — circumferential retention and anchorage.',
      pts: ['Lets the bicuspids settle into the bite after treatment (Specialty).',
        'A C-clasp version uses a .032 bow with a .032 C-clasp soldered off the adjustment loop; it crosses the bite only at the cuspids.',
        'Priced as the standard Hawley; the clasps as the list’s soldered clasps.'],
      src: ['slb', 'scc'] },
    flatSold: { short: 'The soldered-to-clasps design with a flattened front bow.',
      sum: 'A labial bow soldered to the molar clasps, as Labial Bow Soldered to Clasps, flat across the front teeth.',
      pts: ['Priced as the standard Hawley plus the flat bow labial wire; the clasps as soldered clasps.'],
      note: 'Specialty’s site doesn’t describe this design.', src: ['slb', 'flatbow'] },
    clearbow: { pic: 'hawley-clear', short: 'A Hawley with a clear plastic strap for the front bow instead of wire.',
      sum: 'A Hawley whose labial bow is a clear plastic strap, so no wire shows on the front teeth.',
      pts: ['The Clear Bow is a BPA-free polyethylene terephthalate strap (like bleaching-tray material), adjustable with three-prong pliers, in 2.75 mm and 1.4 mm strips (Bryn Mawr).',
        'Priced as the standard Hawley plus Specialty’s ClearBow labial wire.'],
      note: 'Specialty has no page for it; its Specialty Wrap uses the clear bow.', src: ['clearbow', 'swrap'] },
    flipper: { short: 'An acrylic plate with no labial bow — usually carrying a pontic (a replacement tooth).',
      sum: 'A removable acrylic plate with no wire across the front teeth, usually holding a pontic to fill a space.',
      pts: ['Tap the missing tooth with Pontic and give its shade; add clasps as needed.', 'The same price as a standard Hawley on Specialty’s list.'],
      note: 'Specialty’s site doesn’t describe it.', src: ['pontic'] },
    spring3: { short: 'A spring retainer front (cuspid to cuspid) on a Hawley back: resets and aligns the front teeth.',
      sum: 'The Spring Hawley combines the spring retainer’s front with the Hawley’s back: maximum anchorage for aligning the front teeth.',
      pts: ['Front teeth out of line are reset on the model into an ideal or slightly over-corrected position (Specialty).',
        'Acrylic on the labial bow and a mushroom-shaped lingual spring; C, Adams or Ball clasps.', '3x3: cuspid to cuspid.'],
      src: ['spring'] },
    spring4: { short: 'The Spring Hawley from first premolar to first premolar.',
      sum: 'A Spring Hawley spanning first premolar to first premolar instead of cuspid to cuspid.',
      pts: ['Specialty makes spring retainers cuspid to cuspid or bicuspid to bicuspid.', 'Not on Specialty’s price list (the 3x3 and Super Modified are).'],
      src: ['spring'] },
    springSM: { short: 'A Spring Hawley with a helix behind the lingual acrylic: more torque and rotation control.',
      sum: 'A Spring Hawley with a helix on the distal of the lingual band of acrylic, for more torque control and rotational force.',
      pts: ['It can also have lingual loops to make that section more flexible.', 'Specialty: one of the most popular and effective Spring Hawley designs. C, Adams or Ball clasps.'],
      src: ['super'] },
    horseshoe: { name: 'Horseshoe palate', short: 'A U-shaped plate, the middle of the palate left open.',
      sum: 'The plate is U-shaped, leaving the middle of the palate open.',
      pts: ['The usual lower plate; on the upper, ask for it if palatal coverage is a tolerance issue (Flora Dental).'], src: ['guide'] },
    full: { name: 'Full palate', short: 'Acrylic over the whole palate (standard on Specialty’s wraparound).',
      sum: 'The acrylic covers the whole roof of the mouth.',
      pts: ['Standard on Specialty’s wraparound; the usual upper coverage (Flora Dental).'], src: ['wrap', 'guide'] }
  },
  clasp: {
    c: { pic: 'clasp-c', draw: 'c', short: 'A wire hooked around the molar; Specialty’s standard on the upper first molars.',
      sum: 'A simple wire clasp around a molar.',
      pts: ['Specialty’s standard upper Hawley comes with C-clasps on the first molars (counted with the design here).', 'Tap Upper or Lower to put them on the first molars, or tap teeth with C-clasp.'], src: ['hawley'] },
    adams: { pic: 'clasp-adams', draw: 'adams', short: 'An arrowhead clasp gripping both cheek-side corners of a molar: firm and adjustable.',
      sum: 'The workhorse clasp: two arrowheads engage the molar’s buccal undercuts, joined by a span along the cheek side.',
      pts: ['Firm retention you can tighten as the retainer loosens with wear (Flora Dental).', 'Very retentive, but needs careful adjustment and can interfere with the bite (ScienceDirect).'],
      src: ['guide', 'removable'] },
    ball: { pic: 'clasp-ball', draw: 'ball', short: 'A wire ending in a ball that sits in the gap between two teeth.',
      sum: 'A wire that crosses between two teeth and ends in a ball in the gap on the cheek side.',
      pts: ['For retention between teeth in tight contacts (Flora Dental).', 'On the arches, tap the tooth in front of the gap: the ball goes between it and the tooth behind it.'], src: ['guide'] },
    solc: { short: 'A C-clasp soldered to the labial bow instead of set in the acrylic.',
      sum: 'Specialty’s soldered design: a .032 C-clasp soldered off the labial bow’s adjustment loop.',
      pts: ['The C-clasp can be adjusted for activation; the wire crosses the bite only at the cuspids (Specialty).', 'Also offered on the Specialty Wrap.'], src: ['scc', 'swrap'] },
    delta: RXC_INFO.delta, arrowhead: RXC_INFO.arrowhead
  },
  acc: {
    finger: { short: 'A small spring in the acrylic that moves one tooth.',
      sum: 'A spring set in the acrylic that pushes a single tooth, usually along the arch.',
      pts: ['Tap the tooth on the arches with Finger spring (its number goes on the line) and type which way.', 'For labial movement a Z-spring or T-spring is the usual choice (ScienceDirect).'],
      note: 'Specialty’s site doesn’t describe it.', src: ['removable'] },
    solder: { short: 'A spring soldered to the bow instead of set in the acrylic.', sum: 'A spring soldered to the labial bow, to move or hold a tooth.',
      pts: ['Say which tooth and what it should do on the line.'], note: RXR_USUAL },
    closing: { short: 'A spring that closes a space.', sum: 'A spring that closes a small space, such as a gap between the front teeth.',
      pts: ['Say which space on the line.'], note: RXR_USUAL },
    spurs: { short: 'Short wire spurs that keep a tooth from moving.', sum: 'Small wire spurs against a tooth that hold it in place, so it can’t drift while the others settle.',
      pts: ['Tap the teeth on the arches with Spur, or type them on the line.'], note: RXR_USUAL },
    helical: { short: 'A labial bow with coils for more flex: helps minor tooth movement and space closure.',
      sum: 'A labial bow with helical coils, giving the front of the appliance more flexibility.',
      pts: ['Specialty uses a helical labial bow to help correct minor tooth movement and close minor spaces.'], src: ['helix'] },
    cuspHook: { short: 'A hook soldered to the bow at the cuspid, e.g. for elastics.', sum: 'A small hook soldered to the labial bow at the cuspid, usually for elastics.', note: RXR_USUAL },
    habit: { short: 'A crib, spurs or a Bluegrass bead to break a thumb or tongue habit.',
      sum: 'Habit breakers: a crib (a cage behind the front teeth), spurs, or a Bluegrass bead in the palate. Pick which under the row.',
      pts: ['Specialty’s habit crib: a vertical cage just behind the lower front teeth stops thumb sucking and tongue thrusting.', 'Bluegrass: a bead (Specialty: a pearl) in the vault of the palate retrains the tongue.'],
      note: 'Specialty’s pages describe its fixed habit appliances (on molar bands).', src: ['crib', 'blue'] },
    screw: { name: 'Space closing screw', short: 'A screw in the plate, turned to close a space.', sum: 'A screw built into the plate that is turned to close a space.',
      pts: ['Specify it on the line.'], note: RXR_USUAL }
  },
  acr: {
    bowAcr: { short: 'Acrylic over the labial bow across the front teeth.', sum: 'Acrylic added over the labial bow across the front teeth.',
      pts: ['Specialty’s Spring Hawleys have acrylic on the labial bow.'], src: ['spring'] },
    abp: { short: 'Thicker acrylic behind the upper front teeth for the lower front teeth to bite on.',
      sum: 'The acrylic behind the upper incisors is thickened so the lower incisors meet it, with the back teeth apart.',
      pts: ['IR Express can’t be ordered with bite planes (Specialty).'], src: ['removable', 'irx'] },
    pbp: { short: 'Acrylic over the biting surfaces of the back teeth.', sum: 'The acrylic is extended over the biting surfaces of the back teeth.',
      pts: ['Not on Specialty’s price list.'], src: ['removable'] },
    scallop: { short: 'The acrylic follows each front tooth’s outline instead of a straight edge.', sum: 'The acrylic edge behind the front teeth is scalloped around each tooth.', note: RXR_USUAL },
    saddle: { short: 'Acrylic built over a gap in the arch, usually to hold a pontic.', sum: 'A saddle of acrylic over the toothless part of the arch, to keep a pontic in line.',
      pts: ['Say where on the line.'], src: ['pontic'] },
    pontic: { short: 'A plastic tooth in the acrylic that fills a space.', sum: 'A plastic tooth of the right shade and size set into the retainer to fill a gap.',
      pts: ['Tap the missing teeth on the arches with Pontic and give the shade.', 'Cases with pontics can’t be IR Express (Specialty).'], src: ['pontic', 'irx'] },
    color: { name: 'Acrylic color', short: 'Specialty colors are free; glitter, glow and swirl cost extra.',
      sum: 'The plate’s color — filled in from the case’s acrylic color; type over it for this Rx.',
      pts: ['Specialty colors are free; glitter, glow, swirl and custom designs are extra (Specialty).', 'Specialty asks for the color on the Rx; their color chart has the names.'], src: ['hawley', 'color'] }
  },
  flr: {
    cc: { name: 'Central – central', short: 'Bonded to the two central incisors.', sum: 'A fixed lingual retainer from central incisor to central incisor.', pts: ['Specialty’s spans: central–central, lateral–lateral and cuspid–cuspid.'], src: ['cflr'] },
    ll: { name: 'Lateral – lateral', short: 'Bonded across the four incisors.', sum: 'A fixed lingual retainer from lateral incisor to lateral incisor.', src: ['cflr'] },
    c3: { name: 'Cuspid – cuspid', short: 'Bonded across the six front teeth.', sum: 'A fixed lingual retainer from cuspid to cuspid.', src: ['cflr'] },
    compEach: { short: 'Composite pads on every tooth of the span: Specialty’s standard.', sum: 'Each tooth in the span gets a composite pad holding the wire.',
      pts: ['Specialty’s standard fixed lingual retainer.', 'It comes in a two-part tray (a hard outer and a soft inner shell) for bonding.'], src: ['cflr'] },
    compDist: { short: 'Composite pads only on the end teeth (e.g. the cuspids).', sum: 'Only the end teeth of the span are bonded; the wire runs between them.',
      pts: ['On the list as Composite Retainer: Cuspids Only.'], src: ['cflr'] },
    meshEach: { short: 'Laser-welded mesh pads on every tooth on a low-profile flat wire, with room to floss.',
      sum: 'Mesh pads on each tooth, laser-welded to a low-profile flat wire contoured between the teeth.',
      pts: ['Less bulk, and room for the patient to floss between the pads (Specialty).', 'Specialty can’t use braided wire with mesh pads; their standard is .016 × .022 stainless steel.'], src: ['mflr'] },
    meshDist: { short: 'Mesh pads only on the end teeth.', sum: 'Mesh pads on the end teeth of the span only.', pts: ['On the list as Mesh Pad Retainer: Cuspids Only.'], src: ['mflr'] },
    r028: { short: 'The classic round .028 stainless steel wire.', sum: 'A round .028″ (0.7 mm) stainless steel wire — the original bonded retainer, bonded to the canines.', src: ['bdj'] },
    braided: { short: 'A twisted multi-strand wire (with composite pads only).', sum: 'A multi-stranded .016 × .022 wire, its strands twisted together.',
      pts: ['Not with mesh pads (Specialty).'], src: ['bdj', 'mflr'] },
    solid: { short: 'Specialty’s most common wire: very low profile and the most durable.', sum: 'Solid .016 × .022 stainless steel: Specialty says it’s the most common wire, very low profile with maximum durability.',
      pts: ['Specialty’s standard for the mesh pad retainer.'], src: ['cflr', 'mflr'] }
  },
  ir: {
    single: { short: 'One clear Zendura retainer for the arch.', sum: 'A clear retainer in Zendura (.030 standard, .040 optional).',
      pts: ['Minor front-tooth corrections can be built in on request.', 'A 3D-printed model comes free with two or more retainers per arch (Specialty).'], src: ['invis'] },
    g2: { name: 'Guardian® 2', short: 'Two sets of clear retainers for the arch, with a printed model; bracket removal and model fees waived.',
      sum: 'Specialty’s Guardian program: two sets of retainers per arch for a much lower price, with a 3D-printed model of each arch.',
      pts: ['The bracket removal and model printing fees are waived.', 'Made so clear retainers go in the same day the braces come off — no separate retainer visit.'], src: ['guard'] },
    g3: { name: 'Guardian® 3', short: 'Three sets of clear retainers for the arch, with a printed model.',
      sum: 'Guardian with three sets of retainers per arch and a 3D-printed model of each arch (Specialty).',
      pts: ['Bracket removal and model printing fees waived; delivered for the debond appointment.'], src: ['guard'] },
    g4: { name: 'Guardian® 4', short: 'Four sets of clear retainers for the arch, with a printed model.',
      sum: 'Guardian with four sets of retainers per arch and a 3D-printed model of each arch (Specialty).',
      pts: ['Bracket removal and model printing fees waived; delivered for the debond appointment.'], src: ['guard'] },
    express: { short: 'A quick-ship Zendura retainer: 5-day turnaround, digital scans only.',
      sum: 'IR Express: a Zendura A .030 retainer with a 5-day turnaround; bracket removal and shipping included, no printed model.',
      pts: ['Not for cases needing band, wire or expander removal, pontics, bonded retainers, bite planes or a Theroux.', 'Cases sent as impressions or stone models don’t get the 5-day turnaround.'], src: ['irx'] }
  }
};

/* ---------- prices: Specialty's price list MKT-41 (Rev 01-26, updated 1-27-26): retainers, the custom design options,
   acrylic colors and Guardian. A design's flat or clear bow is the list's labial wire on top of the design; clasps and
   springs are by the pair or each; a Spring Hawley's resets come with it (Specialty resets the front teeth on it), others
   are per tooth. Everything else on the Rx is unpriced until Dr. A enters a price. ---------- */
const RXR_PRICES = [
  ['hawley', 'Hawley: Standard Design', 61.00], ['wrap', 'Hawley: Wraparound Design', 97.00], ['flipper', 'Flipper (no bow)', 61.00], ['specwrap', 'Specialty Wrap Design', 131.50],
  ['spring3', 'Spring/Hawley: 3x3 Design', 108.00], ['springSM', 'Spring/Hawley: Super Modified', 133.50],
  ['flatbow', 'Flat bow labial wire, per arch', 15.25], ['clearbow', 'ClearBow labial wire, per arch', 36.50], ['acrBow', 'Acrylic to labial bow', 27.50],
  ['adams', 'Adams clasps, pair', 27.50], ['clasp', 'C-clasps, arrows or ball clasps, pair', 19.25], ['solAdams', 'Soldered Adams clasps, pair', 42.00], ['solC', 'Soldered C-clasps, pair', 34.50],
  ['finger', 'Finger spring, each', 15.25], ['solSpring', 'Soldered spring, each', 28.50], ['pontic', 'Pontic, each', 47.00], ['reset', 'Reset, per tooth', 13.75],
  ['abp', 'Anterior bite plane', 37.50], ['glitter', 'Glitter, glow or swirl acrylic', 9.50],
  ['comp4', 'Composite retainer: 4 pads', 72.00], ['comp6', 'Composite retainer: 6 pads', 84.00], ['compCusp', 'Composite retainer: cuspids only', 72.00],
  ['mesh6', 'Mesh pad retainer: 6 pads', 131.50], ['meshCusp', 'Mesh pad retainer: cuspids only', 153.00],
  ['zendura', 'Zendura invisible retainer, single arch', 40.50], ['irx', 'IR Express (quick ship), single arch', 29.00],
  ['g2', 'Guardian 2, single arch', 45.50], ['g2d', 'Guardian 2, dual arch', 90.00], ['g3', 'Guardian 3, single arch', 62.00], ['g3d', 'Guardian 3, dual arch', 137.00],
  ['g4', 'Guardian 4, single arch', 89.00], ['g4d', 'Guardian 4, dual arch', 180.50],
  // not on the price list
  ['tremont', 'Tremont Wraparound', null], ['spring4', 'Spring Hawley 4x4', null], ['pbp', 'Posterior bite plane', null], ['scallop', 'Scallop anteriors', null],
  ['saddle', 'Acrylic saddle', null], ['closing', 'Closing spring', null], ['spurs', 'Holding spurs', null], ['helical', 'Helical bow', null],
  ['cuspHook', 'Soldered cuspid hook', null], ['habit', 'Habit crib / spurs / Bluegrass on a retainer (the list prices only the fixed appliances)', null], ['scScrew', 'Space closing screw', null],
  ['delta', 'Delta clasps, pair', null], ['acrDesign', 'Custom design acrylic (football, rainbow, tie dye …)', null]
];
rxAddPrices(RXR_PRICES);
/* each design: the list's price for it, and the labial wire it adds */
const RXR_BASE = {
  hawley: { k: 'hawley' }, flatHawley: { k: 'hawley', note: 'the list’s Standard Hawley', plus: ['flatbow', 'flat bow labial wire'] },
  wrap: { k: 'wrap' }, flatWrap: { k: 'wrap', note: 'the list’s Wraparound', plus: ['flatbow', 'flat bow labial wire'] }, tremont: { k: 'tremont' }, specWrap: { k: 'specwrap' },
  bowSold: { k: 'hawley', note: 'priced as the list’s Standard Hawley; its clasps as soldered clasps' },
  flatSold: { k: 'hawley', note: 'priced as the list’s Standard Hawley; its clasps as soldered clasps', plus: ['flatbow', 'flat bow labial wire'] },
  clearbow: { k: 'hawley', note: 'the list’s Standard Hawley', plus: ['clearbow', 'ClearBow labial wire'] }, flipper: { k: 'flipper' },
  spring3: { k: 'spring3' }, spring4: { k: 'spring4' }, springSM: { k: 'springSM' }
};
const RXR_IR_K = { single: 'zendura', express: 'irx', g2: 'g2', g3: 'g3', g4: 'g4' };
/* a design's price on its button: the design and its wire together */
function rxrDesignTag(d) {
  const b = RXR_BASE[d], P = rxPrices(); if (!b) return ''; const keys = [b.k].concat(b.plus ? [b.plus[0]] : []);
  if (keys.some(k => P[k] == null)) return RX_LIST[b.k] == null ? 'not on list' : 'no price';
  return money(keys.reduce((s, k) => s + P[k], 0)) + (d === 'bowSold' || d === 'flatSold' ? ' + clasps' : '');
}

/* ---------- the acrylic color: picked on this Rx, else the case's (for an arch that has a plate) ---------- */
function rxrCaseColor(c) { return typeof acrylicName === 'function' ? acrylicName(c) : c && c.acrylic ? c.acrylic + (c.glitter ? ' glitter' : '') : ''; }
/* (an arch with no retainer design has no acrylic: a color tapped while only a bonded or clear retainer was picked isn't ticked or charged) */
function rxrColor(c, rx, A) { return rx['design' + A] ? rx['color' + A] || rxrCaseColor(c) : ''; }
/* the plate's tint on the drawing: the color's swatch (caseform.js ACRYLIC, Specialty's guide; or a color picked before) lightened, else acrylic pink */
function rxrMix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function rxrTint(col) {
  const list = (typeof ACRYLIC !== 'undefined' ? ACRYLIC.concat(ACRYLIC_OLD) : []).slice().sort((m, n) => n.v.length - m.v.length);
  const a = col && list.find(x => new RegExp('\\b' + x.v.replace(/\s+/g, '\\s+') + '\\b', 'i').test(col));
  if (a && a.c === 'clear') return { f: '#EEF3F7', s: '#8D9AA8' };
  if (a && /^#[0-9a-f]{6}$/i.test(a.c)) return { f: rxrMix(a.c, '#FFFFFF', .72), s: rxrMix(a.c, '#000000', .25) };
  return { f: '#F6DCE3', s: '#B4808F' };
}

/* ---------- the Rx: one way to save it ---------- */
function rxrCanon(rx) {
  const o = { form: RX_RET }, { one, list, flag } = rxCanonKit(rx, o);
  one('palate', RXR_K('palate'));
  RXR_ARCH.forEach(A => one('design' + A, RXR_DESIGNS));
  const t = {}; RXR_TEETH.forEach(id => { const v = (rx.teeth || {})[id]; if (RXR_TOOTH.includes(v)) t[id] = v; }); if (Object.keys(t).length) o.teeth = t;
  one('resetHow', RXR_K('resetHow')); if (o.resetHow !== 'none') list('reset', RXR_RESET);
  flag('noStrip');
  // a finger spring, holding spur or pontic on a tooth ticks its box for that arch
  const has = (k, A) => Object.keys(t).some(id => id[0] === A && t[id] === k);
  RXR_ARCH.forEach(A => {
    const acc = new Set(Array.isArray(rx['acc' + A]) ? rx['acc' + A] : []); if (has('finger', A)) acc.add('finger'); if (has('spur', A) || has('spurM', A)) acc.add('spurs');
    const u = RXR_ACC.filter(v => acc.has(v)); if (u.length) o['acc' + A] = u;
  });
  if ((o.accU || []).includes('habit') || (o.accL || []).includes('habit')) list('habit', RXR_K('habit'));
  RXR_ARCH.forEach(A => {
    const acr = new Set(Array.isArray(rx['acr' + A]) ? rx['acr' + A] : []); if (has('pontic', A)) acr.add('pontic');
    const u = RXR_ACR.filter(v => acr.has(v)); if (u.length) o['acr' + A] = u;
  });
  RXR_ARCH.forEach(A => { one('flr' + A, RXR_K('flr')); one('flrPads' + A, RXR_K('pads')); one('flrWire' + A, RXR_K('wire')); one('ir' + A, RXR_K('ir')); });
  RXR_TEXTS.forEach(k => one(k, null, 40));
  flag('rush');
  rxCanonTail(rx, o, RXR);
  return o;
}
/* "Hawley (U & L) · FLR 3–3 (lower) · Guardian 2 (upper)" */
function rxrSummary(rx) {
  const parts = [], pair = (k, name) => { const u = rx[k + 'U'], l = rx[k + 'L']; if (u && u === l) parts.push(name(u) + ' (U & L)'); else { if (u) parts.push(name(u) + ' (upper)'); if (l) parts.push(name(l) + ' (lower)'); } };
  pair('design', rxrDesignName); pair('flr', v => 'FLR ' + RXR_SPAN[v]); pair('ir', v => rxrLbl(v, ['ir']));
  const p = Object.values(rx.teeth || {}).filter(k => k === 'pontic').length; if (p) parts.push(p + ' pontic' + (p > 1 ? 's' : ''));
  return parts.join(' · ') || 'Nothing picked yet';
}
function rxrEstimate(rx, c) {
  const E = rxEst(), add = E.add, inc = E.inc, miss = E.missing, teeth = rx.teeth || {}, W = rxrArchWord;
  const count = (k, A) => Object.keys(teeth).filter(id => id[0] === A && teeth[id] === k).length;
  // the designs (the same design on both arches: one line × 2), with their flat or clear labial wire
  const des = {}; RXR_ARCH.forEach(A => { const d = rx['design' + A]; if (d) (des[d] = des[d] || []).push(A); });
  Object.keys(des).forEach(d => { const n = des[d].length, where = n === 2 ? 'upper & lower' : W(des[d][0]), b = RXR_BASE[d];
    add(rxrDesignName(d) + ' · ' + where, b.k, n, b.note || '');
    if (b.plus) add('+ ' + b.plus[1] + ' · ' + where, b.plus[0], n); });
  // clasps by the pair; a standard Hawley's (and the Specialty Wrap's) C-clasps on the first molars come with it
  RXR_ARCH.forEach(A => {
    const d = rx['design' + A], sold = d === 'bowSold' || d === 'flatSold', n = { c: count('c', A), adams: count('adams', A), ball: count('ball', A), solc: count('solc', A), delta: count('delta', A), arrowhead: count('arrowhead', A) }, w = W(A), pr = x => Math.ceil(x / 2);
    if (RXR_STD_INCL.includes(d) && (RXR_STD[d] || {})[A] === 'c' && teeth[A + 'R6'] === 'c' && teeth[A + 'L6'] === 'c') { inc('C-clasps on the ' + w + ' first molars', 'With the ' + rxrDesignName(d)); n.c -= 2; }
    if (n.adams) add('Adams clasps · ' + w + ' × ' + pr(n.adams) + ' pr', sold ? 'solAdams' : 'adams', pr(n.adams), sold ? 'soldered to the bow' : '');
    if (n.c) add('C-clasps · ' + w + ' × ' + pr(n.c) + ' pr', sold ? 'solC' : 'clasp', pr(n.c), sold ? 'soldered to the bow' : '');
    if (n.ball) add('Ball clasps · ' + w + ' × ' + pr(n.ball) + ' pr', 'clasp', pr(n.ball));
    if (n.solc) add('Soldered C-clasps · ' + w + ' × ' + pr(n.solc) + ' pr', 'solC', pr(n.solc));
    if (n.delta) add('Delta clasps · ' + w + ' × ' + pr(n.delta) + ' pr', 'delta', pr(n.delta));
    if (n.arrowhead) add('Arrowhead clasps · ' + w + ' × ' + pr(n.arrowhead) + ' pr', 'clasp', pr(n.arrowhead), 'the list’s arrows');
  });
  if (rx.claspOther) miss.push('Other clasping: ' + rx.claspOther);
  // resets: part of a Spring Hawley (Specialty resets the front teeth on it), otherwise per tooth
  RXR_ARCH.forEach(A => { const r = (rx.reset || []).filter(id => id[0] === A), d = rx['design' + A]; if (!r.length) return;
    if (RXR_K('spring').includes(d)) inc('Resets · ' + W(A) + ' × ' + r.length, 'Part of the ' + rxrDesignName(d));
    else add('Resets · ' + W(A) + ' × ' + r.length, 'reset', r.length); });
  if ((rx.resetHow === 'ideal' || rx.resetHow === 'compromise') && !(rx.reset || []).length) miss.push('Resets (tap the teeth to reset to count them)');
  RXR_ARCH.forEach(A => {
    const w = W(A), acc = rx['acc' + A] || [], acr = rx['acr' + A] || [], p = count('pontic', A), f = count('finger', A);
    if (acr.includes('pontic')) add('Pontic' + (p > 1 ? 's' : '') + ' · ' + w + ' × ' + Math.max(1, p), 'pontic', Math.max(1, p));
    if (acc.includes('finger')) add('Finger spring' + (f > 1 ? 's' : '') + ' · ' + w + ' × ' + Math.max(1, f), 'finger', Math.max(1, f));
    if (acc.includes('solder')) add('Soldered spring · ' + w, 'solSpring');
    [['closing', 'Closing spring'], ['spurs', 'Holding spurs'], ['helical', 'Helical bow'], ['cuspHook', 'Soldered cuspid hook'], ['habit', 'Habit ' + ((rx.habit || []).map(h => rxrLbl(h, ['habit']).toLowerCase()).join(' + ') || '(crib / spurs / Bluegrass)')]]
      .forEach(([k, l]) => { if (acc.includes(k)) add(l + ' · ' + w, k); });
    if (acr.includes('bowAcr')) add('Acrylic to labial bow · ' + w, 'acrBow');
    if (acr.includes('abp')) add('Anterior bite plane · ' + w, 'abp');
    [['pbp', 'Posterior bite plane'], ['scallop', 'Scallop anteriors'], ['saddle', 'Acrylic saddle']].forEach(([k, l]) => { if (acr.includes(k)) add(l + ' · ' + w, k); });
    // the acrylic: Specialty colors are free; glitter, glow and swirl are extra; a custom design isn't on the list
    const col = rxrColor(c, rx, A);
    if (col && (rx['design' + A] || rx['color' + A])) rxAcrCost(col, w, add, inc);
  });
  if (rx.screwTxt) add('Space closing screw', 'scScrew');
  // fixed lingual retainers: the list's composite / mesh retainer for the span and pads (Specialty's standard pads: composite on each tooth)
  RXR_ARCH.forEach(A => { const pl = rx['flr' + A], w = W(A);
    if (!pl) { if (rx['flrPads' + A] || rx['flrWire' + A]) miss.push('Fixed lingual retainer · ' + w + ' (pick the placement)'); return; }
    const pads = rx['flrPads' + A] || 'compEach', std = rx['flrPads' + A] ? '' : 'Specialty’s standard pads';
    const [k, note] = pads === 'compEach' ? [pl === 'c3' ? 'comp6' : 'comp4', pl === 'cc' ? 'two pads, priced as the list’s 4 Pads' : ''] : pads === 'compDist' ? ['compCusp', pl !== 'c3' ? 'priced as the list’s Cuspids Only' : '']
      : pads === 'meshEach' ? ['mesh6', pl !== 'c3' ? 'priced as the list’s 6 Pads' : ''] : ['meshCusp', pl !== 'c3' ? 'priced as the list’s Cuspids Only' : ''];
    add('Fixed lingual retainer · ' + w + ' ' + RXR_SPAN[pl] + ', ' + RXR_PADS_S[pads], k, 1, [std, note].filter(Boolean).join('; ')); });
  // invisible retainers (Guardian on both arches: the list's dual-arch price)
  const iu = rx.irU, il = rx.irL;
  if (iu && iu === il) add(rxrLbl(iu, ['ir']) + ' · upper & lower', /^g/.test(iu) ? iu + 'd' : RXR_IR_K[iu], /^g/.test(iu) ? 1 : 2, /^g/.test(iu) ? 'dual arch' : '');
  else RXR_ARCH.forEach(A => { const v = rx['ir' + A]; if (v) add(rxrLbl(v, ['ir']) + ' · ' + W(A), RXR_IR_K[v]); });
  if (rx.rush) add('Expedited manufacturing and shipping', 'rush', 1, 'Specialty’s fee for under 10 business days');
  return E.done();
}

/* ---------- the arch diagram: the retainer drawn from the choices (RXG = this form while rxAuto draws) ---------- */
/* the point on a tooth's outline from its center (moved `along` toward the midline) in direction `dir`, pushed out by `gap` */
function rxrEdge(id, along, dir, gap) {
  const t = rxT(id), p = t.p, ox = t.c[0] + t.m[0] * along, oy = t.c[1] + t.m[1] * along, dx = dir[0], dy = dir[1];
  let best = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length, ax = p[i], ay = p[i + 1], ex = p[j] - ax, ey = p[j + 1] - ay, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
    const s = ((ax - ox) * ey - (ay - oy) * ex) / den, u = ((ax - ox) * dy - (ay - oy) * dx) / den;
    if (u >= 0 && u <= 1 && s > best) best = s;
  }
  if (!best) best = t.r;
  return [ox + dx * (best + gap), oy + dy * (best + gap)];
}
const rxrB = (id, gap, along) => rxrEdge(id, along || 0, rxT(id).b, gap); // cheek side
const rxrL = (id, gap, along) => { const b = rxT(id).b; return rxrEdge(id, along || 0, [-b[0], -b[1]], gap); }; // tongue side
const rxrDi = (id, gap) => { const m = rxT(id).m; return rxrEdge(id, 0, [-m[0], -m[1]], gap); }; // the back of the tooth
/* the neighbour toward the midline (+1) or back (-1) */
function rxrNext(id, dir) { const A = id[0], s = id[1], n = +id[2]; if (dir < 0) return n < 7 ? A + s + (n + 1) : null; return n > 1 ? A + s + (n - 1) : A + (s === 'R' ? 'L' : 'R') + '1'; }
/* where two neighbouring teeth meet: on the biting surface (mid) or in the gap on the cheek (side 1) or tongue (side -1) side */
const rxrMid = (a, b) => { const ta = rxT(a), tb = rxT(b); return [(ta.c[0] + tb.c[0]) / 2, (ta.c[1] + tb.c[1]) / 2]; };
function rxrGap(a, b, side, gap) {
  const ta = rxT(a), tb = rxT(b), toward = (t, o) => Math.sign((o.c[0] - t.c[0]) * t.m[0] + (o.c[1] - t.c[1]) * t.m[1]) || 1, f = side > 0 ? rxrB : rxrL;
  const pa = f(a, gap, toward(ta, tb) * ta.r * .6), pb = f(b, gap, toward(tb, ta) * tb.r * .6);
  return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
}
const rxrSeq = A => [7, 6, 5, 4, 3, 2, 1].map(n => A + 'R' + n).concat([1, 2, 3, 4, 5, 6, 7].map(n => A + 'L' + n)); // around the arch, right to left
/* how each design's bow runs: a Hawley bow (crossing behind tooth `cross`), a wraparound, a clear wrap, soldered to the clasps, none */
const RXR_BOW = {
  hawley: { bow: 'hawley', cross: 3 }, flatHawley: { bow: 'hawley', cross: 3, flat: 1 }, clearbow: { bow: 'hawley', cross: 3, clear: 1 },
  wrap: { bow: 'wrap', support: 1 }, flatWrap: { bow: 'wrap', support: 1, flat: 1 }, tremont: { bow: 'wrap', tremont: 1 }, specWrap: { bow: 'clearWrap' },
  bowSold: { bow: 'sold' }, flatSold: { bow: 'sold', flat: 1 }, flipper: { bow: 'none' },
  spring3: { bow: 'hawley', cross: 3, labial: 1 }, spring4: { bow: 'hawley', cross: 4, labial: 1 }, springSM: { bow: 'hawley', cross: 3, labial: 1, helix: 1 }
};
function rxrAuto(rx, c) {
  const out = [], teeth = rx.teeth || {}, S2 = ['R', 'L'];
  const stroke = (d, w, col, dash) => out.push(Object.assign({ d, s: col || RX_METAL, w }, dash ? { dash } : {}));
  const fill = (d, col, s, w) => out.push({ d, f: col, s: s || '', w: w || 0 });
  const dot = (p, r) => fill(RXP.circle(p[0], p[1], r), RX_METAL);
  const ring = (p, r, w) => fill(RXP.circle(p[0], p[1], r), '#FFFFFF', RX_METAL, w || .8);
  const wire = (pts, w) => stroke(RXP.smooth(pts), w || 1.1);
  const ribbon = pts => { stroke(RXP.smooth(pts), 2.7); stroke(RXP.smooth(pts), .9, '#FFFFFF'); }; // a flat bow
  const clearBand = pts => { stroke(RXP.smooth(pts), 3.6); stroke(RXP.smooth(pts), 2.5, '#E6F1FB'); }; // a clear bow
  const arches = RXR_ARCH.filter(A => rx['design' + A]);
  const tintOf = A => rxrTint(rxrColor(c, rx, A));
  // the plate: along the tongue side of the teeth, 7 to 7; horseshoe (always on the lower) or full palate; scalloped behind the front teeth when asked
  arches.forEach(A => {
    const seq = rxrSeq(A), scal = (rx['acr' + A] || []).includes('scallop'), full = A === 'U' && (rx.palate === 'full' || (!rx.palate && ['wrap', 'flatWrap', 'tremont'].includes(rx.designU)));
    const pts = [], nrm = [];
    const push = (p, id) => { pts.push(p); const b = rxT(id).b; nrm.push([-b[0], -b[1]]); };
    push(rxrL(seq[0], .6, -rxT(seq[0]).r * .55), seq[0]);
    seq.forEach(id => { const n = +id[2], r = rxT(id).r, R = id[1] === 'R';
      if (scal && n <= 3) (R ? [-.45, 0, .45] : [.45, 0, -.45]).forEach(k => push(rxrL(id, .45, k * r), id)); else push(rxrL(id, .6, 0), id); });
    push(rxrL(seq[13], .6, -rxT(seq[13]).r * .55), seq[13]);
    const tn = tintOf(A), d = RXP.smooth(pts);
    if (full) { const a = pts[pts.length - 1], b = pts[0], i1 = rxT(A + 'R1').c, i2 = rxT(A + 'L1').c, m7 = [(rxT(A + 'R7').c[0] + rxT(A + 'L7').c[0]) / 2, (rxT(A + 'R7').c[1] + rxT(A + 'L7').c[1]) / 2];
      let ax = (i1[0] + i2[0]) / 2 - m7[0], ay = (i1[1] + i2[1]) / 2 - m7[1]; const L = Math.hypot(ax, ay) || 1; ax /= L; ay /= L;
      const k = [(a[0] + b[0]) / 2 + ax * 9, (a[1] + b[1]) / 2 + ay * 9];
      d.push(['C', k[0], k[1], k[0], k[1], b[0], b[1]], ['Z']); }
    else { const w = A === 'U' ? 11 : 7, inner = pts.map((p, i) => [p[0] + nrm[i][0] * w, p[1] + nrm[i][1] * w]).reverse(), back = RXP.smooth(inner);
      d.push(['L', inner[0][0], inner[0][1]]); back.slice(1).forEach(o => d.push(o)); d.push(['Z']); }
    fill(d, tn.f, tn.s, .6);
  });
  // bite planes: over the back teeth (posterior), thickened behind the front teeth (anterior)
  RXR_ARCH.forEach(A => { const acr = rx['acr' + A] || [];
    if (acr.includes('pbp')) S2.forEach(s => [4, 5, 6, 7].forEach(n => { const p = rxPoly(A + s + n, 1.1); stroke(rxHatch(p, -45, 1.8), .35, '#8A94A3'); stroke(RXP.poly(p, true), .5, '#7B8594'); }));
    if (acr.includes('abp')) { const ids = ['R3', 'R2', 'R1', 'L1', 'L2', 'L3'].map(x => A + x), o = ids.map(id => rxrL(id, .7, 0)), i = ids.map(id => rxrL(id, 6.5, 0)).reverse(), poly = o.concat(i);
      stroke(rxHatch(poly, 45, 1.5), .35, '#7B8594'); stroke(RXP.poly(poly, true), .55, '#7B8594'); }
  });
  // pontics: a plastic tooth in the space
  Object.keys(teeth).filter(id => teeth[id] === 'pontic').forEach(id => { fill(RXP.poly(rxPoly(id, 1), true), '#F1E8D6', RX_METAL, .8); stroke(RXP.poly(rxPoly(id, .55), true), .4); });
  // resets: the teeth to reset, ringed with a dashed line
  (rx.reset || []).forEach(id => { const r = rxT(id).r; stroke(RXP.poly(rxPoly(id, (r + 1.2) / r), true), .7, RX_METAL, [1.3, 1.1]); });
  // fixed lingual retainers: the wire along the tongue side of the span, pads on each tooth or the end teeth
  RXR_ARCH.forEach(A => { const pl = rx['flr' + A]; if (!pl) return;
    const n = { cc: 1, ll: 2, c3: 3 }[pl], ids = []; for (let i = n; i >= 1; i--) ids.push(A + 'R' + i); for (let i = 1; i <= n; i++) ids.push(A + 'L' + i);
    const pads = rx['flrPads' + A] || 'compEach', wr = rx['flrWire' + A], pts = ids.map(id => rxrL(id, 1.0, 0));
    wire(pts, wr === 'r028' ? 1.15 : 1.0); if (wr === 'braided') stroke(RXP.smooth(pts), .45, '#FFFFFF', [.7, .7]);
    (/Each$/.test(pads) ? ids : [ids[0], ids[ids.length - 1]]).forEach(id => { const p = rxrL(id, -1.1, 0);
      if (/^mesh/.test(pads)) { const bar = RXP.bar(p, rxT(id).m, 3.6, 2.6); fill(bar, '#C9D6EA', RX_METAL, .6); const q = bar.slice(0, 4).map(o => [o[1], o[2]]); stroke(rxHatch(q, 45, .95), .3); }
      else fill(RXP.circle(p[0], p[1], 1.75), '#E7EDF5', RX_METAL, .7); });
  });
  // the bows
  arches.forEach(A => {
    const S = RXR_BOW[rx['design' + A]] || {}, acc = rx['acc' + A] || [], acr = rx['acr' + A] || [], tn = tintOf(A);
    const loopAt = (id, out) => { const r = rxT(id).r, o = out || 5.2; return [rxrB(id, 1.0, -.5 * r), rxrB(id, o - 1.7, -.3 * r), rxrB(id, o, -.12 * r), rxrB(id, o, .12 * r), rxrB(id, o - 1.7, .3 * r), rxrB(id, 1.0, .5 * r)]; }; // a U loop over the tooth (back to front)
    const top = lp => [(lp[2][0] + lp[3][0]) / 2, (lp[2][1] + lp[3][1]) / 2];
    let front = null, loops = [];
    if (S.bow === 'hawley') {
      const cr = S.cross, side = s => { const t = A + s + cr, b = A + s + (cr + 1), lp = loopAt(t); loops.push(top(lp));
        return [rxrGap(t, b, -1, 1.3), rxrMid(t, b), rxrGap(t, b, 1, 1.0)].concat(lp); };
      const R = side('R'), L = side('L').reverse(), mids = []; for (let i = cr - 1; i >= 1; i--) mids.push(rxrB(A + 'R' + i, 1.0, 0)); for (let i = 1; i < cr; i++) mids.push(rxrB(A + 'L' + i, 1.0, 0));
      wire(R.concat(mids, L)); front = [R[R.length - 1]].concat(mids, [L[0]]);
    } else if (S.bow === 'wrap') {
      const seq = rxrSeq(A), pts = [rxrL(seq[0], 1.4, -.35 * rxT(seq[0]).r), rxrDi(seq[0], 1.3)];
      seq.forEach(id => { if (S.tremont && id[2] === '3') { const lp = loopAt(id, 4.8); if (id[1] === 'L') lp.reverse(); loops.push(top(lp)); lp.forEach(q => pts.push(q)); } else pts.push(rxrB(id, 1.1, 0)); });
      pts.push(rxrDi(seq[13], 1.3), rxrL(seq[13], 1.4, -.35 * rxT(seq[13]).r)); wire(pts, 1.25);
      front = ['R3', 'R2', 'R1', 'L1', 'L2', 'L3'].map(x => rxrB(A + x, 1.1, 0));
      if (S.support) S2.forEach(s => { const a = A + s + '4', b = A + s + '5', p3 = rxrGap(a, b, 1, 1.1); wire([rxrGap(a, b, -1, 1.4), rxrMid(a, b), p3], .9); dot(p3, .95); });
      if (S.tremont) S2.forEach(s => { const r7 = rxT(A + s + '7').r, arm = [rxrB(A + s + '7', 3.4, -.35 * r7), rxrB(A + s + '6', 3.8, 0), rxrB(A + s + '5', 3.8, 0), rxrB(A + s + '4', 3.6, 0), rxrB(A + s + '3', 3.0, -.4 * rxT(A + s + '3').r)];
        wire(arm, 1.0); dot(arm[arm.length - 1], 1.0); });
    } else if (S.bow === 'clearWrap') {
      const pts = rxrSeq(A).slice(1, 13).map(id => rxrB(id, 1.7, 0)); clearBand(pts); dot(pts[0], .9); dot(pts[pts.length - 1], .9);
    } else if (S.bow === 'sold') {
      const end = s => { const m = [7, 6].find(n => RXR_CLASPS.includes(teeth[A + s + n])) || 6, id = A + s + m; return rxrB(id, 2.0, .45 * rxT(id).r); };
      const side = s => { const lp = loopAt(A + s + '3'); loops.push(top(lp)); return [end(s), rxrB(A + s + '5', 1.4, 0), rxrB(A + s + '4', 1.3, 0)].concat(lp); };
      const R = side('R'), L = side('L').reverse(), mids = ['R2', 'R1', 'L1', 'L2'].map(x => rxrB(A + x, 1.0, 0));
      wire(R.concat(mids, L), 1.25); dot(R[0], 1.25); dot(L[L.length - 1], 1.25); front = [R[R.length - 1]].concat(mids, [L[0]]);
    }
    if (front && S.flat) ribbon(front);
    if (front && S.clear) clearBand(front);
    // acrylic over the bow: a Spring Hawley's labial acrylic (to the crossing), or Add Acrylic to Bow (across the front teeth)
    if (front && (S.labial || acr.includes('bowAcr'))) { stroke(RXP.smooth(front), 5.2, tn.s); stroke(RXP.smooth(front), 4.2, tn.f); }
    if (S.helix) S2.forEach(s => ring(rxrL(A + s + '3', 4.6, -.3 * rxT(A + s + '3').r), 1.7));
    if (acc.includes('helical')) loops.forEach(p => ring(p, 1.9, .9));
    if (acc.includes('cuspHook')) S2.forEach(s => { const id = A + s + '3', t = rxT(id), p = rxrB(id, 1.1, .3 * t.r), q = [p[0] + t.b[0] * 3, p[1] + t.b[1] * 3];
      stroke(RXP.poly([p, q, [q[0] + t.m[0] * 1.5, q[1] + t.m[1] * 1.5]]), .9); dot(p, .9); });
  });
  // clasps, on the teeth
  rxrClaspShapes(teeth).forEach(x => out.push(x));
  // the standard lower Hawley's occlusal rests on the first molars (while they have no clasp)
  if (RXR_LOWER_RESTS.includes(rx.designL)) S2.forEach(s => { const id = 'L' + s + '6'; if (teeth[id]) return; const r = rxT(id).r, p = rxPt(id, r * .42, 0); stroke(RXP.line(p, rxPt(id, r * .42, -r * .95)), .8); dot(p, 1.4); });
  // finger springs (a helix in the acrylic with its arm to the tooth) and holding spurs (over the contact in front of the tooth)
  Object.keys(teeth).forEach(id => { const k = teeth[id], r = rxT(id).r;
    if (k === 'finger') { const h = rxrL(id, 4.8, -.25 * r); stroke(RXP.poly([rxrL(id, 7.6, .3 * r), h, rxrL(id, .3, .1 * r)]), .85); ring(h, 1.45); }
    // a spur facing distal comes over the contact in front of the tooth; facing mesial, over the one behind it (around the back of a 7)
    if (k === 'spur') { const mes = rxrNext(id, 1), tip = rxrGap(id, mes, 1, .6); stroke(RXP.poly([rxrGap(id, mes, -1, 1.4), rxrMid(id, mes), tip, rxrB(id, .4, .5 * r)]), .9); }
    if (k === 'spurM') { const dis = rxrNext(id, -1);
      if (dis) stroke(RXP.poly([rxrGap(id, dis, -1, 1.4), rxrMid(id, dis), rxrGap(id, dis, 1, .6), rxrB(id, .4, -.5 * r)]), .9);
      else stroke(RXP.poly([rxrL(id, 1.4, -.55 * r), rxrDi(id, 1.0), rxrB(id, 1.0, -.75 * r), rxrB(id, .4, -.5 * r)]), .9); }
  });
  // habit breakers: a crib (zigzag cage) or spurs behind the front teeth; a Bluegrass bead in the palate (upper)
  RXR_ARCH.forEach(A => { if (!(rx['acc' + A] || []).includes('habit')) return; const h = rx.habit || [], inc = ['R2', 'R1', 'L1', 'L2'].map(x => A + x);
    if (h.includes('crib') || !h.length) { const z = []; inc.forEach(id => { const r = rxT(id).r, R = id[1] === 'R'; (R ? [-.45, .45] : [.45, -.45]).forEach(k => z.push(rxrL(id, z.length % 2 ? 5.4 : 1.6, k * r))); }); stroke(RXP.poly(z), .9); }
    if (h.includes('spurs')) inc.forEach(id => { const a = rxrL(id, 1.4, 0), b = rxrL(id, 5.2, 0); stroke(RXP.line(a, b), .9); dot(b, .7); });
    if (h.includes('bluegrass') && A === 'U') { const a = rxrL('UR5', 1.4, 0), b = rxrL('UL5', 1.4, 0), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      stroke(RXP.line(a, b), .9); fill(RXP.poly([0, 1, 2, 3, 4, 5].map(i => [cx + 2.8 * Math.cos(i * Math.PI / 3), cy + 2.8 * Math.sin(i * Math.PI / 3)]), true), '#FFFFFF', RX_METAL, .9); }
  });
  // clear retainers: a dashed outline around the arch
  RXR_ARCH.forEach(A => { if (!rx['ir' + A]) return; const seq = rxrSeq(A), pts = [rxrDi(seq[0], 1.8)].concat(seq.map(id => rxrB(id, 1.8, 0)), [rxrDi(seq[13], 1.8)], seq.slice().reverse().map(id => rxrL(id, 1.8, 0)));
    pts.push(pts[0], pts[1]); stroke(RXP.smooth(pts).slice(0, -1), .85, '#0E7C86', [2.2, 1.4]); });
  return out;
}

/* the clasps on the teeth, drawn (shared with the Functional Rx; RXG is the form being drawn): Adams (rings at its arrowheads), delta
   (closed triangles), C and soldered C, ball (the ball in the gap behind the tooth), arrowhead (arrows in the cheek-side embrasures
   on both sides of each tooth, joined by a running wire; neighbouring teeth share an arrow) */
function rxrClaspShapes(teeth) {
  const out = [], stroke = (d, w) => out.push({ d, s: RX_METAL, w }), fill = (d, col, sc, w) => out.push({ d, f: col, s: sc || '', w: w || 0 });
  const dot = (p, r) => fill(RXP.circle(p[0], p[1], r), RX_METAL), ring = (p, r, w) => fill(RXP.circle(p[0], p[1], r), '#FFFFFF', RX_METAL, w || .8);
  const wire = (pts, w) => stroke(RXP.smooth(pts), w || 1.1);
  Object.keys(teeth).forEach(id => { const k = teeth[id]; if (!RXR_CLASPS.includes(k) || k === 'arrowhead') return; const t = rxT(id), r = t.r, mes = rxrNext(id, 1), dis = rxrNext(id, -1);
    if (k === 'adams' || k === 'delta') { const am = rxrB(id, .7, .62 * r), ad = rxrB(id, .7, -.62 * r), bm = rxrB(id, 2.7, .42 * r), bd = rxrB(id, 2.7, -.42 * r);
      const pm = [rxrGap(id, mes, -1, 1.5), rxrMid(id, mes)], pd = dis ? [rxrMid(id, dis), rxrGap(id, dis, -1, 1.5)] : [rxrDi(id, .9), rxrL(id, 1.5, -.5 * r)];
      stroke(RXP.poly(pm.concat([am, bm, bd, ad], pd)), .9);
      if (k === 'adams') { ring(am, .85, .7); ring(ad, .85, .7); }
      else [[am, 1], [ad, -1]].forEach(([q, sg]) => { const tip = rxrB(id, -.2, sg * .62 * r), o1 = [q[0] + t.b[0] * 2.1 + t.m[0] * 1.7, q[1] + t.b[1] * 2.1 + t.m[1] * 1.7], o2 = [q[0] + t.b[0] * 2.1 - t.m[0] * 1.7, q[1] + t.b[1] * 2.1 - t.m[1] * 1.7];
        fill(RXP.poly([tip, o1, o2], true), '#FFFFFF', RX_METAL, .8); }); }
    else if (k === 'c' || k === 'solc') { const arc = [rxrB(id, .8, .62 * r), rxrB(id, 1.0, .2 * r), rxrB(id, 1.0, -.25 * r), rxrB(id, .8, -.62 * r)];
      wire((k === 'c' ? [rxrGap(id, mes, -1, 1.5), rxrMid(id, mes)] : []).concat(arc), .95); dot(arc[3], .75); if (k === 'solc') dot(arc[0], 1.35); }
    else { const nb = dis || mes, out2 = rxrGap(id, nb, 1, 1.0); stroke(RXP.poly([rxrGap(id, nb, -1, 1.4), rxrMid(id, nb), out2]), .9); dot(out2, 1.45); } // ball
  });
  // arrowheads: each run of neighbouring teeth along the arch is one clasp
  RXR_ARCH.forEach(A => { const seq = rxrSeq(A); let i = 0;
    while (i < seq.length) { if (teeth[seq[i]] !== 'arrowhead') { i++; continue; } let j = i; while (j + 1 < seq.length && teeth[seq[j + 1]] === 'arrowhead') j++;
      const run = seq.slice(i, j + 1), before = i > 0 ? seq[i - 1] : null, after = j + 1 < seq.length ? seq[j + 1] : null, ar = [];
      const arrow = (q, id) => { const tt = rxT(id); fill(RXP.poly([[q[0] + tt.b[0] * 2.6, q[1] + tt.b[1] * 2.6], [q[0] + tt.m[0] * 1.8, q[1] + tt.m[1] * 1.8], [q[0] - tt.b[0] * 1.6, q[1] - tt.b[1] * 1.6], [q[0] - tt.m[0] * 1.8, q[1] - tt.m[1] * 1.8]], true), '#FFFFFF', RX_METAL, .85); };
      // the end over a contact (or around the back of the last tooth)
      const end = (id, nb) => { const rr = rxT(id).r;
        if (nb) { const q = rxrGap(id, nb, 1, 1.2); stroke(RXP.poly([rxrGap(id, nb, -1, 1.4), rxrMid(id, nb), q]), .9); return q; }
        const q = rxrB(id, 1.2, -.78 * rr); stroke(RXP.poly([rxrL(id, 1.4, -.55 * rr), rxrDi(id, 1.0), q]), .9); return q; }; // (no neighbour: the back of a 7)
      const e0 = end(run[0], before), pts = [e0]; ar.push([e0, run[0]]);
      run.forEach((id, k) => { pts.push(rxrB(id, 1.5, 0)); if (k < run.length - 1) { const q = rxrGap(id, run[k + 1], 1, 1.2); pts.push(q); ar.push([q, id]); } });
      const en = end(run[run.length - 1], after); pts.push(en); ar.push([en, run[run.length - 1]]);
      wire(pts, .9); ar.forEach(([q, id]) => arrow(q, id)); i = j + 1; } });
  return out;
}

/* ---------- the form's circles and blanks ---------- */
/* teeth in Universal order (#1 → #32; the primary teeth's letters A → T after them) */
const rxrUni = l => /^#\d+$/.test(l) ? +l.slice(1) : 100 + l.charCodeAt(0);
const rxrByUni = f => (a, b) => rxrUni(f(a)) - rxrUni(f(b));
/* the clasps the form has no circle for, written out with their teeth: "Delta #3, #14; Arrowhead #12" */
function rxrWrittenLine(rx) { const t = rx.teeth || {}; return RXR_WRITTEN.map(k => { const ids = RXR_TEETH.filter(id => t[id] === k).sort(rxrByUni(rxrNum)); return ids.length ? (k === 'delta' ? 'Delta ' : 'Arrowhead ') + ids.map(rxrNum).join(', ') : ''; }).filter(Boolean).join('; '); }
/* the holding spurs with the way each faces: "#7 distal, #10 mesial" */
function rxrSpurLine(rx) { const t = rx.teeth || {}; return RXR_TEETH.filter(id => RXR_SPURS.includes(t[id])).sort(rxrByUni(rxrNum)).map(id => rxrNum(id) + (t[id] === 'spurM' ? ' mesial' : ' distal')).join(', '); }
function rxrFill(c, rx, put, box, circ) {
  if (rx.palate) box.add('palate.' + rx.palate);
  RXR_ARCH.forEach(A => { const d = rx['design' + A]; if (d) box.add('d.' + d + '.' + A); });
  (rx.reset || []).forEach(id => circ.push(['reset', id]));
  if (rx.resetHow) box.add('rh.' + rx.resetHow); if (rx.noStrip) box.add('noStrip');
  const teeth = rx.teeth || {}, on = (k, A) => Object.keys(teeth).filter(id => id[0] === A && teeth[id] === k);
  Object.keys(teeth).forEach(id => { if (RXR_CLASPS.includes(teeth[id]) && !RXR_WRITTEN.includes(teeth[id])) box.add('cl.' + teeth[id] + '.' + id[0]); });
  put('claspOther', [rxrWrittenLine(rx), rx.claspOther].filter(Boolean).join('; '), 'H', 9);
  RXR_ARCH.forEach(A => { (rx['acc' + A] || []).forEach(k => box.add('acc.' + k + '.' + A)); (rx['acr' + A] || []).forEach(k => box.add('acr.' + k + '.' + A)); });
  (rx.habit || []).forEach(k => box.add('habit.' + k));
  // the teeth tapped go on the line (Universal numbers), then what was typed: "#7 tip labially"
  const nums = k => RXR_ARCH.map(A => on(k, A)).flat().map(rxrNum).join(', ');
  const line = (k, typed) => [nums(k), typed].filter(Boolean).join(' ');
  // a line's words print only while its choice is ticked (unticking a spring keeps what was typed, off the form)
  const when = (g, v, s) => RXR_ARCH.some(A => (rx[g + A] || []).includes(v)) ? s : '';
  put('fingerTxt', when('acc', 'finger', line('finger', rx.fingerTxt)), 'H', 9); put('solderTxt', when('acc', 'solder', rx.solderTxt), 'H', 9); put('closingTxt', when('acc', 'closing', rx.closingTxt), 'H', 9);
  put('spursTxt', when('acc', 'spurs', [rxrSpurLine(rx), rx.spursTxt].filter(Boolean).join(' ')), 'H', 9); put('screwTxt', rx.screwTxt, 'H', 9); put('saddleTxt', when('acr', 'saddle', rx.saddleTxt), 'H', 9);
  // the pontic line: the shade first, then the teeth, so the required shade is never the part a short line cuts off (found 4 Oct 2026:
  // four pontics printed "#7, #8, #9, #10 shade …"); a line that still doesn't fit goes in full into the special instructions (rxFill)
  const pn = nums('pontic');
  put('ponticTxt', when('acr', 'pontic', rx.ponticTxt ? rx.ponticTxt + (pn ? ' (' + pn + ')' : '') : pn), 'H', 9);
  RXR_ARCH.forEach(A => { const col = rxrColor(c, rx, A); if (col) { box.add('acr.color.' + A); put('color' + A, col, 'H', 9); } });
  RXR_ARCH.forEach(A => { [['flr', 'flr'], ['flrPads', 'pads'], ['flrWire', 'wire'], ['ir', 'ir']].forEach(([k, b]) => { const v = rx[k + A]; if (v) box.add(b + '.' + v + '.' + A); }); });
}

/* ---------- a new Retainer Rx: Dr. A's usual retainer (when he's saved one), on the arches the case picked; the finger spring
   appliance starts as a flipper with a finger spring on the upper (change the arch if it's the lower) ---------- */
function rxrStart(c) { const d = rxDefaults(RX_RET); return rxCanon(rxrForCase(c, d ? JSON.parse(JSON.stringify(d)) : { form: RX_RET }, d)); }
/* Dr. A's usual (d) fitted to the case, for a new Rx and for "Start from our usual retainer" (found 4 Oct 2026: starting from the usual
   brought both arches back on an upper-only case, and a finger spring case started as two Hawleys with no finger spring) */
function rxrForCase(c, rx, d) {
  const apps = (c && c.appliances) || [], ar = (c && c.arches) || [], hawley = apps.includes(HAWLEY), finger = apps.includes('Finger spring with no labial bow');
  if (hawley && ar.length) RXR_ARCH.forEach(A => {
    if (ar.includes(A === 'U' ? 'Upper' : 'Lower')) { if (!rx['design' + A]) rx['design' + A] = (d && (d['design' + A] || d['design' + (A === 'U' ? 'L' : 'U')])) || 'hawley'; return; }
    rxrClearArch(rx, A); // an arch the case doesn't make a Hawley for
  });
  // the finger spring on its own is a flipper, not the usual Hawleys
  if (finger && !hawley) RXR_ARCH.forEach(A => { if (rx['design' + A] && rx['design' + A] !== 'flipper') rxrClearArch(rx, A); });
  if (finger && !rx.designU && !rx.designL) { rx.designU = 'flipper'; rx.accU = (rx.accU || []).concat(['finger']); }
  RXR_ARCH.forEach(A => rxrStdClasps(rx, A, ''));
  return rx;
}
/* an arch with no Hawley (or spring design): none of the removable parts on it — a bonded or clear retainer there stays */
function rxrClearArch(rx, A) {
  ['design', 'acc', 'acr', 'color'].forEach(k => delete rx[k + A]);
  rx.teeth = Object.fromEntries(Object.entries(rx.teeth || {}).filter(([id]) => id[0] !== A)); rx.reset = (rx.reset || []).filter(id => id[0] !== A);
}
/* the case's Hawley arches against the Rx, said on the form and the case (found 4 Oct 2026: a case changed to upper only still sent
   both arches, with no warning — the Metal Rx already says when it no longer matches its case) */
function rxrMismatch(c, rx) {
  if (!((c && c.appliances) || []).includes(HAWLEY)) return '';
  const want = ((c && c.arches) || []).map(x => x === 'Upper' ? 'U' : x === 'Lower' ? 'L' : '').filter(Boolean); if (!want.length) return '';
  const w = list => list.map(rxrArchWord).join(' & ');
  const extra = RXR_ARCH.filter(A => rx['design' + A] && rx['design' + A] !== 'flipper' && !want.includes(A)), miss = RXR_ARCH.filter(A => want.includes(A) && !rx['design' + A]);
  if (extra.length) return 'This Retainer Rx has a ' + w(extra) + ' retainer, but the case’s Hawley is ' + w(want) + ' only — edit the Rx or the case.';
  if (miss.length) return 'No ' + w(miss) + ' retainer on this Rx yet — the case’s Hawley is ' + w(want) + (want.length === 1 ? ' only' : '') + '.';
  return '';
}
/* the clasps a design starts with, on the first molars: Dr. A's Adams on a Hawley (Amir, 4 Oct 2026 — Preferred, from his Lab Rx);
   none on a wraparound (its bow keeps wire out of the bite); Specialty's own C-clasps on the Specialty Wrap. A design picked on an
   arch with no clasps yet brings them; when the arch's clasps are just the old design's, they go with it */
const RXR_FAMILY = d => !d ? '' : ['wrap', 'flatWrap', 'tremont'].includes(d) ? 'wrap' : d === 'specWrap' ? 'spec' : 'hawley';
const RXR_DEF = d => ({ hawley: 'adams', spec: 'c' })[RXR_FAMILY(d)] || '';
function rxrStdClasps(rx, A, prev) {
  const t = rx.teeth = Object.assign({}, rx.teeth), inArch = id => id[0] === A && RXR_CLASPS.includes(t[id]);
  const was = prev && RXR_DEF(prev), clasps = Object.keys(t).filter(inArch);
  if (was && clasps.length === 2 && clasps.every(id => t[id] === was && id[2] === '6')) clasps.forEach(id => delete t[id]);
  const std = RXR_DEF(rx['design' + A]);
  if (std && !Object.keys(t).some(inArch)) ['R6', 'L6'].forEach(s => { if (!t[A + s]) t[A + s] = std; });
}
/* Dr. A's take on each clasp for the design (Amir, 4 Oct 2026, from his Lab Rx): [badge, why] */
const RXR_WRAP_NO = 'The wraparound bow replaces molar clasps and keeps wire out of the occlusion.';
const RXR_GUIDE = {
  hawley: { adams: ['pref', 'Strongest grip on mature molars, and the bridge doubles as a removal handle.'], ball: ['opt', 'Extra retention between the premolars when you need it.'],
    c: ['alt', 'Simpler terminal-molar option where the buccal undercut is good.'], delta: ['alt', 'Holds its shape longer if the retainer goes in and out often.'],
    arrowhead: ['avoid', 'Wedges contacts open, the opposite of what a retainer should do.'] },
  wrap: { ball: ['opt', 'Optional extra retention. It does cross the occlusion.'], adams: ['avoid', RXR_WRAP_NO], delta: ['avoid', RXR_WRAP_NO], c: ['avoid', RXR_WRAP_NO],
    arrowhead: ['avoid', 'Wedges contacts open and crosses the occlusion.'] }
};
/* the design the clasps are judged for: the upper's, else the lower's */
const rxrGuideDesign = rx => rx.designU || rx.designL || '';
/* the arches the case makes a Hawley for (U / L), for a design tapped from the pictures with none picked yet */
const rxrCaseArches = c => { const a = ((c && c.arches) || []).map(x => x === 'Upper' ? 'U' : x === 'Lower' ? 'L' : '').filter(Boolean); return a.length ? a : ['U']; };

/* ---------- the editor's left side ---------- */
/* what the fixed or invisible retainers' section holds, for its heading when it's folded (they fold away until they're used,
   Amir 4 Oct 2026); empty: nothing picked there, and the section starts folded */
function rxrFoldSum(g, rx) {
  const parts = [];
  if (g === 'flr') RXR_ARCH.forEach(A => { const pl = rx['flr' + A], pads = rx['flrPads' + A], wi = rx['flrWire' + A]; if (!pl && !pads && !wi) return;
    parts.push(rxrArchWord(A) + ' ' + (pl ? RXR_SPAN[pl] : '(placement not picked)') + (pads ? ', ' + RXR_PADS_S[pads] : '') + (wi ? ', ' + ({ r028: 'round .028', braided: 'braided .016 × .022', solid: 'solid SS .016 × .022' }[wi] || rxrLbl(wi, ['wire'])) : '')); });
  if (g === 'ir') { const u = rx.irU, l = rx.irL, n = v => rxrLbl(v, ['ir']);
    if (u && u === l) parts.push(n(u) + ', upper & lower'); else { if (u) parts.push(n(u) + ', upper'); if (l) parts.push(n(l) + ', lower'); } }
  const s = parts.join(' · '); return s ? s[0].toUpperCase() + s.slice(1) : '';
}
const rxrInfoG = g => g === 'flrPads' || g === 'flrWire' ? 'flr' : g;
/* a row of the form: the option, its price, then Upper / Lower (as the paper's U and L circles) */
function rxrRow(g, v, label, tag, more, show, st) {
  return '<div class="rxUL" data-rxinfo="' + rxrInfoG(g) + ':' + v + '"><span class="rxULn">' + esc(label) + (st ? rxStBadge(st, v) : '') + (tag ? '<em>' + esc(tag) + '</em>' : '') + '</span>' +
    RXR_ARCH.map(A => '<button type="button" class="rxB rxU" data-rxg="' + g + A + '" data-v="' + v + '" aria-pressed="false" aria-label="' + esc(label) + ', ' + rxrArchWord(A) + '"><span>' + A + '</span></button>').join('') +
    (more ? '<div class="rxULx' + (show ? ' rxSub" data-show="' + show : '') + '">' + more + '</div>' : '') + '</div>';
}
const rxrHead = () => '<div class="rxULh"><span></span><span>Upper</span><span>Lower</span></div>';
/* Dr. A's Hawleys and clasps in pictures (Amir, 4 Oct 2026): [value, name, picture, badge group] */
const RXR_PICS_D = [['hawley', 'Hawley', 'hawley-standard'], ['clearbow', 'ClearBow Hawley', 'hawley-clear'], ['wrap', 'Standard Wraparound', 'hawley-wrap']];
const RXR_PICS_C = [['adams', 'Adams', 'clasp-adams', 'clasp'], ['ball', 'Ball', 'clasp-ball', 'clasp'], ['c', 'C-clasp', 'clasp-c', 'clasp'], ['delta', 'Delta', 'clasp-delta', 'clasp'], ['arrowhead', 'Arrowhead', 'clasp-arrowhead', 'clasp']];
const rxrTxt = (k, ph, n) => '<label class="rxF rxFw"><input data-rxf="' + k + '" type="text" maxlength="' + (n || 40) + '" placeholder="' + esc(ph) + '" aria-label="' + esc(ph) + '"></label>';
function rxrSecs(rx) {
  const tag = (k, unit) => rxTag(k, false, unit);
  const accTag = { finger: tag('finger', ' ea'), solder: tag('solSpring', ' ea') }, acrTag = { bowAcr: tag('acrBow'), abp: tag('abp'), pontic: tag('pontic', ' ea') };
  const P = rxPrices(), padTag = { compEach: P.comp4 != null && P.comp6 != null ? money(P.comp4) + '–' + money(P.comp6) : tag('comp6'), compDist: tag('compCusp'), meshEach: tag('mesh6'), meshDist: tag('meshCusp') };
  const irTag = v => /^g/.test(v) ? tag(v) + (P[v + 'd'] != null ? ' · ' + money(P[v + 'd']) + ' both' : '') : tag(RXR_IR_K[v]);
  const grid = RXR_ARCH.map(A => '<div class="rxRsRow"><span class="rxLbl">' + (A === 'U' ? 'Upper' : 'Lower') + '</span><span class="rxRsS">R</span>' +
    ['R3', 'R2', 'R1', 'L1', 'L2', 'L3'].map((s, i) => (i === 3 ? '<span class="rxRsBar"></span>' : '') + '<button type="button" class="rxB rxRs" data-rxg="reset" data-v="' + A + s + '" aria-pressed="false" aria-label="Reset ' + A + s + ' (' + rxrNum(A + s) + ')"><span>' + s[1] + '</span></button>').join('') + '<span class="rxRsS">L</span></div>').join('');
  return rxInfoSec('design', 'Retainer',
      rxPicCards('designPick', RXR_PICS_D, 'Dr. A’s Hawleys') +
      '<div class="rxBs"><span class="rxLbl">Design type</span>' + RXR_O.palate.map(([k, l]) => rxBtn('palate', k, l, rx.palate === k)).join('') + '<span class="small muted">the upper plate</span></div>' +
      rxrHead() + RXR_O.design.map(([k, l]) => rxrRow('design', k, l, rxrDesignTag(k))).join('') +
      '<div class="rxULs">Spring designs</div>' + RXR_O.spring.map(([k, l]) => rxrRow('design', k, l, rxrDesignTag(k))).join('')) +
    rxSec('Reset teeth per diagram', '<div class="rxReset">' + grid + '</div><div class="rxBs">' + RXR_O.resetHow.map(([k, l]) => rxBtn('resetHow', k, l, rx.resetHow === k)).join('') + rxBtn('flag', 'noStrip', 'Do Not Strip Teeth', rx.noStrip) + '</div>' +
      '<div class="small muted">Tap the numbers (or Reset over the arches, then the teeth). ' + esc(tag('reset')) + ' a tooth; part of a Spring Hawley.</div>') +
    rxInfoSec('clasp', 'Clasping', rxPicCards('claspPick', RXR_PICS_C, 'Dr. A’s clasps') +
      '<div class="small muted" style="margin-bottom:4px">Tap a clasp’s picture, then the teeth over the arches — or Upper / Lower to put it on the first molars (ball clasps behind the 5s, arrowheads on the 5s). Delta and arrowhead clasps aren’t circles on Specialty’s form, so they’re written out with their teeth.</div>' +
      rxrHead() + RXR_O.clasp.map(([k, l]) => rxrRow('clasp', k, l, tag(k === 'adams' ? 'adams' : k === 'solc' ? 'solC' : k === 'delta' ? 'delta' : 'clasp', '/pr'), '', '', 'clasp')).join('') +
      '<div class="rxRow">' + rxField('claspOther', 'Other clasping', 'text', ' maxlength="40"') + '</div><div class="rxTeeth small" id="rxTeethSum"></div>') +
    rxInfoSec('acc', 'Accessories', rxrHead() +
      rxrRow('acc', 'finger', 'Finger Spring', accTag.finger, rxrTxt('fingerTxt', 'which way (the tooth tapped goes on the line)'), 'acc:finger') +
      rxrRow('acc', 'solder', 'Soldered Spring', accTag.solder, rxrTxt('solderTxt', 'tooth and what it does'), 'acc:solder') +
      rxrRow('acc', 'closing', 'Closing Spring', tag('closing'), rxrTxt('closingTxt', 'which space'), 'acc:closing') +
      rxrRow('acc', 'spurs', 'Holding Spurs', tag('spurs'), rxrTxt('spursTxt', 'more about the spurs (teeth tapped go on the line)') + '<div class="small muted">Tap a tooth with Spur: facing distal; tap it again to face it mesial; a third tap takes it off.</div>', 'acc:spurs') +
      rxrRow('acc', 'helical', 'Helical Bow', tag('helical')) + rxrRow('acc', 'cuspHook', 'Soldered Cuspid Hook', tag('cuspHook')) +
      rxrRow('acc', 'habit', 'Habit', tag('habit'), RXR_O.habit.map(([k, l]) => rxBtn('habit', k, l, (rx.habit || []).includes(k))).join(''), 'acc:habit') +
      '<div class="rxUL" data-rxinfo="acc:screw"><span class="rxULn">Space Closing Screw <em>' + esc(tag('scScrew')) + '</em></span><div class="rxULx">' + rxrTxt('screwTxt', 'specify the screw') + '</div></div>') +
    rxInfoSec('acr', 'Acrylic', rxrHead() +
      RXR_O.acr.map(([k, l]) => rxrRow('acr', k, k === 'pontic' ? 'Pontic Shade' : l, acrTag[k] || tag(k), k === 'saddle' ? rxrTxt('saddleTxt', 'where') : k === 'pontic' ? rxShadeHTML('Tap the missing teeth with Pontic.') : '', 'acr:' + k)).join('') +
      '<div class="rxUL" data-rxinfo="acr:color"><span class="rxULn">Acrylic Color <em>Specialty’s color guide</em></span></div>' + rxAcrHTML()) +
    rxInfoSec('flr', 'Fixed lingual retainers (FLR)', '<div class="rxULs">Placement of retainer</div>' + rxrHead() + RXR_O.flr.map(([k, l]) => rxrRow('flr', k, l, '')).join('') +
      '<div class="rxULs">Placement of pads <span class="h5n">composite on each tooth if none is picked (Specialty’s standard)</span></div>' + RXR_O.pads.map(([k, l]) => rxrRow('flrPads', k, l, padTag[k])).join('') +
      '<div class="rxULs">Type of wire</div>' + RXR_O.wire.map(([k, l]) => rxrRow('flrWire', k, l, '')).join('') + '<div class="rxWarn small" id="rxFlrWarn" hidden></div>', '', !!rxrFoldSum('flr', rx)) +
    rxInfoSec('ir', 'Invisible retainers', rxrHead() + RXR_O.ir.map(([k, l]) => rxrRow('ir', k, l, irTag(k))).join('') + '<div class="rxWarn small" id="rxIrWarn" hidden></div>', '', !!rxrFoldSum('ir', rx));
}
function rxrTeethSum(rx) {
  const t = rx.teeth || {}, by = {}; Object.keys(t).forEach(id => { (by[t[id]] = by[t[id]] || []).push(id); });
  const parts = RXR_TOOTH.filter(k => by[k]).map(k => '<b>' + esc(RXR_TOOTH_L[k]) + ':</b> ' + esc(by[k].map(id => id + ' ' + rxrNum(id)).join(', ')));
  if ((rx.reset || []).length) parts.push('<b>Reset:</b> ' + esc(rx.reset.join(', ')));
  return parts.join(' · ') || '<span class="muted">Nothing on the teeth yet.</span>';
}
function rxrTap(id, rx, tool) {
  const A = id[0];
  if (tool === 'reset') {
    if (!RXR_RESET.includes(id)) { toast('Specialty’s reset diagram has the front teeth, 3 to 3'); return false; }
    const s = new Set(rx.reset || []); if (s.has(id)) s.delete(id); else s.add(id); rx.reset = RXR_RESET.filter(x => s.has(x)); if (rx.reset.length && rx.resetHow === 'none') rx.resetHow = ''; return true;
  }
  if (!RXR_TOOTH.includes(tool)) return false;
  const t = rx.teeth = Object.assign({}, rx.teeth), old = t[id];
  // a holding spur: facing distal, tapped again facing mesial, a third tap takes it off
  if (tool === 'spur' && old === 'spur') { t[id] = 'spurM'; return true; }
  if (tool === 'spur' && old === 'spurM') delete t[id];
  else if (old === tool) delete t[id];
  else t[id] = tool;
  // the last finger spring, spur or pontic on the arch gone — taken off, or another tool put on its tooth (found 4 Oct 2026: a pontic
  // swapped for an Adams stayed ticked and charged on the form, and the Rx still asked for its shade): its circle goes too
  if (old && old !== t[id]) rxrDropFlag(rx, A, old);
  return true;
}
/* an arch's circle for a finger spring, holding spur or pontic, once no tooth on that arch has one */
function rxrDropFlag(rx, A, k) {
  const fl = RXR_TOOTH_FLAG[k]; if (!fl) return;
  const same = RXR_SPURS.includes(k) ? RXR_SPURS : [k], t = rx.teeth || {};
  if (!Object.keys(t).some(x => x[0] === A && same.includes(t[x]))) rx[fl[0] + A] = (rx[fl[0] + A] || []).filter(v => v !== fl[1]);
}
/* Upper / Lower on a clasp row puts the clasps on the first molars (ball clasps behind the 5s) or takes that arch's off; on a
   finger spring, holding spur or pontic row it ticks the circle (tap the teeth too) or takes them off */
function rxrClick(g, v, on, rx) {
  if (g === 'designPick') { const ar = RXR_ARCH.filter(A => rx['design' + A]); (ar.length ? ar : rxrCaseArches(RXE.c)).forEach(A => { const prev = rx['design' + A]; rx['design' + A] = v; rxrStdClasps(rx, A, prev); }); return true; }
  if (g === 'claspPick') { RXE.tool = v; return true; }
  if (rxAcrClick(g, v, rx) || rxShadeClick(g, v, rx)) return true;
  const m = /^(clasp|acc|acr)([UL])$/.exec(g); if (!m) return false;
  const A = m[2], t = rx.teeth = Object.assign({}, rx.teeth), here = k => Object.keys(t).filter(id => id[0] === A && t[id] === k);
  if (m[1] === 'clasp') {
    if (!on) here(v).forEach(id => delete t[id]);
    // (a tooth with a pontic, finger spring or spur on it keeps it: only an empty tooth or another clasp takes this one)
    else { (v === 'ball' || v === 'arrowhead' ? ['R5', 'L5'] : ['R6', 'L6']).forEach(s => { if (!t[A + s] || RXR_CLASPS.includes(t[A + s])) t[A + s] = v; }); RXE.tool = v; }
    return true;
  }
  const kind = m[1] === 'acc' ? { finger: 'finger', spurs: 'spur' }[v] : v === 'pontic' ? 'pontic' : null; if (!kind) return false;
  const key = m[1] + A, s = new Set(rx[key] || []);
  if (on) { s.add(v); RXE.tool = kind; } else { s.delete(v); (kind === 'spur' ? here('spur').concat(here('spurM')) : here(kind)).forEach(id => delete t[id]); }
  rx[key] = Array.from(s); return true;
}
function rxrAfter(g, v, on, prev, rx) {
  // an arch's retainer taken off: its clasps, springs, spurs, pontics, resets, extras and color go with it, as on an arch the case
  // doesn't make a Hawley for (found 4 Oct 2026: they stayed ticked on the form and in the cost)
  if (g === 'designU' || g === 'designL') { if (rx[g]) rxrStdClasps(rx, g.slice(-1), prev); else rxrClearArch(rx, g.slice(-1)); }
  if (g === 'resetHow' && rx.resetHow === 'none') rx.reset = [];
  if (g === 'reset' && on && rx.resetHow === 'none') rx.resetHow = '';
}
/* IR Express: not with pontics, bonded retainers or bite planes, and digital scans only; mesh pads can't take braided wire (Specialty) */
function rxrWarn(w, rx, c) {
  const ir = $('#rxIrWarn', w), fl = $('#rxFlrWarn', w);
  if (ir) { const ex = RXR_ARCH.some(A => rx['ir' + A] === 'express'), why = [];
    if (ex) { if (RXR_ARCH.some(A => (rx['acr' + A] || []).includes('pontic'))) why.push('pontics');
      if (RXR_ARCH.some(A => rx['flr' + A])) why.push('a bonded retainer');
      if (RXR_ARCH.some(A => (rx['acr' + A] || []).some(k => k === 'abp' || k === 'pbp'))) why.push('bite planes'); }
    const analog = ex && !String(c.scanner || '').trim();
    ir.hidden = !why.length && !analog;
    ir.textContent = why.length ? 'IR Express doesn’t take cases with ' + why.join(', ') + ' (Specialty) — pick a single invisible retainer or Guardian instead.' : analog ? 'IR Express is for digital scans only — the case has no scanner picked.' : ''; }
  if (fl) { const bad = RXR_ARCH.some(A => /^mesh/.test(rx['flrPads' + A] || '') && rx['flrWire' + A] === 'braided');
    fl.hidden = !bad; fl.textContent = bad ? 'Specialty can’t use braided wire with mesh pads — pick .016 × .022 solid stainless steel (their standard) or composite pads.' : ''; }
}
RXK[RX_RET] = {
  form: RX_RET, key: 'ret', field: 'rxRet', ds: 'rxRet', title: 'Retainer Rx', usual: 'our usual retainer',
  saveDefTip: 'New Retainer Rx start from these choices and clasps (not this patient’s dates, resets, pontics, springs, colors, notes or drawings)',
  caseIntro: 'Specialty’s Retainer Rx, filled in from this case: tap the designs, clasps and extras (and the teeth), and it gives the PDF to upload with the scan, and the lab cost.',
  costEmpty: 'Pick the retainer for each arch — the prices add up here.',
  priceNote: 'A flat bow or ClearBow is the list’s labial wire added to the design; the standard Hawley’s (and the Specialty Wrap’s) first-molar C-clasps come with it; a Spring Hawley’s resets come with it.',
  prices: RXR_PRICES, appl: RXR_APPL,
  applies: c => !!c && c.type === 'appliance' && labName(c.lab) === LAB_SPEC && (c.appliances || []).some(a => RXR_APPL.includes(a)),
  scanners: [['itero', /itero/i], ['trios', /trios/i], ['medit', /medit/i], ['carestream', /carestream/i], ['3m', /\b3\s*m\b/i], ['sirona', /sirona|cerec|primescan/i]],
  canon: rxrCanon, summary: rxrSummary, estimate: rxrEstimate, auto: rxrAuto, fill: rxrFill, start: rxrStart, forCase: rxrForCase, mismatch: rxrMismatch,
  single: RXR_SINGLE, tools: ['adams', 'c', 'ball', 'solc', 'delta', 'arrowhead', 'pontic', 'finger', 'spur', 'reset'], tool0: 'adams', toolReset: true,
  defDrop: ['colorU', 'colorL', 'reset', 'resetHow', 'fingerTxt', 'solderTxt', 'closingTxt', 'spursTxt', 'screwTxt', 'saddleTxt', 'ponticTxt', 'claspOther'],
  // the usual retainer keeps its clasps, not this patient's pontics, finger springs or spurs (those stay on the Rx when starting from it)
  defClean: d => { d.teeth = Object.fromEntries(Object.entries(d.teeth || {}).filter(([, k]) => RXR_CLASPS.includes(k)));
    RXR_ARCH.forEach(A => { d['acc' + A] = (d['acc' + A] || []).filter(k => k !== 'finger' && k !== 'spurs'); d['acr' + A] = (d['acr' + A] || []).filter(k => k !== 'pontic'); }); },
  defKeep: (cur, next) => { const own = Object.entries(cur.teeth || {}).filter(([, k]) => !RXR_CLASPS.includes(k)); if (!own.length) return;
    next.teeth = Object.assign({}, next.teeth, Object.fromEntries(own)); },
  secHTML: rxrSecs, foldSum: rxrFoldSum, teethSum: rxrTeethSum, tap: rxrTap, tappable: () => true, click: rxrClick, after: rxrAfter, syncMore: rxrWarn,
  pressed: (g, v, rx) => /^clasp[UL]$/.test(g) ? Object.keys(rx.teeth || {}).some(id => id[0] === g.slice(-1) && rx.teeth[id] === v)
    : g === 'designPick' ? RXR_ARCH.some(A => rx['design' + A] === v) : g === 'claspPick' ? RXE.tool === v : rxAcrPressed(g, v, rx),
  // Dr. A's take on each clasp for the design; the pontic's shade is required; delta and arrowhead clasps and the spurs spelled out
  status: (g, v, rx) => g === 'clasp' ? (RXR_GUIDE[RXR_FAMILY(rxrGuideDesign(rx))] || {})[v] || null : null,
  stFor: rx => rxrDesignName(rxrGuideDesign(rx)) || 'retainer',
  needs: rx => RXR_ARCH.some(A => (rx['acr' + A] || []).includes('pontic')) && !rx.ponticTxt ? [['the pontic shade', 'ponticTxt']] : [],
  autoNotes: rx => { const t = rx.teeth || {}, ids = k => RXR_TEETH.filter(id => t[id] === k).sort(rxrByUni(rxrNum)), nums = a => a.map(rxrNum).join(', '), out = [];
    const d = ids('delta'); if (d.length) out.push('Delta clasps on ' + nums(d) + ' (no circle on the form): closed triangular loops in the MB and DB undercuts, bridge about 1 mm off the buccal.');
    const ah = ids('arrowhead'); if (ah.length) out.push('Arrowhead (Schwarz) clasps on ' + nums(ah) + ': arrows in the buccal embrasures on both sides, joined by a running buccal wire.');
    const sp = RXR_TEETH.filter(id => RXR_SPURS.includes(t[id])).sort(rxrByUni(rxrNum)); if (sp.length) out.push('Holding spurs: ' + sp.map(id => rxrNum(id) + ' facing ' + (t[id] === 'spurM' ? 'mesial' : 'distal')).join(', ') + ' (as drawn).');
    return out; },
  acrArches: rx => RXR_ARCH.filter(A => rx['design' + A]), colorOf: rxrColor,
  autoVal: { colorU: (c, rx) => rx.designU ? rxrCaseColor(c) : '', colorL: (c, rx) => rx.designL ? rxrCaseColor(c) : '' },
  toolsHTML: () => rxToolBtn('adams', 'Adams', 'Adams clasp on the tooth') + rxToolBtn('c', 'C-clasp', 'C-clasp on the tooth') + rxToolBtn('ball', 'Ball', 'Ball clasp behind the tooth') +
    rxToolBtn('solc', 'Soldered C', 'Soldered C-clasp on the tooth') + rxToolBtn('delta', 'Delta', 'Delta clasp on the tooth (written out on the form)') +
    rxToolBtn('arrowhead', 'Arrowhead', 'Arrowhead clasp: arrows in the embrasures on both sides of the tooth (written out on the form)') +
    rxToolBtn('pontic', 'Pontic', 'A pontic in the space') + rxToolBtn('finger', 'Finger spring', 'A finger spring on the tooth') +
    rxToolBtn('spur', 'Spur', 'A holding spur: tap once facing distal, twice facing mesial') + rxToolBtn('reset', 'Reset', 'Reset the tooth on the model (3 to 3)'),
  hint: tool => ({ adams: 'Tap the teeth that get an Adams clasp.', c: 'Tap the teeth that get a C-clasp.', ball: 'Tap the tooth in front of the gap: the ball goes between it and the tooth behind it.',
    solc: 'Tap the teeth that get a soldered C-clasp.', delta: 'Tap the teeth that get a delta clasp (written out with their numbers on the form).',
    arrowhead: 'Tap a tooth: arrows go in the embrasures on both sides of it. Tap the next tooth to run the clasp on.',
    pontic: 'Tap the missing teeth: each gets a pontic (and the shade is required).', finger: 'Tap the tooth the finger spring moves.',
    spur: 'Tap a tooth for a holding spur facing distal; tap it again to face it mesial; a third tap takes it off.', reset: 'Tap the front teeth (3 to 3) to reset on the model.' })[tool] || '',
  tip: (id, rx) => { const k = (rx.teeth || {})[id], r = (rx.reset || []).includes(id); return id + ' (' + rxrNum(id) + ')' + (k ? ': ' + RXR_TOOTH_L[k] : '') + (r ? (k ? ', ' : ': ') + 'reset' : ''); },
  subShow: (k, rx) => { const [g, v] = k.split(':'), txt = { finger: 'fingerTxt', solder: 'solderTxt', closing: 'closingTxt', spurs: 'spursTxt', saddle: 'saddleTxt', pontic: 'ponticTxt' }[v];
    return RXR_ARCH.some(A => (rx[g + A] || []).includes(v)) || !!(txt && rx[txt]) || (v === 'habit' && !!(rx.habit || []).length); },
  leadDays: rx => { const irs = RXR_ARCH.map(A => rx['ir' + A]).filter(Boolean); return irs.length && irs.every(v => v === 'express') && !RXR_ARCH.some(A => rx['design' + A] || rx['flr' + A]) ? 5 : 10; },
  info: RXR_INFO, src: RXR_SRC,
  infoKeys: g => ({ design: RXR_DESIGNS.concat(['horseshoe', 'full']), clasp: RXR_K('clasp'), acc: RXR_ACC.concat(['screw']), acr: RXR_ACR.concat(['color']),
    flr: RXR_K('flr').concat(RXR_K('pads'), RXR_K('wire')), ir: RXR_K('ir') })[g] || [],
  infoName: (g, v) => rxrLbl(v),
  infoTag: (g, v) => { const P = rxPrices();
    if (g === 'design') return RXR_BASE[v] ? rxrDesignTag(v) : '';
    if (g === 'clasp') return rxTag(v === 'adams' ? 'adams' : v === 'solc' ? 'solC' : v === 'delta' ? 'delta' : 'clasp', false, '/pr');
    if (g === 'acc') return { finger: rxTag('finger', false, ' ea'), solder: rxTag('solSpring', false, ' ea'), screw: rxTag('scScrew') }[v] || rxTag(v);
    if (g === 'acr') return { bowAcr: rxTag('acrBow'), abp: rxTag('abp'), pontic: rxTag('pontic', false, ' ea'), color: 'free · glitter ' + rxTag('glitter') }[v] || rxTag(v);
    if (g === 'flr') return { compEach: P.comp4 != null && P.comp6 != null ? money(P.comp4) + '–' + money(P.comp6) : rxTag('comp6'), compDist: rxTag('compCusp'), meshEach: rxTag('mesh6'), meshDist: rxTag('meshCusp') }[v] || '';
    if (g === 'ir') return /^g/.test(v) ? rxTag(v) + (P[v + 'd'] != null ? ' · ' + money(P[v + 'd']) + ' both arches' : '') : rxTag(RXR_IR_K[v]);
    return ''; },
  infoSel: (g, rx) => { const first = k => (rx[k + 'U'] || [])[0] || (rx[k + 'L'] || [])[0] || '';
    if (g === 'design') return rx.designU || rx.designL || rx.palate || '';
    if (g === 'clasp') return RXR_CLASPS.find(k => Object.values(rx.teeth || {}).includes(k)) || '';
    if (g === 'acc') return first('acc'); if (g === 'acr') return first('acr');
    if (g === 'flr') return rx.flrPadsU || rx.flrPadsL || rx.flrU || rx.flrL || '';
    return rx.irU || rx.irL || ''; },
  infoOf: b => { const g = b.dataset.rxg, v = b.dataset.v; if (g === 'palate' || g === 'designPick') return ['design', v]; if (g === 'habit') return ['acc', 'habit']; if (g === 'claspPick') return ['clasp', v];
    if (g === 'acrPick' || g === 'acrFor') return ['acr', 'color']; if (g === 'ponticShade') return ['acr', 'pontic'];
    const m = /^(design|clasp|acc|acr|ir|flr|flrPads|flrWire)[UL]$/.exec(g); return m ? [rxrInfoG(m[1]), v] : null; },
  infoPrompt: g => ({ design: 'a design', clasp: 'a clasp', acc: 'an accessory', acr: 'an acrylic option', flr: 'an FLR option', ir: 'a clear retainer' })[g] || 'an option',
  cmpKeys: g => ({ design: RXR_DESIGNS, clasp: RXR_K('clasp'), flr: RXR_K('pads').concat(RXR_K('wire')), ir: RXR_K('ir') })[g] || null
};
