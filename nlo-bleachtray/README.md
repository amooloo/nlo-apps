# NLO Bleach Tray

Makes the bleaching-tray model from a scan — with the gel reservoirs, the Trimlign base and the trim line — and
puts it into OrthoFactory as an order, like a Titan export. Nothing to pay per case. Runs on the lab PC.

## Everyday use (1 minute)

1. Export the patient's scan as an STL from the scanner, with the patient's name in the file name
   (the scanner does this on its own, e.g. `Armaan_Shetty_20261015_09-20-31_upper.stl`).
2. In File Explorer, drag the file into the folder **`S:\clinical\3D printing\BleachTray`**. Upper and lower? Drag both.
3. Wait about a minute. OrthoFactory → **Production** now lists the patient like any Titan case.
   Print the model on the Form 4B, thermoform, trim on the Trimlign.

The file you dragged moves to `BleachTray\done` when it worked, or to `BleachTray\failed` with an `error.txt` when
it didn't. The small black window "NLO Bleach Tray" must be open on the lab PC (it starts by itself at sign-in;
if it's gone, double-click `start_app.bat` in the app folder). That one window watches the drop folder *and*
serves the browser app to the whole office.

## One-time setup on the lab PC (about 10 minutes, once)

1. Put the `nlo-bleachtray` folder somewhere permanent, e.g. `C:\NLO\nlo-bleachtray`
   (from the zip: right-click → *Extract All*).
2. Double-click **`install.bat`**. It walks you through everything:
   * If the PC has no **Python 3.13** yet (the free program the app runs on), it downloads the right installer
     for you. Run it, and on the first screen tick **"Add python.exe to PATH"** before *Install Now*.
     Then double-click `install.bat` again. (The newest Python from python.org is too new for the
     geometry components; 3.13 next to it is fine.)
   * It installs the app's components, finds the Titan folder, learns the Trimlign base from one of your existing
     Titan exports, and creates the `BleachTray` drop folder next to the Titan folder.
   * Answer **y** when it asks to start the watcher automatically at sign-in.
3. Double-click **`start_app.bat`** once to start it now.

## Updating the app

Double-click **`update.bat`** in the app folder on the PC that runs it. It downloads the newest version, keeps
your settings and the base, and restarts the app.

## Moving the app to another PC

On the old PC double-click `uninstall_autostart.bat` and close the app's window. On the new PC extract the zip,
run `install.bat`. Only one PC should run the app at a time (two watchers would create duplicate orders).
Any PC that can see the S: drive can host it; it just has to be on and signed in.

## If a case needs a look

From any office computer open `http://<lab PC name>:8765` — or click **Bleach Tray** on the NLO apps home page,
which opens it for you (the black window on the lab PC prints the exact address). Drop a scan anywhere on the page:
it processes on its own and writes the OrthoFactory order (the green line under the result confirms it). See the
result in 3D, paint over a tooth the computer missed (hold **Shift** and drag on the *Segmentation / fix* tab),
re-run. **Position on the base** (Result tab): rotate / shift the arch on the base with the arrow buttons (live preview), *Apply* rebuilds the order, *Reset to automatic* goes back. Presets: *Bleaching tray* (reservoirs 5-5, line at the gum), *Bleaching 3-3*, *Aligner / retainer*
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
from multi-scale curvature, height-below-cusp and radial-position features; teeth are separated by geodesic erosion
from the gum line with an adaptive re-split for broad molar contacts, then numbered from the midline. The gum line
is the 0.5 iso-contour of the tooth mask; papillae are bridged with a 2D closing and snapped onto the surface.
Reservoirs are a feathered normal displacement on the facial surfaces, kept 0.5 mm from the gum line and 0.4 mm from the incisal edges, the neighbouring teeth and the facial-lingual transition (full height ~0.6 mm further in). The solid: clipped surface closed below the floor, unioned with a
gingiva shelf (so there is always material beyond the scan edge, e.g. behind the last molars), intersected with the
extruded horseshoe outline (manifold3d booleans), unioned with a manifold rebuild of the Trimlign base at Titan's
placement (facial gum line of the centrals 6.0 / 4.5 mm in front of the locating hole for upper / lower; floor
3 mm below the lowest trim-line point).

**Validation.** One upper vs Titan: gum line within 0.17 mm median / 0.25 mm p90 of Titan's tooth boundaries,
95 % per-tooth agreement, base placement within 0.35 mm / 2°. First order accepted by OrthoFactory's simulator
on 10/15/2026 (Arman Shetty, 10 59 21).

**Command line.** `python run_watch.py --inbox <folder> --titan <OrthoFactory input folder>` (settings remembered in
`watch_config.json`); `python run_app.py [--lan]`; `python tools/import_base.py <Titan folder or export .stl>`.

**Retraining.** Corrected cases are training data: see `samples/README.md`, then `python tools/train_eval.py`.

**Layout.**
```
bleachtray/   pipeline: orient, features, segment, reservoir, solid, orderfolder, watch, pipeline
app/          FastAPI server + single-page UI (three.js vendored, works offline)
assets/       models.joblib (committed); trimlign_base_* (imported locally by install.bat, not committed)
tools/        import_base, rebuild_base, ground truth, train/eval, verification
samples/      training scans + labels (local only, never committed)
```
