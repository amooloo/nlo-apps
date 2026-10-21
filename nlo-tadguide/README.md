# NLO TAD Guide (nlo-tadguide)

Puts the patient's intraoral scan onto their CBCT, finds and checks TAD sites between the roots, and makes a
printable tooth-borne surgical guide - the Blue Sky Plan steps for TADs, on an office PC. The CBCT and the scan
never leave the office, and no AI service is involved: the app is plain geometry and image measurements, and what
it learns from finished cases is a handful of numbers per case. Built like Tray Maker (same install, start, update
and autostart), on port **8767**, next to Tray Maker (8765) and the X-Ray Reader (8766) on the same PC.

## Everyday use (about 5 minutes)

1. **Export the CBCT** from CS 3D Imaging: open the volume, **Export Volume** (the skull with an arrow), a folder,
   matrix size and slice thickness **Same as source**, **CT (one file per slice)**, **Uncompressed**, *Create
   DICOMDir* off → **Export**. (The app also reads JPEG-lossless exports, multi-frame files and zips.) Export the
   **scan** of the arch the TADs go in, STL or PLY, from the AlliedStar or the iTero.
2. **Open TAD Guide** (NLO apps home page → TAD Guide) and drop the CBCT folder (or its zip) and the scan on the
   page - together or one after the other. Check the arch (taken from the file name when it says upper / lower),
   type the patient's name if the CBCT doesn't carry it, **Start**. A big export on the office share can be pasted
   as a path instead (*CBCT folder on the office share*): it is read where it is, not copied.
3. **Match.** The app finds the crowns in the CBCT and puts the scan's crowns on them by itself (10-30 s). The
   line above says how much of the scan's crowns lies within 0.5 mm of the CBCT crowns; the scan's teeth are
   coloured by how close they lie - green ≤ 0.2 mm, yellow ≤ 0.5, orange ≤ 1, red beyond - and the three slices
   under the 3D view show the scan's outline in coral on the CBCT (shift-click the model to move the slices
   there; scroll on a slice to move through it, drag to pan, double-click to come back; the picker on each panel
   chooses its view - axial / coronal / sagittal, or with a TAD selected along the TAD (roots / side) and across
   it; **6 views** shows all six at once, the anatomical ones through the TAD). **Measure** (above the 3D
   view) turns on a ruler: click two points on the model, or two points on any slice, and the distance in mm
   appears on the line - handy for checking the space around a TAD yourself; Esc stops, **Clear** removes them
   (slice measurements belong to the view they were made in and go faint when that slice is scrolled away).
   **Looks right** goes on. If it is off (*The match looks wrong*): **Match by 3 points** - the scan
   moves to the side; click a cusp tip on the scan, then the same spot on the CBCT teeth, three times, far apart
   (a molar each side and a central incisor) - then **Match with these points**; or **Fine adjust** (¼ mm and
   1 mm nudges, small turns, then *Let the surfaces settle it*).
   *CBCT levels* (bone / teeth) are set automatically from the scan's own histogram; change them only if the
   teeth outline in the slices is clearly too fat or too thin.
