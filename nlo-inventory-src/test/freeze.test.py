"""freeze_old.py against the Realtime Database emulator, with rules shaped like the old Inventory database's real ones (Sept
2026: office accounts per part, comments allowed): it shows the change without making it, closes only Inventory's eight
parts to everyone but Dr. A (reading unchanged, every other app's rules exactly as they were), marks it for the move page,
refuses rules it doesn't understand, and --unfreeze puts it all back.
    npx firebase emulators:exec --only database --project demo-nlo-cases "python3 test/freeze.test.py"
Made-up accounts only."""
import json, os, sys, base64, subprocess, pathlib, urllib.request, urllib.error
HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent
RT, NS = 'http://127.0.0.1:9000', 'demo-nlo-cases'
os.environ['NO_PROXY'] = os.environ['no_proxy'] = '127.0.0.1,localhost'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:500]), flush=True)

def req(method, path, body=None, auth=None, raw=False):
    q = '?ns=' + NS + ('&auth=' + auth if auth else '')
    h = {'Content-Type': 'application/json'}
    if not auth: h['Authorization'] = 'Bearer owner'
    data = None if body is None else (body.encode() if isinstance(body, str) else json.dumps(body).encode())
    r = urllib.request.Request(RT + path + '.json' + q, data=data, method=method, headers=h)
    try:
        with opener.open(r) as x: t = x.read().decode(); return x.status, (t if raw else json.loads(t or 'null'))
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

def token(email):
    """an unsigned sign-in token (the emulator doesn't check signatures)"""
    b = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
    return b({'alg': 'none', 'typ': 'JWT'}) + '.' + b({'email': email, 'email_verified': True, 'sub': email, 'user_id': email, 'iat': 1, 'exp': 9999999999, 'aud': NS, 'iss': 'https://securetoken.google.com/' + NS, 'firebase': {'sign_in_provider': 'google.com'}}) + '.'

OFFICE = "auth != null && auth.token.email_verified == true && (auth.token.email === 'akhavan.ak@gmail.com' || auth.token.email === 'records@thenextlevelorthodontics.com')"
STAFF = OFFICE[:-1] + " || auth.token.email.endsWith('@thenextlevelorthodontics.com'))"
def rules_text(extra_top=''):
    parts = {k: {'.read': OFFICE, '.write': OFFICE} for k in ['log', 'vendors', 'orders', 'cart', 'bracketOrder', 'budget', 'elastoPrices', 'settings']}
    parts['items'] = {'.read': 'auth != null', '.write': OFFICE}
    parts['cadence'] = {'.read': STAFF, '.write': STAFF}
    parts['onboarding'] = {'.read': OFFICE, '.write': OFFICE, 'progress': {'$pid': {'.validate': 'newData.hasChildren()'}}}
    text = json.dumps({'rules': {'nlo': parts}}, indent=2)
    text = text.replace('"nlo": {', '// the office apps\n    "nlo": { /* every app keeps its part here */', 1)
    if extra_top: text = text.replace('"rules": {', '"rules": { ' + extra_top, 1)
    return text

def run(*a):
    r = subprocess.run([sys.executable, str(SRC / 'freeze_old.py'), '--base', RT, '--ns', NS, '--token', 'owner'] + list(a), capture_output=True, text=True, cwd=str(SRC))
    return r.returncode, r.stdout + r.stderr

for f in (SRC / 'deploy').glob('rtdb-rules-before-*.json'): f.unlink()
DR, OFF, STF = token('akhavan.ak@gmail.com'), token('records@thenextlevelorthodontics.com'), token('gwen@thenextlevelorthodontics.com')
c, j = req('PUT', '/.settings/rules', rules_text()); assert c == 200, j
req('PUT', '/', {'nlo': {'items': {'ppe-1': {'id': 'ppe-1', 'qty': 4}}, 'log': {'l1': {'id': 'l1'}}, 'cadence': {'roster': {'v': 1}}, 'settings': {'alertsOn': True}}})
before = req('GET', '/.settings/rules', raw=True)[1]

