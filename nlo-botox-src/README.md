# NLO Botox — source

Neuromodulator planner for Next Level Orthodontics. The page people open is `../nlo-botox.html` (built from here). Plain HTML, CSS and JavaScript in one file: no sign-in, no server, and it stores no patient information (names typed into a plan exist only on screen until the page is closed). Only preferences (default product, diluent, saved per-area doses) are kept, in the browser's own storage.

- `data.js` — the clinical data: every area's sites (drawing coordinates), starting dose and range per site, depth, technique, cautions, onset and duration, references; the four products (units, vials, label dilutions, conversion ratio); the reference list. Starting doses follow the AAFE Level I course where it gives one (glabella, forehead, crow's feet, lip lines, masseter, temporalis); the label and literature doses are in each area's `typical` text. Sites with `opt: true` start at 0 U and are drawn hollow.
- `draw.js` — the face diagrams (front and side views, drawn in SVG; about 1.75 drawing units per mm), muscles, caution zones, landmarks, the masseter safe zone, and the dose-label layout.
- `text.js` — patient-facing text in English and Spanish: consent, health screening, before-and-after care. `{p}` is replaced with the chosen product.
- `app.js` — the app: injection map, treatment plan and chart note, dilution, printables (treatment record, consent, screening, aftercare, blank chart, chairside card), safety and sources pages.
- `style.css`, `body.html` — layout and print styles (US Letter); the NLO clinical suite look.
- `pdlogo.datauri` — the black NLO logo for printed pages.

Build: `python3 build.py` → `dist/nlo-botox.html` (copy it to `../nlo-botox.html`), `dist/artifact/nlo-botox.html` (the claude.ai preview copy) and `dist/app.bundle.js`.
Test: `node test/unit.test.js` after a build (dates, units, dilution math, conversions, AAFE defaults, record and consent text).

Printing works from the NLO Apps copy; a framed preview (claude.ai) hides the print buttons because it can't open the print dialog.
