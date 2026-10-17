"""Build NLO Inventory (5.x, on the NLO Cases platform):
  dist/nlo-inventory.html        the page (published as ../nlo-inventory.html on GitHub Pages, next to NLO Cases and Time Off)
  dist/nlo-inventory-alerts.gs   the alert script (published as ../nlo-inventory-alerts.gs; the page fills in its login)
  dist/firestore.rules           the shared rules with the owner's email filled in (tests use a made-up address)
  dist/demo.html                 the demo on its own (made-up office, no Firebase, the logo inside; the page skeleton is
                                 added where it's hosted — an Artifact); dist/demo-page.html is the same as a whole page
  dist/redirect/index.html       the page that goes on the old address (nlo-inventory.web.app) once Inventory has moved
The rules live in ../nlo-cases-src/firestore.rules — one file for the whole Firebase project (NLO Cases, Leads, A/R, Time Off,
the Time Clock and Inventory). The page carries a copy (owner's email left as a placeholder) for Dr. A's "publish the rules" card.
The page carries only the public vendor list: the account numbers, reps and card notes (src/vendors.private.js, not in git;
--vendors-from-live recreates it from the old page) go into the database at the move, from dist/vendor-details.json."""
import base64, hashlib, json, os, pathlib, re, shutil, subprocess, sys
root = pathlib.Path(__file__).parent
src = root / 'src'
FILES = ['core.js', 'money.js', 'units.js', 'data.js', 'backend.js', 'demo.js', 'who.js', 'ui.js', 'move.js', 'ops.js', 'home.js', 'deals.js', 'supplies.js',
         'cart.js', 'orders.js', 'receive.js', 'slip.js', 'quick.js', 'budget.js', 'activity.js', 'vendors.js', 'settings.js', 'scan.js', 'ai.js', 'editor.js']
missing = [f for f in FILES if not (src / f).exists()]
assert not missing, 'missing source files: %s' % missing

PRIVATE = src / 'vendors.private.js'
PUBLIC_START = '/* Account numbers, reps and card notes stay out of the public repo'
LIVE = 'https://amooloo.github.io/nlo-apps/nlo-inventory.html'
if '--vendors-from-live' in sys.argv:
    live = None
    for url in ['https://nlo-inventory.web.app/index.html.backup-2026-10-16-v4.0.0', 'https://nlo-inventory.web.app/index.html']:
        r = subprocess.run(['curl', '-sS', '-f', '--max-time', '60', url], capture_output=True)
        if r.returncode == 0 and b'const VENDORS = [' in r.stdout and b'acct' in r.stdout: live = r.stdout.decode(); break
    assert live, 'no page with the vendor list found'
    a = live.index('const VENDORS = ['); b = live.index('\nconst VENDOR_LOGOS', a)
    PRIVATE.write_text(live[a:b]); print('wrote', PRIVATE, 'from', url)

t = (src / 'template.html').read_text()
js = '\n'.join((src / f).read_text() for f in FILES)
js += "\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();\n"
assert js.count(PUBLIC_START) == 1
# Since 5.0 the page is published from the public repo (GitHub Pages), so it carries only the public vendor list (src/data.js).
# The account numbers, reps and card notes go into the database instead, once, at the move (Dr. A's saved vendors in the old
# database, which the move copies): dist/vendor-details.json, made here from src/vendors.private.js (not in git), holds them.
def node_json(code, text): return json.loads(subprocess.run(['node', '-e', code], input=text, capture_output=True, text=True, check=True).stdout)
PRIV_FIELDS = ['acct', 'rep', 'repPhone', 'repEmail', 'note']
secrets = []
if PRIVATE.exists():
    priv = node_json('''const s = require("fs").readFileSync(0, "utf8"); const V = eval("(" + s.replace(/^const VENDORS = /, "").replace(/;\\s*$/, "") + ")");
process.stdout.write(JSON.stringify(V));''', PRIVATE.read_text())
    details = {}
    for v in priv:
        d = {k: v[k] for k in PRIV_FIELDS if v.get(k) not in (None, '')}
        if d: details[v['id']] = d
        for k in ['acct', 'repEmail']:
            if v.get(k): secrets.append(str(v[k]))
        if v.get('repPhone') and v.get('repPhone') != v.get('phone'): secrets.append(str(v['repPhone']))
        m = re.search(r'ending\s+(\d{4})', str(v.get('note') or ''), re.I)
        if m: secrets.append(m.group(1))
    (root / 'dist').mkdir(exist_ok=True)
    (root / 'dist' / 'vendor-details.json').write_text(json.dumps(details, indent=1, ensure_ascii=False) + '\n')
    print('vendor details for the database:', len(details), 'vendors (dist/vendor-details.json, not published)')
