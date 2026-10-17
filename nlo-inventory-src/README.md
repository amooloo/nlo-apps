# NLO Inventory (5.x, on the NLO Cases platform)

Supplies, the shared cart, orders, receiving and the monthly supply budget for Next Level Orthodontics.
Since 5.0 (October 2026) it lives on the NLO Cases platform, like NLO Cases, Leads, A/R, Time Off and the Time Clock:
the same Firebase project (`nlo-cases`, Firestore), the **same logins and roster**, the **same lock after the office's idle
minutes** (NLO Cases → Team & security, 10 by default), and the **same rules file**. Amir, 16 Oct 2026: "okay can you make this
app similar to case tracker to use the same logins and logout after 10 mins same rules" → "Move it fully".

Page: `https://amooloo.github.io/nlo-apps/nlo-inventory.html` (GitHub Pages, from `../nlo-inventory.html`). The old address,
`nlo-inventory.web.app`, opens the new page once Inventory has moved over (`deploy.py`).

## What changed from 4.0
- **Signing in**: each person's own NLO Cases username and password (no Google account, no tapping a name). Every cart line,
  order, receipt, stock step and expense is stamped with the person signed in. The page locks after the office's idle minutes
  and on Lock; a reload means signing in again (as NLO Cases). Someone whose login is turned off is locked out at once.
- **Only Dr. A sees everything; everyone else gets the simple view.** Amir, 16 Oct 2026: "for assistants, the budget vendor
  and setting are not needed. keep at simple as possible. they will just need to look up inventory, add items to the cart
  and if I approve them, they can place order" (and, asked: only he approves; they also receive, use Quick order, update
  counts and add or edit supplies). Everyone else's menu: Home (no spending, no activity), Supplies, Cart, Orders, Quick order
  — no Budget, Activity, Vendors, Settings or Ask; no typed-in orders, editing, voiding, reopening or ordering again; no
  archiving or deleting supplies. Settings (budget amounts, vendors, storage locations, archiving/deleting supplies,
  voiding/reopening orders, the alerts, the AI keys) are his alone, and the **database itself** holds everyone else to that.
- **Dr. A OKs the cart**: a line anyone else adds waits for his OK (Cart: **OK** on a line, **OK all**; his Home and the red
  Cart in the menu say how many wait). The others place only the OK'd lines (the rest stay in the cart); he places any. More
  of a line than he OK'd waits again (back down to it is OK'd again); his own adds are OK'd from the start. His OKs are kept
  in the cart record (`ok`), which only he can add to or change — anyone else's save may only take one off with its line —
  and each placed line carries the OK. An OK covers the supply, how many, the vendor and the price: more of it, another
  vendor or a higher price waits for him again (and he hears of it as he does of an add); he OKs what his screen showed, so a
  line raised just before his tap still waits. What's ordered is what the place-order dialog showed when it opened (more
  added meanwhile stays in the cart, waiting). The cart and its order are saved in one step. That an order someone else
  places came only from OK'd lines is checked by the page, not the database (the cart is one shared record); his OKs
  themselves can't be faked.
- **A push on his phone** (the free ntfy app) when someone adds to the cart: Settings → Phone push (the Time Clock's topic —
  nothing new on the phone, though the Time Clock's managers can see it — or one of its own; a test; off). The alert script
  sends them.
- **The names on the steps are checked by the database**: each person adds only to their own activity-log record, an
  order's trail only grows by the saver's own step (and who received it is whoever saved the receipt), and an expense is in
  the name of whoever added it (only they, or Dr. A, take it off). The screens show the person behind the id, as NLO Cases
  knows them today. Once an order is received, everyone else only adds its paperwork (invoice numbers and amounts, prices from
  the packing slip, the slip photo). Anyone may add a vendor by name, or fill in a missing account number or address;
  websites, phones, order emails and reps are Dr. A's (and a website opens only if it's an http(s) address).
