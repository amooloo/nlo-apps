import pathlib, shutil, sys
root = pathlib.Path(__file__).parent
src = root / 'src'
t = (src / 'template.html').read_text()
js = '\n'.join((src / f).read_text() for f in ['core.js', 'backend.js', 'demo.js', 'ipr.js', 'ui.js', 'caseform.js', 'admin.js'])
js += "\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();\n"
cfg = root / 'fbconfig.js'
if cfg.exists():
    # swap in the real Firebase web config (public by design; security is the rules + encryption)
    import json, re
    conf = json.loads(cfg.read_text())
    for k, ph in [('apiKey', '__API_KEY__'), ('authDomain', '__AUTH_DOMAIN__'), ('projectId', '__PROJECT_ID__'), ('appId', '__APP_ID__')]:
        js = js.replace('"' + ph + '"', json.dumps(conf[k]), 1)
assert t.count('/*STYLE*/') == 1 and t.count('/*SCRIPT*/') == 1 and t.count('__SCRIPT_HASH__') == 1
# CSP: allow exactly this inline script (by SHA-256), so injected scripts/handlers can't run
import hashlib, base64, os
script_text = t.split('<script>', 1)[1].split('</script>', 1)[0].replace('/*SCRIPT*/', js)
assert script_text.startswith('\n/*') is False and js in script_text
h = "'sha256-" + base64.b64encode(hashlib.sha256(script_text.encode('utf-8')).digest()).decode() + "'"
out = t.replace('/*STYLE*/', (src / 'style.css').read_text()).replace('/*SCRIPT*/', js).replace('__SCRIPT_HASH__', h)
# rules with the owner's email filled in (tests use a made-up address)
owner_email = os.environ.get('OWNER_EMAIL', 'dr.test@example.com')
rules = (root / 'firestore.rules').read_text()
assert rules.count('__OWNER_EMAIL__') == 1
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'firestore.rules').write_text(rules.replace('__OWNER_EMAIL__', owner_email))
assert '</script' not in js.lower(), 'script body must not contain </script'
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'nlo-cases.html').write_text(out)
(root / 'dist' / 'app.js').write_text(js)
logo = next((p for p in [root.parent / 'logo-white.png', pathlib.Path('/home/claude/nlo-apps/logo-white.png')] if p.exists()), None)
if logo: shutil.copy(logo, root / 'dist' / 'logo-white.png')
print('built', len(out), 'bytes')
