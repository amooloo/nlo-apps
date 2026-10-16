"""Make the old Inventory read-only (go-live step 3), or open it again (a rollback).

The old Inventory's database (the nlo-inventory project's Realtime Database) is shared with Staff Hub, Staff Meeting,
CADANCe, Month-End, the calendar, onboarding and the IPR tracker, so only Inventory's own parts change: nlo/items, orders,
vendors, log, cart, bracketOrder, budget and elastoPrices can no longer be written by any page — an office computer (or
Dr. A's own laptop or iPad) still showing the old Inventory can change nothing there, and what it tries is refused, so nobody
thinks they did something that's then lost. Reading is unchanged, and every other rule stays exactly as it is.

The alert script copies the supply numbers there for Staff Meeting and AISA with Dr. A's Google token, which goes past the
rules (as this script's own token does: the Firebase CLI's). After publishing, this checks exactly that, with its own token;
if that token were refused, it puts Dr. A's account back as the one writer (so the alert script keeps copying) and says so.
(--owner-writes does that from the start.)

    npx firebase login --no-localhost          (Dr. A approves the sign-in)
    python3 freeze_old.py                      shows what would change; changes nothing
    python3 freeze_old.py --freeze             publishes it, and leaves the mark the move page looks for
                                               (nlo/settings/invFrozen); the rules as they were are kept in rollback/
    python3 freeze_old.py --unfreeze           gives Inventory's eight parts back the write rules kept at the freeze (on the
                                               rules as they are by then — any other app's later changes stay), and takes
                                               the mark off

Testing against the emulator:  --base http://127.0.0.1:9000 --ns demo-nlo-cases --token owner --keep-dir <a scratch folder>
"""
import json, os, sys, time, pathlib, subprocess, urllib.request, urllib.error, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent
BASE = 'https://nlo-inventory-default-rtdb.firebaseio.com'
NODES = ['items', 'orders', 'vendors', 'log', 'cart', 'bracketOrder', 'budget', 'elastoPrices']
OWNER = 'akhavan.ak@gmail.com'
OWNER_ONLY = "auth != null && auth.token.email_verified == true && auth.token.email === '%s'" % OWNER
MARK = '/nlo/settings/invFrozen'
PROBE = '/nlo/items/__freezeProbe'   # a write of nothing there (null) is how the check asks "may this token write here?"
TOKEN = {}

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

def keep_dir():
    """where the rules from before a freeze are kept (never in deploy/, which deploy.py empties)"""
    d = pathlib.Path(arg('--keep-dir') or (ROOT / 'rollback')); d.mkdir(parents=True, exist_ok=True); return d

def cli_token():
    """the Firebase CLI's sign-in (it refreshes its own token when a command runs)"""
    fb = os.environ.get('FIREBASE_BIN') or next((p for p in ['/tmp/fbtools/node_modules/.bin/firebase', str(ROOT / 'node_modules' / '.bin' / 'firebase')] if os.path.exists(p)), 'firebase')
    subprocess.run([fb, 'projects:list', '--json'], capture_output=True, timeout=120)
    store = pathlib.Path.home() / '.config' / 'configstore' / 'firebase-tools.json'
    tok = (json.loads(store.read_text()).get('tokens') or {}).get('access_token') if store.exists() else None
    if not tok: sys.exit('Not signed in to the Firebase CLI: run  npx firebase login --no-localhost  first.')
    return tok

def call(method, path, body=None, raw=False, auth=None, ok_codes=None):
    """a request to the database: with this script's token, or (auth) as a signed-in page would"""
    base, ns = arg('--base', BASE), arg('--ns')
    tok = None if auth else (arg('--token') or TOKEN.get('t') or TOKEN.setdefault('t', cli_token()))
    params = (['ns=' + ns] if ns else []) + (['auth=' + auth] if auth else []) + (['access_token=' + tok] if tok and tok != 'owner' else [])
    h = {'Content-Type': 'application/json'}
    if tok == 'owner': h['Authorization'] = 'Bearer owner'
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    r = urllib.request.Request(base + path + '.json' + ('?' + '&'.join(params) if params else ''), data=data, method=method, headers=h)
    local = urllib.parse.urlparse(base).hostname in ('127.0.0.1', 'localhost')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if local else urllib.request.build_opener()
    try:
        with opener.open(r, timeout=60) as x:
            t = x.read().decode()
            return t if raw else json.loads(t or 'null')
    except urllib.error.HTTPError as e:
        if ok_codes and e.code in ok_codes: return e.code
        sys.exit('%s %s → HTTP %d: %s' % (method, path, e.code, e.read().decode()[:300]))

def parse(text):
    """the rules as JSON (the console allows // and /* */ comments)"""
    out, i, n, q = [], 0, len(text), None
    while i < n:
        c = text[i]
        if q:
            out.append(c)
            if c == '\\': out.append(text[i + 1]); i += 2; continue
            if c == q: q = None
        elif c in '"\'': q = c; out.append(c)
        elif text.startswith('//', i): i = text.find('\n', i); i = n if i < 0 else i; continue
        elif text.startswith('/*', i): i = text.find('*/', i) + 2; continue
        else: out.append(c)
        i += 1
    return json.loads(''.join(out))