4. **TADs.** Pick the site and sides, **Find sites**: the gaps that suit the site (for buccal upper: 3/4 back to
   6/7) are tried, each with a search over position and angle, and ranked - with root clearance, cortical bone,
   soft tissue and bone along the thread, and a status (ok / caution / stop).
   **Use** places one; **Place by clicking** puts one where you click on the gum. Click a placed TAD to edit it:
   three slices along and across the screw (the red tint is what the app counted as root), mesial / distal,
   up / down, tilt, depth, which TAD (below) and its collar, **Fine-tune here** (the best spot within 1.5 mm
   and 8°), **Remove**. Or move it by hand in 3D: drag the orange ball at its head to slide it along the gum
   (angles kept), the blue ball at its tip to aim it (head kept); a ghost follows the pointer, on release it is
   re-placed and measured, and the slices follow. The selected TAD is drawn bold orange in the slices (the others
   thin and dim), and every slice carries direction words on its four edges in the same vocabulary as the buttons -
   mesial / distal, apical / occlusal, buccal / palatal, deeper / out (for a palate TAD forward / back, to suture /
   lateral): click an arrow to move the TAD half a millimetre that way (Shift: 1½ mm). **Mirror to other side**
   puts the same TAD on the other side - across the midpalatal suture for a palate TAD, across the arch otherwise. **Undo** (or Ctrl+Z) takes back the last placement, move, fine-tune or removal - and
   in the Match step the last nudge or re-match. Sites: buccal between roots (upper: 2/3 for anterior intrusion,
   3/4 to 6/7; lower 3/4, 4/5), palatal between roots, infrazygomatic crest, buccal shelf, paramedian palate.
   The 3D view shows the scan in natural colours (ivory teeth, pink gum), the CBCT roots in dentin yellow inside
   the faint bone; **See through** makes the scan and bone faint so the roots show; **Fit colours** is the match
   check (on while matching, off once accepted). The CBCT always catches part of the other jaw, and its crowns
   sit right in front of the roots - so everything beyond the bite plane on the other jaw's side (its teeth and
   bone) is hidden; **Opposing arch** brings it back. (The cut is the bite plane the app fits to the crowns, so
   with the teeth together the opposing cusps that touch yours may leave a sliver; a CBCT of one jaw only is
   left whole.)
5. **Guide.** **Make the guide** (10-30 s) and look at it in 3D with the TADs. Download the **Guide STL** (in the
   coordinates of the original scan file, so it lines up with the scan in any program), the **TADs STL** to
   check against, and **Plan / print** for the chart (site, size, angles, the numbers, the drilling notes and the
   **driver stop**: how far the sleeve top sits above the seated TAD head). **Open in PreForm** opens the guide
   in PreForm on the PC that runs the app. Print in Formlabs **Surgical Guide** resin and post-process it as
   Formlabs says for that resin - not the model resin. Try the guide on the model before the visit.
6. **Save & finish** files the case's lesson. After the visit, open the case and tap how the guide fitted -
   **on the teeth** and **driver in sleeve**: tight / good / loose. The next guides adjust (below).

**Delete case** removes a case and its files at once. Finished cases stay in the list until they are deleted
after the number of days in Settings (30 by default, counted from the last change).

## The TADs in the list

NLO uses Dentaurum **tomas-pins** and the Korean **MSE TADs** from Great Lakes, so those are what the app plans
with (the TAD card's list, the plan, the lessons):

| TAD | Thread | Collar | Notes | Default for |
| --- | --- | --- | --- | --- |
| tomas-pin SD 06 / 08 / 10 | 1.6 × 6 / 8 / 10 mm | 2.0 mm | cross-slot head (0.56 mm / .022), self-drilling; 2.5 mm hexagon for the driver | buccal between roots (SD 08) |
| tomas-pin EP 06 / 08 / 10 | 1.6 × 6 / 8 / 10 mm | 2.0 mm | mushroom head, for the palate | palatal between roots (EP 10) |
| MSE Type-2 TAD 1.8 × 9 / 11 / 13 | 1.8 × 9 / 11 / 13 mm | 2.0 mm (assumed) | BioMaterials Korea, sold by Great Lakes (11 and 13 mm); for the MSE | paramedian palate (11) |

The tomas numbers are from Dentaurum's instructions (collar 2.0 mm high, 2.8 mm wide; head 2.3 mm). On a tomas-pin
with 2 mm or more of cortex, the check adds Dentaurum's own step: pilot with the tomas-drill SD 1.1 (4 mm). The
MSE TAD's collar is not published: 2.0 mm is assumed - if yours differs, change the collar on the TAD card once
(the app learns it from there). *Other sizes* in the list are for the infrazygomatic crest (default 2.0 × 12)
and the buccal shelf (2.0 × 10), which want longer, thicker screws than the kit has. The list is `KIT` in
`tadguide/tads.py`.

## Where the sites come from

The site rules come from Dr. A's TAD course notes (the site ranking and success rates, the cortical-bone /
torque protocol, the soft-tissue rules, the lower 5/6 - 6/7 rule) and, for the placement geometry, from the
literature:

- **Paramedian palate:** 3 mm (3-6) beside the midpalatal suture, 3-4 mm (up to 6-9) distal to the incisive
  foramen - whose distal margin lies about at the canine / first-premolar contact line - so at the premolar level,
  posterior to the third rugae, perpendicular to the occlusal plane; the suture itself is thin and variable, the
  incisive canal is to be avoided (Ludwig et al., *Anatomical guidelines for miniscrew insertion: palatal sites*,
  JCO 2011; Wilmes et al., the *T-zone*, JCO). The app searches 3-4 mm paramedian between the 3/4 and 4/5 lines,
  never within 3 mm of the 3/4 line (the canal zone, a *stop*) and never on the suture (a *caution*). The suture
  itself is found in the CBCT, not assumed to be the dental midline: in coronal cuts through the hard palate from
  behind the canines to the first molars the app takes the axis of mirror symmetry of the palatal bone, moved to
  the nasal crest where one stands out, and fits a line through them (shown dashed blue in the slices; the TADs
  panel says how many cuts agreed and how far it sits from the dental midline). Palate distances, the suture
  caution and *Mirror to other side* all use that line; when it cannot be found the dental midline stands in.
- **Buccal between roots:** the "safe zones" - maxilla between the second premolar and first molar, between the
  premolars and canine / first premolar; mandible between the molars, the premolars and canine / first premolar;
  the interradicular bone widens apically, 6-11 mm from the alveolar crest, and 1 mm of clearance each side is the
  minimum (Poggio et al., *Angle Orthod* 2006; the CBCT studies that followed). The app's default depth is 13 mm
  from the occlusal plane in the upper and 12 in the lower (about 5-6 mm from the crest, around the mucogingival
  junction) and it searches 2 mm either way; 1.2-1.6 mm clearance is the ideal, under 1 mm a caution, under 0.5 a
  stop.
- **Infrazygomatic crest and buccal shelf:** the extra-alveolar sites from the course notes (IZC 60-70 degrees
  to the occlusal plane at the first-molar level; shelf parallel to the molar roots at the posterior half of the
  second molar). Their gum is usually beyond the scan, so the entry is estimated from the CBCT.

## What the numbers mean

From the TAD course notes:

| Check | Rule |
| --- | --- |
| Root clearance (thread to the nearest root) | under 0.5 mm: **stop** · under 1.0 mm: **caution** · 1.2-1.6 mm is the safe range in the literature |
| Cortical bone, measured along the screw | under 0.5 mm: do not insert (caution) · 0.5-1.5: no pre-drill · 1.5-2.5: perforate the cortex · over 2.5: perforate + pilot ~3 mm |
| Soft tissue at the entry | over 3 mm: fine not to seat the collar all the way, or a longer collar |
| Bone along the thread | under 75 % in bone: caution |
| Sinus / nasal cavity | thread in the sinus or nose: caution (stop beyond 2 mm); on the paramedian palate the tip reaching the nasal floor is noted as bicortical, more than 2 mm in the nose is a caution |
| Lower buccal | Dr. A's rule: no TADs at L5/6 or L6/7 (bone too thick) - flagged; lower buccal and shelf sites carry a reminder to check the mandibular canal / mental foramen on the slices |

**Roots are estimated from the grey values**, not traced. On a sharp CBCT (the CS 8200 at 0.15 mm) dentin
reads well above cortical bone, and a root is what lies at the tooth level deeper than the cortical plate - a
tight mask that stops at the PDL. On a soft or low-dose scan dentin is no brighter than the cortex; then a
half-way level and the ridge of the root wall are used and the mask runs a little fat (the lamina dura counts).
The app picks the first when it finds enough tooth-level tissue under the crowns. A piece counts as root when it
reaches a crown of the matched scan, or when it is rod-shaped *and* lies within 10 mm of the dental arch - so the
dense midline bone of the palate (the nasal crest), the mylohyoid ridge or the zygomatic buttress do not pass as
roots on shape alone. Either way the slices are what to trust: the red tint is exactly what was counted. Being *in bone* means inside the outer bone envelope - at
0.15 mm the marrow between the trabeculae reads as soft tissue, and would otherwise count as "no bone".

