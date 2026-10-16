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
- **Who changes settings** (budget amounts, vendors, storage locations, archiving/deleting supplies, voiding/reopening orders):
  Dr. A and the people he ticks in Settings — and now the **database itself** holds everyone else to that, not just the page.
- **Quick-order prices** save for everyone (the old database's rules refused them).
- **Photos** kept inside records (old supplies, packing slips) are records of their own (`invPics`), read when shown.
- **Vendor account numbers, reps and card notes** are no longer built into the page (it's published from the public repo):
  they live in the database (saved vendors), put there once at the move.
- **The activity log is no longer trimmed**: one record a month, entries only ever added (the page reads the last 36 months).
- **Offline**: steps that need the database itself (stock, cart, receiving, reopening) say at once that there's no internet,
  instead of queueing; other saves go when it's back.

## The data (Firestore `nlo-cases`; rules: `../nlo-cases-src/firestore.rules`, block "NLO Inventory")
- `invItems/{id}`, `invOrders/{id}`, `invVendors/{id}` — one record each, under the old app's ids, same fields as before.
- `invLog/m<YYYY-MM>` — `{ e: { <entryId>: entry } }`, entries only added.
- `invState/cart {lines}`, `invState/budget`, `invState/prices {p}`, `invState/bracket {v}`, `invState/settings
  {locations, invAdmins (staff ids), alertsOn, geminiProxyUrl, invPrefs}`, `invState/ai {gemini, openai}` (Dr. A sets; members read).
- Every record carries `up` (the database's time) and `upBy` (the staff id), and every save moves `invState/rev.n` by one in
  the same save (the rules check both).
- `invAlerts/{auto}` — the cart/order/receiving emails waiting for the alert script; `invPics/{id}` `{m, b, kind}`;
  `invMeta/moved`; `invBots/{uid}` (the alert script's login), `invBeat/{uid}` (when it last checked); marker `meta/rules_inv_1`.
- Old records keep Staff Hub's ids in their stamps (`s_sarah`…): a roster entry linked to Staff Hub (`rid`) answers to both.

## The move (once, Dr. A)
The page shows Dr. A "Move Inventory over" until `invMeta/moved` exists (staff see "Inventory is moving"). He connects to the
old database with Google (the same sign-in NLO Cases' "Connect to the office roster" uses, app name `ipr`), the page reads
`nlo/{items,orders,vendors,log,cart,budget,bracketOrder,elastoPrices,settings/…}` over REST, shows what it found (counts, money in
the log, this month's spending, who changes settings mapped to NLO Cases logins, notes), and on "Move it now" saves photos, then
everything else, counts it all against what it read (money included), and only then writes `invMeta/moved`. Running it again
saves the same records under the same ids (a photo already saved stays). The old database isn't changed.
Before it, the vendor details go into the old database's saved vendors (`vendor_details.py`, only what's missing), so the move
carries them.

## The alert script ("NLO Inventory Alerts", version 2, in akhavan.ak@gmail.com's Apps Script)
`robot/script.js` → `dist/nlo-inventory-alerts.gs` (published as `../nlo-inventory-alerts.gs`). Settings → Email alerts → Get
the alert script makes it a login of its own (`invBots`; the newest two kept) and copies the script with that login filled in;
Dr. A pastes it over the old code (same project, same every-minute trigger, no new permissions) and runs `setup`.
Every minute (every 10 at night) it reads `invState/rev`; when it moved: emails the alerts and clears them, and copies what
changed (`up` > last) from `invItems`, `invOrders`, `invLog` and `invState/budget` into the old database (`nlo/items`,
`nlo/orders`, `nlo/log`, `nlo/budget`) — where **Staff Meeting's spending card and AISA's stock answers read them**. Everything
is copied again once a night. It only adds and changes records there, never removes any, and copies nothing before the move.
If an old Inventory page is still open somewhere and used (it leaves alerts in `nlo/settings/alertQueue`), it emails Dr. A to
reload that computer (once an hour) and clears that queue.

## Build, test, publish
- `python3 build.py` → `dist/nlo-inventory.html`, `dist/nlo-inventory-alerts.gs`, `dist/firestore.rules` (OWNER_EMAIL),
  `dist/demo.html` (+ `demo-page.html`), `dist/redirect/index.html`, and `dist/vendor-details.json` (from
  `src/vendors.private.js`, not in git — `--vendors-from-live` recreates it from the old page's backup copy). The build refuses a
  page that would carry any vendor account number, rep or card hint.
- Tests (inside the emulators; `node_modules` → `../nlo-cases-src/node_modules`; `test/vendor/firebasejs-10.12.2/` = the three
  compat files from `npm pack firebase@10.12.2`; `NO_PROXY=127.0.0.1,localhost`):
  `npx firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases "python3 test/e2e.py && node test/robot.test.js && node test/rules.test.mjs"`
  — 269 end-to-end checks (the real page; the move from v3-shaped data; sign-in, lock, idle lock; every flow of 4.0's suite;
  two computers at once; rules gate; the copied alert script run), 39 alert-script checks, 210 rules checks. The other apps'
  suites must pass on the same rules file (Cases 258, Leads 77, A/R 97, Time Off 159, Time Clock 433 on 16 Oct).
- Publish: copy `dist/nlo-inventory.html` and `dist/nlo-inventory-alerts.gs` to the repo root; when the rules change, rebuild
  and copy NLO Cases, A/R, Time Off and the Time Clock too (they carry the file for their own rules cards).
- The old address: `python3 deploy.py` (refuses unless the live page is the expected one) → `deploy/` → `npx firebase deploy
  --only hosting --project nlo-inventory` (Dr. A approves the sign-in link) → `npx firebase logout`. Rollback: Hosting → Release
  history, or the dated backup copies.
