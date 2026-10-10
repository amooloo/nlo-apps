"""Build NLO Time Clock:
  dist/nlo-timeclock.html        the page (published as ../nlo-timeclock.html)
  dist/nlo-timeclock-demo.html   the demo on its own (made-up office, no Firebase, logo inside)
  dist/nlo-timeclock-alerts.gs   the alert script (published as ../nlo-timeclock-alerts.gs; the page fills in its login)
  dist/firestore.rules           the shared rules with the owner's email filled in (tests use a made-up address)
The rules live in ../nlo-cases-src/firestore.rules — one file for the whole Firebase project (NLO Cases, Leads, A/R, Time Off
and the Time Clock). The page carries a copy (owner's email left as a placeholder) for Dr. A's "publish the rules" card."""
import base64, hashlib, json, os, pathlib, re, shutil
root = pathlib.Path(__file__).parent
src = root / 'src'
FILES = ['core.js', 'engine.js', 'backend.js', 'demo.js', 'ui.js', 'kiosk.js', 'views.js']
t = (src / 'template.html').read_text()
js = '\n'.join((src / f).read_text() for f in FILES)
rules = (root.parent / 'nlo-cases-src' / 'firestore.rules').read_text()
assert rules.count('__OWNER_EMAIL__') == 1 and 'match /tcPunch/{id}' in rules and 'match /toReq/{id}' in rules and 'match /arItems/{id}' in rules and 'NLO Leads' in rules
assert js.count('const TC_RULES = "";') == 1
js = js.replace('const TC_RULES = "";', 'const TC_RULES = ' + json.dumps(rules) + ';', 1)
js += "\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();\n"
cfg = root / 'fbconfig.js'
conf = json.loads(cfg.read_text())
for k, ph in [('apiKey', '__API_KEY__'), ('authDomain', '__AUTH_DOMAIN__'), ('projectId', '__PROJECT_ID__'), ('appId', '__APP_ID__')]:
    assert js.count('"' + ph + '"') == 1
    js = js.replace('"' + ph + '"', json.dumps(conf[k]), 1)
assert t.count('__AUTH_FRAME__') == 1
t = t.replace('__AUTH_FRAME__', 'https://' + conf['authDomain'])
assert t.count('/*STYLE*/') == 1 and t.count('/*SCRIPT*/') == 1 and t.count('__SCRIPT_HASH__') == 1
assert '</script' not in js.lower(), 'script body must not contain </script'
# CSP: allow exactly this inline script (by SHA-256), so injected scripts/handlers can't run
script_text = t.split('<script>', 1)[1].split('</script>', 1)[0].replace('/*SCRIPT*/', js)
h = "'sha256-" + base64.b64encode(hashlib.sha256(script_text.encode('utf-8')).digest()).decode() + "'"
out = t.replace('/*STYLE*/', (src / 'style.css').read_text()).replace('/*SCRIPT*/', js).replace('__SCRIPT_HASH__', h)
dist = root / 'dist'; dist.mkdir(exist_ok=True)
(dist / 'nlo-timeclock.html').write_text(out)
(dist / 'app.js').write_text(js)
(dist / 'firestore.rules').write_text(rules.replace('__OWNER_EMAIL__', os.environ.get('OWNER_EMAIL', 'dr.test@example.com')))
logo = root.parent / 'logo-white.png'
shutil.copy(logo, dist / 'logo-white.png')
# the shared NLO Apps button (the page loads nlo-home.js from beside it on the live site)
home = root.parent / 'nlo-home.js'
if home.exists(): shutil.copy(home, dist / 'nlo-home.js')
# Ask AISA in the corner (the page loads nlo-aisa.js from beside it on the live site)
aisa = root.parent / 'nlo-aisa.js'
if aisa.exists(): shutil.copy(aisa, dist / 'nlo-aisa.js')
print('built the page', len(out), 'bytes')

# ---- the alert script: its instructions first, then the shared arithmetic (engine.js), then the rest of the script
s = (root / 'robot' / 'script.js').read_text()
head_end = s.index('*/') + 2
head, rest = s[:head_end], s[head_end:]
engine = (src / 'engine.js').read_text()
gs = head + '\n\n/* ---------- the time clock\'s arithmetic (the same file the page runs: src/engine.js) ---------- */\n' + engine + '\n' + rest.lstrip('\n')
assert gs.count('/*TC_CONFIG*/null') == 1 and 'const TCE = ' in gs
(dist / 'nlo-timeclock-alerts.gs').write_text(gs)
print('built the alert script', len(gs), 'bytes')

# ---- the office check (a Cloudflare Worker): published beside the page; the page fills in its login when Dr. A copies it
chk = (root / 'worker' / 'office-check.js').read_text()
assert chk.count('/*TC_NET_CONFIG*/null') == 1 and 'export default' in chk
(dist / 'nlo-timeclock-check.js').write_text(chk)
print('built the office check', len(chk), 'bytes')

# ---- the demo on its own: a made-up office and nothing to sign in to. No Firebase, no rules, the logo inside the page; the
# page skeleton (doctype, head, body) is added where it's hosted.
assert js.count('const DEMO_ONLY = false;') == 1 and js.count("const LOGO = 'logo-white.png';") == 1
logo_uri = 'data:image/png;base64,' + base64.b64encode(logo.read_bytes()).decode()
djs = js.replace('const DEMO_ONLY = false;', 'const DEMO_ONLY = true;', 1).replace("const LOGO = 'logo-white.png';", 'const LOGO = ' + json.dumps(logo_uri) + ';', 1)
djs = djs.replace('const TC_RULES = ' + json.dumps(rules) + ';', 'const TC_RULES = "";', 1)
head_links = ''.join(l + '\n' for l in t.split('\n') if 'fonts.g' in l and l.strip().startswith('<link'))
body = t.split('<body>', 1)[1].split('<!-- the Firebase SDK', 1)[0].replace('src="logo-white.png"', 'src="' + logo_uri + '"')
demo = '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<title>NLO Time Clock Demo</title>\n' + head_links + '<style>\n:root{color-scheme:light}\n' + (src / 'style.css').read_text() + '\n</style>\n' + body + '<script>\n' + djs + '\n</script>\n'
assert '</script' not in djs.lower() and 'gstatic.com/firebasejs' not in demo
(dist / 'nlo-timeclock-demo.html').write_text(demo)
print('built the demo page', len(demo), 'bytes')
