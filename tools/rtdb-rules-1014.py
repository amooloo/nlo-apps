#!/usr/bin/env python3
"""nlo-inventory Realtime Database rules change, 14 Oct 2026 (app review Fix-first #12 and #15).
Run in Cloud Shell as akhavan.ak@gmail.com:  python3 rtdb-rules-1014.py          (shows the change)
                                             python3 rtdb-rules-1014.py publish  (publishes it; the old rules are saved first)
- nlo/cadence/roster (Staff Hub's shared staff list): only Dr. A's Google account can write it; the rest of nlo/cadence is unchanged.
- nlo/elastoPrices (Inventory's elastics / bracket quick-order prices): same rules as nlo/settings (it had none, so saves were refused).
Undo: put the saved ~/rtdb-rules-before-1014-<time>.json back with the same PUT."""
import json, os, subprocess, sys, time, urllib.request
URL = 'https://nlo-inventory-default-rtdb.firebaseio.com/.settings/rules.json'
tok = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
def call(method, body=None):
    req = urllib.request.Request(URL, data=body, method=method, headers={'Authorization': 'Bearer ' + tok})
    return urllib.request.urlopen(req).read().decode()
raw = call('GET'); r = json.loads(raw); n = r['rules']['nlo']
OWN = "auth != null && auth.token.email_verified == true && auth.token.email === 'akhavan.ak@gmail.com'"
c = n['cadence']
if 'roster' in c: print('cadence already split:', json.dumps(c)[:300])
else:
    assert set(c) == {'.read', '.write'}, c
    n['cadence'] = {'.read': c['.read'], 'roster': {'.write': OWN}, '$other': {'.write': c['.write']}}
if 'elastoPrices' not in n: n['elastoPrices'] = dict(n['settings'])
print('cadence ->', json.dumps(n['cadence'], indent=1)); print('elastoPrices ->', json.dumps(n['elastoPrices'], indent=1))
if len(sys.argv) > 1 and sys.argv[1] == 'publish':
    keep = os.path.expanduser('~/rtdb-rules-before-1014-%d.json' % time.time()); open(keep, 'w').write(raw)
    print(call('PUT', json.dumps(r, indent=2).encode())[:200]); print('PUBLISHED. old rules saved to', keep)
    after = json.loads(call('GET'))['rules']['nlo']; print('check:', 'roster' in after['cadence'], 'elastoPrices' in after)
