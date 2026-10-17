"""End to end: the real page (dist/nlo-inventory.html?emu) on the Firebase emulators (Firestore, Auth and the Realtime Database),
under the shared rules, with a made-up office set up the way NLO Cases sets one up (logins, members, its roster linked to Staff
Hub) and the old Inventory database holding records shaped as Inventory 3.0.1 wrote them (test/seed.js). Dr. A moves Inventory
over through the page first (t_move); every other test starts from the database exactly as the move left it.
    python3 build.py
    npx firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases "python3 test/e2e.py [test names…]"
Needs Python Playwright with Chromium, and Node. The pinned Firebase files come from test/vendor/firebasejs-10.12.2/
(npm pack firebase@10.12.2: firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js).
Made-up people only."""
import json, os, re, sys, time, shutil, subprocess, threading, functools, http.server, urllib.request, urllib.error, pathlib, traceback
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent
DIST = SRC / 'dist'
WWW = HERE / 'www'
VENDOR = HERE / 'vendor' / 'firebasejs-10.12.2'
P = 'demo-nlo-cases'
FS = 'http://127.0.0.1:8080/v1/projects/' + P + '/databases/(default)/documents'
AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
RT = 'http://127.0.0.1:9000'
PORT = 8794
PAGE = 'http://127.0.0.1:%d/nlo-inventory.html?emu' % PORT
os.environ['NO_PROXY'] = os.environ['no_proxy'] = '127.0.0.1,localhost'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:700]), flush=True)

# ---------- the emulators, by REST (as the owner: no rules) ----------
def req(method, url, body=None, token='owner', raw=False):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with opener.open(r) as x:
            t = x.read(); return x.status, (t if raw else json.loads(t or b'null'))
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t or b'null')
        except Exception: return e.code, t
def F(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [F(x) for x in v]}}
    if isinstance(v, dict) and v.get('__ts'): return {'timestampValue': v['__ts']}
    return {'mapValue': {'fields': {k: F(x) for k, x in v.items()}}}
def V(v):
    if not isinstance(v, dict): return None
    if 'stringValue' in v: return v['stringValue']
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return float(v['doubleValue'])
    if 'booleanValue' in v: return v['booleanValue']
    if 'timestampValue' in v: return {'__ts': v['timestampValue']}
    if 'nullValue' in v: return None
    if 'arrayValue' in v: return [V(x) for x in (v['arrayValue'].get('values') or [])]
    if 'mapValue' in v: return {k: V(x) for k, x in (v['mapValue'].get('fields') or {}).items()}
    return None
def plain(fields): return {k: V(x) for k, x in (fields or {}).items()}
NOW = lambda: {'__ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
def put(path, obj): return req('PATCH', FS + '/' + path, {'fields': {k: F(v) for k, v in obj.items()}})
def get(path):
    c, j = req('GET', FS + '/' + path)
    return plain(j.get('fields')) if c == 200 else None
def raw_docs(coll):
    c, j = req('POST', FS + ':runQuery', {'structuredQuery': {'from': [{'collectionId': coll}]}})
    return [x['document'] for x in (j or []) if isinstance(x, dict) and 'document' in x]
def query(coll): return {d['name'].split('/')[-1]: plain(d.get('fields')) for d in raw_docs(coll)}
def delete(path): return req('DELETE', FS + '/' + path)
def commit(writes):
    for i in range(0, len(writes), 400):
        c, j = req('POST', FS + ':commit', {'writes': writes[i:i + 400]})
        assert c == 200, j
def signup(email, pw):
    c, j = req('POST', AUTH + '/accounts:signUp?key=any', {'email': email, 'password': pw, 'returnSecureToken': True}, token='')
    return j['localId']
def rt(method, path, body=None):
    return req(method, RT + path + '.json?ns=' + P, body)
def set_rules(text):
    c, j = req('PUT', 'http://127.0.0.1:8080/emulator/v1/projects/' + P + ':securityRules', {'rules': {'files': [{'name': 'firestore.rules', 'content': text}]}})
    assert c == 200, j

# ---------- the made-up office ----------
PEOPLE = [  # sid, username, name, role, password, Staff Hub id (rid), active
    ('amir', 'amir', 'Dr. Riley Owner', 'owner', 'owner-pass-1', 's_amir', True),
    ('sarah', 'sarah', 'Sarah Bell', 'staff', 'sarah-pass-1', 's_sarah', True),
    ('gwen', 'gwen', 'Gwen Reed', 'staff', 'gwen-pass-1', 's_gwen', True),
    ('kaylee', 'kaylee', 'Kaylee Dunn', 'staff', 'kaylee-pass-1', 's_kaylee', True),
    ('lee', 'lee', 'Lee Former', 'staff', 'lee-pass-1', '', False),
    ('nina', 'nina', 'Nina New', 'staff', 'nina-temp-1', '', True)]   # still has her temporary password (must set up in NLO Cases)
UID = {}
PW = {p[0]: p[4] for p in PEOPLE}
def seed_people():
    for sid, un, name, role, pw, rid, active in PEOPLE:
        email = 'dr.test@example.com' if role == 'owner' else un + '.1@staff.thenextlevelorthodontics.com'
        if sid not in UID: UID[sid] = signup(email, pw)
        put('logins/' + un, {'email': email})
        m = {'staffId': sid, 'role': role, 'active': active, 'name': name}
        if sid == 'nina': m['mustSetup'] = True
        put('members/' + UID[sid], m)
        r = {'name': name, 'role': role, 'active': active, 'initials': 'XX', 'username': un}
        if rid: r['rid'] = rid
        put('roster/' + sid, r)
    put('meta/setup', {'owner': UID['amir'], 'at': NOW()}); put('meta/keys', {'current': 1}); put('meta/settings', {'idleMin': 10})
def seed_old():
    s = subprocess.run(['node', '-e', "global.window={}; eval(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(JSON.stringify(window.__SEED))", str(HERE / 'seed.js')], capture_output=True, text=True, check=True).stdout
    data = json.loads(s)
    data['nlo']['settings']['geminiKey'] = 'AIzaFAKEKEYFORTESTS'
    # photos kept inside records, as the old app did before its photo clean-up: a small one, one too big to keep as it is, one
    # that isn't a picture at all
    data['nlo']['items']['adh-1']['img'] = 'data:image/png;base64,' + png(24, 24)
    data['nlo']['items']['ppe-1']['imgFull'] = 'data:image/png;base64,' + png(760, 520)
    data['nlo']['orders']['order-r1']['slipPhoto'] = 'data:image/jpeg;base64,bm90IGEgcGljdHVyZQ=='
    # the mark the go-live step leaves when it makes the old Inventory read-only (freeze_old.py)
    data['nlo']['settings']['invFrozen'] = {'at': int(time.time() * 1000), 'by': 'go-live'}
    c, j = rt('PUT', '/', data); assert c == 200, j
    return data

def png(w, h):
    """a PNG of random pixels (base64): random pixels don't compress, so a big one stays big"""
    import zlib, struct, base64
    rows = b''.join(b'\x00' + os.urandom(w * 3) for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return base64.b64encode(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')).decode()

SNAP = {}
def snapshot():
    SNAP.clear()
    for coll in ['invItems', 'invOrders', 'invVendors', 'invExpenses', 'invLog', 'invState', 'invPics', 'invMeta', 'invAlerts', 'invBots', 'invBeat', 'logins', 'members', 'roster', 'meta']:
        SNAP[coll] = raw_docs(coll)
def restore():
    req('DELETE', 'http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents')
    writes = [{'update': {'name': d['name'], 'fields': d.get('fields') or {}}} for docs in SNAP.values() for d in docs]
    commit(writes)

# ---------- the page ----------
def serve():
    if WWW.exists(): shutil.rmtree(WWW)
    WWW.mkdir()
    for f in ['nlo-inventory.html', 'logo-white.png', 'nlo-home.js', 'nlo-aisa.js', 'nlo-inventory-alerts.gs']:
        if (DIST / f).exists(): shutil.copy(DIST / f, WWW / f)
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WWW))
    h.log_message = lambda *a: None
    s = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s
FS_CHANNEL = re.compile(r'/google\.firestore\.v1\.Firestore/(Listen|Write)/channel')
QR_LIB = HERE / 'vendor' / 'qrcodejs-1.0.0' / 'qrcode.min.js'   # the QR library the page pins (src/scan.js), kept here for the tests
QR_SRI = 'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU'
def qr_lib():
    if not QR_LIB.exists():
        import hashlib, base64
        data = urllib.request.urlopen('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', timeout=60).read()
        assert 'sha384-' + base64.b64encode(hashlib.sha384(data).digest()).decode() == QR_SRI, 'qrcode.min.js isn’t the pinned file'
        QR_LIB.parent.mkdir(parents=True, exist_ok=True); QR_LIB.write_bytes(data)
    return str(QR_LIB)
def new_page(b, w=1366, h=900, quiet=False, **ctxkw):
    ctx = b.new_context(viewport={'width': w, 'height': h}, **ctxkw)
    ctx.route('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', lambda r: r.fulfill(path=qr_lib(), content_type='text/javascript', headers={'Access-Control-Allow-Origin': '*'}))
    ctx.route(re.compile(r'https://www\.gstatic\.com/firebasejs/10\.12\.2/.*'), lambda r: r.fulfill(path=str(VENDOR / r.request.url.rsplit('/', 1)[1]), content_type='text/javascript'))
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://www\.google\.com/s2/favicons.*'), lambda r: r.abort())
    pg = ctx.new_page(); errs = []
    def con(m):
        if m.type != 'error': return
        t = m.text
        if 'Failed to load resource' in t or 'PERMISSION_DENIED' in t and quiet: return
        errs.append('console: ' + t[:300])
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
    pg.on('console', con)
    pg.on('dialog', lambda d: (errs.append('native dialog: ' + d.message[:120]), d.dismiss()))
    pg.on('response', lambda r: errs.append('HTTP %d %s' % (r.status, r.url[:140])) if r.status >= 400 and not (r.status == 400 and FS_CHANNEL.search(r.url)) and 'favicons' not in r.url else None)
    return ctx, pg, errs
def J(pg, js, arg=None): return pg.evaluate(js) if arg is None else pg.evaluate(js, arg)
def sign_in(pg, sid, wait_app=True):
    un = next(p[1] for p in PEOPLE if p[0] == sid)
    pg.goto(PAGE, wait_until='load')
    pg.wait_for_selector('#lgUser', timeout=15000)
    pg.fill('#lgUser', un); pg.fill('#lgPw', PW[sid]); pg.click('#lgBtn')
    if wait_app: pg.wait_for_function("() => typeof S !== 'undefined' && S.inApp && allLoaded()", timeout=20000); pg.wait_for_timeout(250)
def open_as(b, sid, **kw):
    ctx, pg, errs = new_page(b, **kw); sign_in(pg, sid); return ctx, pg, errs
def store(path):
    """the database as the old tests read it (nlo/… paths), from the new records"""
    parts = [x for x in path.split('/') if x]
    if parts[:1] == ['nlo']: parts = parts[1:]
    strip = lambda d: {k: v for k, v in (d or {}).items() if k not in ('up', 'upBy')} if d is not None else None
    if parts[0] == 'cart': return (get('invState/cart') or {}).get('lines') or []
    if parts[0] == 'items': return strip(get('invItems/' + parts[1])) if len(parts) > 1 else {k: strip(v) for k, v in query('invItems').items()}
    if parts[0] == 'orders': return strip(get('invOrders/' + parts[1])) if len(parts) > 1 else {k: strip(v) for k, v in query('invOrders').items()}
    if parts[0] == 'vendors': return {k: strip(v) for k, v in query('invVendors').items()}
    if parts[0] == 'log':
        # one record per person per month: whose record an entry is in is who made it (the moved ones, in old…, as stamped)
        out = {}
        for m in query('invLog').values():
            who = (m or {}).get('who') or ''
            for k, e in ((m or {}).get('e') or {}).items():
                e = dict(e)
                if who and not re.match(r'^old\d*$', who): e['byId'] = who
                out[k] = e
        return out
    if parts[0] == 'budget':
        b = strip(get('invState/budget'))
        if b is not None: b['expenses'] = sorted([strip(x) for x in query('invExpenses').values()], key=lambda x: str(x.get('addedAt') or x.get('date') or ''), reverse=True)
        return b
    if parts[0] == 'elastoPrices': return (get('invState/prices') or {}).get('p') or {}
    if parts[:2] == ['settings', 'alertQueue']: return {k: strip(v) for k, v in query('invAlerts').items()}
    if parts[0] == 'settings': return strip(get('invState/settings'))
    raise Exception('unknown path ' + path)
def remote(path, data):
    """a change made by "another computer" (straight into the database, as its owner)"""
    data = dict(data); data['up'] = NOW(); data['upBy'] = 'sarah'
    return put(path, data)
def lines(cart): return cart if isinstance(cart, list) else list((cart or {}).values())


def settle(pg, ms=350):
    """wait until every save from this page has come back from the database"""
    pg.wait_for_function("() => !B.pending", timeout=15000); pg.wait_for_timeout(ms)
def click(pg, sel, wait=300):
    pg.click(sel); pg.wait_for_timeout(wait); settle(pg, 150)
def switch_to(pg, sid):
    """the next person at the same computer: Lock, then their own login"""
    settle(pg, 100); J(pg, "closeDrawer(); closeModal(true)"); pg.wait_for_timeout(100)
    pg.click('#whoSlot [data-act="lock"]'); pg.wait_for_selector('#lgPw', timeout=15000)
    un = next(p[1] for p in PEOPLE if p[0] == sid)
    pg.fill('#lgUser', un); pg.fill('#lgPw', PW[sid]); pg.click('#lgBtn')
    pg.wait_for_function("() => typeof S !== 'undefined' && S.inApp && allLoaded()", timeout=20000); pg.wait_for_timeout(250)
def remote_field(path, field, value):
    """another computer changed one field"""
    return req('PATCH', FS + '/' + path + '?updateMask.fieldPaths=' + field, {'fields': {field: F(value)}})
def toasts(pg): return J(pg, "document.querySelector('#toasts').textContent")

TESTS = []
def test(fn): TESTS.append(fn); return fn

# ======================================================================
@test
def t_move(b):
    """Dr. A moves Inventory over, through the page (every other test starts from what this leaves)"""
    # before the move: staff are told to keep using the old Inventory; the rules marker is there
    ctx, pg, errs = new_page(b); sign_in(pg, 'gwen', wait_app=False)
    pg.wait_for_function("() => S.inApp && S.gate === 'notyet'", timeout=15000)
    check('before the move: staff see "Inventory is moving"', 'Inventory is moving' in J(pg, "document.querySelector('#view').textContent"), J(pg, "document.querySelector('#view').textContent.slice(0,200)"))
    check('before the move: a link to the old Inventory', J(pg, "!!document.querySelector('#view a[href=\"https://nlo-inventory.web.app\"]')"))
    check('before the move: no page errors (staff)', not errs, errs); ctx.close()
    ctx, pg, errs = new_page(b); sign_in(pg, 'amir', wait_app=False)
    pg.wait_for_function("() => S.inApp && S.gate === 'move'", timeout=15000)
    check('before the move: Dr. A sees the move card', J(pg, "!!document.querySelector('.moveCard')"))
    # the old Inventory isn't read-only yet: the card says so, and won't move
    frozen = rt('GET', '/nlo/settings/invFrozen')[1]
    rt('DELETE', '/nlo/settings/invFrozen')
    pg.click('[data-act="mvConnect"]')
    pg.wait_for_function("() => MV.step === 'ready' || MV.err", timeout=20000)
    check('move: read the old Inventory', J(pg, "MV.step") == 'ready', J(pg, "MV.err"))
    check('move: not read-only yet → the card says so', J(pg, "MV.plan.frozen") is False and 'still takes changes' in J(pg, "document.querySelector('.moveCard').textContent"), J(pg, "document.querySelector('.moveCard').textContent")[-400:])
    check('move: …and Move it now is off', J(pg, "document.querySelector('[data-act=mvGo]').disabled") is True)
    rt('PUT', '/nlo/settings/invFrozen', frozen)
    pg.click('[data-act="mvRead"]'); pg.wait_for_function("() => MV.step === 'ready' && MV.plan && MV.plan.frozen", timeout=20000)
    check('move: read-only now → Move it now is on', J(pg, "!document.querySelector('[data-act=mvGo]').disabled"))
    c = J(pg, "MV.plan && MV.plan.counts") or {}
    check('move: counts what the old one has (6 supplies, 3 orders, 1 vendor, 4 log entries, 1 cart line, 1 expense)',
          [c.get('items'), c.get('orders'), c.get('vendors'), c.get('log'), c.get('cart'), c.get('expenses')] == [6, 3, 1, 4, 1, 1], c)
    check('move: money in the log $136.50', abs((c.get('money') or 0) - 136.5) < 0.001, c)
    check('move: two photos kept inside supplies become photo records', c.get('pics') == 2, c)
    notes = J(pg, "MV.plan.notes")
    check('move: the slip photo that isn’t a picture is named, not moved', any('couldn’t be read' in n for n in notes), notes)
    check('move: the alerts were on — they start with the new alert script', any('Email alerts were on' in n for n in notes), notes)
    txt = J(pg, "document.querySelector('.moveCard').textContent")
    check('move: the card says only Dr. A changes settings now, and the cart’s line waits for his OK', 'everyone else: supplies, the cart, orders' in txt and 'they wait for your OK' in txt, txt[-700:])
    check('move: the card shows what it found', 'Supplies' in txt and 'Activity log' in txt and '$136.50' in txt and 'yes, moved too' in txt and 'read-only' in txt, txt[:600])
    pg.click('[data-act="mvGo"]'); pg.wait_for_selector('#cbYes')
    with pg.expect_download(timeout=30000) as dl:
        pg.click('#cbYes')
    d = dl.value; copy = json.loads(open(d.path()).read())
    parts = copy.get('parts') or {}
    check('move: a copy of the old Inventory saved to this computer first (without the AI keys)', d.suggested_filename.startswith('nlo-inventory-before-the-move-') and ((parts.get('items') or {}).get('ppe-1') or {}).get('qty') == 14 and 'settings/geminiKey' not in parts and 'log' in parts, (d.suggested_filename, list(parts)))
    pg.wait_for_function("() => MV.step === 'done' || MV.step === 'error'", timeout=60000)
    check('move: done, every record and dollar found', J(pg, "MV.step") == 'done', J(pg, "MV.err"))
    mv = get('invMeta/moved') or {}
    check('move: marked moved, by Dr. A, with the counts', mv.get('upBy') == 'amir' and (mv.get('counts') or {}).get('items') == 6 and (mv.get('counts') or {}).get('expenses') == 1 and mv.get('alertsWere') is True, mv)
    items = query('invItems')
    check('move: 6 supply records, under their old ids', sorted(items) == ['adh-1', 'cs-9', 'gone-1', 'ppe-1', 'ppe-2', 'ppe-3'], sorted(items))
    adh = items.get('adh-1') or {}
    check('move: the photo inside a supply is now a pic: record', str(adh.get('img', '')).startswith('pic:pm_'), adh.get('img'))
    pics = query('invPics'); big = str((items.get('ppe-1') or {}).get('imgFull', '')).replace('pic:', '')
    check('move: two photo records', len(pics) == 2, {k: (v.get('m'), len(v.get('b') or '')) for k, v in pics.items()})
    check('move: the small one kept as it was (PNG)', (pics.get(adh.get('img', '').replace('pic:', '')) or {}).get('m') == 'image/png')
    check('move: the big one made smaller (a JPEG that fits)', (pics.get(big) or {}).get('m') == 'image/jpeg' and 1000 < len((pics.get(big) or {}).get('b') or '') <= 990000, (pics.get(big) or {}).get('m'))
    check('move: the order lost only its unreadable slip photo', 'slipPhoto' not in (query('invOrders').get('order-r1') or {}) and (query('invOrders').get('order-r1') or {}).get('vendor') == 'American Orthodontics')
    check('move: archived and deleted supplies keep their flags', items['cs-9'].get('archived') is True and items['gone-1'].get('deleted') is True)
    log = store('nlo/log'); recs = query('invLog')
    check('move: 4 log entries, in each month’s “old” record (as the old app stamped them)', len(log) == 4 and recs and all(re.match(r'^m\d{4}-\d{2}~old$', k) and v.get('who') == 'old' for k, v in recs.items()), (len(log), list(recs)))
    st = get('invState/settings') or {}
    check('move: settings (locations; no list of people who change settings; alerts off until the new script runs)', st.get('locations') == ['Lab cabinet', 'Sterilization closet'] and 'invAdmins' not in st and st.get('alertsOn') is False, st)
    check('move: the AI key moved (Dr. A only sets it)', (get('invState/ai') or {}).get('gemini') == 'AIzaFAKEKEYFORTESTS')
    check('move: the cart line moved', len(store('nlo/cart')) == 1 and store('nlo/cart')[0].get('itemId') == 'adh-1', store('nlo/cart'))
    ex = query('invExpenses')
    check('move: the expense is a record of its own', list(ex) == ['x1'] and ex['x1'].get('amount') == 145, ex)
    check('move: the budget moved (amounts only)', (store('nlo/budget') or {}).get('monthly') == 8000 and 'expenses' not in (get('invState/budget') or {}), get('invState/budget'))
    check('move: the old database is untouched', rt('GET', '/nlo/items/adh-1')[1].get('img', '').startswith('data:image/png') and len(rt('GET', '/nlo/log')[1]) == 4)
    check('move: the connection to the old Inventory is closed', J(pg, "!(OLD.auth && OLD.auth.currentUser)"))
    pg.click('[data-act="mvOpen"]')
    pg.wait_for_function("() => S.inApp && allLoaded()", timeout=15000)
    check('move: Inventory opens for Dr. A', J(pg, "S.gate") == 'ready' and J(pg, "S.D.items.length") == 6 and J(pg, "S.D.expenses.length") == 1)
    check('move: the moved cart line waits for his OK', J(pg, "S.D.cart.length === 1 && !okOf(S.D.cart[0])") is True, J(pg, "[S.D.cart, S.D.cartOk]"))
    check('move: no page errors', not errs, errs)
    ctx.close()
    remote_field('invState/settings', 'alertsOn', True)   # (as once Dr. A has the new alert script: the other tests run with alerts on)
    snapshot()

@test
def t_move_again(b):
    """running the move a second time (as after one that stopped half way) after the old log changed meanwhile (the old app
    trims it): it adds what's missing, keeps what's there, nothing doubles; and it reads the old one again just before saving"""
    delete('invMeta/moved')
    rt('DELETE', '/nlo/log/l3')       # trimmed by the old app since the first run
    rt('PUT', '/nlo/log/l5', {'id': 'l5', 'type': 'use', 'itemId': 'ppe-2', 'itemName': 'Gloves Pulse Nitrile — LG', 'delta': -1, 'date': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())})
    ctx, pg, errs = new_page(b); sign_in(pg, 'amir', wait_app=False)
    pg.wait_for_function("() => S.inApp && S.gate === 'move'", timeout=15000)
    pg.wait_for_timeout(500)
    check('move again: this page isn’t connected to the old Inventory (that sign-in isn’t kept)', not J(pg, "MV.who"), J(pg, "MV.who"))
    pg.click('[data-act="mvConnect"]'); pg.wait_for_function("() => MV.step === 'ready'", timeout=20000)
    check('move again: reads 4 log entries now (l3 trimmed, l5 new)', J(pg, "MV.plan.counts.log") == 4, J(pg, "MV.plan.counts"))
    # something changes in the old one after it was read
    rt('PUT', '/nlo/log/l6', {'id': 'l6', 'type': 'receive', 'itemId': 'adh-1', 'itemName': 'Transbond XT Syringe', 'delta': 1, 'amount': 10, 'date': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())})
    pg.click('[data-act="mvGo"]'); pg.wait_for_selector('#cbYes'); pg.click('#cbYes')
    pg.wait_for_function("() => MV.step === 'ready' && !!MV.err", timeout=20000)
    check('move again: changed since it was read → nothing saved, the new numbers shown (5 entries, $146.50)', 'changed since you read it' in J(pg, "MV.err") and J(pg, "MV.plan.counts.log") == 5 and abs(J(pg, "MV.plan.counts.money") - 146.5) < 0.001 and not get('invMeta/moved'), (J(pg, "MV.err"), J(pg, "MV.plan.counts")))
    pg.click('[data-act="mvGo"]'); pg.wait_for_selector('#cbYes')
    with pg.expect_download(timeout=30000):
        pg.click('#cbYes')
    pg.wait_for_function("() => MV.step === 'done' || MV.step === 'error'", timeout=60000)
    check('move again: done', J(pg, "MV.step") == 'done', J(pg, "MV.err"))
    log = store('nlo/log')
    check('move again: the log keeps what was saved before and adds what’s new (l1–l6), nothing doubled', sorted(log) == ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'], sorted(log))
    check('move again: still 6 supplies, 2 photos, 1 expense', len(query('invItems')) == 6 and len(query('invPics')) == 2 and len(query('invExpenses')) == 1)
    check('move again: no page errors', not errs, errs)
    ctx.close()
    seed_old()

@test
def t_move_big(b):
    """a big old Inventory: large photos (more than one save can carry), a photo inside an order's line, a month with more
    than a thousand log entries — all moved, in saves that fit"""
    req('DELETE', 'http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents')
    seed_people()
    for i in range(12): rt('PUT', '/nlo/items/big-%d' % i, {'id': 'big-%d' % i, 'name': 'Big photo %d' % i, 'qty': 1, 'cat': 'misc', 'img': 'data:image/png;base64,' + png(500, 460)})
    rt('PUT', '/nlo/orders/order-r1/items/0/img', 'data:image/png;base64,' + png(20, 20))
    day = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() - 86400))
    rt('PATCH', '/nlo/log', {'n%04d' % i: {'id': 'n%04d' % i, 'type': 'use', 'itemId': 'ppe-1', 'delta': -1, 'date': day} for i in range(1200)})
    ctx, pg, errs = new_page(b); sign_in(pg, 'amir', wait_app=False)
    pg.wait_for_function("() => S.inApp && S.gate === 'move'", timeout=15000)
    pg.click('[data-act="mvConnect"]'); pg.wait_for_function("() => MV.step === 'ready' || MV.err", timeout=60000)
    c = J(pg, "MV.plan && MV.plan.counts") or {}
    check('big: 18 supplies, 15 photos (12 large, 2 as before, 1 inside an order line), 1204 log entries', [c.get('items'), c.get('pics'), c.get('log')] == [18, 15, 1204], c)
    J(pg, "window.__saves = []; const sv = B.save; B.save = f => { let n = 0; const p = sv(b => f(new Proxy(b, { get: (t, k) => k === 'set' ? (...a) => { n += a[1] && typeof a[1].b === 'string' ? a[1].b.length : 0; return t.set(...a); } : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }))); window.__saves.push(n); return p; }; 0")
    pg.click('[data-act="mvGo"]'); pg.wait_for_selector('#cbYes')
    with pg.expect_download(timeout=60000):
        pg.click('#cbYes')
    pg.wait_for_function("() => MV.step === 'done' || MV.step === 'error'", timeout=180000)
    check('big: done', J(pg, "MV.step") == 'done', J(pg, "MV.err"))
    saves = J(pg, "window.__saves")
    check('big: the large photos went in more than one save, each well under what a save may carry', len([x for x in saves if x > 0]) >= 2 and max(saves) < 9 * 1024 * 1024, saves)
    pics = query('invPics')
    check('big: 15 photo records', len(pics) == 15, len(pics))
    o = query('invOrders').get('order-r1') or {}
    check('big: the photo inside the order’s line is a pic: record too', str(((o.get('items') or [{}])[0]).get('img', '')).startswith('pic:pm_'), (o.get('items') or [{}])[0])
    recs = query('invLog'); mon = [k for k in recs if k.endswith('~old2')]
    check('big: a month with more than a thousand entries takes two records (old, old2)', len(mon) == 1 and len(store('nlo/log')) == 1204, sorted(recs))
    check('big: no page errors', not errs, errs)
    ctx.close()
    seed_old()

