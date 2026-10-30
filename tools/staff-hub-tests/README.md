# Staff Hub sign-in checks (the NLO Cases login)

Since 30 Oct 2026 Staff Hub (`../../nlo-staff-hub.html`) signs in with the NLO Cases login (Amir: "make the login for staff
hub the same as case tracker"): the NLO Cases username and password, Dr. A only, its idle minutes, no session kept across
reloads. Staff Hub's data stays in its own project (`nlo-staff-hub`), encrypted as before with a key from Staff Hub's own
password; that account's email + password are sealed to Dr. A's NLO Cases key pair in his own NLO Cases member record
(`members/<uid>.shLink`: `box` sealed to `pub`, info `staffhub:<uid>`; `esc` sealed to `meta/recovery.pub`, info
`staffhub:recovery`; `pubX`, `recX`, `uid`, `v`, `at`). No rules change in either project.

Everything here is a made-up office on the Firebase emulators: nothing live is read or written.

- `nccrypto.mjs` — NLO Cases' own crypto, loaded unchanged from `../../nlo-cases-src/src/core.js` into Node.
- `seed.mjs` — the office (an owner with real key material and a recovery code, three staff logins), both projects' real
  rules, and what NLO Cases does to Dr. A's keys (change password; reset by email + recovery code; a new recovery code).
- `test_login.mjs` — the real page, start to finish: Staff Hub data made first by the page as it was before this change
  (`nlo-staff-hub-old.html` = main before it), then the new page in that same browser: the old kept sign-in ended (its email
  offered for the link), every refusal (unknown username, wrong password, a staff login, a turned-off login, one still on a
  temporary password), the one-time link (wrong password, an account with no data, the right one; nothing re-encrypted;
  certificate files still open; the link opens with his password and the recovery copy with the code), saving, Lock,
  reload, a color quiz link (made under Staff Hub's own account), Settings, restoring a backup with no password, NLO Cases password changed, reset by email (before and after NLO
  Cases has the recovery code; wrong and loosely typed code), a new recovery code (the copy follows it), an older Staff Hub
  changing Staff Hub's own password (while open: the prompt; while closed: asked once at the next sign-in), the login
  turned off while open, the idle lock at NLO Cases' minutes, linking by itself when the passwords are the same, a phone,
  the card staying centred, and no page errors. 90 checks (`--quick` skips the ~1.5 min idle lock: 87).

Run (Java and Node 20+):

    npm install
    npx firebase emulators:start --only auth,firestore,database --project demo-nlo     # leave running
    # a folder with the new page, the page as it was before, and the two scripts they load
    mkdir -p /tmp/sh-site && cp ../../nlo-staff-hub.html ../../nlo-home.js ../../nlo-aisa.js /tmp/sh-site/
    git show 3cd6428:nlo-staff-hub.html > /tmp/sh-site/nlo-staff-hub-old.html
    (cd /tmp/sh-site && python3 -m http.server 8765 --bind 127.0.0.1)
    NO_PROXY=localhost,127.0.0.1 node test_login.mjs            # ~4 min; --quick ~3 min

The page's Firebase SDK (gstatic 10.12.2) is served from `node_modules/firebase` (`FIREBASE_SDK_DIR` to change it) and every
app it makes is pointed at the emulators by an init script; other outside requests are refused. `CHROME` = a Chromium to use
if Playwright's own isn't installed. The emulators share one sign-in pool between both projects (the page's two Firebase
apps), which is how the same-password case is checked. Screenshots go to `shots/`.
