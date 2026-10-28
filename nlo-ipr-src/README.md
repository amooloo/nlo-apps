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
- **Patient photos, the same as NLO Cases' (27 Oct 2026**, Amir: *"the IPR tracker and case tracker should be fully sharing
  the same data … enter patient's full name and also their photo, kind of like exactly how we have it in case tracker"*).
  A patient shows the newest picture the office has of them: the one on this record, or the one on their NLO Cases case
  (found by the chart #), whichever was taken into the records last. The picture next to the name in the patient strip is a
  button: take a photo (a camera on an iPad), choose a file, paste one (Ctrl+V anywhere) or drop one on it, then fit the face
  in the circle — NLO Cases' editor. New patient has the same slot (the picture goes in with the record at the first Save;
  it rides in the sealed draft meanwhile), and shows NLO Cases' picture for the chart # typed. Search, Recent patients and
  Patient records show the pictures too. The eye in the header blurs them and shortens names to "Jane D." on that computer
  (screens patients can see), as NLO Cases' eye does. A picture taken here goes on this record with a save of it (its history
  says so); NLO Cases copies it onto the patient's open cases the next time it reads them (a case opened, Sync all, or its
  sync that runs by itself), and a newer picture taken in NLO Cases shows here.

## Files

- `src/react.js` — React 18 production build (the page carries it, as 3.x did; it loads no other code but the pinned Firebase SDK).
- `src/core.js` — config (filled in by the build), small utils, chart # / name helpers, the crypto (the same as NLO Cases).
- `src/backend.js` — Firebase: sign-in and the key ring (as NLO Cases), the gate (`open()`), live listeners, the sealed records,
  NLO Cases' patient index, the names NLO Cases has (`caseNames`), the move's writes, and the sealed draft. `IP` is the opened
  records in memory (every patient; a patient's visits when opened).
- `src/lock.js` — the page around the app: sign-in / lock screens, the cards before the app opens, the idle lock, the draft.
- `src/photos.js` — the patient photos: which picture a patient shows (`iphPick`: the record's own or NLO Cases', the newest),
  the pictures in memory, NLO Cases' editor (`phEditor`), the eye, and the React pieces (`PtAvatar`, `PtName`, `PhHideBtn`).
- `src/move.js` — the one-time move (Dr. A) and *Remove the old copy*.
- `src/app.js` — the charting app (React, from 3.x), with its old `sbGet / sbPost / sbPatch` calls now over the sealed records.
- `src/style.css`, `src/template.html` — the page (strict CSP: the one inline script by its SHA-256; print windows get their
  buttons wired from the page, since they inherit the policy).
- `old/IPR_Tracker_v3.html` — IPR Tracker 3 exactly as it was published; the build makes `IPR_Tracker_old.html` from it.
- `build.py` → `dist/IPR_Tracker.html` (published as `../IPR_Tracker.html`, the same address as before),
  `dist/IPR_Tracker_old.html` (published as `../IPR_Tracker_old.html`), `dist/firestore.rules`.
- `test/e2e.py` — end to end on the emulators (see below; the photos section runs the real editor on made-up faces drawn by
  NLO Cases' demo, and NLO Cases' copy of a picture onto the patient's case).

## Records

| collection | what | plain fields |
|---|---|---|
| `iprPts/<id>` | a patient: sealed `{ chart, name, ini?, at, oh?, photo?, photoAt? }` (AAD `iprpt:<id>`; `photo` = the picture's version id, `photoAt` = when it was taken into the records, ms) | `v rev by sid createdAt updatedAt pc` |
| `photos/<id>` | the patient's picture, at the record's id — NLO Cases' patient-photo collection (a case's sits at the case's id): sealed bytes (AAD `photo:<id>`), a 160 px JPEG | `v iv ct pv at by` |
| `iprVis/<id>` | a visit: sealed, the fields 3.x kept (`date, assistant_initials, gauge_verified, upper_ipr, lower_ipr, upper_spaces, lower_spaces, upper_bt, lower_bt, notes, prescribed_upper, prescribed_lower, missing_teeth, created_at`, `oh?`) (AAD `iprvis:<id>:<p>` — bound to its patient's record too, so a sealed visit copied onto another patient doesn't open) | `p v rev by sid createdAt updatedAt` |
| `iprPtLog/<id>_<rev>`, `iprVisLog/<id>_<rev>` | every save's history entry: sealed action, and `prev` — the sealed copy it replaced | append-only |
| `iprMeta/moved`, `iprMeta/oldRemoved` | the move, and the old copy removed (Dr. A, once each) | counts only |

`pc` = NLO Cases' patient index for the chart # with letters and digits only: `HMAC(HKDF(office key v-first, 'patient-index'),
'c:' + chart)` → 22 characters, so NLO Cases finds a patient's visits however either app wrote the dashes. `p` is the visit's
patient record id (random). `oh` is a fingerprint of the 3.x record a moved one came from (for *Remove the old copy*).
A picture changes only together with a save of its record (the rules: `photoRecordSaved` — a case saved in the same write,
else an IPR patient record), so the record's history shows who added or changed it; a move run again keeps a picture added
since. NLO Cases' key change re-seals these pictures with the cases' (and removes one whose record is gone). `photoAt` lives in
the sealed body on both sides (NLO Cases keeps it on the case), so the two apps agree on which of a patient's pictures is the
newest whatever either one re-seals; a picture copied across keeps its own time.
The rules are in `../nlo-cases-src/firestore.rules` (the IPR block; tests in `../nlo-cases-src/test/rules.test.mjs`); the
marker `meta/rules_ipr_1` tells the page whether they're live.

The tab's draft (what's on screen, kept across the lock and a reload) is sealed with the office key (AAD `iprdraft:<uid>`) in
`sessionStorage['iprDraft.v4']`: nothing in it is readable without the key, and the page restores it only for the same login (another
login on that tab starts clean — though anyone with the office key could open it, as they can the records themselves). It carries
`ipr_at` (the last change: a draft from an earlier day comes back read-only) and `ipr_dirty` (a change still on its way at the
lock: saved again once the patient is open). Recent patients are record ids only (`localStorage['ipr_recent_ids']`). 3.x's readable
`sessionStorage` draft and `localStorage['ipr_recent']` are removed at start.

**Saving a visit.** The visit on screen gets its record id when it starts (`FB.newId`), before its first save; every save of it —
the autosave (2.5 s after a change), Save, Print/Export, the lock's last save, the first save after signing in again — goes to that
id through `IP.putVisit` (made by the first, updated by the rest, one at a time). Saves run in order, each with the snapshot of the
screen it was asked for, so a late one can't put one visit's changes on another (3.x's waiting autosave could make a second copy of
a visit Save had just made). A change still waiting when another visit comes on screen is saved at once, to its own visit. A chart #
already on file is that patient only when the name is theirs (or fits the initials an older record kept): New patient opens their
visits instead, and a save never attaches a visit to a record with another name. Print windows close with the lock.

## The move (once) and the old copy

Before the move, staff signing in see *moving to your NLO Cases login* with a button to the old IPR Tracker (kept at
`IPR_Tracker_old.html`), and Dr. A sees the rules card and then the move card: **Connect to the old IPR Tracker** (Google, his
account or the office one) → it reads `nlo/ipr` (one read, with its ETag), looks up the full name NLO Cases has for each chart #
(used only when it fits the initials), and shows what it found → **Move it now** reads everything again (and stops if anything
changed), seals each patient and visit under its old id with its history entry, opens every one again to check it, marks
`iprMeta/moved`, and leaves `nlo/ipr/moved` in the old database — which makes the old page send everyone here, and stop saving
(an old page left open says so). Running it again saves the same records under the same ids. A visit goes with the patient record
3.x filed it under (its key, or the record's own `id` field); one with no patient anywhere (3.x never showed it) isn't moved; a
record whose old id has characters Firestore can't take gets the same new id every time (`m` + a hash of the old one).

The done card has the two steps left, for the same sitting:
1. **Remove the old copy** (also ⋯ → Remove the old copy, Dr. A): reads `nlo/ipr` again, brings over anything saved there since
   the move — a visit whose patient is already here comes to them, one changed in both places keeps this one's version (the old
   one goes into its history) — checks every record, then replaces `nlo/ipr` with just the `moved` mark **only if it is still the
   copy it read** (a conditional REST write with the ETag: a save there in the meantime and nothing is deleted; it shows, and the
   button brings it over next). Visits with no patient anywhere are listed and deleted with it (the confirmation says so). It can
   be run again any time (*Old copy: check again*): a visit an old page saves after the removal comes over to its patient here.
   The old database's daily backups (Cloud Storage, kept a year) still hold the copy from before the removal; they age out.
2. **Lock the old copy** (recommended) — `../tools/rtdb-rules-ipr-lock.py` in Cloud Shell (the card copies the command):
   `nlo/ipr` becomes readable and writable by Dr. A's verified Google account only, with `nlo/ipr/moved` still readable by whoever
   could read `nlo/ipr` before (it sends an old page here). An IPR Tracker 3 page loaded before the update and left open somewhere
   then can't keep saving where nobody would see it (the patched old page already refuses once moved). Nothing else in the rules
   changes; the script shows the change, asks first, keeps the rules as they were (`undo`), and stops on anything it doesn't
   expect. `test/lock_test.py` checks it; `test/e2e.py` runs the locked rules on the emulator. (Amir has found Cloud Shell
   steps a chore: Claude can make the same change in his Chrome, Firebase console → Realtime Database → Rules, with his OK.)

## Build and test

    node test/unit.js           # which name goes with which patient: initials, chart # forms, search, the move's plan
    python3 test/lock_test.py   # the old copy's lock (../tools/rtdb-rules-ipr-lock.py) on the rules, no database
    python3 build.py            # and ../nlo-cases-src: python3 build.py (the e2e test sets the office up there)
    ../nlo-cases-src/node_modules/.bin/firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases \
        --config ../nlo-cases-src/firebase.json "python3 test/e2e.py"     # (firebase-tools from nlo-cases-src: npm ci there)

Needs Python Playwright with Chromium, and the pinned Firebase files in `test/vendor/firebasejs-10.12.2/` (`npm pack
firebase@10.12.2`: `firebase-app-compat.js`, `-auth-`, `-firestore-`, `-database-`; the page's integrity hashes must match).
`SHOTS=<folder>` saves screenshots and the printed forms as PDFs. Made-up people only.