@test
def t_boot(b):
    ctx, pg, errs = open_as(b, 'gwen')
    check('boot: in the app, not the lock screen', J(pg, "!document.querySelector('#app').classList.contains('hidden')"))
    check('boot: signed in as Gwen (her name in the side menu)', 'Gwen Reed' in J(pg, "document.querySelector('#whoSlot').textContent"), J(pg, "document.querySelector('#whoSlot').textContent"))
    check('boot: NLO Cases people (current ones)', J(pg, "activePeople().map(p=>p.short).join(',')") == 'Dr. A,Gwen R.,Kaylee D.,Nina N.,Sarah B.', J(pg, "activePeople().map(p=>p.short)"))
    check('boot: deleted item hidden, archived kept apart', J(pg, "[items().length, activeItems().length]") == [5, 4], J(pg, "[items().length, activeItems().length]"))
    check('boot: old category migrated (bonding -> adhesives)', J(pg, "itemById('adh-1').cat") == 'adhesives')
    check('boot: legacy cart line shows', J(pg, "S.D.cart.length===1 && S.D.cart[0].itemId==='adh-1'"))
    check('boot: sync line live', 'Live' in J(pg, "document.querySelector('#syncLine').textContent"), J(pg, "document.querySelector('#syncLine').textContent"))
    check('boot: an old stamp (Staff Hub id) finds the NLO Cases person', J(pg, "personById('s_kaylee') && personById('s_kaylee').id") == 'kaylee')
    check('boot: a saved vendor’s account number shows over the built-in list', J(pg, "(S.D.vendors.find(v => v.id === 'sun') || {}).acct") == '12345')
    check('boot: the page carries no vendor account numbers of its own', J(pg, "VENDORS.every(v => !v.acct && !v.rep && !v.repEmail)"))
    for v in ['home', 'supplies', 'cart', 'orders', 'quick', 'ml', 'budget', 'activity', 'vendors', 'settings']:
        J(pg, "go('%s')" % v); pg.wait_for_timeout(200)
        bad = J(pg, "document.querySelector('#view').textContent.includes('hit a problem')")
        check('render: ' + v, not bad, J(pg, "document.querySelector('#view').textContent.slice(0,300)"))
    J(pg, "go('supplies')"); pg.wait_for_timeout(600)
    check('boot: the moved photo shows (read from its record)', J(pg, "[...document.querySelectorAll('#view img')].some(i => i.src.startsWith('blob:'))"))
    check('boot: no page errors', not errs, errs)
    ctx.close()

@test
def t_sign_in(b):
    ctx, pg, errs = new_page(b, quiet=True)
    pg.goto(PAGE, wait_until='load'); pg.wait_for_selector('#lgUser')
    def attempt(un, pw):
        pg.fill('#lgUser', un); pg.fill('#lgPw', pw); pg.click('#lgBtn'); pg.wait_for_timeout(1200)
        return J(pg, "(document.querySelector('.lockErr')||{}).textContent || ''")
    check('sign in: unknown username', 'No login with that username' in attempt('nobody', 'x'), attempt('nobody', 'x'))
    check('sign in: wrong password', 'incorrect' in attempt('gwen', 'wrong-pass'))
    check('sign in: someone who left', 'turned off' in attempt('lee', PW['lee']))
    check('sign in: still on a temporary password → NLO Cases first', 'NLO Cases first' in attempt('nina', PW['nina']))
    pg.fill('#lgUser', 'kaylee'); pg.fill('#lgPw', PW['kaylee']); pg.click('#lgBtn')
    pg.wait_for_function("() => S.inApp && allLoaded()", timeout=20000)
    check('sign in: Kaylee gets in', J(pg, "whoNow().id") == 'kaylee')
    check('sign in: her username is remembered on this computer', J(pg, "localStorage.getItem('nloInv.lastLogin')") == 'kaylee')
    lm = get('members/' + UID['kaylee']) or {}
    check('sign in: last sign-in noted (as NLO Cases does)', bool(lm.get('lastLogin')), lm)
    # Lock: back to the sign-in screen, nothing left in the page
    pg.click('#whoSlot [data-act="lock"]'); pg.wait_for_selector('#lgPw', timeout=15000)
    check('lock: back at sign-in, username filled in', J(pg, "document.querySelector('#lgUser').value") == 'kaylee')
    check('lock: says it was locked', 'Locked' in J(pg, "(document.querySelector('.lockOk')||{}).textContent || ''"))
    check('lock: nothing of Inventory left in the page', J(pg, "S.D.items.length === 0 && !S.inApp"))
    ctx.close()

@test
def t_idle_lock(b):
    ctx, pg, errs = open_as(b, 'gwen')
    check('idle: the office setting (10 minutes)', J(pg, "idleMinutes()") == 10)
    put('meta/settings', {'idleMin': 3}); pg.wait_for_timeout(600)
    check('idle: follows NLO Cases’ setting live (3 minutes)', J(pg, "idleMinutes()") == 3)
    J(pg, "S.lastAct = Date.now() - 2 * 60000"); pg.wait_for_timeout(16000)
    check('idle: not locked at 2 minutes', J(pg, "S.inApp") is True)
    # a save still on its way (no internet) holds the lock off — two minutes more at most
    J(pg, "FB.pending = 1; S.lastAct = Date.now() - 4 * 60000"); pg.wait_for_timeout(16000)
    check('idle: a save still on its way holds the lock off a little', J(pg, "S.inApp") is True)
    J(pg, "S.lastAct = Date.now() - 6 * 60000")
    pg.wait_for_selector('#lgPw', timeout=25000)
    msg = J(pg, "(document.querySelector('.lockOk')||{}).textContent || ''")
    check('idle: …not for good: locked after 3 minutes without activity, and it says the change may not have been saved', 'Locked after 3 minutes' in msg and 'may not have been saved' in msg, msg)
    put('meta/settings', {'idleMin': 10})
    check('idle: no page errors', not errs, errs)
    ctx.close()

@test
def t_turned_off(b):
    ctx, pg, errs = open_as(b, 'kaylee')
    put('members/' + UID['kaylee'], {'staffId': 'kaylee', 'role': 'staff', 'active': False, 'name': 'Kaylee Dunn'})
    pg.wait_for_selector('#lgPw', timeout=20000)
    check('turned off: locked out at once', 'turned off' in J(pg, "(document.querySelector('.lockOk')||{}).textContent || ''"), J(pg, "document.querySelector('#lockCard').textContent"))
    put('members/' + UID['kaylee'], {'staffId': 'kaylee', 'role': 'staff', 'active': True, 'name': 'Kaylee Dunn'})
    ctx.close()

@test
def t_rules_gate(b):
    """with the rules from before Inventory joined them (the newest on main without its block), Dr. A gets the card to publish
    the new ones; staff are told to wait"""
    git = lambda *a: subprocess.run(['git'] + list(a), cwd=SRC.parent, capture_output=True, text=True, check=True).stdout
    old = next(t for t in (git('show', h + ':nlo-cases-src/firestore.rules') for h in git('log', '--format=%H', 'origin/main', '--', 'nlo-cases-src/firestore.rules').split()) if 'invItems' not in t)
    old = old.replace('__OWNER_EMAIL__', 'dr.test@example.com')
    set_rules(old)
    try:
        ctx, pg, errs = new_page(b, quiet=True); sign_in(pg, 'amir', wait_app=False)
        pg.wait_for_function("() => S.inApp && S.gate === 'rules'", timeout=15000)
        check('rules: Dr. A sees the publish card', 'One step before Inventory can open' in J(pg, "document.querySelector('#view').textContent"))
        txt = J(pg, "rulesText()")
        check('rules: the card carries the whole new file, his email filled in', 'match /invItems/{id}' in txt and 'match /tcPunch/{id}' in txt and 'dr.test@example.com' in txt and '__OWNER_EMAIL__' not in txt)
        ctx.close()
        ctx, pg, errs = new_page(b, quiet=True); sign_in(pg, 'sarah', wait_app=False)
        pg.wait_for_function("() => S.inApp && S.gate === 'rules'", timeout=15000)
        check('rules: staff are told it isn’t ready yet', 'isn’t ready yet' in J(pg, "document.querySelector('#view').textContent"))
        ctx.close()
    finally:
        set_rules((DIST / 'firestore.rules').read_text())

@test
def t_cart_add_case(b):
    ctx, pg, errs = open_as(b, 'gwen')
    J(pg, "go('supplies')"); pg.wait_for_timeout(200)
    J(pg, "openAddToCart(itemById('ppe-3'), 2)"); pg.wait_for_timeout(200)
    check('add: shows 2 cases = 20 boxes', '2 cases = 20 boxes' in J(pg, "document.querySelector('#addEq').textContent"), J(pg, "document.querySelector('#addEq') && document.querySelector('#addEq').textContent"))
    check('add: says who is adding (no name to tap)', 'Adding as Gwen R.' in J(pg, "document.querySelector('#modalWrap').textContent"))
    click(pg, '#addGo', 600)
    cart = lines(store('nlo/cart'))
    line = next((c for c in cart if c and c.get('itemId') == 'ppe-3'), None)
    check('add: cart line saved', line is not None, cart)
    if line:
        check('add: line in cases with per 10', line.get('qty') == 2 and line.get('unit') == 'case' and line.get('per') == 10 and line.get('countUnit') == 'box', line)
        check('add: case price 100', abs((line.get('price') or 0) - 100) < 0.001, line.get('price'))
        check('add: stamped with the person signed in', line.get('addedBy') == 'Gwen R.' and line.get('addedById') == 'gwen' and bool(line.get('addedAt')), line)
        check('add: kept the old line', any(c and c.get('itemId') == 'adh-1' for c in cart), cart)
    cdoc = get('invState/cart') or {}
    check('add: the cart record says who saved it last', cdoc.get('upBy') == 'gwen', cdoc.get('upBy'))
    ev = [e for e in query('invAlerts').values() if e.get('t') == 'cart']
    check('add: alert left with who', ev and ev[0].get('by') == 'Gwen R.' and ev[0]['lines'][0]['q'] == 2 and ev[0].get('upBy') == 'gwen', ev)
    # add more of the same, another person, while "another computer" also adds something
    switch_to(pg, 'kaylee')
    remote('invState/cart', {'lines': lines(store('nlo/cart')) + [{'itemId': 'ppe-2', 'name': 'Gloves Pulse Nitrile — LG', 'sku': '177302', 'vendor': 'SunSurgical', 'price': 9.13, 'unit': 'box', 'qty': 3}]})
    pg.wait_for_timeout(400)
    J(pg, "cartAdd(itemById('ppe-3'), 1, {})"); settle(pg)
    cart = lines(store('nlo/cart'))
    l3 = next((c for c in cart if c.get('itemId') == 'ppe-3'), {})
    check('add more: 3 cases, trail has +1 by Kaylee', l3.get('qty') == 3 and any(t.get('t') == 'more' and t.get('by') == 'Kaylee D.' and t.get('byId') == 'kaylee' for t in (l3.get('trail') or [])), l3)
    check('add more: other computer\'s line kept', any(c.get('itemId') == 'ppe-2' for c in cart), cart)
    check('cart: no page errors', not errs, errs)
    ctx.close()

@test
def t_two_computers(b):
    """two people on two computers at the same moment: both cart adds stay, both stock steps count"""
    c1, p1, e1 = open_as(b, 'gwen'); c2, p2, e2 = open_as(b, 'kaylee')
    q0 = store('nlo/items/cs-9')['qty']
    J(p1, "Promise.all([cartAdd(itemById('ppe-1'), 1, {}), stockStep(itemById('cs-9'), -1, 'use', 'Used')]); null")
    J(p2, "Promise.all([cartAdd(itemById('ppe-2'), 2, {}), stockStep(itemById('cs-9'), -1, 'use', 'Used')]); null")
    settle(p1); settle(p2); p1.wait_for_timeout(400)
    cart = lines(store('nlo/cart'))
    check('two computers: both cart lines are there', any(c.get('itemId') == 'ppe-1' and c.get('addedBy') == 'Gwen R.' for c in cart) and any(c.get('itemId') == 'ppe-2' and c.get('addedBy') == 'Kaylee D.' for c in cart), cart)
    check('two computers: both stock steps counted', store('nlo/items/cs-9')['qty'] == q0 - 2, (q0, store('nlo/items/cs-9')['qty']))
    check('two computers: each page sees the other’s line', J(p1, "S.D.cart.some(c => c.itemId === 'ppe-2')") and J(p2, "S.D.cart.some(c => c.itemId === 'ppe-1')"))
    # (two transactions on the same record at once: the database turns one back and the page tries again — that's how both count)
    errs = [e for e in e1 + e2 if not re.search(r'HTTP 4(00|09) .*documents:commit', e)]
    check('two computers: no page errors', not errs, errs)
    c1.close(); c2.close()

