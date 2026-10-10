"""End to end: the real page (dist/nlo-timeclock.html?emu) on the Firebase emulators, under the shared rules, with a made-up
office set up the way NLO Cases sets one up (logins, members, the roster; Sarah approves time off, and Dr. A makes her a time
clock manager).
Separate browsers play the front-desk computer, Wila's phone, Gwen's phone, Wila's laptop, Sarah, Kim and Dr. A. The office
lock: the office check Dr. A copies from the page (a Cloudflare Worker) runs under Node (test/worker_server.mjs), and each
browser is on a pretend network (the office's, or home) that the test can change. The alert script Dr. A copies from the
page is then run (with the Apps Script stand-ins) and its alerts checked. Made-up people only.
    python3 build.py
    npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "python3 test/e2e.py"
(serves dist/ itself on :8791; the pinned Firebase files come from test/vendor/firebasejs-10.12.2/)."""
import asyncio, calendar, json, os, re, subprocess, sys, tempfile, threading, time, urllib.request, functools, http.server
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__)); DIST = os.path.join(HERE, '..', 'dist')
VENDOR = os.path.join(HERE, 'vendor', 'firebasejs-10.12.2')
P = 'demo-nlo-cases'; FS = 'http://127.0.0.1:8080/v1/projects/' + P + '/databases/(default)/documents'
AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'; PAGE = 'http://127.0.0.1:8791/nlo-timeclock.html?emu'
NTFY_PORT = 8798
# the office lock: the office check's address (the browsers' requests to it go to the copy running under Node), and where each
# browser is right now
WURL = 'https://nlo-office-check.e2e.workers.dev'; CHECK_PORT = 8797; OFFICE_IP = '203.0.113.10'; HOME_IP = '198.51.100.7'
RELAY_IP = '172.225.10.4'  # (an address many people share: iCloud Private Relay)
ORGS = {OFFICE_IP: 'Office Internet', RELAY_IP: 'Akamai International B.V.'}
NETS = {}; PROCS = []
os.environ['NO_PROXY'] = os.environ['no_proxy'] = '127.0.0.1,localhost'
passed = failed = 0
def check(name, cond, extra=''):
    global passed, failed
    if cond: passed += 1; print('  ok  ' + name)
    else: failed += 1; print('  FAIL ' + name + ((' :: ' + str(extra)[:500]) if extra != '' else ''))

# a time box on the page takes the office's time (Eastern), whatever clock this machine is on
def office_hm(secs_ago): return (datetime.now(ZoneInfo('America/New_York')) - timedelta(seconds=secs_ago)).strftime('%H:%M')
# a push the script sent: on its own, or one line of a combined push (it sends one for all when there are more than 4)
def pushed(pushes, title, topic=None): return any((x.get('title') == title or title in (x.get('message') or '').split('\n')) and (topic is None or x.get('topic') == topic) for x in pushes)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def req(method, url, body=None, token='owner'):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    try:
        with opener.open(r) as x: return x.status, json.loads(x.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def F(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [F(x) for x in v]}}
    if isinstance(v, dict) and v.get('__ts'): return {'timestampValue': v['__ts']}
    return {'mapValue': {'fields': {k: F(x) for k, x in v.items()}}}
NOW = {'__ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
def put(path, obj): return req('PATCH', FS + '/' + path, {'fields': {k: F(v) for k, v in obj.items()}})
def get(path):
    c, j = req('GET', FS + '/' + path)
    if c != 200: return None
    return {k: list(v.values())[0] for k, v in (j.get('fields') or {}).items()}
def query(coll):
    c, j = req('POST', FS + ':runQuery', {'structuredQuery': {'from': [{'collectionId': coll}]}})
    return [dict({k: list(v.values())[0] for k, v in (x['document'].get('fields') or {}).items()}, id=x['document']['name'].split('/')[-1]) for x in j if 'document' in x]
def signup(email, pw):
    c, j = req('POST', AUTH + '/accounts:signUp?key=any', {'email': email, 'password': pw, 'returnSecureToken': True}, token='')
    return j['localId']

PEOPLE = [  # sid, username, name, role, password
    ('amir', 'amir', 'Dr. Riley Owner', 'owner', 'owner-pass-1'),
    ('sarah', 'sarah', 'Sarah Tester', 'staff', 'sarah-pass-1'),
    ('gwen', 'gwen', 'Gwen Tester', 'staff', 'gwen-pass-1'),
    ('kim', 'kim', 'Kim Tester', 'staff', 'kim-pass-1'),
    ('wila', 'wila', 'Wila Tester', 'staff', 'wila-pass-1')]
UID = {}
def seed():
    # start from empty emulators (another test file may have run in the same emulators first)
    for url in ('http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents',
                'http://127.0.0.1:9099/emulator/v1/projects/' + P + '/accounts'):
        req('DELETE', url)
    for sid, un, name, role, pw in PEOPLE:
        email = 'dr.test@example.com' if role == 'owner' else un + '.1@staff.thenextlevelorthodontics.com'
        UID[sid] = signup(email, pw)
        put('logins/' + un, {'email': email})
        put('members/' + UID[sid], {'staffId': sid, 'role': role, 'active': True, 'name': name})
        put('roster/' + sid, {'name': name, 'role': role, 'active': True, 'initials': 'XT', 'username': un})
    put('meta/setup', {'owner': UID['amir'], 'at': NOW}); put('meta/keys', {'current': 1})
    sealed = {'epk': {'kty': 'EC', 'crv': 'P-256', 'x': 'E' * 43, 'y': 'F' * 43}, 'iv': 'aXY=', 'ct': 'cmluZw=='}
    put('toAccess/' + UID['sarah'], {'ring': sealed, 'ringV': 1, 'pubX': 'A' * 43, 'sid': 'sarah', 'by': UID['amir'], 'at': NOW})

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST)
    h.log_message = lambda *a: None
    s = http.server.ThreadingHTTPServer(('127.0.0.1', 8791), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

async def ctx_for(b, who=None, **kw):
    c = await b.new_context(viewport=kw.pop('viewport', {'width': 1360, 'height': 900}), accept_downloads=True, **kw)
    async def check(route, request):  # (the office check: from this browser's pretend network)
        try:
            ip = NETS.get(who, OFFICE_IP)
            r = await route.fetch(url='http://127.0.0.1:%d' % CHECK_PORT + request.url[len(WURL):], headers=dict(request.headers, **{'x-test-ip': ip, 'x-test-org': ORGS.get(ip, 'Home Internet')}))
            await route.fulfill(response=r)
        except Exception as e:
            await route.fulfill(status=200, body='{"ok":false,"error":"down"}', headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:8791'})
    await c.route(WURL + '/**', check)
    await c.route('https://www.gstatic.com/firebasejs/10.12.2/*', lambda r: r.fulfill(path=os.path.join(VENDOR, r.request.url.rsplit('/', 1)[1]), content_type='text/javascript'))
    await c.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body='', content_type='text/css'))
    return c
