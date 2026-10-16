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
def new_page(b, w=1366, h=900, quiet=False):
    ctx = b.new_context(viewport={'width': w, 'height': h})
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
    check('move: who changes settings mapped to NLO Cases logins (Dr. A, Sarah B.)', J(pg, "MV.plan.adminNames") == ['Dr. A', 'Sarah B.'], J(pg, "MV.plan.adminNames"))
    txt = J(pg, "document.querySelector('.moveCard').textContent")
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
    check('move: settings (locations, who changes settings; alerts off until the new script runs)', st.get('locations') == ['Lab cabinet', 'Sterilization closet'] and st.get('invAdmins') == ['amir', 'sarah'] and st.get('alertsOn') is False, st)
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
    for v in ['home', 'supplies', 'cart', 'orders', 'quick', 'budget', 'activity', 'vendors', 'settings']:
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
    """with the rules published today (no Inventory), Dr. A gets the card to publish the new ones; staff are told to wait"""
    old = subprocess.run(['git', 'show', 'origin/main:nlo-cases-src/firestore.rules'], cwd=SRC.parent, capture_output=True, text=True, check=True).stdout.replace('__OWNER_EMAIL__', 'dr.test@example.com')
    assert 'invItems' not in old
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
    btn = pg.query_selector('[data-act="placeOrder"][data-v="SunSurgical"]')
    check('cart: place button for SunSurgical', btn is not None)
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
        check('place: line keeps who added it', ln.get('addedBy') == 'Sarah B.' and ln.get('unit') == 'case' and ln.get('per') == 10, ln)
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
        # reopen as someone who doesn't change settings: refused (the page, and the database too); as Sarah: works, and twice is refused
        J(pg, "go('orders'); openDrawer('order', '%s')" % o['id']); pg.wait_for_timeout(200)
        click(pg, '[data-act="orderReopen"]', 300)
        check('reopen: Kaylee refused', 'can reopen' in toasts(pg), toasts(pg))
        r = J(pg, "B.claimOrder('%s', cur => cur === 'received' ? 'open' : undefined).then(()=>'went through', e=>e.code || e.message)" % o['id'])
        check('reopen: the database refuses Kaylee too', 'permission' in r, r)
        switch_to(pg, 'sarah')
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
    check('place/receive: no page errors (but the refusal tried on purpose)', not [e for e in errs if 'PERMISSION_DENIED' not in e and not re.search(r'HTTP 403 .*documents:commit', e)], errs)
    ctx.close()