@test
def t_place_and_receive(b):
    ctx, pg, errs = open_as(b, 'sarah')
    J(pg, "cartAdd(itemById('ppe-1'), 2, {})"); settle(pg)
    cart = lines(store('nlo/cart'))
    l1 = next((c for c in cart if c.get('itemId') == 'ppe-1'), {})
    check('box item: 2 boxes, no per', l1.get('unit') == 'box' and not l1.get('per'), l1)
    J(pg, "B.patchItem('ppe-1', { buyUnit: 'case', perBuy: 10 })"); settle(pg)
    J(pg, "cartSetQty('ppe-1', 0)"); settle(pg)
    J(pg, "cartAdd(itemById('ppe-1'), 1, {})"); settle(pg)
    J(pg, "go('cart')"); pg.wait_for_timeout(200)
    check('cart: Sarah’s line waits for Dr. A’s OK (no place button yet)', pg.query_selector('[data-act="placeOrder"][data-v="SunSurgical"]') is None and 'Waiting for Dr. A’s OK' in J(pg, "document.querySelector('#view').textContent"))
    c2, p2, e2 = open_as(b, 'amir')
    J(p2, "go('cart')"); p2.wait_for_timeout(300)
    lid = J(p2, "(S.D.cart.find(c => c.itemId === 'ppe-1') || {}).lineId")
    click(p2, '[data-act="cartOk"][data-line="%s"]' % lid, 600)
    okd = ((get('invState/cart') or {}).get('ok') or {}).get(lid) or {}
    check('cart: Dr. A OKs it (his name, the case it’s for)', okd.get('byId') == 'amir' and okd.get('by') == 'Dr. A' and okd.get('n') == 10 and okd.get('it') == 'ppe-1', okd)
    c2.close()
    pg.wait_for_selector('[data-act="placeOrder"][data-v="SunSurgical"]', timeout=10000)
    btn = pg.query_selector('[data-act="placeOrder"][data-v="SunSurgical"]')
    check('cart: now Sarah has the place button for SunSurgical', btn is not None)
    if btn:
        btn.click(); pg.wait_for_timeout(300)
        pg.fill('#poNum', 'SS-1001')
        click(pg, '[data-act="placeGo"]', 700)
    orders = store('nlo/orders')
    mine = [o for o in orders.values() if o.get('orderNumber') == 'SS-1001']
    check('place: order saved', len(mine) == 1, list(orders.keys()))
    if mine:
        o = mine[0]
        check('place: ordered by Sarah, with time and method', o.get('orderedBy') == 'Sarah B.' and o.get('orderedById') == 'sarah' and o.get('orderedAt') and o.get('method') == 'online' and o.get('status') == 'open', {k: o.get(k) for k in ['orderedBy', 'orderedById', 'orderedAt', 'method', 'status']})
        check('place: id shape order-…', o['id'].startswith('order-'), o['id'])
        check('place: dateOrdered is a local day', re.match(r'^\d{4}-\d{2}-\d{2}$', o.get('dateOrdered') or '') is not None, o.get('dateOrdered'))
        ln = next((l for l in o['items'] if l.get('itemId') == 'ppe-1'), {})
        check('place: line keeps who added it, and Dr. A’s OK', ln.get('addedBy') == 'Sarah B.' and ln.get('unit') == 'case' and ln.get('per') == 10 and (ln.get('ok') or {}).get('by') == 'Dr. A', ln)
        check('place: its OK left the cart with it', lid not in ((get('invState/cart') or {}).get('ok') or {}), get('invState/cart'))
        check('place: trail ordered', any(t.get('t') == 'ordered' and t.get('by') == 'Sarah B.' for t in o.get('trail') or []), o.get('trail'))
        cart = lines(store('nlo/cart'))
        check('place: lines left the cart (SunSurgical only)', not any(c.get('vendor') == 'SunSurgical' for c in cart) and any(c.get('itemId') == 'adh-1' for c in cart), cart)
        it = store('nlo/items/ppe-1')
        check('place: item remembers last ordered', it.get('lastOrderedTimestamp') and it.get('lastOrderedVendorId') == 'SunSurgical', {k: it.get(k) for k in ['lastOrderedTimestamp', 'lastOrderedVendorId']})
        # receive as Kaylee (she doesn't change settings) with the defaults
        switch_to(pg, 'kaylee')
        q0 = store('nlo/items/ppe-1')['qty']
        J(pg, "go('orders')"); pg.wait_for_timeout(200)
        J(pg, "document.querySelector('[data-act=\"receive\"][data-id=\"%s\"]').click()" % o['id']); pg.wait_for_timeout(300)
        check('receive: shows = 10 boxes', '10 boxes' in J(pg, "document.querySelector('#rcEq0').textContent"), J(pg, "document.querySelector('#rcEq0') && document.querySelector('#rcEq0').textContent"))
        J(pg, "document.querySelector('#rcShip').value = '8.5'; INP.rcCalc()")
        click(pg, '[data-act="rcGo"]', 900)
        o2 = store('nlo/orders/' + o['id'])
        q1 = store('nlo/items/ppe-1')['qty']
        check('receive: +10 boxes for 1 case', q1 - q0 == 10, (q0, q1))
        check('receive: stamped received by Kaylee', o2.get('status') == 'received' and o2.get('receivedBy') == 'Kaylee D.' and o2.get('receivedById') == 'kaylee' and o2.get('dateReceived'), {k: o2.get(k) for k in ['status', 'receivedBy', 'receivedById', 'dateReceived']})
        logs = [e for e in store('nlo/log').values() if e.get('orderId') == o['id']]
        rec = [e for e in logs if e['type'] == 'receive']; sh = [e for e in logs if e['type'] == 'shipping']
        check('receive: one receipt, 10 boxes, $91.30, by Kaylee', len(rec) == 1 and rec[0]['delta'] == 10 and abs(rec[0]['amount'] - 91.3) < 0.001 and rec[0]['by'] == 'Kaylee D.' and rec[0].get('date'), rec)
        check('receive: shipping booked once', len(sh) == 1 and abs(sh[0]['amount'] - 8.5) < 0.001, sh)
        it = store('nlo/items/ppe-1')
        src = (it.get('sources') or [{}])[0]
        check('receive: price remembered per box', abs((src.get('price') or 0) - 9.13) < 0.0001 and src.get('vendor') == 'SunSurgical', it.get('sources'))
        r = J(pg, "receiveOrder('%s', {}).then(()=>'went through', e=>e.message)" % o['id'])
        check('receive twice: refused', 'already received' in r, r)
        # reopen: Dr. A's (no button for anyone else; the page, and the database too, refuse them); twice is refused
        J(pg, "go('orders'); openDrawer('order', '%s')" % o['id']); pg.wait_for_timeout(200)
        check('reopen: no Reopen button for Kaylee', pg.query_selector('[data-act="orderReopen"]') is None)
        J(pg, "ACT.orderReopen({ dataset: { id: '%s' } })" % o['id']); pg.wait_for_timeout(300)
        check('reopen: Kaylee refused', 'Only Dr. A can reopen' in toasts(pg), toasts(pg))
        r = J(pg, "B.claimOrder('%s', cur => cur === 'received' ? 'open' : undefined).then(()=>'went through', e=>e.code || e.message)" % o['id'])
        check('reopen: the database refuses Kaylee too', 'permission' in r, r)
        switch_to(pg, 'sarah')
        r = J(pg, "reopenOrder('%s').then(()=>'went through', e=>e.code || e.message)" % o['id'])
        check('reopen: …and Sarah', 'permission' in r and store('nlo/orders/' + o['id']).get('status') == 'received', r)
        switch_to(pg, 'amir')
        J(pg, "go('orders'); openDrawer('order', '%s')" % o['id']); pg.wait_for_timeout(200)
        click(pg, '[data-act="orderReopen"]', 300)
        click(pg, '#cbYes', 900)
        o3 = store('nlo/orders/' + o['id']); q2 = store('nlo/items/ppe-1')['qty']
        check('reopen: open again, stock back', o3.get('status') == 'open' and q2 == q0, (o3.get('status'), q0, q2))
        logs = [e for e in store('nlo/log').values() if e.get('orderId') == o['id']]
        net = round(sum((e.get('amount') or 0) for e in logs), 2)
        check('reopen: money nets to 0', net == 0, [(e['type'], e.get('amount')) for e in logs])
        r = J(pg, "reopenOrder('%s').then(()=>'went through', e=>e.message)" % o['id'])
        check('reopen twice: refused', 'isn’t received' in r, r)
        J(pg, "receiveOrder('%s', {})" % o['id']); settle(pg, 700)
        q3 = store('nlo/items/ppe-1')['qty']
        check('re-receive: +10 again', q3 - q0 == 10, (q0, q3))
    check('place/receive: no page errors (but the refusals tried on purpose)', not [e for e in errs + e2 if 'PERMISSION_DENIED' not in e and not re.search(r'HTTP 403 .*documents:commit', e)], errs + e2)
    ctx.close()

