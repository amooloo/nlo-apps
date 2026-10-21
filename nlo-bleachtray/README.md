# NLO Tray Maker (nlo-bleachtray)

Makes the bleaching-tray model from a scan — with the gel reservoirs, the Trimlign base and the trim line — and
puts it into OrthoFactory as an order, like a Titan export. Nothing to pay per case. Runs on the lab PC.

## Everyday use (2 minutes)

1. Export the patient's scan from the scanner, with the patient's name in the file name (the scanner does this on
   its own, e.g. `Jane_Doe_20261015_09-20-31_upper.ply`). **PLY when the scanner offers it** - it carries the colour,
   which the app uses to find the gum line; STL works too.
2. Drop the file on the **Tray Maker** app page (any office computer; home page → Tray Maker). A pop-up in the middle of the screen asks what
   to make of it - **whitening tray**, **retainer (TT)**, **mouthguard (MG, braces on)** and/or **Phase I (P1)** retainer - whether the scan has
   **braces on** that should come off first (never assumed) - and whether the opposing arch is coming: drop that
   one too, answer the same for it, then **Start**. Nothing runs before Start. A whole day's scans dropped at once
   (file names of more than one patient, or more than two files), or files dragged into
   **`S:\clinical\3D printing\BleachTray`**, run with the default (both) without questions - and with any braces left
   on. An iTero export's upper + lower (`123456789_lprofile_occlusion_u.ply` / `_l.ply`: an order number, no name)
   are one patient's: the pop-up asks as for any drop, with the arches filled in from `_u` / `_l` - type the name
   (until 10/19/2026 the two were taken for two patients and ran as a whole day's drop: no questions, braces on).
   Several people can drop at the same time: cases run one after another and the list shows who is waiting.
3. A few minutes later the case shows **"check & send"** in the app, with **four models**: whitening tray (WT) and
   thermoformed retainer (TT) for each arch. Look at the 3D result (trim line, reservoirs, position on the base) and
   nudge the base if needed. Each thing you might fix has its own tab, each with one brush (the ball on the model;
   its size is the slider; hold **Shift** and drag, then **Apply & re-run** - every fix is kept for every model made
   from that scan and every later re-run): **Clean-up** cuts away what is not the arch (tongue, cheek, a flap, the
   pad behind the last molar - gone from the scan); its **Erase** brush takes a stroke back before Apply, and once a
   cut is applied **Bring back what was cut** puts the scan back as it was before the first cut (every model from it
   is made again); **Segmentation** repaints tooth / gum labels (the white
   stone model with each tooth in its own colour): the **Tooth** brush paints the colour of the tooth the stroke
   starts on - where one colour has run over onto the next tooth, start on the right tooth and paint over the bleed
   and it is that tooth again, a clean split (the doctor, 10/21/2026: "wherever the brush picks from will be the
   colour that is painted"); started on gum it paints plain tooth for the app to sort - and has the **Contact** dot:
   Shift-click once where two teeth touch and the split between them is put there - for crowded lower incisors,
   where one colour runs across two teeth and the reservoir ends mid-tooth instead of at the contact; click a dot
   to take it away (an applied dot shows pale, red once marked to go), Shift-drag a dot to move it, applied or not;
   **Phase I** (on a Phase I case only) takes the doctor's own dots: **Cutout span** - Shift-click the near and the
   far end of the cutout on a side and it runs between the two dots, mesio-distal, whatever stands there - and
   **Ends here** - one dot per side where the retainer stops, nothing covered behind it - and **6 is here** - Shift-click
   the first molar when the app has it as a 7 (a space between the front teeth counted as a tooth gone shifts the
   count) and the side is counted from it; **Teeth** shows every tooth's number on a badge at the end of a leader
   line (the doctor, 10/21/2026, after a clip of another program: "a line drawn from every tooth with a drop-down
   where you can pick primary and adult tooth"): click a badge, pick **Perm** 1-8 or **Primary** A-E, and the rest
   of that side is counted from it (one more going back, one less going forward); **× not a tooth** makes a label gum
   again, **auto** gives the app's count back; badges given by hand show orange, and the numbers are kept with the
   scan (`tooth_ids`, by label - the labels are frozen for the scan from then on so a later run cannot renumber
   them underneath; a brush fix in the same Apply carries them onto the new split by majority); **Reservoirs** shows the reservoirs in red and you **Paint** more
   (a tooth behind the 5s, a part a recession set-back took away) or **Erase** them (a recession, a crown margin) -
   always a millimetre off the gum line, feathered at the edge of your stroke, ignored on gum; **Block-outs** fills
   the undercut you mark out (under a pontic, round an implant crown, a black triangle) so the retainer seats - **Outline**
   it: Shift-click corner after corner round the area and click the first dot again to close, the inside is filled
   (or use the **Block out** brush); **Braces** (only
   for a scan dropped with Braces on, or a mouthguard) takes off a bracket or bit of wire the app missed, and its
   **Not a bracket** brush marks tooth or gum the app took for a bracket (left as scanned on a retainer, left out of
   a mouthguard's band; blue on the tab, kept with the case and saved with its lesson). **Also make …** in the Check & send box adds the other
   tray type from a scan already in the case (chose the retainer, now the whitening tray is wanted too): no re-drop,
   the tooth split is reused, and Send writes the order with every model. The **mouthguard** (upper only, for now) is
   the fifth icon in the model row at the bottom right: grey while the case has none - a click asks whether to make
   one from the upper scan - and a model like the other four once it is made.
4. Click **Send to Trimlign**. Only then does it appear in OrthoFactory (the Trimlign software) → **Production**, like any Titan case:
   the whitening trays as Template pieces (`TU0A` / `TL0A`), the retainers as Aligner pieces (`AU1A` / `AL1A`), a mouthguard as a stage-2 Template piece (`TU2A`), a Phase I retainer as a stage-3 Aligner piece (`AU3A` / `AL3A`).
   **The last letter moves on** (`AL1B`, `AL1C`, …) whenever that piece has been sent for the patient before - from
   this case, another case, or Titan - the way Titan marks a new version. OrthoFactory takes a repeated name for the
   same piece and keeps cutting along the first one's path: a second lower retainer for one patient, sent as `AL1A`
   again after the first had been moved 1.4 mm on the base, was cut along the old line - shifted sideways, not
   following the teeth (10/19/2026). After Send the box names the pieces, and says so when OrthoFactory still has an
   earlier order for the patient (with how far its trim line is from the new one): trim each tray with the order
   of the model it was printed from, and delete the earlier order in OrthoFactory if its model is not used. In the
   Trimlign simulator the green dashed line (the cutter's path) must lie on the black dots (the trim line).
   Print on the Form 4B, thermoform, trim on the Trimlign. **Discard** throws it away. Send also files the case for the retraining (a brush-corrected case is a lesson). The small
   **Save as lesson without sending** link, shown only on a corrected case, does the filing alone - for a case that is not going
   to be ordered - and then asks whether to keep the case in the list or move it to Past cases.

**Which model is on screen** (bottom right of the viewer): one icon per model - whitening upper, retainer upper,
whitening lower, retainer lower, then a mouthguard or plain model when the case has one - always in that order, the
ones the case does not have greyed out; click one and every tab shows that model. **Discard** clears the screen
entirely (model, boxes, case), so the next case can be picked.

**Views** (right edge of the viewer, above the model icons): **Top, Front, Right, Left, Back, Below** turn the model
to look at it from that side, framed to fill the screen; Right and Left are the patient's sides, and Below shows the
base plate see-through. Turning the model by hand afterwards works as always.

**Cases** (sidebar) holds only what still needs a decision: processing, or done and not yet sent or discarded. Sending
or discarding moves the case to Past cases at once; Save as lesson asks whether the case stays or goes.

**Past cases** (sidebar): every case the app ever made stays on file - type a bit of the name or a date to find it,
click it and it comes back as it was: look at it, print it again (the model files), **Send to Trimlign again** for a
lost print or a second set, or paint fixes and re-run. The big model files are kept for 30 days; after that only the
recipe stays (scan, settings, brush fixes, painted areas - about 15 MB per arch) and opening the case re-makes the
models in a minute. The case list also survives a restart (the last week comes back by itself).

Nothing reaches OrthoFactory without that click. Files dragged into the folder move to `BleachTray\done` when
processed, or to `BleachTray\failed` with an `error.txt`. The small black window "NLO Tray Maker" must be open on
the PC that runs the app (it starts by itself at sign-in; if it's gone, double-click `start_app.bat` in the app
folder). That one window watches the drop folder *and* serves the app page to the whole office.

## Cases from NLO Cases (the case tracker)

Retainer, whitening-tray and mouthguard cases are entered in **NLO Cases** first. Once the two are linked, those
cases wait here under **To make** at the top of the sidebar - patient, arches, what to make, remake / scan on file,
due date. Click one and drop its scan: the name, arches and tray types are filled in, and when the models go out -
**Send** to OrthoFactory, **Send again**, **Open in PreForm** or the print files - the case in NLO Cases moves from
*To make* to **Printing** by itself, with "put the models in OrthoFactory" / "sent the models to the printer" in its
history, and leaves the queue (a case started here shows *started* in the queue until then). A scan dropped straight
in, without clicking the queue, is tied to its waiting case by the patient's name: the same name, or a near miss of
it (a first name mistyped, e.g. *Jonh* for *John*, same last name) when only one waiting case fits, the kind of model breaking a tie;
the case's log says which one it was tied to. NLO Cases is told once per way out, so Send and then PreForm do not
log it twice. Linking, once: in NLO Cases, **Team & security → Lab PC → New setup code**
(or *Set up the lab PC*; it is the lab PC's own login, the same code the NLO Lab Bridge uses), copy the code, and in
the Tray Maker **Settings → NLO Cases** paste it and click **Link**. A new code made in NLO Cases means pasting it here
again (and in the Lab Bridge). The link can read the queue and add notes to NLO Cases' inbox, nothing else; the queue
items are sealed to a key this PC makes for itself (NLO Cases never gives its office key to anyone), and the setup
code and that key are kept in `jobs\tracker.dat` under Windows' own per-user encryption. Technical notes below.

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

Two things make the doctor's corrections count: a corrected arch weighs **three** base arches in training (where the
base set's gum line and the brush disagree, the brush wins), and the new model's **tooth threshold** - the cut on
its probability where tooth starts - is calibrated on the corrected arches and stored with the model (the shipped
model's is 0.65).

**The gum line follows the gingival crease.** The model is sure well inside a tooth and well out on the gum; in the
band between, it leans *tooth* on smooth gum (the labial and palatal gum next to the incisors, behind the last
molars) and leans *gum* on the low, smooth end of a crown (a cingulum, a canine's facial bulge) - a bare probability
cut gets one or the other wrong. The gingival sulcus runs between the two as a concave crease, so the band is
decided by a race: confident tooth and confident gum spread across it, crossing a crease costs up to ~12x the
distance, and each vertex goes to the side that reaches it first (`segment.snap_to_crease`). On a young arch
with high gum this took the labial and palatal spill off and gave the cingulums back in one go; on an adult arch
and an iTero arch it changed little.

The starting set ships with the app as `assets\base_training.npz` - per arch the per-vertex features and targets
the model learns from (numbers only: no scans, no names), so nothing has to be downloaded for retraining to work.
Full base cases under `training\_base\` (scan + labels) take precedence when present.

## Printing (print folder + PreForm)

Two things leave the app when a case is **sent**:

- the **OrthoFactory order** (Titan-style folder with the `.pts` trim line) goes to the Trimlign input folder, as always;
- the **printable models** (STLs, base and all) are filed in the **print folder**, one folder per patient and one file
  per model named by date, patient, arch and type:

      O:\clinical\3D printing\Models\
          Doe, Jane\
              2026-10-18_Doe_Jane_Upper_WT.stl      WT whitening tray, TT retainer template, MG mouthguard
              2026-10-18_Doe_Jane_Lower_WT.stl

  Sending the same case again replaces its files; a new case for the same patient on the same day gets `_2`, `_3`.
  The folder defaults to `Models` next to Titan's folder on the office share; Settings → *Print folder* changes it.

The models then open in **PreForm** on the PC that runs the app (the lab PC, where the Form 4B's software is) straight
from the print folder, so printing is the next click. They are written flat with the base on the platform (z = 0), so
they land horizontal with no supports; PreForm keeps its own last resin and layer height. **Open in PreForm** in the
Check & send box does the same any time, before or after sending (it files the models too). PreForm is found by itself
in its usual install folder (PreForm 3.6x keeps the program in a versioned subfolder next to `PreFormLauncher.exe`);
Settings → PreForm has the path if it lives somewhere else, and the switch to turn the open-on-send off.

**From any other PC** with PreForm installed, the button reads **Open in PreForm on this PC** (with a smaller *on the lab PC*
beside it), and a Send made from that PC opens the models there rather than on the lab's screen. Once per PC, Win+R:

    powershell -NoExit -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (iwr 'https://raw.githubusercontent.com/amooloo/nlo-apps/main/nlo-bleachtray/preform_link.ps1' -UseBasicParsing).Content"

(Settings → PreForm has a *copy the line* link.) It registers a small `nlobt:` link handler for that Windows user - no admin -
which hands the model files on the office share to the PreForm installed there. The first click shows the browser's
"Open …?" question; tick *Always allow*. The print folder must be on the office share for this (the default is).

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

A case keeps the patient it was made for: the page's name fields are filled from each new drop's file names (empty when
the name is not in the file name - then it has to be typed), and a re-run never renames a case from them; a case
without a name takes one through the patient line only.

## If a case needs a look

From any office computer open `http://lab:8765` — or click **Bleach Tray** on the NLO apps home page,
which opens it for you (the black window on the lab PC prints the exact address). Drop a scan anywhere on the page:
it processes on its own and writes the OrthoFactory order (the green line under the result confirms it). See the
result in 3D, paint over a tooth the computer missed (hold **Shift** and drag on the *Segmentation* tab),
re-run. The trim line is drawn as a thin tube lifted 0.16 mm off the model along the body's surface normal at each point (the pipeline keeps the normals in the state file and the report notes how far the line sits from the surface, `trimline_off_surface_mm`), so it lies on the model like a thread from every angle and never shows through it; the far side is only a faint whisper. The boxes over the viewer stay small: controls only, the explanation behind **?**, and **–** folds a box to a chip in the corner that brings it back. **Position on the base** (Result tab, folded by default - the chip opens it, and the base's handles - the thin blue ring and the draggable plate - exist only while it is open, so the plain view is just the model): the arch stays where it is and the *base plate* moves under it - drag the plate to slide it, drag the ring to turn it (or use the step buttons); the first touch flips the view to the underside with the plate see-through, so the locating holes are checked against the arch footprint (*Underneath (holes)* / *From above* switch the view). *Apply* re-makes the order, *Reset to automatic* goes back. The placement is kept **per arch** (`params.adjust_by_arch`): moving the lower touches the lower's two models only, the upper stays where it is, and a move that is not applied yet survives a look at the other models of the case. A turn / shift at the same height does not re-run the pipeline: the finished body (tooth mark included - it is put on the body before the base now) is moved as one rigid piece and only the base plate, the engraving and the files are made again (`replace_placement`, ~3 s a model instead of ~45); a height change (*Down / up*) rebuilds that arch's models. A brush fix likewise re-makes only the models made from the scan it was painted on. The page fetches the case's files (body, block-outs, trim line, brush mesh) with the browser cache bypassed and the server sends them `Cache-Control: no-store`: they are rewritten at the same URL on every re-run, and Chrome's heuristic freshness (a `Last-Modified` minutes old, no cache header) used to serve the previous body for a while after a move - the moved arch's trim line over the unmoved body, "the base shifted back and the trim line moved". (The numbers sent to the server are the arch's move relative to the base, as before.) **Text** (Result tab, its own chip under *Position on the base*): the text on the model shows the moment the box opens - a yellow card where it is now, and the letters themselves in yellow once made, so they are found at a glance; *Start → end on the model* then two clicks on the model lay the text between them (Titan's way: the middle of the text at the middle of the span, reading from the first click to the second, letters sized to the span), or drag the card; what it says (initials + W/R, last name + W/R, full name), *Raised* / *Cut in*, turn and size buttons, *Auto* for the molar again, *Apply* (seconds - the model itself is kept). *Make*: *Whitening tray + retainer* (default, both per arch), *Whitening tray 5-5 only* (reservoirs 5-5, line 1 mm onto the gum), *Whitening 3-3 only*, *Retainer only*
(line 1.25 mm onto the gums, semi-scallop), *Plain model*. The whitening tray's line sits 1 mm onto the gum by default (Settings → *Whitening tray line*, 19 Oct 2026): the Trimlign's bur is ~1 mm wide and runs centred on the line, so a line right at the gum line cut into the tray over the teeth; the extra millimetre leaves room for the bur and for finishing with scissors. A browser that had the old default (at the gum line) saved is moved to 1 mm once; the other choices stay as chosen.

---

## Technical notes

**What it writes.** A Titan-style OrthoFactory order folder in Factory #1's input folder:

```
<Titan folder>\2026-10-15 10 59 21 - A - Dr. Amir Akhavan - Jane Doe - 4ee1\
    125189205_1_Order.xml                  <OrderData Type="Titan_Angled"> … <Aligner Name="TU0A"> …
    Jane Doe - 0 - Maxilla.stl         solid horseshoe + Trimlign base (locating hole at the origin)
    Jane Doe - 0 - Maxilla.pts         trim line, same frame, CRLF
```

The order ID is 100000000 + the seconds since 1 Jan 2026 (9 digits, unique per send, a 32-bit integer like
Titan's; it was yymmddHHMM, 26xxxxxxxx, more than one holds). Piece letters as above (`bleachtray/orderfolder.py`:
`sent_revisions` reads every order folder of the patient, Titan's too; the case also remembers what it sent, since
Send again replaces its own folder while OrthoFactory keeps the piece).

**How it works.** Auto-orientation from geometry (occlusal up, anterior +y, midline from mirror-image tooth
pairs, cross-checked against a parabola fit of the gum-line loop; the shape midline is used when they disagree by > 8°). A gradient-boosted classifier trained on Titan's own tooth segmentation labels every vertex tooth/gingiva
from multi-scale curvature, height-below-cusp and radial-position features; teeth are separated along the arch from four cues (an interproximal classifier, incisal/occlusal
height dips, pinches of the crown outline seen from above, facial grooves) checked against expected tooth widths,
then flooded downhill from each tooth's centre; numbered from the midline. The band the trim line follows is made
**one piece** before the line is traced: where neighbouring teeth do not touch (an open contact, spacing, a small
gap the ridge step did not call a missing tooth) the tooth mask is islands and the gum line would be one loop per
island - the longest of which is half an arch, and the model built from it half a model standing off its place on
the base. Close islands are joined by a bridge along the shortest surface path between them (the gum between the
two teeth, 0.8 mm wide; `connect_line_pieces`, "gum line carried across N gaps"); if the line still breaks, the
edge zone is thinned and the band widened step by step, and a model that is still partial, or not watertight,
carries a red warning on the result line (`rep["warnings"]`). A **contact dot** from the doctor is
a boundary of its own: where there are dots they are the only boundaries on that stretch of the arch (automatic ones
inside it, and within 3.2 mm beyond its ends, go), and round each dot (2.5 mm in plan) the tooth vertices are given to
one side or the other of the vertical plane through the dot across the contact - the plane normal to the surface's
horizontal tangent there, which is the embrasure however the tooth is turned - before the flood, so the split passes
through the dot rather than where the height happens to dip. A dot's place along the arch is read where that plane
meets the facial surface (the arch coordinate is only dependable outside the arch curve), so a dot on the incisal
edge or the lingual side lands on the same boundary as one on the facial side. Dots are kept per scan file with the
other strokes (`paint[path]["contact"]`, shown as bit 32 in the brush mesh) and go into every later re-split; the
corrected labels train the interproximal classifier like any other lesson. The gum line
is the 0.5 iso-contour of the tooth mask; papillae are bridged with a 2D closing and snapped onto the surface.
Reservoirs are a feathered normal displacement on the facial surfaces, kept 0.5 mm from the gum line and 0.4 mm from the incisal edges, the neighbouring teeth and the facial-lingual transition (full height ~0.6 mm further in). The solid: clipped surface closed below the floor, unioned with a
steep skirt below the scan's edge, cut by vertical walls that stand under the scan's own edge (`hug_region`, see
*Floor and skirt*; never closer than 0.5 mm to the trim line, never past the horseshoe outline) with manifold3d booleans, unioned with a manifold rebuild of the Trimlign base at Titan's
placement (facial gum line of the centrals 6.0 / 4.5 mm in front of the locating hole for upper / lower; floor
3 mm below the lowest trim-line point). The model is one solid: anything the floor or the outline cuts loose from the
arch (cheek or lip tissue, scan islands) is dropped instead of printing as a slab lying next to the model.

**The Trimlign base and its locating holes** (`bleachtray/basebuild.py`, 19 Oct 2026). The base is taken once from a
Titan export (`tools/import_base.py`, at install) and rebuilt as a manifold by stacking horizontal cross-sections
0.05 mm apart, because Titan's own base mesh is not watertight. Its two locating holes (at ±7.47, -19.0) are clear from
the bottom to 3.5 mm, like Titan's (3.51). The first printed model came out with them "shallow by a lot": the lab PC's
base had been rebuilt from one of Titan's lighter exports (a ~17,000-face base instead of ~110,000), where the plane at
1.875 mm misses a single contour, the even-odd nesting of everything inside it flips, and that one slab came out solid
across both holes - a 0.05 mm skin at 1.85 mm that the printer prints, so the pins stopped at 1.85. (Which Titan export
the PC happened to import decided whether its base had the skin; the light exports all did.) The rebuild is robust now:
every slab is the majority of three sections a hair apart, a slab unlike both neighbours where they agree with each other
is replaced by the majority of the three, and the result is checked against Titan's mesh with vertical rays on a 0.5 mm
grid - no thin solid layer where Titan's base is open (a skin), the locating holes clear to 3.5 mm, watertight - and is
only saved when it passes. **When the app starts** it checks its base once (`ensure_base`, cached by checksum in
`assets/trimlign_base_manifold.ok`; models wait meanwhile) and rebuilds a base whose holes are blocked. A model finished
with an older base is finished again with the corrected one when it is **sent** (Send and Send again: `_rebase` compares
the report's `base_sig` with the current base; only the base plate, its engraving and the files are made again, a few
seconds a model), so nothing that was made before the correction reaches the printer with the skin. If a base could
not be rebuilt to pass its check, every model made with it says so in red. `tools/sweep.py` checks the holes in every
model it makes.

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
Titan export all work on it); its rebuilt vertices are recorded as paint bit 4 (grey on the Braces tab) and
the result line says how much came off. Scans with braces are kept out of the training set.
`remove_appliances` = False (default) / True. **Take off brush** (Braces tab): a bit of bracket,
wire or tie the app missed - or anything on a scan dropped without the box - is painted and goes through the
same cut-and-patch on the next run (no detection, what was painted is the appliance); the scan advances to `_clean2.ply`, `_clean3.ply`…, with the earlier
rebuilt areas, the painted no-reservoir / block-out strokes and a cut in the same run carried over by
position; saved brush fixes of tooth labels are dropped for that scan (the teeth are found again on the
rebuilt enamel). **Not a bracket brush** (Braces tab, 19 Oct 2026; the doctor: "there should be a paint brush that I
can use to paint non-bracket areas just like how there is a paint brush to paint brackets"): tooth or gum the
detector took for appliance is painted - on the smooth rebuilt enamel, where the app took it off - and on Apply
the take-off is done again from the scan as scanned (`_redo_take_off`) with the painted areas left out of it: the
strokes are kept by position in the scanner's own coordinates, with the painted surface's normals
(`job["braces_edits"][scan as scanned] = {not, not_n, add}`, in case.json), and `appliance.near_points` matches the
scan's vertices within 0.6 mm of a stroke point's normal line and up to 4.5 mm off the painted surface (what was
taken off stood over the smooth enamel the stroke is on - a lump of gum, a bump of enamel, a bracket's 3.5-4 mm tie
wings), never a surface facing the other way (the far side of a thin incisor); a piece the detector found that is
40 % or more under the strokes is left whole (`whole_pieces`: a 2.5 mm brush never covers a lump exactly, and half a
piece taken off leaves a step). Checked on the crowded iTero upper, painting over a bracket's rebuilt enamel: a
match by position alone kept 5-370 of a bracket's 1000-2200 vertices (the stroke lies a bracket's height under it),
so a pad was left with its wings shaved off and patched flat; with the normal lines and whole pieces every bracket
painted over came back exactly as scanned (1797 of 1797 vertices round it). Take off strokes are kept by position
too (`add`), so a later take-off from the scan as scanned still takes them off; a Clean-up cut made after the take-off
is made again on the new file. On a mouthguard the strokes leave the band (`paint.noshield`, paint bit 128), and
Not a bracket painted on the retainer of the same scan leaves it too. The strokes of a sent case go to
`training/<patient>/braces_<arch>.ply` + `braces_<arch>.json` (the scan as scanned, the strokes) - the lesson for the
bracket detector; the tooth labels of a braces scan stay out of the training set as before. Wire and ties left on at the eval scan make this harder (the wire floats across the
embrasures and hides the gingival enamel) - for a retainer scan, take the wire and ties off first and
leave the brackets; a mouthguard scan keeps everything (and the mouthguard model keeps the brackets, see below). Checked on 10 arches with braces (3 AlliedStar patients, 2
iTero; metal brackets, green/purple ties, molar tubes, a palatal expander) and 2 plain iTero arches: the
brackets, wire and ties are gone on all ten and the enamel reads as enamel; nothing is touched on the
plain scans. The incisal / occlusal band (never a candidate - translucent incisal edges and dark fissures
look like metal) is measured against the highest point within 4.5 mm, not 2.5 mm: a bracket or tube standing out
past the tooth's own outline is the highest thing in a small column round it, so its upper half read as "top of
the tooth" and stayed on - an iTero lower with lingually tipped premolars and molars (10/19/2026) kept most of its
premolar brackets and both molar tubes. With the wider band they come off; over 26 coloured arches the found
area grows 10-50 % on the braces scans, all of it bracket, tube and wire, and nothing new appears on the 9 plain
ones. Known limits: clear / ceramic brackets (tooth-coloured) are not found; molar bands and an
expander's arms are not bumps and stay (a band's outline can stay as a faint ridge once its tube is off); a **stainless-steel crown** is grey and stands proud like a bracket and
IS taken for one (seen on a lower, 10/17/2026 - the lingual wall of the crown was cut out and rebuilt), so
for a braces scan with a metal crown leave the box off and paint the brackets with the **Take off** brush instead;
the enamel under a bracket is a smooth reconstruction, not the scanned surface. That holds for a lone bracket on
a tooth in line (a patch of 15-30 mm²); on crowded teeth at initial bonding the brackets, wire and ties run
together into one area over most of a tooth's cheek side, or across two teeth, and what is rebuilt there is a
guess - flat or carved (a crowded iTero case, 10/19/2026: the upper incisors fine, laterals / canines and a lower
canine-premolar pair carved). Every rebuilt area over 40 mm² is red on the Braces tab and named in a red warning
on the case (`appliance.rebuilt_areas`). Braces on is meant for scans near debond, teeth in line; a retainer
from an initial-bonding scan would not fit after treatment anyway - the mouthguard is the piece for those.
A **mouthguard made from the same scan** as a retainer or whitening tray with Braces on keeps the brackets: only
the other models get the cleaned scan (until 10/19/2026 the guard got it too and was made with no room for the
brackets; a case from before goes back to the scan as scanned when it is run again).

**Mouthguard (braces on).** Tick **Mouthguard (MG)** on the scan (or choose the *Mouthguard (braces on)* preset),
scanned with the brackets, wire and ties on and the cheeks and lip pulled back so the scan goes as far into the
vestibule as it can - that is how deep the guard will go. The model keeps the brackets: the teeth are found on a
cleaned copy (brackets confuse the tooth split), but the body is built from the scan as it is, with every bracket,
tube and stretch of wire under one continuous **block-out band** (`mouthguard.appliance_band`, 10/19/2026 - before,
a cap over each bracket left bare tooth between them; the doctor: the block-out must be continuous): a spine runs
through the bracket and tube centres round the arch, as the wire does, and along it overlapping 6 mm windows every
2 mm each take the convex hull of the appliance in the window pushed out `mg_clearance` = 1 mm, the spine pushed out
as far, and the surface within 2 mm of the spine plus a 1 mm skirt round the appliance; the union is one band from
the last tube on one side to the last on the other, bracket height, bridging every embrasure at the wire's height
(the crowded iTero upper: 95 mm through 13 brackets / tubes). **One even thickness** (`uniform`, 19 Oct 2026; the
doctor: it looked like "giant bubbles that are connected together" - thick over the brackets, thin over the wire):
each piece's reach from its spine point is measured - how far out along the push, how far up and down (95th / 5th
percentiles of its cheek-side points) - and the median piece's reach plus the clearance becomes one cross-section,
swept along the whole spine (its outer face top, middle and bottom at every spine point in each window), with the
cheek-side tooth / gum surface across its height (facing out, within 3 mm inside the spine, never the far side of a
tooth) so it sits on the teeth; a bracket bigger than the median still gets its own room. The median, not a higher
percentile: on a scan with molar bands (5 pieces, 2 of them bands wrapping the crown) the 75th percentile made the
band 6.5 mm tall, over most of the incisors' faces; the median gives 4.4-4.7 mm, bracket height. The crowded iTero
upper: 1.9 mm out, 4.4 mm tall, 2.1 mL (1.05 before); the appliance keeps its room (99.6 %). The windows' flat faces read as blocks (the doctor:
"very blocky"), so the band is **rounded off** (`mouthguard.smooth_solids`): the windows are filled into a 0.2 mm
voxel grid (column by column - a convex window is one z-interval per column), padded 0.8 mm round the appliance
(blurring thins whatever is thin - a stretch over a tube and wire lost a quarter of its appliance before the
padding), blurred with a Gaussian of `mg_band_smooth` = 1.25 mm and taken by marching cubes at the level that keeps
99 % of the appliance inside with at least 0.7 of its clearance - every edge and corner between the windows is
then round over about 2.5 mm; where 99 % cannot be kept the rounding backs off to 1.0, then 0.75 mm (one patient's
palatal caps: 1.0). The band is joined to the model after the outline cut: before, the outline's walls cut flat
faces into it where it stood out past the crowns. Adds 2-3 s and ~70 MB to a case. Appliance more than 6 mm off the spine (an
expander's arms, a lingual wire) keeps caps of its own (`appliance_shields`, as before); fewer than 3 pieces round
the arch: caps only. So the sheet forms over a smooth channel instead of locking into the bracket undercuts. The trim
line (`mouthguard.vestibular_trimline`) is one closed loop: on the facial side it follows the surface down into the
vestibule to 1.5 mm above the scan's own edge (`mg_inset`; never less than 3 or more than 14 mm below the gum line,
measured from the running mean of the scalloped gum line, and never the inside of the lip); it rises in a rounded
notch 6 mm wide to 2.5 mm below the gum line at the frena - the labial one at the midline always (found as the
shallowest stretch of sulcus near the midline, assumed there if the scan does not show it), one buccal notch per
side when a clear one shows in the canine / premolar region; lingually it runs 6 mm onto the palate (`mg_palate`);
behind the last tooth on each side it hugs the tooth 2.5 mm back (`mg_distal`), the facial deepening fading out
over the last 4 mm. **Super smooth** (`mg_smooth`, 6 mm; 19 Oct 2026, the doctor: the line was "very jaggety, it needs
to be super smooth"): the depth below the gum line is a Gaussian over 6 mm of arch before the notches go in (never
deeper than the scan allows), and the finished line is smoothed once more on the surface (`_smooth_on_surface`):
palatal points by their position seen from above (the line no longer zig-zags over the rugae and the gum's
scallops) and dropped straight down onto the palate, vestibular points by their height (over 2 mm - the notches
stay) and moved along the arch's radius onto the vestibular wall; behind the last teeth the two blend into the
line as it was. A ray that finds the far side of the arch is ignored (the hit must lie within 3 mm of the old
point along the ray), a point with no hit goes to the surface point nearest its smoothed position, and a line with
a step over 1.5 mm is kept as it was (the log says so). **Smooth from every side** (20 Oct 2026, the doctor: "the
lines are not smooth from all angles"): seen from above the palatal stretch was smooth, but dropped onto the palate
it still rode up and down every ruga and jogged where the flange narrows - from behind it wobbled. So the palatal
stretch is then pulled smooth in 3D like a string drawn taut over the surface (`_taut_palatal`, 8 rounds): smoothed
(2G - G(G) of a Gaussian over half of `mg_smooth`, which takes out the wobbles but keeps the arch's own curve - a plain
Gaussian drew it in onto the palate), then put back against the surface: a point that went into the model comes out
onto it (the line rides over the rugae instead of dipping between them), none floats more than 0.5 mm above it, and
that correction is itself smoothed along the line (a noisy scan's facets would make it jitter). The vestibular
stretch, the frenum notches and points on a tooth's faces (behind the last molars, no room) keep their place, their
neighbours move less (no step where free meets pinned), and a point never moves onto a tooth, into the scan's edge
zone from outside it, or nearer the gum line than 2 mm. On the 6 test mouthguards: the palatal stretch's
point-to-point height jitter fell 1.4-10x on the five without a palatal appliance (95th percentile of the second
difference 0.08-0.24 mm before, 0.02-0.10 mm after); points moved 0.2-0.4 mm (median; at most 1.5 mm); the distance
onto the palate stayed the same (median within 0.2 mm); on the palate the line bridges the valleys between rugae by
up to 0.5 mm. With a palatal expander the stretch runs over the appliance and stays as it was. All six models
watertight, one piece. (One of them first came out with four zero-area sliver faces on one 0.001 mm edge at the back
wall - "not watertight" when read back; `pipeline._weld_slivers` now welds such an edge and keeps the result only if
the model is then watertight.) No reservoirs, no automatic block-out (the whole sulcus under flared crowns would count as
one undercut - the real vestibule is what the guard needs), the model still sits on the base by its gum line and
the body covers the crowns the way a tray body does. The Braces tab shows what is under the shield in orange;
**Take off** on a mouthguard adds the painted part to the shield instead of removing it (a tube the app missed),
and tooth / gum fixes work on the scan as it is. In OrthoFactory the guard is a Template piece, stage 2 (`MG`);
the base says MOUTHGUARD and the tooth mark is `G`. Settings: `mouthguard`, `mg_inset`, `mg_min_depth`,
`mg_max_depth`, `mg_palate`, `mg_distal`, `mg_notch_top`, `mg_notch_width`, `mg_smooth`, `mg_clearance`, `mg_band_smooth`. Known limits: the
band is a little fuller over the brackets than between them (a soft bead at each bracket); a 2x4 in the mixed dentition (molar bands + four
incisor brackets, erupting teeth under the gum) is still hard for the tooth split - the edentulous ridge comes out as
"tooth" (harmless for a guard) but the anterior palate may too, which pushes the palatal line back: paint it **Gum**
and re-run; a scan that stops at the gum line gives a line 3 mm below it and nothing deeper.

**Phase I retainer (mixed dentition, 20 Oct 2026; `bleachtray/phase1.py`).** AISA SOP-LAB-008 / 008A / 009. Tick
**Phase I (P1)** on the scan in the New case pop-up (or choose a *Phase I retainer* preset); the row then asks **how**
(and, for block-out, **which teeth**). A Phase I case is a case of its own: ticking it unticks the whitening tray, the
retainer and the mouthguard on that scan, ticking any of those unticks it (the doctor, 10/21/2026: "when you choose
Phase I, it should unselect retainer and whitening"), and Add-model on a Phase I case offers only the Phase I retainer
for the other arch. The retainer covers the four incisors and the E/6 segments; the Cs and Ds come out. The app ticks
**C and D on each side** (positions 3 and 4 from the midline); the chips add a **5** that is partly in or untick a C
already lost. A ticked position with no tooth in it (the C gone, the canine on its way) is cut out as the space it
left. **Nothing over the 12-year molars** (the doctor: "we're waiting for teeth to erupt in, I don't want anything
blocking them"): on a Phase I the retainer ends at the 6's distal wall; a 7 and its gum are left out of the line by
both methods, and the model is scooped there like a cutout so the bur runs along the foot of the 6's wall. It is an
Aligner piece of its own, stage 3 (`AU3A` / `AL3A`); the base says PHASE I and the tooth mark is `P`.
- **The line hugs the gingival margins** everywhere - 1.25 mm onto the gum, as the first trim (the doctor: "it just
  needs to hug the teeth ... dropping it down into the palate makes the retainer weaker"). **Upper:** the palatal
  edge follows the gum line along the E/6 segments and round the windows; only the plate behind the incisors stays,
  open behind the Es - the U runs from the D/E contacts straight out past the back of the scan, corners rounded - and
  a bridge of plate at least 5 mm wide joins it past each window to the gum line along the Es (`p1_plate_mm` > 0
  would put arms that wide along the E/6 segments instead). **Lower:** a lingual flange 4-10 mm deep (as deep as the
  scan goes, 1.5 mm short of its edge), eased round the arch, a notch at the lingual frenum; the window stops 1.5 mm
  onto the tongue-side gum so a bridge of flange joins the incisors to the back teeth. The flange ends with the teeth:
  behind the last tooth on each side it eases to the gum band over 4 mm of arch, so the line wraps the last molar's
  distal as the first trim does (one scan held the pad behind a 6 12 mm back, and the flange ran out along it - a lobe
  of retainer behind the molar, 10/21/2026). When the scan holds too little
  tongue-side gum under the C/Ds for that bridge the case says so; when the windows would still cut the retainer into
  pieces, the line is the first trim without windows and the case says to cut the C/Ds by hand or use block-out.
  **One piece:** the retainer is the largest connected part of the covered region; a part the scan's edge zone cuts
  off from the rest (the gum behind a molar on one lower) is left out of both lines and the case says so - built
  round the main part with a cut line that still went round the stray part (its region closed 2 mm, which bridged
  the gap), the line hung 12 mm off the model in the air. Both lines are put onto the model's surface whatever the
  drop under a point (over a scooped 7 the first-trim line hung 5.6 mm in the air with the usual 4 mm snap).
- **Cutouts (CUTT, the default).** Two lines: the model is built round the *first-trim* outline (the whole arch, so
  the sheet forms over it as on the first trim), and the Trimlign cuts the line *with the windows*. **The window is
  the same stretch of arch on every case** (the doctor, 10/21/2026: "the cutout starts half a millimeter after the
  lateral, regardless if there's a tooth there or not - that's the space for the canine - and continues to about a
  quarter into the crown of the E; that is the extent of the cutout at any given time, regardless of what teeth are
  there or not"): by angle round the arch's centre, from 0.5 mm past the 2's distal to 30 % of the way into the E's
  crown (its mesial third; to the 6's mesial when there is no E/5), whatever stands in it - the C, the D, the space a
  C has left, a 5 half in. The chips on the page do not change it (they say which teeth a block-out covers). **Or the
  doctor's own dots** (the Phase I tab, 10/21/2026: "I can identify the width of the cutouts by 2 clicks - the
  mesio-distal span"): two dots on a side and the cutout runs from the nearest to the farthest of them round the
  arch, the dots its walls (a crown is cut at the dot as the E is at its 30 %), the line 0.3 mm beyond each wall on
  what stays; on block-out the block covers the crowns whose middle lies in the span. One dot alone is not enough
  and the case says so. An **Ends here** dot on a side leaves everything behind it out (the teeth behind it count
  as uncovered, like the 7s) and ends the flange there. A **6 is here** dot names the first molar on a side: the
  side's count moves so that tooth is the 6 (the one in front the E, anything behind a 7) - on one upper a space
  between the 2 and the C counted as a tooth already gone, the 6 became a "7" and the retainer cut it off
  (10/21/2026). The dots are vertex numbers of the scan file, kept with the case like the painted areas (`p1span`,
  `p1end`, `p1six`; `/api/jobs/{id}/p1dots`), re-indexed through a cut. **The
  window is scooped to a trough** (`scoop_trough`; the doctor, after watching the Trimlign's simulator: "the gums in
  that area need to be scooped out as well, to allow for the passage of the tool head"): everything in the stretch -
  the crowns, the E's mesial third, the gum, all of it on the cheek side and out to the window's edge on the tongue
  side - is cut down to a floor 1 mm below the lowest point of the first-trim line on the cheek side of the window
  (the gum line there), so the tool's head and shank have room inside the window to reach the line round it. The
  teeth that stay keep their surface (the 2's distal wall and the E's cut face are the trough's walls); the gum beside
  the trough keeps its height, the floor easing up to it over 2 mm. **The line runs on the rim**: beside the 2 on the
  kept gum 0.5 mm off it, at the E on the E's own crown 0.3 mm past the cut, on the tongue side along the gum line
  (1.25 mm onto the palate; 1.5 mm onto the lower's lingual gum). Both lines are traced on the scan as it is and put
  onto the scooped surface after (its nearest point - the rim): traced on the scooped surface, a contour crossing an
  edge of the trough's wall (the dropped rim next to the E's kept crown, 9 mm apart in height) sat part-way down the
  wall and the line dived 5 mm into the trough and back at the E's cut edge. A chosen tooth's label on these scans
  runs a few mm onto the gum (a C's label was 12 mm across): its crown is what stands within 4.5 mm of its top and
  within 5.5 mm of the centre of its top (`crown_of`), the rest is gum. A space where a chosen tooth already stood is
  the gum between its two neighbours, and the first-trim line bridges it along the ridge's crest
  (`edentulous_gaps(ridge_band=1)`). Beside each window no sliver of plate under 2 mm wide is left.
- **Block-out (BOTT).** No windows: one solid block per side over the run of C/Ds, built into the model in place of
  the putty (`block_outs`) - not shaped to the teeth under it (the doctor: "a solid block, almost like a blob that is
  smoothed out on the top ... don't try to match the anatomy"), with **2 mm of room round the teeth** as the
  mouthguard's band has round the brackets ("clearance on the buccal, on the lingual ... so if the teeth are coming in
  sideways they're not hitting the tray"). The block is the convex hull of the crowns pushed out on every side and
  lifted on top: the push is the full 2 mm from the top down to 2 mm below each crown's top, then **tapers to nothing
  at the trim line**, the gum between the cervical and the line taken into the hull - the block's sides run down into
  the model like putty feathered onto the gum, its foot on the gum right at the line, so there is no shelf and no space
  under a foot and the sheet's cut edge points apically, not at the cheek (the doctor, 10/21/2026: "edges that are
  overhanging with a space under them are where the patient's lip gets irritated - a smooth transition apically into
  the model; the edges of the retainer should not be pointing towards the cheeks or the lips"). Under its footprint
  the block is filled down to the model (the embrasures, the undercut under a crown's bulge down to the gum, never
  below the line); it stops 0.8 mm short of the 2 and the E. **The trim line matches the block**: a point of the line
  that would lie inside the block is put on the block's side (`_line_onto_model`; the case says how many) - "the trim
  line kind of disappears into the block-out". On top the block stands as high as the bite allows - over every crown
  point at most half of the room up to the opposing tooth (less 0.2 mm), at most 2 mm, never under 0.3 mm over the
  cusps - so with both retainers in the C/Ds are never the only point of contact (the doctor: "as large as possible
  without really being the only point of contact"). The bite is the case's other arch, as scanned (AlliedStar and
  iTero export the two in occlusion); without it the top is a flat 0.5 mm and the case says to check the bite; when the
  opposing teeth still dip into the block's top over the fossae (a tight bite) the case says by how much, to judge on
  the occlusion before cutting. The blocks show on the page as the block-out. A chosen tooth's label that runs onto the
  gum (a C's label was 12 mm across) is trimmed to its crown before the line is drawn, so the gum line hugs the real
  cervical: the line sat 2-5 mm below the C/Ds' cervical on one scan, and the block's foot with it.
- **No sharp turns** (the doctor: "it's not adapted tightly to the teeth, so it doesn't need to be semi-scalloped - only
  the buccal of 2-2 and the buccal of the 6s and E/5s"): both lines are smoothed along their length with a 2.5 mm
  Gaussian everywhere - round the windows' corners, behind the last tooth, on the palate / tongue side - except on the
  cheek side of the teeth that stay, where a 1 mm smoothing keeps a gentle scallop (`round_line`; the weight fades over
  3 mm); the result is put back onto the surface.
- **No hairpins.** The palate region inside the first-trim line is the line's own lingual pass in its own order
  (sorted by angle from the arch centre it cut chords across the concavity round the D's palatal bulge and left a bare
  strip between the gum band and the plate - the line round that strip was a hairpin on one case, 10/21/2026), and a
  bare slit narrower than 3 mm between two covered parts is covered. Every line is checked for places where it doubles
  back on itself (two points under 1.6 mm apart but more than 6 mm apart along the line); the case warns when it does.
- **The 5 mm rule** (the doctor: "min 5 mm - if below that reject the cutouts and just do block-out"): on a lower the
  flange left under the windows on the tongue side (what the scan holds below the window's edge, the 10th percentile
  along the C/Ds) must be 5 mm or more; when it is not, the cutouts are rejected and that arch is made by block-out,
  and the case says so with the figure. Two of the three test cases' lowers fell to this (0 and 2.3 mm); the iTero
  case's lower (5.8 mm) kept its cutouts. The upper's bridge of plate past each window is 5 mm by construction.
- **Tooth numbering on a Phase I.** The teeth are counted from the midline (the width-based renumbering is for the
  permanent dentition: a lower E of 11 mm read as a first molar, and the D behind a C became a "5"), a space of 2.5 mm
  or more between neighbours counts as a tooth already gone (three of four Phase I cases had one), and a tooth label
  that stands 3 mm or more inside the arch and low (palatal gum beside a 2 the tooth model took for a tooth, on both
  sides of one scan) is made gum again before the count (`drop_ghosts`).
- Checked on 3 Phase I cases (two AlliedStar, one iTero; 6 arches): every one got its windows from the 2 to the E's
  mesial third (or the C's space) with the model scooped to a trough; every model came out watertight, no line
  doubles back. One lower scan holds no tongue-side gum under the C/Ds at all (the flange is the 4 mm minimum): its
  line carries the warning. The Phase I line takes about 5 s on top of the usual run. Settings:
  `phase1`, `p1_method` (`cott` / `bott`), `p1_teeth` (`["R3","R4","L3","L4"]`), `p1_plate_mm` (0), `p1_apex_shift`,
  `p1_cut_palatal_mm` (1.25), `p1_flange_max`, `p1_scoop`, `opposing_scan` (BOTT: the other arch's file).

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
gum line everywhere (Settings → Reservoirs). Recession itself is the doctor's call: by default the app does **not**
pull reservoirs off roots on its own - on a patient with recession, open the Reservoirs tab and **Erase** where the gel
must not go (the erased patch keeps the reservoir 1 mm away, a setting). The automatic detection is still there as
Settings → *Exposed root* → On; it was switched off because a gum line the model drew too low looks exactly like a
long root to it, and the priority is getting the gum line right first. Switched on, it looks for root showing on the
facial side two ways: the mid-facial profile (an exposed root runs near-vertical or inward for ≥ 0.75 mm above the
margin before the enamel climbs outward; a healthy crown climbs from the margin) and the clinical crown length
against the typical anatomic crown + 1 mm. Where root is found the reservoir stops above it plus a leeway (1 mm,
a setting), and the result line names the teeth. On 15 scans: 0-2 of 10 reservoir teeth flagged on young
orthodontic patients, 7 of 10 on an adult with generalised recession. Paint *No reservoir* for anything it misses.

**Short crowns and premolars.** The incisal / occlusal cut is judged against each tooth's own facial slope (an
incisor's face is near vertical, a lower premolar's leans in and faces up ~35°), so a premolar keeps its face rather
than a sliver at the gum. On a short clinical crown (young patient, gum still high - 4-5 mm of premolar face) the
ramps from the gum set-back and the incisal clearance shorten in proportion, and each tooth reaches full height on
its own plateau; the reservoir is still smaller there than on a tall incisor - there is less tooth - but it is there,
and the same on both sides. (The scan-colour step is seeded, so the same scan now gives the same result every run.)

**Strokes on both arches, one Apply.** Brush strokes are kept per scan file while the case is open: paint the upper, click the lower's model button and paint that too, and *Apply & re-run* sends both (the page posts a list of edits, one per scan file; the whitening tray and the retainer of an arch are made from the same file and share its strokes, a mouthguard made from the scan with the braces on has its own set). The count line under the brush says how many strokes wait on the other arch; Send and Save as lesson refuse while any are unapplied. Only the models made from a painted file are re-made.

**Clearing a block-out.** The Block-outs tab has a *Clear* brush: a painted block-out (pale green once applied) is taken away where the stroke goes, on the next Apply. Automatic block-out never fills the labial or lingual face of a crown itself: a proclined incisor's labial face leans out over the gum and reads as an undercut along the pull, but filling it would put a flat wall on the whole labial (seen 10/18/2026 on test strokes). An overhang whose underside faces across the arch (outward or inward) is such a face and is left alone; the proximal walls of an embrasure face along the arch and a pontic's underside faces down, those are filled. A painted stroke on a labial face is still honoured - the doctor asked.

**Tooth numbering: the midline and missing teeth.** Positions (1 = central .. 7 = second molar, per side) used to come from counting outward from a midline found by the angle about the arch's ring centre. On lower arches that split was one tooth off more often than not (incisors are 5 mm wide: a 2-3 mm error in the centre or the yaw flips one to the other side), and then one side's first molar was a "5" with a reservoir and the other side's second premolar a "6" without - the asymmetric reservoirs seen on 10/18/2026. Now every gap between neighbouring teeth is scored as the midline: distance of its contact from the arch's own mirror axis (`symmetry_frame` on the tooth vertices), how unlike the two sides' mesiodistal widths are when paired from there, and a lopsided count (`segment._midline_split`); on 24 arches this gave 7/7 wherever the old split gave 8/6. After that, `number_by_type` aligns each side's width sequence to the textbook widths (`TOOTH_WIDTHS`, averaged with the other side's own widths when that side is complete and plausible) by dynamic programming that may leave positions empty at a per-position cost (`SKIP_COSTS`: premolars cheap - extractions; canines and upper centrals dear), never un-does a gap `edentulous_gaps` found, and only overrides the count when clearly better. So a lower with a missing incisor and the space closed keeps its molars at 6-7 and the canine at 3; the result line says when it happened and the report keeps `renumbered`.

**Erased reservoir.** A *No reservoir* (Erase) stroke is the doctor's line: the reservoir ends at the edge of the stroke, with its 0.6 mm slope on the kept side - it used to stay a further `recession_leeway` (1 mm) away all round the stroke, which ate the reservoirs on a recession case to small ragged islands (10/18/2026). The leeway now applies only to root the app found on its own (switch in Settings).

**Needs scikit-image** (its marching cubes builds the fill solids). It was missing from `requirements.txt` until
10/19/2026, so the lab PC made every retainer from 10/18 without block-out - painted outlines included, since one
failure took the whole step down - and only the log said so. Now each part (contact fill, gap fill, painted) is
made on its own, and a part that cannot be made is a red warning on the case.

**Interproximal fill (the automatic block-out).** The way aligner labs fill their models (uLab's "digital fill"):
one wedge under every contact, by construction - not found by hunting for undercuts on the surface, which put fins
on the line angles of crowns (10/18/2026). `bleachtray/interprox.py contact_fills`: for each pair of neighbouring
teeth (consecutive positions on a side, the two centrals across the midline; an open contact wider than 1.5 mm is
left alone) the contact - the closest points of the two crowns' upper halves - sets a local frame; level by level
(0.25 mm) below it the two crowns' outlines in the level are the convex hulls of their surface points in a 4.5 mm
slab, and the notch between them on each side (buccal / lingual) is the region within *reach* of both outlines,
closed by a flat face across its mouth (the hull of that lens) - so the fill is flush with both crowns and can
never be a sheet on one of them. Each side ends where the papilla has closed the notch (gum on the notch's axis
reaching its mouth); the fill is a **triangle** standing on that level (and a step into the gum): full reach at the
gum, narrowing to a point at the contact (or at `top` mm above the gum when that is set lower) - as the doctor drew
it; it reaches `reach` into both crowns, so the union makes one solid - the fill goes into the teeth and its edges
are inside them, nothing thin sits on the outside. **Next to an edentulous space** (`gap_fills`, one per tooth
flanking a gap from `edentulous_gaps`): the second rule of the drawing - a straight vertical face starting
`fill_retention` (0.5 mm) below the tooth's height of contour on the gap side, so the top of the undercut stays for
grip, the undercut between the face and the crown, then the ridge sloping away under it, filled down to where the
ridge reaches the face, flush with the crown's width; a crown that widens all the way to the gum has its face at its
foot. (Not yet seen on a real undercut next to a gap - the scans at hand have high ridges; check on the next case
with a missing tooth.) The stacked notches are voxelised (0.2 mm), marching-cubed and
Taubin-smoothed; all fills go into the body union as one extra solid and are shown teal. Settings (retainer):
**Interproximal fill** on/off (**off by default** - it is rarely wanted on every contact; the usual case is a chosen
spot, outlined on the Block-outs tab), **Reach out of the embrasure** (uLab's Buccal / Lingual, 1.25 mm),
**Fill height above the gum** (20 = to the contact). The report says "N of M contacts filled, K faces next to
a gap" and lists the contacts left out and why. The whitening tray gets none (soft tray). Anything else - under a pontic, round an
implant crown - is painted on the Block-outs tab and filled by the column method below.

**Painted block-out.** The space under an overhang the doctor marks out - a bridge pontic, the emergence of an implant
crown, a black triangle - is filled like block-out resin (`bleachtray/blockout.py`). Marking it out is the **Outline**
tool on the Block-outs tab (the default there): Shift-click corner after corner round the area - each corner is joined
to the last along the surface as a thin painted line - and click the first dot again to close; everything the loop
encloses becomes the painted area (the same component fill as a brush stroke that comes back onto itself), Esc drops an
unfinished outline. The corners are kept with the case (`paint[path]["outlines"]`, corner vertices, sent with the
strokes and remapped like them through a take-off or a cut) so the outlines drawn over time can teach the automatic
block-out where they are wanted; the *Block out* brush is still there. On a 0.3 mm grid every vertical
through the model that passes an underside and then free air before the next surface is a candidate; it is filled
from that surface up to the underside under a painted *Block out* stroke, whatever its depth. A fill only
goes under an overhang within 1.5 mm of a tooth and only where a real surface shows under it - the vestibule's own
overhangs (the scan's rolled edge, a frenum) are not the tray's business - and no fill ever reaches below the model's
floor, and an automatic fill stands on nothing more than 2 mm below the gum line (the cervical margins round
about) - the root prominence's hollow further down is below the trim line. The fill is shaped the way the doctor
drew a blocked-out pontic and implant crown: not a vertical wall under the contour but a **straight sloped face** that
starts 0.3 mm under the height of contour and runs down and in to the gum, its foot 65 % of the undercut's depth in
from the contour (`taper_start`, `taper_foot`) - inside the foot the fill stands on the gum, outside it hangs under the
crown with air beneath, and at the contour it thins to nothing, so the tray formed over it still has some grip under
the contour and nothing stands proud of the tooth. (`taper_foot=0` gives the old vertical wall with a bevel at the gum.)
The sloped face is laid on the fine 0.1 mm grid as geometry, after the heights are smoothed, and the depth each column
sits in from the contour is measured from the fill's own outermost columns on a silhouette with its holes filled (a
coarse occlusal used to read as the edge). **Painted block-out wall** (Settings, mm, default 0) moves the contour the
fill reaches to: positive stands it out beyond the contour (the ring carries the fill's own edge height, only where that
height is in the open), negative leaves that much of the undercut for grip. The undercuts are found on the teeth
*as scanned*: a whitening tray's raised reservoirs are taken off again for the detection, because their feathered
edge read as a shallow overhang all round the cervical third and a painted area grew thin scoops under every
reservoir (10/18/2026). The fill is one heightfield solid (0.1 mm grid, rounded outline, heights smoothed within the
fill only, then a volume-keeping Taubin pass that takes the grid's staircase off the walls) unioned into the body before the outline cut; a steep underside (a tipped molar's mesial face) crosses only every other grid column, so the columns between join the fill with their neighbours' heights (the comb of thin slabs seen 10/18/2026); a fill that could not be joined is reported as such and
not shown. It is shown in teal in the Result view and saved as `<name>_blockout.stl`.

**History.** `jobs\<case>\case.json` is the recipe of a case (scans by relative path, settings, brush fixes as
`fixedlabels_*.npz`, painted areas, review state, when it was sent, the last 400 log lines and the last error); it
is written the moment a case is made or a model / arch is added to it, whenever a run finishes or fails, and when the
case is sent / saved / discarded, and indexed at start-up (folders from before the history existed get one built
from their report files) - so a case survives a restart from its first second, with its log, and a model added
just before a restart is not lost. `/api/history?q=` searches it; `/api/history/<id>/open` brings a case back into the live
list, re-running it from the recipe when its outputs have been thinned. Outputs older than `KEEP_OUTPUT_DAYS` (30;
env `NLO_KEEP_OUTPUT_DAYS`) lose the model / body / Titan-copy files (the Titan pair is a hard link of the model, so
it costs nothing while it exists). Nothing is ever deleted whole.

**Marks.** Two: (1) the patient's initials + W (whitening) / R (retainer), raised 0.35 mm on the buccal surface of a
first molar (right side if present, else second premolar / second molar), each letter on its own tangent plane and
the text shrunk to the flat middle of the crown - it forms into the tray itself, like an aligner maker's mark, with a
recess on the inside that touches nothing; (2) the name and WHITENING / RETAINER engraved 0.4 mm deep on the flat strip
of the base plate inside the arch, when the arch leaves at least 8 mm of room there (skipped otherwise - the result
line says why). Switch off under Settings. The mark on the model can be **put anywhere**, from the **Text** box on
the Result tab (its own chip - not hidden in the base placement): opening it shows a card on the model at once, with
the letters drawn on the card until they are made and as a thin frame with end handles once they are, and the made
letters themselves are drawn in yellow (`<name>_mark.stl`, the letters alone, written by `apply_mark` next to the
model and served as `file/mark`) so the text no longer disappears into the stone. **Place** is Titan's two-point
placement: *Start → end on the model*, click where the text should begin and where it should end - the text is
centred between the two on the surface, reads from the first click to the second (the angle comes from the line between
them in the surface's reading frame) and the letter size is fitted to the span (1.4-4 mm cap); or drag the card onto any
tooth or onto the side wall, turn it (15° steps), size the letters (A- / A+), choose what it says (initials + W/R,
last name + W/R, full name), raised or cut in; *Auto* puts it back on the molar. The text is laid along the surface's horizontal tangent at the spot, each letter on its own
tangent plane, upright for someone looking at the spot from outside with the model standing on its base; it is kept
within the surface (shrunk to the room on the shorter side, a letter that would hang past the end of a wall is left
out and the log says so). The placement is kept per arch in the scan's own coordinates (`params.mark_by_arch`:
`{raw, angle_deg, cap, text, raised}`; the page sends a spot in the output frame and the server converts it with the
arch's `transform_raw_to_output`), so it follows the arch through base moves and re-runs; the body before the mark is
kept (`*_body_plain.stl`) so moving the mark alone re-finishes that arch's models in seconds (`apply_mark`, in the full
run and in `replace_placement`), while *Auto* needs the teeth and runs the arch again. The report carries where it sits
(`mark`: anchor, normal, reading frame, cap, width, text). A model that is not watertight cannot take the boolean that
joins the letters: it is repaired first (meshfix) and, if that fails too, raised letters are laid on it as separate
pieces (they print) rather than nothing; when there is no text at all the Text box says why (`mark_error`), instead of
an Apply that does nothing. (19 Oct 2026: on the lab PC every meshfix repair had been failing with "No module named
pyvista" - pymeshfix's `.mesh` needs pyvista, which the PC does not have - so a scan whose skirt did not close went out
not watertight, with no text and no base engraving; the repair reads pymeshfix's `points` / `faces` now.)

**New case pop-up.** Each dropped scan is a row with the arch icon the viewer uses (upper / lower, greyed until the arch is known), upper listed first and lower second whatever the order they were dropped in; changing a row's arch moves it and its icon.

**Settings.** The gear at the top right of the page opens a panel over the whole work area (compact cards, five across on a lab screen; the two tabs never wrap) with two tabs - *Model settings* (reservoirs, trim lines, base, marks, bulk-drop defaults) and *Office* (learning, the Trimlign / scanner / print folders, PreForm) - where every number has a picture of what it means;
*Apply to this case & re-run* re-makes the open case with the changed settings - only the models the change touches
(a retainer-line change leaves the whitening trays alone), brush fixes and painted areas kept
(reservoir region / depth / distance to the gum / leeway at exposed roots, the two trim lines, interproximal fill (reach, height) / painted block-out wall,
how the line crosses between teeth, rim, floor depth, the cut behind the last molar, levelling, marks,
bulk defaults, learning, the office folders). Settings are
remembered in the browser; *Back to defaults* resets them. The whitening tray and the retainer have their own trim
line and reservoir settings, applied on top of the model type.

**Floor and skirt.** The model floor is 3 mm below the trim line's lowest point, unless that point is a stray dip
(flap, pocket): then the floor follows the 10th percentile and the dip is lifted to 0.8 mm above the floor, so one bad
point cannot make the whole model 10 mm taller. **No shelves (19 Oct 2026):** the body used to be cut at the horseshoe
outline, 3 mm beyond the trim line seen from above, and wherever the scan stopped short of it a nearly flat "gingiva
shelf" filled the gap - but the scanned gum below the line runs almost straight down (measured on one upper: its edge
~1 mm out from the line and 4-5 mm below it), so every scan that stopped above the floor got a ledge round the
model. Now the walls stand under the scan's own edge (`hug_region` in `solid.py`): the edge seen from above, pulled in
0.5 mm so the cut runs through scanned gum rather than along its ragged rim, notches under 3 mm closed and corners
rounded (1.5 mm), inside the outline. The walls drop straight to the floor under the scanned gum, as in Titan's
models. Round the trim line (the line's region plus `hug_rim`, 0.5 mm, seen from above) **and every tooth** (all
tooth points on a 0.4 mm grid, plus the same rim; block-out fills and the like the same way, `solid.footprint`) the
scan is kept as scanned
with its own edge dropped straight down: the cut is the walls' region together with the line's, and the skirt is made
only inside the walls, so the line is never cut and nothing is filled in under it where the gum runs straight down or
under (one cut - an earlier try that cut twice and joined the pieces left zero-thickness slivers where both copies of
the scan met). In the notches the rounding closed, the skirt falls steeply from the scan's edge (`HUG_SKIRT_SLOPE`,
2 mm down per mm out): a bevel to the floor, never a ledge. `hug_walls=False` puts the old outline cut back; the report's `walls` gives the floor
area against the outline's. Checked on ten scans (uppers and lowers, PLY and STL exports, one from an iTero, retainer
and whitening lines) and a mouthguard: the flat area low on the model's sides went from 110-455 mm² (5 on the iTero
scan, which already reached the floor) to 1-16 (what is left is the patient's own anatomy, like the buccal shelf), the
trim line untouched (the same distance to the model at every point), every body one watertight piece with no
non-manifold edges (the old cut's bodies, saved and read back, had 100-300 from zero-thickness slivers the shelf union
left; the pipeline's clean-up removed them later). The newly bared base plate is all inside the arch, where the plate
always shows. **The teeth are in the kept region (19 Oct 2026, evening):** the first version kept only the line's
region and cut the rest with vertical walls - but a proclined crown leans 1-3 mm out past its own gum line seen
from above, so the walls shaved the front of it flat (a patient's upper centrals, on a mouthguard; on 9 of the 10
scans some tooth points were cut). With every tooth's outline in the kept region no tooth point is cut on any of the
ten scans or the mouthguard (that guard: 0 of 39,508), except what an earlier step trims on two scans (the same
with the old outline cut). Models made with the first version (19 Oct, after the update that removed the shelves)
should be made again.

**NLO Cases link** (`app/tracker.py`, 19 Oct 2026). NLO Cases keeps every case sealed with its office key, which this
PC never has, so the flow is: this app makes a P-256 key pair once (`jobs/tracker.dat`, DPAPI-protected on Windows,
`PLAIN:` elsewhere for the tests), signs in to NLO Cases' Firebase project over HTTPS with the lab PC's robot login
from the setup code (`NLOLAB1.` + base64 JSON `{p, k, e, w}` - the same code the NLO Lab Bridge takes; `parse_code`
refuses anything else), publishes its public key to `labqkeys/<login uid>` (again every 6 h, a fresh `at`), and reads
the `labq` collection every minute: one document per waiting case, `{kid, epk, iv, ct, at}`, written by NLO Cases with
each save of a retainer-flow case at *To make* and deleted when the case moves on. The box is NLO Cases' own
(`Crypto.sealTo` / `openFrom`): ECDH P-256 with an ephemeral key → HKDF-SHA256 (32 zero-byte salt, info = the box's
label `labq:<case id>`) → AES-256-GCM with the label as AAD; `cryptography` does the same here (cross-checked both ways
against WebCrypto). Items sealed to another `kid` (an earlier link of this PC) are counted as skipped and left alone -
NLO Cases re-seals them on its next save. The opened queue is cached in `jobs/tracker_queue.json`; `/api/queue` gives
it with what this PC has done about each case (the live job started from it: `here`), `/api/tracker` the link's state,
`/api/tracker/link` (the code) / `unlink` / `refresh`. On **Send**, a case that came from NLO Cases
(`params.tracker_case`, set by the queue click or by the `?case=` URL from NLO Cases' *Make models*) gets a sealed note
in NLO Cases' inbox - `{bt:1, v:1, case, patient, models, at, pc, how}` sealed to the office inbox key read from
`meta/inbox`, under an id `m` + 40 hex like the lab bridge's - and the case is hidden from the queue here at once
(`sent`); NLO Cases notes the models on the case (`btModels`), moves a case still at *To make* (`print`) to
*Printing* when its flow has that stage, logs `{a:'bt', models, how, from, to}`, and deletes the queue item. `how` is
`orthofactory` (Send, Send again) or `printer` (Open in PreForm, print files); `_tell_tracker` sends one note per `how`
per case (`job.tracker_told_how`). A case not started from the queue is tied to it on creation and again before the
note (`_match_tracker`): the queue item whose normalised patient name equals the case's, else one with the same last
name, the whole name at `SequenceMatcher` ratio ≥ 0.85, an overlapping arch and model kind - only when exactly one fits
(the kind breaks a tie between two cases of the same patient). Tested end to end against the Firestore emulator in
`nlo-cases-src/test/traymaker_match.mjs`. The queue never carries
anything clinical: patient, chart #, arches, tray kinds, remake / scan on file, dates, who's on it. The rules on NLO
Cases' side (19 Oct 2026): the robot may read `labq` / `labqkeys`, write its own key entry and add inbox items, nothing
else; staff write and delete queue items. `cryptography` is in `requirements.txt` for it.

**Scanner exports.** Open-shell or closed-shell (iTero "with base", 3Shape solid) STLs both work: a large flat floor is
detected and removed before orientation, the skirt reads as gum. The scanner's own **fill-ins** are left out too
(`strip_reconstructed`): where the scanner saw nothing - under the lip, the floor of the vestibule, behind the last
molar - its software fills the gap with large flat triangles (an iTero export carries 1,500-4,000 mm² of them; a
scanned surface has triangles of 0.02-0.3 mm², these are 1-300 mm² each). Left in, such a patch reaching the floor
became part of the model: a flat ledge sticking out at the base where the gum should end ("the extra pieces where an
area is reconstructed"). Faces over 0.6 mm² are removed, never more than 8 % of the surface (a coarse mesh all over is
a decimated scan, left alone); the log says how much went, and the model's skirt takes over where the real surface
ends. Scans over 200k faces are decimated first.
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

**Checking the app.** `python tools/sweep.py <folder of scans> [--out DIR] [--thumbs]` runs every scan the way the
app does (whitening tray + retainer, the page's default settings) and checks each result mechanically: ran without
error, body watertight, base joined, trim line long enough for a full arch, plausible tooth count and volume, mark
and base engraving present (or the reason given), no pipeline warnings, every output file written; `sweep.md` /
`sweep.json` hold the table, `--thumbs` a contact sheet of facial views with the trim line. Run it on the scans at
hand before a change that touches the pipeline; the output folder is outside the repo (patient scans never leave
the machine). A lesson folder (`training\<Last, First - date>`) never has a different scan of the same arch written
over the one it holds: a case that lands on a folder already holding another scan goes to `... (2)`.

**Retraining.** `python tools/make_ground_truth.py <raw scan> <Titan '- 0 -' export> <out.npz>` per arch (stage-1 exports
work too: moved/missing teeth are marked 'ignore'), then `python tools/train_eval.py cases.json` (leave-one-case-out
scores, then the final model to `assets/models.joblib`). Current model: 8 arches from 5 patients; held-out tooth/gum F1
0.96–0.99 per patient.

**Audit fixes (20 Oct 2026).** A full audit (20 scans of every kind, every endpoint and brush against the running
app, the page in a browser, five code reviews) led to these behaviour changes:
- **Apply & re-run sends only the strokes.** A case keeps its own settings, placement and mark; settings reach an open
  case only through Settings → *Apply to this case*. Strokes sent while the case is waiting or being made are refused
  with a message (409) and stay on screen; the button shows *Applying…*. Clicking a Past case, a To-make row or a
  Recent-scans row no longer detaches the open case (it made every later Apply do nothing).
- **New cases** start on the automatic placement and mark (the page's maps of the case on screen are ignored); the NLO
  Cases case picked in the queue ties a new case only when it is that patient's (`_tracker_item_fits`), a re-run never
  changes the tie, and a near name needs a first name of 5+ letters (short ones must match exactly).
- **Names from file names** (`watch.parse_name`, the page's `nameOf`): every word before the scanner's date - the last
  word is the last name (with a particle before it: De La Cruz), the rest the first name, middle initial included; any
  alphabet. The arch is read only from a word of its own (a patient called Flowers is not a lower). `tools/test_names.py`.
- **Restarts:** a case that was waiting or being made when the app stopped is made again on start-up (twice at most,
  `restarts` in case.json); case.json is written to a temp file and swapped in; Take off / Not a bracket strokes, the
  file before a cut and what NLO Cases was told are kept with the case.
- **Drop folder:** its models carry the patient's name; it takes turns with the page's cases (`watch.RUN_SLOTS`, the
  same slots as `NLO_WORKERS`); a failed write to its log on the share never stops it; each failure gets its own folder.
- **PreForm** is the only program the PreForm setting accepts or starts; Open in PreForm and the print files always copy
  the current models (and base) first.
- **Learning:** a run flag older than 5 hours is treated as an interrupted run (one killed run used to switch learning
  off for good).
- **Mouthguards:** a failed line or bracket band shows a red warning; the base carries no name (the guard covers the
  strip) and the log says so.
- **Version:** Settings → Office shows the build (`/api/version`: a hash of the program files and the date of the newest).
  The updater prints the same figure when it finishes ("App version now: ..."), so a half-written update shows at
  once. `update.ps1` itself is not in the hash: on the lab PC a .ps1 cannot be written, so it is never in the folder -
  with it counted, the figure there never matched the release note (10/21/2026).
- **Patient names never go in the repo:** the shipped model's `trained_on` holds `baseNN` / `lessonNN` only; README,
  comments and tests use made-up names.

**Layout.**
```
bleachtray/   pipeline: orient, features, segment, reservoir, solid, orderfolder, watch, pipeline
app/          FastAPI server + single-page UI (three.js vendored, works offline)
assets/       models.joblib (committed); trimlign_base_* (imported locally by install.bat, not committed)
tools/        import_base, rebuild_base, ground truth, train/eval, verification
samples/      training scans + labels (local only, never committed)
```
