# UF Oral Surgery referral (Forms → Referrals)

The **UF Oral Surgery** tab in Forms (`NLO_Financial_Suite.html#ufr`) fills in UF College of Dentistry's own *Request for
Consultation* for the Department of Oral & Maxillofacial Surgery (`uf-omfs-referral-source.pdf`, Rev. 8.4.2025 with the new fax number).

- **What prints and downloads is UF's own PDF**, unchanged, plus one appended incremental update that adds the typed text
  (Helvetica), the ring around the chosen surgeon ("Circle one"), an X over each tooth to extract, the typed teeth list under
  "DO NOT state All", and the X on Radiographs No / Yes. Nothing leaves the computer; nothing is saved.
- **Print** prints that PDF from a hidden frame through the browser's own PDF viewer. A browser set to download PDFs instead
  gets the file to print from (the page says so).
- **The preview** on the page is a 90-dpi picture of UF's page with the same text drawn over it; *Enlarge* shows the PDF itself.
- **Our office details** (Referring Dr., email, contact, address, phone, fax) are `UFR_OFFICE` in the page. Staff can change
  them for one referral; Clear puts them back.

## When UF sends a new revision
1. Save it here as `uf-omfs-referral-source.pdf`.
2. `python3 update_uf_form.py` (pikepdf, fonttools, pdfplumber, numpy, scipy, Pillow, pyoxipng, poppler's `pdftoppm`).
   It rewrites only the `UFR_*` data lines in `../../NLO_Financial_Suite.html`: UF's file slimmed for the page (tags,
   XMP and font hinting taken out — it renders identically), where every blank, surgeon name, tooth box and X-ray blank is,
   and the preview picture. `--check` reports whether the page is up to date with the PDF here.
3. Test, then look at a filled PDF with every other tooth ticked.

If UF changes the layout itself (other fields, other surgeons, a new chart), the script stops on what it can't find —
the code needs a look then, not just a rerun.

## Test
Serve the repo root (`python3 -m http.server 8767`), then
`node test/e2e.js http://127.0.0.1:8767/NLO_Financial_Suite.html` (no PDF viewer: Print downloads) and
`node test/e2e.js http://127.0.0.1:8767/NLO_Financial_Suite.html viewer` (full Chromium: Print uses the viewer).