@test
def t_legacy_orders(b):
    ctx, pg, errs = open_as(b, 'gwen')
    J(pg, "go('orders')"); pg.wait_for_timeout(200)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('legacy order: shows ordered by Sarah B. by phone', 'Sarah B.' in txt and 'by phone' in txt, txt[:400])
    J(pg, "go('activity')"); pg.wait_for_timeout(200)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('activity: legacy order in feed', 'Sarah B. placed the Henry Schein order' in txt, txt[:600])
    check('activity: old receive with who', 'Kaylee D. received the American Orthodontics order' in txt, txt[:800])
    J(pg, "go('orders')"); pg.wait_for_timeout(100)
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
def t_admin(b):
    """budget, vendors, settings: Dr. A and the people he ticks — the page asks no one's name, and the database holds the rest to it"""
    ctx, pg, errs = open_as(b, 'kaylee')
    J(pg, "go('budget')"); pg.wait_for_timeout(150)
    click(pg, '[data-act="budgetEdit"]', 300)
    check('admin: Kaylee can’t edit the budget', J(pg, "!document.querySelector('#bMonthly')") and 'can change budget' in toasts(pg), toasts(pg))
    r = J(pg, "B.budget({ monthly: 1 }).then(()=>'went through', e=>e.code || e.message)")
    check('admin: …and the database refuses her too', 'permission' in r, r)
    r = J(pg, "B.setSetting('invAdmins', ['kaylee']).then(()=>'went through', e=>e.code || e.message)")
    check('admin: she can’t make herself one', 'permission' in r, r)
    J(pg, "go('budget')"); pg.wait_for_timeout(150)
    J(pg, "ACT.expenseAdd()"); pg.wait_for_timeout(250)
    pg.fill('#exAmt', '12.40'); pg.fill('#exVendor', 'Walmart')
    click(pg, '[data-act="expenseSave"]', 600)
    bud = store('nlo/budget')
    ex = [x for x in (bud.get('expenses') or []) if x.get('vendor') == 'Walmart']
    check('admin: Kaylee can add an expense, stamped', len(ex) == 1 and ex[0].get('by') == 'Kaylee D.' and ex[0].get('byId') == 'kaylee', bud.get('expenses'))
    check('admin: …a record of its own, in her name', any(x.get('vendor') == 'Walmart' and x.get('upBy') == 'kaylee' and x.get('byId') == 'kaylee' for x in query('invExpenses').values()), query('invExpenses'))
    check('admin: she can take off her own (the button), not someone else’s', J(pg, "!!document.querySelector('[data-act=expenseDel][data-id=\"%s\"]')" % ex[0]['id']) and not J(pg, "!!document.querySelector('[data-act=expenseDel][data-id=\"x1\"]')"))
    r = J(pg, "B.removeExpense('x1').then(()=>'went through', e=>e.code || e.message)")
    check('admin: …and the database refuses her someone else’s', 'permission' in r and 'x1' in query('invExpenses'), r)
    switch_to(pg, 'sarah')
    J(pg, "go('budget')"); pg.wait_for_timeout(150)
    click(pg, '[data-act="budgetEdit"]', 300)
    check('admin: Sarah can', J(pg, "!!document.querySelector('#bMonthly')"))
    J(pg, "document.querySelector('#bMonthly').value = '8500'")
    click(pg, '[data-act="budgetSave"]', 600)
    bud = store('nlo/budget')
    check('budget: saved, expenses kept', bud.get('monthly') == 8500 and len(bud.get('expenses') or []) == 2 and bud.get('changedBy') == 'Sarah B.', bud)
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    check('settings: Sarah sees the list but can’t change it', J(pg, "[...document.querySelectorAll('[data-chg=adminTick]')].every(i => i.disabled)"))
    switch_to(pg, 'amir')
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    names = J(pg, "[...document.querySelectorAll('[data-chg=adminTick]')].map(i => i.value + (i.checked ? '+' : '-') + (i.disabled ? 'd' : ''))")
    check('settings: Dr. A ticks who changes settings (he’s always in)', names == ['amir+d', 'gwen-', 'kaylee-', 'nina-', 'sarah+'], names)
    c2, p2, e2 = open_as(b, 'kaylee')
    J(pg, "const i = document.querySelector('[data-chg=adminTick][value=kaylee]'); i.checked = true; i.dispatchEvent(new Event('change', {bubbles: true}))"); settle(pg, 800)
    check('settings: saved by staff id', (store('nlo/settings') or {}).get('invAdmins') == ['amir', 'kaylee', 'sarah'], store('nlo/settings'))
    check('settings: Kaylee’s open page knows at once', J(p2, "isAdmin()") is True)
    r = J(p2, "B.budget({ monthly: 8600 }).then(()=>'went through', e=>e.code || e.message)")
    check('settings: now the database lets her change the budget', r == 'went through', r)
    check('admin: no page errors (but the refusals tried on purpose)', not [e for e in errs + e2 if 'PERMISSION_DENIED' not in e and not re.search(r'HTTP 403 .*documents:commit', e)], errs + e2)
    ctx.close(); c2.close()

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
    ctx, pg, errs = open_as(b, 'gwen', w=390, h=844)
    for v in ['home', 'supplies', 'cart', 'orders', 'budget', 'activity', 'vendors', 'settings']:
        J(pg, "go('%s')" % v); pg.wait_for_timeout(150)
        ow = J(pg, "document.documentElement.scrollWidth > window.innerWidth + 1")
        check('phone: no sideways scroll on ' + v, not ow, J(pg, "[document.documentElement.scrollWidth, window.innerWidth]"))
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
    ids = J(pg, "[...document.querySelectorAll('[data-case]')].map(i => i.dataset.case)")
    check('case helper: lists the gloves still bought by the box', sorted(ids) == ['ppe-1', 'ppe-2'], ids)
    check('case helper: names the one already set up', 'Gloves Nitrile Black' in J(pg, "document.querySelector('#view').textContent"))
    click(pg, '[data-act="caseApply"]', 400)
    check('case helper: Kaylee can’t', 'can change how supplies are bought' in toasts(pg) and not store('nlo/items/ppe-1').get('buyUnit'), toasts(pg))
    switch_to(pg, 'sarah')
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    click(pg, '[data-act="caseApply"]', 1000)
    i1 = store('nlo/items/ppe-1'); i2 = store('nlo/items/ppe-2')
    check('case helper: both bought by the case of 10, counted in boxes', all(i.get('buyUnit') == 'case' and i.get('perBuy') == 10 and i.get('unit') == 'box' for i in (i1, i2)), [{k: i.get(k) for k in ['buyUnit', 'perBuy', 'unit']} for i in (i1, i2)])
    s1 = (i1.get('sources') or [{}])[0]; s2 = (i2.get('sources') or [{}])[0]
    check('case helper: prices stay per box', abs((s1.get('price') or 0) - 9.13) < 1e-6 and abs((s2.get('price') or 0) - 9.13) < 1e-6 and s2.get('vendor') == 'SunSurgical', [s1, s2])
    check('case helper: counts untouched, stamped by Sarah', i1.get('qty') == 14 and i2.get('qty') == 6 and i1.get('updatedBy') == 'Sarah B.', {k: i1.get(k) for k in ['qty', 'updatedBy']})
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
    check('cart: change stamped', any(t.get('t') == 'unit' and t.get('by') == 'Sarah B.' for t in (l1.get('trail') or [])), l1.get('trail'))
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
    ctx, pg, errs = open_as(b, 'sarah')
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
    ctx, pg, errs = open_as(b, 'gwen')
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
    J(pg, "go('activity')"); pg.wait_for_timeout(300)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('stamps: Activity shows her name on it', 'Gwen R. used' in txt and 'Sarah B. used' not in txt, txt[:500])
    r = J(pg, "B.patchOrder('order-old1', { trail: trailAdd(orderById('order-old1').trail, 'edited', { by: 'Sarah B.', byId: 'sarah', at: nowISO() }) }).then(()=>'went through', e=>e.code || e.message)")
    check('stamps: an order step in someone else’s name is refused', 'permission' in r, r)
    J(pg, "editOrder('order-old1', { note: 'Leave at the back door' }, 'note')"); settle(pg, 400)
    o = store('nlo/orders/order-old1') or {}
    check('stamps: her own step on it goes in', o.get('note') == 'Leave at the back door' and (o.get('trail') or [{}])[-1].get('byId') == 'gwen', o.get('trail'))
    r = J(pg, "B.patchOrder('order-old1', { trail: [] }).then(()=>'went through', e=>e.code || e.message)")
    check('stamps: wiping an order’s trail is refused', 'permission' in r, r)
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
    J(pg, "go('vendors')"); pg.wait_for_timeout(300)
    check('vendors: a website that isn’t a web address isn’t a link', J(pg, "![...document.querySelectorAll('#view a[href]')].some(a => /^javascript:/i.test(a.getAttribute('href')))") and 'javascript:alert(1)' in J(pg, "document.querySelector('#view').textContent"))
    # a voided order back: for the people who void them
    switch_to(pg, 'sarah')
    J(pg, "voidOrder('abc123', 'test')"); settle(pg, 400)
    switch_to(pg, 'gwen')
    J(pg, "go('orders'); openDrawer('order', 'abc123')"); pg.wait_for_timeout(300)
    click(pg, '[data-act="orderUnvoid"]', 300)
    check('voided: Gwen is told who can bring it back', 'can bring back a voided order' in toasts(pg) and (store('nlo/orders/abc123') or {}).get('status') == 'voided', toasts(pg))
    switch_to(pg, 'sarah')
    J(pg, "go('orders'); openDrawer('order', 'abc123')"); pg.wait_for_timeout(300)
    click(pg, '[data-act="orderUnvoid"]', 600)
    check('voided: Sarah brings it back', (store('nlo/orders/abc123') or {}).get('status') == 'open')
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
def t_demo(b):
    """the demo page: made-up office, nothing saved, every screen for each kind of person"""
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}); pg = ctx.new_page(); errs = []
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://www\.google\.com/s2/favicons.*'), lambda r: r.abort())
    pg.on('pageerror', lambda e: errs.append(str(e)[:300])); pg.on('console', lambda m: errs.append(m.text[:300]) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.goto('file://' + str(DIST / 'demo-page.html')); pg.wait_for_selector('#lgBtn')
    for k, who in enumerate(['amir', 'sarah', 'gwen']):
        J(pg, "document.querySelector('[data-act=demoAs][data-as=%s]').click()" % who); pg.click('#lgBtn')
        pg.wait_for_function("() => S.inApp && allLoaded()", timeout=10000)
        for v in ['home', 'supplies', 'cart', 'orders', 'quick', 'budget', 'activity', 'vendors', 'settings']:
            J(pg, "go('%s')" % v); pg.wait_for_timeout(120)
            check('demo (%s): %s renders' % (who, v), not J(pg, "document.querySelector('#view').textContent.includes('hit a problem')"), J(pg, "document.querySelector('#view').textContent.slice(0,200)"))
        J(pg, "cartAdd(activeItems().filter(i => !inCartLine(i.id))[%d], 1, {})" % k); pg.wait_for_timeout(200)
        check('demo (%s): adding to the cart works, stamped' % who, J(pg, "S.D.cart.some(c => c.addedById === %s)" % json.dumps(who)))
        check('demo (%s): changes settings: %s' % (who, who != 'gwen'), J(pg, "isAdmin()") == (who != 'gwen'))
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