- **One tap opens the order** (Amir, 16 Oct 2026: "I used to be able to select email and it would automatically open up the
  email with the message in it. same thing with text"): in the place-order dialog, tapping Email opens the email program with
  the order written out (on a computer, a "Write it in Gmail" link too), Text opens Messages (phone, iPad, Mac), Their website
  opens in a new tab, and Phone call dials on a phone. An office PC can't send a text, so there Text shows it as a QR code
  (`SMSTO:<number>:<text>`, drawn with the QR-label library): the phone's camera opens it in Messages, ready to send (a Mac
  shows the QR code too, under the Messages button). The text is short and in plain characters; it goes to the rep's mobile,
  else the vendor's main number. Nothing is marked ordered until "It's ordered". (`src/cart.js`: placeLinks, launchUrl,
  devKind, orderSms, drawTextQr; e2e `t_order_links`.)
- **Photos first** (5.0.2; Amir, 16 Oct 2026: "one thing I don't like is the size of photos....its very small now" / "I love
  high quality pro phtoos of the product" / "I'm very visual"): Supplies opens as a **photo grid** (square cards, the photo whole
  on white, what's going on with it on the photo — in cart, on order, low, expiring —, then name, vendor, price, stock and Add);
  **List** is one tap away and remembered on each computer (`localStorage nloInv.supLook`). The drawer opens on the **full-size
  photo**; a tap on it (or the ⤢ on a card) fills the screen (`#viewer`; Esc, × or a tap outside closes it; locking closes it).
  A supply with no photo offers "Add a photo" (the editor, where "Clean it up with AI" makes a studio shot on white when the
  OpenAI key is set). Thumbnails are bigger everywhere and never cropped (list 64 px, cart 72 px, add-to-cart 120 px, order and
  receiving lines 44 px). New photos keep an 800 px thumbnail (was 400; the 3.x app's were 800) besides the 1600 px full one.
  Photos kept as records of their own (`invPics`) are read only when their card comes near the screen (IntersectionObserver);
  web photos load lazily. On a phone the grid is two across and the category chips scroll sideways in one row.
  (`src/supplies.js` itemCardHTML/supLook, `src/ui.js` photoImgHTML/lazyPic/openViewer, `src/style.css`; e2e `t_photos`.)
- **Quick-order prices** save for everyone (the old database's rules refused them).
- **Photos** kept inside records (old supplies, packing slips) are records of their own (`invPics`), read when shown.
- **Vendor account numbers, reps and card notes** are no longer built into the page (it's published from the public repo):
  they live in the database (saved vendors), put there once at the move.
- **The activity log is no longer trimmed**: one record a month, entries only ever added (the page reads the last 36 months).
- **Offline**: steps that need the database itself (stock, cart, receiving, reopening) say at once that there's no internet,
  instead of queueing; other saves go when it's back. A save still waiting holds off the idle lock two minutes at most (the
  lock then says it may not have been saved).
- **Receiving and reopening are one step each**: the order's new status, its backorder, the stock and the dollars go in
  together or not at all, so an order is never left received with nothing booked (a slow one that goes through after all
  says so; one whose reply got lost and is tried again finds itself done). Order steps (backordered, voided, brought back,
  edited, an invoice matched) are made from the order as the database has it, so two computers at once don't trip each
  other; like stock and the cart, they need the internet.

## The data (Firestore `nlo-cases`; rules: `../nlo-cases-src/firestore.rules`, block "NLO Inventory")
- `invItems/{id}`, `invOrders/{id}`, `invVendors/{id}` — one record each, under the old app's ids, same fields as before.
- `invLog/m<YYYY-MM>~<staff id>` — `{ e: { <entryId>: entry }, mon, who }`: one record per person per month, entries only
  added, each person only to their own (whose record it is says who made an entry). The moved entries are under `~old`
  (`~old2`… past a thousand in a month), with the old app's stamps.
- `invExpenses/{id}` — the expenses bought outside an order, in the name of whoever added them (`byId`); added and taken off,
  never changed.
- `invState/cart {lines, ok}` (`ok`: Dr. A's OK by line id, `{by, byId, at, n: counted units OK'd, it: the supply}`),
  `invState/budget {monthly, categories, history, changedBy, changedAt}`, `invState/prices {p}`, `invState/bracket {v}`,
  `invState/settings {locations, alertsOn, pushOn, geminiProxyUrl, invPrefs}` (`invAdmins`, the old app's list, is allowed
  but means nothing), `invState/ai {gemini, openai}` (Dr. A sets; members and the alert script read), `invState/push {topic,
  test}` (Dr. A's ntfy topic; only he and the alert script read it).
- Every record carries `up` (the database's time) and `upBy` (the staff id), and every save moves `invState/rev.n` by one in
  the same save (the rules check both).
- `invAlerts/{auto}` — the cart/order/receiving emails waiting for the alert script; `invPics/{id}` `{m, b, kind}`;
  `invMeta/moved`; `invBots/{uid}` (the alert script's login), `invBeat/{uid}` (when it last checked); marker `meta/rules_inv_1`.
- Old records keep Staff Hub's ids in their stamps (`s_sarah`…): a roster entry linked to Staff Hub (`rid`) answers to both.

## The move (once, Dr. A)
The page shows Dr. A "Move Inventory over" until `invMeta/moved` exists (staff see "Inventory is moving").
- **First the old Inventory is made read-only** (`freeze_old.py --freeze`, go-live step 3): no page may write Inventory's eight
  parts of the old database any more (Dr. A's own included), so a computer still showing the old page can change nothing
  (it's refused there, so nobody thinks they did something that's lost). The alert script copies there with Dr. A's Google
  token, which goes past the rules; the helper checks that with its own (the Firebase CLI's), and if it were refused it keeps
  Dr. A's account as the writer and says so. It leaves `nlo/settings/invFrozen`, and the move card won't move without it.
  The rules from before are kept in `rollback/` (git-ignored; a second run never replaces them); `--unfreeze` gives the eight
  parts those write rules back on the rules as they are then (other apps' later changes stay).
- He connects to the old database with Google (its own sign-in, `invMove`, kept only while the page is open and closed after
  the move); the page reads `nlo/{items,orders,vendors,log,cart,budget,bracketOrder,elastoPrices,settings/…}` over REST and shows
  what it found (counts, money in the log, this month's spending, notes). The cart's lines come over waiting for his OK.
- **"Move it now" reads it all again** and stops if anything differs from what the card showed (the new numbers are shown
  instead), **saves a copy of what it read to the computer's Downloads** (`nlo-inventory-before-the-move-<date>.json`, without the
  AI keys), then saves photos (photos kept anywhere inside a record become records of their own) and everything else in saves
  of at most 8 MB / 400 records, adding to the log only the entries not already there and skipping expenses already saved.
  Then it looks for every record and log entry it meant to save (money included) and only then writes `invMeta/moved`.
  A record still over 1 MB without its photos stays behind, named in the notes.
- Running it again (one that stopped half way) saves the same records under the same ids; nothing doubles, nothing already
  saved is removed. The old database isn't changed by the move.
- The email alerts start **off** (with a note if they were on): the first "Get the alert script" turns them on, so they don't
  pile up for a script that isn't running yet.
Before it, the vendor details go into the old database's saved vendors (`vendor_details.py`, only what's missing), so the move
carries them.

## The alert script ("NLO Inventory Alerts", version 3, in akhavan.ak@gmail.com's Apps Script)
`robot/script.js` → `dist/nlo-inventory-alerts.gs` (published as `../nlo-inventory-alerts.gs`). Settings → Email alerts → Get
the alert script makes it a login of its own (`invBots`; the newest two kept) and copies the script with that login filled in;
Dr. A pastes it over the old code (same project, same every-minute trigger, no new permissions) and runs `setup`.
Every minute (every 10 at night) it reads `invState/rev`; when it moved:
- **emails the alerts** in emails of at most 25 alerts and ~150 KB (each alert cut to 60 lines), remembers each email's
  alerts as it goes (nothing is sent twice) and clears them; if Gmail's daily limit is used up they wait (the check-in in
  Settings says so). With the phone push on, cart adds by anyone but Dr. A go to his phone instead (one push each, one for all
  of them past four; his own aren't sent): straight to ntfy, or — when Google's servers can't reach it or it says "too many"
  (ntfy.sh shuts out shared addresses for hours) — in one email to ntfy's address for the topic (`ntfy-<topic>@ntfy.sh`), and
  the direct way rests 3 hours (`INV_NTFY_REST`), as the Time Clock's script does; meanwhile such an email goes at most every
  10 minutes (the pushes waiting go together) and only while 10 of the day's emails are left for the alerts themselves. Alerts left while the email alerts are off
  are cleared unsent. A test push Dr. A asks for (`invState/push.test`) goes first;
- **copies** what changed (`up` after the last copy, looking 5 minutes further back each time, since a save's time is when it
  was sent) from `invItems`, `invOrders` and `invLog` into the old database (`nlo/items`, `nlo/orders`, `nlo/log`; an entry's
  `byId` is whose record it's in), the budget with its expenses as one list (`nlo/budget`: only the keys the app keeps, so
  anything else there stays), and the AI keys (`nlo/settings/geminiKey`, `openaiKey`) — where **Staff Meeting's spending card,
  Month-End and AISA's stock answers read them**. Everything is copied again once a night. It only adds and changes records
  there, never removes any (an expense taken off leaves the list), and copies nothing before the move.
- The emails and the copy are separate steps: one failing never holds up the other; both are tried again the next minute.
If an old Inventory page is still open somewhere and used (it leaves alerts in `nlo/settings/alertQueue`), it emails Dr. A to
reload that computer (once an hour) and clears that queue. "Get the alert script" makes a new login and keeps the one whose
script checked in last (the copy running now); any others stop.

## Build, test, publish
- `python3 build.py` → `dist/nlo-inventory.html`, `dist/nlo-inventory-alerts.gs`, `dist/firestore.rules` (OWNER_EMAIL),
  `dist/demo.html` (+ `demo-page.html`), `dist/redirect/index.html`, and `dist/vendor-details.json` (from
  `src/vendors.private.js`, not in git — `--vendors-from-live` recreates it from the old page's backup copy). The build refuses a
  page that would carry any vendor account number, rep or card hint.
- Tests (inside the emulators; `node_modules` → `../nlo-cases-src/node_modules`; `test/vendor/firebasejs-10.12.2/` = the three
  compat files from `npm pack firebase@10.12.2`; `NO_PROXY=127.0.0.1,localhost`):
  `npx firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases "python3 test/e2e.py && node test/robot.test.js && node test/rules.test.mjs"`
  — the end-to-end checks (the real page; the move from v3-shaped data, its read-only check, second reading, saved copy,
  re-run, large photos; sign-in, lock, idle lock; the names on the steps; the simple view; Dr. A's OK on the cart; the phone
  push settings; every flow of 4.0's suite; two computers at once; a slow receive, a retried one; rules gate; the copied alert
  script run), the alert-script checks (with a stand-in ntfy), the rules checks, and 25 for the read-only helper (16 Oct
  evening: 378, 79, 302, 25). The other apps' suites must pass on the same rules file (Cases 258, Leads 77, A/R 97,
  Time Off 159, Time Clock 433 on 16 Oct).
- Publish: copy `dist/nlo-inventory.html` and `dist/nlo-inventory-alerts.gs` to the repo root; when the rules change, rebuild
  and copy NLO Cases, A/R, Time Off and the Time Clock too (they carry the file for their own rules cards).
- The old address: `python3 deploy.py` (refuses unless the live page is the expected one) → `deploy/` → `npx firebase deploy
  --only hosting --project nlo-inventory` (Dr. A approves the sign-in link) → `npx firebase logout`. Rollback: Hosting → Release
  history, or the dated backup copies.
- The old Inventory read-only (with the same sign-in, before the move): `python3 freeze_old.py` (shows what would change),
  `--freeze`, and `--unfreeze` for a rollback. Tested on the emulator: `npx firebase emulators:exec --only database --project
  demo-nlo-cases "python3 test/freeze.test.py"`.
