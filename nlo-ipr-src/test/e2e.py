"""End to end: the real pages (dist/IPR_Tracker.html?emu, the old page kept beside it, and NLO Cases for setting up the office)
on the Firebase emulators (Firestore, Auth and the Realtime Database), under the shared rules. A made-up office is set up in NLO
Cases (owner, two staff, a few cases with chart #s), and the old IPR Tracker's database holds records shaped as IPR Tracker 3
wrote them. Dr. A publishes the rules and moves the records through the page; staff then chart, look patients up by name,
lock, come back; at the end Dr. A removes the old copy.
    python3 build.py && (cd ../nlo-cases-src && python3 build.py)
    ../nlo-cases-src/node_modules/.bin/firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases --config ../nlo-cases-src/firebase.json "python3 test/e2e.py"
Needs Python Playwright with Chromium, and the pinned Firebase files in test/vendor/firebasejs-10.12.2/ (npm pack
firebase@10.12.2: firebase-app-compat.js, -auth-, -firestore-, -database-). Made-up people only."""
import json, os, re, sys, time, shutil, threading, functools, http.server, urllib.request, urllib.error, pathlib, traceback, subprocess
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent
DIST = SRC / 'dist'
CASES_DIST = SRC.parent / 'nlo-cases-src' / 'dist'
WWW = HERE / 'www'
VENDOR = HERE / 'vendor' / 'firebasejs-10.12.2'
P = 'demo-nlo-cases'
FS = 'http://127.0.0.1:8080/v1/projects/' + P + '/databases/(default)/documents'
AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
RT = 'http://127.0.0.1:9000'
PORT = 8796
BASE = 'http://127.0.0.1:%d/' % PORT
IPR = BASE + 'IPR_Tracker.html?emu'
CASES = BASE + 'nlo-cases.html?emu'
os.environ['NO_PROXY'] = os.environ['no_proxy'] = '127.0.0.1,localhost'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
OWNER_EMAIL, OWNER_PW = 'dr.test@example.com', 'Owner-Pass-123'
PW = {'gwen': 'Gwen-Pass-2026', 'kaylee': 'Kaylee-Pass-2026'}
TEMP = {}
OWNER_SID = ['']

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:900]), flush=True)
def section(t): print('\n# ' + t, flush=True)
SHOTS = os.environ.get('SHOTS', '')
def shot(pg, name, full=False):
    """a picture for looking the screens over (SHOTS=<folder>)"""
    if SHOTS:
        pathlib.Path(SHOTS).mkdir(parents=True, exist_ok=True); pg.wait_for_timeout(250)
        pg.screenshot(path=str(pathlib.Path(SHOTS) / (name + '.png')), full_page=full)

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
def F(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: F(x) for k, x in v.items()}}}
    raise Exception(v)
def plain(fields): return {k: V(x) for k, x in (fields or {}).items()}
def raw_docs(coll):
    c, j = req('POST', FS + ':runQuery', {'structuredQuery': {'from': [{'collectionId': coll}]}})
    return [x['document'] for x in (j or []) if isinstance(x, dict) and 'document' in x]
def query(coll): return {d['name'].split('/')[-1]: plain(d.get('fields')) for d in raw_docs(coll)}
def get(path):
    c, j = req('GET', FS + '/' + path)
    return plain(j.get('fields')) if c == 200 else None
def patch_field(path, field, value): return req('PATCH', FS + '/' + path + '?updateMask.fieldPaths=' + field, {'fields': {field: F(value)}})
def rt(method, path, body=None): return req(method, RT + path + '.json?ns=' + P, body)
def set_rules(text):
    c, j = req('PUT', 'http://127.0.0.1:8080/emulator/v1/projects/' + P + ':securityRules', {'rules': {'files': [{'name': 'firestore.rules', 'content': text}]}})
    assert c == 200, j
def verify_email(email):
    c, j = req('GET', 'http://127.0.0.1:9099/emulator/v1/projects/' + P + '/oobCodes', token='')
    codes = [x for x in (j or {}).get('oobCodes', []) if x.get('email') == email and x.get('requestType') == 'VERIFY_EMAIL']
    assert codes, 'no verify email'
    opener.open(codes[-1]['oobLink']).read()
def signup(email, pw, verified=False):
    c, j = req('POST', AUTH + '/accounts:signUp?key=any', {'email': email, 'password': pw, 'returnSecureToken': True}, token='')
    if verified:   # (a Google sign-in's email is verified; the old database's rules ask for that)
        c2, j2 = req('POST', AUTH + '/projects/' + P + '/accounts:update', {'localId': j['localId'], 'emailVerified': True}); assert c2 == 200, j2
    return j['localId']
def id_token(email, pw):
    c, j = req('POST', AUTH + '/accounts:signInWithPassword?key=any', {'email': email, 'password': pw, 'returnSecureToken': True}, token='')
    assert c == 200, j; return j['idToken']
def rt_as(tok, method, path, body=None):
    """the old database as someone signed in (its rules apply)"""
    return req(method, RT + path + '.json?ns=' + P + '&auth=' + tok, body, token='')
# the old database's rules as they are live (27 Sep 2026: nlo/ipr open to Dr. A and the office's own verified Google accounts),
# with the test's owner address in Dr. A's place; and the same rules after the lock (../../tools/rtdb-rules-ipr-lock.py)
import importlib.util
sys.dont_write_bytecode = True   # (no __pycache__ next to the published tools/ script)
_spec = importlib.util.spec_from_file_location('lock', SRC.parent / 'tools' / 'rtdb-rules-ipr-lock.py')
LOCK = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(LOCK)
STAFF_RULE = "auth != null && auth.token.email_verified == true && (auth.token.email === 'dr.test@example.com' || auth.token.email.endsWith('@thenextlevelorthodontics.com'))"
RT_RULES = {'rules': {'nlo': {'cadence': {'.read': STAFF_RULE, '.write': STAFF_RULE}, 'ipr': {'.read': STAFF_RULE, '.write': STAFF_RULE}}}}
def set_rt_rules(rules):
    c, j = req('PUT', RT + '/.settings/rules.json?ns=' + P, rules); assert c == 200, j
STAFF_EMAIL, STAFF_PW = 'staff@thenextlevelorthodontics.com', 'old-page-pass-1'
def old_login(pg):
    """the page's connection to the old database, signed in as Dr. A (on the emulator: his test address, verified)"""
    return J(pg, "async a => { OLD.init(); await OLD.auth.signInWithEmailAndPassword(a[0], a[1]); return OLD.auth.currentUser.email; }", [OWNER_EMAIL, OWNER_PW])

# ---------- the old IPR Tracker's records (IPR Tracker 3's shapes) ----------
def contacts(teeth, vals):
    o = {teeth[i] + '|' + teeth[i + 1]: '' for i in range(len(teeth) - 1)}; o.update(vals); return o
UP = ["UR7", "UR6", "UR5", "UR4", "UR3", "UR2", "UR1", "UL1", "UL2", "UL3", "UL4", "UL5", "UL6", "UL7"]
LO = ["LR7", "LR6", "LR5", "LR4", "LR3", "LR2", "LR1", "LL1", "LL2", "LL3", "LL4", "LL5", "LL6", "LL7"]
def bt(teeth, keys): o = {teeth[i] + '|' + teeth[i + 1]: False for i in range(len(teeth) - 1)}; o.update({k: True for k in keys}); return o
def visit(vid, pid, date, asst, up, lo, notes='', sp=None, bts=None, missing=None):
    return {'id': vid, 'patient_uuid': pid, 'date': date, 'assistant_initials': asst, 'gauge_verified': True,
            'upper_ipr': contacts(UP, up), 'lower_ipr': contacts(LO, lo), 'upper_spaces': contacts(UP, sp or {}), 'lower_spaces': contacts(LO, {}),
            'upper_bt': bt(UP, bts or []), 'lower_bt': bt(LO, []), 'notes': notes, 'prescribed_upper': contacts(UP, {}), 'prescribed_lower': contacts(LO, {}),
            'missing_teeth': missing or {}, 'created_at': date + 'T15:00:00.000Z'}
