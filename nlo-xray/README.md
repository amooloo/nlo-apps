# NLO X-Ray Reader (nlo-xray)

Traces a lateral ceph and shows the measurements, the skeletal class, the vertical pattern and the CVM stage.
It learns to place the points itself from every tracing confirmed in this office. It runs on one office PC
and is opened from any office computer (NLO apps home page → **X-Ray Reader**). **The x-rays, the tracings
and what the app learns never leave that PC.**

Panoramic x-rays are next; this first version reads lateral cephs.

## Everyday use

1. **Export the ceph** from the imaging software. **DICOM is best**: it carries the patient's name, birth date,
   sex, the x-ray date and the pixel size. A JPG / PNG / TIFF export works too (then the details are typed, and
   millimetre measurements need the pixel size once - see *Calibration*).
2. **Drop it on the page** (or **+ New x-ray**). Several at once is fine. A box asks you to check the patient,
   x-ray date, date of birth (for the age at the x-ray) and sex (for the Wits norm). The same file dropped twice
   opens the first one.
3. **Trace.**
   - *Until the app has learned* (fewer than ~15 confirmed tracings): click **Sella**, **Nasion** and **Menton**.
     Every other point appears roughly in place - where your own average tracing puts it once there are a few -
     and the app walks you through them one by one, zoomed in, with the definition and a small map of where to
     look. **Click where the point belongs** (that places it and moves on), or press **Enter** when it is
     already right.
   - *Once the app has learned*: all the points are placed when the x-ray opens. Walk through them the same way;
     a point the app is unsure about has an **orange ring**.
   - Hollow dots are not checked yet, filled dots are. **Drag** any dot to move it. **Backspace** goes back a
     point, the arrow keys nudge the current one, **Ctrl Z** undoes, **F** fits the x-ray, the mouse wheel zooms,
     dragging empty space moves around. The group chips (Cranial base, Maxilla, ...) jump to that group.
   - **Skip soft tissue** or **Skip vertebrae (adult)** when they are not needed.
4. **Read it.** The *Summary* gives the skeletal class (ANB and Wits; when they disagree it says *Borderline* and
   which says what), the vertical pattern (FMA and SN-GoGn), the jaws, the incisors, the lips to the E-line and
   the CVM stage with what it means for growth timing. *Measurements* lists every value against its norm: amber
   more than 1 SD off, coral more than 2 SD.
   **Growth (CVM)** reads the vertebrae three ways, the way the CVM phone apps do - but from the tracing:
   - **Baccetti et al. (2005)**: CS1-CS6 and where the patient sits relative to the peak in mandibular growth
     (a timeline with the stage marked);
   - **Hassel & Farman (1995)**: CVMI 1-6 (Initiation ... Completion) and the share of adolescent growth still to
     come (80-100 %, 65-85 %, 25-65 %, 10-25 %, 5-10 %, little or none);
   - **Mito et al. (2002)**: the cervical vertebral bone age from the C3 and C4 proportions, next to the age at
     the x-ray (the formula was derived for girls; the app says so for boys).
   Below them are the five things the stages rest on, as pictures: the lower border of C2, C3 and C4 (flat or
   concave) and the C3 and C4 bodies (trapezoid, rectangular horizontal, square, rectangular vertical), with the
   app's reading highlighted. **Click a picture to overrule it** for this x-ray - it is marked *you*, every
   method follows it, and *back to the app's reading* undoes it. The small picture of this x-ray's C2-C4 (with
   the tracing) zooms the viewer onto the vertebrae when clicked.
5. **Confirm tracing.** It becomes a lesson for the app, and the five CVM judgements as shown (your picks and
   the readings you let stand) become lessons for its flat / concave and shape readings. **Print** gives a
   one-page report (tracing, summary with all three CVM methods, the stage drawing and timeline,
   measurements). **A confirmed tracing can still be corrected**: click a point, then click where it belongs (or
   drag it) - it is saved at once, the tracing stays confirmed and the app learns from the correction (**Esc**
   leaves the point as it is). Clicking a CVM picture works the same way. **Reopen** walks through it again.

### Calibration (millimetres)

Angles and ratios need nothing. Millimetre values (Wits, incisors to NA / NB, lips to the E-line, lengths)
need the size of a pixel at the patient's midline:

- **Every x-ray: the nasion-rod ruler.** The app finds the marks on the nasion rod and takes the pixel size from
  their spacing - the rod rests on nasion, so that is the size at the midline, magnification included. The marks
  it used are circled on the x-ray. Settings → Calibration holds the distance between two neighbouring marks:
  **10 mm** on this office's cephs. That was measured, not assumed: on a 12.8-year-old, 5 mm would make S-N 32 mm
  and N-Me 54 mm; 10 mm gives 64.9 and 107.2 mm, as iOrtho measured them (65.1, 107.5). A pixel size set by hand
  with **Ruler** is never replaced. When the rod is not found, the sources below apply.
- **DICOM**: taken from the file. When the file gives the pixel size at the detector only, it is divided by the
  ceph magnification - the file's own figure when it has one, else Settings → Calibration (1.13, Carestream's
  figure for the CS 8200 ceph arm). The case shows where its number came from.
- **JPG / PNG / TIFF**: once, on any x-ray, click **Ruler**, click the two ends of a known length (10 mm on the
  nasion-rod ruler), type the length and tick *use for every exported x-ray*. Export the same way every time.
- **Imported from iOrtho**: iOrtho's own scale (from its S-N length), unless the x-ray already has a pixel size;
  when the two differ by more than 3 % the import says so.
- **A check on all of them**: when S-N comes out outside 50-90 mm, the pixel-size badge turns amber and says so
  (a wrong mark spacing or magnification shows up at once).

### Cephs already traced in iOrtho

An iOrtho tracing can be brought in instead of tracing the ceph again - the quickest way to the 15 confirmed
tracings the app needs before it learns.

1. **Have three files per patient**: the **original ceph** (the same DICOM / JPG that went into iOrtho, without
   the tracing), **iOrtho's traced image** (with the red landmark dots) and **iOrtho's Excel report** (.xlsx;
   the PDF is not read). When the x-ray is already in the app, iOrtho's two files are enough: the app finds it by
   the patient's name (or birth date and x-ray date) and checks it by laying iOrtho's picture onto it.
2. **Import from iOrtho** (sidebar) and drop the files - together or one after another (the window keeps what
   has come until a patient's set is complete), or anywhere on the page. Several patients at once works when the
   file names carry the patient's name (iOrtho's report is `First_Last_Cephalometry_Report.xlsx`; a DICOM
   original carries the name inside). For an x-ray that is open, *Import iOrtho's tracing* in the Tracing card
   does the same for that x-ray.
3. What happens, all on this PC: the app finds the original x-ray inside iOrtho's picture (scale and position,
   to a fraction of a pixel; a picture of another x-ray is refused), finds iOrtho's red dots, and works out which
   dot is which landmark by **reproducing iOrtho's own numbers** from the report: SNA, SNB, SN-PP, U1-SN, U1-NA,
   L1-NB, interincisal, PP-FH, SN-GoGn, Y-axis, facial angle, FMA, MP-SN, IMPA, saddle and gonial angles, the
   incisors to NA / NB in mm, Po-NB, N-Me, both lips to the E-line, Sn-H and the occlusal plane to FH and SN. A
   point is *verified* when every number it takes part in matches. The first-premolar contact (PM) is in none of
   iOrtho's numbers - check it. The name, birth date, sex and x-ray date come from the report (the DICOM's own
   details are kept when there are any).
4. iOrtho does not trace the vertebrae, so an imported x-ray has **Skip vertebrae** ticked. For a growing patient
   untick it and place the vertebra points - they are what the CVM stage reads.
5. Open each one, walk through the points (**Enter** where right - imported points say *From iOrtho*) and
   **Confirm tracing**. *Confirm them right away* in the import window confirms on import instead: only for
   tracings already checked in iOrtho, and only when everything but PM matched. Importing an x-ray that is
   already confirmed here leaves it as it is, with a link to **replace it with iOrtho's tracing** (for a tracing
   changed in iOrtho since).

## How it learns

- **Your average tracing.** Each confirmed tracing updates the average shape the first points are placed from,
  so new x-rays start closer to where you put the points.
