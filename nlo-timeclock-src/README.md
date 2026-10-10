# NLO Time Clock

Clocking in and out for the office, with overtime heads-ups and boundaries, on the NLO Cases platform: the same Firebase
project (`nlo-cases`), logins and roster as NLO Cases, Leads, A/R and Time Off. Built 9 Oct 2026 (Amir: "a robust custom
clock … that sends me and multiple people alerts when someone is getting close to overtime and set up boundaries").

## Amir's decisions (9 Oct 2026)
- **At the office**: staff clock in at the office's time-clock computer (front-desk touchscreen or iPad): tap your
  photo, 4-digit PIN, then In / Lunch / Back / Out. With the **office lock** on, also on their own phone or computer —
  "only when they're in the office" — decided by the office's internet, not GPS (see The office lock below).
- **From home: only an approved laptop** ("a laptop that one of my assistants uses to sometimes work from home", and a
  teammate who works from home "should be able to work from her laptop as well"): Dr. A approves the laptop once, for the
  people he picks; each uses their PIN on it. Away from the office it's **clock in / clock out only** ("only sometimes a
  few hrs here and there so no need to bring lunch into it"), marked Home, and only for people allowed home; Dr. A can
  limit which days (a home punch on another day is flagged and alerted). At the office the laptop is a time clock like
  any other.
- **Salaried, hours for the record** (someone on salary who works from home most days: "I still want her hours to be
  recorded for the record"): `tcStaff.sal` — on the clock, no overtime, no alerts about hours / boundaries / home, only
  missing-punch alerts; Payroll and the CSV mark them "Salaried (hours for the record)". Only for someone **exempt from
  overtime**: a salary doesn't by itself make a person exempt, so someone salaried but not exempt stays unticked and
  their overtime still counts.
- **"I forgot to punch"** (staff "just clock out an extra time to just write a note"): after their PIN at the time clock,
  or on My time, staff ask for a missed punch (clock in, lunch out/back, clock out; at most 2 punches, last 31 days) or
  leave a note. It changes nobody's time: a manager approves it (the punches become corrections, "Asked by Gwen at the
  time clock: …"), changes the time and approves, or declines with a note. While it waits it shows on the person's own
  screens and decides the time clock's next button (forgot to clock in → can still go to lunch), but counts no hours.
- **Payroll every other Friday**: the Payroll page shows each person's two-week regular and overtime hours first (overtime
  still worked out per workweek, then added), marks payroll day, and the alert script emails the numbers that Friday
  at 7 AM. Payroll Friday = the period's last Friday when it ends Fri–Sun, else the first Friday after it ends.
- **Getting close to 40 hours**: "only warning that they are getting close and only approved ot allows them to go over" —
  a pop-up warning at the time clock and on My time from the first heads-up hour (or when 40 h would come today); at or
  over 40 h without approval, a clock-in (or back from lunch) is asked first — "Clock in anyway", never refused — and
  every such clock-in alerts the managers (`otin`). Managers approve overtime ahead of time in Timesheets.
- **Alerts by email and phone push** (the free ntfy app), to Dr. A and anyone he adds.
- **Boundaries: let them punch, flag it, alert** — never block (time worked has to be paid; blocking invites
  off-the-clock work).
- **Lunch: clock out and back in.** A break shorter than 20 minutes counts as paid time (federal rule: short rest breaks
  are compensable).
- Overtime is over 40 hours in the **workweek** (FLSA; Florida has no daily overtime). Heads-ups at 36 and 38 hours.

## The office lock (9–10 Oct 2026)
Amir's answers: own desktop or phone too (in the office); from home approved laptops only; off the office network
**block it** — except the office's own time-clock computer, which is never refused (its punches go through flagged:
`net` 'off' / 'unk', and an alert); a **hard lock** the database itself checks. Only punching is locked: timesheets,
approvals, Payroll, Settings and "I forgot to punch" work from anywhere, and the alert script is unaffected.
- **The office check** (`worker/office-check.js` → `dist/nlo-timeclock-check.js`, published beside the page): a free
  Cloudflare Worker Dr. A pastes in once (Settings → Office network → Set up the office check; the page fills in a new
  login of its own, `tc-check-…@`, and suggests a Worker name nobody would guess). A page posts its sign-in token
  (plain text: no preflight); the Worker checks Google's signature (RS256, Google's public keys, project, expiry), reads
  `CF-Connecting-IP` (IPv4 exactly; IPv6 by its /64, the first 4 groups), marks addresses many people share (iCloud
  Private Relay's Akamai / Cloudflare / Fastly, Apple, VPNs, hosting: `relay`), and writes `tcNetSeen/{uid}` under its
  own login with the database's time and a **new one-time punch number** (`pid`), which only the asking page is told.
  No service-account key anywhere, and the office's address never goes in the public repo (it's only in Firestore).
