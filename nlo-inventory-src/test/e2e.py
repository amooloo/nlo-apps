"""End-to-end checks of the built page (dist/index.html) against a stand-in Firebase (test/fake-firebase.js) holding
legacy-shaped data (test/seed.js), in headless Chromium.  Run:  python3 build.py && python3 test/e2e.py [test names…]
Needs Python Playwright with Chromium, and Node (the spend check runs Staff Meeting Hub's own copy of the math, test/staff_spend.js).
Optional: NLO_FONTS=<folder> with fonts.css and the woff2 files, for the real fonts (otherwise the fallback fonts are used)."""
import sys, os, re, json, shutil, subprocess, time, pathlib, traceback
from playwright.sync_api import sync_playwright
HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent
WWW = HERE / 'www'
FONTS = os.environ.get('NLO_FONTS', '')
if WWW.exists() and 'KEEP' not in __import__('os').environ: shutil.rmtree(WWW)
WWW.mkdir(exist_ok=True)
page = (SRC / 'dist/index.html').read_text()
n = len(re.findall(r'<script src="https://www\.gstatic\.com/firebasejs/[^"]+"[^>]*></script>\n?', page))
assert n == 4, n
page = re.sub(r'(<script src="https://www\.gstatic\.com/firebasejs/[^"]+"[^>]*></script>\n?)+', '<script src="fake-firebase.js" defer></script>\n', page, count=1)
(WWW / 'index.html').write_text(page)
shutil.copy(SRC / 'test/fake-firebase.js', WWW / 'fake-firebase.js')
shutil.copy(SRC / 'dist/logo-white.png', WWW / 'logo-white.png')
SEED = (HERE / 'seed.js').read_text()
PORT = 8793
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=WWW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:600]))
def fonts(route):
    u = route.request.url
    if not FONTS: return route.abort()
    if 'fonts.googleapis.com' in u: return route.fulfill(status=200, content_type='text/css', body=open(FONTS + '/fonts.css').read())
    f = FONTS + '/' + re.sub(r'^https://fonts.gstatic.com/', '', u).replace('/', '_')
    if os.path.exists(f): return route.fulfill(status=200, content_type='font/woff2', body=open(f, 'rb').read())
    return route.abort()
INIT = SEED + """
window.__FAKE = { store: JSON.parse(JSON.stringify(window.__SEED)), user: { email: 'records@thenextlevelorthodontics.com', uid: 'u1', emailVerified: true }, strict: true };
"""
def open_app(b, extra_init='', who=None, w=1366, h=900):
    ctx = b.new_context(viewport={'width': w, 'height': h})
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), fonts)
    ctx.route(re.compile(r'https://www\.google\.com/s2/favicons.*'), lambda r: r.abort())
    ctx.add_init_script(INIT + extra_init)
    if who: ctx.add_init_script("localStorage.setItem('nloInv.who', JSON.stringify(%s))" % json.dumps(who))
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text[:300]) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('dialog', lambda d: (errs.append('native dialog: ' + d.message[:120]), d.dismiss()))
    pg.on('response', lambda r: errs.append('HTTP %d %s' % (r.status, r.url[:120])) if r.status >= 400 and 'favicons' not in r.url and 'fonts.g' not in r.url else None)
    pg.goto('http://127.0.0.1:%d/index.html' % PORT, wait_until='load')
    pg.wait_for_function("() => typeof S !== 'undefined' && S.inApp && allLoaded()", timeout=8000)
    pg.wait_for_timeout(300)
    return ctx, pg, errs
def J(pg, js): return pg.evaluate(js)
def store(pg, path):
    return pg.evaluate("p => { let o = window.__FAKE.store; for (const k of p.split('/').filter(Boolean)) { if (o == null) return null; o = o[k]; } return o === undefined ? null : JSON.parse(JSON.stringify(o)); }", path)
def click(pg, sel, wait=300):
    pg.click(sel); pg.wait_for_timeout(wait)
def pick_who(pg, pid, wait=400):
    pg.wait_for_selector('.whoBtn[data-id="%s"]' % pid, timeout=3000); pg.click('.whoBtn[data-id="%s"]' % pid); pg.wait_for_timeout(wait)
NOW = lambda: int(time.time() * 1000)
WHO = lambda pid, short, name: {'id': pid, 'short': short, 'name': name, 'at': NOW()}

TESTS = []
def test(fn): TESTS.append(fn); return fn

@test
def t_boot(b):
    ctx, pg, errs = open_app(b)
    check('boot: in the app, not the lock screen', J(pg, "!document.querySelector('#app').classList.contains('hidden')"))
    check('boot: roster people (active only)', J(pg, "S.people.map(p=>p.short).join(',')") == 'Dr. A,Gwen R.,Kaylee D.,Sarah B.', J(pg, "S.people.map(p=>p.short)"))
    check('boot: deleted item hidden, archived kept apart', J(pg, "[items().length, activeItems().length]") == [5, 4], J(pg, "[items().length, activeItems().length]"))
    check('boot: old category migrated (bonding -> adhesives)', J(pg, "itemById('adh-1').cat") == 'adhesives')
    check('boot: legacy cart line shows', J(pg, "S.D.cart.length===1 && S.D.cart[0].itemId==='adh-1'"))
    check('boot: sync line live', 'Live' in J(pg, "document.querySelector('#syncLine').textContent"), J(pg, "document.querySelector('#syncLine').textContent"))
    for v in ['home', 'supplies', 'cart', 'orders', 'quick', 'budget', 'activity', 'vendors', 'settings']:
        J(pg, "go('%s')" % v); pg.wait_for_timeout(150)
        bad = J(pg, "document.querySelector('#view').textContent.includes('hit a problem')")
        check('render: ' + v, not bad, J(pg, "document.querySelector('#view').textContent.slice(0,300)"))
    check('boot: no page errors', not errs, errs)
    ctx.close()