OLD = {'patients': {
    'pt-jane': {'id': 'pt-jane', 'name': 'JD', 'patient_id': '15-6541', 'created_at': '2026-03-02T14:00:00.000Z'},
    'pt-mark': {'id': 'pt-mark', 'name': 'MS', 'patient_id': '1234567', 'created_at': '2026-03-09T14:00:00.000Z'},   # NLO Cases writes 123-4567
    'pt-carl': {'id': 'pt-carl', 'name': 'AB', 'patient_id': '777', 'created_at': '2026-04-01T14:00:00.000Z'},       # NLO Cases: a name that doesn't fit
    'pt-noini': {'id': 'pt-noini', 'name': '888-1', 'patient_id': '888-1', 'created_at': '2026-04-02T14:00:00.000Z'},  # no initials were typed
    'pt-two': {'id': 'pt-two', 'name': 'QQ', 'patient_id': '999', 'created_at': '2026-04-03T14:00:00.000Z'}},       # NLO Cases has two names
  'visits': {
    'pt-jane': {'v-j1': visit('v-j1', 'pt-jane', '2026-03-02', 'Gwen', {'UR1|UL1': '0.2', 'UL1|UL2': '0.3'}, {'LR1|LL1': '0.1'}, 'first visit notes', {'UR2|UR1': '0.5'}, ['UR1|UL1'], {'UL7': True}),
                'v-j2': visit('v-j2', 'pt-jane', '2026-04-06', 'Kaylee', {'UR2|UR1': '0.2'}, {}, 'second visit notes')},
    'pt-mark': {'v-m1': visit('v-m1', 'pt-mark', '2026-03-09', 'Gwen', {'UR3|UR2': '0.3'}, {'LL1|LL2': '0.2'})},
    'pt-carl': {'v-c1': visit('v-c1', 'pt-carl', '2026-04-01', 'Dr. A', {}, {'LR2|LR1': '0.4'})},
    'pt-ghost': {'v-g1': visit('v-g1', 'pt-ghost', '2026-04-05', 'Gwen', {'UR1|UL1': '0.1'}, {})}}}
CASE_LIST = [('Jane Doe', '15-6541'), ('Mark Smith', '123-4567'), ('Carl Zed', '777'), ('Quinn Quill', '999'), ('Quincy Quell', '999'), ('Nora New', '55-1234')]
PHI = ['Jane Doe', 'Mark Smith', 'Carl Zed', 'Nora New', 'Alice Brown', 'Olga Ott', 'Pat Two', '15-6541', '1234567', '123-4567', '55-1234', 'first visit notes', 'second visit notes']

# ---------- the pages ----------
def serve():
    if WWW.exists(): shutil.rmtree(WWW)
    WWW.mkdir()
    for f in ['IPR_Tracker.html', 'logo-white.png', 'nlo-home.js', 'nlo-aisa.js']: shutil.copy(DIST / f, WWW / f)
    shutil.copy(CASES_DIST / 'nlo-cases.html', WWW / 'nlo-cases.html')
    # the old page, as published, but on the emulators (the test signs it in with an office email account)
    old = (DIST / 'IPR_Tracker_old.html').read_text()
    a = old.index('const firebaseConfig = {'); b = old.index('};', a) + 2
    old = old[:a] + 'const firebaseConfig = { apiKey: "demo-key", authDomain: "localhost", databaseURL: "https://demo-nlo-cases.firebaseio.com", projectId: "demo-nlo-cases", appId: "demo" };' + old[b:]
    old = old.replace('const fbDB = firebase.database();', 'const fbDB = firebase.database(); fbAuth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true }); fbDB.useEmulator("127.0.0.1", 9000);', 1)
    (WWW / 'IPR_Tracker_old.html').write_text(old)
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WWW))
    h.log_message = lambda *a: None
    s = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s
FS_CHANNEL = re.compile(r'/google\.firestore\.v1\.Firestore/(Listen|Write)/channel')
PAGES = []
def new_page(b, label, w=1366, h=900, quiet_perm=False):
    ctx = b.new_context(viewport={'width': w, 'height': h})
    ctx.route(re.compile(r'https://www\.gstatic\.com/firebasejs/10\.12\.[02]/.*'), lambda r: r.fulfill(path=str(VENDOR / r.request.url.rsplit('/', 1)[1]), content_type='text/javascript', headers={'Access-Control-Allow-Origin': '*'}))
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    ctx.route(re.compile(r'https://aisa-worker\.akhavan-ak\.workers\.dev/.*'), lambda r: r.fulfill(status=200, body='{}', content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}))
    ctx.route(re.compile(r'https://(apis\.google\.com|www\.google\.com|script\.google\.com)/.*'), lambda r: r.abort())
    pg = ctx.new_page(); errs = []
    def con(m):
        if m.type != 'error': return
        t = m.text
        if 'Failed to load resource' in t: return
        if quiet_perm and ('PERMISSION_DENIED' in t or 'permission' in t.lower()): return
        errs.append(label + ' console: ' + t[:300])
    pg.on('pageerror', lambda e: errs.append(label + ' pageerror: ' + str(e)[:300]))
    pg.on('console', con)
    pg.on('dialog', lambda d: d.accept())
    pg.on('response', lambda r: errs.append(label + ' HTTP %d %s' % (r.status, r.url[:140])) if r.status >= 400 and not (r.status == 400 and FS_CHANNEL.search(r.url)) and not quiet_perm else None)
    PAGES.append((label, errs))
    return ctx, pg, errs
def J(pg, js, arg=None): return pg.evaluate(js) if arg is None else pg.evaluate(js, arg)
def sign_in(pg, user, pw, url=IPR, go=True):
    if go: pg.goto(url, wait_until='load')
    pg.wait_for_selector('#lgUser', timeout=20000)
    pg.fill('#lgUser', user); pg.fill('#lgPw', pw); pg.click('#lgBtn')
def wait_gate(pg, st, ms=20000): pg.wait_for_function("st => S.inApp && S.gate === st", arg=st, timeout=ms)
def wait_app(pg, ms=25000):
    pg.wait_for_function("() => S.inApp && S.mounted && IP.ready && !!document.querySelector('#root .ip-app')", timeout=ms); pg.wait_for_timeout(300)
def settle(pg, ms=300):
    pg.wait_for_function("() => !B.pending", timeout=20000); pg.wait_for_timeout(ms)
def txt(pg, sel='body'): return J(pg, "s => (document.querySelector(s) || {}).textContent || ''", sel)
def open_vault(pg):
    """the sealed records, opened in the page (with this login's office key) — what the tests compare"""
    return J(pg, """async () => { const e = await FB.everything(); const o = { pts: {}, vis: {}, bad: e.bad };
      e.pts.forEach((x, id) => { o.pts[id] = { body: x.body, rev: x.d.rev, pc: x.d.pc || null, sid: x.d.sid }; });
      e.vis.forEach((x, id) => { o.vis[id] = { body: x.body, rev: x.d.rev, p: x.d.p, sid: x.d.sid }; }); return o; }""")
def tap(pg, arch, contact):
    pg.click('.ip-arches section[data-arch="%s"] input[data-contact="%s"]' % (arch, contact)); pg.wait_for_timeout(150)
def wizard(pg): pg.click('.ip-actions .ip-btn.primary'); pg.wait_for_selector('.ip-dialog', timeout=8000)
def menu(pg, label):
    pg.click('.ip-menu-wrap > button'); pg.wait_for_selector('.ip-menu')
    pg.click('.ip-menu button:has-text("%s")' % label)
def search_open(pg, q, pick):
    wizard(pg); pg.click('.ip-opt:has-text("Search existing patient")')
    pg.fill('.ip-dialog .ip-search input', q); pg.wait_for_selector('.ip-result:has-text("%s")' % pick, timeout=8000)
    pg.click('.ip-result:has-text("%s")' % pick); pg.wait_for_selector('.ip-dialog .ip-dlg-h:has-text("Select visit")', timeout=8000)