**Where the scan ends** (the vestibule above a buccal site, a palate scanned only in part, the IZC), the gum
surface is estimated from the CBCT: the bone along the same line plus the soft-tissue thickness measured where
the scan does reach (2 mm until then; 3 mm on the palate). Such a TAD carries the note *the gum surface here is
estimated* and the sleeve stands on that estimate - check it on the slices. A scanned gum is always preferred.

## The guide

- Tooth-borne: covers the crowns from two teeth in front of the first TAD to two behind the last (1-3 in the
  guide box), with the undercuts blocked out along the direction it goes on, so it seats and comes off.
- Fit: 0.10 mm gap on the teeth, 0.30 mm relief over the gum, 2.2 mm shell.
- Each TAD gets a sleeve: 3.2 mm hole, 1.6 mm wall, 4 mm tall, 0.5 mm off the gum. 3.2 mm passes the TADs
  (a tomas-pin's collar is 2.8 mm wide, its head 2.3 mm). For the driver to go down the sleeve as well, measure
  the tip of the driver you use (tomas applicator / driver, the MSE driver) and set the hole 0.2 mm wider than
  it - the guide box keeps it for the next guides. Then the sleeve guides the driver, and the **driver stop** in
  the plan says how far the sleeve top is above the seated head, so depth can be checked on the driver.
- When TADs on both sides cannot all be reached along one seating direction (brackets, a bulging crown in the
  way), it makes **one guide per side**, each with its own direction; the result line says so.
- The result line says whether it is watertight, in one piece (or one per side) and every sleeve hole clear,
  plus the driver stop. *Guide ready* when all of that holds, *Guide made - check it* when not.
- All of these numbers are in the guide box. They start from what the last guides needed: the fit reports move
  the fit gap and the hole size on their own.

## How it learns (numbers only)

| What | From | Used for |
| --- | --- | --- |
| The match (rotation from scan to CBCT) | each accepted case, per scanner and arch | tried first on the next scan from the same scanner - usually the first try is right |
| TAD habits | the TADs placed by clicking or moved / tilted / changed by hand, per site and arch (a suggestion used as it came is the app's own choice and doesn't count) | from the second one on, the site finder starts from their median depth and tilt and the TAD used most (tomas-pin SD 08, say) |
| Guide fit | the tight / good / loose reports | each *tight* on the teeth adds 0.03 mm to the fit gap, each *loose* takes 0.02 off; driver in sleeve: +0.10 / -0.05 mm on the hole |
| CBCT levels | only cases where the levels were changed by hand | the median change, per CBCT machine, added to each new scan's own automatic levels |

Each case's lesson is one small file in `training\` (`lesson_<date>_<id>.json`): the scanner and CBCT model,
the rotation, the levels, the TADs in arch terms (site, side, teeth, depth, angles, size, the check results), the
guide settings and the fit report. No names, no dates of birth, no images, no scans. Settings → *What it has
learned* shows what it is using. To start over, delete the `lesson_*.json` files.

## Patient data

- Everything runs on the PC that runs the app. Uploaded CBCTs and scans, and the guides made from them, are kept
  in `jobs\` in the app folder and deleted after the days set in Settings (30 by default). **Delete case**
  deletes them at once. A CBCT given as a path is read in place and not copied.
- The app answers this PC and the office network only (private addresses); anything else gets a refusal. No
  cloud, no AI service, no account. From home, use Jump Desktop (or any remote desktop) into an office PC.
- The browser page loads only its fonts (Google Fonts) and the "NLO Apps" button (`nlo-home.js` from the NLO
  apps site) from outside, like Tray Maker - neither gets anything from the app. three.js is served by the app.
- `training\` (lessons) and `settings.json` hold no patient information.

## Setup (once, on the PC that runs it)

1. Download the [nlo-apps](https://github.com/amooloo/nlo-apps) zip (green **Code** button → **Download ZIP**),
   **Extract All**, and put the `nlo-tadguide` folder somewhere permanent, e.g. `C:\NLO\nlo-tadguide`. The PC
   that runs Tray Maker is a good home: Python is already there.
2. Double-click `install.bat`. It finds Python 3.11-3.14 (or downloads the 3.13 installer: run it, **Install
   Now**, then install.bat again), installs the components (2-5 minutes) and asks whether to start the app at
   sign-in: **y**.
3. Double-click `start_app.bat` once. Allow Python through the firewall for **private networks** if Windows asks.
   The small black window "NLO TAD Guide" stays open; other office PCs open `http://NAME:8767` (NAME = this PC's
   name), or the TAD Guide card on the home page.

