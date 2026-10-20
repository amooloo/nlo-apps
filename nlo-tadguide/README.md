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
3. **Match.** The app finds the teeth in the CBCT and puts the scan on them by itself (10-30 s). The scan's teeth
   are coloured by how close they lie to the CBCT teeth - green ≤ 0.2 mm, yellow ≤ 0.5, orange ≤ 1, red beyond -
   and the three slices under the 3D view show the scan's outline in coral on the CBCT (shift-click the model to
   move the slices there). **Looks right** goes on. If it is off: **Match again**; **Fine adjust** (¼ mm and 1 mm
   nudges, small turns, then *Let the surfaces settle it*); or **Match by 3 points** - click a cusp tip on the
   scan, then the same spot on the CBCT teeth, three times, far apart (a molar each side and an incisor).
   *CBCT levels* (bone / teeth) are set automatically from the scan's own histogram; change them only if the
   teeth outline in the slices is clearly too fat or too thin.
4. **TADs.** Pick the site and sides, **Find sites**: the gaps that suit the site (for buccal upper: 3/4 back to
   6/7) are tried, each with a search over position and angle, and ranked - with root clearance, cortical bone,
   soft tissue and bone along the thread, and a status (ok / caution / stop).
   **Use** places one; **Place by clicking** puts one where you click on the gum. Click a placed TAD to edit it:
   three slices along and across the screw (the red tint is what the app counted as root), mesial / distal,
   up / down, tilt, depth, size, **Fine-tune here** (the best spot within 1.5 mm and 8°), **Remove**.
   Sites: buccal between roots (upper and lower), palatal between roots, infrazygomatic crest, buccal shelf,
   paramedian palate.
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

**Roots are estimated from the grey values**, not traced: dentin-dense tissue that stands out from what is
around it and lies deeper than the cortical plate, kept when it connects to a crown or is root-shaped. It leans
toward calling something a root (a dense trabecular pattern, a lamina dura can count), so in a crowded mouth many
buccal sites come out caution / stop. The slices are what to trust: they show exactly what was counted.

## The guide

- Tooth-borne: covers the crowns from two teeth in front of the first TAD to two behind the last (1-3 in the
  guide box), with the undercuts blocked out along the direction it goes on, so it seats and comes off.
- Fit: 0.10 mm gap on the teeth, 0.30 mm relief over the gum, 2.2 mm shell.
- Each TAD gets a sleeve: 3.2 mm hole (passes the TAD head and the driver tip), 1.6 mm wall, 4 mm tall, 0.5 mm
  off the gum. The sleeve guides the driver; the **driver stop** in the plan says how far the sleeve top is above
  the seated head, so depth can be checked on the driver.
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
| TAD habits | the TADs placed by clicking or moved / tilted / resized by hand, per site and arch (a suggestion used as it came is the app's own choice and doesn't count) | from the second one on, the site finder starts from their median depth and tilt and the most used screw size |
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

Double-click `update.bat` in the app folder, or press Win + R and run:

```
powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-tadguide/update.ps1' -UseBasicParsing).Content"
```

It downloads the newest version from GitHub, keeps `settings.json`, `jobs\` and `training\`, updates the
components and restarts the app ("UPDATE DONE"). `uninstall_autostart.bat` stops the start at sign-in.

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
- `tadguide/volume.py` - automatic levels (multi-Otsu on the head; CS 8200 values used only when the scan is
  HU-like), downsampled display volume, marching-cubes surfaces, the dentition finder (enamel-dense clusters).
- `tadguide/register.py` - the scan's crown band and occlusal axis; 36 starting poses (18 turns × the two ways
  up) plus the learned ones; normal-compatible, trimmed point-to-plane ICP against the CBCT tooth surface; then
  the fit map. *good* = ≥ 85 % of the tooth surface within 0.5 mm and median ≤ 0.2 mm; *check* ≥ 60 %.
  3-point (Kabsch) match + refine as the fallback. Tooth vs gum on the scan: whether the CBCT under the surface
  is tooth-dense.
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
arch (crowns and gum) moved by a known offset. `test_dicom.py` (reader
cases), `test_register.py`, `test_sites.py`, `test_guide.py`, `test_api.py` (the whole flow through the API)
run on it. On the phantom the automatic match lands within about 0.1 mm of the truth. It was also run on a
public, de-identified dental CBCT with brackets (and a scan cut from it). Not yet run on NLO's own CS 8200
exports and scans - the first real cases are the real test; check the slices.