# what one tap opens, per device (Amir, 16 Oct 2026: "I used to be able to select email and it would automatically open up the
# email with the message in it. same thing with text … it would not be able to send a text via pc")
OPEN_REC = """() => { window.__opened = []; document.addEventListener('click', e => {
  const a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a) return;
  const h = a.getAttribute('href') || '';
  if (/^(mailto|sms|tel):/i.test(h) || a.target === '_blank') { window.__opened.push((a.target === '_blank' ? 'tab:' : '') + h); e.preventDefault(); }
}, true); }"""
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
def decode_qr(data_url):
    import base64, numpy as np, cv2
    img = cv2.imdecode(np.frombuffer(base64.b64decode(data_url.split(',', 1)[1]), np.uint8), cv2.IMREAD_GRAYSCALE)
    img = cv2.resize(cv2.copyMakeBorder(img, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=255), None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    return cv2.QRCodeDetector().detectAndDecode(img)[0]
def place_dialog(pg):
    J(pg, "closeModal(true); go('cart')"); pg.wait_for_timeout(250)
    pg.click('[data-act="placeOrder"][data-v="SunSurgical"]'); pg.wait_for_timeout(300)
def tap_how(pg, k): pg.click('#modalWrap .how[data-k="%s"]' % k); pg.wait_for_timeout(250)
def opened(pg): return J(pg, "window.__opened.slice()")
# with a Safari name the sign-in library frames its Auth host — on the emulators that's 127.0.0.1:9099, which the page's
# frame-src leaves out; live it's nlo-cases.firebaseapp.com, which the page allows
def real_errs(errs): return [e for e in errs if "Refused to frame 'http://127.0.0.1:9099/'" not in e]
def modal_text(pg): return J(pg, "document.querySelector('#modalWrap').textContent")
@test
def t_order_links(b):
    for f, v in [('rep', 'Mark Testrep'), ('repPhone', '813-555-0142'), ('repEmail', 'mark@sun.example')]: remote_field('invVendors/sun', f, v)
    # an office PC
    ctx, pg, errs = open_as(b, 'amir')
    pg.wait_for_function("() => (vendorByName('SunSurgical') || {}).repPhone === '813-555-0142'", timeout=10000)
    J(pg, "cartAdd(itemById('ppe-1'), 2, {})"); settle(pg)
    J(pg, OPEN_REC); place_dialog(pg)
    check('order links (PC): the dialog opens on their website, nothing opened yet', J(pg, "S.ui.place.how") == 'online' and opened(pg) == [], opened(pg))
    tap_how(pg, 'email'); op = opened(pg); mail = op[-1] if op else ''
    check('order links (PC): one tap on Email opens the email to the rep, the order written out', len(op) == 1 and mail.startswith('mailto:mark@sun.example?subject=') and 'Gloves%20Pulse%20Nitrile' in mail and 'account%2012345' in mail and 'Hello%20Mark' in mail, mail[:200])
    check('order links (PC): it says the email opened, and offers Gmail if it didn’t', 'Your email opened with the order written out' in modal_text(pg) and J(pg, "!!document.querySelector('#modalWrap a[href^=\"https://mail.google.com/mail/?view=cm\"][target=_blank]')"))
    tap_how(pg, 'text')
    check('order links (PC): Text opens nothing on a PC (it can’t text)…', len(opened(pg)) == 1 and not J(pg, "!!document.querySelector('#modalWrap a[href^=\"sms:\"]')"), opened(pg))
    pg.wait_for_function("() => { const i = document.querySelector('#smsQr img'); return !!(i && i.src && i.src.startsWith('data:image')); }", timeout=10000)
    payload = decode_qr(J(pg, "document.querySelector('#smsQr img').src"))
    want = 'SMSTO:+18135550142:Hi Mark, please send Next Level Orthodontics (acct 12345):\n2 boxes - Gloves Pulse Nitrile - SM #177102\nShip to 320 NW 76th Drive, Gainesville, FL 32607. Please confirm. Thanks! - Dr. Riley Owner'
    check('order links (PC): …it shows a QR code: a text to the rep with the order, in plain characters', payload == want, repr(payload))
    check('order links (PC): the QR says to scan it with the phone', 'Scan this with your phone’s camera' in modal_text(pg) and 'Mark (813-555-0142)' in modal_text(pg))
    check('order links (PC): the text shown (and copied) is the text in the QR code', J(pg, "document.querySelector('#orderTxt').textContent") == want.split(':', 2)[2], J(pg, "document.querySelector('#orderTxt').textContent"))
    tap_how(pg, 'call')
    check('order links (PC): Phone call doesn’t dial from a PC: it shows the number', len(opened(pg)) == 1 and 'Call 800-523-1997' in modal_text(pg), opened(pg))
    tap_how(pg, 'online'); op = opened(pg)
    check('order links (PC): Their website opens in a new tab', op[-1:] == ['tab:https://www.sunsurgical.com'], op)
    tap_how(pg, 'text'); pg.fill('#poNum', 'TX-1'); click(pg, '[data-act="placeGo"]', 700)
    o = next((x for x in store('nlo/orders').values() if x.get('orderNumber') == 'TX-1'), {})
    check('order links: ordered by text, as picked', o.get('method') == 'text' and o.get('status') == 'open', {k: o.get(k) for k in ('method', 'status')})
    check('order links (PC): no errors', not errs, errs); ctx.close()
    # an iPhone: Text and Call open straight away, no QR code
    ctx, pg, errs = open_as(b, 'amir', w=390, h=844, user_agent=IPHONE, is_mobile=True, has_touch=True)
    pg.wait_for_function("() => (vendorByName('SunSurgical') || {}).repPhone === '813-555-0142'", timeout=10000)
    J(pg, "cartAdd(itemById('ppe-1'), 1, {})"); settle(pg)
    J(pg, OPEN_REC); place_dialog(pg)
    tap_how(pg, 'text'); op = opened(pg)
    check('order links (iPhone): one tap on Text opens Messages to the rep, the order written out', len(op) == 1 and op[0].startswith('sms:+18135550142?&body=Hi%20Mark%2C%20please%20send') and '1%20box%20-%20Gloves' in op[0], op)
    check('order links (iPhone): no QR code on a phone', not J(pg, "!!document.querySelector('#smsQr')") and 'Messages opened with the order written out' in modal_text(pg))
    tap_how(pg, 'call'); op = opened(pg)
    check('order links (iPhone): Phone call dials', op[-1:] == ['tel:+18005231997'], op)
    tap_how(pg, 'email'); op = opened(pg)
    check('order links (iPhone): Email opens the email (no Gmail link on a phone)', op[-1].startswith('mailto:mark@sun.example?') and not J(pg, "!!document.querySelector('#modalWrap a[href^=\"https://mail.google.com/\"]')"), op[-1:])
    check('order links (iPhone): no errors', not real_errs(errs), errs); ctx.close()
    # a Mac: Messages opens, and the QR code is there too (for a rep Messages on a Mac can't reach)
    ctx, pg, errs = open_as(b, 'amir', user_agent=MAC)
    pg.wait_for_function("() => (vendorByName('SunSurgical') || {}).repPhone === '813-555-0142'", timeout=10000)
    J(pg, OPEN_REC); place_dialog(pg)
    tap_how(pg, 'text'); op = opened(pg)
    check('order links (Mac): Text opens Messages…', len(op) == 1 and op[0].startswith('sms:+18135550142?&body='), op)
    pg.wait_for_function("() => { const i = document.querySelector('#smsQr img'); return !!(i && i.src && i.src.startsWith('data:image')); }", timeout=10000)
    check('order links (Mac): …and offers the QR code to text from the phone instead', decode_qr(J(pg, "document.querySelector('#smsQr img').src")).startswith('SMSTO:+18135550142:Hi Mark') and 'Or text it from your phone' in modal_text(pg))
    tap_how(pg, 'call')
    check('order links (Mac): Phone call doesn’t dial from a computer', len(opened(pg)) == 1, opened(pg))
    check('order links (Mac): no errors', not real_errs(errs), errs); ctx.close()

# photos first (Amir, 16 Oct 2026: "I love high quality pro phtoos of the product … I'm very visual")
@test
def t_photos(b):
    ctx, pg, errs = open_as(b, 'gwen')
    J(pg, "try { localStorage.removeItem('nloInv.supLook') } catch (e) {}; S.ui.sup && delete S.ui.sup.look; go('supplies')"); pg.wait_for_timeout(400)
    n = J(pg, "supVisible().length")
    check('photos: Supplies opens as the photo grid, one card per supply', J(pg, "!!document.querySelector('#view .pgrid') && document.querySelectorAll('#view .pcard').length") == n and n > 0, n)
    pg.wait_for_function("() => { const i = document.querySelector('.pcard[data-id=\"adh-1\"] .ph img'); return !!(i && i.src.startsWith('blob:')); }", timeout=10000)
    pg.wait_for_function("() => { const i = document.querySelector('.pcard[data-id=\"ppe-1\"] .ph img'); return !!(i && i.src.startsWith('blob:')); }", timeout=10000)
    check('photos: a card shows its photo big (the moved one read from its record)', J(pg, "document.querySelector('.pcard[data-id=\"ppe-1\"] .ph').getBoundingClientRect().width") >= 180)
    check('photos: a card without one says so', 'No photo yet' in J(pg, "document.querySelector('.pcard[data-id=\"ppe-2\"]').textContent"))
    check('photos: the card shows price, stock and Add', all(x in J(pg, "document.querySelector('.pcard[data-id=\"ppe-1\"]').textContent") for x in ['on hand', 'Add']) and J(pg, "!!document.querySelector('.pcard[data-id=\"ppe-1\"] [data-act=\"quickAdd\"]')"))
    click(pg, '.pcard[data-id="ppe-1"] [data-act="quickAdd"]', 300)
    check('photos: Add on a card opens Add to the cart (not the drawer)', J(pg, "!!document.querySelector('#modalWrap #addQty') && !S.drawer"))
    J(pg, "closeModal(true)"); pg.wait_for_timeout(150)
    click(pg, '[data-act="supLook"][data-l="list"]', 300)
    check('photos: List is one tap away, remembered on the computer', J(pg, "!document.querySelector('#view .pgrid') && document.querySelectorAll('#view .irow').length") == n and J(pg, "localStorage.getItem('nloInv.supLook')") == 'list')
    switch_to(pg, 'kaylee'); J(pg, "go('supplies')"); pg.wait_for_timeout(300)
    check('photos: still List after a Lock and sign-in on that computer', J(pg, "document.querySelectorAll('#view .irow').length") == n)
    click(pg, '[data-act="supLook"][data-l="grid"]', 300)
    J(pg, "openDrawer('item', 'ppe-1')"); pg.wait_for_timeout(300)
    pg.wait_for_function("() => { const i = document.querySelector('#drawer .dHero img'); return !!(i && i.src.startsWith('blob:')); }", timeout=10000)
    check('photos: the drawer opens on the full-size photo', J(pg, "document.querySelector('#drawer .dHero').getBoundingClientRect().height") >= 200)
    pg.click('#drawer .dHero'); pg.wait_for_timeout(300)
    pg.wait_for_function("() => { const i = document.querySelector('#viewer img'); return !!(i && i.src.startsWith('blob:')); }", timeout=10000)
    check('photos: a tap on it fills the screen, with the name', 'Gloves Pulse Nitrile' in J(pg, "document.querySelector('#viewer').textContent") and J(pg, "document.querySelector('#viewer .vPic').getBoundingClientRect().width") > 500)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('photos: Esc closes the photo, the drawer stays', J(pg, "!document.getElementById('viewer') && !!S.drawer"))
    check('Used 1 is gone (the drawer and Scan; past use steps still show in the history)', not J(pg, "[...document.querySelectorAll('#drawer button')].some(x => /Used 1/.test(x.textContent))") and J(pg, "typeof ACT.useOne") == 'undefined' and 'useOne' not in J(pg, "showScanResult.toString()") and J(pg, "!!document.querySelector('#drawer [data-act=\"countIt\"]')"))
    J(pg, "openDrawer('item', 'ppe-2')"); pg.wait_for_timeout(300)
    check('photos: a supply without one offers Add a photo', J(pg, "!!document.querySelector('#drawer .addPic')") and not J(pg, "!!document.querySelector('#drawer .dHero')"))
    pg.click('#drawer .addPic'); pg.wait_for_timeout(400)
    check('photos: Add a photo opens the supply editor', J(pg, "!!document.querySelector('#edPhotoRow')"))
    J(pg, "closeModal(true); closeDrawer(); openViewer(itemById('adh-1'))"); pg.wait_for_timeout(200)
    J(pg, "setTimeout(() => lockOut('test'), 0)"); pg.wait_for_selector('#lgPw', timeout=15000)
    check('photos: locking closes an open photo', J(pg, "!document.getElementById('viewer')"))
    check('photos: no errors', not errs, errs); ctx.close()
    # a phone: two big cards across
    ctx, pg, errs = open_as(b, 'gwen', w=390, h=844)
    J(pg, "try { localStorage.removeItem('nloInv.supLook') } catch (e) {}; S.ui.sup && delete S.ui.sup.look; go('supplies')"); pg.wait_for_timeout(400)
    check('photos (phone): two cards across', J(pg, "getComputedStyle(document.querySelector('#view .pgrid')).gridTemplateColumns.split(' ').length") == 2)
    check('photos (phone): no sideways scrolling', J(pg, "document.documentElement.scrollWidth <= window.innerWidth + 1"), J(pg, "[document.documentElement.scrollWidth, window.innerWidth]"))
    check('photos (phone): no errors', not errs, errs); ctx.close()

@test
def t_legacy_orders(b):
    # (the activity list is Dr. A's: the old records' steps as the old app stamped them)
    c2, p2, e2 = open_as(b, 'amir')
    J(p2, "go('activity')"); p2.wait_for_timeout(200)
    txt = J(p2, "document.querySelector('#view').textContent")
    check('activity: legacy order in feed', 'Sarah B. placed the Henry Schein order' in txt, txt[:600])
    check('activity: old receive with who', 'Kaylee D. received the American Orthodontics order' in txt, txt[:800])
    check('activity: no page errors', not e2, e2)
    c2.close()
    ctx, pg, errs = open_as(b, 'gwen')
    J(pg, "go('orders')"); pg.wait_for_timeout(200)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('legacy order: shows ordered by Sarah B. by phone', 'Sarah B.' in txt and 'by phone' in txt, txt[:400])
    J(pg, "document.querySelector('[data-act=\"receive\"][data-id=\"abc123\"]').click()"); pg.wait_for_timeout(300)
    J(pg, "document.querySelector('[data-rc=\"qty\"][data-k=\"0\"]').value='1'; INP.rcCalc()")
    click(pg, '[data-act="rcGo"]', 900)
    orders = store('nlo/orders')
    bo = [o for o in orders.values() if o.get('backorderOf') == 'abc123']
    check('short receive: backorder for 1 syringe', len(bo) == 1 and bo[0]['items'][0]['qty'] == 1 and bo[0]['status'] == 'open', bo)
    o = orders['abc123']
    check('short receive: orderedQty kept', o['items'][0].get('orderedQty') == 2 and o['items'][0]['qty'] == 1, o['items'][0])
    check('short receive: legacy scratch fields untouched', o.get('_selectedVendorId') == 'Henry Schein', o.get('_selectedVendorId'))
    check('legacy: no page errors', not errs, errs)
    ctx.close()

@test
def t_spend_matches_staff_meeting(b):
    ctx, pg, errs = open_as(b, 'gwen')
    J(pg, "receiveOrder('order-old1', {})"); settle(pg, 500)
    J(pg, "receiveOrder('abc123', { lines: [{ qty: 2, price: 39.99 }, { qty: 1, price: 5 }], discount: 4, tax: 3.2, shipping: 6 })"); settle(pg, 600)
    ours = J(pg, "(()=>{ const out = {}; for (let i = 0; i < 3; i++) { const k = shiftMonth(monthKey(Date.now()), -i); out[k] = round2(monthSpend(k, S.D).total); } return out; })()")
    data = {'items': store('nlo/items'), 'orders': store('nlo/orders'), 'log': store('nlo/log'), 'budget': store('nlo/budget')}
    (WWW / 'spend-data.json').write_text(json.dumps(data))
    r = subprocess.run(['node', str(HERE / 'staff_spend.js'), str(WWW / 'spend-data.json')], capture_output=True, text=True)
    theirs = json.loads(r.stdout or '{}') if r.returncode == 0 else {'err': r.stderr[:500]}
    same = all(abs((theirs.get(k, {}) or {}).get('total', 0) - v) < 0.005 for k, v in ours.items())
    check('spend: same month totals as Staff Meeting', same and 'err' not in theirs, {'ours': ours, 'theirs': {k: (v or {}).get('total') for k, v in theirs.items()} if 'err' not in theirs else theirs})
    check('spend: no page errors', not errs, errs)
    ctx.close()

@test
def t_simple_view(b):
    """everyone but Dr. A: Home, Supplies, the Cart, Orders and Quick order — no budget, activity, vendors or settings; only Dr. A
    changes those (Amir, 16 Oct 2026), and the database holds everyone else to it, the office coordinator too"""
    remote_field('invState/settings', 'invAdmins', ['amir', 'sarah'])   # (the old app's list: it means nothing now)
    ctx, pg, errs = new_page(b, quiet=True)
    pg.goto(PAGE.replace('?emu', '?emu#budget'), wait_until='load'); pg.wait_for_selector('#lgUser', timeout=15000)
    pg.fill('#lgUser', 'kaylee'); pg.fill('#lgPw', PW['kaylee']); pg.click('#lgBtn')
    pg.wait_for_function("() => typeof S !== 'undefined' && S.inApp && allLoaded()", timeout=20000); pg.wait_for_timeout(250)
    check('simple: a link to #budget opens Home for Kaylee', J(pg, "S.view") == 'home', J(pg, "S.view"))
    nav = J(pg, "[...document.querySelectorAll('#side .navBtn')].map(b => b.dataset.v)")
    check('simple: her menu is Home, Supplies, Cart, Orders, Quick order', nav == ['home', 'supplies', 'cart', 'orders', 'quick'], nav)
    check('simple: no Ask button (spending)', not J(pg, "!!document.querySelector('#askFab')"))
    for v in ['budget', 'activity', 'vendors', 'settings']:
        J(pg, "go('%s')" % v); pg.wait_for_timeout(120)
        check('simple: %s isn’t hers (Home instead)' % v, J(pg, "S.view") == 'home')
    txt = J(pg, "document.querySelector('#view').textContent")
    check('simple: Home shows no spending or budget, and no activity', 'budget' not in txt.lower() and 'Supply spending' not in txt and 'Latest steps' not in txt and J(pg, "document.querySelectorAll('.tiles .tile').length") == 3, txt[:500])
    check('simple: Home says the cart line waits for Dr. A', 'wait for Dr. A' in txt or 'waiting for Dr. A’s OK' in txt, txt[:500])
    J(pg, "go('orders')"); pg.wait_for_timeout(150)
    check('simple: Orders has Scan a packing slip, no New order', J(pg, "!!document.querySelector('[data-act=slipNew]') && !document.querySelector('[data-act=orderNew]')"))
    J(pg, "openDrawer('order', 'order-old1')"); pg.wait_for_timeout(200)
    acts = J(pg, "[...document.querySelectorAll('.dFt [data-act]')].map(b => b.dataset.act)")
    check('simple: an open order: Receive, Scan slip, Backordered (no Edit, no Void)', acts == ['receive', 'slipFor', 'orderBack'], acts)
    J(pg, "closeDrawer(); openDrawer('order', 'order-r1')"); pg.wait_for_timeout(200)
    check('simple: a received order: no Order again, no Reopen', J(pg, "document.querySelectorAll('.dFt [data-act]').length") == 0, J(pg, "document.querySelector('.dFt').innerHTML"))
    J(pg, "closeDrawer(); go('supplies'); openDrawer('item', 'ppe-1')"); pg.wait_for_timeout(200)
    check('simple: a supply: add to the cart, use, count, edit, QR label — not archive or delete', J(pg, "!!document.querySelector('#drawer [data-act=drawerAdd]') && !!document.querySelector('#drawer [data-act=countIt]') && !document.querySelector('#drawer [data-act=archiveIt]') && !document.querySelector('#drawer [data-act=deleteIt]')"), J(pg, "[...document.querySelectorAll('#drawer [data-act]')].map(b => b.dataset.act)"))
    for what, js in [('the budget', "B.budget({ monthly: 1 })"), ('a storage location', "B.setSetting('locations', ['X'])"), ('the old list of people who change settings', "B.setSetting('invAdmins', ['kaylee'])"), ('the phone push', "B.setSetting('pushOn', false)"), ('a vendor’s phone', "B.patchVendor('henry-schein', { phone: '555' })")]:
        r = J(pg, js + ".then(()=>'went through', e=>e.code || e.message)")
        check('simple: the database refuses Kaylee %s' % what, 'permission' in r, r)
    switch_to(pg, 'sarah')
    check('simple: Sarah (on the old list) gets the simple view too', J(pg, "isAdmin()") is False and J(pg, "[...document.querySelectorAll('#side .navBtn')].map(b => b.dataset.v)") == ['home', 'supplies', 'cart', 'orders', 'quick'])
    r = J(pg, "B.budget({ monthly: 1 }).then(()=>'went through', e=>e.code || e.message)")
    check('simple: …and the database refuses her the budget', 'permission' in r, r)
    switch_to(pg, 'amir')
    nav = J(pg, "[...document.querySelectorAll('#side .navBtn')].map(b => b.dataset.v)")
    check('simple: Dr. A has everything (Mari’s List too, to set it up)', nav == ['home', 'supplies', 'cart', 'orders', 'quick', 'ml', 'budget', 'activity', 'vendors', 'settings'] and J(pg, "!!document.querySelector('#askFab')"), nav)
    J(pg, "go('budget')"); pg.wait_for_timeout(150)
    click(pg, '[data-act="budgetEdit"]', 300)
    J(pg, "document.querySelector('#bMonthly').value = '8500'")
    click(pg, '[data-act="budgetSave"]', 600)
    check('simple: Dr. A changes the budget', (store('nlo/budget') or {}).get('monthly') == 8500 and (store('nlo/budget') or {}).get('changedBy') == 'Dr. A', store('nlo/budget'))
    J(pg, "go('settings')"); pg.wait_for_timeout(300)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('simple: Settings has no list of people who change settings', not J(pg, "!!document.querySelector('[data-chg=adminTick]')") and 'Who can change settings' not in txt and 'Budget, Activity, Vendors and Settings are yours' in txt, txt[:600])
    check('simple: no page errors (but the refusals tried on purpose)', not [e for e in errs if 'PERMISSION_DENIED' not in e and not re.search(r'HTTP 403 .*documents:commit', e)], errs)
    ctx.close()

@test
def t_approve(b):
    """the cart: what someone else adds waits for Dr. A's OK; they order only what he OK'd; his OK is his alone"""
    ck, pk, ek = open_as(b, 'kaylee', quiet=True); ca, pa, ea = open_as(b, 'amir')
    J(pk, "cartAdd(itemById('ppe-2'), 3, {})"); settle(pk, 500)
    line = next((c for c in lines(store('nlo/cart')) if c.get('itemId') == 'ppe-2'), {})
    lid = line.get('lineId')
    check('approve: Kaylee’s line goes in, with a line id, and no OK', bool(lid) and lid not in ((get('invState/cart') or {}).get('ok') or {}), get('invState/cart'))
    J(pk, "go('cart')"); pk.wait_for_timeout(200)
    txt = J(pk, "document.querySelector('#view').textContent")
    check('approve: her cart says it waits for Dr. A’s OK, and there’s nothing to place yet', 'Waiting for Dr. A’s OK' in txt and pk.query_selector('[data-act="placeOrder"][data-v="SunSurgical"]') is None and J(pk, "!!document.querySelector('.vfoot button[disabled]')"), txt[:600])
    r = J(pk, "placeOrder('SunSurgical', placeSnap(S.D.cart.filter(c => c.itemId === 'ppe-2')), { method: 'online' }).then(()=>'went through', e=>e.message)")
    check('approve: placing it anyway is refused, and nothing changes', 'wait' in r and 'Dr. A' in r and any(c.get('itemId') == 'ppe-2' for c in lines(store('nlo/cart'))) and not [o for o in store('nlo/orders').values() if any(l.get('itemId') == 'ppe-2' for l in o.get('items') or []) and o.get('status') == 'open'], r)
    r = J(pk, "B.cart((list, ok) => { const c = list.find(x => x.itemId === 'ppe-2'); ok[c.lineId] = { by: 'Dr. A', byId: 'amir', at: nowISO(), n: 30, it: 'ppe-2' }; return list; }).then(()=>'went through', e=>e.code || e.message)")
    check('approve: an OK made up on her computer is refused by the database', 'permission' in r and lid not in ((get('invState/cart') or {}).get('ok') or {}), r)
    # Dr. A: home, the red cart, the OK button
    pa.wait_for_function("() => S.D.cart.some(c => c.itemId === 'ppe-2')", timeout=10000); J(pa, "go('home')"); pa.wait_for_timeout(200)
    check('approve: Dr. A’s Home says 2 cart lines need his OK (hers and the moved one)', '2 cart lines need your OK' in J(pa, "document.querySelector('#view').textContent"), J(pa, "document.querySelector('#view').textContent")[:300])
    check('approve: his Cart in the menu is red', J(pa, "document.querySelector('#nav-cart .cnt').classList.contains('red')"))
    J(pa, "go('cart')"); pa.wait_for_timeout(200)
    click(pa, '[data-act="cartOk"][data-line="%s"]' % lid, 700)
    okd = ((get('invState/cart') or {}).get('ok') or {}).get(lid) or {}
    check('approve: his OK is saved (who, when, how many, which supply)', okd.get('by') == 'Dr. A' and okd.get('byId') == 'amir' and okd.get('n') == 3 and okd.get('it') == 'ppe-2' and okd.get('at'), okd)
    line = next((c for c in lines(store('nlo/cart')) if c.get('itemId') == 'ppe-2'), {})
    check('approve: …and goes on the line’s trail', (line.get('trail') or [{}])[-1].get('t') == 'ok' and (line.get('trail') or [{}])[-1].get('byId') == 'amir', line.get('trail'))
    pk.wait_for_function("() => !!okOf(S.D.cart.find(c => c.itemId === 'ppe-2'))", timeout=10000); pk.wait_for_timeout(200)
    check('approve: Kaylee’s cart shows it OK’d by Dr. A', 'OK’d by Dr. A' in J(pk, "document.querySelector('#view').textContent"))
    # more than he OK'd waits again; back down to it is OK'd again
    J(pk, "cartSetQty('ppe-2', 5)"); settle(pk, 400)
    check('approve: raised to 5: waits again (he OK’d 3)', J(pk, "!okOf(S.D.cart.find(c => c.itemId === 'ppe-2'))") and 'he OK’d 3' in J(pk, "document.querySelector('#view').textContent"), J(pk, "document.querySelector('#view').textContent")[:500])
    J(pk, "cartSetQty('ppe-2', 3)"); settle(pk, 400)
    check('approve: back to 3: OK’d again', J(pk, "!!okOf(S.D.cart.find(c => c.itemId === 'ppe-2'))"))
    # another vendor, or a higher price, waits again too — and Dr. A hears of it as he does of an add
    for k in query('invAlerts'): delete('invAlerts/' + k)
    J(pk, "cartPatch('ppe-2', { price: 99 }, 'edit')"); settle(pk, 400)
    check('approve: a higher price: waits again (he OK’d it at $9.13)', J(pk, "!okOf(S.D.cart.find(c => c.itemId === 'ppe-2'))") and 'he OK’d it at $9.13' in J(pk, "document.querySelector('#view').textContent"), J(pk, "document.querySelector('#view').textContent")[:500])
    al = [x for x in query('invAlerts').values() if x.get('note') == 'changed']
    check('approve: …and an alert says the line changed, by Kaylee', len(al) == 1 and al[0].get('t') == 'cart' and al[0].get('upBy') == 'kaylee', list(query('invAlerts').values()))
    J(pk, "cartPatch('ppe-2', { price: 9.13 }, 'edit')"); settle(pk, 400)
    check('approve: back to his price: OK’d again', J(pk, "!!okOf(S.D.cart.find(c => c.itemId === 'ppe-2'))"))
    J(pk, "cartPatch('ppe-2', { vendor: 'Henry Schein' }, 'vendor')"); settle(pk, 400)
    check('approve: another vendor: waits again', J(pk, "!okOf(S.D.cart.find(c => c.itemId === 'ppe-2'))") and 'he OK’d it from SunSurgical' in J(pk, "document.querySelector('#view').textContent"))
    J(pk, "cartPatch('ppe-2', { vendor: 'SunSurgical' }, 'vendor')"); settle(pk, 400)
    # Dr. A OKs what his screen shows: a line raised just before his tap still waits
    pa.wait_for_function("() => !!okOf(S.D.cart.find(c => c.itemId === 'ppe-2'))", timeout=10000)
    J(pk, "cartAdd(itemById('adh-1'), 1, {})"); settle(pk, 400)
    pa.wait_for_function("() => S.D.cart.some(c => c.itemId === 'adh-1' && c.qty === 3)", timeout=10000)
    J(pa, "window.__seen = okSeen(S.D.cart.find(c => c.itemId === 'adh-1'))")
    J(pk, "cartSetQty('adh-1', 9)"); settle(pk, 400)
    r = J(pa, "cartApprove([window.__seen])")
    check('approve: the moved line raised to 9 just before his tap: not OK’d by it (it says it changed)', r == {'n': 0, 'changed': 1} and not J(pa, "!!okOf(S.D.cart.find(c => c.itemId === 'adh-1'))"), r)
    J(pk, "cartSetQty('adh-1', 3)"); settle(pk, 400)
    # his own add is OK'd from the start; Kaylee places what's OK'd, the rest waits
    J(pa, "cartAdd(itemById('ppe-3'), 1, {})"); settle(pa, 500)
    check('approve: Dr. A’s own add is OK’d at once', J(pa, "!!okOf(S.D.cart.find(c => c.itemId === 'ppe-3'))"))
    J(pk, "cartAdd(itemById('ppe-1'), 2, {})"); settle(pk, 500)
    pk.wait_for_function("() => S.D.cart.some(c => c.itemId === 'ppe-3')", timeout=10000); J(pk, "renderView(true)"); pk.wait_for_timeout(200)
    btn = J(pk, "(document.querySelector('[data-act=placeOrder][data-v=SunSurgical]') || {}).textContent || ''")
    check('approve: her SunSurgical button orders the 2 OK’d lines (one waits)', 'Order the 2 OK’d lines' in btn and '1 waits for Dr. A’s OK' in J(pk, "document.querySelector('#view').textContent"), btn)
    click(pk, '[data-act="placeOrder"][data-v="SunSurgical"]', 300)
    check('approve: the order she places lists only the OK’d lines', J(pk, "document.querySelector('#orderTxt').textContent.includes('Gloves Pulse Nitrile — LG') && document.querySelector('#orderTxt').textContent.includes('Gloves Nitrile Black — LG') && !document.querySelector('#orderTxt').textContent.includes('Gloves Pulse Nitrile — SM')"), J(pk, "document.querySelector('#orderTxt').textContent"))
    pk.fill('#poNum', 'OK-1'); click(pk, '[data-act="placeGo"]', 900)
    o = next((x for x in store('nlo/orders').values() if x.get('orderNumber') == 'OK-1'), {})
    check('approve: placed: her name on it, Dr. A’s OK on each line', o.get('orderedById') == 'kaylee' and sorted(l.get('itemId') for l in o.get('items') or []) == ['ppe-2', 'ppe-3'] and all((l.get('ok') or {}).get('by') == 'Dr. A' for l in o.get('items') or []), o)
    check('approve: the toast says one still waits', 'still waits for Dr. A’s OK' in toasts(pk), toasts(pk))
    cart = get('invState/cart') or {}
    check('approve: the line still waiting stays in the cart; the OKs of what was ordered came off', [c.get('itemId') for c in cart.get('lines') or [] if c.get('vendor') == 'SunSurgical'] == ['ppe-1'] and lid not in (cart.get('ok') or {}), cart)
    # OK them all
    pa.wait_for_function("() => S.D.cart.some(c => c.itemId === 'ppe-1')", timeout=10000); J(pa, "go('cart')"); pa.wait_for_timeout(200)
    click(pa, '.okBar [data-act="cartOkAll"]', 700)
    check('approve: Dr. A OKs all of them at once', J(pa, "S.D.cart.every(c => !!okOf(c))") and len((get('invState/cart') or {}).get('ok') or {}) == len(lines(store('nlo/cart'))), get('invState/cart'))
    # what's ordered is what the place-order dialog showed: more added while it's open stays in the cart, waiting
    pk.wait_for_function("() => !!okOf(S.D.cart.find(c => c.itemId === 'ppe-1'))", timeout=10000); J(pk, "go('cart')"); pk.wait_for_timeout(200)
    orig = J(pk, "S.D.cart.find(c => c.itemId === 'ppe-1').lineId")
    click(pk, '[data-act="placeOrder"][data-v="SunSurgical"]', 300)
    J(pk, "cartSetQty('ppe-1', 5)"); settle(pk, 400)
    pk.fill('#poNum', 'OK-2'); click(pk, '[data-act="placeGo"]', 900)
    o2 = next((x for x in store('nlo/orders').values() if x.get('orderNumber') == 'OK-2'), {})
    left = [c for c in lines(store('nlo/cart')) if c.get('itemId') == 'ppe-1']
    check('approve: raised while the dialog was open: the order has the 2 it showed', [(l.get('itemId'), l.get('qty')) for l in o2.get('items') or []] == [('ppe-1', 2)], o2.get('items'))
    check('approve: …the 3 more stay in the cart as a line of their own, waiting for Dr. A', len(left) == 1 and left[0].get('qty') == 3 and left[0].get('lineId') != orig and J(pk, "!okOf(S.D.cart.find(c => c.itemId === 'ppe-1'))"), left)
    check('approve: no page errors (but the refusals tried on purpose)', not [e for e in ek + ea if 'PERMISSION_DENIED' not in e and not re.search(r'HTTP 403 .*documents:commit', e)], ek + ea)
    ck.close(); ca.close()

@test
def t_push(b):
    """Dr. A's phone push (ntfy) when someone adds to the cart: the Time Clock's topic or one of its own, a test, off; the topic
    is his and the alert script's; with it on the pages leave cart adds for the script (not his own)"""
    put('meta/tcAlerts', {'emails': [], 'topic': 'nlo-clock-test1', 'route': {}, 'digest': '', 'at': NOW()})   # (the Time Clock's push is set up)
    for k in query('invAlerts'): delete('invAlerts/' + k)
    remote_field('invState/settings', 'alertsOn', False)
    ctx, pg, errs = open_as(b, 'amir')
    J(pg, "go('settings')"); pg.wait_for_function("() => S.ui.push && 'tc' in S.ui.push", timeout=10000); pg.wait_for_timeout(200)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('push: the card offers the Time Clock’s topic', 'Phone push' in txt and J(pg, "!!document.querySelector('[data-act=pushUse][data-t=\"nlo-clock-test1\"]')"), txt[:800])
    click(pg, '[data-act="pushUse"][data-t="nlo-clock-test1"]', 700)
    check('push: on, with the Time Clock’s topic', (get('invState/push') or {}).get('topic') == 'nlo-clock-test1' and (store('nlo/settings') or {}).get('pushOn') is True and (get('invState/push') or {}).get('upBy') == 'amir', (get('invState/push'), store('nlo/settings')))
    pg.wait_for_timeout(200)
    check('push: the card says so (nothing new on the phone)', 'the Time Clock’s: nothing new on your phone' in J(pg, "document.querySelector('#view').textContent"))
    click(pg, '[data-act="pushTest"]', 600)
    check('push: Send a test push asks the alert script for one', (get('invState/push') or {}).get('test', 0) > 0 and 'Asked' in toasts(pg), get('invState/push'))
    # his own cart add: no alert; Gwen's: an alert for the script to push (the email alerts are off)
    J(pg, "cartAdd(itemById('ppe-2'), 1, {})"); settle(pg, 500)
    check('push: Dr. A’s own add leaves nothing to send', len(query('invAlerts')) == 0, query('invAlerts'))
    c2, p2, e2 = open_as(b, 'gwen', quiet=True)
    J(p2, "cartAdd(itemById('ppe-1'), 2, {})"); settle(p2, 500)
    al = list(query('invAlerts').values())
    check('push: Gwen’s add leaves one for the script, with her id', len(al) == 1 and al[0].get('t') == 'cart' and al[0].get('upBy') == 'gwen', al)
    J(p2, "receiveOrder('order-old1', {})"); settle(p2, 600)
    check('push: …but not her receipt (the email alerts are off)', len(query('invAlerts')) == 1, list(query('invAlerts').values()))
    r = J(p2, "B.getPush().then(()=>'went through', e=>e.code || e.message)")
    check('push: Gwen can’t read the topic', 'permission' in r, r)
    r = J(p2, "B.setPush('gwens-topic').then(()=>'went through', e=>e.code || e.message)")
    check('push: …or set one', 'permission' in r, r)
    c2.close()
    click(pg, '[data-act="pushOff"]', 600)
    check('push: Turn off: off, the topic kept for next time', (store('nlo/settings') or {}).get('pushOn') is False and (get('invState/push') or {}).get('topic') == 'nlo-clock-test1')
    pg.wait_for_timeout(200)
    click(pg, '[data-act="pushNew"]', 700)
    t = (get('invState/push') or {}).get('topic') or ''
    check('push: a topic of its own', re.match(r'^nlo-inv-[0-9a-f]{20}$', t) is not None and (store('nlo/settings') or {}).get('pushOn') is True, t)
    pg.wait_for_timeout(200)
    check('push: the card says to subscribe to it in the ntfy app', 'subscribe to this topic' in J(pg, "document.querySelector('#view').textContent") and t in J(pg, "document.querySelector('#view').textContent"))
    check('push: the email card says cart adds come as a push', 'cart adds come as a push' in J(pg, "document.querySelector('#view').textContent"))
    check('push: no page errors', not errs and not [e for e in e2 if 'PERMISSION_DENIED' not in e and not re.search(r'HTTP 403', e)], errs + e2)
    ctx.close()

@test
def t_offline(b):
    ctx, pg, errs = open_as(b, 'gwen')
    ctx.set_offline(True); pg.wait_for_timeout(400)
    check('offline: sync line says so', 'Offline' in J(pg, "document.querySelector('#syncLine').textContent"), J(pg, "document.querySelector('#syncLine').textContent"))
    check('offline: a banner says what waits for the internet', 'need the internet' in J(pg, "document.querySelector('#bannerSlot').textContent"), J(pg, "document.querySelector('#bannerSlot').textContent"))
    t0 = time.time()
    r = J(pg, "stockStep(itemById('adh-1'), -1, 'use').then(()=>'went through', e=>errText(e))")
    check('offline: a stock step says it can’t reach the database (at once)', 'Can’t reach' in r and time.time() - t0 < 3, (r, time.time() - t0))
    check('offline: nothing changed', store('nlo/items/adh-1')['qty'] == 4)
    ctx.set_offline(False); pg.wait_for_timeout(1500)
    J(pg, "stockStep(itemById('adh-1'), -1, 'use')"); settle(pg, 500)
    check('online: the step goes through', store('nlo/items/adh-1')['qty'] == 3, store('nlo/items/adh-1')['qty'])
    lg = [e for e in store('nlo/log').values() if e.get('type') == 'use' and e.get('itemId') == 'adh-1']
    check('use: logged with who', lg and lg[0].get('by') == 'Gwen R.' and lg[0].get('delta') == -1, lg)
    check('offline: no page errors', not [e for e in errs if 'net::ERR_INTERNET_DISCONNECTED' not in e and 'Could not reach Cloud Firestore' not in e and 'ERR_' not in e], errs)
    ctx.close()

@test
def t_phone(b):
    ctx, pg, errs = open_as(b, 'amir', w=390, h=844)
    for v in ['home', 'supplies', 'cart', 'orders', 'quick', 'ml', 'budget', 'activity', 'vendors', 'settings']:
        J(pg, "go('%s')" % v); pg.wait_for_timeout(150)
        ow = J(pg, "document.documentElement.scrollWidth > window.innerWidth + 1")
        check('phone: no sideways scroll on ' + v, not ow, J(pg, "[document.documentElement.scrollWidth, window.innerWidth]"))
    check('phone: no page errors (Dr. A)', not errs, errs); ctx.close()
    ctx, pg, errs = open_as(b, 'gwen', w=390, h=844)
    check('phone: Gwen’s menu is the simple one', J(pg, "[...document.querySelectorAll('#mobNav .navBtn')].map(b => b.dataset.v)") == ['home', 'supplies', 'cart', 'orders', 'quick'], J(pg, "[...document.querySelectorAll('#mobNav .navBtn')].map(b => b.dataset.v)"))
    for v in ['home', 'cart', 'orders']:
        J(pg, "go('%s')" % v); pg.wait_for_timeout(150)
        check('phone (Gwen): no sideways scroll on ' + v, not J(pg, "document.documentElement.scrollWidth > window.innerWidth + 1"))
    J(pg, "ACT.who()"); pg.wait_for_timeout(200)
    check('phone: the avatar shows who and Lock', 'Gwen Reed' in J(pg, "document.querySelector('#modalWrap').textContent") and J(pg, "!!document.querySelector('#modalWrap [data-act=lock]')"))
    check('phone: no page errors', not errs, errs)
    ctx.close()

GEM = {'reply': None}
def gemini_route(route):
    body = {'candidates': [{'content': {'parts': [{'text': json.dumps(GEM['reply'])}]}, 'finishReason': 'STOP'}]}
    route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
TINY = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
def slip_scan(pg, order_id=None):
    J(pg, "openSlipScanner(%s)" % (json.dumps(order_id) if order_id else 'null')); pg.wait_for_timeout(600)
    J(pg, "S.ui.slip.pages.push({url: %s, text: ''}); renderSlip()" % json.dumps(TINY)); pg.wait_for_timeout(200)
    click(pg, '[data-act="slRead"]', 300)
    pg.wait_for_function("() => S.ui.slip && S.ui.slip.step === 'review'", timeout=8000); pg.wait_for_timeout(200)

@test
def t_slip_open_order(b):
    ctx, pg, errs = open_as(b, 'gwen')
    ctx.route(re.compile(r'https://generativelanguage\.googleapis\.com/.*'), gemini_route)
    GEM['reply'] = {'document': {'vendorName': 'Henry Schein', 'invoiceNumber': 'HS-77', 'orderNumber': ''}, 'items': [{'name': 'TRANSBOND XT REFILL SYR', 'sku': '1012345', 'vendor': 'CETYLI', 'price': 38.5, 'qty': 2, 'slipUnit': 'EA'}]}
    q0 = store('nlo/items/adh-1')['qty']
    slip_scan(pg)
    U = J(pg, "({vendor: S.ui.slip.vendor, match: S.ui.slip.match, rows: S.ui.slip.rows.map(r => [r.itemId, r.matchType, r.qty, r.price])})")
    check('slip A: matched the open Henry Schein order', U['match']['orderId'] == 'abc123' and U['vendor'] == 'Henry Schein', U)
    check('slip A: line matched by SKU', U['rows'] and U['rows'][0][0] == 'adh-1' and U['rows'][0][1] == 'sku', U['rows'])
    J(pg, "document.querySelector('#slShip').value = '9.95'; INP.slMoneyInp()")
    click(pg, '[data-act="slGo"]', 1500)
    o = store('nlo/orders/abc123'); q1 = store('nlo/items/adh-1')['qty']
    check('slip A: order received, by Gwen, invoice #', o.get('status') == 'received' and o.get('receivedBy') == 'Gwen R.' and o.get('invoiceNumber') == 'HS-77' and o.get('receiveMethod') == 'scan', {k: o.get(k) for k in ['status', 'receivedBy', 'invoiceNumber', 'receiveMethod']})
    check('slip A: the slip photo kept as a photo record', str(o.get('slipPhoto', '')).startswith('pic:') and get('invPics/' + str(o.get('slipPhoto', '')).replace('pic:', '')) is not None, o.get('slipPhoto'))
    check('slip A: +2 syringes', q1 - q0 == 2, (q0, q1))
    logs = [e for e in store('nlo/log').values() if e.get('orderId') == 'abc123']
    rec = [e for e in logs if e['type'] == 'receive']
    check('slip A: receipt carries the order and the slip price', len(rec) == 1 and abs(rec[0]['amount'] - 77) < 0.001 and rec[0]['delta'] == 2, rec)
    check('slip A: shipping once', len([e for e in logs if e['type'] == 'shipping']) == 1)
    bo = [x for x in store('nlo/orders').values() if x.get('backorderOf') == 'abc123']
    check('slip A: backorder for the line that didn\'t come', len(bo) == 1 and bo[0]['items'][0]['name'] == 'Shipping box', bo)
    srcs = store('nlo/items/adh-1')['sources']
    hs = [x for x in srcs if x.get('vendor') == 'Henry Schein']
    check('slip A: Henry Schein price remembered, no CETYLI vendor', hs and abs(hs[0]['price'] - 38.5) < 0.001 and not any('CETYLI' in str(x.get('vendor')) for x in srcs), srcs)
    J(pg, "go('orders'); openDrawer('order', 'abc123')"); pg.wait_for_timeout(900)
    check('slip A: the order shows its packing slip', J(pg, "[...document.querySelectorAll('#drawer img')].some(i => /^blob:/.test(i.src))"))
    check('slip A: no page errors', not errs, errs)
    ctx.close()

@test
def t_slip_no_order(b):
    ctx, pg, errs = open_as(b, 'kaylee')
    ctx.route(re.compile(r'https://generativelanguage\.googleapis\.com/.*'), gemini_route)
    GEM['reply'] = {'document': {'vendorName': 'Benco Dental', 'invoiceNumber': 'B-9', 'accountId': 'BEN-555'}, 'items': [
        {'name': 'Pulse Nitrile Glove LG', 'sku': '177302', 'price': 92, 'qty': 1, 'slipUnit': 'CS', 'packQty': 10},
        {'name': 'Brand New Widget', 'sku': 'NW-1', 'price': 5, 'qty': 4, 'slipUnit': 'EA'}]}
    q0 = store('nlo/items/ppe-2')['qty']
    slip_scan(pg)
    U = J(pg, "({match: S.ui.slip.match, rows: S.ui.slip.rows.map(r => [r.itemId, r.matchType, r.isNew, r.qty, r.newName])})")
    check('slip B: no open order picked', not U['match']['orderId'], U)
    check('slip B: gloves 1 case = 10 boxes; widget new', U['rows'][0][0] == 'ppe-2' and U['rows'][0][3] == '10' and U['rows'][1][2] is True, U['rows'])
    click(pg, '[data-act="slGo"]', 1800)
    q1 = store('nlo/items/ppe-2')['qty']
    check('slip B: +10 boxes', q1 - q0 == 10, (q0, q1))
    orders = [o for o in store('nlo/orders').values() if o.get('invoiceNumber') == 'B-9']
    check('slip B: filed as a received order', len(orders) == 1 and orders[0]['status'] == 'received' and orders[0]['vendor'] == 'Benco Dental' and orders[0].get('countUpdated') is True, orders)
    items = store('nlo/items'); widget = [i for i in items.values() if i.get('name') == 'Brand New Widget']
    check('slip B: new supply made, with its 4 in stock', len(widget) == 1 and widget[0]['qty'] == 4 and widget[0]['sources'][0]['vendor'] == 'Benco Dental', widget)
    if orders:
        logs = [e for e in store('nlo/log').values() if e.get('orderId') == orders[0]['id']]
        check('slip B: both lines booked to the budget', sorted(round(e['amount'], 2) for e in logs if e['type'] == 'receive') == [20.0, 92.0], [(e['type'], e.get('amount')) for e in logs])
    vs = [v for v in store('nlo/vendors').values() if v.get('name') == 'Benco Dental']
    check('slip B: vendor made, account # saved', vs and vs[0].get('acct') in (None, 'BEN-555'), vs)
    check('slip B: no page errors', not errs, errs)
    ctx.close()

@test
def t_slip_already_received(b):
    delete('invOrders/abc123'); delete('invOrders/order-old1')
    ctx, pg, errs = open_as(b, 'gwen')
    ctx.route(re.compile(r'https://generativelanguage\.googleapis\.com/.*'), gemini_route)
    GEM['reply'] = {'document': {'vendorName': 'American Orthodontics', 'invoiceNumber': 'AO-123'}, 'items': [{'name': 'Transbond XT', 'sku': '712-035', 'price': 42, 'qty': 3, 'slipUnit': 'EA'}]}
    q0 = store('nlo/items/adh-1')['qty']
    slip_scan(pg)
    U = J(pg, "S.ui.slip.match")
    check('slip C: found the received AO order', U.get('recvId') == 'order-r1' and not U.get('orderId'), U)
    click(pg, '[data-act="slGo"]', 1500)
    o = store('nlo/orders/order-r1'); q1 = store('nlo/items/adh-1')['qty']
    check('slip C: stock not counted again', q1 == q0, (q0, q1))
    check('slip C: invoice # and price updated', o.get('invoiceNumber') == 'AO-123' and abs(o['items'][0]['price'] - 42) < 0.001, o)
    logs = [e for e in store('nlo/log').values() if e.get('orderId') == 'order-r1']
    check('slip C: no new receipt, shipping not doubled', len([e for e in logs if e['type'] == 'receive']) == 1 and len([e for e in logs if e['type'] == 'shipping']) == 1, [(e['type'], e.get('amount')) for e in logs])
    check('slip C: no page errors', not errs, errs)
    ctx.close()

@test
def t_editor(b):
    ctx, pg, errs = open_as(b, 'gwen')
    J(pg, "go('supplies'); openEditor('ppe-2')"); pg.wait_for_timeout(300)
    J(pg, "document.querySelector('#edBig').checked = true; document.querySelector('#edBig').dispatchEvent(new Event('change', {bubbles: true}))"); pg.wait_for_timeout(200)
    price = J(pg, "document.querySelector('[data-ed=\"price\"][data-k=\"0\"]').value")
    check('editor: switching to cases turns $9.13/box into $91.30/case', price == '91.30', price)
    J(pg, "document.querySelector('#edMin').value = '0'")
    remote_field('invItems/ppe-2', 'qty', 99); pg.wait_for_timeout(500)
    click(pg, '[data-act="edSave"]', 900)
    it = store('nlo/items/ppe-2')
    check('editor: saved as bought by the case of 10', it.get('buyUnit') == 'case' and it.get('perBuy') == 10 and it.get('unit') == 'box', {k: it.get(k) for k in ['buyUnit', 'perBuy', 'unit']})
    check('editor: price kept per box', abs(it['sources'][0]['price'] - 9.13) < 0.0001 and it['sources'][0]['vendor'] == 'SunSurgical', it.get('sources'))
    check('editor: legacy flat fields left alone', it.get('price') == 9.13 and it.get('src') == 'https://www.sunsurgical.com', {k: it.get(k) for k in ['price', 'src']})
    check('editor: min 0 stays 0', it.get('min') == 0, it.get('min'))
    check('editor: count changed elsewhere meanwhile is kept', it.get('qty') == 99, it.get('qty'))
    check('editor: stamped', it.get('updatedBy') == 'Gwen R.' and it.get('updatedAt'), {k: it.get(k) for k in ['updatedBy', 'updatedAt']})
    J(pg, "openEditor(null)"); pg.wait_for_timeout(300)
    J(pg, "document.querySelector('#edName').value = 'Masks Level 3'; document.querySelector('#edUnit').value = 'box'; document.querySelector('#edQty').value = '6'; document.querySelector('[data-ed=\"vendor\"][data-k=\"0\"]').value = 'Brand New Vendor'; document.querySelector('[data-ed=\"price\"][data-k=\"0\"]').value = '12.5'")
    # a photo for it, as the editor makes one (a small JPEG)
    J(pg, "Object.assign(S.ui.ed.photo, { thumb: %s, full: %s, changed: true })" % (json.dumps(TINY), json.dumps(TINY)))
    click(pg, '[data-act="edSave"]', 1200)
    its = [i for i in store('nlo/items').values() if i.get('name') == 'Masks Level 3']
    check('editor: new supply saved with its count', len(its) == 1 and its[0]['qty'] == 6 and its[0]['id'].startswith('custom-') and its[0].get('createdBy') == 'Gwen R.', its)
    if its:
        check('editor: its photo is a photo record of its own', str(its[0].get('img', '')).startswith('pic:') and get('invPics/' + its[0]['img'][4:]) is not None, its[0].get('img'))
    vs = [v for v in store('nlo/vendors').values() if v.get('name') == 'Brand New Vendor']
    check('editor: new vendor added to the list', len(vs) == 1, vs)
    lg = [e for e in store('nlo/log').values() if its and e.get('itemId') == its[0]['id']]
    check('editor: starting count logged', lg and lg[0]['type'] == 'count' and lg[0]['delta'] == 6, lg)
    check('editor: no page errors', not errs, errs)
    ctx.close()

@test
def t_cases(b):
    """gloves set up as cases from Settings; a cart line and an open order made before that are put right"""
    ctx, pg, errs = open_as(b, 'kaylee')
    J(pg, "cartAdd(itemById('ppe-1'), 2, {})"); settle(pg)
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    check('case helper: it’s in Settings, which isn’t Kaylee’s', J(pg, "S.view") == 'home' and not J(pg, "!!document.querySelector('[data-act=caseApply]')"))
    switch_to(pg, 'amir')
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    ids = J(pg, "[...document.querySelectorAll('[data-case]')].map(i => i.dataset.case)")
    check('case helper: lists the gloves still bought by the box', sorted(ids) == ['ppe-1', 'ppe-2'], ids)
    check('case helper: names the one already set up', 'Gloves Nitrile Black' in J(pg, "document.querySelector('#view').textContent"))
    click(pg, '[data-act="caseApply"]', 1000)
    i1 = store('nlo/items/ppe-1'); i2 = store('nlo/items/ppe-2')
    check('case helper: both bought by the case of 10, counted in boxes', all(i.get('buyUnit') == 'case' and i.get('perBuy') == 10 and i.get('unit') == 'box' for i in (i1, i2)), [{k: i.get(k) for k in ['buyUnit', 'perBuy', 'unit']} for i in (i1, i2)])
    s1 = (i1.get('sources') or [{}])[0]; s2 = (i2.get('sources') or [{}])[0]
    check('case helper: prices stay per box', abs((s1.get('price') or 0) - 9.13) < 1e-6 and abs((s2.get('price') or 0) - 9.13) < 1e-6 and s2.get('vendor') == 'SunSurgical', [s1, s2])
    check('case helper: counts untouched, stamped by Dr. A', i1.get('qty') == 14 and i2.get('qty') == 6 and i1.get('updatedBy') == 'Dr. A', {k: i1.get(k) for k in ['qty', 'updatedBy']})
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    check('case helper: nothing left to set up', J(pg, "document.querySelectorAll('[data-case]').length") == 0)
    J(pg, "go('cart')"); pg.wait_for_timeout(200)
    check('cart: line added in boxes is flagged', J(pg, "!!document.querySelector('.oldUnit [data-act=\"cartToCases\"][data-id=\"ppe-1\"]')"))
    click(pg, '.oldUnit [data-act="cartToCases"][data-id="ppe-1"]', 300)
    check('cart: offers 2 cases', J(pg, "document.querySelector('#cbVal') && document.querySelector('#cbVal').value") == '2', J(pg, "document.querySelector('#cbVal') && document.querySelector('#cbVal').value"))
    click(pg, '#cbYes', 800)
    cart = lines(store('nlo/cart'))
    l1 = next((c for c in cart if c.get('itemId') == 'ppe-1'), {})
    check('cart: now 2 cases of 10 at $91.30', l1.get('qty') == 2 and l1.get('unit') == 'case' and l1.get('per') == 10 and l1.get('countUnit') == 'box' and abs((l1.get('price') or 0) - 91.3) < 1e-6, l1)
    check('cart: change stamped', any(t.get('t') == 'unit' and t.get('by') == 'Dr. A' for t in (l1.get('trail') or [])), l1.get('trail'))
    J(pg, "go('cart')"); pg.wait_for_timeout(200)
    check('cart: flag gone', not J(pg, "!!document.querySelector('.oldUnit')"))
    q0 = store('nlo/items/ppe-1')['qty']
    J(pg, "go('orders')"); pg.wait_for_timeout(200)
    J(pg, "document.querySelector('[data-act=\"receive\"][data-id=\"order-old1\"]').click()"); pg.wait_for_timeout(300)
    check('receive: offers “came as cases”', J(pg, "!!document.querySelector('[data-rc=\"cases\"][data-k=\"0\"]')"))
    J(pg, "const cb = document.querySelector('[data-rc=\"cases\"][data-k=\"0\"]'); cb.checked = true; cb.dispatchEvent(new Event('change', {bubbles: true}))"); pg.wait_for_timeout(200)
    check('receive: says cases = 20 boxes, price per case', '20 boxes' in J(pg, "document.querySelector('#rcEq0').textContent") and J(pg, "document.querySelector('[data-rc=\"price\"][data-k=\"0\"]').placeholder") == '91.30', [J(pg, "document.querySelector('#rcEq0').textContent"), J(pg, "document.querySelector('[data-rc=\"price\"][data-k=\"0\"]').placeholder")])
    check('receive: not called short', 'came short' not in J(pg, "document.querySelector('#rcTot').textContent"))
    click(pg, '[data-act="rcGo"]', 1000)
    o = store('nlo/orders/order-old1'); q1 = store('nlo/items/ppe-1')['qty']
    check('receive as cases: +20 boxes', q1 - q0 == 20, (q0, q1))
    ln = (o.get('items') or [{}])[0]
    check('receive as cases: line is 2 cases, was ordered as 2 boxes', ln.get('unit') == 'case' and ln.get('per') == 10 and ln.get('qty') == 2 and ln.get('orderedAs') == '2 boxes' and not ln.get('orderedQty'), ln)
    rec = [e for e in store('nlo/log').values() if e.get('orderId') == 'order-old1' and e['type'] == 'receive']
    check('receive as cases: $182.60 booked, 20 boxes', len(rec) == 1 and abs(rec[0]['amount'] - 182.6) < 0.001 and rec[0]['delta'] == 20, rec)
    check('receive as cases: no backorder', not [x for x in store('nlo/orders').values() if x.get('backorderOf') == 'order-old1'])
    check('receive as cases: price kept per box', abs(store('nlo/items/ppe-1')['sources'][0]['price'] - 9.13) < 1e-6, store('nlo/items/ppe-1')['sources'])
    check('cases: no page errors', not errs, errs)
    ctx.close()

@test
def t_case_price_was_case(b):
    """“the saved prices are for a whole case”: $91.30 saved per box becomes $9.13 a box"""
    it = get('invItems/ppe-1'); it['sources'][0]['price'] = 91.3; put('invItems/ppe-1', it); delete('invItems/ppe-2')
    ctx, pg, errs = open_as(b, 'amir')
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    J(pg, "document.querySelector('#caseWasCase').checked = true")
    click(pg, '[data-act="caseApply"]', 1000)
    i1 = store('nlo/items/ppe-1')
    check('was-case: price now per box', abs(i1['sources'][0]['price'] - 9.13) < 1e-6 and i1.get('perBuy') == 10, i1.get('sources'))
    check('was-case: no page errors', not errs, errs)
    ctx.close()

@test
def t_close_ask(b):
    """closing a dialog with unsaved work asks inside the dialog (no browser pop-up); an untouched one just closes"""
    ctx, pg, errs = open_as(b, 'amir')   # (an order typed in by hand is Dr. A's)
    J(pg, "go('orders')"); pg.wait_for_timeout(150)
    J(pg, "ACT.orderNew()"); pg.wait_for_timeout(250)
    click(pg, '.mFt [data-act="closeModal"]', 250)
    check('ask: untouched new order just closes', not J(pg, "!!document.querySelector('#modalWrap')"))
    J(pg, "ACT.orderNew()"); pg.wait_for_timeout(250)
    pg.fill('#oeVendor', 'SunSurgical')
    click(pg, '.mFt [data-act="closeModal"]', 250)
    check('ask: typed-in order asks first, inside the dialog', J(pg, "!!document.querySelector('#modalWrap .askClose')"))
    click(pg, '[data-ask="keep"]', 200)
    check('ask: keep working keeps it open', J(pg, "!!document.querySelector('#modalWrap') && !document.querySelector('.askClose') && document.querySelector('#oeVendor').value === 'SunSurgical'"))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('ask: Escape asks too', J(pg, "!!document.querySelector('#modalWrap .askClose')"))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('ask: Escape again takes the question away', J(pg, "!!document.querySelector('#modalWrap') && !document.querySelector('.askClose')"))
    click(pg, '.mFt [data-act="closeModal"]', 250)
    click(pg, '[data-ask="close"]', 250)
    check('ask: close it closes', not J(pg, "!!document.querySelector('#modalWrap')"))
    J(pg, "go('supplies'); openEditor('adh-1')"); pg.wait_for_timeout(300)
    pg.fill('#edName', 'Transbond XT Syringe 4g')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('ask: supply editor with a change asks', J(pg, "!!document.querySelector('#modalWrap .askClose')"))
    click(pg, '[data-ask="close"]', 250)
    check('ask: nothing saved', store('nlo/items/adh-1')['name'] == 'Transbond XT Syringe' and not J(pg, "!!document.querySelector('#modalWrap')"))
    check('ask: no page errors (and no browser pop-ups)', not errs, errs)
    ctx.close()

@test
def t_quick_prices(b):
    """quick-order prices save for everyone now (the old database refused them); elastics still go in the cart"""
    ctx, pg, errs = open_as(b, 'gwen')
    J(pg, "go('quick')"); pg.wait_for_timeout(200)
    check('quick: no “can’t be saved” note any more', 'can’t be saved yet' not in J(pg, "document.querySelector('#view').textContent"))
    J(pg, "B.setElastoPrice('854-100', 3.25)"); settle(pg)
    check('quick: a price saved for every computer', abs(((store('nlo/elastoPrices') or {}).get('854-100') or {}).get('price', 0) - 3.25) < 1e-6, store('nlo/elastoPrices'))
    J(pg, "ACT.qBump({ dataset: { k: 'Silver', n: '1' } })"); pg.wait_for_timeout(150)
    J(pg, "ACT.qAdd(document.querySelector('[data-act=\"qAdd\"]'))"); settle(pg, 600)
    cart = lines(store('nlo/cart'))
    check('quick: elastics go in the cart', any(str(c.get('itemId', '')).startswith('elasto-') and c.get('cat') == 'elastics' and c.get('addedBy') == 'Gwen R.' for c in cart), cart)
    check('quick: no page errors', not errs, errs)
    ctx.close()

@test
def t_alerts(b):
    """the cart, order and receiving emails: left in the database for the alert script, only while they're on"""
    ctx, pg, errs = open_as(b, 'gwen')
    for k in query('invAlerts'): delete('invAlerts/' + k)
    J(pg, "cartAdd(itemById('ppe-2'), 1, {})"); settle(pg, 500)
    al = list(query('invAlerts').values())
    check('alerts: a cart add leaves one, by Gwen', len(al) == 1 and al[0].get('t') == 'cart' and al[0].get('by') == 'Gwen R.' and al[0].get('upBy') == 'gwen', al)
    J(pg, "B.setSetting('alertsOn', false).then(()=>'ok', e=>e.code)"); settle(pg)
    check('alerts: Gwen can’t turn them off', (store('nlo/settings') or {}).get('alertsOn') is True)
    switch_to(pg, 'amir')
    J(pg, "go('settings')"); pg.wait_for_timeout(300)
    check('alerts: Dr. A sees the switch and “Get the alert script”', J(pg, "!!document.querySelector('[data-act=alertsToggle]') && !!document.querySelector('[data-act=alertScript]')"))
    click(pg, '[data-act="alertsToggle"]', 600)
    check('alerts: Dr. A turns them off', (store('nlo/settings') or {}).get('alertsOn') is False)
    J(pg, "cartAdd(itemById('ppe-1'), 1, {})"); settle(pg, 500)
    check('alerts: none left while off', len(query('invAlerts')) == 1, list(query('invAlerts').values()))
    click(pg, '[data-act="alertsToggle"]', 600)
    check('alerts: back on', (store('nlo/settings') or {}).get('alertsOn') is True)
    check('alerts: no page errors (but the refusal tried on purpose)', not [e for e in errs if 'PERMISSION_DENIED' not in e and not re.search(r'HTTP 403 .*documents:commit', e)], errs)
    ctx.close()

@test
def t_alert_script(b):
    """Dr. A gets the alert script: a login of its own is made, and the copied script carries it"""
    remote_field('invState/settings', 'alertsOn', False)   # (as the move leaves them)
    ctx, pg, errs = open_as(b, 'amir')
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin='http://127.0.0.1:%d' % PORT)
    J(pg, "go('settings')"); pg.wait_for_timeout(300)
    check('script: before it’s set up, the card says getting it turns the alerts on', 'getting it turns the alerts on' in J(pg, "document.querySelector('#view').textContent"))
    click(pg, '[data-act="alertScript"]', 2500)
    check('script: the first one turns the alerts on', (store('nlo/settings') or {}).get('alertsOn') is True)
    code = J(pg, "navigator.clipboard.readText()")
    m = re.search(r'var CONFIG = (\{.*?\});', code or '')
    cfg = json.loads(m.group(1)) if m else {}
    check('script: copied, with its own login filled in', cfg.get('botEmail', '').startswith('inv-alerts-') and len(cfg.get('botPassword', '')) >= 20 and cfg.get('projectId') == P, {k: v for k, v in cfg.items() if k != 'botPassword'})
    bots = query('invBots')
    check('script: its login is on the list (one)', len(bots) == 1 and list(bots.values())[0].get('email') == cfg.get('botEmail'), bots)
    (WWW / 'last-script.gs').write_text(code or '')
    # the copied script, run as Dr. A would after pasting it (setup): its own login reads Inventory and copies it to the old database
    r = subprocess.run(['node', str(HERE / 'run_script.js'), str(WWW / 'last-script.gs')], capture_output=True, text=True, timeout=120)
    out = json.loads(r.stdout or '{}') if r.returncode == 0 else {'error': r.stderr[-500:]}
    check('script: the copied script’s setup runs (its login, the rules, the old database)', not out.get('error') and (out.get('result') or {}).get('moved') is True and len(out.get('triggers') or []) == 1, out.get('error') or out.get('logs'))
    check('script: it copied the supplies to the old database for Staff Meeting and AISA', (rt('GET', '/nlo/items/ppe-1')[1] or {}).get('qty') == 14 and 'up' not in (rt('GET', '/nlo/items/ppe-1')[1] or {}), rt('GET', '/nlo/items/ppe-1')[1])
    click(pg, '[data-act="alertScript"]', 2500); click(pg, '[data-act="alertScript"]', 2500)
    bots = query('invBots')
    check('script: getting it twice more keeps two logins: the newest and the one running (it checked in), not the one in between', len(bots) == 2 and any(v.get('email') == cfg.get('botEmail') for v in bots.values()), list(bots.values()))
    check('script: no page errors', not errs, errs)
    ctx.close()