The home page card opens the app on the PC named **lab**. To use another PC from one browser: open
`nlo-tadguide.html?pc=NAME` once (or *Use a different PC in this browser* on `nlo-tadguide.html?help`).
**PreForm**: found in its usual folders; otherwise set its path in Settings.

## Updating

In the app: **Settings → Check for updates → Update now** (on the lab PC, or from any office PC - the lab PC
does the work). The app restarts in about a minute and the page comes back by itself. Or double-click
`update.bat` in the app folder (some PCs block .bat files - then it is simply not there), or press Win + R and run:

```
powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-tadguide/update.ps1' -UseBasicParsing).Content"
```

All three download the newest version from GitHub (the app's own files only), keep `settings.json`, `jobs\` and
`training\`, update the components and restart the app ("UPDATE DONE"). `uninstall_autostart.bat` stops the start at sign-in.

**Moving to another PC:** set it up there, then copy `training\` and `settings.json` over. Cases in `jobs\` can
stay behind (they are deleted after 30 days anyway).

## If something goes wrong

- *"None of the files is a DICOM image"*: the export was a CS project (CSI) file or a screenshot set - export
  again with **Export Volume** as above.
- *"That is a 2D image, not a CBCT volume"*: a pan or a single slice was exported.
- The match stays red / orange: **Match by 3 points**. Brackets, big restorations or a scan with gaps can pull
  the automatic match; the 3-point match plus *Let the surfaces settle it* fixes most.
- *"Too little of the scan landed on CBCT teeth"*: wrong arch (check upper / lower) or the CBCT doesn't contain
  that arch's crowns.
- PreForm doesn't open: it opens on the PC that runs the app only; elsewhere download the STL.
- Anything else: the **Log** at the bottom of the case, and the black window, say what happened - send a photo
  of them (no patient files) to Dr. Akhavan.

## Technical notes

Python (FastAPI + uvicorn) on port 8767, browser UI with three.js (vendored). Heavy steps use half the cores and
the process runs below normal priority, like Tray Maker.

- `tadguide/dicomio.py` - DICOM folder / zip / multi-frame reader (pydicom + pylibjpeg for JPEG-lossless,
  JPEG 2000 and RLE), picks the CBCT series by size, sorts slices by position, builds the voxel → mm (LPS) map,
  refuses 2D images with a plain message. Zips inside the dropped folder are opened (capped at 6 GB unpacked).
- `tadguide/volume.py` - automatic levels: the values below the 99.9th percentile are split air | soft | hard by
  a 3-class Otsu, the hard part bone | dentin | enamel by another; metal is the tail above (brackets, bands and
  wires run up to 32767 on the CS 8200 and, left in, pushed every threshold one class too high - the first real
  case saw only metal). On a CS 8200 in HU-like units the known profile then applies (air -500, bone 700,
  teeth 1500, enamel 2500, metal 4500). Also the downsampled display volume, marching-cubes surfaces and the
  dentition finder (enamel-dense clusters, split across the fitted bite plane).
- `tadguide/register.py` - crowns to crowns. On the scan: the crowns by colour (a PLY: teeth pale, gum pink -
  each scan sets its own split), or the band nearest the occlusal end (STL). In the CBCT: the tooth-level surface
  only within 3.5 mm of that arch's enamel and nearer to it than to the other arch - no bone for the palate and
  gum to stick to, no opposing crowns. The crown plane of each side is fitted (the CBCT's per arch, from its
  enamel - a head pitched or rolled 20° in the CBCT is normal), 96 starting poses (every 15° around it, both ways
  up, the surface normals both ways) plus the learned ones, normal-compatible trimmed point-to-plane ICP, the
  best four refined, the winner the one with the most of its crowns on the CBCT crowns. The score shown is that
  share: points with no CBCT crown near count as off, so a scan resting on the wrong structure cannot score
  well (*good* ≥ 60 % within 0.5 mm and median ≤ 0.25 mm; *looks wrong* under 45 % within 1 mm). 3-point
  (Kabsch) match + surface refinement as the fallback. Tooth vs gum for the TAD steps: whether the CBCT under the
  scan surface is tooth-dense.
- `volume.find_dentition` - the crowns: the densest cluster of enamel-level voxels (metal out), split into upper
  and lower across the bite plane fitted to that enamel (not a horizontal cut - with the head tilted that would
  put the molars of one arch with the incisors of the other); each arch then gets its own plane.
- `tadguide/arch.py` - the arch curve in the occlusal plane, tooth contacts from dips in the crown height profile
  scaled by average tooth widths, so each spot along the arch has a name (UR 5/6).
- `tadguide/tads.py` - sites (default depth below the occlusal plane, tilt, screw size, which gaps), placement
  from the gum surface, measurements along the screw (root distance from a root mask built per region:
  dentin-bright cores ≥ 1.5 mm inside the outer bone envelope, grown 0.8 mm, plus local-contrast ridges, kept
  near the crowns or when elongated; cortical thickness as the width at half maximum of the first bright band
  along the axis; soft tissue to the bone surface; bone fraction; air), the rules above, ranking, fine-tune.
- `tadguide/guide.py` - the guide as a signed-distance field on a 0.2 mm grid in the seating frame: undercut
  block-out by height map, offset shell, spike levelling, sleeves, struts, holes, gum clearance; marching cubes;
  the seating direction searched for hidden sleeves (one guide per side when needed); written in scan-file
  coordinates.
- `tadguide/lessons.py` - the lessons (above). `tadguide/render.py` - the slice images.
- `app/server.py` - the API, cases in `jobs\<id>\`, office-network-only middleware, retention clean-up;
  `app/static/index.html` - the page.

Tests (`tools/`): `make_phantom.py` builds a synthetic CBCT of both jaws - bone, cortex, teeth with roots,
sinus and nose, soft tissue, brackets if asked - as a DICOM export (plain or JPEG-lossless), plus a scan of one
arch (crowns, gum and palate) moved by a known offset. `test_dicom.py` (reader cases), `test_register.py`,
`test_sites.py`, `test_guide.py` and `test_api.py` (the whole flow through the API, the 3-point rescue included)
run on it, and `test_register_hard.py` with the head tilted up to 25° in the CBCT, coloured and plain scans and
flipped normals. On the phantom the automatic match lands within about 0.15 mm of the truth; a match knocked
6 mm / 15° off comes back to that from 3 clicked points. The same with the head tilted 14-20° on a public,
de-identified dental CBCT with brackets (and a scan cut from it): 0.12-0.19 mm.

The first real case (10/20/2026, a CS 8200 export at 0.15 mm and AlliedStar PLY scans of both arches) matched
wrongly with the first version, which still scored it 95 %. The cause was the level finder: the metal tail of the
histogram pushed every threshold one class up, so the app matched against brackets and bone instead of teeth.
With that fixed (and crowns-to-crowns matching, the bite-plane split, the honest score), both arches of that
case match at 0.09-0.10 mm median, and the site finder, root mask, bone envelope, gum estimate and guide were
all adjusted on it: upper buccal 4/5 and 5/6 come out ok with 1.0-1.5 mm root clearance, palatal 5/6 ok, the
paramedian palate ok, lower buccal 4/5 caution at 0.6 mm (tight roots), and both guides build watertight. The
case's files were used for this only and are not in the repo.
