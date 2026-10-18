# NLO Bleach Tray

Makes the bleaching-tray model from a scan — with the gel reservoirs, the Trimlign base and the trim line — and
puts it into OrthoFactory as an order, like a Titan export. Nothing to pay per case. Runs on the lab PC.

## Everyday use (2 minutes)

1. Export the patient's scan from the scanner, with the patient's name in the file name (the scanner does this on
   its own, e.g. `Jane_Doe_20261015_09-20-31_upper.ply`). **PLY when the scanner offers it** - it carries the colour,
   which the app uses to find the gum line; STL works too.
2. Drop the file on the **Bleach Tray** app page (any office computer; home page → Bleach Tray). The app asks what
   to make of it - **whitening tray**, **retainer (TT)** and/or **mouthguard (MG, braces on)** - whether the scan has
   **braces on** that should come off first (never assumed) - and whether the opposing arch is coming: drop that
   one too, answer the same for it, then **Start**. Nothing runs before Start. A whole day's scans dropped at once,
   or files dragged into **`S:\clinical\3D printing\BleachTray`**, run with the default (both) without questions.
   Several people can drop at the same time: cases run one after another and the list shows who is waiting.
3. A few minutes later the case shows **"check & send"** in the app, with **four models**: whitening tray (WT) and
   thermoformed retainer (TT) for each arch. Look at the 3D result (trim line, reservoirs, position on the base).
   Fix a tooth with the brush (the ball on the model is the brush, its size is the slider; hold **Shift** and drag,
   then **Apply fixes & re-run**) or nudge the base if needed - a fix is kept for every later re-run of that case.
   **Cut away** (third brush mode) deletes that part of the scan for good - tongue, cheek, a flap, the pad behind the
   last molar - and the model is built from the clean scan. **No reservoir** keeps the gel reservoir off a recession
   or a crown margin you paint; **Block out** fills the undercut under what you paint (under a pontic, round an
   implant crown) so the retainer seats. Both stay with the scan for every model and every later re-run. **Also make …** in the Check & send box adds the other
   tray type from a scan already in the case (chose the retainer, now the whitening tray is wanted too): no re-drop,
   the tooth split is reused, and Send writes the order with every model.
4. Click **Send to Trimlign**. Only then does it appear in OrthoFactory (the Trimlign software) → **Production**, like any Titan case:
   the whitening trays as Template pieces (`TU0A` / `TL0A`), the retainers as Aligner pieces (`AU1A` / `AL1A`), a mouthguard as a stage-2 Template piece (`TU2A`).
   Print on the Form 4B, thermoform, trim on the Trimlign. **Discard** throws it away. **Save as lesson** files a brush-corrected case for the retraining without ordering anything (Send does that
   too, on the side); it is greyed out until a fix has been applied.

**Past cases** (sidebar): every case the app ever made stays on file - type a bit of the name or a date to find it,
click it and it comes back as it was: look at it, print it again (the model files), **Send to Trimlign again** for a
lost print or a second set, or paint fixes and re-run. The big model files are kept for 30 days; after that only the
recipe stays (scan, settings, brush fixes, painted areas - about 15 MB per arch) and opening the case re-makes the
models in a minute. The case list also survives a restart (the last week comes back by itself).

Nothing reaches OrthoFactory without that click. Files dragged into the folder move to `BleachTray\done` when
processed, or to `BleachTray\failed` with an `error.txt`. The small black window "NLO Bleach Tray" must be open on
the PC that runs the app (it starts by itself at sign-in; if it's gone, double-click `start_app.bat` in the app
folder). That one window watches the drop folder *and* serves the app page to the whole office.

## It learns from your corrections - by itself