@test
def t_cart_add_case(b):
    ctx, pg, errs = open_app(b)
    J(pg, "go('supplies')"); pg.wait_for_timeout(200)
    J(pg, "openAddToCart(itemById('ppe-3'), 2)"); pg.wait_for_timeout(200)
    check('add: shows 2 cases = 20 boxes', '2 cases = 20 boxes' in J(pg, "document.querySelector('#addEq').textContent"), J(pg, "document.querySelector('#addEq') && document.querySelector('#addEq').textContent"))
    click(pg, '#addGo')
    check('add: asks who first', J(pg, "!!document.querySelector('.whoBtn')"))
    pick_who(pg, 's_gwen', 600)
    cart = store(pg, 'nlo/cart') or []
    line = next((c for c in (cart if isinstance(cart, list) else cart.values()) if c and c.get('itemId') == 'ppe-3'), None)
    check('add: cart line saved', line is not None, cart)
    if line:
        check('add: line in cases with per 10', line.get('qty') == 2 and line.get('unit') == 'case' and line.get('per') == 10 and line.get('countUnit') == 'box', line)
        check('add: case price 100', abs((line.get('price') or 0) - 100) < 0.001, line.get('price'))
        check('add: stamped who/when', line.get('addedBy') == 'Gwen R.' and line.get('addedById') == 's_gwen' and bool(line.get('addedAt')), line)
        check('add: kept the old line', any(c and c.get('itemId') == 'adh-1' for c in (cart if isinstance(cart, list) else cart.values())), cart)
    q = store(pg, 'nlo/settings/alertQueue') or {}
    ev = [e for e in q.values() if e.get('t') == 'cart']
    check('add: alert queued with who', ev and ev[0].get('by') == 'Gwen R.' and ev[0]['lines'][0]['q'] == 2, ev)
    # add more of the same, another person, while "another computer" also adds something
    J(pg, "whoSet(personById('s_kaylee'))")
    J(pg, """(()=>{ const c = window.__FAKE.store.nlo.cart; const arr = Array.isArray(c) ? c.slice() : Object.values(c); arr.push({ itemId: 'ppe-2', name: 'Gloves Pulse Nitrile — LG', sku: '177302', vendor: 'SunSurgical', price: 9.13, unit: 'box', qty: 3 }); window.__FAKE.remote('nlo/cart', arr); })()""")
    pg.wait_for_timeout(200)
    J(pg, "cartAdd(itemById('ppe-3'), 1, {})"); pg.wait_for_timeout(400)
    cart = store(pg, 'nlo/cart'); cart = cart if isinstance(cart, list) else list(cart.values())
    l3 = next((c for c in cart if c.get('itemId') == 'ppe-3'), {})
    check('add more: 3 cases, trail has +1 by Kaylee', l3.get('qty') == 3 and any(t.get('t') == 'more' and t.get('by') == 'Kaylee D.' for t in (l3.get('trail') or [])), l3)
    check('add more: other computer\'s line kept', any(c.get('itemId') == 'ppe-2' for c in cart), cart)
    check('cart: no page errors', not errs, errs)
    ctx.close()