# ======================================================================
def run(b):
    section('The office is set up in NLO Cases (made-up people), with a few cases')
    oc, owner_cases, e0 = new_page(b, 'ownerCases')
    owner_cases.goto(CASES + '#setup'); owner_cases.wait_for_selector('#setupForm', timeout=30000)
    owner_cases.fill('#suEmail', OWNER_EMAIL); owner_cases.fill('#suPw1', OWNER_PW); owner_cases.fill('#suPw2', OWNER_PW)
    owner_cases.click('#setupForm button[type=submit]'); owner_cases.wait_for_selector('#verifyForm', timeout=30000)
    verify_email(OWNER_EMAIL); owner_cases.click('#verifyForm button[type=submit]')
    owner_cases.wait_for_selector('#recShow', timeout=30000); owner_cases.check('#codeAck'); owner_cases.click('#codeDone')
    owner_cases.wait_for_selector('#app:not(.hidden) .topBar', timeout=30000)
    J(owner_cases, "setInterval(() => { S.lastAct = Date.now(); }, 5000)")   # (it stays signed in while the test runs)
    for name, un in [('Gwen Reed', 'gwen'), ('Kaylee Dunn', 'kaylee')]:
        TEMP[un] = J(owner_cases, "a => B.addStaff(a[0], a[1], '').then(r => r.temp)", [name, un])
    owner_cases.wait_for_function("() => FB.idxOn", timeout=10000)
    for name, chart in CASE_LIST:
        J(owner_cases, "a => B.createCase({ patient: a[0], chart: a[1], type: 'Retainer', notes: '' })", [name, chart])
    check('office set up: owner, Gwen and Kaylee, and %d cases with the patient index' % len(CASE_LIST), len([d for d in query('cases').values() if d.get('pc')]) == len(CASE_LIST), len(query('cases')))
    c, j = rt('PUT', '/nlo/ipr', OLD); assert c == 200, j

    section('Before the rules are published (the live rules are the ones without the IPR Tracker)')
    # (the rules live before this update: the ones in main — on GitHub Pages — until it's merged; LIVE_RULES_REF=<ref> to pick)
    old_rules = subprocess.run(['git', 'show', os.environ.get('LIVE_RULES_REF', 'origin/main') + ':nlo-cases-src/firestore.rules'], cwd=str(SRC.parent), capture_output=True, text=True, check=True).stdout.replace('__OWNER_EMAIL__', OWNER_EMAIL)
    assert 'iprPts' not in old_rules
    set_rules(old_rules)
    gc, gwen, ge = new_page(b, 'gwen', quiet_perm=True)
    gwen.goto(BASE + 'IPR_Tracker.html?emu#chart=15-6541', wait_until='load')
    check('the link from NLO Cases is taken out of the address at once', '#' not in gwen.url and J(gwen, "S.deep && S.deep.chart") == '15-6541', gwen.url)
    sign_in(gwen, 'gwen', TEMP['gwen'], go=False)
    gwen.wait_for_selector('#firstForm', timeout=30000)
    check('first sign-in with a temporary password: choose a password (it’s the NLO Cases one too)', 'Choose your own password' in txt(gwen, '#lockCard'))
    shot(gwen, '01-first-password')
    gwen.fill('#fpw1', PW['gwen']); gwen.fill('#fpw2', PW['gwen']); gwen.click('#fBtn')
    wait_gate(gwen, 'rules'); shot(gwen, '02-staff-rules')
    t = txt(gwen, '#gateCard')
    check('staff, rules not live: "isn’t ready yet", with the old IPR Tracker', 'isn’t ready yet' in t and J(gwen, "!!document.querySelector('#gateCard a[href^=\"IPR_Tracker_old.html\"]')"), t[:300])
    check('…the old IPR Tracker link carries the NLO Cases link’s chart #', J(gwen, "document.querySelector('#gateCard a[href^=\"IPR_Tracker_old.html\"]').getAttribute('href')") == 'IPR_Tracker_old.html#chart=15-6541')
    check('…and nothing about any patient is on the page', all(x not in J(gwen, "document.body.innerText") for x in PHI))
    check('NLO Cases, rules not live: it keeps the old IPR link', J(owner_cases, "iprMovedCheck(true).then(m => [m, iprLink() === IPR])") == [False, True])
    check('NLO Cases’ IPR button links the chart # only (no initials)', J(owner_cases, "iprDeepUrl('15-6541')") == 'IPR_Tracker.html#chart=15-6541')
    owc, own, oe = new_page(b, 'owner', quiet_perm=True)
    own.goto(IPR, wait_until='load'); own.wait_for_selector('#lgUser'); shot(own, '00-sign-in')
    sign_in(own, OWNER_EMAIL, OWNER_PW, go=False); wait_gate(own, 'rules'); shot(own, '03-owner-rules', True)
    t = txt(own, '#gateCard')
    check('owner, rules not live: the rules card', 'One step before the IPR Tracker can open' in t and 'Copy the new rules' in t, t[:300])
    rules_txt = J(own, "document.querySelector('#rulesTxt').value")
    check('…its rules are the shared file, the owner’s email filled in', 'match /iprPts/{id}' in rules_txt and 'match /cases/{id}' in rules_txt and OWNER_EMAIL in rules_txt and '__OWNER_EMAIL__' not in rules_txt)
    new_rules = (DIST / 'firestore.rules').read_text()
    check('…exactly the rules this build tests with', rules_txt.replace(OWNER_EMAIL, 'dr.test@example.com') == new_rules)

    section('Rules published; the records haven’t moved')
    set_rules(new_rules)
    own.click('[data-act="retryOpen"]'); wait_gate(own, 'move')
    check('owner: the move card', J(own, "!!document.querySelector('.moveCard')") and 'Connect to the old IPR Tracker' in txt(own, '.moveCard'))
    gwen.click('[data-act="retryOpen"]'); wait_gate(gwen, 'notyet'); shot(gwen, '04-staff-notyet')
    check('NLO Cases, rules live but nothing moved yet: still the old IPR link', J(owner_cases, "iprMovedCheck(true).then(m => [m, iprLink() === IPR])") == [False, True])
    check('staff: "moving to your NLO Cases login", with the old IPR Tracker', 'moving to your NLO Cases login' in txt(gwen, '#gateCard') and J(gwen, "!!document.querySelector('#gateCard a[href^=\"IPR_Tracker_old.html\"]')"))

    signup(STAFF_EMAIL, STAFF_PW, verified=True)
    xc, xp, xe = new_page(b, 'oldPageBefore', quiet_perm=True)
    xp.goto(BASE + 'IPR_Tracker_old.html?emu', wait_until='load')
    xp.evaluate("a => fbAuth.signInWithEmailAndPassword(a[0], a[1])", [STAFF_EMAIL, STAFF_PW])
    xp.wait_for_selector('#root .ip-app', timeout=20000); xp.wait_for_timeout(500)
    check('the old IPR Tracker (kept beside it) still works until the move', 'IPR_Tracker_old.html' in xp.url and xp.title() == 'IPR Tracker (old)' and J(xp, "!document.getElementById('iprMovedBar')"))
    check('…and saves there (under the old database’s live rules, with a staff Google account)', J(xp, "sbPatch('visits?id=eq.v-j2', { patient_uuid: 'pt-jane', notes: 'second visit notes' }).then(() => 'saved', e => String(e))") == 'saved')
    xold = (xc, xp)

    section('The move')
    check('the move card: Dr. A connects with his Google account', old_login(own) == OWNER_EMAIL)
    J(own, "() => { MV.who = OLD.auth.currentUser.email; renderGate(); }")
    own.click('[data-act="mvRead"]')
    own.wait_for_function("() => MV.step === 'ready' || MV.err", timeout=30000)
    check('move: read the old IPR Tracker', J(own, "MV.step") == 'ready', J(own, "MV.err")); shot(own, '05-move-ready', True)
    c = J(own, "MV.plan.counts")
    check('move: 5 patients, 4 visits (a fifth belongs to no patient)', c['pts'] == 5 and c['vis'] == 4, c)
    check('move: 2 full names from NLO Cases (Jane Doe; Mark Smith, whose chart # NLO Cases writes with a dash)', c['named'] == 2, c)
    notes = J(own, "MV.plan.notes")
    check('move: a name that doesn’t fit the initials isn’t used; nor two names for one chart #; the visit with no patient stays', any('doesn’t fit the initials' in n for n in notes) and any('two different names' in n for n in notes) and any('to no patient' in n for n in notes), notes)
    t = txt(own, '.moveCard')
    check('move: the card shows what it found', 'Patients5' in t.replace(' ', '') and 'Visits4' in t.replace(' ', '') and '2026-03-02 – 2026-04-06' in t, t[:500])
    own.click('[data-act="mvGo"]'); own.wait_for_selector('#cbYes'); own.click('#cbYes')
    own.wait_for_function("() => MV.step === 'done' || MV.step === 'error'", timeout=90000)
    if J(own, "MV.step") == 'done': own.wait_for_selector('[data-act="mvOpen"]', timeout=10000)
    check('move: done, every record checked', J(own, "MV.step") == 'done', J(own, "MV.err")); shot(own, '06-move-done', True)
    t = txt(own, '.moveCard')
    check('move: the done card has the two steps left — the lock command for Cloud Shell, and Remove the old copy', 'rtdb-rules-ipr-lock.py' in t and 'Lock the old copy' in t and J(own, "!!document.querySelector('[data-act=\"mvRemove\"]') && !!document.querySelector('[data-act=\"mvCopyCmd\"]')"), t[:500])
    mv = get('iprMeta/moved') or {}
    OWNER_SID[0] = next(m.get('staffId') for m in query('members').values() if m.get('role') == 'owner')
    check('move: marked moved (by Dr. A; counts only)', mv.get('by') == OWNER_SID[0] and mv.get('pts') == 5 and mv.get('vis') == 4 and mv.get('named') == 2, mv)
    check('move: the old database has the mark that sends its page here; its records are untouched', (rt('GET', '/nlo/ipr/moved')[1] or {}).get('to') == 'IPR_Tracker.html' and len(rt('GET', '/nlo/ipr/patients')[1]) == 5 and len(rt('GET', '/nlo/ipr/visits/pt-jane')[1]) == 2)
    pts, vis = query('iprPts'), query('iprVis')
    check('move: 5 patient records and 4 visits, under their old ids', sorted(pts) == ['pt-carl', 'pt-jane', 'pt-mark', 'pt-noini', 'pt-two'] and sorted(vis) == ['v-c1', 'v-j1', 'v-j2', 'v-m1'], (sorted(pts), sorted(vis)))
    check('move: each with its history entry (rev 1, nothing before it)', all((get('iprPtLog/%s_1' % k) or {}).get('prev', 1) is None for k in pts) and all((get('iprVisLog/%s_1' % k) or {}).get('prev', 1) is None for k in vis))
    check('move: only sealed fields and the index on a patient', all(set(d) <= {'v', 'iv', 'ct', 'rev', 'by', 'sid', 'createdAt', 'updatedAt', 'pc'} and len(d.get('pc') or '') == 22 for d in pts.values()), pts['pt-jane'])
    check('move: a visit names only its patient’s record id', vis['v-j1'].get('p') == 'pt-jane' and set(vis['v-j1']) <= {'p', 'v', 'iv', 'ct', 'rev', 'by', 'sid', 'createdAt', 'updatedAt'})
    vault = open_vault(own)
    check('move: opened again — Jane Doe, chart # 15-6541, her initials kept', vault['pts']['pt-jane']['body'].get('name') == 'Jane Doe' and vault['pts']['pt-jane']['body'].get('chart') == '15-6541' and vault['pts']['pt-jane']['body'].get('ini') == 'JD', vault['pts']['pt-jane'])
    check('move: Mark Smith found through the dash NLO Cases writes', vault['pts']['pt-mark']['body'].get('name') == 'Mark Smith', vault['pts']['pt-mark'])
    check('move: AB kept as initials (NLO Cases’ name doesn’t fit), QQ too (two names), no initials → none', vault['pts']['pt-carl']['body'].get('name') == '' and vault['pts']['pt-two']['body'].get('name') == '' and 'ini' not in vault['pts']['pt-noini']['body'], [vault['pts'][k]['body'] for k in ['pt-carl', 'pt-two', 'pt-noini']])
    j1 = vault['vis']['v-j1']['body']; o1 = OLD['visits']['pt-jane']['v-j1']
    check('move: a visit’s fields exactly as the old one had them', all(j1.get(k) == o1[k] for k in o1 if k not in ('id', 'patient_uuid')) and 'patient_uuid' not in j1 and 'id' not in j1 and len(j1.get('oh') or '') == 32, {k: (j1.get(k), o1.get(k)) for k in o1 if j1.get(k) != o1.get(k)})
    check('move: the connection to the old database is closed', J(own, "!(OLD.auth && OLD.auth.currentUser)"))
    r = J(owner_cases, "iprMovedCheck(true).then(async m => { const r = await iprLink().latest('156541'); return [m, iprLink() === IPRS, r.status, r.visits, r.initials, r.date]; })")
    check('NLO Cases, once moved: reads the sealed records itself (no Google sign-in) — Jane Doe, 2 visits, the latest Apr 6', r == [True, True, 'ok', 2, 'Jane Doe', '2026-04-06'], r)
    r = J(owner_cases, "iprLink().latestMany(['15-6541', '123-4567', '000']).then(m => [m.get('156541').status, m.get('1234567').status, m.get('1234567').initials, m.get('000').status])")
    check('…every patient at once (Sync all), chart #s with or without dashes', r == ['ok', 'ok', 'Mark Smith', 'not-found'], r)
    check('…and Staff Hub’s roster keeps its Google link', J(owner_cases, "rosterLink() === IPR"))
    own.click('[data-act="mvOpen"]'); wait_app(own)
    J(own, "setInterval(() => { S.lastAct = Date.now(); }, 5000)")
    check('move: the IPR Tracker opens for Dr. A, with every patient', J(own, "IP.pts.size") == 5)
    # a visit's sealed copy is bound to its patient's record too: one copied onto another patient's record opens for neither app
    c, rawv = req('GET', FS + '/iprVis/v-j1'); f = dict(rawv['fields']); f['p'] = {'stringValue': 'pt-mark'}
    c, j = req('PATCH', FS + '/iprVis/forged', {'fields': f}); assert c == 200, j
    r = J(own, "FB.visitsOf('pt-mark').then(r => r.map(x => x.id))"); rc = J(owner_cases, "IPRS.visits('pt-mark').then(r => r.map(x => x.date))")
    check('a sealed visit copied onto another patient’s record doesn’t open there (here or in NLO Cases)', r == ['v-m1'] and rc == ['2026-03-09'] and 'forged' in open_vault(own)['bad'], [r, rc])
    req('DELETE', FS + '/iprVis/forged')
    xold[1].wait_for_selector('#iprMovedBar', timeout=20000)
    check('an old page left open says the IPR Tracker has moved, with a button to the new one', 'has moved to your NLO Cases login' in txt(xold[1], '#iprMovedBar'))
    r = J(xold[1], "sbPatch('visits?id=eq.v-j2', { patient_uuid: 'pt-jane', notes: 'typed after the move' }).then(() => 'saved', e => String(e))")
    check('…and saves nothing more there (a page left open kept saving where nobody would see it)', 'no longer saves' in r and (rt('GET', '/nlo/ipr/visits/pt-jane/v-j2')[1] or {}).get('notes') == 'second visit notes', r)
    xold[0].close()

    section('Charting: staff, by full name')
    gwen.click('[data-act="retryOpen"]'); wait_app(gwen)
    shot(gwen, '07-select-visit')
    check('the NLO Cases link (from before signing in) opens Jane Doe’s visits', gwen.is_visible('.ip-dlg-h:has-text("Select visit")') and 'Jane Doe' in txt(gwen, '.ip-dialog'), txt(gwen, '.ip-dialog')[:200])
    t = txt(gwen, '.ip-dialog')
    check('…two visits on file, both shown', t.count('Upper ') >= 2 and 'Totalvisits2' in t.replace(' ', ''), t[:400])
    gwen.click('.ip-dialog button:has-text("Start new visit")'); gwen.wait_for_selector('.ip-strip')
    t = txt(gwen, '.ip-strip')
    check('the patient strip: her full name and chart #', 'Jane Doe' in t and 'Chart # 15-6541' in t, t)
    check('the assistant starts as the person signed in (Gwen)', J(gwen, "document.querySelector('#ip-asst').value") == 'Gwen')
    check('missing teeth carried forward from her last visit (none then)… and earlier IPR shown', J(gwen, "document.querySelectorAll('.ip-prev').length") >= 2)
    tap(gwen, 'upper', 'UR3|UR2')
    gwen.wait_for_function("() => /Saved /.test(document.querySelector('.ip-status').textContent)", timeout=15000); settle(gwen)
    vis = query('iprVis'); new = [k for k in vis if k not in ('v-c1', 'v-j1', 'v-j2', 'v-m1')]
    check('autosave: one new visit, under Jane’s record', len(new) == 1 and vis[new[0]].get('p') == 'pt-jane' and vis[new[0]].get('sid') == 'gwen', new)
    vid = new[0] if new else ''
    tap(gwen, 'lower', 'LR1|LL1'); gwen.wait_for_timeout(3200); settle(gwen)
    vb = open_vault(gwen)['vis'].get(vid) or {}
    check('the next change saves to the same visit (rev 2), its history holding the copy it replaced', vb.get('rev') == 2 and (vb.get('body') or {}).get('lower_ipr', {}).get('LR1|LL1') == '0.3' and (get('iprVisLog/%s_2' % vid) or {}).get('prev') is not None, vb)
    gwen.fill('#ip-notes', 'tight contacts'); gwen.wait_for_timeout(3200); settle(gwen); shot(gwen, '08-charting', True)
    raw = json.dumps({c: raw_docs(c) for c in ['iprPts', 'iprVis', 'iprPtLog', 'iprVisLog', 'iprMeta']})
    check('nothing readable about a patient in the database (names, chart #s, notes)', not [x for x in PHI + ['tight contacts'] if x in raw], [x for x in PHI if x in raw])

    r = J(owner_cases, "iprLink().latest('15-6541').then(r => [r.visits, r.date, /UR3–UR2 0\\.3mm/.test(r.note)])")
    check('NLO Cases sees the visit charted just now', r[0] == 3 and r[2] is True, r)

    section('Lock, and back to the same visit')
    menu(gwen, 'Lock'); gwen.wait_for_selector('#lgPw', timeout=20000)
    check('Lock: the sign-in screen, the page started over', 'Locked. Sign in to continue.' in txt(gwen, '#lockCard') and J(gwen, "typeof S !== 'undefined' && !S.inApp"))
    ss = J(gwen, "JSON.stringify(Object.assign({}, sessionStorage))")
    check('the tab keeps only a sealed draft (nothing readable)', 'iprDraft.v4' in ss and not [x for x in PHI + ['tight contacts', 'Gwen'] if x in ss.replace('iprDraft', '')], ss[:200])
    sign_in(gwen, 'gwen', PW['gwen'], go=False); wait_app(gwen)
    check('signed in again: Jane Doe’s visit is back on screen', 'Jane Doe' in txt(gwen, '.ip-strip') and J(gwen, "document.querySelector('#ip-notes').value") == 'tight contacts')
    tap(gwen, 'upper', 'UL1|UL2'); gwen.wait_for_timeout(3200); settle(gwen)
    vis2 = query('iprVis')
    check('…and the next change goes to that same visit (no second copy)', len(vis2) == len(vis) and (vis2.get(vid) or {}).get('rev', 0) >= 4, (len(vis2), len(vis), (vis2.get(vid) or {}).get('rev')))

    # a new visit locked a moment after its first changes (Amir's review: the lock's last save made the visit after the draft was
    # sealed, so after signing in again it counted as an earlier visit too, and the next change made a second copy)
    jane = lambda: sorted(k for k, x in query('iprVis').items() if x.get('p') == 'pt-jane')
    j_before = jane()
    wizard(gwen); gwen.click('.ip-opt:has-text("Search existing patient")'); gwen.fill('.ip-dialog .ip-search input', 'jane')
    gwen.wait_for_selector('.ip-result:has-text("Jane Doe")'); gwen.click('.ip-result:has-text("Jane Doe")')
    gwen.wait_for_selector('.ip-dialog button:has-text("Start new visit")'); gwen.click('.ip-dialog button:has-text("Start new visit")'); gwen.wait_for_selector('.ip-strip')
    tap(gwen, 'upper', 'UR4|UR3'); tap(gwen, 'lower', 'LR2|LR1')
    menu(gwen, 'Lock'); gwen.wait_for_selector('#lgPw', timeout=20000)
    j_after = jane(); new_v = [k for k in j_after if k not in j_before]
    check('Lock a moment after a new visit’s first changes: the lock saves it (one visit)', len(new_v) == 1, (j_before, j_after))
    sign_in(gwen, 'gwen', PW['gwen'], go=False); wait_app(gwen)
    gwen.wait_for_function("n => document.querySelector('.ip-strip') && document.querySelector('.ip-strip').textContent.includes(n + ' visits on file')", arg=len(j_after), timeout=10000)
    t = txt(gwen, '.ip-app')
    check('…signed in again: it’s the visit on screen, not also counted as an earlier one', ('Across all %d visits' % len(j_after)) in t, re.findall(r'Across all \d+ visits', t))
    tap(gwen, 'upper', 'UL2|UL3'); gwen.wait_for_timeout(3200); settle(gwen)
    vb = open_vault(gwen)['vis'].get(new_v[0] if new_v else '') or {}
    check('…and its next change updates that one visit (no second copy)', jane() == j_after and (vb.get('body') or {}).get('upper_ipr', {}).get('UL2|UL3') == '0.3' and (vb.get('body') or {}).get('lower_ipr', {}).get('LR2|LR1') == '0.3', (jane(), vb.get('rev')))

    # a draft from an earlier day (a tab locked last night) comes back read-only: today's taps never change yesterday's visit
    menu(gwen, 'Lock'); gwen.wait_for_selector('#lgPw', timeout=20000)
    J(gwen, "() => { const o = B.openDraft; B.openDraft = async s => { const d = await o(s); d.ipr_at = Date.now() - 30 * 3600e3; return d; }; }")
    sign_in(gwen, 'gwen', PW['gwen'], go=False); wait_app(gwen)
    check('a draft from an earlier day comes back read-only', gwen.is_visible('.ip-banner') and 'Jane Doe' in txt(gwen, '.ip-strip') and J(gwen, "document.querySelector('.ip-foot .ip-btn').disabled") is True, txt(gwen, '.ip-app')[:160])

    # a change that couldn't reach the database when the tab locked (the internet down) is saved after signing in again
    wizard(gwen); gwen.click('.ip-opt:has-text("Search existing patient")'); gwen.fill('.ip-dialog .ip-search input', 'smith')
    gwen.wait_for_selector('.ip-result:has-text("Mark Smith")'); gwen.click('.ip-result:has-text("Mark Smith")')
    gwen.wait_for_selector('.ip-dialog button:has-text("Start new visit")'); gwen.click('.ip-dialog button:has-text("Start new visit")'); gwen.wait_for_selector('.ip-strip')
    tap(gwen, 'upper', 'UR1|UL1'); gwen.wait_for_timeout(3200); settle(gwen)
    m_vid = J(gwen, "JSON.parse(JSON.stringify(Array.from(IP.made)))")[-1]
    gc.set_offline(True)
    tap(gwen, 'lower', 'LL1|LL2'); menu(gwen, 'Lock')
    gwen.wait_for_timeout(9500); gc.set_offline(False)
    gwen.goto(IPR, wait_until='load'); sign_in(gwen, 'gwen', PW['gwen'], go=False); wait_app(gwen)
    gwen.wait_for_timeout(1500); settle(gwen)
    vb = open_vault(gwen)['vis'].get(m_vid) or {}
    check('the internet down at the lock: the last change is saved once signed in again', (vb.get('body') or {}).get('lower_ipr', {}).get('LL1|LL2') == '0.3' and (vb.get('body') or {}).get('upper_ipr', {}).get('UR1|UL1') == '0.3', vb.get('body', {}).get('lower_ipr'))
    ge[:] = [e for e in ge if 'ERR_INTERNET_DISCONNECTED' not in e and 'offline' not in e.lower() and 'could not reach' not in e.lower()]
    menu(gwen, 'Lock'); gwen.wait_for_selector('#lgPw', timeout=20000)
    TEMP['kaylee_first'] = True
    sign_in(gwen, 'kaylee', TEMP['kaylee'], go=False); gwen.wait_for_selector('#firstForm', timeout=30000)
    gwen.fill('#fpw1', PW['kaylee']); gwen.fill('#fpw2', PW['kaylee']); gwen.click('#fBtn'); wait_app(gwen)
    check('someone else signing in on that computer doesn’t get Gwen’s draft', 'No patient loaded' in txt(gwen, '.ip-app') and 'Jane Doe' not in J(gwen, "document.body.innerText"), txt(gwen, '.ip-app')[:200])
    check('…and their own name is the assistant a new visit starts with', J(gwen, "iprDefaultAssistant()") == 'Kaylee')
    J(gwen, "S.lastAct = Date.now() - 11 * 60000")
    gwen.wait_for_selector('#lgPw', timeout=25000)
    check('the idle lock (NLO Cases’ 10 minutes)', 'Locked after 10 minutes without activity.' in txt(gwen, '#lockCard'), txt(gwen, '#lockCard'))

    section('Names: added by hand, filled from NLO Cases, a new patient from a link')
    sign_in(gwen, 'gwen', PW['gwen'], go=False); wait_app(gwen)
    if gwen.is_visible('.ip-dialog'): gwen.click('.ip-dialog button:has-text("Close")')
    search_open(gwen, 'AB', '777')
    check('initials only, and NLO Cases’ name doesn’t fit: no full name yet', 'AB' in txt(gwen, '.ip-dialog') and 'Carl Zed' not in txt(gwen, '.ip-dialog'), txt(gwen, '.ip-dialog')[:200])
    gwen.click('.ip-dialog button:has-text("Start new visit")'); gwen.wait_for_selector('.ip-strip')
    gwen.click('.ip-strip .ip-link:has-text("Add full name")'); gwen.wait_for_selector('#ip-pd-name')
    gwen.wait_for_selector('.ip-dialog .ip-hint:has-text("Carl Zed")', timeout=8000); shot(gwen, '09-patient-details')
    check('Patient details: offers the name NLO Cases has (to use or not)', 'NLO Cases has Carl Zed for this chart #' in txt(gwen, '.ip-dialog'))
    gwen.fill('#ip-pd-name', 'Alice Brown'); gwen.click('.ip-dialog button:has-text("Save")'); gwen.wait_for_selector('#ip-pd-name', state='detached'); settle(gwen)
    vb = open_vault(gwen)['pts']['pt-carl']
    check('…saved on her record (rev 2, with history), shown in the strip', vb['body'].get('name') == 'Alice Brown' and vb['rev'] == 2 and 'Alice Brown' in txt(gwen, '.ip-strip') and get('iprPtLog/pt-carl_2'), vb)
    J(owner_cases, "B.createCase({ patient: 'Olga Ott', chart: '888-1', type: 'Retainer', notes: '' })")
    gwen.click('.ip-foot button:has-text("Cancel")'); gwen.wait_for_selector('.ip-dlg-h:has-text("New visit")')
    gwen.click('.ip-opt:has-text("Search existing patient")'); gwen.fill('.ip-dialog .ip-search input', '888')
    gwen.wait_for_selector('.ip-result:has-text("888-1")'); gwen.click('.ip-result:has-text("888-1")')
    gwen.wait_for_function("() => /Olga Ott/.test(document.querySelector('.ip-dialog').textContent)", timeout=10000); settle(gwen)
    check('no initials, and NLO Cases now has a case for the chart #: the name goes on the record by itself', open_vault(gwen)['pts']['pt-noini']['body'].get('name') == 'Olga Ott')
    gwen.click('.ip-dialog button:has-text("Close")')
    # a new patient from an NLO Cases link
    gwen.goto('about:blank'); gwen.goto(BASE + 'IPR_Tracker.html?emu#chart=55-1234', wait_until='load'); sign_in(gwen, 'gwen', PW['gwen'], go=False); wait_app(gwen)
    gwen.wait_for_selector('#ip-np-id', timeout=10000)
    gwen.wait_for_function("() => document.querySelector('#ip-np-name').value === 'Nora New'", timeout=10000)
    shot(gwen, '10-new-patient')
    check('a chart # not on file: New patient, with the name NLO Cases has for it', J(gwen, "document.querySelector('#ip-np-id').value") == '55-1234' and 'From NLO Cases' in txt(gwen, '.ip-dialog'))
    gwen.click('.ip-dialog button:has-text("Create & continue")'); gwen.wait_for_selector('.ip-dlg-h:has-text("Visit setup")')
    gwen.click('.ip-dialog button:has-text("Skip")'); gwen.wait_for_selector('.ip-strip')
    tap(gwen, 'upper', 'UR1|UL1'); gwen.wait_for_timeout(500)
    before = set(query('iprVis'))
    gwen.click('.ip-foot .ip-btn:has-text("Save to patient record")')
    gwen.wait_for_function("() => /Saved/.test(document.querySelector('.ip-foot').textContent)", timeout=15000); settle(gwen, 600)
    v = open_vault(gwen); nora = [k for k, x in v['pts'].items() if x['body'].get('name') == 'Nora New']
    added = [k for k in query('iprVis') if k not in before]
    check('saved: Nora New’s record (with the index NLO Cases finds) and her first visit', len(nora) == 1 and len(added) == 1 and v['vis'][added[0]]['p'] == nora[0] and v['pts'][nora[0]]['pc'], (nora, added))
    check('the same index NLO Cases makes for “55-1234” or “551234”', J(gwen, "Promise.all([FB.iprPc('55-1234'), FB.iprPc('551234')]).then(a => a[0] === a[1])") and v['pts'][nora[0]]['pc'] == J(gwen, "FB.iprPc('55 1234')"))
    # the old "next patient" slip: a patient on screen, then New visit → New patient — nothing may be saved to the first one
    gwen.wait_for_selector('.ip-dlg-h:has-text("New visit")', timeout=8000)
    gwen.click('.ip-opt:has-text("Search existing patient")'); gwen.fill('.ip-dialog .ip-search input', 'smith')
    gwen.wait_for_selector('.ip-result:has-text("Mark Smith")'); gwen.click('.ip-result:has-text("Mark Smith")')
    gwen.wait_for_selector('.ip-dialog button:has-text("Start new visit")'); gwen.click('.ip-dialog button:has-text("Start new visit")'); gwen.wait_for_selector('.ip-strip')
    tap(gwen, 'upper', 'UR2|UR1'); gwen.wait_for_timeout(3200); settle(gwen)
    mark_vis = sorted(k for k, x in query('iprVis').items() if x.get('p') == 'pt-mark')
    wizard(gwen); gwen.click('.ip-opt:has-text("New patient")'); gwen.fill('#ip-np-id', '70-7'); gwen.fill('#ip-np-name', 'Pat Two')
    gwen.click('.ip-dialog button:has-text("Create & continue")'); gwen.click('.ip-dialog button:has-text("Skip")'); gwen.wait_for_selector('.ip-strip')
    tap(gwen, 'lower', 'LL2|LL3'); gwen.wait_for_timeout(3500); settle(gwen)
    shot(gwen, '11-new-patient-strip')
    check('a new patient right after another: nothing of theirs is saved to the one before', sorted(k for k, x in query('iprVis').items() if x.get('p') == 'pt-mark') == mark_vis and 'Pat Two' in txt(gwen, '.ip-strip') and 'New patient' in txt(gwen, '.ip-foot'))
    gwen.click('.ip-foot .ip-btn:has-text("Save to patient record")'); gwen.wait_for_function("() => /Saved/.test(document.querySelector('.ip-foot').textContent)", timeout=15000); settle(gwen, 600)
    v = open_vault(gwen); pat = [k for k, x in v['pts'].items() if x['body'].get('name') == 'Pat Two']
    check('…it’s saved with the new patient', len(pat) == 1 and any(x['p'] == pat[0] and (x['body'].get('lower_ipr') or {}).get('LL2|LL3') == '0.3' for x in v['vis'].values()))

    section('Save, or Print, right after a change: one visit; a chart # on file under another name')
    pat_id = pat[0] if pat else ''
    pats = lambda: sorted(k for k, x in query('iprVis').items() if x.get('p') == pat_id)
    def pat_new_visit():
        gwen.wait_for_selector('.ip-dlg-h:has-text("New visit")', timeout=8000)
        gwen.click('.ip-opt:has-text("Search existing patient")'); gwen.fill('.ip-dialog .ip-search input', 'pat two')
        gwen.wait_for_selector('.ip-result:has-text("Pat Two")'); gwen.click('.ip-result:has-text("Pat Two")')
        gwen.wait_for_selector('.ip-dialog button:has-text("Start new visit")'); gwen.click('.ip-dialog button:has-text("Start new visit")'); gwen.wait_for_selector('.ip-strip')
    pat_new_visit(); p0 = pats()
    tap(gwen, 'upper', 'UR5|UR4'); gwen.click('.ip-foot .ip-btn:has-text("Save to patient record")')
    gwen.wait_for_function("() => /Saved/.test(document.querySelector('.ip-foot').textContent)", timeout=15000)
    gwen.wait_for_timeout(3500); settle(gwen)
    p1 = pats(); add1 = [k for k in p1 if k not in p0]; v = open_vault(gwen)['vis']
    check('Save a moment after a change: one new visit, with the change (IPR Tracker 3’s waiting autosave made a second)', len(add1) == 1 and (v[add1[0]]['body'].get('upper_ipr') or {}).get('UR5|UR4') == '0.3', (p0, p1))
    pat_new_visit()
    tap(gwen, 'lower', 'LR5|LR4')
    with gwen.expect_popup() as pop: gwen.click('.ip-actions .ip-btn:has-text("Print")')
    w = pop.value; w.wait_for_load_state()
    gwen.wait_for_timeout(3500); settle(gwen)
    p2 = pats(); add2 = [k for k in p2 if k not in p1]; v = open_vault(gwen)['vis']
    check('Print a moment after a change: saved first, one visit with the change', len(add2) == 1 and (v[add2[0]]['body'].get('lower_ipr') or {}).get('LR5|LR4') == '0.3', (p1, p2))
    menu(gwen, 'Lock'); gwen.wait_for_selector('#lgPw', timeout=20000)
    check('the lock closes a print window left open (it shows the patient’s name and IPR)', w.is_closed())
    sign_in(gwen, 'gwen', PW['gwen'], go=False); wait_app(gwen)
    # Cancel discards what it says it does: a change still waiting to autosave isn't saved on the way out
    tap(gwen, 'upper', 'UL6|UL7'); gwen.click('.ip-foot button:has-text("Cancel")')
    gwen.wait_for_selector('.ip-dlg-h:has-text("New visit")', timeout=8000); gwen.wait_for_timeout(3200); settle(gwen)
    vb = open_vault(gwen)['vis'].get(add2[0] if add2 else '') or {}
    check('Cancel right after a change: the change isn’t saved (the visit stays as it was)', (vb.get('body') or {}).get('upper_ipr', {}).get('UL6|UL7', '') == '' and (vb.get('body') or {}).get('lower_ipr', {}).get('LR5|LR4') == '0.3', (vb.get('body') or {}).get('upper_ipr'))
    gwen.click('.ip-opt:has-text("New patient")')
    gwen.fill('#ip-np-id', '15-6541'); gwen.fill('#ip-np-name', 'John Smith')
    gwen.wait_for_selector('.ip-exists', timeout=8000); n_pts = len(query('iprPts'))
    gwen.click('.ip-dialog button:has-text("Create & continue")'); gwen.wait_for_selector('.ip-dialog .ip-msg.err', timeout=8000)
    check('New patient, a chart # on file under another name: it says whose it is, and makes no record (a mistyped chart # never gets this visit)', 'is on file as Jane Doe, not John Smith' in txt(gwen, '.ip-dialog') and len(query('iprPts')) == n_pts, txt(gwen, '.ip-dialog')[:300])
    gwen.fill('#ip-np-name', 'jane doe'); gwen.click('.ip-dialog button:has-text("Create & continue")')
    gwen.wait_for_selector('.ip-dlg-h:has-text("Select visit")', timeout=8000)
    check('…the same chart # and her name: her visits open, no second record', 'Jane Doe' in txt(gwen, '.ip-dialog') and len(query('iprPts')) == n_pts)
    gwen.click('.ip-dialog button:has-text("Close")'); wizard(gwen)

    section('Printing (the page’s security rules: the print window’s buttons are wired from the page)')
    gwen.wait_for_selector('.ip-dlg-h:has-text("New visit")', timeout=8000)
    gwen.click('.ip-opt:has-text("Search existing patient")'); gwen.fill('.ip-dialog .ip-search input', 'jane')
    gwen.wait_for_selector('.ip-result:has-text("Jane Doe")'); gwen.click('.ip-result:has-text("Jane Doe")')
    gwen.wait_for_selector('.ip-visit'); gwen.click('.ip-visit:has-text("2026-04-06")'); gwen.wait_for_selector('.ip-banner')
    with gwen.expect_popup() as pop: gwen.click('.ip-actions .ip-btn:has-text("Print")')
    w = pop.value; w.wait_for_load_state()
    t = w.evaluate("document.body.innerText"); shot(w, '12-print-filled', True)
    if SHOTS: w.pdf(path=str(pathlib.Path(SHOTS) / '12-print-filled.pdf'), format='Letter', print_background=True, prefer_css_page_size=True)
    check('printed: the patient’s full name and chart #', 'Patient: Jane Doe' in t and 'Chart #: 15-6541' in t and 'Initials' not in t, t[:300])
    check('…its Print and Cancel buttons are wired (no code inside the window)', w.evaluate("!document.querySelector('[onclick]') && !!document.getElementById('ppGo')"))
    try: w.click('#ppX', no_wait_after=True)
    except Exception: pass   # (the window closes under the click)
    gwen.wait_for_timeout(600)
    check('…Cancel closes it', w.is_closed())
    with gwen.expect_popup() as pop: menu(gwen, 'Print blank form')
    w = pop.value; w.wait_for_load_state(); t = w.evaluate("document.body.innerText"); shot(w, '13-print-blank', True)
    if SHOTS: w.pdf(path=str(pathlib.Path(SHOTS) / '13-print-blank.pdf'), format='Letter', print_background=True, prefer_css_page_size=True)
    check('the blank form: a line for the patient’s name (and the chart #), no initials', 'Patient name:' in t and 'Chart #:' in t and 'Initials' not in t and 'Jane' not in t, t[:300])
    w.close()
    ls = J(gwen, "JSON.stringify(Object.assign({}, localStorage))")
    check('this computer keeps no patient’s name or chart # (recent patients are record ids)', 'ipr_recent_ids' in ls and not [x for x in PHI if x in ls] and 'ipr_recent"' not in ls, ls[:300])

    section('A login turned off')
    kc, kay, ke = new_page(b, 'kaylee')
    sign_in(kay, 'kaylee', PW['kaylee']); wait_app(kay)
    kuid = next(k for k, m in query('members').items() if m.get('staffId') == 'kaylee')
    patch_field('members/' + kuid, 'active', False)
    kay.wait_for_selector('#lgPw', timeout=20000)
    check('Kaylee’s open IPR Tracker locks at once', 'Your access was turned off.' in txt(kay, '#lockCard'))
    patch_field('members/' + kuid, 'active', True); kc.close()

    section('Remove the old copy (Dr. A), after an old page saved something')
    # an old page left open, before the lock: a new visit, and a change to one not touched here since; and one changed in both places
    rt('PUT', '/nlo/ipr/visits/pt-jane/v-j3', visit('v-j3', 'pt-jane', '2026-10-20', 'Gwen', {'UR4|UR3': '0.2'}, {}, 'third visit notes'))
    rt('PATCH', '/nlo/ipr/visits/pt-mark/v-m1', {'notes': 'changed on an old page'})
    J(own, "FB.mutate('vis', 'v-c1', b => { b.notes = 'changed here'; }, { a: 'save' })")
    rt('PATCH', '/nlo/ipr/visits/pt-carl/v-c1', {'notes': 'changed there too'})

    section('The old copy locked to Dr. A (tools/rtdb-rules-ipr-lock.py, run as in Cloud Shell)')
    locked, was = LOCK.lock_ipr(RT_RULES, OWNER_EMAIL)
    set_rt_rules(locked)
    st, ot = id_token(STAFF_EMAIL, STAFF_PW), id_token(OWNER_EMAIL, OWNER_PW)
    check('locked: a staff Google account can’t read the old copy or save there any more', rt_as(st, 'GET', '/nlo/ipr/patients')[0] == 401 and rt_as(st, 'PUT', '/nlo/ipr/visits/pt-jane/v-x', {'n': 1})[0] == 401 and rt_as(st, 'GET', '/nlo/ipr')[0] == 401)
    check('…but still reads the mark that sends an old page to the new IPR Tracker', rt_as(st, 'GET', '/nlo/ipr/moved')[0] == 200)
    check('…and Dr. A’s account reads it and changes it', rt_as(ot, 'GET', '/nlo/ipr/patients')[0] == 200 and rt_as(ot, 'PATCH', '/nlo/ipr/moved', {'at': (rt('GET', '/nlo/ipr/moved')[1] or {}).get('at', 0)})[0] == 200)

    section('Remove the old copy')
    own.click('.ip-menu-wrap > button'); own.wait_for_selector('.ip-menu'); shot(own, '16-menu'); own.click('.ip-menu-scrim')
    menu(own, 'Remove the old copy'); own.wait_for_selector('#rmWrap')
    old_login(own); J(own, "() => { RM.who = OLD.auth.currentUser.email; rmRender(); }")
    own.click('#rmWrap [data-act="rmRead"]')
    own.wait_for_function("() => RM.step === 'ready' || RM.err", timeout=30000)
    t = txt(own, '#rmWrap'); shot(own, '14-remove-old')
    check('the old copy: what it has, and what was saved there since the move', RM_ok(own) and 'Changedinbothplaces1' in t.replace(' ', '') and 'Saved there since the move3 records' in t and 'Visits that belong to no patient1' in t and 'deleted with the old copy' in t, t[:700])
    # something saved in the old copy between the last read and the delete (an old page, this very moment): nothing is deleted
    J(own, """() => { const orig = OLD.req; OLD.req = async (m, p, o) => {
        if (m === 'PUT' && o && o.ifMatch && !window.__casHit) { window.__casHit = 1;
          await fetch('http://127.0.0.1:9000/nlo/ipr/visits/pt-jane/v-j3.json?ns=demo-nlo-cases', { method: 'PATCH', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify({ notes: 'saved during the removal' }) }); }
        return orig(m, p, o); }; }""")
    own.click('#rmWrap [data-act="rmGo"]'); own.wait_for_selector('#cbYes')
    check('the confirmation names the visit that belongs to no patient', '1 visit that belongs to no patient is deleted with it' in txt(own, '.lkModalCard:has(#cbYes)'), txt(own, '.lkModalCard:has(#cbYes)')[:300])
    own.click('#cbYes')
    own.wait_for_function("() => (RM.step === 'ready' || RM.step === 'done') && !RM.busy", timeout=60000)
    check('a save in the old copy just before the delete: nothing is deleted, and it shows', 'nothing was deleted' in (J(own, "RM.err") or '') and len(rt('GET', '/nlo/ipr/patients')[1] or {}) == 5 and J(own, "window.__casHit") == 1, [J(own, "RM.step"), J(own, "RM.err")])
    own.click('#rmWrap [data-act="rmGo"]'); own.wait_for_selector('#cbYes'); own.click('#cbYes')
    own.wait_for_function("() => RM.step === 'done' || (RM.err && RM.step !== 'working')", timeout=60000)
    check('removed', J(own, "RM.step") == 'done', J(own, "RM.err")); shot(own, '15-removed')
    check('…and it offers the lock command (recommended, if not done yet)', 'rtdb-rules-ipr-lock.py' in txt(own, '#rmWrap') and J(own, "!!document.querySelector('#rmWrap [data-act=\"mvCopyCmd\"]')"))
    check('the old database: no patients or visits left (the visit that belonged to no patient too); the mark that sends its page here stays', rt('GET', '/nlo/ipr/patients')[1] is None and rt('GET', '/nlo/ipr/visits')[1] is None and (rt('GET', '/nlo/ipr/moved')[1] or {}).get('to') == 'IPR_Tracker.html')
    v = open_vault(own)
    check('the visit saved on the old page since the move is here now — with the change saved during the first try', (v['vis'].get('v-j3') or {}).get('p') == 'pt-jane' and v['vis']['v-j3']['body'].get('notes') == 'saved during the removal', (v['vis'].get('v-j3') or {}).get('body', {}).get('notes'))
    check('the one changed only there: the old page’s version', v['vis']['v-m1']['body'].get('notes') == 'changed on an old page')
    hist = J(own, "FB.historyOf('vis', 'v-c1')")
    check('changed in both places: this one’s version kept, the old one in its history', v['vis']['v-c1']['body'].get('notes') == 'changed here' and [h['a'] for h in hist][-2:] == ['old-copy', 'kept'], [h['a'] for h in hist])
    check('marked removed (counts only)', (get('iprMeta/oldRemoved') or {}).get('by') == OWNER_SID[0])
    own.click('#rmWrap [data-act="rmClose"]')

    # an old page still open saves after the copy is gone (Dr. A's own account, or before the lock): the patient isn't in the old copy
    # any more but is here — Check again brings the visits over to him (one saved without its created_at keeps the one it had)
    o1 = visit('v-m1', 'pt-mark', '2026-03-09', 'Gwen', {'UR3|UR2': '0.3'}, {'LL1|LL2': '0.2'}, 'after the removal'); o1.pop('created_at')
    rt('PATCH', '/nlo/ipr/visits/pt-mark/v-m1', o1)
    rt('PUT', '/nlo/ipr/visits/pt-mark/v-m2', visit('v-m2', 'pt-mark', '2026-10-22', 'Gwen', {'UR1|UL1': '0.1'}, {}))
    menu(own, 'Old copy: check again'); own.wait_for_selector('#rmWrap')
    old_login(own); J(own, "() => { RM.who = OLD.auth.currentUser.email; rmRender(); }")
    own.click('#rmWrap [data-act="rmRead"]'); own.wait_for_function("() => RM.step === 'ready' || RM.err", timeout=30000)
    p = J(own, "RM.plan && { recs: RM.plan.recs, orphans: RM.plan.counts.orphans, vis: RM.plan.counts.vis }")
    check('after the removal an old page saved two visits of a patient no longer in the old copy: both come over to him (not “no patient”)', p == {'recs': 2, 'orphans': 0, 'vis': 2}, p)
    own.click('#rmWrap [data-act="rmGo"]'); own.wait_for_selector('#cbYes'); own.click('#cbYes')
    own.wait_for_function("() => RM.step === 'done' || (RM.err && RM.step !== 'working')", timeout=60000)
    v = open_vault(own)
    check('…here now, with Mark Smith; the one saved without its created_at keeps the one it had', J(own, "RM.step") == 'done' and (v['vis'].get('v-m2') or {}).get('p') == 'pt-mark' and v['vis']['v-m1']['body'].get('notes') == 'after the removal' and v['vis']['v-m1']['body'].get('created_at') == OLD['visits']['pt-mark']['v-m1']['created_at'] and rt('GET', '/nlo/ipr/visits')[1] is None, [J(own, "RM.err"), v['vis'].get('v-m1', {}).get('body', {}).get('created_at')])
    own.click('#rmWrap [data-act="rmClose"]')
    # removed earlier but not noted here (the note failed): found empty, it's noted then
    req('DELETE', FS + '/iprMeta/oldRemoved'); J(own, "() => { S.removed = null; rmOpen(); }")
    old_login(own); J(own, "() => { RM.who = OLD.auth.currentUser.email; rmRender(); }")
    own.click('#rmWrap [data-act="rmRead"]'); own.wait_for_function("() => RM.step === 'ready' || RM.err", timeout=30000)
    check('the old copy found empty when it wasn’t noted as removed: noted now', 'The old copy is empty' in txt(own, '#rmWrap') and get('iprMeta/oldRemoved') is not None, [J(own, "RM.step"), J(own, "RM.err"), J(own, "!!S.removed"), get('iprMeta/oldRemoved'), txt(own, '#rmWrap')[-300:]])
    own.click('#rmWrap [data-act="rmClose"]')

    section('The old IPR Tracker’s page (kept beside it) sends everyone here')
    xc, xp, xe = new_page(b, 'oldPage', quiet_perm=True)
    xp.goto(BASE + 'IPR_Tracker_old.html?emu#chart=15-6541', wait_until='load')
    xp.evaluate("a => fbAuth.signInWithEmailAndPassword(a[0], a[1])", [STAFF_EMAIL, STAFF_PW])
    xp.wait_for_url(re.compile(r'/IPR_Tracker\.html'), timeout=20000); xp.wait_for_selector('#lgUser', timeout=20000)
    check('signed in to the old page (a staff Google account, the old copy locked): straight to the new IPR Tracker, the link’s chart # along', J(xp, "S.deep && S.deep.chart") == '15-6541', xp.url)
    xc.close()

    section('Page errors')
    for label, errs in PAGES:
        check('no page errors: ' + label, not errs, errs)

def RM_ok(own):
    p = J(own, "RM.plan && { n: new Set(RM.plan.writes.map(w => w.id)).size, c: RM.plan.conflicts, pts: RM.plan.counts.pts, vis: RM.plan.counts.vis }") or {}
    return p.get('n') == 3 and p.get('c') == 1 and p.get('pts') == 5 and p.get('vis') == 5

def main():
    srv = serve()
    req('DELETE', 'http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents')
    req('DELETE', 'http://127.0.0.1:9099/emulator/v1/projects/' + P + '/accounts')
    rt('DELETE', '/')
    set_rules((DIST / 'firestore.rules').read_text())
    set_rt_rules(RT_RULES)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--disable-features=PrivateNetworkAccessRespectPreflightResults'])
        try: run(b)
        except Exception as e:
            tb = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.endswith('e2e.py')]
            check('ran to the end', False, str(e).split('\n')[0][:400] + ' @ ' + ' > '.join('%s:%d' % (f.name, f.lineno) for f in tb))
        b.close()
    srv.shutdown()
    bad = [r for r in results if not r[1]]
    print('\n%d passed, %d failed' % (len(results) - len(bad), len(bad)))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