Every case that is sent (or saved as a lesson) is saved in the app folder under `training\<Last, First> - <date>\`:
the scan of each arch, the tooth labels as approved (marked *corrected* when someone used the brush - only those
are lessons; an untouched automatic result teaches nothing new) and a `case.json`. Titan
exports (`First Last - 0 - Maxilla.stl` / `.pts`) dropped on the app page or into the drop folder are not processed;
they are filed into the same patient folder, and one that carries a shell per tooth (Titan's own segmentation) is
turned into a lesson too.

Between 1 and 5 in the morning, when nothing is being processed and there are new corrections, the app retrains the
tooth model on everything in `training\` (the base set under `training\_base` plus every corrected case). The new
model is checked out-of-fold first: it must do better on the corrected cases than the current model and must not
drop below F1 0.95 on the base set, otherwise it is thrown away. An accepted model replaces `assets\models.joblib`
(the previous three are kept as `models_prev_*`) and is used from the next case on. The sidebar shows the model's
state; *Retrain now* under Settings → Learning runs it on the spot (10-30 minutes, the app keeps working).

The starting set ships with the app as `assets\base_training.npz` - per arch the per-vertex features and targets
the model learns from (numbers only: no scans, no names), so nothing has to be downloaded for retraining to work.
Full base cases under `training\_base\` (scan + labels) take precedence when present.

## Scanner integration (AlliedStar or any scanner that exports STLs)

Settings → *Scanner export folder* → Save (once, for the whole office). The app lists the scans exported in
the last 14 days, grouped by patient and arch; **Make tray** copies them into a case and processes them. The
originals in the scanner folder are never touched.

## Updating the app

On the PC that runs the app: **Win + R**, paste this line, Enter (it downloads the newest version, keeps your
settings and the base, restarts the app, and ends with "UPDATE DONE"):

```
powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/update.ps1' -UseBasicParsing).Content"
```

On a PC that allows .bat files, double-clicking `update.bat` in the app folder does the same.

## Moving the app to another PC

Two lines, each pasted into the Run box (**Win + R**) - no files to download or double-click. Only one PC should run
the app at a time (two watchers would create duplicate orders), so the old PC goes first. Any PC that can see the
S: drive can host it; it just has to be on and signed in.

1. **On the PC that runs the app today** - stops the app, removes its autostart, and packs the cases, lessons,
   settings and the Trimlign base into `S:\clinical\3D printing\BleachTray_move-from-<PC name>`:

   ```
   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "$NLO_MOVE='pack'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/move.ps1' -UseBasicParsing).Content"
   ```

2. **On the new PC** - installs the app (and Python, if the PC has none; no administrator needed), takes the pack
   over, sets the app to start at sign-in, opens it, and ends with the PC's name:

   ```
   powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "$NLO_MOVE='install'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/move.ps1' -UseBasicParsing).Content"
   ```

   It refuses to take the pack while the old PC is still serving the app. With no pack on the S: drive it is a
   fresh setup (the base is learned from a Titan export, the drop folder created). A fresh PC without Python gets
   Python 3.13 installed for the signed-in user first.

3. The NLO apps home page sends **Bleach Tray** clicks to the PC named in `nlo-bleachtray.html` (`DEFAULT_LAB_PC`) -
   change that name to the new PC's, or, in any one browser, open the page with `?help` and use "Use a different PC".

The old PC keeps its app folder (nothing is deleted); it just no longer starts the app. On a PC that allows .bat
files, `uninstall_autostart.bat` / `install.bat` do the same by hand.

## If a case needs a look

From any office computer open `http://lab:8765` — or click **Bleach Tray** on the NLO apps home page,
which opens it for you (the black window on the lab PC prints the exact address). Drop a scan anywhere on the page:
it processes on its own and writes the OrthoFactory order (the green line under the result confirms it). See the
result in 3D, paint over a tooth the computer missed (hold **Shift** and drag on the *Segmentation / fix* tab),
re-run. **Position on the base** (Result tab): the arch stays where it is and the *base plate* moves under it - drag the plate to slide it, drag the blue ring to turn it (or use the step buttons); the first touch flips the view to the underside with the plate see-through, so the locating holes are checked against the arch footprint (*Underneath (holes)* / *From above* switch the view). *Apply* rebuilds the order, *Reset to automatic* goes back. (The numbers sent to the server are still the arch's move relative to the base, as before.) *Make*: *Whitening tray + retainer* (default, both per arch), *Whitening tray 5-5 only* (reservoirs 5-5, line at the gum), *Whitening 3-3 only*, *Retainer only*
(line 1.25 mm onto the gums, semi-scallop), *Plain model*.

---

## Technical notes

**What it writes.** A Titan-style OrthoFactory order folder in Factory #1's input folder:

```
<Titan folder>\2026-10-15 10 59 21 - A - Dr. Amir Akhavan - Jane Doe - 4ee1\
    2610151059_1_Order.xml                 <OrderData Type="Titan_Angled"> … <Aligner Name="TU0A"> …
    Jane Doe - 0 - Maxilla.stl         solid horseshoe + Trimlign base (locating hole at the origin)
    Jane Doe - 0 - Maxilla.pts         trim line, same frame, CRLF
```

**How it works.** Auto-orientation from geometry (occlusal up, anterior +y, midline from mirror-image tooth
pairs, cross-checked against a parabola fit of the gum-line loop; the shape midline is used when they disagree by > 8°). A gradient-boosted classifier trained on Titan's own tooth segmentation labels every vertex tooth/gingiva
from multi-scale curvature, height-below-cusp and radial-position features; teeth are separated along the arch from four cues (an interproximal classifier, incisal/occlusal
height dips, pinches of the crown outline seen from above, facial grooves) checked against expected tooth widths,
then flooded downhill from each tooth's centre; numbered from the midline. The gum line
is the 0.5 iso-contour of the tooth mask; papillae are bridged with a 2D closing and snapped onto the surface.
Reservoirs are a feathered normal displacement on the facial surfaces, kept 0.5 mm from the gum line and 0.4 mm from the incisal edges, the neighbouring teeth and the facial-lingual transition (full height ~0.6 mm further in). The solid: clipped surface closed below the floor, unioned with a
gingiva shelf (so there is always material beyond the scan edge, e.g. behind the last molars), intersected with the
extruded horseshoe outline (manifold3d booleans), unioned with a manifold rebuild of the Trimlign base at Titan's
placement (facial gum line of the centrals 6.0 / 4.5 mm in front of the locating hole for upper / lower; floor
3 mm below the lowest trim-line point). The model is one solid: anything the floor or the outline cuts loose from the
arch (cheek or lip tissue, scan islands) is dropped instead of printing as a slab lying next to the model.

**Levelled like Titan.** Before basing, the model is pitched/rolled so the plane through the *facial* gum line is
horizontal (plus Titan's small forward lean: 0.75° upper, 2.75° lower - measured on 8 raw/Titan pairs, which put our
frame within ~1° of Titan's). With the gum line level the floor sits a few mm under the line all the way round, so
the walls are low and even instead of 3 mm at the back and 10 mm at the front, and the tissue behind the molars drops
under the floor on its own. The rim beyond the trim line is 3 mm (Titan's bodies hug the teeth), the model ends 3 mm
behind the last tooth on each side, and all of it is a setting (Settings → Model base).

**Behind the last molar.** A "tooth" found behind the terminal molar that is far too narrow for a molar and rises
above it is the retromolar pad (or ascending tissue) and is relabelled gum, so the trim line wraps the molar instead
of running up the pad. The model is then lowered behind the last tooth on each side to 2 mm below the trim line
(`distal_relief`), so the Trimlign bur reaches the distal surface instead of hitting a wall of gum, and ends 3 mm
behind the tooth (`distal_keep`).

**Smooth distal ends.** What a patient feels at the back of a tray is a sharp turn where the line wraps the last
tooth: the gum line following a tooth label down the distal root or out onto the tuberosity / retromolar pad (a
flap of tray behind the molar), or hard corners at the disto-buccal and disto-lingual line angles. So the line is
finished round each terminal tooth (`round_distal`, `distal_round` = corner radius, 3 mm): it never goes past the
crown - the crown's distal end is where the tooth footprint has narrowed to 60 % of its width, or where the label's
lowest points climb 2.5 mm above the gum level (no cervical wall any more = pad), and never more than ~13 mm (or the
molar in front + 1 mm) from the mesial contact; the corners in the last few mm are rounded with a 3 mm radius (a
morphological opening restricted to that window, so the line only moves inwards onto the tooth, never out onto the
gum); the height along the end is smoothed and never dips more than 1 mm below the straight between the buccal and
lingual sides; and a terminal tooth whose footprint is still wide where the scan edge cuts through it is treated as
not captured whole - the tray is cut 2 mm short of the edge, over the tooth, with the same rounded corners. Moved
points go back onto the surface. The distal relief and the model's end plane use the same crown end, so a label that
leaked onto the pad no longer carries the pad along. On the 23 stored arches the line was pulled 0.3-1.5 mm onto the
tooth where it was already fine and 2-7 mm where it had run onto the pad.

**Braces on (a scan at the eval appointment).** Tick **Braces on - take them off first** on the scan when you
drop it. Only then does a coloured scan with brackets on go through `appliance.py` before anything else sees it
(the app does this itself in `_take_off_braces`, once per scan; `process()` does it for a scan that comes in by
another route when `remove_appliances` is set). It is never assumed: on plain scans the detector has taken
stained or shadowed enamel for a bracket and rebuilt real tooth surface, so a scan dropped without the box is
left exactly as scanned (and a case cleaned by an earlier version that assumed braces goes back to the scan as
scanned on its next re-run). *Finding
them* - candidates come from colour: metal is grey on iTero and a cyan-blue sheen on AlliedStar, dark
grey-brown in shadow, ties green / purple / blue, while enamel and gum sit in a narrow pink-ivory-yellow
band. Whether a candidate really is an appliance is decided by its height above the surface continued
across the candidate region; that continuation is only honest when the region is tight (a wide one on a
convex crown reads the crown's own bulge as a bump), so the height is measured, the region shrunk to what
stood proud, and measured again, four times. Incisal edges and cusps on the teeth, the vestibule and the
ragged scan edge are never candidates; pieces are kept only if they stand proud (≥ 0.45 mm). The archwire
is then traced as a smooth path through the bracket centres round the arch, so the thin stretches between
brackets that colour alone misses come too. *Taking them off* (`remove_appliances`) - the bracket's base
pad and adhesive flash are a low ledge the bump test does not see once the region is tight: a quadric is
fitted to the enamel ≥ 1 mm away (`mls_height`) and whatever in the band round the appliance still stands
> 0.1 mm above it, contiguous to the appliance, is taken too. Every face touching that region (plus two
rings) is cut out - a wire floating across an embrasure is then simply gone - and each hole this leaves in
enamel or gum is closed with a patch: a ridge-regularised quadric fitted to the rim and the clean surface
two rings round it (the crown's curvature) plus a harmonic interpolation of the rim's residuals (so the
patch passes exactly through the rim), triangulated at the mesh's own spacing; a long rim (a band of
wire + brackets over several teeth) is split at its waists - the embrasures - into one hole per tooth
first; a rim no patch can hold is restored and smoothed over in place instead; pinholes get a triangle; the
seams are relaxed with a few shrink-free Taubin steps. A *second pass* on the result catches the low lips of
pad or ligature that sat under the first pass's threshold. The cleaned scan is written as
`<scan>_clean.ply` next to the case and becomes the case's scan file (brush, re-runs, history and the
Titan export all work on it); its rebuilt vertices are recorded as paint bit 4 (grey in the brush view) and
the result line says how much came off. Scans with braces are kept out of the training set.
`remove_appliances` = False (default) / True. **Take off brush** (Segmentation / fix): a bit of bracket,
wire or tie the app missed - or anything on a scan dropped without the box - is painted and goes through the
same cut-and-patch on the next run (no detection, what was painted is the appliance); the scan advances to `_clean2.ply`, `_clean3.ply`…, with the earlier
rebuilt areas, the painted no-reservoir / block-out strokes and a cut in the same run carried over by
position; saved brush fixes of tooth labels are dropped for that scan (the teeth are found again on the
rebuilt enamel). Wire and ties left on at the eval scan make this harder (the wire floats across the
embrasures and hides the gingival enamel) - for a retainer scan, take the wire and ties off first and
leave the brackets; a mouthguard scan keeps everything (and the mouthguard model keeps the brackets, see below). Checked on 10 arches with braces (3 AlliedStar patients, 2
iTero; metal brackets, green/purple ties, molar tubes, a palatal expander) and 2 plain iTero arches: the
brackets, wire and ties are gone on all ten and the enamel reads as enamel; nothing is touched on the
plain scans. Known limits: clear / ceramic brackets (tooth-coloured) are not found; molar bands and an
expander's arms are not bumps and stay; a **stainless-steel crown** is grey and stands proud like a bracket and
IS taken for one (seen on Dr. Wood's lower, 10/17/2026 - the lingual wall of the crown was cut out and rebuilt), so
for a braces scan with a metal crown leave the box off and paint the brackets with the **Take off** brush instead;
the enamel under a bracket is a smooth reconstruction, not the scanned surface.

**Mouthguard (braces on).** Tick **Mouthguard (MG)** on the scan (or choose the *Mouthguard (braces on)* preset),
scanned with the brackets, wire and ties on and the cheeks and lip pulled back so the scan goes as far into the
vestibule as it can - that is how deep the guard will go. The model keeps the brackets: the teeth are found on a
cleaned copy (brackets confuse the tooth split), but the body is built from the scan as it is, with every bracket,
tube and stretch of wire under a smooth **shield** (`mouthguard.appliance_shields`: overlapping convex caps over ~6 mm
stretches of appliance pushed out `mg_clearance` = 1 mm, with a skirt of surface 1.5 mm round them, unioned into one
band per side) so the sheet forms over a smooth channel instead of locking into the bracket undercuts. The trim
line (`mouthguard.vestibular_trimline`) is one closed loop: on the facial side it follows the surface down into the
vestibule to 1.5 mm above the scan's own edge (`mg_inset`; never less than 3 or more than 14 mm below the gum line,
measured from the running mean of the scalloped gum line, and never the inside of the lip); it rises in a rounded
notch 6 mm wide to 2.5 mm below the gum line at the frena - the labial one at the midline always (found as the
shallowest stretch of sulcus near the midline, assumed there if the scan does not show it), one buccal notch per
side when a clear one shows in the canine / premolar region; lingually it runs 6 mm onto the palate (`mg_palate`);
behind the last tooth on each side it hugs the tooth 2.5 mm back (`mg_distal`), the facial deepening fading out
over the last 4 mm. No reservoirs, no automatic block-out (the whole sulcus under flared crowns would count as
one undercut - the real vestibule is what the guard needs), the model still sits on the base by its gum line and
the body covers the crowns the way a tray body does. The brush view shows what is under the shield in orange;
**Take off** on a mouthguard adds the painted part to the shield instead of removing it (a tube the app missed),
and tooth / gum fixes work on the scan as it is. In OrthoFactory the guard is a Template piece, stage 2 (`MG`);
the base says MOUTHGUARD and the tooth mark is `G`. Settings: `mouthguard`, `mg_inset`, `mg_min_depth`,
`mg_max_depth`, `mg_palate`, `mg_distal`, `mg_notch_top`, `mg_notch_width`, `mg_clearance`. Known limits: the
shield is a faceted band (smooth enough for the sheet, not pretty); a 2x4 in the mixed dentition (molar bands + four
incisor brackets, erupting teeth under the gum) is still hard for the tooth split - the edentulous ridge comes out as
"tooth" (harmless for a guard) but the anterior palate may too, which pushes the palatal line back: paint it **Gum**
and re-run; a scan that stops at the gum line gives a line 3 mm below it and nothing deeper.

**Missing teeth.** A missing premolar or molar used to end the tray at the gap: the gum-line contour closed round
the teeth in front of it and everything behind was dropped from the line and the model. `edentulous_gaps` finds
neighbouring teeth on a side whose footprints are more than 3 mm apart, marks the ridge between them (inside the hull
of the two crowns in plan view, from the neighbours' cervical level up - or the top 2 mm of a resorbed ridge) as
tooth for the purpose of drawing the line, so the line runs across the ridge to the teeth behind, and - for gaps of
5 mm or more - keeps the missing tooth's position (one per ~7 mm of gap), so the molar behind a missing premolar is
still a molar for reservoirs, the tooth mark and crown sizes. Undercuts facing the gap are filled by the normal
block-out when it is on. Not done yet: building the edentulous span up to the neighbours' bucco-lingual width
(a pontic-like filler) so the retainer is not a thin strip there.

**Exposed root.** A bleaching reservoir must not sit on root (sensitivity). The reservoir stops 1 mm short of the
gum line everywhere (Settings → Reservoirs), and on each reservoir tooth the app looks for root showing on the
facial side two ways: the mid-facial profile (an exposed root runs near-vertical or inward for ≥ 0.75 mm above the
margin before the enamel climbs outward; a healthy crown climbs from the margin) and the clinical crown length
against the typical anatomic crown + 1 mm. Where root is found the reservoir stops above it plus a leeway (1 mm,
a setting), and the result line names the teeth. On 15 scans: 0-2 of 10 reservoir teeth flagged on young
orthodontic patients, 7 of 10 on an adult with generalised recession. Paint *No reservoir* for anything it misses.

**Block-out.** For thermoforming, the space under an overhang - a bridge pontic, the emergence of an implant crown,
an open embrasure - is filled like block-out resin (`bleachtray/blockout.py`): on a 0.3 mm grid every vertical
through the model that passes an underside and then free air before the next surface is a candidate; it is filled
from that surface up to the underside when the undercut is deeper than 0.75 mm measured in from the contour seen
from above (a setting, retainers only by default - the small natural undercuts stay for retention), or whatever
its depth under a painted *Block out* stroke. The fill is one heightfield solid unioned into the body before the
outline cut; it is shown in teal in the Result view and saved as `<name>_blockout.stl`. The fill is feathered like
resin: built on a 0.1 mm grid, it climbs from the surface at the edge of the spot up to the overhang over 1.2 mm, so
there is no wall and no staircase to see.

**History.** `jobs\<case>\case.json` is the recipe of a case (scans by relative path, settings, brush fixes as
`fixedlabels_*.npz`, painted areas, review state, when it was sent); it is written whenever a run finishes or the
case is sent / saved / discarded, and indexed at start-up (folders from before the history existed get one built
from their report files). `/api/history?q=` searches it; `/api/history/<id>/open` brings a case back into the live
list, re-running it from the recipe when its outputs have been thinned. Outputs older than `KEEP_OUTPUT_DAYS` (30;
env `NLO_KEEP_OUTPUT_DAYS`) lose the model / body / Titan-copy files (the Titan pair is a hard link of the model, so
it costs nothing while it exists). Nothing is ever deleted whole.

**Marks.** Two: (1) the patient's initials + W (whitening) / R (retainer), raised 0.35 mm on the buccal surface of a
first molar (right side if present, else second premolar / second molar), each letter on its own tangent plane and
the text shrunk to the flat middle of the crown - it forms into the tray itself, like an aligner maker's mark, with a
recess on the inside that touches nothing; (2) the name and WHITENING / RETAINER engraved 0.4 mm deep on the flat strip
of the base plate inside the arch, when the arch leaves at least 8 mm of room there (skipped otherwise). Switch off
under Settings.

**Settings.** The gear in the New case card opens a panel where every number has a picture of what it means;
*Apply to this case & re-run* re-makes the open case with the changed settings - only the models the change touches
(a retainer-line change leaves the whitening trays alone), brush fixes and painted areas kept
(reservoir region / depth / distance to the gum / leeway at exposed roots, the two trim lines, block-out of
undercuts, how the line crosses between teeth, rim, floor depth, the cut behind the last molar, levelling, marks,
bulk defaults, learning, the office folders). Settings are
remembered in the browser; *Back to defaults* resets them. The whitening tray and the retainer have their own trim
line and reservoir settings, applied on top of the model type.

**Floor and skirt.** The model floor is 3 mm below the trim line's lowest point, unless that point is a stray dip
(flap, pocket): then the floor follows the 10th percentile and the dip is lifted to 0.8 mm above the floor, so one bad
point cannot make the whole model 10 mm taller. Wherever the scan stops short of the outline (distal to the last
molars, a palate the scanner cut, facial of proclined incisors) a smooth gingiva shelf fills the body out to the
outline instead of leaving a cliff.

**Scanner exports.** Open-shell or closed-shell (iTero "with base", 3Shape solid) STLs both work: a large flat floor is
detected and removed before orientation, the skirt reads as gum. Scans over 200k faces are decimated first.
**Export PLY when the scanner offers it** (AlliedStar, iTero, Medit, 3Shape): a PLY carries a colour per vertex and the
app uses it (`bleachtray/colour.py`). No fixed colour rule - every scanner, light and mouth differs - instead each scan
teaches its own: the vertices the shape model is sure about (tooth core, gum well away from the teeth) train a small
colour classifier for that scan, which then votes with the shape model in a 3 mm band along the gum line and can veto a
patch of gum the shape model took for a tooth (a bit of palate, a flap). Colour whose held-out agreement with the shape
model is under 93 % is ignored. On 8 AlliedStar / iTero arches: 1-3k vertices re-decided per arch, the gum line hugging
the teeth where it dipped into the papillae before, two false "teeth" on the palate and the facial gum gone. PLYs are
read with the app's own one-pass reader (`mesh_utils.read_ply`; a texture the file points at is ignored - iTero writes
both and the general loader ran out of memory unwrapping it); the colour rides along the cleaning as
`mesh.metadata["rgb"]`, shows under the labels in the Segmentation view, survives a Cut away (the cut file is a PLY)
and is kept in the training folder for the retraining.

**Validation.** One upper vs Titan: gum line within 0.17 mm median / 0.25 mm p90 of Titan's tooth boundaries,
95 % per-tooth agreement, base placement within 0.35 mm / 2°. First order accepted by OrthoFactory's simulator
on 10/15/2026 (order 10 59 21).

**Command line.** `python run_watch.py --inbox <folder> --titan <OrthoFactory input folder>` (settings remembered in
`watch_config.json`); `python run_app.py [--lan]` (`NLO_WORKERS=2` processes two cases at once on a strong PC);
`python tools/import_base.py <Titan folder or export .stl>`.

**Retraining.** `python tools/make_ground_truth.py <raw scan> <Titan '- 0 -' export> <out.npz>` per arch (stage-1 exports
work too: moved/missing teeth are marked 'ignore'), then `python tools/train_eval.py cases.json` (leave-one-case-out
scores, then the final model to `assets/models.joblib`). Current model: 8 arches from 5 patients; held-out tooth/gum F1
0.96–0.99 per patient.

**Layout.**
```
bleachtray/   pipeline: orient, features, segment, reservoir, solid, orderfolder, watch, pipeline
app/          FastAPI server + single-page UI (three.js vendored, works offline)
assets/       models.joblib (committed); trimlign_base_* (imported locally by install.bat, not committed)
tools/        import_base, rebuild_base, ground truth, train/eval, verification
samples/      training scans + labels (local only, never committed)
```