@test
def t_place_and_receive(b):
    ctx, pg, errs = open_app(b, who=WHO('s_sarah', 'Sarah B.', 'Sarah Bell'))
    J(pg, "cartAdd(itemById('ppe-1'), 2, {})"); pg.wait_for_timeout(300)
    J(pg, "go('cart')"); pg.wait_for_timeout(200)
    # ppe-1 isn't set to cases yet: 2 boxes
    cart = store(pg, 'nlo/cart'); cart = cart if isinstance(cart, list) else list(cart.values())
    l1 = next((c for c in cart if c.get('itemId') == 'ppe-1'), {})
    check('box item: 2 boxes, no per', l1.get('unit') == 'box' and not l1.get('per'), l1)
    J(pg, "itemById('ppe-1')") 
    # make it bought by the case, as the editor would, then add 1 case
    J(pg, "B.patchItem('ppe-1', { buyUnit: 'case', perBuy: 10 })"); pg.wait_for_timeout(300)
    J(pg, "cartSetQty('ppe-1', 0)"); pg.wait_for_timeout(300)
    J(pg, "cartAdd(itemById('ppe-1'), 1, {})"); pg.wait_for_timeout(300)
    J(pg, "go('cart')"); pg.wait_for_timeout(200)
    btn = pg.query_selector('[data-act="placeOrder"][data-v="SunSurgical"]')
    check('cart: place button for SunSurgical', btn is not None)
    if btn:
        btn.click(); pg.wait_for_timeout(300)
        pg.fill('#poNum', 'SS-1001')
        click(pg, '[data-act="placeGo"]', 700)
    orders = store(pg, 'nlo/orders')
    mine = [o for o in orders.values() if o.get('orderNumber') == 'SS-1001']
    check('place: order saved', len(mine) == 1, list(orders.keys()))
    if mine:
        o = mine[0]
        check('place: ordered by Sarah, with time and method', o.get('orderedBy') == 'Sarah B.' and o.get('orderedById') == 's_sarah' and o.get('orderedAt') and o.get('method') == 'online' and o.get('status') == 'open', {k: o.get(k) for k in ['orderedBy', 'orderedById', 'orderedAt', 'method', 'status']})
        check('place: id shape order-…', o['id'].startswith('order-'), o['id'])
        check('place: dateOrdered is a local day', re.match(r'^\d{4}-\d{2}-\d{2}$', o.get('dateOrdered') or '') is not None, o.get('dateOrdered'))
        ln = next((l for l in o['items'] if l.get('itemId') == 'ppe-1'), {})
        check('place: line keeps who added it', ln.get('addedBy') == 'Sarah B.' and ln.get('unit') == 'case' and ln.get('per') == 10, ln)
        check('place: trail ordered', any(t.get('t') == 'ordered' and t.get('by') == 'Sarah B.' for t in o.get('trail') or []), o.get('trail'))
        cart = store(pg, 'nlo/cart') or []
        cart = cart if isinstance(cart, list) else list(cart.values())
        check('place: lines left the cart (SunSurgical only)', not any(c.get('vendor') == 'SunSurgical' for c in cart) and any(c.get('itemId') == 'adh-1' for c in cart), cart)
        it = store(pg, 'nlo/items/ppe-1')
        check('place: item remembers last ordered', it.get('lastOrderedTimestamp') and it.get('lastOrderedVendorId') == 'SunSurgical', {k: it.get(k) for k in ['lastOrderedTimestamp', 'lastOrderedVendorId']})
        # receive as Kaylee (not an admin) with the defaults
        J(pg, "whoSet(personById('s_kaylee'))")
        q0 = store(pg, 'nlo/items/ppe-1')['qty']
        J(pg, "go('orders')"); pg.wait_for_timeout(200)
        J(pg, "document.querySelector('[data-act=\"receive\"][data-id=\"%s\"]').click()" % o['id']); pg.wait_for_timeout(300)
        check('receive: shows = 10 boxes', '10 boxes' in J(pg, "document.querySelector('#rcEq0').textContent"), J(pg, "document.querySelector('#rcEq0') && document.querySelector('#rcEq0').textContent"))
        J(pg, "document.querySelector('#rcShip').value = '8.5'; INP.rcCalc()")
        click(pg, '[data-act="rcGo"]', 800)
        o2 = store(pg, 'nlo/orders/' + o['id'])
        q1 = store(pg, 'nlo/items/ppe-1')['qty']
        check('receive: +10 boxes for 1 case', q1 - q0 == 10, (q0, q1))
        check('receive: stamped received by Kaylee', o2.get('status') == 'received' and o2.get('receivedBy') == 'Kaylee D.' and o2.get('receivedById') == 's_kaylee' and o2.get('dateReceived'), {k: o2.get(k) for k in ['status', 'receivedBy', 'receivedById', 'dateReceived']})
        logs = [e for e in store(pg, 'nlo/log').values() if e.get('orderId') == o['id']]
        rec = [e for e in logs if e['type'] == 'receive']; sh = [e for e in logs if e['type'] == 'shipping']
        check('receive: one receipt, 10 boxes, $91.30, by Kaylee', len(rec) == 1 and rec[0]['delta'] == 10 and abs(rec[0]['amount'] - 91.3) < 0.001 and rec[0]['by'] == 'Kaylee D.' and rec[0].get('date'), rec)
        check('receive: shipping booked once', len(sh) == 1 and abs(sh[0]['amount'] - 8.5) < 0.001, sh)
        it = store(pg, 'nlo/items/ppe-1')
        src = (it.get('sources') or [{}])[0]
        check('receive: price remembered per box', abs((src.get('price') or 0) - 9.13) < 0.0001 and src.get('vendor') == 'SunSurgical', it.get('sources'))
        # receiving again is refused
        r = J(pg, "receiveOrder('%s', {}).then(()=>'went through', e=>e.message)" % o['id'])
        check('receive twice: refused', 'already received' in r, r)
        # reopen as a non-admin: refused; as Sarah: works, and twice is refused
        J(pg, "go('orders'); openDrawer('order', '%s')" % o['id']); pg.wait_for_timeout(200)
        click(pg, '[data-act="orderReopen"]', 300)
        check('reopen: non-admin refused', J(pg, "[...document.querySelectorAll('#toasts .toast')].some(t=>/Only .* can reopen/.test(t.textContent))"), J(pg, "document.querySelector('#toasts').textContent"))
        J(pg, "whoSet(personById('s_sarah'))")
        click(pg, '[data-act="orderReopen"]', 300)
        click(pg, '#cbYes', 800)
        o3 = store(pg, 'nlo/orders/' + o['id']); q2 = store(pg, 'nlo/items/ppe-1')['qty']
        check('reopen: open again, stock back', o3.get('status') == 'open' and q2 == q0, (o3.get('status'), q0, q2))
        logs = [e for e in store(pg, 'nlo/log').values() if e.get('orderId') == o['id']]
        net = round(sum((e.get('amount') or 0) for e in logs), 2)
        check('reopen: money nets to 0', net == 0, [(e['type'], e.get('amount')) for e in logs])
        r = J(pg, "reopenOrder('%s').then(()=>'went through', e=>e.message)" % o['id'])
        check('reopen twice: refused', 'isn’t received' in r, r)
        # receive again: counts again, exactly once
        J(pg, "receiveOrder('%s', {})" % o['id']); pg.wait_for_timeout(600)
        q3 = store(pg, 'nlo/items/ppe-1')['qty']
        check('re-receive: +10 again', q3 - q0 == 10, (q0, q3))
    check('place/receive: no page errors', not errs, errs)
    ctx.close()

