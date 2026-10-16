"""freeze_old.py against the Realtime Database emulator, with rules shaped like the old Inventory database's real ones (Sept
2026: office accounts per part, comments allowed): it shows the change without making it; closes only Inventory's eight
parts to every page (Dr. A's included), reading unchanged and every other app's rules exactly as they were; checks the
token the alert script relies on still writes there (and if it didn't, keeps Dr. A's account as the writer); leaves the mark
for the move page; a second run keeps the first rollback copy; --unfreeze gives back only those eight write rules, on the
rules as they are by then; it refuses rules it doesn't understand. Everything it keeps goes to a scratch folder.
    npx firebase emulators:exec --only database --project demo-nlo-cases "python3 test/freeze.test.py"
Made-up accounts only."""
import json, os, sys, base64, subprocess, pathlib, tempfile, importlib.util, urllib.request, urllib.error
HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent
RT, NS = 'http://127.0.0.1:9000', 'demo-nlo-cases'
KEEP = tempfile.mkdtemp(prefix='freeze-test-')
os.environ['NO_PROXY'] = os.environ['no_proxy'] = '127.0.0.1,localhost'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
spec = importlib.util.spec_from_file_location('fo', str(SRC / 'freeze_old.py')); fo = importlib.util.module_from_spec(spec); spec.loader.exec_module(fo)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:600]), flush=True)

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
def rules_text(extra_top='', cadence_write=STAFF):
    parts = {k: {'.read': OFFICE, '.write': OFFICE} for k in ['log', 'vendors', 'orders', 'cart', 'bracketOrder', 'budget', 'elastoPrices', 'settings']}
    parts['items'] = {'.read': 'auth != null', '.write': OFFICE}
    parts['cadence'] = {'.read': STAFF, '.write': cadence_write}
    parts['onboarding'] = {'.read': OFFICE, '.write': OFFICE, 'progress': {'$pid': {'.validate': 'newData.hasChildren()'}}}
    text = json.dumps({'rules': {'nlo': parts}}, indent=2)
    text = text.replace('"nlo": {', '// the office apps\n    "nlo": { /* every app keeps its part here */', 1)
    if extra_top: text = text.replace('"rules": {', '"rules": { ' + extra_top, 1)
    return text

def run(*a):
    r = subprocess.run([sys.executable, str(SRC / 'freeze_old.py'), '--base', RT, '--ns', NS, '--token', 'owner', '--keep-dir', KEEP] + list(a), capture_output=True, text=True, cwd=str(SRC))
    return r.returncode, r.stdout + r.stderr
def live(): return fo.parse(req('GET', '/.settings/rules', raw=True)[1])
def kept(): return sorted(pathlib.Path(KEEP).glob('rtdb-rules-before-*.json'))
INV = ['items', 'orders', 'vendors', 'log', 'cart', 'bracketOrder', 'budget', 'elastoPrices']
DR, OFF, STF = token('akhavan.ak@gmail.com'), token('records@thenextlevelorthodontics.com'), token('gwen@thenextlevelorthodontics.com')

c, j = req('PUT', '/.settings/rules', rules_text()); assert c == 200, j
req('PUT', '/', {'nlo': {'items': {'ppe-1': {'id': 'ppe-1', 'qty': 4}}, 'log': {'l1': {'id': 'l1'}}, 'cadence': {'roster': {'v': 1}}, 'settings': {'alertsOn': True}}})
before = live()

c, out = run()
check('dry run: lists the eight parts it would close', c == 0 and out.count('→ nobody (no page)') == 8 and 'Nothing changed' in out, out)
check('dry run: changes nothing', live() == before and req('GET', '/nlo/settings/invFrozen')[1] is None)
check('before: the office account writes a supply', req('PUT', '/nlo/items/ppe-1/qty', 5, auth=OFF)[0] == 200)

