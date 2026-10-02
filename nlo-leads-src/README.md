# NLO Leads — source

Encrypted new-lead tracker that replaces the Asana project "New Leads – Appointment Requests". The page people open is `../nlo-leads.html` (built from here). It uses the same Firebase project (`nlo-cases`), the same logins and the same office key as NLO Cases.

- `src/` — `core.js` (crypto helpers, CSV, office days/holidays), `leads.js` (the follow-up rules — five attempts on office days, logging and undo, duplicates, the website request → lead step, Asana import, results; pure functions), `backend.js` (Firebase: sign-in, key ring, encrypted leads with enforced version history, the website inbox), `demo.js` (`?demo`, made-up leads), `ui.js`, `forms.js` (lead page, logging, New lead), `admin.js` (Settings, Import & export, My account), `style.css`, `template.html`.
- `intake/` — the receiving service for the website form (Google Cloud Run, Node.js 24, no dependencies): `server.js`, `parse.js` (reads Elementor's Webhook post — flat, "Advanced Data" or JSON), `seal.js` (seals each request to the website feed's public key; only signed-in browsers can open it), `firestore.js` (the three Firestore calls, over REST), `deploy-intake.sh` (one-time setup in Google Cloud Shell; prints the service's address).
- Security rules are shared with NLO Cases: `../nlo-cases-src/firestore.rules` (the Leads block is at the end). `OWNER_EMAIL=<Dr. A's sign-in email> python3 build.py` writes `dist/firestore.rules` to publish.
- `python3 build.py` → `dist/nlo-leads.html`. `fbconfig.js` holds the live Firebase web config (public by design; security is the rules plus encryption).
- Tests use made-up data only. Same tools as NLO Cases, plus a static server on :8765 serving `dist/` with `nlo-cases.html` copied in:
  - `node test/unit.test.js` (follow-up rules), `node test/parse.test.js` (reading the form, sealing), `node test/demo_smoke.js`
  - `NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/rules.test.mjs && node test/intake.test.js && node test/e2e.js"`