@test
def t_stamps(b):
    """the names on the steps are the people who took them: the database holds everyone to it, and the screens show the person
    behind the id; received orders keep their numbers; vendors' websites; a voided order back for the people who void"""
    ctx, pg, errs = open_as(b, 'gwen', quiet=True)
    mon = J(pg, "monthKey(Date.now())")
    r = J(pg, "FB.save(b => b.set(FB.logRef(%s, 'sarah'), Object.assign({ e: { zz0: { id: 'zz0', type: 'use', itemId: 'ppe-1', delta: -1, date: nowISO(), by: 'Sarah B.', byId: 'sarah' } }, mon: %s, who: 'sarah' }, FB.st()), { merge: true })).then(()=>'went through', e=>e.code || e.message)" % (json.dumps(mon), json.dumps(mon)))
    check('stamps: Gwen can’t add to Sarah’s activity log', 'permission' in r, r)
    r = J(pg, "FB.save(b => b.set(FB.logRef(%s, 'gwen'), Object.assign({ e: { zz1: { id: 'zz1', type: 'use', itemId: 'ppe-1', itemName: 'Gloves Pulse Nitrile — SM', delta: -1, date: nowISO(), by: 'Sarah B.', byId: 'sarah' } }, mon: %s, who: 'gwen' }, FB.st()), { merge: true })).then(()=>'went through', e=>e.code || e.message)" % (json.dumps(mon), json.dumps(mon)))
    settle(pg, 400)
    e = store('nlo/log').get('zz1') or {}
    check('stamps: an entry Gwen saves goes in her own record, whatever name it carries — and counts as hers', r == 'went through' and e.get('byId') == 'gwen' and J(pg, "(S.D.log.find(x => x.id === 'zz1') || {}).byId") == 'gwen', (r, e))
    r = J(pg, "B.patchOrder('order-old1', { trail: trailAdd(orderById('order-old1').trail, 'edited', { by: 'Sarah B.', byId: 'sarah', at: nowISO() }) }).then(()=>'went through', e=>e.code || e.message)")
    check('stamps: an order step in someone else’s name is refused', 'permission' in r, r)
    J(pg, "editOrder('order-old1', { note: 'Leave at the back door' }, 'note')"); settle(pg, 400)
    o = store('nlo/orders/order-old1') or {}
    check('stamps: her own step on it goes in', o.get('note') == 'Leave at the back door' and (o.get('trail') or [{}])[-1].get('byId') == 'gwen', o.get('trail'))
    r = J(pg, "B.patchOrder('order-old1', { trail: [] }).then(()=>'went through', e=>e.code || e.message)")
    check('stamps: wiping an order’s trail is refused', 'permission' in r, r)
    r = J(pg, "B.patchOrder('abc123', { status: 'received', receivedBy: 'Sarah B.' }).then(()=>'went through', e=>e.code || e.message)")
    check('received: staff can’t mark an order received without their own id and step', 'permission' in r and (store('nlo/orders/abc123') or {}).get('status') == 'open', r)
    # a received order: everyone else only adds its paperwork
    J(pg, "receiveOrder('order-old1', {})"); settle(pg, 600)
    r = J(pg, "B.patchOrder('order-old1', { discount: 5 }).then(()=>'went through', e=>e.code || e.message)")
    check('received: Gwen can’t change its discount', 'permission' in r, r)
    r = J(pg, "B.patchOrder('order-old1', { receivedBy: 'Kaylee D.', receivedById: 'kaylee' }).then(()=>'went through', e=>e.code || e.message)")
    check('received: …or who received it', 'permission' in r, r)
    r = J(pg, "B.patchOrder('order-old1', { invoiceNumber: 'INV-77', trail: trailAdd(orderById('order-old1').trail, 'invoice', stamp()) }).then(()=>'went through', e=>e.code || e.message)")
    check('received: she adds the invoice number', r == 'went through' and (store('nlo/orders/order-old1') or {}).get('invoiceNumber') == 'INV-77', r)
    # vendors: a built-in vendor's website, phone or email are for the people Dr. A picked; a new one is just a name
    r = J(pg, "B.patchVendor('henry-schein', { portal: 'https://example.com/look-alike' }).then(()=>'went through', e=>e.code || e.message)")
    check('vendors: Gwen can’t give a built-in vendor a website', 'permission' in r, r)
    r = J(pg, "B.putVendor({ id: 'v-new1', name: 'Corner Store', portal: 'https://example.com' }).then(()=>'went through', e=>e.code || e.message)")
    check('vendors: …or a new one', 'permission' in r, r)
    r = J(pg, "B.putVendor({ id: 'v-new2', name: 'Corner Store' }).then(()=>'went through', e=>e.code || e.message)")
    check('vendors: she adds a new vendor by name', r == 'went through', r)
    remote('invVendors/v-odd', {'id': 'v-odd', 'name': 'Odd Vendor', 'portal': 'javascript:alert(1)'})
    # voiding, and bringing a voided order back: Dr. A's
    r = J(pg, "voidOrder('abc123', 'test').then(()=>'went through', e=>e.code || e.message)")
    check('voided: Gwen can’t void an order (the database)', 'permission' in r, r)
    switch_to(pg, 'amir')
    J(pg, "go('activity')"); pg.wait_for_timeout(300)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('stamps: Activity shows Gwen’s name on her entry', 'Gwen R. used' in txt and 'Sarah B. used' not in txt, txt[:500])
    J(pg, "go('vendors')"); pg.wait_for_timeout(300)
    check('vendors: a website that isn’t a web address isn’t a link', J(pg, "![...document.querySelectorAll('#view a[href]')].some(a => /^javascript:/i.test(a.getAttribute('href')))") and 'javascript:alert(1)' in J(pg, "document.querySelector('#view').textContent"))
    J(pg, "voidOrder('abc123', 'test')"); settle(pg, 400)
    switch_to(pg, 'gwen')
    J(pg, "go('orders'); openDrawer('order', 'abc123')"); pg.wait_for_timeout(300)
    check('voided: no Bring it back for Gwen', pg.query_selector('[data-act="orderUnvoid"]') is None)
    J(pg, "ACT.orderUnvoid({ dataset: { id: 'abc123' } })"); pg.wait_for_timeout(300)
    check('voided: …and if she tried, she’s told only Dr. A can', 'Only Dr. A can bring back a voided order' in toasts(pg) and (store('nlo/orders/abc123') or {}).get('status') == 'voided', toasts(pg))
    switch_to(pg, 'amir')
    J(pg, "go('orders'); openDrawer('order', 'abc123')"); pg.wait_for_timeout(300)
    click(pg, '[data-act="orderUnvoid"]', 600)
    check('voided: Dr. A brings it back', (store('nlo/orders/abc123') or {}).get('status') == 'open')
    check('stamps: no page errors (but the refusals tried on purpose)', not [x for x in errs if 'PERMISSION_DENIED' not in x and not re.search(r'HTTP 403 .*documents:commit', x)], errs)
    ctx.close()

