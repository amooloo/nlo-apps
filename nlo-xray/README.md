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
   more than 1 SD off, coral more than 2 SD. *Growth (CVM)* shows what the stage is based on: which lower borders
   of C2-C4 are concave (and how deep) and the shape of the C3 and C4 bodies.
5. **Confirm tracing.** It becomes a lesson for the app. Confirming also records the CVM stage shown as your
   call - if you see it differently, pick your stage under *Your call* first. **Print** gives a one-page report
   (tracing, summary, measurements). A confirmed tracing can still be corrected by dragging a point (the app
   learns the correction); **Reopen** walks through it again.

### Calibration (millimetres)

Angles and ratios need nothing. Millimetre values (Wits, incisors to NA / NB, lips to the E-line, lengths)
need the size of a pixel at the patient's midline:

- **DICOM**: taken from the file. When the file gives the pixel size at the detector only, it is divided by the
  ceph magnification - the file's own figure when it has one, else Settings → Calibration (1.13, Carestream's
  figure for the CS 8200 ceph arm). The case shows where its number came from.
- **JPG / PNG / TIFF**: once, on any x-ray, click **Ruler**, click the two ends of a known length (10 mm on the
  nasion-rod ruler), type the length and tick *use for every exported x-ray*. Export the same way every time.

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
- **Your CVM eye.** Your stage calls on confirmed tracings (including the ones you accepted) tune the two CVM
  thresholds - how deep a border must dip to count as concave, and where a body turns trapezoid / square /
  vertical - but only once there are 8 calls and only if the tuned thresholds agree with you more often than
  the defaults when each x-ray is left out in turn.
- **A faster start:** trace a batch of old cephs from your records. Every one you confirm counts.

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
x-rays, tracings, networks and settings are kept.

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
  xray\landmarks.py     the 37 landmarks, their definitions, tracing order and the textbook template
  xray\analysis.py      measurements, norms, the summary calls
  xray\cvm.py           CVM stage (Baccetti 2005) and the tuning of its thresholds
  xray\imageio.py       DICOM / JPG / PNG / TIFF reading, pixel size, names and dates
  xray\store.py         one folder per x-ray under cases\
  xray\shape.py         the average tracing (Procrustes), anchors -> all points, filling in points
  xray\model.py         the landmark network
  xray\train.py         learning rounds, the held-back check, versions, the evening schedule
  tools\synth.py        synthetic 'cephs' for tests (no patient data anywhere in the repo)
  tests\                python -m pytest tests
  setup.ps1             one-line install / update;  install.bat, start_app.bat, uninstall_autostart.bat
```

Data (git-ignored): `cases\<id>\case.json` + `original.*` + `image.png` + `thumb.jpg`, `models\current.pt`,
`models\prev_*.pt`, `models\status.json`, `models\train.log`, `settings.json`, `sessions.json`.
`NLO_XRAY_DATA` puts all of it in another folder.

**Landmarks (37), in tracing order.** Cranial base: S, N, Or, Po, Ar. Maxilla: PNS, ANS, A. Teeth: U1A (upper
incisor apex), U1T (tip), L1T, L1A, MOL (first-molar occlusal contact), PM (first-premolar contact).
Mandible: B, Pog, Gn, Me, Go. Soft tissue: Prn, Sn, Ls, Li, Pos. Vertebrae: C2 lower border (back corner,
deepest point, front corner), C3 and C4 (upper back, upper front, lower back, lower deepest point, lower front).
The template (starting positions) is built from textbook norms for a ~12-year-old.

**Measurements** (all in a frame where the face looks to +X and up is +Y, so facing left or right gives the same
numbers). SNA, SNB, ANB (= SNA - SNB). Wits: A and B projected onto the functional occlusal plane (MOL→PM), AO - BO.
SN-FH; FMA (Po-Or to Go-Me); SN-GoGn (Steiner); palatal (ANS-PNS) to Go-Me; gonial angle Ar-Go-Me; Jarabak
S-Go / N-Me; lower face height ANS-Me / N-Me. U1-SN; U1-NA and L1-NB in degrees (signed, + = tipped ahead of the
line) and mm (to the incisal tip, + = ahead); IMPA (L1 to Go-Me); interincisal angle. Upper / lower lip to the
E-line (Prn-Pos, + = ahead). Lengths S-N, ANS-PNS, Go-Me, Ar-Go, N-Me, ANS-Me, S-Go.
Default norms (mean ± SD; Settings → Norms changes them): SNA 82±3, SNB 80±3, ANB 2±2, Wits −1±2 (male) /
0±2 (female), SN-FH 7±3, FMA 25±5, SN-GoGn 32±5, PP-MP 25±5, gonial 130±7, Jarabak 61.5±2 %, LAFH 55±2 %,
U1-SN 103±6, U1-NA 22±5° / 4±2 mm, L1-NB 25±5° / 4±2 mm, IMPA 90±5, interincisal 131±6, upper lip −4±2,
lower lip −2±2. Summary calls: Class II when ANB > 4°, Class III when < 0°; Wits Class II/III more than 2 mm
from its norm; high angle FMA > 30° or SN-GoGn > 37°, low angle FMA < 20° or SN-GoGn < 27°.

**CVM** (Baccetti, Franchi & McNamara 2005). A lower border is concave when its deepest point lies at least
6 % of the border's length above the line joining its corners (≈1 mm on a 15 mm body). A C3/C4 body is
trapezoid when front height / back height < 0.80, else height / width < 0.90 rectangular horizontal,
0.90-1.10 square, > 1.10 rectangular vertical. CS1 no concavities; CS2 C2; CS3 C2+C3; CS4 all three with
rectangular-horizontal bodies; CS5 at least one square; CS6 at least one rectangular vertical. A call within
1.5 % / 0.04 of a threshold is marked *close to a threshold*; inconsistent tracings (C3 concave with C2 flat, ...)
are flagged. Tuning: grid search over the four thresholds, accepted only when leave-one-out agreement with the
doctor's calls beats the defaults' agreement.

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

**Security.** Content-Security-Policy `default-src 'self'` (+ `data:`/`blob:` images for the report), no inline
scripts, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on the API and images.
Passcode: PBKDF2-SHA256 (120,000 rounds) with a salt in `settings.json`; signed-in browsers get a random
30-day HttpOnly, SameSite=Strict cookie whose SHA-256 is kept in `sessions.json`.

**API** (all under `/api`): `GET hello`, `POST login`, `GET defs`, `GET status`, `GET cases?q=`,
`POST cases` (files), `GET|PATCH|DELETE cases/{id}`, `GET cases/{id}/image|thumb`, `POST cases/{id}/anchors`
(S, N, Me → all points), `POST cases/{id}/auto` (the network), `POST cases/{id}/fill`, `GET model`,
`POST model/train|stop|rollback`, `GET|PUT settings`, `POST settings/passcode`.
