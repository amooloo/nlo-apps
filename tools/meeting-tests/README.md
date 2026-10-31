# Staff Meeting Hub on the NLO Cases system — checks

Amir, 30 Oct 2026: "make the login for staff hub the same as case tracker" → he meant the **Staff Meeting Hub**
(`../../staff-meeting.html`), and chose the full move: no Google sign-in at all. Until Dr. A presses **Move** (Settings, in
the Hub), nothing changes: the Hub and Month-End Numbers (`../../month-end.html`, whose numbers live in the Hub's data) use
the office Google account and the old database (`nlo-inventory`, `nlo/staffMeeting`) exactly as before. After the move both
open with each person's NLO Cases username and password, and their data lives on the NLO Cases system (`nlo-cases`
Firestore, the block "the Staff Meeting Hub + Month-End Numbers" at the end of `../../nlo-cases-src/firestore.rules`).
Cadence's "Staff meeting" button (`../../cadence.html`, `<script id="nlo-meeting-addon">`) follows the move by itself.

- `../../nlo-meeting-db.js` — the shared layer: the pages keep their old-database calls (`db.ref(path).on/once/set/update/
  push/transaction…`); after the move those go to Firestore records (`MOUNTS`: `inbox` → `mtgInbox`, `actionItems` →
  `mtgActions`, `decisions` → `mtgDecisions`, `kpiDefs` → `mtgKpiDefs`, `meetings` → `mtgMeetings` with transcripts and
  pasted notes in `mtgTexts`, `config`/`currentMeetingId`/`roster` → `mtgState/…`, the shared AISA key → `mtgState/aisa`,
  `monthEnd/…` → `meMonths` + `meState/…`), every write stamped `_by` (NLO Cases staff id) + `_up` (the database's time).
  Read only: the office Gemini key (Inventory's `invState/ai`), the staff list (Cadence's `cadMirror/roster`), Cadence's
  checklists and Inventory's spending for the agenda. Also the NLO Cases sign-in (no session kept across reloads, Lock,
  NLO Cases' idle minutes, locked at once if the login is turned off), `mtgMeta/moved` (which database the pages use,
  readable before signing in), and the move itself (`readOld` → `writeRecords`, read back and compared).
- `adapter.test.mjs` — every step done to the old database (Realtime Database emulator) and through the layer (Firestore
  emulator, the real rules) must read back the same: sets, updates (multi-path, nested, nulls), pushes, transactions,
  arrays, listeners, a meeting's texts, the read-only paths; and what the rules let each login do (staff, turned off,
  signed out, still on a temporary password; stamps that aren't theirs; the move flag and the AISA key, Dr. A only); and
  the old database's events: a save that changes nothing is no event, and nothing is reported from an empty cache while
  offline as a page opens; a screen during a move (paused; after a pause that ended without the old copy marked moved, it
  carries on only once the NLO Cases database says not moved, else switches); a pause left behind counted from when the
  computer first saw it. 70 checks.
- `test_hub.mjs` — the real pages, start to finish, on a made-up office (`seed.mjs`): before the move (Google, as today,
  on two computers, and a Cadence screen with no button); the move (a staff login refused, the older rules → copy the new
  file → "Not yet" → published, the counts, the copy in Downloads, switched over, the old copy kept and marked); after it
  (the other computer and the Cadence screen switch over by themselves; turned-off, temporary-password and wrong-password
  logins refused; Gwen's notes in her name; Dr. A sees them; Move back only for Dr. A; Lock); the agenda's numbers from
  Cadence's and Inventory's own records, the AI keys, starting and ending a meeting; Month-End (sign-in, September moved,
  October typed in her name, totals, the Hub sees it); Cadence's button (tick a to-do off and undo, raise something); a
  login turned off while open; the idle lock (`--quick` skips it, ~1.5 min); moving back (needs the office Google
  sign-in and the tick; everything done since the move goes back without the stamps; this screen, the other computer and
  the Cadence screen follow). After the independent review: the other screens pause while it moves (and moves back);
  Month-End open and idle saves nothing again and again; a computer that can't reach the NLO Cases database after the move
  says so and saves nothing to the old copy; the move can't be run again once moved; closing the move page signs Dr. A's
  NLO Cases login out. After the second review: Cadence as it really runs (on the NLO Cases system; one screen with the
  office Google connection, one without), a move claimed by one screen at a time (a claim left by a closed tab goes by
  itself; an old one is ignored), writes refused on a paused screen, no false "can't confirm" while switching. 97 checks
  (`--quick`: 95). Screenshots in `shots/`.

Run (Java and Node 20+):

    npm install
    npx firebase emulators:start --only auth,firestore,database --project demo-nlo     # leave running
    (cd ../.. && python3 -m http.server 8766 --bind 127.0.0.1)                          # the repo, served
    NO_PROXY=localhost,127.0.0.1 node adapter.test.mjs
    NO_PROXY=localhost,127.0.0.1 node test_hub.mjs            # ~4 min; --quick ~2.5 min

The pages' Firebase SDK (gstatic 10.12.x) is served from `node_modules/firebase` and every app a page makes is pointed at
the emulators by an init script (`wire.mjs`); other outside requests are refused. The NLO Cases office (logins, keys) comes
from `../staff-hub-tests/seed.mjs`; the old database's rules from `../cadence-tests/rtdb.rules.json`. `CHROME` = a
Chromium to use if Playwright's own isn't installed.
