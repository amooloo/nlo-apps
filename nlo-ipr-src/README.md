# NLO IPR Tracker 4

Interproximal reduction charting at the chair — on the NLO Cases platform since 23 Oct 2026 (Amir: *"if it has the same login
as the patient tracker, can we just use the full name of the patients instead of having like initials? Because that's very
confusing."*).

- **Same logins as NLO Cases** (username + password; first sign-in with a temporary password chooses one), the same office key,
  and the same idle lock (Team & security → idle minutes, 10 by default). Lock is in the ⋯ menu. A lock — or a reload — starts
  the page over: nothing about a patient stays in the tab's memory.
- **Every patient and every visit is sealed in the browser** (AES-256-GCM, the office key) before it's saved to the NLO Cases
  Firestore project (covered by Google Cloud's BAA). Before 4.0 the records sat unencrypted in the `nlo-inventory` Realtime
  Database behind a Google sign-in, with initials only.
- **Full names.** A patient is a chart # and a full name. New patient fills in the name NLO Cases has for the chart # typed
  (and offers the record already on file for it); a patient still known only by initials gets the name NLO Cases has when they're
  opened (if it fits the initials), or *Add full name* in the patient strip (*Edit* changes either). Search finds a patient by
  any part of the name, the chart # (dashes don't matter), or initials. The printed form carries the full name; the blank form
  has a line for it.
- **NLO Cases reads the visits directly** once the records have moved (its IPR section, *Get from IPR Tracker*, *Sync all
  patients*) — no Google sign-in. NLO Cases' IPR button opens `IPR_Tracker.html#chart=<chart #>` (the chart # only).

## Files

- `src/react.js` — React 18 production build (the page carries it, as 3.x did; it loads no other code but the pinned Firebase SDK).
- `src/core.js` — config (filled in by the build), small utils, chart # / name helpers, the crypto (the same as NLO Cases).
- `src/backend.js` — Firebase: sign-in and the key ring (as NLO Cases), the gate (`open()`), live listeners, the sealed records,
  NLO Cases' patient index, the names NLO Cases has (`caseNames`), the move's writes, and the sealed draft. `IP` is the opened
  records in memory (every patient; a patient's visits when opened).
- `src/lock.js` — the page around the app: sign-in / lock screens, the cards before the app opens, the idle lock, the draft.
- `src/move.js` — the one-time move (Dr. A) and *Remove the old copy*.
- `src/app.js` — the charting app (React, from 3.x), with its old `sbGet / sbPost / sbPatch` calls now over the sealed records.
- `src/style.css`, `src/template.html` — the page (strict CSP: the one inline script by its SHA-256; print windows get their
  buttons wired from the page, since they inherit the policy).
- `old/IPR_Tracker_v3.html` — IPR Tracker 3 exactly as it was published; the build makes `IPR_Tracker_old.html` from it.
- `build.py` → `dist/IPR_Tracker.html` (published as `../IPR_Tracker.html`, the same address as before),
  `dist/IPR_Tracker_old.html` (published as `../IPR_Tracker_old.html`), `dist/firestore.rules`.
- `test/e2e.py` — end to end on the emulators (see below).

## Records

| collection | what | plain fields |
|---|---|---|
| `iprPts/<id>` | a patient: sealed `{ chart, name, ini?, at, oh? }` (AAD `iprpt:<id>`) | `v rev by sid createdAt updatedAt pc` |
| `iprVis/<id>` | a visit: sealed, the fields 3.x kept (`date, assistant_initials, gauge_verified, upper_ipr, lower_ipr, upper_spaces, lower_spaces, upper_bt, lower_bt, notes, prescribed_upper, prescribed_lower, missing_teeth, created_at`, `oh?`) (AAD `iprvis:<id>`) | `p v rev by sid createdAt updatedAt` |
| `iprPtLog/<id>_<rev>`, `iprVisLog/<id>_<rev>` | every save's history entry: sealed action, and `prev` — the sealed copy it replaced | append-only |
| `iprMeta/moved`, `iprMeta/oldRemoved` | the move, and the old copy removed (Dr. A, once each) | counts only |

`pc` = NLO Cases' patient index for the chart # with letters and digits only: `HMAC(HKDF(office key v-first, 'patient-index'),
'c:' + chart)` → 22 characters, so NLO Cases finds a patient's visits however either app wrote the dashes. `p` is the visit's
patient record id (random). `oh` is a fingerprint of the 3.x record a moved one came from (for *Remove the old copy*).
The rules are in `../nlo-cases-src/firestore.rules` (the IPR block; tests in `../nlo-cases-src/test/rules.test.mjs`); the
marker `meta/rules_ipr_1` tells the page whether they're live.

The tab's draft (what's on screen, kept across the lock and a reload) is sealed for the person signed in (AAD `iprdraft:<uid>`)
in `sessionStorage['iprDraft.v4']`; someone else signing in on that tab can't open it. Recent patients are record ids only
(`localStorage['ipr_recent_ids']`). 3.x's readable `sessionStorage` draft and `localStorage['ipr_recent']` are removed at start.

## The move (once) and the old copy

Before the move, staff signing in see *moving to your NLO Cases login* with a button to the old IPR Tracker (kept at
`IPR_Tracker_old.html`, unchanged), and Dr. A sees the rules card and then the move card: **Connect to the old IPR Tracker**
(Google, his account or the office one) → it reads `nlo/ipr/patients` and `nlo/ipr/visits`, looks up the full name NLO Cases has
for each chart # (used only when it fits the initials), and shows what it found → **Move it now** reads everything again (and
stops if anything changed), seals each patient and visit under its old id with its history entry, opens every one again to
check it, marks `iprMeta/moved`, and leaves `nlo/ipr/moved` in the old database — which makes the old page send everyone here.
Running it again saves the same records under the same ids.

Afterwards, **⋯ → Remove the old copy** (Dr. A): reads the old database again, brings over anything an old page saved there
since the move (a record changed in both places keeps this one's version; the old one goes into its history), checks every
record, then deletes `nlo/ipr/patients` and `nlo/ipr/visits` (the `moved` mark stays). It can be run again any time.

## Build and test

    node test/unit.js           # which name goes with which patient: initials, chart # forms, search
    python3 build.py            # and ../nlo-cases-src: python3 build.py (the e2e test sets the office up there)
    npx firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases --config ../nlo-cases-src/firebase.json "python3 test/e2e.py"

Needs Python Playwright with Chromium, and the pinned Firebase files in `test/vendor/firebasejs-10.12.2/` (`npm pack
firebase@10.12.2`: `firebase-app-compat.js`, `-auth-`, `-firestore-`, `-database-`; the page's integrity hashes must match).
`SHOTS=<folder>` saves screenshots and the printed forms as PDFs. Made-up people only.
