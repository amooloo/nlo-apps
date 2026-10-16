"""Make the old Inventory read-only (go-live step 3), or put it back (a rollback).

The old Inventory's database (the nlo-inventory project's Realtime Database) is shared with Staff Hub, Staff Meeting,
CADANCe, Month-End, the calendar, onboarding and the IPR tracker, so only Inventory's own parts change: who may write
nlo/items, orders, vendors, log, cart, bracketOrder, budget and elastoPrices becomes Dr. A's Google account alone. An office
computer that still has the old page open can then change nothing (what it tries is refused, so nobody thinks they did
something that's lost), and the alert script, which runs as Dr. A, keeps copying the supply numbers there for Staff Meeting
and AISA. Reading is unchanged, and every other rule stays exactly as it is.

    npx firebase login --no-localhost          (Dr. A approves the sign-in)
    python3 freeze_old.py                      shows what would change; changes nothing
    python3 freeze_old.py --freeze             publishes it, keeps the rules as they were in deploy/rtdb-rules-before-*.json,
                                               and leaves the mark the move page looks for (nlo/settings/invFrozen)
    python3 freeze_old.py --unfreeze           publishes the rules saved before the freeze again and takes the mark off

Testing against the emulator:  --base http://127.0.0.1:9000 --ns demo-nlo-cases --token owner
"""
import json, os, re, sys, time, pathlib, subprocess, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent
DEPLOY = ROOT / 'deploy'
BASE = 'https://nlo-inventory-default-rtdb.firebaseio.com'
NODES = ['items', 'orders', 'vendors', 'log', 'cart', 'bracketOrder', 'budget', 'elastoPrices']
OWNER = 'akhavan.ak@gmail.com'
FROZEN = "auth != null && auth.token.email_verified == true && auth.token.email === '%s'" % OWNER
MARK = '/nlo/settings/invFrozen'
TOKEN = {}

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

def cli_token():
    """the Firebase CLI's sign-in (it refreshes its own token when a command runs)"""
    fb = os.environ.get('FIREBASE_BIN') or next((p for p in ['/tmp/fbtools/node_modules/.bin/firebase', str(ROOT / 'node_modules' / '.bin' / 'firebase')] if os.path.exists(p)), 'firebase')
    subprocess.run([fb, 'projects:list', '--json'], capture_output=True, timeout=120)
    store = pathlib.Path.home() / '.config' / 'configstore' / 'firebase-tools.json'
    tok = (json.loads(store.read_text()).get('tokens') or {}).get('access_token') if store.exists() else None
    if not tok: sys.exit('Not signed in to the Firebase CLI: run  npx firebase login --no-localhost  first.')
    return tok

def call(method, path, body=None, raw=False):
    base, ns, tok = arg('--base', BASE), arg('--ns'), arg('--token') or TOKEN.get('t') or TOKEN.setdefault('t', cli_token())
    params = (['ns=' + ns] if ns else []) + (['access_token=' + tok] if tok != 'owner' else [])
    q = '?' + '&'.join(params) if params else ''
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    h = {'Content-Type': 'application/json'}
    if tok == 'owner': h['Authorization'] = 'Bearer owner'
    r = urllib.request.Request(base + path + '.json' + q, data=data, method=method, headers=h)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if 'localhost' in base or '127.0.0.1' in base else urllib.request.build_opener()
    try:
        with opener.open(r, timeout=60) as x:
            t = x.read().decode()
            return t if raw else json.loads(t or 'null')
    except urllib.error.HTTPError as e:
        sys.exit('%s %s → HTTP %d: %s' % (method, path, e.code, e.read().decode()[:300]))

def parse(text):
    """the rules as JSON (the console allows // and /* */ comments)"""
    out, i, n, s = [], 0, len(text), None
    while i < n:
        c = text[i]
        if s:
            out.append(c)
            if c == '\\': out.append(text[i + 1]); i += 2; continue
            if c == s: s = None
        elif c in '"\'': s = c; out.append(c)
        elif text.startswith('//', i): i = text.find('\n', i); i = n if i < 0 else i; continue
        elif text.startswith('/*', i): i = text.find('*/', i) + 2; continue
        else: out.append(c)
        i += 1
    return json.loads(''.join(out))

