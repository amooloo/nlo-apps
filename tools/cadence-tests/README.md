# Cadence checks (sign-in, and its data on the NLO Cases system)

Cadence (`../../cadence.html`) is a compiled bundle with no source folder. Since 23 Oct 2026 it signs in with the NLO Cases
login (Amir: "make the login for the Cadence app the same as Case Tracker"); since 24 Oct 2026 it can move its data from its
own copy in the nlo-inventory Realtime Database onto the NLO Cases system's Firestore database (Admin → Move to NLO Cases,
Dr. A, once). Everything here is a made-up office on the Firebase emulators: nothing live is read or written.

- `match_unit.mjs` — who a login opens (`nloMatch`), 23 cases, straight from `cadence.html`. `node match_unit.mjs`.
- `test_login.mjs` — the real page on the emulators (NLO Cases' Firestore rules from `../../nlo-cases-src/firestore.rules`,
  `rtdb.rules.json` for `nlo/cadence`), Cadence on its old database: the device's Google step, every sign-in error, staff /
  manager / Dr. A, Lock, reload, a login turned off while signed in, Sign-in check and linking a login, password fillers, the
  page cache, offline, phones, and (without `--quick`) the idle lock, its warning and its wait for the internet. 102 checks.
- `rules.test.mjs` — Cadence's block of the shared Firestore rules, 84 checks: not signed in (only the move marker), a
  login with no member record or turned off, staff (lists, ticks, the day, the out-of-office board, the log; not the setup,
  not a day ahead of the office's, not a list's checklist or day, not un-certifying or taking off a list once it's been
  certified, not text fields that aren't text, not a log entry dated ahead), Dr. A, a batch of 450 list saves, the day's
  roll in a transaction. Its dates are the office's (US Eastern).
- `test_move.mjs` — the move, on the real page: the rules as they were before (eac0d28) → Cadence as before and the Move
  page asking for the rules; the new rules → the move with other screens open (one of them the page as published before,
  eac0d28), what it leaves in both databases; then a device with no Google connection, two phones ticking one list, Lock,
  Dr. A's copies of Staff Hub's roster / the calendar's closed days / NLO Time Off's feed key and his edits, a staff login
  refused the setup, two devices rolling the day, NLO Time Off's sealed feed (served by the test with a made-up key), the
  Staff Meeting Hub's copy, moving back, and moving again. And what an independent review found (24 Oct): a page from
  before saving a tick while the move runs (nothing moves), a tick still waiting with no internet when the next person
  signs in (the sign-in waits for it), a pause left behind by a move that didn't finish (the sign-in and the Move page
  aren't covered; Dr. A ends it), a device whose clock is a day behind (it shows the office's day), and older rules
  published again after the move (screens stay on the new system and Dr. A's sign-in hands him the rules). 127 checks; the
  browsers and the test run on US Eastern time.

Run (Java and Node 20+):

    npm install
    npx firebase emulators:start --only auth,firestore,database --project demo-nlo     # leave running
    # a folder with the pages: cadence.html, staff-meeting.html, nlo-home.js, nlo-aisa.js, and the page from before the move
    mkdir -p /tmp/cad-site && cp ../../cadence.html ../../staff-meeting.html ../../nlo-home.js ../../nlo-aisa.js /tmp/cad-site/
    git show eac0d28:cadence.html > /tmp/cad-site/cadence-login.html
    (cd /tmp/cad-site && python3 -m http.server 8765 --bind 127.0.0.1)
    node match_unit.mjs
    NO_PROXY=localhost,127.0.0.1 node rules.test.mjs
    NO_PROXY=localhost,127.0.0.1 node test_login.mjs --quick                            # ~4 min; without --quick ~8 min
    NO_PROXY=localhost,127.0.0.1 node test_move.mjs                                     # a few minutes

The page's Firebase SDK (gstatic 10.12.0) is served from `node_modules/firebase` (`FIREBASE_SDK_DIR` to change it) and every
app it creates is pointed at the emulators by an init script; other outside requests are refused. The emulators share one
sign-in pool between "both projects", which is why the made-up Dr. A signs in to NLO Cases as dr.owner@example.com.
`rules.test.mjs` uses the project `demo-nlo-cases` (as the other apps' rules suites do), the browser checks `nlo-cases`:
don't run it alongside another app's rules suite. Screenshots go to `shots/`.
