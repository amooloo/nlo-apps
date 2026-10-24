# Cadence checks (sign-in)

Cadence (`../../cadence.html`) is a compiled bundle with no source folder; these are the checks for its sign-in, which since
23 Oct 2026 is the NLO Cases login (Amir: "make the login for the Cadence app the same as Case Tracker"). Everything here is
a made-up office on the Firebase emulators: nothing live is read or written.

- `match_unit.mjs` — who a login opens (`nloMatch`), 23 cases, straight from `cadence.html`. `node match_unit.mjs`.
- `test_login.mjs` — the real page on the emulators (NLO Cases' Firestore rules from `../../nlo-cases-src/firestore.rules`,
  `rtdb.rules.json` for `nlo/cadence`): the device's Google step, every sign-in error, staff / manager / Dr. A, Lock, reload,
  a login turned off while signed in, Sign-in check and linking a login, password fillers, the page cache, offline, phones,
  and (without `--quick`) the idle lock, its warning and its wait for the internet. 102 checks.

Run (Java and Node 20+):

    npm install
    npx firebase emulators:start --only auth,firestore,database --project demo-nlo     # leave running
    (cd ../.. && python3 -m http.server 8765 --bind 127.0.0.1)                          # serves cadence.html, nlo-home.js, nlo-aisa.js
    node match_unit.mjs
    NO_PROXY=localhost,127.0.0.1 node test_login.mjs --quick                            # ~4 min; without --quick ~8 min

The page's Firebase SDK (gstatic 10.12.0) is served from `node_modules/firebase` (`FIREBASE_SDK_DIR` to change it) and every
app it creates is pointed at the emulators by an init script; other outside requests are refused. The emulators share one
sign-in pool between "both projects", which is why the made-up Dr. A signs in to NLO Cases as dr.owner@example.com.
Screenshots go to `shots/`.
