# The Office Calendar's and Onboarding's moves onto the NLO Cases system (checks)

Since 31 Oct 2026 the Office Calendar (`../../nlo-calendar.html`) and Onboarding (`../../onboarding.html`) can move from the
old office database (the `nlo-inventory` Realtime Database, office Google accounts) onto the NLO Cases system (the
`nlo-cases` Firestore database, the NLO Cases login) — Amir: "I want to make them all kind of like the case tracker with the
same login … eliminate the use of Google signing", and "make the staff hub information as one source of truth for all the
other apps in terms of the staff". Both use the Staff Meeting Hub's layer (`../../nlo-meeting-db.js`, `NLOM.forApp`), the
same "Full move" as the Hub (nothing changes until Dr. A presses Move; the rules first), and Staff Hub's roster on the NLO
Cases system (`hubRoster/live`, which Staff Hub keeps there through Dr. A's login). Everything here is a made-up office on
the Firebase emulators: nothing live is read or written.

- `seed.mjs` — the office: the NLO Cases logins from `../staff-hub-tests/seed.mjs` with each person's Staff Hub roster id
  (`roster/<sid>.rid`), Staff Hub's roster and NLO Time Off's feed key in the old database, the calendar's and Onboarding's
  data there as the live pages keep them, the old database's rules (`rtdb.rules.json`), and the NLO Cases rules as they
  were before these blocks.
- `adapter.test.mjs` — each page's own layer (its `NLOM.forApp({...})` setup is read out of the page): every kind of save
  the two pages make, done to the old database and through the new layer, read back the same; the places they only read;
  the moves' record making (old values → records → read back the same, counts, ids; Staff Hub's roster and the feed key
  copied in once and never written over a roster Staff Hub already keeps there; a re-run changes nothing; Onboarding's
  PINs, phone links and devices never read); the rules — the calendar's editors (Dr. A plus the staff he ticks; the list
  only he changes), stamps, odd ids, the "moved" records, nobody signed in, a login on its temporary password or turned
  off, Staff Hub's roster record (only Dr. A writes it, only its own fields, never deleted); Onboarding — everyone saves
  training records, only managers (Dr. A plus the ones he names, with a login linked to their Staff Hub person) change
  the curriculum and the settings, only he the roles; what the Staff Meeting Hub reads of both apps before and after
  their moves (the old database when the screen has the office Google sign-in, else nothing; then the records) and
  Staff Hub's roster (else Cadence's copy); a screen on the old database during a move. 143 checks.
- `test_cal.mjs` — the real calendar page: before the move (the office Google sign-in and the admin PIN, as today; a move
  claimed on one screen pausing the others and going with that screen), the move (a staff login refused, a wrong
  password, the rules card until the rules are published, what moves counted, the copy to Downloads, the other screen
  paused then switched over, the records), after it (Dr. A's NLO Cases login edits at once; Who can edit from the team's
  logins; Gwen sees but can't edit until ticked, then adds a closure and an entry — stamped — and loses editing when
  unticked, the database refusing her; Staff Hub's roster and NLO Time Off's key from the NLO Cases system; a login still
  being set up, one turned off; Lock; a phone), and the way back (no Google step on a computer that still has it, the
  tick, the copy, the other screen going back by itself, everything in the old database). 73 checks.
- `test_onb.mjs` — the real Onboarding page: before (the office account and the name picker, Nora's personal link on her
  phone, as today), the move (as above; PINs, links and devices stay behind; the phone on its link switches over too and
  says links aren't used any more), after it (Dr. A; People & access without PIN or link columns; Nora sent to NLO Cases
  while her login is on its temporary password, then straight into her training from her phone, passing a quiz; her
  skill ready for sign-off with no sign-off button for herself; Gwen the trainer landing on Sign-offs and signing it off
  as the signed-in trainer — no picking, no PIN —, every item checked first, Nora's phone showing it at once; Gwen kept
  out of the curriculum until Dr. A names her a manager, the database following; a login turned off; Lock; the plan
  dialog without phone links), and the way back (Nora's phone reopening her training from its link). 70 checks.

Run (Java and Node 20+; the pages' Firebase SDK is served from `node_modules/firebase` — 10.12.2 compat — for the calendar's
9.23.0 and Onboarding's 10.12.2 gstatic addresses; `../meeting-tests/node_modules` can be symlinked here):

    npm install
    npx firebase emulators:start --only auth,firestore,database --project demo-nlo     # leave running (singleProjectMode off)
    (cd ../.. && python3 -m http.server 8766 --bind 127.0.0.1)                           # the repo, for the pages
    NO_PROXY=localhost,127.0.0.1 node adapter.test.mjs
    NO_PROXY=localhost,127.0.0.1 node test_cal.mjs
    NO_PROXY=localhost,127.0.0.1 node test_onb.mjs

`CHROME=/usr/bin/google-chrome` when Playwright's own browser isn't installed. The emulators share one sign-in pool, so
the made-up Dr. A signs in to NLO Cases as dr.owner@example.com; `MTG_BASE` changes the pages' address. Screenshots go to
`shots/`. The other apps' rules suites use the project `demo-nlo-cases` on the same emulator: run them one at a time.