@test
def t_claim_slow(b):
    """a receive the database is slow to confirm: it says it isn't confirmed; when it goes through after all, its stock and
    dollars are added then — never left received with nothing booked"""
    ctx, pg, errs = open_as(b, 'gwen')
    q0 = store('nlo/items/ppe-1')['qty']
    r = J(pg, "B.TXN_MS = 1; receiveOrder('order-old1', {}).then(()=>'went through', e=>e.code)")
    J(pg, "B.TXN_MS = 30000")
    check('slow: not confirmed in time', r == 'timeout', r)
    pg.wait_for_function("() => document.querySelector('#toasts').textContent.includes('went through after all')", timeout=20000)
    settle(pg, 600)
    o = store('nlo/orders/order-old1') or {}; q1 = store('nlo/items/ppe-1')['qty']
    lg = [e for e in store('nlo/log').values() if e.get('orderId') == 'order-old1' and e.get('type') == 'receive']
    check('slow: it went through after all — received, with its stock and dollars', o.get('status') == 'received' and q1 - q0 == 2 and len(lg) == 1 and abs((lg[0].get('amount') or 0) - 18.26) < 0.001, (o.get('status'), q0, q1, lg))
    check('slow: no page errors', not errs, errs)
    ctx.close()

@test
def t_claim_twice(b):
    """a receipt whose reply got lost on the way and that is tried again (as the database does by itself) finds itself already
    done: its stock and dollars aren't booked twice, and it isn't told someone else received it"""
    ctx, pg, errs = open_as(b, 'gwen')
    q0 = store('nlo/items/ppe-1')['qty']
    r = J(pg, """(async () => {
      const s = stamp(), books = () => ({ stock: { 'ppe-1': 2 }, log: [logEntry({ itemId: 'ppe-1', itemName: 'Gloves', delta: 2, type: 'receive', amount: 18.26, orderId: 'order-old1', note: 'test' }, s)] });
      const claim = cur => cur.status === 'received' ? undefined : { status: 'received', dateReceived: s.at, receivedBy: s.by, receivedById: s.byId, trail: trailAdd(cur.trail, 'received', s) };
      const a = await B.book('order-old1', 'kSAME', claim, books());
      const again = await B.book('order-old1', 'kSAME', claim, books());
      const other = await B.book('order-old1', 'kOTHER', claim, books()).then(() => 'went through', e => e.code);
      return [a, again, other];
    })()""")
    settle(pg, 500)
    lg = [e for e in store('nlo/log').values() if e.get('orderId') == 'order-old1' and e.get('type') == 'receive']
    check('twice: the first goes through, the same step tried again finds itself done, another one is turned back', r[0].get('done') is True and r[1].get('mine') is True and r[2] == 'aborted', r)
    check('twice: stock and dollars booked once', store('nlo/items/ppe-1')['qty'] - q0 == 2 and len(lg) == 1, (q0, store('nlo/items/ppe-1')['qty'], lg))
    o = store('nlo/orders/order-old1') or {}
    check('twice: received once, by Gwen, one step on its trail', o.get('status') == 'received' and o.get('receivedById') == 'gwen' and [t.get('t') for t in o.get('trail') or []].count('received') == 1, o.get('trail'))
    check('twice: no page errors', not errs, errs)
    ctx.close()

def mail_parts(href):
    """a mailto: link → (to, subject, body)"""
    from urllib.parse import urlparse, parse_qs
    u = urlparse(href or ''); q = parse_qs(u.query)
    return (u.path if u.scheme == 'mailto' else None), (q.get('subject') or [''])[0], (q.get('body') or [''])[0]