else: print('NOTE: no src/vendors.private.js — the vendor details for the database can’t be made (python3 build.py --vendors-from-live).')

# the shared rules (Dr. A's "publish the rules" card)
rules = (root.parent / 'nlo-cases-src' / 'firestore.rules').read_text()
assert rules.count('__OWNER_EMAIL__') == 1 and 'match /invItems/{id}' in rules and 'match /meta/rules_inv_1' in rules and 'match /meta/rules_inv_2' in rules and 'match /invDeals/{id}' in rules and 'match /tcPunch/{id}' in rules and 'match /toReq/{id}' in rules
assert js.count('const INV_RULES = "";') == 1
js = js.replace('const INV_RULES = "";', 'const INV_RULES = ' + json.dumps(rules) + ';', 1)
# the NLO Cases project's web config
conf = json.loads((root / 'fbconfig.js').read_text())
for k, ph in [('apiKey', '__API_KEY__'), ('authDomain', '__AUTH_DOMAIN__'), ('projectId', '__PROJECT_ID__'), ('appId', '__APP_ID__')]:
    assert js.count('"' + ph + '"') == 1, ph
    js = js.replace('"' + ph + '"', json.dumps(conf[k]), 1)
assert t.count('__AUTH_FRAME__') == 1
t = t.replace('__AUTH_FRAME__', 'https://' + conf['authDomain'])
assert t.count('/*STYLE*/') == 1 and t.count('/*SCRIPT*/') == 1 and t.count('__SCRIPT_HASH__') == 1
assert '</script' not in js.lower(), 'script body must not contain </script'
css = (src / 'style.css').read_text()

def page(template, body_js):
    # CSP: allow exactly this inline script (by SHA-256), so injected scripts and handlers can't run
    script_text = '\n' + body_js + '\n'
    h = "'sha256-" + base64.b64encode(hashlib.sha256(script_text.encode('utf-8')).digest()).decode() + "'"
    return template.replace('/*STYLE*/', css).replace('/*SCRIPT*/', body_js).replace('__SCRIPT_HASH__', h)

out = page(t, js)
left = [x for x in secrets if x in js]
assert not left, 'vendor details in the page (%d)' % len(left)
dist = root / 'dist'; dist.mkdir(exist_ok=True)
for old in ['index.html', 'app.js']:
    if (dist / old).exists(): (dist / old).unlink()
(dist / 'nlo-inventory.html').write_text(out)
(dist / 'app.js').write_text(js)
(dist / 'firestore.rules').write_text(rules.replace('__OWNER_EMAIL__', os.environ.get('OWNER_EMAIL', 'dr.test@example.com')))
logo = root.parent / 'logo-white.png'
shutil.copy(logo, dist / 'logo-white.png')
# the shared NLO Apps button and Ask AISA (the page loads them from beside it on the live site)
for f in ['nlo-home.js', 'nlo-aisa.js']:
    if (root.parent / f).exists(): shutil.copy(root.parent / f, dist / f)
(dist / 'build-info.json').write_text(json.dumps({'sha256': hashlib.sha256(out.encode('utf-8')).hexdigest()}) + '\n')
print('built nlo-inventory.html', len(out), 'bytes')