@test
def t_legacy_orders(b):
    ctx, pg, errs = open_app(b, who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
    J(pg, "go('orders')"); pg.wait_for_timeout(200)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('legacy order: shows ordered by Sarah B. by phone', 'Sarah B.' in txt and 'by phone' in txt, txt[:400])
    J(pg, "go('activity')"); pg.wait_for_timeout(200)
    txt = J(pg, "document.querySelector('#view').textContent")
    check('activity: legacy order in feed', 'Sarah B. placed the Henry Schein order' in txt, txt[:600])
    check('activity: old receive with who', 'Kaylee D. received the American Orthodontics order' in txt, txt[:800])
    # receive a legacy order line with an unlinked line and a short line -> backorder
    J(pg, "go('orders')"); pg.wait_for_timeout(100)
    J(pg, "document.querySelector('[data-act=\"receive\"][data-id=\"abc123\"]').click()"); pg.wait_for_timeout(300)
    J(pg, "document.querySelector('[data-rc=\"qty\"][data-k=\"0\"]').value='1'; INP.rcCalc()")
    click(pg, '[data-act="rcGo"]', 800)
    orders = store(pg, 'nlo/orders')
    bo = [o for o in orders.values() if o.get('backorderOf') == 'abc123']
    check('short receive: backorder for 1 syringe', len(bo) == 1 and bo[0]['items'][0]['qty'] == 1 and bo[0]['status'] == 'open', bo)
    o = orders['abc123']
    check('short receive: orderedQty kept', o['items'][0].get('orderedQty') == 2 and o['items'][0]['qty'] == 1, o['items'][0])
    check('short receive: legacy scratch fields untouched', o.get('_selectedVendorId') == 'Henry Schein', o.get('_selectedVendorId'))
    check('legacy: no page errors', not errs, errs)
    ctx.close()

@test
def t_spend_matches_staff_meeting(b):
    ctx, pg, errs = open_app(b, who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
    # receive the old SunSurgical order (box line, legacy) and the Henry Schein one, then compare month totals with Staff Meeting's computeSpending
    J(pg, "receiveOrder('order-old1', {})"); pg.wait_for_timeout(500)
    J(pg, "receiveOrder('abc123', { lines: [{ qty: 2, price: 39.99 }, { qty: 1, price: 5 }], discount: 4, tax: 3.2, shipping: 6 })"); pg.wait_for_timeout(600)
    ours = J(pg, "(()=>{ const out = {}; for (let i = 0; i < 3; i++) { const k = shiftMonth(monthKey(Date.now()), -i); out[k] = round2(monthSpend(k, S.D).total); } return out; })()")
    data = J(pg, "({ items: window.__FAKE.store.nlo.items, orders: window.__FAKE.store.nlo.orders, log: window.__FAKE.store.nlo.log, budget: window.__FAKE.store.nlo.budget })")
    (WWW / 'spend-data.json').write_text(json.dumps(data))
    r = subprocess.run(['node', str(HERE / 'staff_spend.js'), str(WWW / 'spend-data.json')], capture_output=True, text=True)
    theirs = json.loads(r.stdout or '{}') if r.returncode == 0 else {'err': r.stderr[:500]}
    same = all(abs((theirs.get(k, {}) or {}).get('total', 0) - v) < 0.005 for k, v in ours.items())
    check('spend: same month totals as Staff Meeting', same and 'err' not in theirs, {'ours': ours, 'theirs': {k: (v or {}).get('total') for k, v in theirs.items()} if 'err' not in theirs else theirs})
    check('spend: no page errors', not errs, errs)
    ctx.close()

@test
def t_who_expiry_and_admin(b):
    ctx, pg, errs = open_app(b, who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
    check('who: kept from this computer', J(pg, "whoNow() && whoNow().short") == 'Gwen R.')
    J(pg, "S.who.at = Date.now() - 11*60000; whoSave(); renderWho()")
    check('who: gone after 10 minutes', J(pg, "whoNow()") is None)
    J(pg, "go('supplies'); openAddToCart(itemById('adh-1'), 1)"); pg.wait_for_timeout(200)
    click(pg, '#addGo', 300)
    check('who: asks again after expiry', J(pg, "!!document.querySelector('.whoBtn')"))
    pick_who(pg, 's_kaylee')
    J(pg, "go('budget')"); pg.wait_for_timeout(150)
    click(pg, '[data-act="budgetEdit"]', 300)
    check('admin: Kaylee can’t edit the budget', J(pg, "!document.querySelector('#bMonthly') && /Only .* can change budget/.test(document.querySelector('#toasts').textContent)"), J(pg, "document.querySelector('#toasts').textContent"))
    J(pg, "whoSet(personById('s_sarah'))")
    click(pg, '[data-act="budgetEdit"]', 300)
    check('admin: Sarah can', J(pg, "!!document.querySelector('#bMonthly')"))
    J(pg, "document.querySelector('#bMonthly').value = '8500'")
    click(pg, '[data-act="budgetSave"]', 500)
    bud = store(pg, 'nlo/budget')
    check('budget: saved, expenses kept', bud.get('monthly') == 8500 and len(bud.get('expenses') or []) == 1 and bud.get('changedBy') == 'Sarah B.', bud)
    check('who/admin: no page errors', not errs, errs)
    ctx.close()

@test
def t_offline(b):
    ctx, pg, errs = open_app(b, who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
    J(pg, "window.__FAKE.offline = true; window.__FAKE.notifyAll()"); pg.wait_for_timeout(300)
    check('offline: sync line says so', 'Offline' in J(pg, "document.querySelector('#syncLine').textContent"), J(pg, "document.querySelector('#syncLine').textContent"))
    J(pg, "stockStep(itemById('adh-1'), -1, 'use'); null"); pg.wait_for_timeout(200)
    check('offline: write held', store(pg, 'nlo/items/adh-1')['qty'] == 4)
    J(pg, "window.__FAKE.goOnline()"); pg.wait_for_timeout(500)
    check('online: write went through', store(pg, 'nlo/items/adh-1')['qty'] == 3, store(pg, 'nlo/items/adh-1')['qty'])
    lg = [e for e in store(pg, 'nlo/log').values() if e.get('type') == 'use' and e.get('itemId') == 'adh-1']
    check('use: logged with who', lg and lg[0].get('by') == 'Gwen R.' and lg[0].get('delta') == -1, lg)
    check('offline: no page errors', not errs, errs)
    ctx.close()

@test
def t_phone(b):
    ctx, pg, errs = open_app(b, who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'), w=390, h=844)
    for v in ['home', 'supplies', 'cart', 'orders', 'budget', 'activity', 'vendors', 'settings']:
        J(pg, "go('%s')" % v); pg.wait_for_timeout(150)
        ow = J(pg, "document.documentElement.scrollWidth > window.innerWidth + 1")
        check('phone: no sideways scroll on ' + v, not ow, J(pg, "[document.documentElement.scrollWidth, window.innerWidth]"))
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
    ctx, pg, errs = open_app(b, extra_init="window.__FAKE.store.nlo.settings.geminiKey = 'AIzaFAKEKEYFORTESTS';", who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
    ctx.route(re.compile(r'https://generativelanguage\.googleapis\.com/.*'), gemini_route)
    GEM['reply'] = {'document': {'vendorName': 'Henry Schein', 'invoiceNumber': 'HS-77', 'orderNumber': ''}, 'items': [{'name': 'TRANSBOND XT REFILL SYR', 'sku': '1012345', 'vendor': 'CETYLI', 'price': 38.5, 'qty': 2, 'slipUnit': 'EA'}]}
    q0 = store(pg, 'nlo/items/adh-1')['qty']
    slip_scan(pg)
    U = J(pg, "({vendor: S.ui.slip.vendor, match: S.ui.slip.match, rows: S.ui.slip.rows.map(r => [r.itemId, r.matchType, r.qty, r.price])})")
    check('slip A: matched the open Henry Schein order', U['match']['orderId'] == 'abc123' and U['vendor'] == 'Henry Schein', U)
    check('slip A: line matched by SKU', U['rows'] and U['rows'][0][0] == 'adh-1' and U['rows'][0][1] == 'sku', U['rows'])
    J(pg, "document.querySelector('#slShip').value = '9.95'; INP.slMoneyInp()")
    click(pg, '[data-act="slGo"]', 1200)
    o = store(pg, 'nlo/orders/abc123'); q1 = store(pg, 'nlo/items/adh-1')['qty']
    check('slip A: order received, by Gwen, invoice #', o.get('status') == 'received' and o.get('receivedBy') == 'Gwen R.' and o.get('invoiceNumber') == 'HS-77' and o.get('receiveMethod') == 'scan', {k: o.get(k) for k in ['status', 'receivedBy', 'invoiceNumber', 'receiveMethod']})
    check('slip A: +2 syringes', q1 - q0 == 2, (q0, q1))
    logs = [e for e in store(pg, 'nlo/log').values() if e.get('orderId') == 'abc123']
    rec = [e for e in logs if e['type'] == 'receive']
    check('slip A: receipt carries the order and the slip price', len(rec) == 1 and abs(rec[0]['amount'] - 77) < 0.001 and rec[0]['delta'] == 2, rec)
    check('slip A: shipping once', len([e for e in logs if e['type'] == 'shipping']) == 1)
    bo = [x for x in store(pg, 'nlo/orders').values() if x.get('backorderOf') == 'abc123']
    check('slip A: backorder for the line that didn\'t come', len(bo) == 1 and bo[0]['items'][0]['name'] == 'Shipping box', bo)
    srcs = store(pg, 'nlo/items/adh-1')['sources']
    hs = [x for x in srcs if x.get('vendor') == 'Henry Schein']
    check('slip A: Henry Schein price remembered, no CETYLI vendor', hs and abs(hs[0]['price'] - 38.5) < 0.001 and not any('CETYLI' in str(x.get('vendor')) for x in srcs), srcs)
    check('slip A: no page errors', not errs, errs)
    ctx.close()

@test
def t_slip_no_order(b):
    ctx, pg, errs = open_app(b, extra_init="window.__FAKE.store.nlo.settings.geminiKey = 'AIzaFAKEKEYFORTESTS';", who=WHO('s_kaylee', 'Kaylee D.', 'Kaylee Dunn'))
    ctx.route(re.compile(r'https://generativelanguage\.googleapis\.com/.*'), gemini_route)
    GEM['reply'] = {'document': {'vendorName': 'Benco Dental', 'invoiceNumber': 'B-9', 'accountId': 'BEN-555'}, 'items': [
        {'name': 'Pulse Nitrile Glove LG', 'sku': '177302', 'price': 92, 'qty': 1, 'slipUnit': 'CS', 'packQty': 10},
        {'name': 'Brand New Widget', 'sku': 'NW-1', 'price': 5, 'qty': 4, 'slipUnit': 'EA'}]}
    q0 = store(pg, 'nlo/items/ppe-2')['qty']
    slip_scan(pg)
    U = J(pg, "({match: S.ui.slip.match, rows: S.ui.slip.rows.map(r => [r.itemId, r.matchType, r.isNew, r.qty, r.newName])})")
    check('slip B: no open order picked', not U['match']['orderId'], U)
    check('slip B: gloves 1 case = 10 boxes; widget new', U['rows'][0][0] == 'ppe-2' and U['rows'][0][3] == '10' and U['rows'][1][2] is True, U['rows'])
    click(pg, '[data-act="slGo"]', 1500)
    q1 = store(pg, 'nlo/items/ppe-2')['qty']
    check('slip B: +10 boxes', q1 - q0 == 10, (q0, q1))
    orders = [o for o in store(pg, 'nlo/orders').values() if o.get('invoiceNumber') == 'B-9']
    check('slip B: filed as a received order', len(orders) == 1 and orders[0]['status'] == 'received' and orders[0]['vendor'] == 'Benco Dental' and orders[0].get('countUpdated') is True, orders)
    items = store(pg, 'nlo/items'); widget = [i for i in items.values() if i.get('name') == 'Brand New Widget']
    check('slip B: new supply made, with its 4 in stock', len(widget) == 1 and widget[0]['qty'] == 4 and widget[0]['sources'][0]['vendor'] == 'Benco Dental', widget)
    if orders:
        logs = [e for e in store(pg, 'nlo/log').values() if e.get('orderId') == orders[0]['id']]
        check('slip B: both lines booked to the budget', sorted(round(e['amount'], 2) for e in logs if e['type'] == 'receive') == [20.0, 92.0], [(e['type'], e.get('amount')) for e in logs])
    vs = [v for v in store(pg, 'nlo/vendors').values() if v.get('name') == 'Benco Dental']
    check('slip B: vendor made, account # saved', vs and vs[0].get('acct') in (None, 'BEN-555'), vs)
    check('slip B: no page errors', not errs, errs)
    ctx.close()

@test
def t_slip_already_received(b):
    ctx, pg, errs = open_app(b, extra_init="window.__FAKE.store.nlo.settings.geminiKey = 'AIzaFAKEKEYFORTESTS'; delete window.__FAKE.store.nlo.orders['abc123']; delete window.__FAKE.store.nlo.orders['order-old1'];", who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
    ctx.route(re.compile(r'https://generativelanguage\.googleapis\.com/.*'), gemini_route)
    GEM['reply'] = {'document': {'vendorName': 'American Orthodontics', 'invoiceNumber': 'AO-123'}, 'items': [{'name': 'Transbond XT', 'sku': '712-035', 'price': 42, 'qty': 3, 'slipUnit': 'EA'}]}
    q0 = store(pg, 'nlo/items/adh-1')['qty']
    slip_scan(pg)
    U = J(pg, "S.ui.slip.match")
    check('slip C: found the received AO order', U.get('recvId') == 'order-r1' and not U.get('orderId'), U)
    click(pg, '[data-act="slGo"]', 1200)
    o = store(pg, 'nlo/orders/order-r1'); q1 = store(pg, 'nlo/items/adh-1')['qty']
    check('slip C: stock not counted again', q1 == q0, (q0, q1))
    check('slip C: invoice # and price updated', o.get('invoiceNumber') == 'AO-123' and abs(o['items'][0]['price'] - 42) < 0.001, o)
    logs = [e for e in store(pg, 'nlo/log').values() if e.get('orderId') == 'order-r1']
    check('slip C: no new receipt, shipping not doubled', len([e for e in logs if e['type'] == 'receive']) == 1 and len([e for e in logs if e['type'] == 'shipping']) == 1, [(e['type'], e.get('amount')) for e in logs])
    check('slip C: no page errors', not errs, errs)
    ctx.close()

@test
def t_editor(b):
    ctx, pg, errs = open_app(b, who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
    J(pg, "go('supplies'); openEditor('ppe-2')"); pg.wait_for_timeout(300)
    J(pg, "document.querySelector('#edBig').checked = true; document.querySelector('#edBig').dispatchEvent(new Event('change', {bubbles: true}))"); pg.wait_for_timeout(200)
    price = J(pg, "document.querySelector('[data-ed=\"price\"][data-k=\"0\"]').value")
    check('editor: switching to cases turns $9.13/box into $91.30/case', price == '91.30', price)
    J(pg, "document.querySelector('#edMin').value = '0'")
    q0 = store(pg, 'nlo/items/ppe-2')['qty']
    J(pg, "window.__FAKE.remote('nlo/items/ppe-2/qty', 99)"); pg.wait_for_timeout(200)
    click(pg, '[data-act="edSave"]', 800)
    it = store(pg, 'nlo/items/ppe-2')
    check('editor: saved as bought by the case of 10', it.get('buyUnit') == 'case' and it.get('perBuy') == 10 and it.get('unit') == 'box', {k: it.get(k) for k in ['buyUnit', 'perBuy', 'unit']})
    check('editor: price kept per box', abs(it['sources'][0]['price'] - 9.13) < 0.0001 and it['sources'][0]['vendor'] == 'SunSurgical', it.get('sources'))
    check('editor: legacy flat fields left alone', it.get('price') == 9.13 and it.get('src') == 'https://www.sunsurgical.com', {k: it.get(k) for k in ['price', 'src']})
    check('editor: min 0 stays 0', it.get('min') == 0, it.get('min'))
    check('editor: count changed elsewhere meanwhile is kept', it.get('qty') == 99, it.get('qty'))
    check('editor: stamped', it.get('updatedBy') == 'Gwen R.' and it.get('updatedAt'), {k: it.get(k) for k in ['updatedBy', 'updatedAt']})
    # a new one
    J(pg, "openEditor(null)"); pg.wait_for_timeout(300)
    J(pg, "document.querySelector('#edName').value = 'Masks Level 3'; document.querySelector('#edUnit').value = 'box'; document.querySelector('#edQty').value = '6'; document.querySelector('[data-ed=\"vendor\"][data-k=\"0\"]').value = 'Brand New Vendor'; document.querySelector('[data-ed=\"price\"][data-k=\"0\"]').value = '12.5'")
    click(pg, '[data-act="edSave"]', 800)
    its = [i for i in store(pg, 'nlo/items').values() if i.get('name') == 'Masks Level 3']
    check('editor: new supply saved with its count', len(its) == 1 and its[0]['qty'] == 6 and its[0]['id'].startswith('custom-') and its[0].get('createdBy') == 'Gwen R.', its)
    vs = [v for v in store(pg, 'nlo/vendors').values() if v.get('name') == 'Brand New Vendor']
    check('editor: new vendor added to the list', len(vs) == 1, vs)
    lg = [e for e in store(pg, 'nlo/log').values() if its and e.get('itemId') == its[0]['id']]
    check('editor: starting count logged', lg and lg[0]['type'] == 'count' and lg[0]['delta'] == 6, lg)
    check('editor: no page errors', not errs, errs)
    ctx.close()

@test
def t_cases(b):
    """gloves set up as cases from Settings; a cart line and an open order made before that are put right"""
    ctx, pg, errs = open_app(b, who=WHO('s_kaylee', 'Kaylee D.', 'Kaylee Dunn'))
    J(pg, "cartAdd(itemById('ppe-1'), 2, {})"); pg.wait_for_timeout(300)
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    ids = J(pg, "[...document.querySelectorAll('[data-case]')].map(i => i.dataset.case)")
    check('case helper: lists the gloves still bought by the box', sorted(ids) == ['ppe-1', 'ppe-2'], ids)
    check('case helper: names the one already set up', 'Gloves Nitrile Black' in J(pg, "document.querySelector('#view').textContent"))
    click(pg, '[data-act="caseApply"]', 400)
    check('case helper: Kaylee can’t', J(pg, "/Only .* can change how supplies are bought/.test(document.querySelector('#toasts').textContent)") and not store(pg, 'nlo/items/ppe-1').get('buyUnit'), J(pg, "document.querySelector('#toasts').textContent"))
    J(pg, "whoSet(personById('s_sarah'))")
    click(pg, '[data-act="caseApply"]', 900)
    i1 = store(pg, 'nlo/items/ppe-1'); i2 = store(pg, 'nlo/items/ppe-2')
    check('case helper: both bought by the case of 10, counted in boxes', all(i.get('buyUnit') == 'case' and i.get('perBuy') == 10 and i.get('unit') == 'box' for i in (i1, i2)), [{k: i.get(k) for k in ['buyUnit', 'perBuy', 'unit']} for i in (i1, i2)])
    s1 = (i1.get('sources') or [{}])[0]; s2 = (i2.get('sources') or [{}])[0]
    check('case helper: prices stay per box', abs((s1.get('price') or 0) - 9.13) < 1e-6 and abs((s2.get('price') or 0) - 9.13) < 1e-6 and s2.get('vendor') == 'SunSurgical', [s1, s2])
    check('case helper: counts untouched, stamped by Sarah', i1.get('qty') == 14 and i2.get('qty') == 6 and i1.get('updatedBy') == 'Sarah B.', {k: i1.get(k) for k in ['qty', 'updatedBy']})
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    check('case helper: nothing left to set up', J(pg, "document.querySelectorAll('[data-case]').length") == 0)
    # the 2-box cart line from before
    J(pg, "go('cart')"); pg.wait_for_timeout(200)
    check('cart: line added in boxes is flagged', J(pg, "!!document.querySelector('.oldUnit [data-act=\"cartToCases\"][data-id=\"ppe-1\"]')"))
    click(pg, '.oldUnit [data-act="cartToCases"][data-id="ppe-1"]', 300)
    check('cart: offers 2 cases', J(pg, "document.querySelector('#cbVal') && document.querySelector('#cbVal').value") == '2', J(pg, "document.querySelector('#cbVal') && document.querySelector('#cbVal').value"))
    click(pg, '#cbYes', 700)
    cart = store(pg, 'nlo/cart'); cart = cart if isinstance(cart, list) else list(cart.values())
    l1 = next((c for c in cart if c.get('itemId') == 'ppe-1'), {})
    check('cart: now 2 cases of 10 at $91.30', l1.get('qty') == 2 and l1.get('unit') == 'case' and l1.get('per') == 10 and l1.get('countUnit') == 'box' and abs((l1.get('price') or 0) - 91.3) < 1e-6, l1)
    check('cart: change stamped', any(t.get('t') == 'unit' and t.get('by') == 'Sarah B.' for t in (l1.get('trail') or [])), l1.get('trail'))
    J(pg, "go('cart')"); pg.wait_for_timeout(200)
    check('cart: flag gone', not J(pg, "!!document.querySelector('.oldUnit')"))
    # the open order from before (2 boxes) that came as 2 cases
    q0 = store(pg, 'nlo/items/ppe-1')['qty']
    J(pg, "go('orders')"); pg.wait_for_timeout(200)
    J(pg, "document.querySelector('[data-act=\"receive\"][data-id=\"order-old1\"]').click()"); pg.wait_for_timeout(300)
    check('receive: offers “came as cases”', J(pg, "!!document.querySelector('[data-rc=\"cases\"][data-k=\"0\"]')"))
    J(pg, "const cb = document.querySelector('[data-rc=\"cases\"][data-k=\"0\"]'); cb.checked = true; cb.dispatchEvent(new Event('change', {bubbles: true}))"); pg.wait_for_timeout(200)
    check('receive: says cases = 20 boxes, price per case', '20 boxes' in J(pg, "document.querySelector('#rcEq0').textContent") and J(pg, "document.querySelector('[data-rc=\"price\"][data-k=\"0\"]').placeholder") == '91.30', [J(pg, "document.querySelector('#rcEq0').textContent"), J(pg, "document.querySelector('[data-rc=\"price\"][data-k=\"0\"]').placeholder")])
    check('receive: not called short', 'came short' not in J(pg, "document.querySelector('#rcTot').textContent"))
    click(pg, '[data-act="rcGo"]', 900)
    o = store(pg, 'nlo/orders/order-old1'); q1 = store(pg, 'nlo/items/ppe-1')['qty']
    check('receive as cases: +20 boxes', q1 - q0 == 20, (q0, q1))
    ln = (o.get('items') or [{}])[0]
    check('receive as cases: line is 2 cases, was ordered as 2 boxes', ln.get('unit') == 'case' and ln.get('per') == 10 and ln.get('qty') == 2 and ln.get('orderedAs') == '2 boxes' and not ln.get('orderedQty'), ln)
    rec = [e for e in store(pg, 'nlo/log').values() if e.get('orderId') == 'order-old1' and e['type'] == 'receive']
    check('receive as cases: $182.60 booked, 20 boxes', len(rec) == 1 and abs(rec[0]['amount'] - 182.6) < 0.001 and rec[0]['delta'] == 20, rec)
    check('receive as cases: no backorder', not [x for x in store(pg, 'nlo/orders').values() if x.get('backorderOf') == 'order-old1'])
    check('receive as cases: price kept per box', abs(store(pg, 'nlo/items/ppe-1')['sources'][0]['price'] - 9.13) < 1e-6, store(pg, 'nlo/items/ppe-1')['sources'])
    check('cases: no page errors', not errs, errs)
    ctx.close()

@test
def t_case_price_was_case(b):
    """“the saved prices are for a whole case”: $91.30 saved per box becomes $9.13 a box"""
    ctx, pg, errs = open_app(b, extra_init="window.__FAKE.store.nlo.items['ppe-1'].sources[0].price = 91.3; delete window.__FAKE.store.nlo.items['ppe-2'];", who=WHO('s_sarah', 'Sarah B.', 'Sarah Bell'))
    J(pg, "go('settings')"); pg.wait_for_timeout(200)
    J(pg, "document.querySelector('#caseWasCase').checked = true")
    click(pg, '[data-act="caseApply"]', 900)
    i1 = store(pg, 'nlo/items/ppe-1')
    check('was-case: price now per box', abs(i1['sources'][0]['price'] - 9.13) < 1e-6 and i1.get('perBuy') == 10, i1.get('sources'))
    check('was-case: no page errors', not errs, errs)
    ctx.close()

@test
def t_close_ask(b):
    """closing a dialog with unsaved work asks inside the dialog (no browser pop-up); an untouched one just closes"""
    ctx, pg, errs = open_app(b, who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
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
    check('ask: nothing saved', store(pg, 'nlo/items/adh-1')['name'] == 'Transbond XT Syringe' and not J(pg, "!!document.querySelector('#modalWrap')"))
    check('ask: no page errors (and no browser pop-ups)', not errs, errs)
    ctx.close()

@test
def t_rules_elasto(b):
    """the live rules (Sept 27) have no elastoPrices block: the app must still open cleanly, and say so only on Quick order"""
    ctx, pg, errs = open_app(b, extra_init="window.__FAKE.deny = (p, how) => /^\\/?nlo\\/elastoPrices/.test(p);", who=WHO('s_gwen', 'Gwen R.', 'Gwen Reed'))
    check('rules: app opens with no red banner', J(pg, "!S.loadErr && !document.querySelector('#bannerSlot').textContent.trim()"), J(pg, "[S.loadErr, document.querySelector('#bannerSlot').textContent]"))
    check('rules: price list marked as not allowed', J(pg, "S.denied.elastoPrices === true"))
    J(pg, "go('quick')"); pg.wait_for_timeout(200)
    check('rules: Quick order says prices can’t be saved yet', 'can’t be saved yet' in J(pg, "document.querySelector('#view').textContent"))
    J(pg, "ACT.qPriceAll()"); pg.wait_for_timeout(200)
    check('rules: setting a price explains instead of failing', J(pg, "!document.querySelector('#modalWrap') && /can’t be saved yet/.test(document.querySelector('#toasts').textContent)"))
    J(pg, "ACT.qBump({ dataset: { k: 'Silver', n: '1' } })"); pg.wait_for_timeout(150)
    J(pg, "ACT.qAdd(document.querySelector('[data-act=\"qAdd\"]'))"); pg.wait_for_timeout(600)
    cart = store(pg, 'nlo/cart'); cart = cart if isinstance(cart, list) else list(cart.values())
    check('rules: elastics still go in the cart', any(str(c.get('itemId', '')).startswith('elasto-') and c.get('cat') == 'elastics' for c in cart), cart)
    errs2 = [e for e in errs if 'elastoPrices' not in e and 'permission_denied' not in e.lower()]
    check('rules: no other page errors', not errs2, errs2)
    ctx.close()

only = sys.argv[1:]
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for t in TESTS:
            if only and t.__name__ not in only: continue
            try: t(b)
            except Exception as e:
                tb = traceback.extract_tb(e.__traceback__); where = [f for f in tb if f.filename.endswith('run.py')]
                check(t.__name__ + ' crashed', False, (str(e)[:900] + ' @ line ' + str(where[-1].lineno if where else '?')))
        b.close()
finally:
    srv.terminate()
fails = [r for r in results if not r[1]]
print('\n%d passed, %d failed' % (len(results) - len(fails), len(fails)))
sys.exit(1 if fails else 0)