ERRS = []; QUIET = {'on': False}; PAGES = {}
async def dump():
    # when a step times out: what each browser was showing, to see why
    for who, pg in PAGES.items():
        try:
            print('--- ' + who + ' ' + pg.url + '\n' + (await pg.inner_text('body'))[:1500])
            print('--- state: ' + str(await pg.evaluate("JSON.stringify({ boxes: ['lockWrap', 'kiosk', 'app'].map(i => i + ':' + (document.getElementById(i) || {}).className), mode: S.mode, role: S.role, view: S.view, k: S.k && S.k.screen, modal: !!document.getElementById('modalWrap'), me: B && B.me ? B.me.staffId : null, err: S.loadErr, got: S.got })")))
            if os.environ.get('SHOTS'): await pg.screenshot(path=os.path.join(os.environ['SHOTS'], 'fail-' + who + '.png'))
        except Exception as e: print('--- ' + who + ' (closed) ' + str(e)[:100])
    print('--- errors: ' + str(ERRS)[:1500])
# the Firestore SDK closing a live stream as a page reloads or signs out: the emulator answers 400 to the old stream (not an error)
FS_CHANNEL = re.compile(r'/google\.firestore\.v1\.Firestore/(Listen|Write)/channel')
def benign(url, status): return status == 400 and FS_CHANNEL.search(url or '') is not None
def watch(pg, who):
    PAGES[who] = pg
    pg.on('pageerror', lambda e: ERRS.append(who + ' pageerror: ' + str(e)))
    pg.on('console', lambda m: (None if QUIET['on'] or ('Failed to load resource' in m.text and '400' in m.text and benign((m.location or {}).get('url'), 400)) else ERRS.append(who + ' ' + m.type + ': ' + m.text)) if m.type == 'error' else None)
    pg.on('response', lambda r: (None if QUIET['on'] or benign(r.url, r.status) else ERRS.append(who + ' ' + str(r.status) + ' for ' + r.url)) if r.status >= 400 else None)
async def sign_in(pg, user, pw, stay=False):
    await pg.goto(PAGE); await pg.wait_for_selector('#signForm')
    await pg.fill('#lgUser', user); await pg.fill('#lgPw', pw)
    if stay: await pg.check('#lgStay')
    await pg.click('#lgBtn'); await pg.wait_for_selector('#app:not(.hidden)'); await pg.wait_for_timeout(700)
async def digits(pg, pin):
    for d in pin: await pg.click(f'.kKey[data-d="{d}"]')
    await pg.wait_for_function("() => !document.querySelector('.kKey[disabled]')"); await pg.wait_for_timeout(250)
async def toast_text(pg): return await pg.inner_text('#toasts')

def run_check(code):
    # the office check as Dr. A pasted it into Cloudflare (run under Node on CHECK_PORT)
    cf = os.path.join(tempfile.mkdtemp(), 'check.mjs'); open(cf, 'w').write(code)
    w = subprocess.Popen(['node', os.path.join(HERE, 'worker_server.mjs'), cf, str(CHECK_PORT)], stdout=subprocess.PIPE, text=True); PROCS.append(w)
    w.stdout.readline()  # (listening)
    return w

async def main():
    seed(); srv = serve()
    log = os.path.join(tempfile.mkdtemp(), 'ntfy.jsonl')
    ntfy = subprocess.Popen(['node', os.path.join(HERE, 'fake_ntfy.js'), str(NTFY_PORT), log])
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            try: await steps(b, log)
            except Exception:
                await dump(); raise
    finally:
        ntfy.kill(); srv.shutdown()
        for x in PROCS: x.kill()
    print(f'\n{passed} passed, {failed} failed'); sys.exit(1 if failed else 0)