def ml_file(path, n_rows=5200, extra=None):
    """a made-up Mari's List file, shaped as Claude makes them (big enough to be saved in two parts)"""
    vendors = [
        {'id': 'acme', 'name': 'Acme Ortho Test', 'cat': 'supplies', 'deal': '15% off online; free shipping over $250.', 'code': 'ACMETEST15', 'how': 'Order on their website with the code.',
         'contacts': [{'k': 'phone', 'v': '555-010-1234 x12', 'who': 'Pat'}, {'k': 'email', 'v': 'orders@acme.example'}, {'k': 'web', 'v': 'https://acme.example/shop'}],
         'files': [{'t': 'Member price list (2026)', 'u': 'https://files.example/acme-2026.pdf', 'd': '2026'}]},
        {'id': 'sunny', 'name': 'Sunny Surgical Test', 'cat': 'supplies', 'deal': 'Member prices on gloves.', 'how': 'Email and say you’re a Mari’s List member.', 'say': True,
         'aka': ['SunSurgical'], 'contacts': [{'k': 'email', 'v': 'gloves@sunny.example'}, {'k': 'text', 'v': '555-010-9876'}]},
        {'id': 'lablab', 'name': 'Lab Lab Test', 'cat': 'lab', 'deal': '10% off lab work.', 'how': 'See the portal.'},
        {'id': 'bad id', 'name': 'Refused'}]
    rows = [['acme', 'GL-200S', 'Nitrile gloves, powder-free, blue, Small', 'Box of 200', 13.2, 18.5, 'Gloves', '', 0],
            ['sunny', 'S-100L', 'Nitrile gloves, Large', 'Box of 100', 7.1, None, 'Gloves', '', -1],
            ['acme', 'ZZ-UNIQUE', 'Zebra-striped unique test plier', 'EA', 77.77, 99, 'Pliers', '', 0],
            ['lablab', '', 'Hawley retainer', 'Each', 54, None, 'Lab services', '', -1],
            ['acme', 'TP-1', 'Percent-off product', '', None, None, '', '20% off list', -1],
            ['nobody', 'X', 'From a vendor not in the file', 'EA', 1, None, '', '', -1],
            ['acme', 'X2', '', 'EA', 1, None, '', '', -1]]
    for i in range(n_rows):
        rows.append(['acme', 'FILL-%05d' % i, 'Filler archwire %05d, NiTi, round .016, upper, a description long enough to make the file need more than one part' % i, 'Pack of 10', 10 + (i % 50) / 10, 15, 'Archwires', '', 0])
    d = {'kind': 'nlo-marislist', 'ver': 1, 'at': '2026-10-16', 'src': 'Made-up for the tests', 'vendors': vendors, 'rows': rows,
         'match': {'ppe-1': [{'i': 0, 'x': 2}], 'nope': [{'i': 2, 'x': 1}], 'ppe-3': [{'i': 5, 'x': 1}]}}
    if extra: extra(d)
    pathlib.Path(path).write_text(json.dumps(d))
    return d

@test
def t_marislist(b):
    """Mari's List (17 Oct 2026): nobody locked out under the rules from before it; Dr. A loads the office's member prices from
    Claude's file; everyone sees each vendor's deal, code and how to order, searches the prices and sees them on a supply, the
    cart and the place-order dialog; only Dr. A links a price to a supply; a newer file replaces the set and keeps his links"""
    tmp = HERE / 'www' / '_ml'; tmp.mkdir(exist_ok=True)
    new = (DIST / 'firestore.rules').read_text()
    a0 = new.index('    // Mari\'s List (17 Oct 2026'); a1 = new.index('    // which set of these rules is live', a0)
    set_rules(new[:a0] + new[a1:])   # the rules from before Mari's List
    try:
        ctx, pg, errs = open_as(b, 'amir', quiet=True)
        pg.wait_for_function("() => S.ml.off === true", timeout=10000)
        check('old rules: Inventory opens for Dr. A (nobody locked out)', J(pg, "S.inApp && S.gate === 'ready' && allLoaded()") is True)
        J(pg, "go('settings')"); pg.wait_for_timeout(200)
        check('old rules: Settings → Mari’s List says it needs the new rules, with the steps', 'Needs the new rules' in J(pg, "document.querySelector('#view').textContent") and J(pg, "!!document.querySelector('[data-act=copyRules]')"))
        J(pg, "go('ml')"); pg.wait_for_timeout(150)
        check('old rules: the Mari’s List screen says so too', 'Mari’s List needs the new rules' in J(pg, "document.querySelector('#view').textContent"))
        set_rules(new)
        pg.click('[data-act="mlCheck"]'); pg.wait_for_function("() => S.ml.off === false", timeout=10000); pg.wait_for_timeout(300)
        check('new rules published: Check again finds them', J(pg, "S.ml.off") is False and 'Load a Mari’s List file' in J(pg, "document.querySelector('#view').textContent"), J(pg, "document.querySelector('#view').textContent.slice(0,300)"))
        ctx.close()
        set_rules(new[:a0] + new[a1:])
        ctx, pg, errs = open_as(b, 'gwen', quiet=True)
        pg.wait_for_function("() => S.ml.off === true", timeout=10000)
        check('old rules: Gwen gets in, and no Mari’s List in her menu', J(pg, "S.gate") == 'ready' and not J(pg, "!!document.querySelector('#nav-ml')"))
        ctx.close()
    finally:
        set_rules(new)

    # ---- Dr. A loads a file
    f1 = tmp / 'nlo-marislist-test.json'; d1 = ml_file(f1)
    ctx, pg, errs = open_as(b, 'amir')
    pg.wait_for_function("() => S.ml.off === false", timeout=10000)
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    check('load: Settings → Mari’s List has nothing loaded yet', 'Not yet' in J(pg, "document.querySelector('#view').textContent"))
    pg.set_input_files('#mlFile', str(f1)); pg.wait_for_selector('[data-act="mlLoadGo"]', timeout=10000)
    txt = J(pg, "document.querySelector('#modalWrap').textContent")
    check('load: the dialog says what’s in the file (3 vendors, the good prices, 1 supply linked)', 'Vendors3' in txt.replace(' ', '') and ('%s' % '{:,}'.format(5205)) in txt and 'Yoursupplieslinkedtoone1' in txt.replace(' ', ''), txt)
    check('load: lines without a vendor, description or price are left out', '2 lines without a vendor' in txt, txt)
    pg.click('[data-act="mlLoadGo"]'); pg.wait_for_function("() => !document.querySelector('#modalWrap') && S.ml.info && S.ml.info.rows === 5205", timeout=30000); settle(pg)
    info = get('invMl/info') or {}
    parts = sorted(k for k in query('invMl') if k.startswith('p'))
    check('load: info saved by Dr. A (3 vendors, 5,205 prices, 2 parts)', info.get('upBy') == 'amir' and len(info.get('vendors') or []) == 3 and info.get('rows') == 5205 and info.get('parts') == 2 and info.get('loadedBy') == 'Dr. A', {k: info.get(k) for k in ('upBy', 'rows', 'parts', 'loadedBy', 'ver')})
    check('load: the prices in 2 parts named after the set', parts == ['p%s_1' % info.get('ver'), 'p%s_2' % info.get('ver')], parts)
    sizes = [len(((get('invMl/' + p) or {}).get('t') or '').encode()) for p in parts]
    check('load: each part under 900 KB', all(0 < s <= 900000 for s in sizes), sizes)
    m = (get('invMl/match') or {}).get('m') or {}
    check('load: the file’s link for ppe-1 (1 box of 200 = 2 of ours), not for a supply that isn’t there… (kept: it may come)', (m.get('ppe-1') or [{}])[0].get('x') == 2 and (m.get('ppe-1') or [{}])[0].get('k') == 'acme|GL-200S|box of 200', m.get('ppe-1'))
    check('load: a link to a left-out line is dropped', 'ppe-3' not in m, list(m))
    vs = {v['id']: v for v in info.get('vendors') or []}
    check('load: the vendor with a bad id is left out; the others keep deal, code, contacts and files', set(vs) == {'acme', 'sunny', 'lablab'} and vs['acme'].get('code') == 'ACMETEST15' and len(vs['acme'].get('contacts') or []) == 3 and (vs['acme'].get('files') or [{}])[0].get('u') == 'https://files.example/acme-2026.pdf', vs.get('acme'))
    # ---- the screen
    J(pg, "go('ml')"); pg.wait_for_timeout(300)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('screen: the vendors, with deals and codes', J(pg, "document.querySelectorAll('.mlv').length") == 3 and 'ACMETEST15' in txt and '15% off online' in txt, txt[:400])
    check('screen: Sunny is one the office buys from (SunSurgical)', J(pg, "!!document.querySelector('.mlv.ours[data-id=sunny]')"))
    check('screen: what’s cheaper for the linked supplies (gloves: $6.60 a box vs $9.13)', 'Cheaper on Mari’s List' in txt and '$6.60' in txt and 'Save 28%' in txt, txt[:500])
    J(pg, "S.q = 'zebra plier'; renderView(true)"); pg.wait_for_function("() => document.querySelectorAll('.mlr').length === 1", timeout=15000)
    check('search: reads the prices (both parts) and finds the one', J(pg, "S.ml.rows.length") == 5205 and 'Zebra-striped unique test plier' in J(pg, "document.querySelector('.mlList').textContent"))
    J(pg, "S.q = 'nitrile gloves sm'; renderView(true)"); pg.wait_for_timeout(250)
    check('search: “sm” finds “Small”, “gloves” finds “gloves”', J(pg, "[...document.querySelectorAll('.mlr')].map(r => r.dataset.k)") == ['acme|GL-200S|box of 200'], J(pg, "[...document.querySelectorAll('.mlr')].map(r => r.dataset.k)"))
    J(pg, "S.q = '.016 upper filler'; renderView(true)"); pg.wait_for_timeout(250)
    check('search: many matches show the first 150 and say how many', J(pg, "document.querySelectorAll('.mlr').length") == 150 and 'of 5,200' in J(pg, "document.querySelector('#view').textContent"))
    J(pg, "openDrawer('mlv', 'acme')"); pg.wait_for_timeout(200)
    dt = J(pg, "document.querySelector('#drawer').textContent")
    check('vendor drawer: deal, code with Copy, how, contacts (call with the extension), price file', 'ACMETEST15' in dt and 'Order on their website' in dt and J(pg, "document.querySelector('#drawer a[href^=\"tel:\"]').getAttribute('href')") == 'tel:+15550101234,12' and J(pg, "!!document.querySelector('#drawer a[href^=\"mailto:orders@acme.example?subject=\"]')") and J(pg, "!!document.querySelector('#drawer a[href=\"https://files.example/acme-2026.pdf\"]')"), dt[:500])
    to, subj, body = mail_parts(J(pg, "document.querySelector('#drawer a[href^=\"mailto:\"]').getAttribute('href')"))
    check('vendor drawer: its email opens with a hello and the office’s sign-off, not blank (Amir: “then it’s blank”)', to == 'orders@acme.example' and subj == 'Mari’s List member — Next Level Orthodontics' and body.startswith('Hello,\n\nWe’re Mari’s List members (code ACMETEST15).') and body.endswith('Thank you!\nDr. Riley Owner\nNext Level Orthodontics\n320 NW 76th Drive, Gainesville, FL 32607\n(352) 332-7466'), (to, subj, body))
    J(pg, "openDrawer('mlr', 'acme|ZZ-UNIQUE|ea')"); pg.wait_for_timeout(200)
    dt = J(pg, "document.querySelector('#drawer').textContent")
    check('price drawer: the price, retail and % off, how to get it, the file it’s from', '$77.77' in dt and 'retail $99.00' in dt and '21% off' in dt and 'Member price list (2026)' in dt, dt[:400])
    pg.click('#drawer [data-act="mlQuote"]'); pg.wait_for_selector('#mlQuoteMail')
    to, subj, body = mail_parts(J(pg, "document.querySelector('#mlQuoteMail').getAttribute('href')"))
    check('quote (a price): to Acme, about that price alone (no supply, so no quantity)', to == 'orders@acme.example' and subj == 'Quote request: Zebra-striped unique test plier (#ZZ-UNIQUE) — Next Level Orthodontics' and '• Zebra-striped unique test plier\n  Item # ZZ-UNIQUE · Unit: EA\n  Mari’s List price we have: $77.77\n  Price list: Member price list (2026)\n\n' in body and 'Quantity' not in body and J(pg, "document.querySelectorAll('.mlq').length") == 1, (to, subj, body))
    J(pg, "closeModal(true)")
    # a vendor with no address: the email is written, the address left for them
    k = J(pg, "S.ml.rows.find(r => r.v === 'lablab').k")
    J(pg, "openDrawer('mlr', %s)" % json.dumps(k)); pg.wait_for_timeout(200)
    pg.click('#drawer [data-act="mlQuote"]'); pg.wait_for_selector('#mlQuoteMail')
    to, subj, body = mail_parts(J(pg, "document.querySelector('#mlQuoteMail').getAttribute('href')"))
    check('quote (no email saved): written all the same, with no address, and the dialog says so', to == '' and subj.startswith('Quote request: Hawley retainer') and 'No email saved for Lab Lab Test' in J(pg, "document.querySelector('#modalWrap .lsub').textContent"), (to, subj))
    J(pg, "closeModal(true); closeDrawer()")
    # ---- a supply's drawer
    J(pg, "S.q = ''; go('supplies'); openDrawer('item', 'ppe-1')"); pg.wait_for_timeout(300)
    dt = J(pg, "document.querySelector('#drawer .mlSec').textContent")
    check('supply drawer: its Mari’s List price, per box of ours, and the saving', 'Acme Ortho Test' in dt and '$13.20' in dt and '$6.60/box' in dt and 'Save 28%' in dt, dt)
    check('supply drawer: SunSurgical is on Mari’s List (its deal)', 'SunSurgical is on Mari’s List' in dt, dt)
    # ---- asking for a quote (Amir, 17 Oct 2026: "There should be the option to ask for a quote so it would write out an email …")
    remote('invOrders/q-gl', {'id': 'q-gl', 'vendor': 'SunSurgical', 'status': 'received', 'orderedAt': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()), 'dateOrdered': time.strftime('%Y-%m-%d'), 'dateReceived': time.strftime('%Y-%m-%d'),
                              'items': [{'itemId': 'ppe-1', 'name': 'Gloves Pulse Nitrile — SM', 'unit': 'case', 'per': 10, 'countUnit': 'box', 'qty': 3, 'price': 91.3, 'lineTotal': 273.9}]})
    pg.wait_for_function("() => S.D.orders.some(o => o.id === 'q-gl')", timeout=10000)
    J(pg, "closeDrawer(); openDrawer('item', 'ppe-1')"); pg.wait_for_timeout(250)
    check('quote: the supply’s Mari’s List part asks the vendor with the best price', J(pg, "(document.querySelector('#drawer .mlSec [data-act=mlQuote]') || {}).textContent") == 'Ask Acme Ortho Test for a quote')
    pg.click('#drawer .mlSec [data-act="mlQuote"]'); pg.wait_for_selector('#mlQuoteMail')
    to, subj, body = mail_parts(J(pg, "document.querySelector('#mlQuoteMail').getAttribute('href')"))
    check('quote: to the address Mari’s List gives for Acme', to == 'orders@acme.example', to)
    check('quote: the subject names the item and its #', subj == 'Quote request: Nitrile gloves, powder-free, blue, Small (#GL-200S) — Next Level Orthodontics', subj)
    want = ['Hello,\n\nWe’re Mari’s List members (code ACMETEST15). Could you send us a quote for this item? We’d like to check the member price before we order.',
            '• Nitrile gloves, powder-free, blue, Small\n  Item # GL-200S · Unit: Box of 200\n  Mari’s List price we have: $13.20\n  Price list: Member price list (2026)\n  To replace what we use now: Gloves Pulse Nitrile — SM\n  Quantity: 15',
            'Please confirm that’s our member price, and let us know the shipping cost and any minimum order.', 'Thank you!\nDr. Riley Owner\nNext Level Orthodontics\n320 NW 76th Drive, Gainesville, FL 32607\n(352) 332-7466']
    check('quote: the email — members (code), the item as the list names it, the price and its list, what it replaces, how many (the last order: 3 cases = 30 boxes = 15 boxes of 200), confirm price, shipping, minimum, the office', all(w in body for w in want), [w for w in want if w not in body] + [body])
    check('quote: the dialog shows the item, for which supply, how many', J(pg, "document.querySelector('#mlqQty0').value") == '15' and 'for Gloves Pulse Nitrile — SM' in J(pg, "document.querySelector('.mlq').textContent"))
    pg.fill('#mlqQty0', '24'); pg.wait_for_timeout(100)
    to, subj, body = mail_parts(J(pg, "document.querySelector('#mlQuoteMail').getAttribute('href')"))
    g = J(pg, "(document.querySelector('#mlQuoteGmail') || {}).href || ''")
    check('quote: a new quantity is in the email, its link and the Gmail link at once', 'Quantity: 24' in body and 'Quantity: 24' in J(pg, "document.querySelector('#mlQuoteTxt').textContent") and g.startswith('https://mail.google.com/mail/?view=cm&fs=1&to=orders%40acme.example&su=') and 'Quantity%3A%2024' in g, (body[-400:], g[:120]))
    J(pg, "closeModal(true)")
    # ---- Dr. A links one himself
    J(pg, "closeDrawer(); openDrawer('item', 'ppe-2')"); pg.wait_for_timeout(200)
    pg.click('#drawer [data-act="mlFind"]'); pg.wait_for_function("() => S.view === 'ml' && document.querySelectorAll('.mlr').length > 0", timeout=10000)
    check('find: from the supply, the closest matches first (its name’s words)', J(pg, "document.querySelector('.mlr').dataset.k") == 'sunny|S-100L|box of 100' and 'Mari’s List prices for Gloves Pulse Nitrile — LG' in J(pg, "document.querySelector('.mlFor').textContent"), J(pg, "[S.q, document.querySelector('.mlr').dataset.k]"))
    pg.click('.mlr[data-k="sunny|S-100L|box of 100"] [data-act="mlLinkAsk"]'); pg.wait_for_selector('#mlX')
    check('link: one of theirs = 1 of ours (no count to compare: the supply doesn’t say)', J(pg, "document.querySelector('#mlX').value") == '1')
    check('link: says what that comes to ($7.10 a box vs $9.13: 22% less)', '$7.10' in J(pg, "document.querySelector('#mlXSay').textContent") and '22% less' in J(pg, "document.querySelector('#mlXSay').textContent"), J(pg, "document.querySelector('#mlXSay').textContent"))
    click(pg, '#mlLinkGo', 600)
    m = (get('invMl/match') or {}).get('m') or {}
    check('link: saved for ppe-2 by Dr. A, ppe-1’s link kept', (m.get('ppe-2') or [{}])[0].get('k') == 'sunny|S-100L|box of 100' and (m.get('ppe-2') or [{}])[0].get('by') == 'Dr. A' and 'ppe-1' in m, m)
    check('link: the result says Linked', J(pg, "!!document.querySelector('.mlr[data-k=\"sunny|S-100L|box of 100\"] .fl.cart')"))
    J(pg, "openDrawer('mlv', 'sunny')"); pg.wait_for_timeout(200)
    check('quote (a vendor): its drawer asks about the supplies linked there', J(pg, "(document.querySelector('#drawer [data-act=mlQuote]') || {}).textContent") == 'Ask for a quote on it')
    pg.click('#drawer [data-act="mlQuote"]'); pg.wait_for_selector('#mlQuoteMail')
    to, subj, body = mail_parts(J(pg, "document.querySelector('#mlQuoteMail').getAttribute('href')"))
    check('quote (a vendor): to Sunny, with the office’s account # there (SunSurgical), a “same” link says nothing about replacing', to == 'gloves@sunny.example' and 'We’re Mari’s List members; our account with you is 12345.' in body and '• Nitrile gloves, Large\n  Item # S-100L · Unit: Box of 100\n  Mari’s List price we have: $7.10' in body and 'To replace' not in body, body)
    J(pg, "closeModal(true); closeDrawer()")
    J(pg, "ACT.mlForDone()"); pg.wait_for_timeout(100)
    # ---- the cart and the place-order dialog
    J(pg, "go('supplies'); openAddToCart(itemById('ppe-1'), 2)"); pg.wait_for_timeout(200); click(pg, '#addGo', 600)
    J(pg, "go('cart')"); pg.wait_for_timeout(300)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('cart: SunSurgical’s card says it’s on Mari’s List (say you’re a member)', 'Mari’s List · say you’re a member' in txt, txt[:600])
    check('cart: the gloves line says Mari’s List has them for less elsewhere', 'Mari’s List: $6.60 per box at Acme Ortho Test — 28% less' in txt, txt[:900])
    J(pg, "document.querySelector('[data-act=placeOrder][data-v=\"SunSurgical\"]').click()"); pg.wait_for_selector('.mlPlace')
    J(pg, "document.querySelector('[data-act=placeHow][data-k=email]') && 0")
    mt = J(pg, "document.querySelector('#modalWrap').textContent")
    check('place order: how to get the member price, and that the email and text say so', 'Mari’s List member pricing' in mt and 'Email and say you’re a Mari’s List member.' in mt, mt[:500])
    check('place order: the order email and the text carry “We’re Mari’s List members”', 'We’re Mari’s List members — please apply our Mari’s List pricing.' in J(pg, "orderText('SunSurgical', S.ui.place.snap, whoNow())") and "We're Mari's List members - please apply our Mari's List pricing." in J(pg, "orderSms('SunSurgical', S.ui.place.snap, whoNow())"))
    check('place order: a vendor that isn’t on Mari’s List gets neither', J(pg, "mlPlaceHTML('American Orthodontics') === '' && mlOrderSay('American Orthodontics') === ''") is True)
    check('place order: Dr. A signs the order email and text as the doctor (his full name with Dr.), not by first name', J(pg, "orderText('SunSurgical', S.ui.place.snap, whoNow())").endswith('Thank you!\nDr. Riley Owner, Next Level Orthodontics') and J(pg, "orderSms('SunSurgical', S.ui.place.snap, whoNow())").endswith('Thanks! - Dr. Riley Owner') and J(pg, "[signName({ name: 'Sarah Bell' }), signName({ name: 'Dr Riley Owner', owner: true }), signName({ name: 'Riley Owner', owner: true }), signName({ name: 'Riley', owner: true })]") == ['Sarah', 'Dr. Riley Owner', 'Dr. Riley Owner', 'Dr. A'])
    J(pg, "closeModal(true)")
    check('Dr. A: no page errors', not errs, errs)
    ctx.close()
    # ---- Gwen: sees it all, links nothing
    ctx, pg, errs = open_as(b, 'gwen')
    pg.wait_for_function("() => !!S.ml.info", timeout=10000); pg.wait_for_timeout(200)
    check('Gwen: Mari’s List is in her menu now', J(pg, "!!document.querySelector('#nav-ml')"))
    J(pg, "go('ml')"); pg.wait_for_timeout(200)
    check('Gwen: sees the vendors and what’s cheaper', J(pg, "document.querySelectorAll('.mlv').length") == 3 and 'Cheaper on Mari’s List' in J(pg, "document.querySelector('#view').textContent"))
    pg.click('.mlCheap [data-act="mlQuote"][data-id="ppe-1"]'); pg.wait_for_selector('#mlQuoteMail')
    to, subj, body = mail_parts(J(pg, "document.querySelector('#mlQuoteMail').getAttribute('href')"))
    check('Gwen: asks for a quote from a “Cheaper on Mari’s List” line, signed with her name', to == 'orders@acme.example' and 'Thank you!\nGwen\nNext Level Orthodontics' in body and 'Item # GL-200S' in body, body[-300:])
    J(pg, "closeModal(true)")
    J(pg, "openDrawer('item', 'ppe-2')"); pg.wait_for_timeout(200)
    pg.click('#drawer [data-act="mlFind"]'); pg.wait_for_function("() => document.querySelectorAll('.mlr').length > 0", timeout=10000)
    check('Gwen: no “Same as ours” for her (Dr. A links them)', not J(pg, "!!document.querySelector('[data-act=mlLinkAsk]')") and 'Dr. A links the one' in J(pg, "document.querySelector('.mlFor').textContent"))
    r = J(pg, "B.mlMatchSet('ppe-2', []).then(() => 'saved', e => String(e.code || e.message))")
    check('Gwen: the page won’t link or unlink for her', r == 'permission', r)
    J(pg, "B.mlMatchSet = () => Promise.resolve(); B.isOwner = () => true");
    r = J(pg, "firebase.app('inv').firestore().doc('invMl/match').set({ m: {}, up: firebase.firestore.FieldValue.serverTimestamp(), upBy: 'gwen' }).then(() => 'saved', e => String(e.code))")
    check('Gwen: …nor will the database', r == 'permission-denied', r)
    check('Gwen: no page errors', not [e for e in errs if 'permission' not in e.lower()], errs)
    ctx.close()
    # ---- a newer file replaces the set; Dr. A's own link stays (with its new price), the old parts go
    f2 = tmp / 'nlo-marislist-test2.json'
    def newer(d):
        d['at'] = '2026-11-02'; d['rows'][1][4] = 6.5; d['rows'] = d['rows'][:300]
    ml_file(f2, extra=newer)
    ctx, pg, errs = open_as(b, 'amir')
    pg.wait_for_function("() => !!S.ml.info", timeout=10000)
    old_ver = J(pg, "S.ml.info.ver")
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    pg.set_input_files('#mlFile', str(f2)); pg.wait_for_selector('[data-act="mlLoadGo"]', timeout=10000)
    txt = J(pg, "document.querySelector('#modalWrap').textContent")
    check('reload: says Dr. A’s own link stays and what it replaces', '1 link you made stay' in txt and 'It replaces the set loaded' in txt, txt)
    pg.click('[data-act="mlLoadGo"]'); pg.wait_for_function("() => !document.querySelector('#modalWrap') && S.ml.info && S.ml.info.ver !== %s" % json.dumps(old_ver), timeout=30000); settle(pg, 800)
    info = get('invMl/info') or {}; parts = sorted(k for k in query('invMl') if k.startswith('p'))
    check('reload: the new set (one part), the old parts gone', parts == ['p%s_1' % info.get('ver')] and info.get('at') == '2026-11-02', parts)
    m = (get('invMl/match') or {}).get('m') or {}
    check('reload: Dr. A’s link for ppe-2 kept, with the new price', (m.get('ppe-2') or [{}])[0].get('p') == 6.5 and (m.get('ppe-2') or [{}])[0].get('by') == 'Dr. A', m.get('ppe-2'))
    J(pg, "go('ml'); S.q = 'zebra'; renderView(true)"); pg.wait_for_function("() => S.ml.rows && S.ml.rows.length === 298", timeout=15000)
    check('reload: the page reads the new set', J(pg, "S.ml.rowsVer") == info.get('ver'))
    # ---- unlinking
    J(pg, "S.q = ''; go('supplies'); openDrawer('item', 'ppe-2')"); pg.wait_for_timeout(250)
    J(pg, "document.querySelector('#drawer .mlLinkRow').click()"); pg.wait_for_timeout(250)
    pg.click('#drawer [data-act="mlUnlink"]'); pg.wait_for_selector('#cbYes'); click(pg, '#cbYes', 600)
    m = (get('invMl/match') or {}).get('m') or {}
    check('unlink: ppe-2’s link is off, ppe-1’s stays', 'ppe-2' not in m and 'ppe-1' in m, list(m))
    check('Dr. A (reload): no page errors', not errs, errs)
    ctx.close()

