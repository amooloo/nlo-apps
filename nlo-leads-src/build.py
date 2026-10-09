"""Build NLO Leads: one self-contained page (dist/nlo-leads.html) plus the shared Firestore rules.
The rules live in ../nlo-cases-src/firestore.rules — one file for the whole Firebase project, since both apps share it."""
import base64, hashlib, json, os, pathlib, shutil
root = pathlib.Path(__file__).parent
src = root / 'src'
t = (src / 'template.html').read_text()
js = '\n'.join((src / f).read_text() for f in ['core.js', 'leads.js', 'backend.js', 'demo.js', 'ui.js', 'forms.js', 'admin.js'])
js += "\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();\n"
cfg = root / 'fbconfig.js'
if cfg.exists():
    # the real Firebase web config (public by design; security is the rules + encryption)
    conf = json.loads(cfg.read_text())
    for k, ph in [('apiKey', '__API_KEY__'), ('authDomain', '__AUTH_DOMAIN__'), ('projectId', '__PROJECT_ID__'), ('appId', '__APP_ID__')]:
        assert js.count('"' + ph + '"') == 1
        js = js.replace('"' + ph + '"', json.dumps(conf[k]), 1)
assert t.count('/*STYLE*/') == 1 and t.count('/*SCRIPT*/') == 1 and t.count('__SCRIPT_HASH__') == 1
assert '</script' not in js.lower(), 'script body must not contain </script'
# CSP: allow exactly this inline script (by SHA-256), so injected scripts/handlers can't run
script_text = t.split('<script>', 1)[1].split('</script>', 1)[0].replace('/*SCRIPT*/', js)
h = "'sha256-" + base64.b64encode(hashlib.sha256(script_text.encode('utf-8')).digest()).decode() + "'"
out = t.replace('/*STYLE*/', (src / 'style.css').read_text()).replace('/*SCRIPT*/', js).replace('__SCRIPT_HASH__', h)
dist = root / 'dist'; dist.mkdir(exist_ok=True)
(dist / 'nlo-leads.html').write_text(out)
(dist / 'app.js').write_text(js)
# the shared rules, with the owner's email filled in (tests use a made-up address)
rules = (root.parent / 'nlo-cases-src' / 'firestore.rules').read_text()
assert rules.count('__OWNER_EMAIL__') == 1
(dist / 'firestore.rules').write_text(rules.replace('__OWNER_EMAIL__', os.environ.get('OWNER_EMAIL', 'dr.test@example.com')))
logo = root.parent / 'logo-white.png'
if logo.exists(): shutil.copy(logo, dist / 'logo-white.png')
# the shared NLO Apps button (the page loads nlo-home.js from beside it on the live site)
home = root.parent / 'nlo-home.js'
if home.exists(): shutil.copy(home, dist / 'nlo-home.js')
print('built', len(out), 'bytes')
