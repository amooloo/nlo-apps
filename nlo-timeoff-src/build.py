"""Build NLO Time Off: one self-contained page (dist/nlo-timeoff.html) plus the shared Firestore rules.
The rules live in ../nlo-cases-src/firestore.rules — one file for the whole Firebase project (NLO Cases, NLO Leads, A/R and
Time Off share it). The page carries a copy of those rules (owner's email left as a placeholder) for its "publish the rules" card."""
import base64, hashlib, json, os, pathlib, shutil
root = pathlib.Path(__file__).parent
src = root / 'src'
FILES = ['core.js', 'policy.js', 'reader.js', 'backend.js', 'demo.js', 'ui.js', 'views.js', 'admin.js', 'importer.js']
t = (src / 'template.html').read_text()
js = '\n'.join((src / f).read_text() for f in FILES if (src / f).exists())
rules = (root.parent / 'nlo-cases-src' / 'firestore.rules').read_text()
assert rules.count('__OWNER_EMAIL__') == 1 and 'match /toReq/{id}' in rules and 'match /arItems/{id}' in rules and 'NLO Leads' in rules
assert js.count('const TO_RULES = "";') == 1
js = js.replace('const TO_RULES = "";', 'const TO_RULES = ' + json.dumps(rules) + ';', 1)
js += "\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();\n"
cfg = root / 'fbconfig.js'
if cfg.exists():
    # the real Firebase web config (public by design; security is the rules + encryption)
    conf = json.loads(cfg.read_text())
    for k, ph in [('apiKey', '__API_KEY__'), ('authDomain', '__AUTH_DOMAIN__'), ('projectId', '__PROJECT_ID__'), ('appId', '__APP_ID__')]:
        assert js.count('"' + ph + '"') == 1
        js = js.replace('"' + ph + '"', json.dumps(conf[k]), 1)
# sign-in frames only from the office's own Firebase sign-in domain
assert t.count('__AUTH_FRAME__') == 1
t = t.replace('__AUTH_FRAME__', 'https://' + json.loads(cfg.read_text())['authDomain'] if cfg.exists() else "'none'")
assert t.count('/*STYLE*/') == 1 and t.count('/*SCRIPT*/') == 1 and t.count('__SCRIPT_HASH__') == 1
assert '</script' not in js.lower(), 'script body must not contain </script'
# CSP: allow exactly this inline script (by SHA-256), so injected scripts/handlers can't run
script_text = t.split('<script>', 1)[1].split('</script>', 1)[0].replace('/*SCRIPT*/', js)
h = "'sha256-" + base64.b64encode(hashlib.sha256(script_text.encode('utf-8')).digest()).decode() + "'"
out = t.replace('/*STYLE*/', (src / 'style.css').read_text()).replace('/*SCRIPT*/', js).replace('__SCRIPT_HASH__', h)
dist = root / 'dist'; dist.mkdir(exist_ok=True)
(dist / 'nlo-timeoff.html').write_text(out)
(dist / 'app.js').write_text(js)
# the shared rules, with the owner's email filled in (tests use a made-up address)
(dist / 'firestore.rules').write_text(rules.replace('__OWNER_EMAIL__', os.environ.get('OWNER_EMAIL', 'dr.test@example.com')))
logo = root.parent / 'logo-white.png'
if logo.exists(): shutil.copy(logo, dist / 'logo-white.png')
print('built', len(out), 'bytes')

# ---- the demo on its own (dist/nlo-timeoff-demo.html): a made-up office and nothing to sign in to, for trying it before it
# goes live. No Firebase, no rules, the logo inside the page; the page skeleton (doctype, head, body) is added where it's hosted.
assert js.count('const DEMO_ONLY = false;') == 1 and js.count("const LOGO = 'logo-white.png';") == 1
logo_uri = 'data:image/png;base64,' + base64.b64encode(logo.read_bytes()).decode()
djs = js.replace('const DEMO_ONLY = false;', 'const DEMO_ONLY = true;', 1).replace("const LOGO = 'logo-white.png';", 'const LOGO = ' + json.dumps(logo_uri) + ';', 1)
djs = djs.replace('const TO_RULES = ' + json.dumps(rules) + ';', 'const TO_RULES = "";', 1)
d = t.split('<title>', 1)[1].split('</title>', 1)[0]
head_links = ''.join(l + '\n' for l in t.split('\n') if 'fonts.g' in l and l.strip().startswith('<link'))
body = t.split('<body>', 1)[1].split('<!-- the Firebase SDK', 1)[0].replace('src="logo-white.png"', 'src="' + logo_uri + '"')
demo = '<title>NLO Time Off Demo</title>\n' + head_links + '<style>\n:root{color-scheme:light}\n' + (src / 'style.css').read_text() + '\n</style>\n' + body + '<script>\n' + djs + '\n</script>\n'
assert '</script' not in djs.lower() and 'gstatic.com/firebasejs' not in demo
(dist / 'nlo-timeoff-demo.html').write_text(demo)
print('built the demo page', len(demo), 'bytes')