async def steps(b, log):
    print('\n# Dr. A sets it up on the front-desk computer')
    NETS['desk'] = OFFICE_IP
    desk = await ctx_for(b, 'desk'); pg = await desk.new_page(); watch(pg, 'desk')
    await sign_in(pg, 'amir', 'owner-pass-1')
    check('first time: the set-up card (no rules card: the rules are live)', await pg.locator('[data-act=doSetup]').count() == 1, await pg.inner_text('#view'))
    await pg.click('[data-act=doSetup]'); await pg.wait_for_selector('[data-act=pinSet]')
    tc = get('meta/tc'); st = {x['id']: x for x in query('tcStaff')}; al = get('meta/tcAlerts')
    check('settings saved (overtime after 40, Mon–Thu)', tc and tc['ot'] == '40' and tc['early'] == '07:30', tc)
    check('everyone but Dr. A on the clock', sorted(st) == ['gwen', 'kim', 'sarah', 'wila'] and all(x['on'] for x in st.values()), st)
    check('alerts to Dr. A’s email to start', al and al['emails'] == {'values': [{'stringValue': 'dr.test@example.com'}]}, al)
    await pg.click('tr:has-text("Wila") [data-act=staffEdit]'); await pg.check('#seHome'); await pg.click('[data-act=staffGo]'); await pg.wait_for_selector('#modalWrap', state='detached'); await pg.wait_for_timeout(500)
    check('Wila may clock in from home', get('tcStaff/wila')['home'] is True and 'Yes' in await pg.inner_text('tr:has-text("Wila")'))
    await pg.click('tr:has-text("Sarah") [data-act=staffEdit]'); await pg.check('#seMgr'); await pg.click('[data-act=staffGo]'); await pg.wait_for_selector('#modalWrap', state='detached'); await pg.wait_for_timeout(500)
    check('Sarah (who approves time off) becomes a time clock manager only when Dr. A says so', get('tcMgrs/sarah') is not None and 'Manager' in await pg.inner_text('tr:has-text("Sarah")'), get('tcMgrs/sarah'))
    for who, pin in [('Gwen', '5829'), ('Kim', '4826'), ('Wila', '7351')]:
        await pg.click(f'tr:has-text("{who}") [data-act=pinSet]'); await pg.fill('#pinA', pin); await pg.click('[data-act=pinGo]'); await pg.wait_for_selector('#modalWrap', state='detached'); await pg.wait_for_timeout(300)
    check('PINs set (only their hashes are stored, and nobody can read those)', get('tcStaff/gwen')['pinAt'] and get('tcPin/gwen') and get('tcPin/gwen')['h'] != '5829')
    await pg.click('.navBtn[data-v=settings]'); await pg.click('[data-act=kioskEnroll]'); await pg.click('[data-act=kioskEnrollGo]')
    await pg.wait_for_selector('.kTile'); await pg.wait_for_timeout(500)
    ks = query('tcKiosks')
    check('this computer is now the time clock', len(ks) == 1 and ks[0]['name'] == 'Front desk' and await pg.locator('.kTile').count() == 4, ks)

    print('\n# the time clock')
    await pg.click('.kTile:has-text("Gwen")'); await digits(pg, '5829')
    check('Gwen’s PIN works: Clock in', await pg.locator('.kBig[data-kind=in]').count() == 1)
    await pg.click('.kBig[data-kind=in]'); await pg.wait_for_selector('.kDone')
    done = await pg.inner_text('.kDone')
    pun = [x for x in query('tcPunch') if x['sid'] == 'gwen']
    check('punched: the server’s time, at the time clock (the office lock is off: not checked)', len(pun) == 1 and pun[0]['src'] == 'kiosk' and pun[0]['by'] == ks[0]['id'] and pun[0]['net'] == '' and abs(time.time() - calendar.timegm(time.strptime(pun[0]['at'][:19], '%Y-%m-%dT%H:%M:%S'))) < 120, pun)
    check('…and the screen says the time', 'Clocked in at' in done, done)
    check('the PIN try is used up', get('tcTry/gwen')['n'] == '0' and get('tcTry/gwen')['ok'] is False)
    await pg.click('[data-act=kDone]'); await pg.click('.kTile:has-text("Kim")')
    for i in range(5): await digits(pg, '1357')
    check('5 wrong PINs: locked', (await pg.inner_text('.kNote')).startswith('Too many wrong PINs') and get('tcTry/kim')['n'] == '5')
    await digits(pg, '4826')
    check('…the right PIN waits too (the database refuses a 6th try)', (await pg.inner_text('.kNote')).startswith('Too many wrong PINs'))
    await pg.click('[data-act=kCancel]')
    await pg.reload(); await pg.wait_for_selector('.kTile'); await pg.wait_for_timeout(400)
    check('after a reload it’s still the time clock', await pg.locator('.kTile').count() == 4 and 'In ·' in await pg.inner_text('.kTile:has-text("Gwen")'))

    print('\n# a manager at the time clock')
    await pg.click('[data-act=kMgr]'); await pg.fill('#kmU', 'amir'); await pg.fill('#kmP', 'owner-pass-1'); await pg.click('#kmBtn')
    await pg.wait_for_selector('.issue'); now_txt = await pg.inner_text('#view')
    check('Now shows Gwen in and Kim’s lockout', 'Kim Tester: 5 wrong PINs' in now_txt and 'Gwen Tester' in now_txt, now_txt[:400])
    await pg.click('.issue [data-act=clearTry]'); await pg.wait_for_timeout(600)
    check('cleared', get('tcTry/kim')['n'] == '0')
    await pg.click('#side [data-act=toKiosk]'); await pg.wait_for_selector('.kTile')
    await pg.click('.kTile:has-text("Kim")'); await digits(pg, '4826')
    check('Kim’s PIN works again', await pg.locator('.kBig[data-kind=in]').count() == 1)

    print('\n# I forgot to punch (at the time clock)')
    await pg.click('.kBig.kGhost[data-act=kReq][data-k=in]'); await pg.wait_for_selector('.kReq')
    await pg.fill('#krT1', office_hm(180)); await pg.fill('#krNote', 'Got here early and forgot')
    await pg.click('[data-act=kReqSend]'); await pg.wait_for_selector('.kAsked')
    rq = [x for x in query('tcReq') if x['sid'] == 'kim']
    check('Kim asks for the clock-in she missed, from the time clock', len(rq) == 1 and rq[0]['src'] == 'kiosk' and rq[0]['by'] == ks[0]['id'] and rq[0]['st'] == 'open' and rq[0]['note'] == 'Got here early and forgot' and '"in"' in json.dumps(rq[0]['ps']), rq)
    check('…her PIN isn’t used up: lunch or clock out next', await pg.locator('.kBig[data-kind=lunch]').count() == 1 and get('tcTry/kim')['ok'] is True)
    check('…and nothing counts yet', not [x for x in query('tcFix') if x['sid'] == 'kim'])
    await pg.click('[data-act=kCancel]'); await pg.wait_for_timeout(500)
    check('Cancel lets go of her PIN', get('tcTry/kim')['ok'] is False)

    print('\n# the office lock (Dr. A, on his computer at the office)')
    NETS['owner'] = OFFICE_IP
    oc = await ctx_for(b, 'owner'); op = await oc.new_page(); watch(op, 'owner')
    await sign_in(op, 'amir', 'owner-pass-1')
    await op.click('.navBtn[data-v=settings]'); await op.wait_for_selector('#officeCard')
    check('Settings: the office lock is off to start', 'Off' in await op.inner_text('#officeCard .cardHd') and await op.locator('#officeCard [data-act=lockOn]').is_disabled())
    await op.click('[data-act=netSetup]'); await op.click('#modalWrap [data-x=yes]'); await op.wait_for_selector('[data-act=copyCheck]')
    code = await op.evaluate('S.checkText'); nb = query('tcNetBot')
    check('Set up the office check: its own login, in the code to copy', len(nb) == 1 and nb[0]['email'] in code and '/*TC_NET_CONFIG*/' not in code and 'export default' in code, nb)
    wk_ = run_check(code)
    await op.fill('#netUrl', WURL + '/'); await op.click('[data-act=netUrlSave]'); await op.wait_for_timeout(1500)
    check('…its address saved (Cloudflare’s workers.dev), and the test says it works', (get('meta/tc') or {}).get('wurl') == WURL and 'The office check works' in await toast_text(op), [get('meta/tc'), await toast_text(op)])
    await op.click('[data-act=closeM]'); await op.click('.navBtn[data-v=settings]'); await op.wait_for_selector('#officeCard [data-act=offHere]:not([disabled])')
    await op.click('[data-act=offHere]'); await op.wait_for_selector('#offName')
    check('This is the office: it shows the network it sees', '203.0.113.10' in await op.inner_text('#modalWrap') and 'Office Internet' in await op.inner_text('#modalWrap'))
    await op.click('[data-act=offHereGo]'); await op.wait_for_selector('#modalWrap', state='detached'); await op.wait_for_timeout(600)
    ofs = query('tcOffice')
    check('…saved as the office’s network (the database checked he’s on it)', len(ofs) == 1 and ofs[0]['id'] == 'v4:203.0.113.10' and ofs[0]['by'] == UID['amir'] and 'via' not in ofs[0], ofs)
    check('…and the card says only the older kind of address (IPv4) is saved yet', 'IPv4' in await op.inner_text('#officeCard .ofCover'), await op.inner_text('#officeCard'))
    NETS['owner'] = RELAY_IP
    await op.click('[data-act=offHere]'); await op.wait_for_selector('#modalWrap .notice.bad')
    check('This is the office on iCloud Private Relay: can’t be saved, and what to turn off', 'many people share' in await op.inner_text('#modalWrap') and 'Limit IP Address Tracking' in await op.inner_text('#modalWrap') and await op.locator('[data-act=offHereGo]').count() == 0, await op.inner_text('#modalWrap'))
    await op.click('[data-act=closeM]')
    QUIET['on'] = True
    r = await op.evaluate("FB.netCheck(S.set.wurl).then(n => FB.saveOffice(n.net, 'Relay', n)).then(() => 'saved', e => e.code)")
    check('…and the database refuses it too', 'permission' in r and len(query('tcOffice')) == 1, r)
    QUIET['on'] = False
    NETS['owner'] = OFFICE_IP
    await op.click('[data-act=lockOn]'); await op.wait_for_timeout(1500)
    check('Turn on the office lock (from the office network)', (get('meta/tc') or {}).get('lock') is True and await op.locator('#officeCard [data-act=lockOff]').count() == 1, get('meta/tc'))
    QUIET['on'] = True
    r = await op.evaluate("FB.saveOffice('v4:198.51.100.99', 'Not mine', { org: '', city: '' }).then(() => 'saved', e => e.code)")
    check('…the database refuses a network he isn’t on', 'permission' in r, r)
    QUIET['on'] = False

    print('\n# setting up the office check again (a new login: the running copy works until the new one answers)')
    await op.click('[data-act=netSetup]'); await op.click('#modalWrap [data-x=yes]'); await op.wait_for_selector('[data-act=copyCheck]')
    code2 = await op.evaluate('S.checkText'); nb2 = query('tcNetBot')
    check('a second login is made; the first still works', len(nb2) == 2 and any(x['email'] in code2 for x in nb2) and nb[0]['email'] not in code2, nb2)
    check('…the steps name the Worker that’s there', 'nlo-office-check' in await op.inner_text('#modalWrap'), await op.inner_text('#modalWrap'))
    NETS['probe'] = OFFICE_IP
    prc = await ctx_for(b, 'probe'); prp = await prc.new_page(); watch(prp, 'probe')
    await sign_in(prp, 'gwen', 'gwen-pass-1'); await prp.wait_for_selector('[data-act=ownPunch], .netAway, #view .notice')
    check('…meanwhile the old copy still answers (Gwen’s phone sees the office)', await prp.locator('[data-act=ownPunch]').count() >= 1 and 'On the office network' in await prp.inner_text('#view'), await prp.inner_text('#view'))
    await prc.close(); del PAGES['probe']
    await op.click('[data-act=netUrlSave]'); await op.wait_for_timeout(1500)
    check('the test with the old copy still running says so, and turns nothing off', 'older copy' in await toast_text(op) and len(query('tcNetBot')) == 2, await toast_text(op))
    wk_.kill(); wk_.wait(); wk_ = run_check(code2)
    await op.click('[data-act=netUrlSave]'); await op.wait_for_timeout(1500)
    nb3 = query('tcNetBot')
    check('pasted and deployed: the test works, and the old login stops working', 'The office check works' in await toast_text(op) and len(nb3) == 1 and nb3[0]['email'] in code2, [await toast_text(op), nb3])
    await op.click('[data-act=closeM]')

    print('\n# the front desk on and off the office network')
    await pg.click('.kTile:has-text("Gwen")'); await digits(pg, '5829'); await pg.wait_for_selector('.kBig[data-kind=out]')
    await pg.click('.kBig[data-kind=out]'); await pg.wait_for_selector('.kDone')
    gp = sorted([x for x in query('tcPunch') if x['sid'] == 'gwen'], key=lambda x: x['at'])
    check('on the office network: Gwen’s clock-out says so', gp[-1]['kind'] == 'out' and gp[-1]['net'] == 'office' and 'flagged' not in await pg.inner_text('.kDone'), gp[-1])
    await pg.click('[data-act=kDone]')
    check('…saved under the punch number the office check gave (nobody else can reuse it)', re.fullmatch(r'p[0-9a-f]{24}', gp[-1]['id']) is not None, gp[-1])
    # another check comes in between (say, the screen's own check every 10 minutes): the database refuses the "at the office"
    # punch (its number was replaced), and the time clock saves it anyway, flagged — never lost
    await pg.evaluate("(() => { const p = FB.punch, once = { n: 0 }; FB.punch = async function (sid, kind, net, pid) { if (net === 'office' && !once.n++) await FB.netCheck(S.set.wurl, true); return p.apply(FB, arguments); }; })()")
    QUIET['on'] = True
    await pg.click('.kTile:has-text("Gwen")'); await digits(pg, '5829'); await pg.wait_for_selector('.kBig[data-kind=in]')
    await pg.click('.kBig[data-kind=in]'); await pg.wait_for_selector('.kDone')
    QUIET['on'] = False
    gp = sorted([x for x in query('tcPunch') if x['sid'] == 'gwen'], key=lambda x: x['at'])
    check('a newer check came in between: the punch is saved anyway, flagged (couldn’t check)', gp[-1]['kind'] == 'in' and gp[-1]['net'] == 'unk' and 'flagged for a manager' in await pg.inner_text('.kDone'), [gp[-1], await pg.inner_text('.kDone')])
    await pg.click('[data-act=kDone]')
    await pg.click('.kTile:has-text("Gwen")'); await digits(pg, '5829'); await pg.wait_for_selector('.kBig[data-kind=out]')
    await pg.click('.kBig[data-kind=out]'); await pg.wait_for_selector('.kDone'); await pg.click('[data-act=kDone]')
    NETS['desk'] = HOME_IP
    # (Kim's clock-in she asked for is waiting for a manager: lunch is next)
    await pg.click('.kTile:has-text("Kim")'); await digits(pg, '4826'); await pg.wait_for_selector('.kBig[data-kind=lunch]')
    await pg.click('.kBig[data-kind=lunch]'); await pg.wait_for_selector('.kDone')
    kp_ = [x for x in query('tcPunch') if x['sid'] == 'kim']
    check('moved off it: Kim’s lunch still goes through, flagged for a manager', len(kp_) == 1 and kp_[0]['kind'] == 'lunch' and kp_[0]['net'] == 'off' and 'flagged for a manager' in await pg.inner_text('.kDone'), [kp_, await pg.inner_text('.kDone')])
    await pg.click('[data-act=kDone]')
    NETS['desk'] = OFFICE_IP

    print('\n# the front desk can’t reach the database as it loads (it keeps its login and tries again)')
    QUIET['on'] = True
    await desk.route('http://127.0.0.1:8080/**', lambda r: r.abort())
    await pg.reload(); await pg.wait_for_selector('#lockCard [data-act=kioskRetryNow]', timeout=60000)
    check('no database at load: it says so and keeps trying, still set up as the time clock', 'can’t read the time clock right now' in await pg.inner_text('#lockCard') and await pg.evaluate('!!FB.kauth.currentUser'), await pg.inner_text('#lockCard'))
    await desk.unroute('http://127.0.0.1:8080/**')
    await pg.wait_for_selector('.kTile', timeout=90000); await pg.wait_for_timeout(500)
    QUIET['on'] = False
    check('…back by itself once it can: the time clock again', await pg.locator('.kTile').count() == 4)

    print('\n# on their phones: Wila at home, Gwen at the office')
    NETS['wila'] = HOME_IP
    ph = await ctx_for(b, 'wila', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); wp = await ph.new_page(); watch(wp, 'wila')
    await sign_in(wp, 'wila', 'wila-pass-1', stay=True); await wp.wait_for_selector('.netAway, [data-act=ownPunch]')
    check('Wila at home (even allowed home): no punch buttons on her phone, and why', await wp.locator('[data-act=ownPunch]').count() == 0 and 'not on the office network' in await wp.inner_text('#view') and 'approved laptop' in await wp.inner_text('#view'), await wp.inner_text('#view'))
    QUIET['on'] = True
    r = await wp.evaluate("FB.netCheck(S.set.wurl).then(n => FB.punchOwn('in', n.pid)).then(() => 'saved', e => e.code)")
    check('…and the database refuses one from home (even with the punch number her check got)', 'permission' in r and not [x for x in query('tcPunch') if x['sid'] == 'wila'], r)
    QUIET['on'] = False
    await wp.click('[data-act=meReq]'); await wp.click('[data-act=mrKind][data-k=note]'); await wp.fill('#mrNote', 'Worked 20 min last night on the schedule')
    await wp.click('[data-act=meReqGo]'); await wp.wait_for_selector('#modalWrap', state='detached'); await wp.wait_for_timeout(700)
    check('she leaves a note for the managers from her phone', any(x['sid'] == 'wila' and x['src'] == 'me' and x['st'] == 'open' and x['by'] == UID['wila'] for x in query('tcReq')), query('tcReq'))
    await wp.reload(); await wp.wait_for_selector('.meCard');
    check('stays signed in on her phone (she asked to)', 'my time' in (await wp.inner_text('.topBar')).lower() and await wp.locator('.meCard').count() == 1, await wp.inner_text('.topBar'))
    QUIET['on'] = True
    check('she can’t punch for anyone else', 'permission' in await wp.evaluate("FB.db.doc('tcPunch/p' + '9'.repeat(24)).set({ sid: 'gwen', kind: 'in', at: FB.ts(), src: 'own', by: FB.me.uid, net: 'office' }).then(() => 'saved', e => e.code)"))
    check('…or read anyone else’s punches', 'permission' in await wp.evaluate("FB.db.collection('tcPunch').get().then(() => 'read', e => e.code)"))
    QUIET['on'] = False
    NETS['gwen'] = OFFICE_IP
    gc = await ctx_for(b, 'gwen', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); gpg = await gc.new_page(); watch(gpg, 'gwen')
    await sign_in(gpg, 'gwen', 'gwen-pass-1'); await gpg.wait_for_selector('[data-act=ownPunch][data-kind=in]')
    check('Gwen on the office Wi-Fi: Clock in on her phone', 'On the office network' in await gpg.inner_text('#view'))
    await gpg.click('[data-act=ownPunch][data-kind=in]'); await gpg.wait_for_selector('[data-act=ownPunch][data-kind=lunch]')
    gp = sorted([x for x in query('tcPunch') if x['sid'] == 'gwen'], key=lambda x: x['at'])
    check('…her own punch, marked at the office (the database checked)', gp[-1]['kind'] == 'in' and gp[-1]['src'] == 'own' and gp[-1]['net'] == 'office' and gp[-1]['by'] == UID['gwen'], gp[-1])
    check('…under the punch number its check gave', re.fullmatch(r'p[0-9a-f]{24}', gp[-1]['id']) is not None, gp[-1])
    QUIET['on'] = True
    r = await gpg.evaluate("FB.punchOwn('lunch', " + json.dumps(gp[-1]['id']) + ").then(() => 'saved', e => e.code)")
    check('…a check is good for one punch (the same number again is refused)', 'permission' in r, r)
    QUIET['on'] = False
    NETS['gwen'] = HOME_IP
    await gpg.click('[data-act=ownPunch][data-kind=lunch]'); await gpg.wait_for_timeout(1500)
    check('…she walks out to her car (cellular): the next punch is refused, and the screen says why', 'not on the office network' in (await toast_text(gpg)).lower() + (await gpg.inner_text('#view')).lower() and len([x for x in query('tcPunch') if x['sid'] == 'gwen']) == len(gp), await toast_text(gpg))
    NETS['gwen'] = RELAY_IP
    await gpg.click('[data-act=myNetAgain]'); await gpg.wait_for_selector('.netAway:has-text("Private Relay")')
    check('…on iCloud Private Relay: what to turn off, not just “not the office”', 'Limit IP Address Tracking' in await gpg.inner_text('.netAway'), await gpg.inner_text('#view'))
    NETS['gwen'] = OFFICE_IP

    print('\n# an approved laptop (Wila’s, at home): it asks with a code, Dr. A approves it from his own computer')
    NETS['laptop'] = HOME_IP
    lc = await ctx_for(b, 'laptop'); lp = await lc.new_page(); watch(lp, 'laptop')
    await lp.goto(PAGE); await lp.wait_for_selector('#signForm')
    await lp.click('[data-act=lapAskStart]'); await lp.click('[data-act=lapAskGo]'); await lp.wait_for_selector('.lapCode')
    lcode = re.sub(r'\D', '', await lp.inner_text('.lapCode')); lr = query('tcLapReq')
    check('the laptop asks: its own new login, and a 6-digit code on its screen', re.fullmatch(r'\d{6}', lcode) is not None and len(lr) == 1 and lr[0]['code'] == lcode and 'Chrome' in lr[0]['dev'], [lcode, lr])
    await lp.reload(); await lp.wait_for_selector('.lapCode')
    check('…reloaded, it’s still waiting, with the same code', re.sub(r'\D', '', await lp.inner_text('.lapCode')) == lcode)
    QUIET['on'] = True
    r = await lp.evaluate("FB.kdb.collection('tcStaff').get().then(() => 'read', e => e.code)")
    check('…until it’s approved it reads nothing', 'permission' in r, r)
    QUIET['on'] = False
    await op.click('.navBtn[data-v=settings]'); await op.wait_for_selector('#lapCode')
    check('Dr. A sees a laptop asking (when — nothing it says until its code matches)', 'asking to be approved' in await op.inner_text('#view') and 'Chrome on Linux' not in await op.inner_text('#view'), await op.inner_text('#view'))
    await op.fill('#lapCode', '000000' if lcode != '000000' else '111111'); await op.click('[data-act=lapFind]'); await op.wait_for_timeout(400)
    check('…a code that isn’t the laptop’s finds nothing', 'No laptop is asking with that code' in await toast_text(op) and await op.locator('#leName').count() == 0, await toast_text(op))
    await op.fill('#lapCode', lcode[:3] + ' ' + lcode[3:]); await op.click('[data-act=lapFind]'); await op.wait_for_selector('#leName')
    check('…its code opens the approval, saying which browser it is', 'Chrome on Linux' in await op.inner_text('#modalWrap'), await op.inner_text('#modalWrap'))
    await op.fill('#leName', 'Wila’s laptop'); await op.check('.lapWho[value=wila]'); await op.click('[data-act=lapApproveGo]')
    await lp.wait_for_selector('.kTile'); await lp.wait_for_timeout(500)
    ls_ = query('tcLaptops')
    check('he types it on his computer: the laptop turns into the time clock for Wila only (no password on it)', len(ls_) == 1 and ls_[0]['name'] == 'Wila’s laptop' and json.dumps(ls_[0]['sids']).count('wila') == 1 and ls_[0]['id'] == lr[0]['id'] and await lp.locator('.kTile').count() == 1 and not query('tcLapReq'), [ls_, query('tcLapReq')])
    await lp.click('.kTile:has-text("Wila")'); await digits(lp, '7351'); await lp.wait_for_selector('.kBig[data-kind=in]')
    check('at home: clock in and out only (marked Home)', 'Away from the office' in await lp.inner_text('.kPanel') and await lp.locator('.kBig').count() == 2, await lp.inner_text('.kPanel'))
    await lp.click('.kBig[data-kind=in]'); await lp.wait_for_selector('.kDone')
    hp = [x for x in query('tcPunch') if x['sid'] == 'wila']
    check('…Wila clocks in on it: from the laptop, away from the office', len(hp) == 1 and hp[0]['src'] == 'laptop' and hp[0]['net'] == 'off' and hp[0]['by'] == ls_[0]['id'] and 'Marked Home' in await lp.inner_text('.kDone'), hp)
    await lp.click('[data-act=kDone]')
    QUIET['on'] = True
    r = await lp.evaluate("FB.kdb.collection('tcPunch').where('sid', '==', 'gwen').get().then(() => 'read', e => e.code)")
    check('…the laptop reads nobody else’s time', 'permission' in r, r)
    QUIET['on'] = False
    # Dr. A adds Sarah to it, then takes her off again: the laptop follows at once (no reload, no error)
    await op.click('.navBtn[data-v=settings]'); await op.click('[data-act=lapEdit]'); await op.check('.lapWho[value=sarah]'); await op.click('[data-act=lapEditGo]')
    await lp.wait_for_function("() => document.querySelectorAll('.kTile').length === 2", timeout=10000)
    check('Dr. A adds Sarah: the laptop shows her right away', 'Sarah' in await lp.inner_text('.kTiles'))
    await op.click('[data-act=lapEdit]'); await op.uncheck('.lapWho[value=sarah]'); await op.click('[data-act=lapEditGo]')
    QUIET['on'] = True  # (the laptop's listeners for Sarah are refused a moment before it hears she's off it)
    await lp.wait_for_function("() => document.querySelectorAll('.kTile').length === 1", timeout=10000); await lp.wait_for_timeout(1500)
    QUIET['on'] = False
    check('…takes her off: it follows, and keeps working for Wila', 'Wila' in await lp.inner_text('.kTiles') and 'can’t read' not in (await lp.inner_text('#kMain')).lower(), await lp.inner_text('#kMain'))
    # its Wi-Fi drops just as a manager hands it back: a "not there" from the copy kept on the laptop isn't believed
    await lp.click('[data-act=kMgr]'); await lp.fill('#kmU', 'amir'); await lp.fill('#kmP', 'owner-pass-1'); await lp.click('#kmBtn'); await lp.wait_for_selector('#app:not(.hidden)')
    QUIET['on'] = True
    await lc.route('http://127.0.0.1:8080/**', lambda r: r.abort())
    await lp.click('#side [data-act=toKiosk]'); await lp.wait_for_selector('#kiosk:not(.hidden)'); await lp.wait_for_timeout(8000)
    check('offline as it goes back to the time clock: it stays approved (not signed out)', await lp.evaluate("S.mode === 'kiosk' && !!FB.kauth.currentUser && isLaptopHere()"), await lp.inner_text('body'))
    await lc.unroute('http://127.0.0.1:8080/**')
    await lp.wait_for_function("() => document.querySelectorAll('.kTile').length === 1", timeout=60000); await lp.wait_for_timeout(1000)
    QUIET['on'] = False
    check('…and works again once it’s back online', 'Wila' in await lp.inner_text('.kTiles'))

    print('\n# Sarah (approves time off)')
    sc = await ctx_for(b); sp = await sc.new_page(); watch(sp, 'sarah')
    await sign_in(sp, 'sarah', 'sarah-pass-1')
    check('she sees Now (a manager)', (await sp.inner_text('.topBar h2')).lower() == 'now')
    await sp.wait_for_selector('.issue.rq:has-text("Kim Tester")')
    check('Now: Kim’s missed clock-in, waiting', 'Kim Tester missed a punch: Clock in' in await sp.inner_text('.issue.rq:has-text("Kim Tester")'))
    await sp.click('.issue.rq:has-text("Kim Tester") [data-act=reqOk]'); await sp.wait_for_timeout(1000)
    rq = [x for x in query('tcReq') if x['sid'] == 'kim'][0]; kf = [x for x in query('tcFix') if x['sid'] == 'kim']
    check('she approves it: a correction from her with Kim’s note, and the request answered', len(kf) == 1 and kf[0]['bsid'] == 'sarah' and kf[0]['kind'] == 'in' and kf[0]['why'] == 'Asked by Kim at the time clock: Got here early and forgot' and rq['st'] == 'ok' and rq['rbsid'] == 'sarah' and kf[0]['id'] in json.dumps(rq['fx']), [kf, rq])
    await sp.click('.navBtn[data-v=sheets]'); await sp.wait_for_selector('.card.pw')
    await sp.select_option('select[data-chg=sheetPerson]', 'sarah'); await sp.wait_for_timeout(300)
    check('not her own time', 'Only Dr. A corrects your own time.' in await sp.inner_text('.card.pw'))
    await sp.select_option('select[data-chg=sheetPerson]', 'gwen'); await sp.wait_for_timeout(300)
    await sp.click('.card.pw [data-act=addPunch]'); await sp.click('#apKind button[data-k=lunch]')
    await sp.fill('#apTime', office_hm(120)); await sp.fill('#apWhy', 'Took lunch, forgot to clock out for it')
    await sp.click('[data-act=addPunchGo]'); await sp.wait_for_selector('#modalWrap', state='detached'); await sp.wait_for_timeout(800)
    fx = [x for x in query('tcFix') if x['sid'] == 'gwen']
    check('she adds Gwen’s lunch: a correction with who and why', len(fx) == 1 and fx[0]['bsid'] == 'sarah' and fx[0]['kind'] == 'lunch' and fx[0]['why'].startswith('Took lunch'), fx)
    check('…and it shows as a correction', await sp.locator('.pch.fixed').count() == 1)
    await sp.click('.navBtn[data-v=settings]'); await sp.wait_for_selector('#stOt')
    check('settings are read-only for her', await sp.is_disabled('#stOt'))
    QUIET['on'] = True
    r = await sp.evaluate("FB.saveSettings(Object.assign({}, TCE.DEFAULTS, { ot: 50 })).then(() => 'saved', e => e.code)")
    check('…and the database refuses a change from her', 'permission' in r, r)
    QUIET['on'] = False

    print('\n# Kim (not allowed from home), at home')
    NETS['kim'] = HOME_IP
    kc = await ctx_for(b, 'kim'); kp = await kc.new_page(); watch(kp, 'kim')
    await sign_in(kp, 'kim', 'kim-pass-1'); await kp.wait_for_selector('.netAway')
    check('My time: not on the office network, so no punch buttons', await kp.locator('[data-act=ownPunch]').count() == 0 and await kp.locator('.navBtn[data-v=now]').count() == 0)
    check('…and shows her request approved, by whom', 'Approved by Sarah Tester' in await kp.inner_text('#view'), await kp.inner_text('#view'))
    await kp.click('[data-act=meReq]'); await kp.click('[data-act=mrKind][data-k=note]'); await kp.fill('#mrNote', 'Covered the front desk through lunch')
    await kp.click('[data-act=meReqGo]'); await kp.wait_for_selector('#modalWrap', state='detached'); await kp.wait_for_timeout(700)
    mine = [x for x in query('tcReq') if x['sid'] == 'kim' and x['src'] == 'me']
    check('from My time (no home punches for her): a note to the managers', len(mine) == 1 and mine[0]['by'] == UID['kim'] and mine[0]['st'] == 'open', mine)
    await kp.click('.rqMine [data-act=reqUndo]'); await kp.wait_for_timeout(700)
    check('…and she takes it back', [x for x in query('tcReq') if x['id'] == (mine[0]['id'] if mine else '')][0]['st'] == 'x' if mine else False)
    QUIET['on'] = True
    r = await kp.evaluate("FB.netCheck(S.set.wurl).then(n => FB.punchOwn('in', n.pid)).then(() => 'saved', e => e.code)")
    check('a punch from home is refused by the database', 'permission' in r, r)
    QUIET['on'] = False

    print('\n# Dr. A: alerts, the script, payroll')
    await op.click('.navBtn[data-v=alerts]'); await op.wait_for_selector('#alEm')
    await op.click('[data-act=topicNew]'); await op.wait_for_timeout(800)
    topic = (get('meta/tcAlerts') or {}).get('topic', '')
    check('phone push on: a topic nobody can guess', re.fullmatch(r'nlo-clock-[0-9a-f]{20}', topic) is not None, topic)
    await op.click('[data-act=getScript]'); await op.click('#modalWrap [data-x=yes]'); await op.wait_for_selector('[data-act=copyScript]')
    text = await op.evaluate('S.scriptText')
    bots = query('tcBots')
    check('Get the script makes the script’s own login', len(bots) == 1 and bots[0]['email'] in text and '/*TC_CONFIG*/' not in text)
    sf = os.path.join(tempfile.mkdtemp(), 'alerts.gs'); open(sf, 'w').write(text)
    out = json.loads(subprocess.run(['node', os.path.join(HERE, 'run_script.js'), sf, 'records@example.com', 'http://127.0.0.1:%d' % NTFY_PORT], capture_output=True, text=True, timeout=120).stdout or '{}')
    pushes = [json.loads(l) for l in open(log)] if os.path.exists(log) else []
    check('the script as copied runs: setup checks the clock', out.get('error') == '' and re.match(r'\d+ alerts? sent', out.get('result', '')), out)
    check('…Wila from home (her laptop) goes out as a push', pushed(pushes, 'Wila clocked in from home', topic), pushes)
    check('…and the time clock off the office network (Kim’s lunch)', pushed(pushes, 'The time clock is off the office network', topic) and any('Kim went to lunch at' in m.get('body', '') and 'wasn’t on the office network' in m.get('body', '') for m in out.get('mail', [])), [pushes, out.get('mail')])
    check('…and her note to the managers by email and push (not Kim’s: answered, taken back)', pushed(pushes, 'Wila left a note for the managers', topic) and any('Wila left a note for the managers' in m.get('body', '') for m in out.get('mail', [])) and not any(re.search(r'Kim (asked|left a note)', (x.get('title') or '') + (x.get('message') or '')) for x in pushes), [pushes, out.get('mail')])
    await op.click('[data-act=closeM]'); await op.wait_for_timeout(1500)
    check('the page shows the script checked in', 'Checked' in await op.inner_text('#view'), await op.inner_text('#view'))
    await op.click('[data-act=testAlert]'); await op.wait_for_timeout(800)
    out2 = json.loads(subprocess.run(['node', os.path.join(HERE, 'run_script.js'), sf, 'records@example.com', 'http://127.0.0.1:%d' % NTFY_PORT], capture_output=True, text=True, timeout=120).stdout or '{}')
    check('Send a test: the next check emails Dr. A', any('Test alert from NLO Time Clock' in m.get('subject', '') and m.get('to') == 'dr.test@example.com' for m in out2.get('mail', [])), out2)
    check('…and doesn’t send Wila’s again', not any('Wila' in m.get('body', '') for m in out2.get('mail', [])) and sum(1 for l in open(log) if 'Wila clocked in from home' in l) == 1)
    await op.click('.navBtn[data-v=pay]'); await op.wait_for_selector('#payAnchor')
    wk = await op.evaluate('curWeek()'); await op.fill('#payAnchor', wk); await op.click('[data-act=payAnchor]'); await op.wait_for_selector('table.pay')
    await op.wait_for_timeout(800)
    pay = await op.inner_text('table.pay')
    check('payroll lists everyone on the clock', all(n in pay for n in ['Gwen Tester', 'Kim Tester', 'Wila Tester', 'Sarah Tester']), pay)
    async with op.expect_download() as dl: await op.click('[data-act=payCsv]')
    csv = open(await (await dl.value).path(), encoding='utf-8-sig').read()
    check('…and downloads for Paychex', csv.startswith('"Employee","Period start"') and 'Gwen Tester' in csv, csv[:200])

    print('\n# Dr. A removes the time clock')
    QUIET['on'] = True  # (the front desk's live updates are refused from now on, as they should be)
    await op.click('.navBtn[data-v=settings]'); await op.click('[data-act=kioskRemove]'); await op.click('#modalWrap [data-x=yes]'); await op.wait_for_timeout(800)
    check('removed', len(query('tcKiosks')) == 0)
    await pg.reload(); await pg.wait_for_selector('#lockCard .lockErr, #signForm'); await pg.wait_for_timeout(300)
    check('the front-desk computer stops being a time clock', 'isn’t set up as the time clock' in await pg.inner_text('#lockCard'), await pg.inner_text('#lockCard'))
    await op.click('.navBtn[data-v=settings]'); await op.click('[data-act=lapRemove]'); await op.click('#modalWrap [data-x=yes]'); await op.wait_for_timeout(800)
    check('Dr. A takes back Wila’s laptop', len(query('tcLaptops')) == 0)
    await lp.wait_for_selector('#lockCard .lockErr', timeout=10000)
    check('…and it stops being one at once, and says so', 'isn’t approved any more' in await lp.inner_text('#lockCard'), await lp.inner_text('#lockCard'))
    await lp.reload(); await lp.wait_for_selector('#signForm'); await lp.wait_for_timeout(300)
    check('…its login is gone from it (reloaded: just the sign-in)', await lp.locator('.kTile').count() == 0 and await lp.evaluate('!FB.kauth.currentUser'))
    QUIET['on'] = False

    check('no errors in any browser', not ERRS, ERRS)
    await b.close()

asyncio.run(main())
