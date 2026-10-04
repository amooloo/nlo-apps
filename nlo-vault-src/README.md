# NLO Vault — source

Encrypted password vault for Next Level Orthodontics' office logins. Dr. A (the owner) and staff each have their own
login; logins live in folders; each person opens only the folders Dr. A gives them (view or edit).

The page is one HTML file (`dist/public/index.html`) served from its **own** Firebase Hosting site (not the shared
amooloo.github.io origin), so the security headers below apply and no other NLO app shares its origin.

**Live:** https://nlo-vault.web.app — Firebase project `nlo-vault` (Spark plan). Rules are published by Dr. A himself
(Firestore Database → Rules); the page is deployed with `npx firebase deploy --only hosting --project nlo-vault`.

## Security design

**Nothing readable leaves the browser.** Firestore holds ciphertext plus bookkeeping (folder ids, key versions,
revision numbers, who/when). Google never sees a vault password.

- **Password → keys** (`src/crypto.js`, Bitwarden-style): `master = PBKDF2-SHA256(password, salt = SHA-256("nlo-vault/v1/salt/" + login), 600,000)`.
  `authPw = HKDF(master, "nlo-vault/v1/auth")` is the only thing sent to Firebase Authentication;
  `wrap = HKDF(master, "nlo-vault/v1/wrap")` (AES-256-GCM) locks the person's private keys;
  `lock = HKDF(master, "nlo-vault/v1/lock")` (HMAC) makes Dr. A's one-time tokens (below). Login = username (staff) or email (owner), lower-cased.
- **Per-person key pair**: ECDH P-256, sealed with `wrap` (AAD `nlo-vault/v1/priv/<uid>`) in `keys/<uid>` (readable by that
  person only). Dr. A's container also holds his **ECDSA P-256 signing key**; its public half (`meta/setup.spk`) is fixed at setup.
- **Per-folder key**: random 256-bit AES key, versioned (`kv`). Sealed to each member's public key in `grants/<uid>_<fid>`:
  ephemeral ECDH → HKDF(salt = ephemeral public point, info = AAD) → AES-GCM, AAD `nlo-vault/v1/grant/<uid>/<fid>/<kv>`.