- **The landmark network.** After **15 confirmed tracings** the app trains a small neural network on this PC,
  from scratch, only on this office's tracings - no outside data, no pre-trained models, nothing downloaded.
  It learns in the evening (default 7 pm - 1 am, so it never overlaps Tray Maker's 1-5 am round on the same PC)
  when there are new confirmed tracings and nobody has used the app for 15 minutes, using half the processor
  at low priority. Settings → Learning → **Learn now** runs it on the spot.
- **It only switches when it is better.** A fifth of the confirmed tracings (at least 3) are held back and
  never learned from; the new network is checked on them. The first network is used only if its average error
  there is under 4 mm; every later one only if it beats the network in use on the same held-back x-rays.
  Settings → Learning shows the average error, the share of points within 2 mm, the error of every point, and
  **Go back to the previous network** (the last three are kept).
- **Your CVM eye.** The flat / concave and shape judgements on confirmed tracings (your picks and the readings
  you let stand) tune the CVM thresholds - how deep a border must dip to count as concave, and where a body
  turns trapezoid / square / vertical - but only once there are 8 such x-rays and only if the tuned thresholds
  agree with you more often than the defaults when each x-ray is left out in turn.
- **A faster start:** import cephs already traced in iOrtho, or trace a batch of old cephs from your records.
  Every one you confirm counts.

It is a tracing aid: it shows its tracing so every point and every call can be checked, and the clinical
judgement stays the doctor's.

## Private by design

- The x-rays, tracings and notes are kept in the app folder (`cases\`), the trained networks in `models\`, the
  settings in `settings.json` - on the PC that runs the app. Nothing is uploaded, synced or shared.
- The app makes no internet connections. Every page it serves carries a Content-Security-Policy that lets the
  browser load and send things only to this app - so not even a font, a script or a picture comes from outside
  (the fonts ship with the app). For that reason this app's page does not carry the NLO Apps button script or
  Ask AISA (both load from the internet); the sidebar has a plain link back to the home page instead.
- It is reachable from computers on the office network only; it has no address on the internet. **Settings →
  Passcode** (optional) asks each computer for an office passcode once (remembered 30 days) - worth setting if
  patients or guests can join the same Wi-Fi as the office computers.
- The only internet traffic is the update line, which downloads this app's program files from GitHub. No patient
  data goes the other way, and the repository never holds patient data (`cases\`, `models\` and the settings are
  ignored by git).
- Deleting an x-ray moves it to `cases\_deleted\` (nothing is erased by the app); remove it there for good.
- **Back up** the app folder (`cases\`, `models\`, `settings.json`) with the office's other backups: the tracings
  and the learned network exist only here.

## Install / update (on the PC that runs it)

Pick a PC that is on in the evening (it learns then) - the lab PC is fine. **Win + R**, paste this line, Enter:

```
powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-xray/setup.ps1' -UseBasicParsing).Content"
```

It puts the app in `C:\NLO\nlo-xray`, installs Python 3.13 for the signed-in user if the PC has none (no
administrator needed), installs the components (the first time a few minutes: the learning engine, PyTorch, is
about 125 MB), sets the app to start minimised at sign-in, adds a firewall rule for the office network when it
can, starts the app and opens it. It ends with the PC's name. **The same line updates the app later** - the
x-rays, tracings, networks and settings are kept. The version is at the bottom of the sidebar; a page already open
on another computer shows *The app was updated - Reload* by itself.

The NLO apps home page's **X-Ray Reader** button opens the PC named in `nlo-xray.html` (`DEFAULT_PC`, now `lab`)
on port 8766. If the app runs elsewhere, change that name, or once per browser open the page with `?help` and
use *Use a different PC*.

By hand instead: copy this `nlo-xray` folder to the PC, double-click `install.bat` (it finds or downloads
Python and installs the components), then `start_app.bat`. `uninstall_autostart.bat` stops the sign-in start.

**Moving it to another PC:** install it there with the line above, stop it (close its window), copy `cases\`,
`models\` and `settings.json` from the old PC's app folder into the new one, start it again, and run
`uninstall_autostart.bat` on the old PC. Then point `DEFAULT_PC` at the new PC.

---

## Technical notes

**Layout.**

```
nlo-xray\
  run_app.py            starts the web app (port 8766; --lan for the office network)
  app\server.py         FastAPI: cases, landmarks, analysis, learning, settings, passcode, security headers
  app\static\           the page (index.html, app.js, style.css), fonts, logo - all served locally
  xray\landmarks.py     the 38 landmarks, their definitions, tracing order and the textbook template
  xray\analysis.py      measurements, norms, the summary calls
  xray\cvm.py           CVM: Baccetti (2005), Hassel & Farman (1995), Mito (2002), the doctor's picks, tuning
  xray\imageio.py       DICOM / JPG / PNG / TIFF reading, pixel size, names and dates
  xray\store.py         one folder per x-ray under cases\
  xray\shape.py         the average tracing (Procrustes), anchors -> all points, filling in points
  xray\model.py         the landmark network
  xray\train.py         learning rounds, the held-back check, versions, the evening schedule
  xray\iortho.py        importing iOrtho tracings: the report, the dots, registration, naming the dots
  xray\ruler.py         the nasion-rod ruler: finding its marks, the pixel size
  tools\synth.py        synthetic 'cephs' for tests (no patient data anywhere in the repo)
  tests\iortho_fake.py  a made-up iOrtho export (traced picture + Excel report) built on a synthetic ceph
  tests\                python -m pytest tests
  setup.ps1             one-line install / update;  install.bat, start_app.bat, uninstall_autostart.bat
```

Data (git-ignored): `cases\<id>\case.json` + `original.*` + `image.png` + `thumb.jpg`, `models\current.pt`,
`models\prev_*.pt`, `models\status.json`, `models\train.log`, `settings.json`, `sessions.json`.
`NLO_XRAY_DATA` puts all of it in another folder.

**Landmarks (38), in tracing order.** Cranial base: S, N, Or, Po, Ar. Maxilla: PNS, ANS, A. Teeth: U1A (upper
incisor apex), U1T (tip), L1T, L1A, MOL (first-molar occlusal contact), PM (first-premolar contact).
Mandible: B, Pog, Gn, Me, Go, MPt (the lower-border point: where a line from menton touches the lower border in
front of the angle - added 20 Oct 2026; an x-ray traced before it gets it placed from the other points when
opened). Soft tissue: Prn, Sn, Ls, Li, Pos. Vertebrae: C2 lower border (back corner,
deepest point, front corner), C3 and C4 (upper back, upper front, lower back, lower deepest point, lower front).
The template (starting positions) is built from textbook norms for a ~12-year-old.

**Measurements** (all in a frame where the face looks to +X and up is +Y, so facing left or right gives the same
numbers). SNA, SNB, ANB (= SNA - SNB). Wits: A and B projected onto the functional occlusal plane (MOL→PM), AO - BO.
SN-FH; FMA (Po-Or to the mandibular plane); SN-GoGn (Steiner); palatal (ANS-PNS) to the mandibular plane;
gonial angle Ar-Go-Me; Jarabak S-Go / N-Me; lower face height ANS-Me / N-Me measured perpendicular to FH (Wylie).
U1-SN; U1-NA and L1-NB in degrees (signed, + = tipped ahead of the line) and mm (to the incisal tip, + = ahead);
IMPA (L1 to the mandibular plane); interincisal angle. The mandibular plane for FMA, IMPA and PP-MP is the
tangent to the lower border through menton (Me-MPt, Tweed / Downs); a tracing without MPt uses Go-Me and says
so. Checked 20 Oct 2026 against iOrtho (iCeph) on one of the office's cephs, using iOrtho's own landmark
positions: SNA, SNB, ANB, FMA, SN-GoGn, gonial angle, lower face height %, U1-SN, U1-NA (° and mm), L1-NB
(° and mm), IMPA, interincisal angle, both lips to the E-line and the S-N / N-Me / ANS-Me lengths all agree
within 0.05 (° / mm / %). Wits differs by design: this app projects A and B onto the functional occlusal plane
(molar to premolar contacts, Jacobson's original); iOrtho uses the plane through the molar and incisor overlaps
(0.2 mm apart on that ceph). Upper / lower lip to the
E-line (Prn-Pos, + = ahead). Lengths S-N, ANS-PNS, Go-Me, Ar-Go, N-Me, ANS-Me, S-Go.
Default norms (mean ± SD; Settings → Norms changes them): SNA 82±3, SNB 80±3, ANB 2±2, Wits −1±2 (male) /
0±2 (female), SN-FH 7±3, FMA 25±5, SN-GoGn 32±5, PP-MP 25±5, gonial 130±7, Jarabak 61.5±2 %, LAFH 55±2 %,
U1-SN 103±6, U1-NA 22±5° / 4±2 mm, L1-NB 25±5° / 4±2 mm, IMPA 90±5, interincisal 131±6, upper lip −4±2,
lower lip −2±2. Summary calls: Class II when ANB > 4°, Class III when < 0°; Wits Class II/III more than 2 mm
from its norm; high angle FMA > 30° or SN-GoGn > 37°, low angle FMA < 20° or SN-GoGn < 27°.

**CVM** (`xray/cvm.py`). The five judgements: a lower border is concave when its deepest point lies at least
6 % of the border's length above the line joining its corners (≈1 mm on a 15 mm body); a C3/C4 body is
trapezoid when front height / back height < 0.80 (heights from each upper corner to the line through the lower
corners), else height / width < 0.90 rectangular horizontal, 0.90-1.10 square, > 1.10 rectangular vertical. The
doctor's picks (`case.cvm.marks`) replace any of them. *Baccetti, Franchi & McNamara (2005)*: CS1 no
concavities; CS2 C2; CS3 C2+C3; CS4 all three with rectangular-horizontal bodies; CS5 at least one square; CS6 at
least one rectangular vertical. *Hassel & Farman (1995)*: CVMI 1 Initiation (80-100 % of adolescent growth to
come), 2 Acceleration (65-85 %), 3 Transition (25-65 %), 4 Deceleration (10-25 %), 5 Maturation (5-10 %),
6 Completion (little or none) - read from the same judgements, so the CVMI number steps with the CS number.
*Mito, Sato & Mitani (2002)*: cervical vertebral bone age = −0.20 + 6.20 × AH3/AP3 + 5.90 × AH4/AP4 + 4.74 × AH4/PH4
(AH / PH front / back height as above, AP the front-to-back depth at mid-height), compared with the age at the
x-ray; derived for Japanese girls, flagged for boys. A judgement within 1.5 % / 0.04 of its threshold is marked
*close to a threshold*; inconsistent tracings (C3 concave with C2 flat, ...) are flagged. On confirming, the
five judgements as shown are stored (`case.cvm.confirmed`, with the stage in `case.cvm.doctor`); tuning searches
each threshold on them and is used only when leave-one-out agreement with the doctor beats the defaults'.

**The network** (`xray/model.py`). The x-ray is mirrored to face right when needed, fitted into 512 × 512, a
stride-2 stem and a 5-level U-Net (16-96 channels, GroupNorm) score every cell of a 256 × 256 grid per landmark;
a spatial-configuration branch (four 7 × 7 convolutions on an 8× smaller copy of those scores, Payer et al. 2019)
is added in, and a softmax over the grid gives a probability map per landmark. Loss: cross-entropy against a
Gaussian (σ = 1.5 cells) around the confirmed point; landmarks a tracing skipped are left out. Augmentation:
rotation ±8°, scale 0.9-1.1, shift ±5 %, gamma, contrast, brightness, noise. Training: AdamW, warm-up + cosine,
batch 4, as many steps as fit the budget (90 min by default; up to 120 a tracing, at least 600, at most 8,000), the best
checkpoint on the held-back x-rays kept. Inference: argmax refined by the probability-weighted mean over ±2
cells; confidence = probability within ±4 cells (~4 mm); with no facing known both mirror images are tried and
the surer one kept. A landmark needs 8 examples before the network places it; any other point comes from the
average tracing, fitted to the points the network did place. ~1.1 million parameters; placing the points takes
well under a second on a CPU. On synthetic cephs (tests) a 6-minute round on two slow cores reached 1.0 mm average error on held-back
images - real x-rays are harder; the held-back numbers in Settings → Learning are the ones that count.

**Pixel size from DICOM** (`xray/imageio.py`): PixelSpacing when marked calibrated (GEOMETRY / FIDUCIAL) or
different from ImagerPixelSpacing; otherwise ImagerPixelSpacing ÷ EstimatedRadiographicMagnificationFactor, or
÷ the office magnification setting. MONOCHROME1 is inverted; windowing from the file when present, else the
0.5-99.5 % range. JPEG-compressed DICOM is read through pylibjpeg. Images over 4096 px are scaled down.

**iOrtho import** (`xray/iortho.py`). *Report*: openpyxl reads the "Patient Info" sheet and every value on
every sheet (names normalised: case, spaces, full-width brackets). *Registration* (traced = s × original + t):
iOrtho's drawing is masked out (anything coloured or pure white, grown 2 px); masked normalised cross-correlation
(Padfield 2012, via FFT) over 44 scales from 0.5 to 2.2 × the fit-inside scale on 200-px copies, then 9 finer
scales on 360-px copies; then the 30 most textured patches of the original (9 × 9 grid) are found in the traced
image at full size (sub-pixel peaks), and scale and shift are fitted by least squares with outliers dropped -
twice, wide then narrow. It counts as the same x-ray only when the two images agree once aligned (the better of
the Pearson and rank correlations ≥ 0.85) and the patches fit one scale and shift to within max(1.5 px, 0.2 % of
the picture): the same x-ray leaves 0.06-0.15 px (also iOrtho's real export of an office ceph), other patients'
x-rays several pixels or no fit at all. On made-up exports at 0.6-1.3 × and on crops the scale comes out within
0.0002 and the shift within 0.1 px. An x-ray already in the app is looked for among the patient's x-rays (name,
or birth date + x-ray date) and the closest fit is taken. *Dots*: pure-red pixels; a single dot's centre is
the centre of its redness (smoothed edges included); touching or overlapping dots are split by circles of the
dots' own radius voted for by the outline and fitted to it. *Naming*: our average tracing is fitted to the dot
cloud (trimmed ICP, both facings); each landmark gets up to 5 dots within 13 mm as candidates, and a depth-first
search assigns them in tracing order, pruning any assignment that breaks one of iOrtho's numbers (the 25 above,
mm through iOrtho's S-N length; tolerance 0.3-0.5 ° / mm, widened when a short line on a small picture makes a
dot's 0.3 px uncertainty count). MOL is the pair of molar-cusp dots whose midpoint reproduces iOrtho's occlusal
plane; PM is the nearest premolar pair (not checkable). On the office's iOrtho ceph all 25 numbers came out
within 0.01 of iOrtho's. Points that match are stored `by: "import"` (conf 1.0, else 0.4), with the checks in
`case.import`.

**Nasion-rod ruler** (`xray/ruler.py`). On a copy at most 1600 px on its longest side: a band-pass (Gaussian
σ 1.2 minus σ 8) keeps dot-sized detail; spots are local maxima above 6 × the robust noise with no other spot
within 6 px, at sub-pixel centres. Chains are grown from each spot and the next one below (within 12° of
vertical, 0.05-0.3 mm per pixel for the set spacing): each next mark is looked for where the marks found so far
put it (2-3 % tolerance), one lost mark between two found ones allowed. A chain counts with at least 4 marks,
evenly spaced and in one line (residuals under 2.5 %), alike in contrast, with nothing as bright midway between
them and a plain bar round them; the best one is measured again at full size (the centroid of each mark) and the
spacing fitted by least squares. On the office's ceph: 4 marks, 113.48 px apart on iOrtho's export - 0.0881 mm
per pixel against iOrtho's 0.0885; the same x-ray with the rod blanked out, and synthetic cephs without one,
give no reading. Looked for once per x-ray (new ones on import, older ones when first opened); `case.ruler`
keeps the marks and the spacing, so a changed mark spacing re-scales without looking again.

**Security.** Content-Security-Policy `default-src 'self'` (+ `data:`/`blob:` images for the report), no inline
scripts, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on the API and images.
Passcode: PBKDF2-SHA256 (120,000 rounds) with a salt in `settings.json`; signed-in browsers get a random
30-day HttpOnly, SameSite=Strict cookie whose SHA-256 is kept in `sessions.json`.

**API** (all under `/api`): `GET hello`, `POST login`, `GET defs`, `GET status`, `GET cases?q=`,
`POST cases` (files), `GET|PATCH|DELETE cases/{id}`, `GET cases/{id}/image|thumb`, `POST cases/{id}/anchors`
(S, N, Me → all points), `POST cases/{id}/auto` (the network), `POST cases/{id}/fill`, `GET model`,
`POST model/train|stop|rollback`, `GET|PUT settings`, `POST settings/passcode`, `POST import/iortho` (files:
original x-rays, iOrtho's traced images and reports for one or more patients; `confirm`), `POST cases/{id}/iortho`
(iOrtho's traced image + report for that x-ray; `replace` for a confirmed one).
