# NLO Cases — source

Encrypted case tracker that replaces Asana + Tally for patient cases. The page people open is `../nlo-cases.html` (built from here).

- `src/` — `core.js` (config, case types/stages, crypto helpers, Asana parsing), `backend.js` (Firebase: sign-in, key ring, encrypted cases, enforced version history, team, key change), `demo.js` (`?demo`, made-up data), `ipr.js` (read-only link to the IPR Tracker's database), `ui.js`, `caseform.js` (tap-first New case form), `admin.js`, `style.css`, `template.html`.
- `firestore.rules` — security rules; `__OWNER_EMAIL__` is filled in by the build.
- `python3 build.py` → `dist/nlo-cases.html` + `dist/firestore.rules` (set `OWNER_EMAIL=...` for the real rules; a `fbconfig.js` JSON file with the Firebase web config switches it from demo-only to live).
- Tests (need `npm i -D firebase-tools @firebase/rules-unit-testing firebase@^12 firebase10@npm:firebase@10.12.2 playwright` and a static server on :8765 serving `dist/`):
  `NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases "node test/rules.test.mjs && node test/e2e.js"`, plus `node test/ipr_parity.js` and `node test/demo_smoke.js`.
