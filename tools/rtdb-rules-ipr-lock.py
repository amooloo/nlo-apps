#!/usr/bin/env python3
"""Lock the old IPR Tracker's copy: nlo/ipr in the nlo-inventory Realtime Database (IPR Tracker 4, Oct 2026).
Once the records have moved to the IPR Tracker on the NLO Cases logins, only Dr. A's Google account may read or change nlo/ipr,
so an IPR Tracker 3 page still open on some computer can't keep saving there (where nobody would see it). The "moved" mark stays
readable by everyone who could read nlo/ipr before: it sends an old page to the new IPR Tracker. Nothing else in the rules changes.

Run in Cloud Shell, signed in as akhavan.ak@gmail.com (the IPR Tracker's move card has the command to copy):
    curl -sO https://amooloo.github.io/nlo-apps/tools/rtdb-rules-ipr-lock.py && python3 rtdb-rules-ipr-lock.py
It shows nlo/ipr's rules now and after, and asks before publishing; the rules as they were are saved first
(~/rtdb-rules-before-ipr-lock-<time>.json). Undo: python3 rtdb-rules-ipr-lock.py undo ~/rtdb-rules-before-ipr-lock-<time>.json"""
import json, os, subprocess, sys, time, urllib.error, urllib.request

URL = 'https://nlo-inventory-default-rtdb.firebaseio.com/.settings/rules.json'
OWNER = 'akhavan.ak@gmail.com'


def owner_only(email):
    return "auth != null && auth.token.email_verified == true && auth.token.email === '%s'" % email


def lock_ipr(rules, owner=OWNER):
    """rules (the whole JSON) -> (the rules with nlo/ipr locked to the owner, nlo/ipr as it was); (None, it) when it's locked
    already. Stops (SystemExit) on anything it doesn't expect, changing nothing."""
    r = json.loads(json.dumps(rules))
    nlo = (r.get('rules') or {}).get('nlo')
    if not isinstance(nlo, dict):
        raise SystemExit('No "nlo" block in the rules — nothing changed.')
    # (a read or write granted above nlo/ipr reaches everything under it — a lock at nlo/ipr couldn't take it back)
    for where, block in (('the top of the rules', r['rules']), ('nlo', nlo)):
        for k in ('.read', '.write'):
            if k in block and block[k] is not False and block[k] != 'false':
                raise SystemExit('%s grants %s to everything under it (%s), so a lock at nlo/ipr wouldn\'t hold — nothing changed.' % (where, k, json.dumps(block[k])[:120]))
    ipr = nlo.get('ipr')
    if not isinstance(ipr, dict) or not isinstance(ipr.get('.read'), str):
        raise SystemExit('nlo/ipr has no rules of its own (%s) — nothing changed.' % json.dumps(ipr)[:300])
    own = owner_only(owner)
    if ipr.get('.read') == own and ipr.get('.write') == own:
        return None, ipr
    unknown = sorted(set(ipr) - {'.read', '.write'})
    if unknown:
        raise SystemExit('nlo/ipr has rules this script doesn\'t know (%s) — nothing changed.' % ', '.join(unknown))
    nlo['ipr'] = {'.read': own, '.write': own, 'moved': {'.read': ipr['.read']}}
    return r, ipr


TOKENS = [['gcloud', 'auth', 'print-access-token'], ['gcloud', 'auth', 'application-default', 'print-access-token']]
_tok = []


def call(method, body=None):
    """the rules endpoint, with this Cloud Shell's Google sign-in (its own token first, then the application-default one)"""
    last = None
    for cmd in ([_tok[0]] if _tok else TOKENS):
        try:
            tok = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode().strip()
        except (OSError, subprocess.CalledProcessError):
            continue
        req = urllib.request.Request(URL, data=body, method=method, headers={'Authorization': 'Bearer ' + tok})
        try:
            out = urllib.request.urlopen(req, timeout=60).read().decode()
            if not _tok: _tok.append(cmd)
            return out
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (401, 403): break
        except (urllib.error.URLError, OSError) as e:
            raise SystemExit('Couldn\'t reach the database rules (%s).%s' % (e, '' if method == 'GET' else ' Run it again to see whether it took.'))
    if last is not None and last.code in (401, 403):
        raise SystemExit('The database refused this Google sign-in (%d). Check Cloud Shell is signed in as %s (gcloud auth list) - '
                         'or ask Claude to make this change in your Chrome instead. Nothing changed.' % (last.code, OWNER))
    raise SystemExit('Couldn\'t reach the database rules (%s).%s' % (last or 'no gcloud sign-in', ' Nothing changed.' if method == 'GET' or last is not None else ''))


def main():
    if len(sys.argv) > 2 and sys.argv[1] == 'undo':
        back = open(os.path.expanduser(sys.argv[2])).read(); json.loads(back)
        print(call('PUT', back.encode())[:200]); print('The rules are back as they were in', sys.argv[2]); return
    raw = call('GET')
    try:
        cur = json.loads(raw)
    except ValueError:
        raise SystemExit('The live rules aren\'t plain JSON (comments?), so this script won\'t touch them — nothing changed.')
    new, was = lock_ipr(cur)
    if new is None:
        print('The old IPR Tracker\'s copy is locked already (only %s). Nothing to do.' % OWNER); return
    print('nlo/ipr now:\n' + json.dumps(was, indent=2))
    print('\nnlo/ipr after:\n' + json.dumps(new['rules']['nlo']['ipr'], indent=2))
    print('\nOnly nlo/ipr changes; every other app\'s rules stay exactly as they are.')
    if input('Publish it? [y/N] ').strip().lower() not in ('y', 'yes'):
        print('Nothing changed.'); return
    keep = os.path.expanduser('~/rtdb-rules-before-ipr-lock-%d.json' % time.time())
    open(keep, 'w').write(raw)
    call('PUT', json.dumps(new, indent=2).encode())
    try:
        ok = json.loads(call('GET')) == new
        print(('PUBLISHED. The old copy is locked to %s.' % OWNER) if ok else 'CHECK: the rules read back differ from what was sent.')
    except SystemExit as e:
        print('PUBLISHED, but they couldn\'t be read back to check (%s). Run the script again: it says "locked already" if they took.' % e)
    print('The rules as they were are saved in', keep)


if __name__ == '__main__':
    main()
