# Forms: "Do you need an additional copy?"

Every Print in Forms (`NLO_Financial_Suite.html`) asks once — and Batch Print asks once for the whole job:

- **No, just one** (the default: Enter, or the 1 key) prints the form once, with no copy label.
  The label's row is kept but printed blank (`.copy-label-blank`), so every form breaks across pages exactly
  as its labeled copy always has. Taking the row out pulls a paragraph of 2-page forms (e.g. Financial
  Responsibility) into the foot of page 1, where the fixed footer prints over it.
- **Yes, add a copy** (the 2 key) prints what Forms always printed: **Next Level Copy** + **Patient / RP Copy**
  (a form's `data-copy2-label` still renames or, empty, unlabels the second copy — the Military Letter).
- **Cancel**, Esc, or a click outside the box prints nothing.

Code: `printDualCopy` → `askCopies` → `printOneCopy` / `printTwoCopies`; Batch Print → `askCopies` → `batchAssemblePrint`.
The UF referral prints UF's own PDF and isn't asked.

## Test
Serve the repo root (`python3 -m http.server 8767`), then
`node test/e2e.js http://127.0.0.1:8767/NLO_Financial_Suite.html` — the prompt (keys, Cancel/Esc/outside click,
focus), all 21 forms at one and two copies, Batch Print, one copy laid out exactly like the labeled copy, small screens.