- **The rules**: an "at the office" punch (`net` 'office') must be saved under that `pid` (the punch's id), within 2
  minutes of the check, on a network in `tcOffice` — so one check is good for one punch, and a newer check (another tab)
  replaces it. Own phone/computer (`src` 'own'): only with `meta/tc.lock` on, only `net` 'office'. The time clock: 'office'
  (checked), 'off'/'unk' (flagged, always allowed), or '' only with the lock off. A laptop: 'office' (checked), or
  away ('' / 'off' / 'unk') clocking in and out only for someone with `tcStaff.home`.
- **The page**: checks right before every punch (6–8 s timeout). Refused as "at the office" (say a newer check replaced
  the number), the time clock saves the punch as 'unk' (flagged), a laptop checks once more, and My time checks once
  more. The office's time clock also checks every 10 minutes while nobody is using it, to show a line when it's off the
  office network. A laptop checks whenever the office check is set up, even with the lock off; before it's set up a
  laptop counts as away.
- **This is the office** (Dr. A, from a device on the office internet; again from his phone on the Wi-Fi, since phones
  often use IPv6): the rules take only the network the office check saw *his own* login on in the last 5 minutes, never a
  shared (`relay`) address; the page checks again right before saving. A time clock seen on a network that isn't saved
  is shown, with how to save it from that computer (sign in with Manager there) — never a one-click save of where a
  time clock was (a copied time-clock login could fake that). The card says when only IPv4 or only IPv6 is saved.
- **Set it up again** (a lost code): a new login; the running copy keeps working until the new one answers the test,
  then the older logins are turned off (`netBotsKeep`: only when the newest one answers).
- **Approving a laptop**: on the laptop, the sign-in screen's "Approve this laptop" makes its own login (in the
  `tcKiosk` app) and `tcLapReq/{uid}` `{ code (6 digits), dev ("Chrome on Windows"), at }`, shows the code, and waits.
  Dr. A types the code in Settings → Approved laptops on his own phone or computer (his password never goes on the
  laptop), picks the name and the people (1–4; they're allowed home from then on), and approves: `tcLaptops/{uid}` is
  created and the request deleted in one save (the rules need the request). Requests older than a day are cleared.
  A laptop follows its own record live: people added or taken off, or taken back (it signs out and says so).
- **Private Relay**: on iPhones/Macs with iCloud+ it hides the office network in Safari. Staff on it see what to turn off
  (Settings → Wi-Fi → ⓘ → Limit IP Address Tracking / iCloud Private Relay for the office network). Cellular is never
  the office.
- The office check's login is the lock's key: whoever has the pasted code can make any office login look like it's at
  the office. It can't read or change anyone's time. Keep the code private; if it gets out, Set it up again.

## Files
- `src/engine.js` — the arithmetic, shared by the page and the alert script: office time (Eastern, DST-safe), punches +
  corrections → work segments, short paid breaks, day and workweek totals, overtime, ETA to overtime, boundary flags,
  alert texts (`alertsFor`), payroll weeks. No DOM, no database, no Intl when `setTZ` is given (the script passes
  Google's `Utilities.formatDate`).
- `src/*.js`, `src/style.css`, `src/template.html` → `python3 build.py` → `dist/nlo-timeclock.html` (published as
  `../nlo-timeclock.html`) and `dist/nlo-timeclock-demo.html` (made-up people, nothing saved).
- `robot/script.js` (+ `src/engine.js`) → `python3 build.py` → `dist/nlo-timeclock-alerts.gs` (published as
  `../nlo-timeclock-alerts.gs`; the page fetches it and fills in the script's login when Dr. A copies it).
- `worker/office-check.js` → `dist/nlo-timeclock-check.js` (published as `../nlo-timeclock-check.js`; the page fetches
  it and fills in the office check's login when Dr. A copies it into Cloudflare).
- Rules: the shared `../nlo-cases-src/firestore.rules` (the `tc*` collections, `meta/tc`, `meta/tcAlerts`,
  `meta/rules_tc_1`, `meta/rules_tc_2` (the office lock), and the roster's read rule, which the time clock, its laptops
  and its script may read). When the rules change,
  rebuild and publish NLO Cases, A/R and Time Off too (they embed the file).

## Data (Firestore `nlo-cases`, all plain — no patient data; nothing here is a secret except PIN hashes, which nobody can read)
- `meta/tc` — settings, Dr. A writes: `wk` (workweek's first day, 0 = Sunday), `ot` (overtime after, 40), `thr`
  (heads-up hours, [36, 38]), `early` ('HH:MM' earliest clock-in, '' = none), `late` ('HH:MM': still clocked in after →
  alert, '' = off), `shift` (long-shift alert hours, 0 = off), `brk` (breaks shorter than this many minutes are paid,
  20), `days` (office days, [1,2,3,4] = Mon–Thu), `pay` (a pay period's first day, 'YYYY-MM-DD', biweekly), `lock`
  (the office lock on), `wurl` (the office check's `https://….workers.dev` address, '' = not set up), `at`.
- `meta/tcAlerts` — where alerts go, Dr. A writes, managers and the script read: `emails` (≤ 10), `topic` (ntfy
  topic, '' = no push), `route` ({type: bits} 1 = email, 2 = push; a missing type uses the script's default),
  `digest` ('HH:MM' daily summary, '' = off), `test` (timestamp: Dr. A asked for a test alert), `at`.
- `tcStaff/{sid}` — per person (sid = NLO Cases staff id = `roster/{sid}`): `on`, `home`, `hdays` (home days; [] =
  any), `early` (own earliest, '' = the office's), `cap` (weekly cap hours, 0 = none), `sal` (salaried: hours for the
  record; optional), `pinAt` (PIN set, or null), `pinBy` ('mgr' | 'self': a manager set it — the time clock suggests
  picking their own), `at`, `by`. Dr. A writes everything; a manager (or the person at the time clock, right after
  their PIN) moves `pinAt`.
- `tcPin/{sid}` — `{ h, at }`, h = sha256 hex of `'nlo-tc-pin|' + sid + '|' + pin`. Nobody reads it; rules compare.
- `tcTry/{sid}` — PIN tries: `{ n, t0, at, ok, k, bad, u }`. The time clock writes a try (counted; `k` = its uid) together
  with `tcTryPh/{sid}` `{ ph, at }` (the hash tried — nobody can read it: with 4 digits, anyone who could read a hash could
  work out the PIN), then flips `ok` (allowed only if that try's `ph` matches `tcPin`), then a punch uses it up in the
  same save (`n` 0, `u` = the punch id, so one PIN check is one punch; `u` 'pin' for a new PIN, '' when let go). 5 tries
  per 10 minutes; managers clear a lockout. A lockout = `n == 5 && ok == false`. `bad` = tries since the last right PIN
  (8+ alerts: someone guessing slower than the lockout). A punch must come within 5 minutes of the PIN, a request
  within 10; the page ends a PIN visit after 8 minutes.
- `tcPunch/{p + 24 hex}` — `{ sid, kind: in|lunch|back|out, at (server time), src: kiosk|own|laptop (older: home), by
  (uid), net: office|off|unk|'' }`. Never changed or deleted. An "at the office" punch's id is the office check's `pid`.
  In the engine an entry has `src` home|kiosk|fix|req (home = a laptop away from the office, or an older home punch),
  `via` clock|own|laptop, `net`, `dev` (the device's uid).
- `tcFix/{f + 24 hex}` — corrections, never changed: `{ sid, op: add|void, ref (void: the p…/f… id; add: ''), kind
  (add), t (add: ms), why, by, bsid, at }`. Moving a time = void + add. Nobody corrects their own time except Dr. A.
- `tcReq/{r + 24 hex}` — "I forgot to punch": `{ sid, ps: [{ k, t }] (≤ 2 punches asked for; [] = a note), note (≤ 200),
  src: kiosk|laptop|me, by, at, st: open }`, then answered once by a manager (`st` ok|no, `rby`, `rbsid`, `rat`, `rwhy`, `fx`:
  the correction ids) or taken back by the person (`st` x, `rat`). At the time clock it needs the person's PIN checked in
  the last 10 minutes (the try isn't used up, so they can punch next); signed in, only for themselves. Never deleted.
  `tcReqN/{sid}` `{ n, t0, at }` counts them in the same save: at most 10 in 24 hours for each person. An approval must
  name one added correction (`fx`) for each punch asked for.
- `tcOT/{sid}_{week's first day}` — overtime approved ahead of time: `{ sid, week, hrs, why, by, bsid, at }`.
- `tcSent/{a + 32 hex}` — alerts (id = 'a' + first 32 hex of sha256(key)): `{ k, type, sid, text, st:
  claim|sent|fail, ch (bits sent), at, up }`. The script claims before sending, so two copies never double-send.
- `tcBeat/{script uid}` — `{ box, ver, err, sent, at }`. `tcKiosks/{uid}` — `{ name, at, by, seen }`.
  `tcBots/{uid}` — `{ email, at }`.
- The office lock: `tcOffice/{net}` (net `v4:a.b.c.d` | `v6:` + the first 4 groups) `{ name, org, city, by, at }` — Dr. A
  only; the office check reads it. `tcNetBot/{uid}` `{ email, at }` — the office check's login(s). `tcNetSeen/{uid}`
  `{ net, office, org, city, pid, relay, at }` — written only by the office check, only for members, time clocks and
  laptops; only Dr. A reads it (nobody can read a punch number back). `tcLaptops/{uid}` `{ name, sids (1–4), at, by,
  seen }` — the laptop reads its own and its people's records only. `tcLapReq/{uid}` `{ code, dev, at }` — a laptop
  asking; Dr. A or the laptop reads or deletes it, nobody changes it.
- Managers = Dr. A + the people he marks in People → Edit (`tcMgrs/{sid}` `{ at, by }`, `isTcMgr()` in the rules). Amir,
  9 Oct 2026: "right now the manager is me, Dr. Akhavan" — approving time off doesn't make someone a time clock manager.

## Alerts (types; the script sends each key once)
| type | when | key |
|---|---|---|
| thr | workweek total reaches a heads-up hour (36, 38) and overtime isn't approved | `thr|sid|week|h` |
| ot | reaches 40 h (unless approved further) | `ot|sid|week` |
| otx | passes the hours approved ahead of time | `otx|sid|week` |
| cap | reaches the person's weekly cap | `cap|sid|week` |
| early | first clock-in of a day before the earliest time | `early|punchId` |
| offday | a punch on a day the office is closed | `off|sid|day` |
| home | first home clock-in of a day | `home|sid|day` |
| homeday | from home on a day not allowed | `homeday|sid|day` |
| net | a punch at the time-clock computer off the office network (once a day for each person) | `net|sid|day` |
| net | …or while it couldn't check the network (once a day for each person) | `netx|sid|day` |
| late | still clocked in after the late time | `late|sid|day` |
| long | a day's hours reach the long-shift hours | `long|sid|day` |
| ot | a clock-in (or back from lunch) once overtime started without approval, or past what was approved | `otin|punchId` |
| miss | a clock-in left open on an earlier day (counts 0 until fixed) | `miss|punchId` |
| miss | a clock-out (or lunch) with no clock-in before it (`no-in`; the same button twice within 15 min is not) | `noin|punchId` |
| noret | went to lunch and never came back or clocked out | `noret|punchId` |
| req | someone asks for a missed punch, or leaves a note (each request once) | `req|requestId` |
| payroll | payroll Friday, 7 AM: each person's two-week regular and overtime hours, and what to fix first (email only) | `payroll|periodStart` |
| short | a paid short break (info; off by default) | `short|sid|day|ms` |
| pin | 5 wrong PINs (locked 10 minutes) | `pin|sid|t0ms` |
| digest | the daily summary at the set time | `digest|day` |
| test | Dr. A pressed Send a test | `test|ms` |

Corrections a manager makes never alert (early/offday/home only fire for real punches). A missing punch the person has
already asked for doesn't alert (their request does). Someone salaried gets only the missing-punch alerts.

## Build status (10 Oct 2026, early morning)
- All passing: unit 122 (`test/unit.test.js`), rules 418 (`test/rules.test.mjs`), the office check 66
  (`test/worker.test.mjs`: the Worker under Node on the emulators, plus Google's RS256 signature with a key made in the
  test), alert script 57 (`test/robot.test.js`, fake Apps Script services on the real emulators), end to end 99, three
  runs in a row (`test/e2e.py`: the real page on the emulators, with the office check Dr. A copies running under Node
  (`test/worker_server.mjs`) and each browser on a pretend network; a time box takes office time, so it uses
  `office_hm`), demo click-through 116 (`test/demo_smoke.py`). The other apps' rules suites on the same rules file:
  Cases 233, Leads 77, A/R 97, Time Off 159.
- **The alert script and end-to-end tests assume daytime at the office** (a clock-in "3 hours ago today", a run that
  doesn't cross midnight, not 3:00–3:05 AM when an idle time clock reloads itself): run them between about 3:30 AM and
  9 PM Eastern.
- An independent review of the office lock (9–10 Oct, night) found no way past it for strangers, people who left or the
  robots; fixed: an "at the office" pass worked for several punches and background checks renewed it → one punch per
  check (`pid`), owner-only reads; a one-click "save the network the time clock is on" could be faked with a copied
  time-clock login → removed (saved only from where Dr. A is himself); Private Relay / VPN / cellular addresses could be
  saved as the office → refused (`relay`); laptops were approved with Dr. A's password on them → pairing by code;
  network alerts → per person per day, "off" and "couldn't check" apart; a refused office punch → saved flagged; laptops
  counted as home with the lock off → they check whenever the office check is set up; taking someone off a laptop
  blanked it → it follows its own record; "Set it up again" broke the running check → old logins stop only when the new
  one answers (Settings shows when more than one works, with "turn the older ones off now"); IPv4/IPv6 hint. A second
  review then found, and these were fixed: a failed read at load signed a time clock or laptop out for good (its password
  is random and kept nowhere) → it keeps its login and retries, and only the server's "not there" counts; a stranger's
  pairing request could carry its own words to Dr. A → a request says only which browser it is, nothing shows until its
  code matches, a code works 30 minutes (the rules too), each login asks once and only Dr. A clears requests; approving
  turned on "from home" before the approval was saved; a background check could replace a punch's number; misleading
  "That took too long" and laptop "couldn't check" messages; a failed setup left a working login.
- **Known and left (by design):** anything that makes a punch come from the office's internet counts as the office:
  remote desktop into an office computer, a VPN that comes out at the office, or a coworker's device at the office
  passing on someone's sign-in. Don't give staff remote access to office computers; punches before the earliest time or on
  closed days are flagged and alerted whatever device they come from. Also: the time clock's login can read request
  notes and correction reasons (it needs open requests for the next button); My time checks the network when it opens,
  so the last network a person opened it from (internet provider and city, never the address) is kept where only Dr. A
  can read it.
- Run the emulator suites in one `emulators:exec`; each file starts by emptying the emulators.
- Demo for Amir: artifact "NLO Time Clock Demo" (claude.ai/artifact/B5L3PVzrdPciqaAhMcaLRo), built from
  `dist/nlo-timeclock-demo.html` minus its first two meta lines (the artifact host adds charset and viewport).
- Chrome's look-ahead (preload) scanner can start reading this one-file page at a network chunk boundary inside the
  script and treat JS strings as HTML: never write `<img src="' + …` in a JS string (the logo's src is set through the DOM).
- Published 10 Oct 2026 with Amir's OK ("please add it to the home screen along with other apps"): `nlo-timeclock.html`,
  `nlo-timeclock-alerts.gs` and `nlo-timeclock-check.js` at the repo root, the Time Clock tile on the home page (after
  Time Off), and NLO Cases, A/R and Time Off rebuilt for the embedded rules (only their rules copy and CSP hash changed).
  Amir publishes the rules from the Time Clock's card. To publish a change: `python3 build.py`, copy the three files to
  the repo root; when the rules change, rebuild and copy NLO Cases, A/R and Time Off too (an older page's "publish the
  rules" card would cut the time clock off).
- `test/vendor/firebasejs-10.12.2/` holds npm's copies of the pinned SDK files (`npm pack firebase@10.12.2`), byte-identical to
  gstatic's, so the page's integrity hashes pass in tests.
- Firebase app names on the page: `tc` (people signed in) and `tcKiosk` (the time-clock computer's or approved laptop's own
  login, kept on that computer) — never `[DEFAULT]`, so NLO Cases' and Time Off's sign-ins on the same computer are
  untouched.