- **Items**: JSON padded to 256-byte blocks, AES-256-GCM under the folder key, AAD `nlo-vault/v1/item/<iid>/<fid>/<kv>`
  (ciphertext can't be moved between items/folders/key versions). A folder's name, "new people get" default and
  "private folder" flag are sealed together under its key (AAD `nlo-vault/v1/folder/<fid>/<kv>`).
- **Dr. A's signatures decide who gets keys.** Every folder key is signed (`folders.ks[kv]`); every browser checks the
  signature before using a key (missing = wait, wrong = refuse, folder shows a warning and can't be saved into). Every
  person he adds is signed (`users.ps` over uid + public key) and every place in a folder is signed (`grants.gs` over
  uid + folder + role + key version). His browser seals a folder key to someone only after both signatures check out,
  so nobody else — even someone signed in to Firebase as him — can add a member, a place, or a key of their own.
  People & access flags anything unsigned; a key change removes it.
- **Dr. A's own key copy can't be changed without his password or recovery code.** `keys/<owner>` stores SHA-256 hashes
  of one-time tokens (`pl` from his password, `rl` from his recovery code, `npl` while a new password is parked); the rules
  only accept a change that reveals a current token and sets new ones (counters only go up). Recovery-code tokens use the
  same PBKDF2 cost as the recovery copy.
- **Owner recovery**: a 24-character code (≈119 bits, no look-alike letters) seals a second copy of the owner's keys
  (`keys/<owner>.rec`, PBKDF2 100k). Forgot password → Firebase reset email → new password (derived on the device when the
  email link opens the vault; or set on Google's page, used once, then switched) → recovery code re-locks the keys.
- **Staff logins**: Dr. A creates them (secondary Firebase app, synthetic `username.N@vault.thenextlevelorthodontics.com`,
  no email ever sent) with a temporary password; the person must choose their own at first sign-in. "Reissue login" makes
  a new account (N+1) with the same signed places; the old one is switched off. `logins/<sha256(username)>` holds only N.
- **Taking someone out / removing them**: their place is deleted in the same write that gives the folder a new key
  version (`kv+1`); every item is re-encrypted; remaining members get the new key; optionally every password they could
  see is flagged "Change this password". Edit → view also moves the folder to a new key version, in the same write.
  Dr. A keeps old key versions (to read history). A key change resumes if the page is closed part-way.
- **History**: every item update must, in the same batch, create `versions/<iid>_<oldRev>` holding exactly the old
  ciphertext. Versions can't be changed or deleted, even by the owner. Deletes go to the trash; "delete for good" keeps
  the last version, so it can be brought back (always into the folder it was in).
- **If someone else's key turns up** (only possible with Dr. A's Firebase sign-in): staff refuse it; Dr. A sees "This
  folder's key wasn't made by you" and one button gives the folder a new signed key, puts any login saved with the
  foreign key back to its last version from the same folder, and removes anything slipped in (copy kept in history).
- **Activity**: `log/` is append-only (who copied/looked at/changed what; no secrets), owner-read-only, fixed list of actions.
- **Session**: Firebase Auth in memory only; Firestore memory cache only. Auto-lock after inactivity (office max set by
  Dr. A, 1–60 min; each person can choose shorter); a lock reloads the page so nothing stays in memory. Copied secrets are
  cleared from the clipboard after 30 s (when the vault is in front). Removed people are locked out of an open vault.
- **Page hardening** (`build.mjs`): CSP `default-src 'none'`, script and style allowed only by SHA-256 hash, connect only to
  Google's sign-in and Firestore endpoints, `frame-ancestors 'none'`, `require-trusted-types-for 'script'`
  (only `setHTML()` in `src/html.js` can write HTML; every interpolated value is escaped), `form-action 'none'`, no outside
  scripts/fonts/images (Firebase SDK bundled; fonts and logo embedded). Plus X-Frame-Options DENY, nosniff,
  no-referrer, COOP same-origin, CORP same-origin, Permissions-Policy. Only http/https links open.
- **Rules** (`firestore.rules`): members only; folder reads/writes need a place (edit for writes); items must use the
  folder's current key version and the next revision; key versions go up one at a time and a version's signature (and
  Dr. A's copy of its key) can only be added by the write that introduces it; owner-only management; one-time setup only
  for the owner's **verified** email (filled in at build time from `OWNER_EMAIL`, not stored in the page or this repo).

## Layout
- `src/crypto.js` encryption, signatures, tokens · `src/store.js` Firebase layer · `src/totp.js` 2-step codes · `src/gen.js` generator + strength ·
  `src/importer.js` reading pasted spreadsheets/documents/CSV · `src/html.js` safe templating + icons · `src/ui/*` screens ·
  `src/words.js` 2048 EFF words (CC BY 3.0 US, Electronic Frontier Foundation) · `assets/` logo + icons (`tools/assets.py`).
- `vault.config.json` — the Firebase web config (public by design). `firebase.json` is generated by the build.

## Build, test, deploy
```
npm ci
node build.mjs --emu                                  # test build (talks to the emulators)
node test/unit.test.js                                # crypto, signatures, tokens, 2-step codes, generator, import parsing
npx firebase emulators:exec --config firebase.test.json --only firestore,auth --project demo-nlo-vault \
  "node test/rules.test.js && node test/attacks.test.js && node test/e2e.js"
                                                      # rules, attack cases, and the real page end to end in Chromium
OWNER_EMAIL=<Dr. A's email> node build.mjs            # production page + dist/firestore.rules + firebase.json
npx firebase deploy --only hosting,firestore:rules --project <project-id>
```
The production build refuses to contain emulator code; the test-only `window.__vault` hook exists only in `--emu` builds.
The end-to-end test includes an attacker holding Dr. A's Firebase session (rules enforced) who plants a key, adds a fake
person and places, fakes an unfinished key change, tries to block key changes, moves a login between folders, and tries
to overwrite Dr. A's key copy — and checks that none of it yields a readable password.

## Known limits
- A vault password is only as strong as its owner makes it: the app requires ≥ 12 characters and a strength check
  (`gen.js`), and PBKDF2 600k slows guessing; an attacker would also need the encrypted data (rules) first.
- If Dr. A loses both his password and the recovery code, the data can't be recovered by anyone. Keep an encrypted
  backup (the vault reminds him every 30 days).
- **Someone who takes over Dr. A's email** can reset his Firebase password and act as owner toward the rules. They still
  can't read anything, can't get a key to anyone, and can't change his key copy; but they can disrupt: switch staff off
  (reissue them), delete places (share again), trash or overwrite logins (restore from history), hide folders, plant
  junk that the vault refuses (one-click new key). With thousands of writes over hours they could fill a folder's
  record so it can't take another key version; the fix is a new folder with the logins moved over. Keep 2-step
  verification on that Google account.
- Anyone who could see a password may have copied it; removing them flags those passwords, but they must be changed on
  the websites themselves.
- Never store patient information in the vault.