def closed(v):
    """a write rule that lets no page write (false), or only Dr. A's account"""
    return v is False or v == 'false' or v == OWNER_ONLY

def check_shape(rules):
    top = rules.get('rules')
    if not isinstance(top, dict) or not isinstance(top.get('nlo'), dict): sys.exit('These rules have no "nlo" part; nothing changed.')
    for where, part in (('the top', top), ('nlo', top['nlo'])):
        if '.write' in part and part['.write'] not in (False, 'false'):
            sys.exit('The rules let some sign-ins write all of %s, so Inventory can’t be closed on its own. Nothing changed.' % where)
    for k in NODES:
        node = top['nlo'].get(k)
        if node is None: continue
        if not isinstance(node, dict): sys.exit('nlo/%s isn’t shaped as expected; nothing changed.' % k)
        bad = walk(node)
        if bad: sys.exit('nlo/%s has write rules further down (%s), which closing it here wouldn’t override; nothing changed.' % (k, ', '.join(bad)))

def frozen_of(rules, value):
    new = json.loads(json.dumps(rules))
    for k in NODES:
        node = new['rules']['nlo'].get(k)
        if isinstance(node, dict): node['.write'] = value
    return new

def unfreeze_of(live, saved):
    """the live rules with Inventory's write rules as they were in the saved copy"""
    r = json.loads(json.dumps(live))
    for k in NODES:
        node, was = r['rules']['nlo'].get(k), ((saved.get('rules') or {}).get('nlo') or {}).get(k) or {}
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

def publish(rules):
    out = json.dumps(rules, indent=2, ensure_ascii=False)
    call('PUT', '/.settings/rules', out.encode())
    if parse(call('GET', '/.settings/rules', raw=True)) != rules: sys.exit('The published rules read back differently; check the Firebase console (Realtime Database → Rules).')

def may_write():
    """can the token the alert script relies on (Dr. A's Google token; here this script's own) still write there? A write of
    nothing — no data changes either way"""
    probe = arg('--probe-auth')   # (tests: ask as a page signed in as Dr. A would, whose sign-in the rules do check)
    return call('PUT', PROBE, b'null', auth=probe, ok_codes=(401, 403)) is None

def main():
    host = urllib.parse.urlparse(arg('--base', BASE)).hostname + (('-' + arg('--ns')) if arg('--ns') else '')
    live_text = call('GET', '/.settings/rules', raw=True)
    live = parse(live_text)
    check_shape(live)
    nlo = live['rules']['nlo']
    if '--unfreeze' in sys.argv:
        saved = sorted(keep_dir().glob('rtdb-rules-before-%s-*.json' % host))
        if not saved: sys.exit('No rules kept from before a freeze of this database (%s).' % keep_dir())
        if not all(closed(nlo[k].get('.write')) for k in NODES if isinstance(nlo.get(k), dict)):
            sys.exit('Inventory’s parts aren’t read-only now, so there’s nothing to undo; nothing changed.')
        publish(unfreeze_of(live, parse(saved[-1].read_text())))
        call('DELETE', MARK)
        print('Inventory’s parts have their write rules from %s again (every other rule as it is now); the mark is off.' % saved[-1].name)
        return
    value = OWNER_ONLY if '--owner-writes' in sys.argv else False
    already = all(nlo[k].get('.write') == value for k in NODES if isinstance(nlo.get(k), dict))
    for k in NODES:
        was = nlo.get(k, {}).get('.write') if isinstance(nlo.get(k), dict) else None
        print('nlo/%-13s %s' % (k, 'no rule (nothing writes it already)' if k not in nlo else ('already read-only' if was == value else 'write: %s\n%17s→ %s' % (was, '', 'nobody (no page)' if value is False else 'Dr. A’s account only'))))
    if '--freeze' not in sys.argv:
        print('\nNothing changed. Run again with --freeze to publish it.'); return
    if already: print('\nAlready read-only; nothing to publish.')
    else:
        if not any(closed(nlo[k].get('.write')) for k in NODES if isinstance(nlo.get(k), dict)):
            (keep_dir() / ('rtdb-rules-before-%s-%s.json' % (host, time.strftime('%Y%m%d-%H%M%S')))).write_text(live_text)
        new = frozen_of(live, value)
        publish(new)
        if unfreeze_of(new, live) != live: sys.exit('Something besides the write rules changed; put the old rules back with --unfreeze and check.')
    note = ''
    if not may_write():
        # the token the alert script relies on doesn't get past the rules: Dr. A's account writes, so the copy carries on
        publish(frozen_of(live, OWNER_ONLY))
        if not may_write(): sys.exit('Even Dr. A’s account can’t write Inventory’s parts now: the alert script couldn’t copy there. Run --unfreeze and check.')
        note = ' Dr. A’s own Google token didn’t get past the rules, so his account stays the one writer there (the alert script runs as him); an old page signed in as him could still write.'
    call('PUT', MARK, {'at': int(time.time() * 1000), 'by': 'go-live', 'nodes': NODES})
    print('\nPublished. The old Inventory is read-only.' + note + ' The rules from before are kept in %s.' % keep_dir())

if __name__ == '__main__':
    main()
