# NLO Bleach Tray

Raw intraoral scan (STL) → bleaching-tray model with gel reservoirs → print-ready horseshoe with the
Trimlign base → `.pts` trimline → **an OrthoFactory order folder, exactly like a Titan export**.
Runs entirely on the lab computer. Cost per case: $0.

## Install (once, on the lab PC or a Mac)

Python 3.10+ installed, then:

```
cd nlo-bleachtray
python -m pip install -r requirements.txt
python tools/import_base.py "S:\clinical\3D printing\Titan\<any order folder>\<Patient> - 1 - Maxilla.stl"
```

The last line pulls the Trimlign base out of any existing Titan export (it sits at a fixed position in every
Titan file) and builds the app's base assets. It is not kept in this repository.

## Zero-click mode (the everyday path)

```
python run_watch.py --inbox "S:\clinical\3D printing\BleachTray" --titan "S:\clinical\3D printing\Titan"
```

Drop the scanner's export (e.g. `Armaan_Shetty_20261015_09-20-31_upper.stl`) into the inbox. Patient and arch are
read from the file name; an upper and a lower for the same patient dropped within 90 s become one order. About 30 s
later the finished order is in OrthoFactory's input folder and the scan has moved to `inbox\done\<order>\` with all
outputs; anything that fails lands in `inbox\failed\` with an `error.txt`. The log is `inbox\bleachtray.log`.
Options are remembered in `watch_config.json`, so afterwards double-clicking `start_watch.bat` is enough (put a
shortcut to it in `shell:startup` to run at sign-in).

## Run the browser app (check / fix a case)

```
python run_app.py            # opens http://127.0.0.1:8765
python run_app.py --lan      # also reachable from other office computers on port 8765
```

Drop the upper and/or lower scan, fill in the patient's first and last name, set the **OrthoFactory input
folder** to `S:\clinical\3D printing\Titan` (or `O:\…` on the lab PC — whatever Factory #1's *Input Folder* is in
OrthoFactory → Settings → Process), click **Process scan**. About 30–45 s per arch.

The app writes an order folder OrthoFactory picks up on its own:

```
S:\clinical\3D printing\Titan\2026-10-15 10 47 30 - A - Dr. Amir Akhavan - Arman Shetty - 4ee1\
    12345_1_Order.xml                      <OrderData Type="Titan_Angled"> … <Aligner Name="TU0A"> …
    Arman Shetty - 0 - Maxilla.stl         solid horseshoe + Trimlign base, locating hole at the origin
    Arman Shetty - 0 - Maxilla.pts         trimline, same frame, CRLF
    Arman Shetty - 0 - Mandible.stl / .pts (when the lower scan was dropped too)
```

Leave the input folder blank to just download the files. The downloads panel also offers
`<case>_scan_with_reservoirs.stl` (the raw scan with only the reservoirs added, in scanner coordinates) in case you
ever want OrthoFactory's own AI basing instead.

## Presets

* **Bleaching tray** — 0.5 mm reservoirs on the facial surfaces of 5-5 (stops 1 mm short of the gum line, fades at the
  incisal edges); trimline scalloped at the gum line with straight bridges across the papillae.
* **Bleaching 3-3** — same, canine to canine.
* **Aligner / retainer** — no reservoirs; "high" line 1.25 mm onto the gums, semi-scallop (larger bridge radius).
* **Plain model** — no reservoirs, gum-line trimline.

Every number is editable in the side panel before processing. Piece type defaults to Template (`TU0A` / `TL0A`);
switch to Aligner for `AU…/AL…` codes.

## Fixing a case

If a tooth is missed or gum is labelled as tooth: **Segmentation / fix** tab, hold **Shift** and paint (blue = tooth,
grey = gum), then **Apply fixes & re-run**. Each corrected case is future training data (see `samples/README.md`).

## How it works

Auto-orientation from geometry (occlusal up, anterior +y, midline from the mirror-image tooth pairs). A
gradient-boosted classifier trained on Titan's own tooth segmentation labels every vertex tooth/gingiva from
multi-scale curvature, height-below-cusp and radial-position features; teeth are separated by geodesic erosion from
the gum line with an adaptive re-split for broad molar contacts, then numbered from the midline. The gum line is the
0.5 iso-contour of the tooth mask; papillae are bridged with a 2D morphological closing and snapped back onto the
surface. Reservoirs are a feathered normal displacement. The solid is built by closing the clipped surface below
the floor and intersecting it with the extruded horseshoe outline (manifold3d booleans), then unioned with a manifold
rebuild of the Trimlign base at Titan's placement (facial gum line of the centrals 6.0 mm / 4.5 mm in front of the
locating hole for upper / lower; floor 3 mm below the lowest trimline point).

Validated on one upper against Titan: gum line within 0.17 mm median / 0.25 mm p90 of Titan's tooth boundaries;
per-tooth labelling 95 % agreement; base placement within 0.35 mm / 2°.

## Layout

```
bleachtray/   pipeline: orient, features, segment, reservoir, solid, orderfolder, pipeline
app/          FastAPI server + single-page UI (three.js vendored, works offline)
assets/       models.joblib (tooth detector, committed); trimlign_base_* (imported locally, not committed)
tools/        import_base, ground truth, train/eval, verification
samples/      training scans + labels (local only, never committed)
```