@test
def t_points(b):
    """AO Partner Dollars (17 Oct 2026, Amir: "you should APPROXIMATE our points going forward"): Dr. A's Home counts from the
    balance AO Direct last showed — AO orders received here and placed after it add what their brackets and tubes earn and take
    off what their other lines cost (no more than there is); AO supplies that earn show their cost after points; Dr. A updates
    the balance; nobody else sees any of it or may change it (made-up numbers)"""
    iso = lambda h: time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() - h * 3600))
    ao = lambda sku, price: [{'vendor': 'American Orthodontics', 'sku': sku, 'price': price, 'src': 'https://shop.americanortho.com'}]
    remote('invItems/pt-bk', {'id': 'pt-bk', 'name': 'Test bracket UR central', 'cat': 'brackets-tubes', 'unit': 'each', 'qty': 0, 'min': 0, 'sources': ao('TST-1', 2.84), 'aoPts': {'earn': 1.28, 'at': '2026-10-17'}})
    remote('invItems/pt-w', {'id': 'pt-w', 'name': 'Test NiTi .016 upper', 'cat': 'archwires', 'unit': 'pack', 'qty': 0, 'min': 0, 'sources': ao('TST-2', 16.89), 'aoPts': {'pay': True, 'at': '2026-10-17'}})
    remote('invItems/pt-g', {'id': 'pt-g', 'name': 'DB TUBE LP UR 1ST MOL TEST', 'cat': 'misc', 'unit': 'each', 'qty': 0, 'min': 0, 'sources': ao('TST-3', 5.04)})
    remote('invVendors/ao', {'id': 'ao', 'pts': {'bal': 100.0, 'exp': '2028-12-31', 'at': iso(48), 'by': 'Dr. A'}})
    line = lambda it, name, q, p: {'itemId': it, 'name': name, 'qty': q, 'price': p, 'unit': 'each', 'lineTotal': round(q * p, 2)}
    rec = lambda oid, vendor, h, lines, status='received': remote('invOrders/' + oid, {'id': oid, 'vendor': vendor, 'status': status, 'orderedAt': iso(h), 'dateOrdered': iso(h)[:10], 'dateReceived': iso(max(h - 2, 0)) if status == 'received' else None, 'items': lines})
    # Quick order: Mini Master single teeth with what one earns in the shared price memory; an o-tie pick (paid with points)
    remote('invState/prices', {'p': {'AO-BRACKET-IND|MINI MASTER - _018 - MBT COMPATIBLE': {'price': 2.84, 'date': '2026-10-17', 'earn': 1.28}, '854-450': {'price': 23.27, 'date': '2026-10-17'}}})
    quick = lambda sku, name, q, p: {'name': name, 'sku': sku, 'qty': q, 'price': p, 'unit': 'bracket' if sku.startswith('AO-') else 'pkg', 'lineTotal': round(q * p, 2), 'vendor': 'American Orthodontics'}
    rec('pt-o1', 'American Orthodontics', 24, [line('pt-bk', 'Test bracket UR central', 50, 2.84), line('pt-w', 'Test NiTi .016 upper', 3, 16.89), line('pt-g', 'DB TUBE LP UR 1ST MOL TEST', 10, 5.04),
                                                quick('AO-BRACKET-IND', 'MINI MASTER - .018 - MBT COMPATIBLE (single teeth)', 20, 2.84), quick('854-450', 'O-Ties 10-Ring — Silver', 2, 23.27)])
    rec('pt-o0', 'American Orthodontics', 120, [line('pt-w', 'Test NiTi .016 upper', 9, 16.89)])          # placed before the balance was read
    rec('pt-o2', 'American Orthodontics', 10, [line('pt-w', 'Test NiTi .016 upper', 9, 16.89)], 'open')   # not received yet
    rec('pt-o3', 'Henry Schein', 10, [line('pt-w', 'Test NiTi .016 upper', 9, 16.89)])                    # not AO
    ctx, pg, errs = open_as(b, 'amir')
    p = J(pg, "ptsNow()")
    # 100 − 97.21 (3 packs of wire + 2 o-tie packs, paid with points) + 64.00 (50 brackets × $1.28) + 22.68 (10 tubes, no
    # figure: 45% of $50.40) + 25.60 (20 Quick order brackets × $1.28 from the price memory)
    check('estimate: from $100, one AO order counted: +$112.28 earned, −$97.21 spent → $115.07', p and p['bal'] == 115.07 and p['earned'] == 112.28 and p['used'] == 97.21 and p['orders'] == 1, p)
    txt = J(pg, "(document.querySelector('.ptsCard') || {}).textContent || ''")
    check('Home (Dr. A): the card says about $115.07, what AO Direct showed and what came and went', '≈ $115.07' in txt and 'AO Direct showed $100.00' in txt and '+$112.28' in txt and '−$97.21' in txt and '1 AO order' in txt and 'expire Dec 31, 2028' in txt, txt)
    remote('invOrders/pt-o4', {'id': 'pt-o4', 'vendor': 'AMERICAN ORTHODONTICS', 'status': 'received', 'orderedAt': iso(12), 'dateOrdered': iso(12)[:10], 'dateReceived': iso(10), 'items': [line('pt-w', 'Test NiTi .016 upper', 20, 16.89)]})
    pg.wait_for_function("() => ptsNow() && ptsNow().orders === 2", timeout=10000)
    p = J(pg, "ptsNow()")
    check('estimate: a bigger AO order (vendor in capitals) spends no more than there is → $0.00', p['bal'] == 0 and p['used'] == 212.28 and p['earned'] == 112.28, p)
    J(pg, "S.ui.quick = { tab: 'brackets', product: 'oties', format: 'uniStick', qty: {}, system: 'MINI MASTER - .018 - MBT COMPATIBLE', mode: 'ind', sets: {}, teeth: {} }; go('quick')"); pg.wait_for_timeout(200)
    check('Quick order (Dr. A): a Mini Master bracket ≈ $1.56 after AO points', '≈ $1.56 after AO points' in J(pg, "document.querySelector('#view').textContent"), J(pg, "document.querySelector('#view .hint') && document.querySelector('#view .hint').textContent"))
    J(pg, "S.ui.sup = { cat: '', show: '', sort: 'cat', look: 'grid' }; S.q = 'test'; go('supplies'); S.q = 'test'; renderView(true)"); pg.wait_for_timeout(300)
    after = J(pg, "Object.fromEntries([...document.querySelectorAll('.pcard')].map(c => [c.dataset.id, (c.querySelector('.ptsAfter') || {}).textContent || '']))")
    check('Supplies (Dr. A): the bracket ≈ $1.56 after AO points, the tube (no figure) ≈ $2.77, the wire nothing', after.get('pt-bk') == '≈ $1.56 after AO points' and after.get('pt-g') == '≈ $2.77 after AO points' and after.get('pt-w') == '', after)
    J(pg, "openDrawer('item', 'pt-bk')"); pg.wait_for_timeout(200)
    check('drawer: what the bracket earns and costs after points', J(pg, "document.querySelector('#drawer .ptsNote').textContent") == 'AO Partner Dollars: earns $1.28 each — ≈ $1.56 each after points.', J(pg, "(document.querySelector('#drawer .ptsNote') || {}).textContent"))
    J(pg, "openDrawer('item', 'pt-g')"); pg.wait_for_timeout(200)
    check('drawer: a tube without AO Direct’s figure says “about”', 'earns about $2.27 each' in J(pg, "document.querySelector('#drawer .ptsNote').textContent"), J(pg, "(document.querySelector('#drawer .ptsNote') || {}).textContent"))
    J(pg, "openDrawer('item', 'pt-w')"); pg.wait_for_timeout(200)
    check('drawer: the wire is paid with points first', 'AO pays for this with your points first' in J(pg, "document.querySelector('#drawer .ptsNote').textContent"), J(pg, "(document.querySelector('#drawer .ptsNote') || {}).textContent"))
    J(pg, "closeDrawer(); S.q = ''; go('home')"); pg.wait_for_timeout(200)
    pg.click('.ptsCard [data-act="ptsEdit"]'); pg.wait_for_selector('#ptsBal')
    pg.fill('#ptsBal', ''); click(pg, '#ptsGo', 200)
    check('update: no balance → asks for one, saves nothing', 'What does AO Direct show' in toasts(pg) and (get('invVendors/ao') or {}).get('pts', {}).get('bal') == 100.0)
    pg.fill('#ptsBal', '250.5'); pg.fill('#ptsExp', '2029-06-30'); click(pg, '#ptsGo', 600)
    v = get('invVendors/ao') or {}
    check('update: saved on the AO vendor by Dr. A (balance, expiration, when, who)', (v.get('pts') or {}).get('bal') == 250.5 and v['pts'].get('exp') == '2029-06-30' and v['pts'].get('by') == 'Dr. A' and v.get('upBy') == 'amir' and v['pts'].get('at'), v)
    p = J(pg, "ptsNow()")
    check('update: counts from the new balance (the orders before it are in it)', p['bal'] == 250.5 and p['orders'] == 0, p)
    check('Dr. A: no page errors', not errs, errs)
    ctx.close()
    ctx, pg, errs = open_as(b, 'gwen', quiet=True)
    check('Gwen: no AO Partner Dollars on her Home', not J(pg, "!!document.querySelector('.ptsCard')"))
    J(pg, "S.ui.quick = { tab: 'brackets', product: 'oties', format: 'uniStick', qty: {}, system: 'MINI MASTER - .018 - MBT COMPATIBLE', mode: 'ind', sets: {}, teeth: {} }; go('quick')"); pg.wait_for_timeout(200)
    check('Gwen: Quick order shows the price, not the points', 'Price $2.84 a bracket' in J(pg, "document.querySelector('#view').textContent") and 'after AO points' not in J(pg, "document.querySelector('#view').textContent"))
    J(pg, "S.q = 'test'; go('supplies'); S.q = 'test'; renderView(true)"); pg.wait_for_timeout(300)
    check('Gwen: no cost after points on the supplies', J(pg, "document.querySelectorAll('.ptsAfter').length") == 0)
    J(pg, "openDrawer('item', 'pt-bk')"); pg.wait_for_timeout(200)
    check('Gwen: nor in the drawer', not J(pg, "!!document.querySelector('#drawer .ptsNote')"))
    res = J(pg, "B.patchVendor('ao', { pts: { bal: 99999, at: new Date().toISOString(), by: 'Gwen R.' } }).then(() => 'saved', e => String(e.code || e.message))")
    check('Gwen: the database refuses her changing the balance', res != 'saved' and 'permission' in res, res)
    check('Gwen: the balance is still Dr. A’s', ((get('invVendors/ao') or {}).get('pts') or {}).get('bal') == 250.5)
    ctx.close()

@test
def t_demo(b):
    """the demo page: made-up office, nothing saved, every screen for each kind of person"""
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}); pg = ctx.new_page(); errs = []
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://www\.google\.com/s2/favicons.*'), lambda r: r.abort())
    pg.on('pageerror', lambda e: errs.append(str(e)[:300])); pg.on('console', lambda m: errs.append(m.text[:300]) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.goto('file://' + str(DIST / 'demo-page.html')); pg.wait_for_selector('#lgBtn')
    check('demo: two ways in (Dr. A, an assistant)', J(pg, "[...document.querySelectorAll('[data-act=demoAs]')].map(b => b.dataset.as)") == ['amir', 'gwen'])
    for k, who in enumerate(['amir', 'gwen']):
        J(pg, "document.querySelector('[data-act=demoAs][data-as=%s]').click()" % who); pg.click('#lgBtn')
        pg.wait_for_function("() => S.inApp && allLoaded()", timeout=10000)
        for v in ['home', 'supplies', 'cart', 'orders', 'quick', 'ml', 'budget', 'activity', 'vendors', 'settings']:
            J(pg, "go('%s')" % v); pg.wait_for_timeout(120)
            check('demo (%s): %s renders' % (who, v), not J(pg, "document.querySelector('#view').textContent.includes('hit a problem')"), J(pg, "document.querySelector('#view').textContent.slice(0,200)"))
            if who == 'gwen' and v in ('budget', 'activity', 'vendors', 'settings'): check('demo (gwen): %s isn’t hers (Home instead)' % v, J(pg, "S.view") == 'home')
        J(pg, "go('ml')"); pg.wait_for_timeout(150)
        txt = J(pg, "document.querySelector('#view').textContent")
        check('demo (%s): Mari’s List shows made-up vendors and what’s cheaper' % who, J(pg, "S.view") == 'ml' and 'Cedar Dental Supply' in txt and 'Cheaper on Mari’s List' in txt and 'BRIGHT18' in txt, txt[:300])
        check('demo (%s): only the made-up Mari’s List vendors in the demo' % who, J(pg, "S.ml.info.vendors.map(v => v.id).join(',')") == 'cedar,brightline,harbor,northwind,pebble,summit,tidewater', J(pg, "S.ml.info.vendors.map(v => v.id)"))
        J(pg, "S.q = 'nitrile small'; renderView(true)"); pg.wait_for_timeout(250)
        check('demo (%s): searching the member prices' % who, J(pg, "document.querySelectorAll('.mlr').length") == 1, J(pg, "document.querySelector('#view').textContent.slice(0,300)"))
        J(pg, "S.q = ''"); J(pg, "go('cart')"); pg.wait_for_timeout(150)
        txt = J(pg, "document.querySelector('#view').textContent")
        check('demo (%s): the cart shows Dr. A’s OKs and what waits' % who, ('Needs your OK' in txt and 'you OK’d 3' in txt) if who == 'amir' else ('OK’d by Dr. A' in txt and 'Waiting for Dr. A’s OK' in txt and 'he OK’d 3' in txt), txt[:600])
        J(pg, "cartAdd(activeItems().filter(i => !inCartLine(i.id))[%d], 1, {})" % k); pg.wait_for_timeout(200)
        check('demo (%s): adding to the cart works, stamped' % who, J(pg, "S.D.cart.some(c => c.addedById === %s)" % json.dumps(who)))
        check('demo (%s): his own add is OK’d at once: %s' % (who, who == 'amir'), J(pg, "!!okOf(S.D.cart.find(c => c.addedById === %s))" % json.dumps(who)) == (who == 'amir'))
        check('demo (%s): sees everything: %s' % (who, who == 'amir'), J(pg, "isAdmin()") == (who == 'amir'))
        J(pg, "go('home')"); pg.wait_for_timeout(120)
        pt = J(pg, "(document.querySelector('.ptsCard') || {}).textContent || ''")
        check('demo (%s): AO Partner Dollars on Home: %s (made-up balance)' % (who, who == 'amir'), ('AO Direct showed $1,250.00' in pt and '≈ $' in pt) if who == 'amir' else pt == '', pt[:200])
        J(pg, "ACT.lock()"); pg.wait_for_selector('#lgBtn')
    check('demo: no page errors', not errs, errs)
    ctx.close()

def main():
    names = sys.argv[1:]
    srv = serve()
    req('DELETE', 'http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents')
    req('DELETE', 'http://127.0.0.1:9099/emulator/v1/projects/' + P + '/accounts')
    set_rules((DIST / 'firestore.rules').read_text())
    # the old database's rules for the test: anyone signed in (the real ones: the office accounts)
    c, j = req('PUT', RT + '/.settings/rules.json?ns=' + P, json.loads((HERE / 'rtdb.rules.json').read_text())); assert c == 200, j
    seed_people(); seed_old()
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--disable-features=PrivateNetworkAccessRespectPreflightResults'])
        for fn in TESTS:
            if names and fn.__name__ not in names and fn.__name__ != 't_move': continue
            if fn.__name__ != 't_move': restore()
            print('--- ' + fn.__name__, flush=True)
            try: fn(b)
            except Exception as e:
                tb = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.endswith('e2e.py')]
                check(fn.__name__ + ' ran', False, str(e).split('\n')[0][:300] + ' @ ' + ' > '.join('%s:%d' % (f.name, f.lineno) for f in tb))
        b.close()
    srv.shutdown()
    bad = [r for r in results if not r[1]]
    print('\n%d passed, %d failed' % (len(results) - len(bad), len(bad)))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