c, out = run()
check('dry run: lists the eight parts it would close', c == 0 and out.count('→ Dr. A only') == 8 and 'Nothing changed' in out, out)
check('dry run: changes nothing', req('GET', '/.settings/rules', raw=True)[1] == before and req('GET', '/nlo/settings/invFrozen')[1] is None)
check('before: the office account writes a supply', req('PUT', '/nlo/items/ppe-1/qty', 5, auth=OFF)[0] == 200)

c, out = run('--freeze')
check('freeze: published', c == 0 and 'Published' in out, out)
now = json.loads(req('GET', '/.settings/rules', raw=True)[1])
check('freeze: Inventory’s parts are Dr. A’s alone to write', all(now['rules']['nlo'][k]['.write'].endswith("auth.token.email === 'akhavan.ak@gmail.com'") for k in ['items', 'orders', 'vendors', 'log', 'cart', 'bracketOrder', 'budget', 'elastoPrices']), now['rules']['nlo'])
check('freeze: reading unchanged, other apps’ rules exactly as they were', now['rules']['nlo']['items']['.read'] == 'auth != null' and now['rules']['nlo']['cadence'] == {'.read': STAFF, '.write': STAFF} and now['rules']['nlo']['settings']['.write'] == OFFICE and now['rules']['nlo']['onboarding']['progress'])
check('freeze: the mark for the move page', (req('GET', '/nlo/settings/invFrozen')[1] or {}).get('by') == 'go-live')
check('freeze: the rules from before saved', len(list((SRC / 'deploy').glob('rtdb-rules-before-*.json'))) == 1)
check('after: an office computer’s old page can’t change a supply', req('PUT', '/nlo/items/ppe-1/qty', 6, auth=OFF)[0] in (401, 403), req('PUT', '/nlo/items/ppe-1/qty', 6, auth=OFF))
check('after: …or add to the log', req('PUT', '/nlo/log/l2', {'id': 'l2'}, auth=OFF)[0] in (401, 403))
check('after: …but still reads it (and AISA’s sign-in reads the supplies)', req('GET', '/nlo/items/ppe-1', auth=OFF)[0] == 200 and req('GET', '/nlo/items/ppe-1', auth=STF)[0] == 200)
check('after: other apps carry on (the roster)', req('PUT', '/nlo/cadence/roster/v', 2, auth=STF)[0] == 200)
check('after: Dr. A’s account still writes (the alert script runs as him)', req('PUT', '/nlo/items/ppe-1/qty', 7, auth=DR)[0] == 200)

c, out = run('--unfreeze')
check('unfreeze: done', c == 0 and 'Put back' in out, out)
import importlib.util
spec = importlib.util.spec_from_file_location('fo', str(SRC / 'freeze_old.py')); fo = importlib.util.module_from_spec(spec); spec.loader.exec_module(fo)
check('unfreeze: the rules read the same as before the freeze', fo.parse(req('GET', '/.settings/rules', raw=True)[1]) == fo.parse(before))
check('unfreeze: the mark is off, the office account writes again', req('GET', '/nlo/settings/invFrozen')[1] is None and req('PUT', '/nlo/items/ppe-1/qty', 8, auth=OFF)[0] == 200)

# rules it doesn't understand: refused, nothing changed
req('PUT', '/.settings/rules', rules_text('".write": "auth != null",'))
b2 = req('GET', '/.settings/rules', raw=True)[1]
c, out = run('--freeze')
check('a write rule over everything: refused, nothing changed', c != 0 and 'can’t be closed on its own' in out and req('GET', '/.settings/rules', raw=True)[1] == b2, out)
req('PUT', '/.settings/rules', rules_text().replace('"items": {', '"items": { "$id": { ".write": "auth != null" },', 1))
c, out = run('--freeze')
check('a write rule further down a part: refused', c != 0 and 'further down' in out, out)
for f in (SRC / 'deploy').glob('rtdb-rules-before-*.json'): f.unlink()
print('\n%d passed, %d failed' % (sum(results), len(results) - sum(results)))
sys.exit(0 if all(results) else 1)
