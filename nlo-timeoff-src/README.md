# NLO Time Off

Time-off requests, approvals, balances and benefits (Celebrate Primary Care, the 401(k), the scrubs allowance) for the
office, on the NLO Cases platform: the same Firebase project (`nlo-cases`), logins and roster. It replaces the old
`time-off.html` and `benefits.html` and their Apps Scripts.

- `src/` — `core.js` (helpers and crypto), `policy.js` (the handbook: office days, hours, tiers, the ledger, checks, scrubs,
  payroll), `roster.js` (Staff Hub's office roster: who is who, and what it says in an HR record's terms), `reader.js`
  (.xlsx and CSV), `backend.js` (Firebase), `demo.js` (an in-memory backend for `?demo`, which emulates the rules), `ui.js`,
  `views.js`, `admin.js`, `staffhub.js` (Settings → Staff Hub, bringing its facts in, Team's list), `importer.js` (the
  one-time move from the old Sheet), `style.css`, `template.html`.
- `python3 build.py` → `dist/nlo-timeoff.html` (published as `../nlo-timeoff.html`) and `dist/nlo-timeoff-demo.html`
  (demo only). `fbconfig.js` is the live Firebase web config (public by design; security is the rules plus sealing).
- Security rules are shared: `../nlo-cases-src/firestore.rules` (the Time Off part is the `to*` collections and
  `meta/to*`). The page embeds the whole file and hands Dr. A the new set until `meta/rules_to_2` can be read. When the
  rules change, rebuild and publish NLO Cases and NLO A/R too, since they embed the same file.
- Everything personal is sealed in the browser (ECDH P-256 + AES-GCM): requests and scrubs to the HR key and to the
  person; HR records to the HR key; Who's out to the office key; the CADANCe/calendar feed to its own key.
- Staff Hub is the source for staff facts (Amir, 9 Oct 2026): each person's start date (vacation tiers count from it),
  full-/part-time and last day come from Staff Hub's office roster (`nlo/cadence/roster` in the nlo-inventory Realtime
  Database, which Staff Hub publishes and any office Google account can write). A value that differs from the HR record — and
  the record of someone hired after the move — waits in Settings → Staff Hub until Dr. A brings it in (with what it does to
  the balance), or keeps Time Off's (`shKeep`). A full-/part-time change counts from the day it's brought in (`typeWas`,
  `typeOn` in policy.js). Records Staff Hub agrees with are only marked (`sh: { id, f }`); the HR editor shows those fields as
  Staff Hub's and never writes them. Names go into NLO Cases' team (`roster`/`members`) by themselves, as NLO Cases does, with
  the Staff Hub id saved as `rid` (`-` = not on Staff Hub; Team → Link… sets it). Matching by name needs a first and last
  name. Dr. A's computer reads the roster with the Google sign-in NLO Cases uses for it (a second Firebase app named `ipr`;
  connecting in either app connects both), at sign-in and when Settings or Team is opened; nothing is written to Staff Hub.
  The move from the old app uses Staff Hub's facts too and shows where the Sheet differs.
- Salary (Amir, 9 Oct 2026): Staff Hub's Employment "Full-time (salary)" (any word with "salar") is `type: 'SAL'`
  (`normType`, `isSalaried` in policy.js). On salary there's no balance: on the first salaried day what's left closes, not
  paid out (a `salary` entry on the statement), nothing is earned, paid time off comes from no balance, adjustments don't
  apply, and they're off the payroll and year-end lists. Their time off is still asked for and shows on Who's out. Team
  lists them under the table. Dr. A isn't on Staff Hub's staff list, so his own record's Employment is set in the HR
  editor (Salary is a choice there for records Staff Hub doesn't supply).
- Approved scrubs orders are emailed by NLO Cases' email robot (`../nlo-cases-src/mail/script.js`, v3 or later) to the
  address in `meta/toMail`. After changing `mail/script.js`, run `node tools/build-mail.js` in `nlo-cases-src` (it needs
  esbuild, aes-js, elliptic and hash.js) and publish `mail/nlo-cases-mail.gs` as `../nlo-cases-mail.gs`.

## Tests (made-up people only)
- `node test/unit.test.js` — the policy and the old Sheet's arithmetic.
- `node test/demo_smoke.js` — clicks through `?demo` on desktop and phone (needs a static server on :8770 serving `dist/`).
- In the Firebase emulators (`NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases "<cmd>"`):
  `node test/rules.test.mjs` (the rules) and `node test/e2e.js` (the real NLO Cases and Time Off pages, and a made-up Staff
  Hub roster in the database emulator; needs a static server on :8771 serving `nlo-timeoff.html` next to `nlo-cases.html`
  and `logo-white.png`).
- `node test/feed_readers.js` — the office calendar and CADANCe reading the feed (a stand-in Firebase,
  `test/fake-firebase.js`; needs a static server on :8772 serving the repo root). They read it once its key is saved in
  the calendar's Admin settings → Time-Off sync (kept at `nlo/cadence/timeOffFeed` in the nlo-inventory database), and
  the old Time-Off app until then.
- The browser tests serve Google's exact Firebase SDK files (the page checks their integrity), fetched once into
  `test/vendor/firebasejs-10.12.2/` (not committed).
- `node test/make_fixture.js && python3 test/make_fixture.py` rebuilds the made-up old Sheet in `test/fixtures/` from
  `demo.js`.
