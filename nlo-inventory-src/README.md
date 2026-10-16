# NLO Inventory (v4)

Supplies, the shared cart, orders, receiving and the monthly supply budget for Next Level Orthodontics.
Live at https://nlo-inventory.web.app (Firebase project `nlo-inventory`, Realtime Database `nlo/*`).
Rebuilt in October 2026 in the look of the newer NLO apps. It uses the same database as v3.0.1, so every
supply, order, vendor, receipt and budget dollar carries over unchanged.

## What's new compared with v3.0.1
- **Who and when on every step.** People tap their name once (kept 10 minutes on that computer). Every cart
  line, quantity change, order placed, receipt, reopen and stock change is stamped with the name and time, and
  each order shows its trail (added by → ordered by → received by).
- **Bought bigger than counted.** A supply can be counted in one unit and bought in a bigger one: gloves are
  counted in boxes and bought by the case of 10. The cart and orders work in cases; receiving 2 cases adds
  20 boxes. Settings → *Bought by the case* sets up the gloves in one step. Saved prices stay per box.
- Home: what's waiting to be ordered, what's on the way, spending against the budget, what's below its minimum.
- Packing-slip scanner (Gemini) for an open order, a delivery with no order, or an order already received.
- Budget: the same month totals as the Staff Meeting Hub's copy of the math (checked by the tests), plus
  price watch (went up, cheaper at another vendor).
- The staff list comes from the Staff Hub roster (`nlo/cadence/roster`); budget, vendors, voiding and
  reopening are limited to the people ticked in Settings → *Who can change settings*.

## Layout
- `src/` — plain JS files concatenated in the order listed in `build.py`, plus `style.css` and `template.html`.
- `python3 build.py` → `dist/index.html` (the live page; its inline script is pinned by a SHA-256 hash in the
  page's CSP), `dist/logo-white.png`, and `dist/demo.html` (made-up data, no Firebase, for showing it off).
- `test/e2e.py` — end-to-end checks of `dist/index.html` in headless Chromium against a stand-in Firebase
  (`test/fake-firebase.js`) holding v3.0.1-shaped data (`test/seed.js`). `python3 test/e2e.py [test names]`.

## Publishing
1. `python3 build.py && python3 test/e2e.py` (all must pass). The vendor list's account numbers, reps and card notes live in
   `src/vendors.private.js`, which is not in git; if it's missing, `python3 build.py --vendors-from-live` recreates it from
   the live page (a build without it can't be published: `deploy.py` refuses).
2. `python3 deploy.py` → `deploy/` with the page, the logo, a dated copy of the live page and the older
   backup copies (a Hosting deploy replaces the whole site). It stops if the live page isn't the expected one.
3. From `deploy/`: `npx firebase login --non-interactive` (Dr. A approves the sign-in link) →
   `npx firebase deploy --only hosting --project nlo-inventory --non-interactive` → `npx firebase logout`.
4. Reload every office computer and iPad. Every file is served no-cache, so a reload picks up the new page.

To roll back: Firebase console → Hosting → Release history → roll back, or publish the dated backup copy as
`index.html`.

## Database rules
The live Realtime Database rules (checked 16 Oct 2026) give the office accounts read and write on everything Inventory
uses: `items, log, vendors, orders, cart, bracketOrder, budget, settings` and `elastoPrices` (the quick-order price list,
in its own block at the bottom of the rules), plus read on `cadence` for the staff roster. If `elastoPrices` were ever
refused, the app treats the price list as empty and says so on Quick order instead of failing.
