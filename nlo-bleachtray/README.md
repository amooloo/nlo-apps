# NLO Bleach Tray

Makes the bleaching-tray model from a scan — with the gel reservoirs, the Trimlign base and the trim line — and
puts it into OrthoFactory as an order, like a Titan export. Nothing to pay per case. Runs on the lab PC.

## Everyday use (2 minutes)

1. Export the patient's scan as an STL from the scanner, with the patient's name in the file name
   (the scanner does this on its own, e.g. `Armaan_Shetty_20261015_09-20-31_upper.stl`).
2. Either drop the file(s) on the **Bleach Tray** app page (any office computer; home page → Bleach Tray), or drag
   them into the folder **`S:\clinical\3D printing\BleachTray`** in File Explorer. Upper and lower together or one
   after the other (they are paired by the patient name), one patient or a whole day's scans at once (one case per
   patient). Several people can drop at the same time: cases run one after another and the list shows who is waiting.
3. A few minutes later the case shows **"check & send"** in the app, with **four models**: whitening tray (WT) and
   thermoformed retainer (TT) for each arch. Look at the 3D result (trim line, reservoirs, position on the base).
   Fix a tooth with the brush or nudge the base if needed - a fix is kept for every later re-run of that case.
4. Click **Send to OrthoFactory**. Only then does it appear in OrthoFactory → **Production**, like any Titan case:
   the whitening trays as Template pieces (`TU0A` / `TL0A`), the retainers as Aligner pieces (`AU1A` / `AL1A`).
   Print on the Form 4B, thermoform, trim on the Trimlign. **Discard** throws it away.

Nothing reaches OrthoFactory without that click. Files dragged into the folder move to `BleachTray\done` when
processed, or to `BleachTray\failed` with an `error.txt`. The small black window "NLO Bleach Tray" must be open on
the PC that runs the app (it starts by itself at sign-in; if it's gone, double-click `start_app.bat` in the app
folder). That one window watches the drop folder *and* serves the app page to the whole office.

## It learns from your corrections

Every case that is sent is saved in the app folder under `training\<Last, First> - <date>\`: the scan of each
arch, the tooth labels that were sent (marked *corrected* when someone used the brush) and a `case.json`. Titan
exports (`First Last - 0 - Maxilla.stl` / `.pts`) dropped on the app page or into the drop folder are not processed;
they are filed into the same patient folder as a reference. Zip `training\` and send it to Dr. Akhavan now and
then: the model is retrained on the corrected cases and on the Titan references, and the next update needs fewer
corrections.

## Scanner integration (AlliedStar or any scanner that exports STLs)

Advanced settings → *Scanner export folder* → Save (once, for the whole office). The app lists the scans exported in
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

On the old PC double-click `uninstall_autostart.bat` and close the app's window. On the new PC extract the zip,
run `install.bat`. Only one PC should run the app at a time (two watchers would create duplicate orders).
Any PC that can see the S: drive can host it; it just has to be on and signed in.

## If a case needs a look

From any office computer open `http://<lab PC name>:8765` — or click **Bleach Tray** on the NLO apps home page,
which opens it for you (the black window on the lab PC prints the exact address). Drop a scan anywhere on the page:
it processes on its own and writes the OrthoFactory order (the green line under the result confirms it). See the
result in 3D, paint over a tooth the computer missed (hold **Shift** and drag on the *Segmentation / fix* tab),
re-run. **Position on the base** (Result tab): rotate / shift the arch on the base with the arrow buttons (live preview), *Apply* rebuilds the order, *Reset to automatic* goes back. *Make*: *Whitening tray + retainer* (default, both per arch), *Whitening tray 5-5 only* (reservoirs 5-5, line at the gum), *Whitening 3-3 only*, *Retainer only*
(line 1.25 mm onto the gums, semi-scallop), *Plain model*.

---

## Technical notes

**What it writes.** A Titan-style OrthoFactory order folder in Factory #1's input folder:

```
<Titan folder>\2026-10-15 10 59 21 - A - Dr. Amir Akhavan - Arman Shetty - 4ee1\
    2610151059_1_Order.xml                 <OrderData Type="Titan_Angled"> … <Aligner Name="TU0A"> …
    Arman Shetty - 0 - Maxilla.stl         solid horseshoe + Trimlign base (locating hole at the origin)
    Arman Shetty - 0 - Maxilla.pts         trim line, same frame, CRLF
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
3 mm below the lowest trim-line point).

**Behind the last molar.** A "tooth" found behind the terminal molar that is far too narrow for a molar and rises
above it is the retromolar pad (or ascending tissue) and is relabelled gum, so the trim line wraps the molar instead
of running up the pad. The model is then lowered behind the last tooth on each side to 2 mm below the trim line
(`distal_relief`), so the Trimlign bur reaches the distal surface instead of hitting a wall of gum.

**Engraving.** Patient name (first name or initial + last name) and WHITENING / RETAINER / MODEL, 2.4 / 2.0 mm
capitals, 0.4 mm deep, on the flat strip of the base plate inside the arch (y -13.5..-8.4, z 1.0). Switch off or
override under Advanced settings.

**Scanner exports.** Open-shell or closed-shell (iTero "with base", 3Shape solid) STLs both work: a large flat floor is
detected and removed before orientation, the skirt reads as gum. Scans over 200k faces are decimated first.

**Validation.** One upper vs Titan: gum line within 0.17 mm median / 0.25 mm p90 of Titan's tooth boundaries,
95 % per-tooth agreement, base placement within 0.35 mm / 2°. First order accepted by OrthoFactory's simulator
on 10/15/2026 (Arman Shetty, 10 59 21).

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