c, out = run('--freeze')
now = live()
check('freeze: published', c == 0 and 'Published' in out and 'stays the one writer' not in out, out)
check('freeze: no page writes Inventory’s parts now', all(now['rules']['nlo'][k]['.write'] is False for k in INV), {k: now['rules']['nlo'][k]['.write'] for k in INV})
check('freeze: reading unchanged, every other app’s rules exactly as they were', all(now['rules']['nlo'][k]['.read'] == before['rules']['nlo'][k]['.read'] for k in INV) and {k: v for k, v in now['rules']['nlo'].items() if k not in INV} == {k: v for k, v in before['rules']['nlo'].items() if k not in INV})
check('freeze: the mark for the move page', (req('GET', '/nlo/settings/invFrozen')[1] or {}).get('by') == 'go-live')
check('freeze: the rules from before kept (outside deploy/)', len(kept()) == 1 and fo.parse(kept()[0].read_text()) == before and not list((SRC / 'deploy').glob('rtdb-rules-before-*')))
check('after: an office computer’s old page can’t change a supply', req('PUT', '/nlo/items/ppe-1/qty', 6, auth=OFF)[0] in (401, 403))
check('after: …nor one signed in as Dr. A', req('PUT', '/nlo/items/ppe-1/qty', 6, auth=DR)[0] in (401, 403))
check('after: …or add to the log', req('PUT', '/nlo/log/l2', {'id': 'l2'}, auth=OFF)[0] in (401, 403))
check('after: …but still reads it (and AISA’s sign-in reads the supplies)', req('GET', '/nlo/items/ppe-1', auth=OFF)[0] == 200 and req('GET', '/nlo/items/ppe-1', auth=STF)[0] == 200)
check('after: other apps carry on (the roster)', req('PUT', '/nlo/cadence/roster/v', 2, auth=STF)[0] == 200)
check('after: the token the alert script relies on (past the rules) still writes', req('PUT', '/nlo/items/ppe-1/qty', 7)[0] == 200)

c, out = run('--freeze')
check('freeze again: nothing to publish, and the first rollback copy stays the only one', c == 0 and 'Already read-only' in out and len(kept()) == 1, (out, kept()))

# another app changes its rules after the freeze: undoing the freeze keeps that
r = live(); r['rules']['nlo']['cadence']['.write'] = OFFICE; req('PUT', '/.settings/rules', json.dumps(r))
c, out = run('--unfreeze')
after = live()
check('unfreeze: Inventory’s parts have their write rules back', c == 0 and all(after['rules']['nlo'][k]['.write'] == before['rules']['nlo'][k]['.write'] for k in INV), out)
check('unfreeze: a change another app made since stays', after['rules']['nlo']['cadence']['.write'] == OFFICE)
check('unfreeze: the mark is off, the office account writes again', req('GET', '/nlo/settings/invFrozen')[1] is None and req('PUT', '/nlo/items/ppe-1/qty', 8, auth=OFF)[0] == 200)
c, out = run('--unfreeze')
check('unfreeze when it isn’t read-only: refused, nothing changed', c != 0 and 'nothing to undo' in out and live() == after, out)

# if the token the alert script relies on didn't get past the rules: Dr. A's account stays the writer
req('PUT', '/.settings/rules', rules_text())
for f in kept(): f.unlink()
c, out = run('--freeze', '--probe-auth', DR)
now = live()
check('a token that doesn’t get past the rules: Dr. A’s account is kept as the one writer, and it says so', c == 0 and 'stays the one writer' in out and all(now['rules']['nlo'][k]['.write'] == fo.OWNER_ONLY for k in INV), out)
check('…an office computer still can’t write, Dr. A’s account can', req('PUT', '/nlo/items/ppe-1/qty', 9, auth=OFF)[0] in (401, 403) and req('PUT', '/nlo/items/ppe-1/qty', 9, auth=DR)[0] == 200)
c, out = run('--unfreeze')
check('…and undoing it works the same', c == 0 and all(live()['rules']['nlo'][k]['.write'] == OFFICE for k in INV), out)

# rules it doesn't understand: refused, nothing changed; a harmless top-level "no writes" is fine
req('PUT', '/.settings/rules', rules_text('".write": "auth != null",'))
b2 = live()
c, out = run('--freeze')
check('a write rule over everything: refused, nothing changed', c != 0 and 'can’t be closed on its own' in out and live() == b2, out)
req('PUT', '/.settings/rules', rules_text().replace('"items": {', '"items": { "$id": { ".write": "auth != null" },', 1))
c, out = run('--freeze')
check('a write rule further down a part: refused', c != 0 and 'further down' in out, out)
req('PUT', '/.settings/rules', rules_text('".read": false, ".write": false,'))
for f in kept(): f.unlink()
c, out = run('--freeze')
check('a top-level “no writes” (the console’s locked default) is fine', c == 0 and 'Published' in out, out)
run('--unfreeze')
print('\n%d passed, %d failed' % (sum(results), len(results) - sum(results)))
sys.exit(0 if all(results) else 1)