# ---- the alert script (Apps Script): its instructions and code; the page fills in its login (CONFIG) when Dr. A copies it
gs = (root / 'robot' / 'script.js').read_text()
assert gs.count('/*INV_CONFIG*/null') == 1 and 'function checkInventoryAlerts()' in gs
(dist / 'nlo-inventory-alerts.gs').write_text(gs)
print('built the alert script', len(gs), 'bytes')

# ---- the page for the old address (nlo-inventory.web.app), once Inventory has moved
red = dist / 'redirect'; red.mkdir(exist_ok=True)
(red / 'index.html').write_text('''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0; url=''' + LIVE + '''">
<title>NLO Inventory moved</title>
<style>
html,body{margin:0;height:100%;background:#1B2F4C;color:#fff;font:16px/1.5 Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center}
h1{font:600 22px/1.3 Oswald,Impact,"Arial Narrow",sans-serif;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px}
p{margin:0 0 18px;color:#cfd8e6;max-width:420px}
a{display:inline-block;background:#64F4C9;color:#1B2F4C;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:10px}
</style>
</head>
<body>
<main>
<h1>NLO Inventory moved</h1>
<p>It's on the NLO Apps site now and signs in with your NLO Cases login. Opening it…</p>
<a href="''' + LIVE + '''">Open NLO Inventory</a>
</main>
<script>location.replace(''' + json.dumps(LIVE) + ''' + location.hash);</script>
</body>
</html>
''')
print('built the redirect page')

# ---- the demo page: no Firebase, the logo inside the page
assert js.count('const DEMO_ONLY = false;') == 1 and js.count("const LOGO = 'logo-white.png';") == 1
logo_uri = 'data:image/png;base64,' + base64.b64encode(logo.read_bytes()).decode()
djs = js.replace('const DEMO_ONLY = false;', 'const DEMO_ONLY = true;', 1).replace("const LOGO = 'logo-white.png';", 'const LOGO = ' + json.dumps(logo_uri) + ';', 1)
djs = djs.replace('const INV_RULES = ' + json.dumps(rules) + ';', 'const INV_RULES = "";', 1)
left = [x for x in secrets if x in djs]
assert not left, 'vendor details left in the demo (%d)' % len(left)
# ...and without the office's sign-in details or its Apps Script (the demo never signs in)
a = djs.index('const FB_CONFIG = {'); b = djs.index('};', a) + 2
djs = djs[:a] + 'const FB_CONFIG = { apiKey: "__API_KEY__", authDomain: "", projectId: "", appId: "" };' + djs[b:]
a = djs.index('const OLD_FB = {'); b = djs.index('};', a) + 2
djs = djs[:a] + 'const OLD_FB = {};' + djs[b:]
djs = re.sub(r"const ALERT_SCRIPT_URL = '[^']*';", "const ALERT_SCRIPT_URL = '#';", djs)
for secret in ['akhavan', 'records@', 'AIzaSy', 'nlo-inventory-default-rtdb', 'nlo-cases.firebaseapp', '1wwUm4vU']:
    assert secret.lower() not in djs.lower(), 'demo still has ' + secret
for real in ['Akhavan', 'Sarah B.', 'Savannah', 'Wila', 'Angelika', 'Kaylee', 'Gwen', 'Eve P.']:
    assert real not in djs, 'demo still names ' + real
head_links = ''.join(l + '\n' for l in t.split('\n') if 'fonts.g' in l and l.strip().startswith('<link'))
body = t.split('<body>', 1)[1].split('<!-- the Firebase SDK', 1)[0].replace('src="logo-white.png"', 'src="' + logo_uri + '"')
demo_head = '<title>NLO Inventory Demo</title>\n' + head_links + '<style>\n:root{color-scheme:light}\n' + css + '\n</style>\n'
demo_body = body + '<script>\n' + djs + '\n</script>\n'
demo = demo_head + demo_body
assert '</script' not in djs.lower() and 'gstatic.com/firebasejs' not in demo
(dist / 'demo.html').write_text(demo)
(dist / 'demo-page.html').write_text('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + demo_head + '</head><body>' + demo_body + '</body></html>')
print('built demo.html', len(demo), 'bytes')
