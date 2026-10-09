# NLO Time Off

Time-off requests, approvals, balances and benefits (Celebrate Primary Care, the 401(k), the scrubs allowance) for the
office, on the NLO Cases platform: the same Firebase project (`nlo-cases`), logins and roster. It replaces the old
`time-off.html` and `benefits.html` and their Apps Scripts.

- `src/` — `core.js` (helpers and crypto), `policy.js` (the handbook: office days, hours, tiers, the ledger, checks, scrubs,
  payroll), `reader.js` (.xlsx and CSV), `backend.js` (Firebase), `demo.js` (an in-memory backend for `?demo`, which
  emulates the rules), `ui.js`, `views.js`, `admin.js`, `importer.js` (the one-time move from the old Sheet), `style.css`,
  `template.html`.
- `python3 build.py` → `dist/nlo-timeoff.html` (published as `../nlo-timeoff.html`) and `dist/nlo-timeoff-demo.html`
  (demo only). `fbconfig.js` is the live Firebase web config (public by design; security is the rules plus sealing).
- Security rules are shared: `../nlo-cases-src/firestore.rules` (the Time Off part is the `to*` collections and
  `meta/to*`). The page embeds the whole file and hands Dr. A the new set until `meta/rules_to_2` can be read. When the
  rules change, rebuild and publish NLO Cases and NLO A/R too, since they embed the same file.
- Everything personal is sealed in the browser (ECDH P-256 + AES-GCM): requests and scrubs to the HR key and to the
  person; HR records to the HR key; Who's out to the office key; the CADANCe/calendar feed to its own key.
- Approved scrubs orders are emailed by NLO Cases' email robot (`../nlo-cases-src/mail/script.js`, v3 or later) to the
  address in `meta/toMail`. After changing `mail/script.js`, run `node tools/build-mail.js` in `nlo-cases-src` (it needs
  esbuild, aes-js, elliptic and hash.js) and publish `mail/nlo-cases-mail.gs` as `../nlo-cases-mail.gs`.

## Tests (made-up people only)
- `node test/unit.test.js` — the policy and the old Sheet's arithmetic.
- `node test/demo_smoke.js` — clicks through `?demo` on desktop and phone (needs a static server on :8770 serving `dist/`).
- In the Firebase emulators (`NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "<cmd>"`):
  `node test/rules.test.mjs` (the rules) and `node test/e2e.js` (the real NLO Cases and Time Off pages; needs a static
  server on :8771 serving `nlo-timeoff.html` next to `nlo-cases.html` and `logo-white.png`).
- The browser tests serve Google's exact Firebase SDK files (the page checks their integrity), fetched once into
  `test/vendor/firebasejs-10.12.2/` (not committed).
- `node test/make_fixture.js && python3 test/make_fixture.py` rebuilds the made-up old Sheet in `test/fixtures/` from
  `demo.js`.