def plan(rules):
    """→ (the frozen rules, what changes); refuses rules shaped in a way it doesn't know"""
    top = rules.get('rules')
    if not isinstance(top, dict) or not isinstance(top.get('nlo'), dict): sys.exit('These rules have no "nlo" part; nothing changed.')
    for where, part in (('the top', top), ('nlo', top['nlo'])):
        if '.write' in part: sys.exit('The rules let some sign-ins write all of %s, so Inventory can’t be closed on its own. Nothing changed.' % where)
    new, changes = json.loads(json.dumps(rules)), []
    for k in NODES:
        node = new['rules']['nlo'].get(k)
        if node is None: changes.append((k, None, None)); continue
        if not isinstance(node, dict): sys.exit('nlo/%s isn’t shaped as expected; nothing changed.' % k)
        bad = [p for p in walk(node) if p]
        if bad: sys.exit('nlo/%s has write rules further down (%s), which closing it here wouldn’t override; nothing changed.' % (k, ', '.join(bad)))
        changes.append((k, node.get('.write'), FROZEN)); node['.write'] = FROZEN
    return new, changes

def unfreeze_of(new, rules):
    """the frozen rules with Inventory's write rules as they were"""
    r = json.loads(json.dumps(new))
    for k in NODES:
        node, was = r['rules']['nlo'].get(k), (rules['rules']['nlo'].get(k) or {})
        if not isinstance(node, dict): continue
        if '.write' in was: node['.write'] = was['.write']
        else: node.pop('.write', None)
    return r

def walk(node, path=''):
    """the deeper .write rules under a node"""
    out = []
    for k, v in node.items():
        if isinstance(v, dict):
            if '.write' in v: out.append(path + '/' + k)
            out += walk(v, path + '/' + k)
    return out

def main():
    if '--unfreeze' in sys.argv:
        saved = sorted(DEPLOY.glob('rtdb-rules-before-*.json'))
        if not saved: sys.exit('No rules saved from before a freeze (deploy/rtdb-rules-before-*.json).')
        text = saved[-1].read_text()
        parse(text)
        call('PUT', '/.settings/rules', text.encode())
        call('DELETE', MARK)
        print('Put back the rules from %s; the old Inventory takes changes again (the mark is off).' % saved[-1].name)
        return
    text = call('GET', '/.settings/rules', raw=True)
    rules = parse(text)
    new, changes = plan(rules)
    for k, was, now in changes:
        print('nlo/%-13s %s' % (k, 'no rule (no one writes it already)' if was is None else ('already read-only' if was == now else 'write: %s\n%17s→ Dr. A only' % (was, ''))))
    if '--freeze' not in sys.argv:
        print('\nNothing changed. Run again with --freeze to publish it.'); return
    DEPLOY.mkdir(exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    (DEPLOY / ('rtdb-rules-before-%s.json' % stamp)).write_text(text)
    out = json.dumps(new, indent=2, ensure_ascii=False)
    (DEPLOY / 'rtdb-rules-frozen.json').write_text(out)
    call('PUT', '/.settings/rules', out.encode())
    back = parse(call('GET', '/.settings/rules', raw=True))
    if back != new: sys.exit('The published rules read back differently; check the Firebase console (Realtime Database → Rules).')
    # nothing but those write rules differs from before
    if unfreeze_of(back, rules) != rules: sys.exit('Something besides the write rules changed; put the old rules back with --unfreeze and check.')
    call('PUT', MARK, {'at': int(time.time() * 1000), 'by': 'go-live', 'nodes': NODES})
    print('\nPublished. The old Inventory is read-only (Dr. A’s account and the alert script still write). Saved the rules from before in deploy/rtdb-rules-before-%s.json.' % stamp)

if __name__ == '__main__':
    main()
