import pathlib, shutil, sys
root = pathlib.Path(__file__).parent
src = root / 'src'
t = (src / 'template.html').read_text()
js = '\n'.join((src / f).read_text() for f in ['core.js', 'backend.js', 'demo.js', 'ipr.js', 'ui.js', 'logos.js', 'pics.js', 'caseform.js', 'labels.js', 'admin.js', 'mail.js', 'photos.js', 'rxdata.js', 'rxdraw.js', 'rx.js', 'rxret.js', 'rxmetal.js', 'rxfun.js', 'warranty.js', 'tour.js'])
js += "\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();\n"
# the security rules ship inside the page (owner's email left as a placeholder), so Team & security can hand out
# exactly the rules this version needs when the live ones are older
import json as _json
assert js.count('"__NLO_RULES__"') == 1
js = js.replace('"__NLO_RULES__"', _json.dumps((root / 'firestore.rules').read_text()), 1)
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
# the black NLO logo printed on aligner labels (same image as the Label Maker's)
lbl = next((p for p in [root.parent / 'nlo-label-logo.png', root / 'nlo-label-logo.png'] if p.exists()), None)
if lbl: shutil.copy(lbl, root / 'dist' / 'nlo-label-logo.png')
# the grey pictures of Specialty's blank Herbst, Retainer, Metal and Functional Rx the app shows under what's filled in (tools/rxforms.py makes them; they sit next to the page)
for name in ['nlo-cases-rx-herbst.png', 'nlo-cases-rx-retainer.png', 'nlo-cases-rx-metal.png', 'nlo-cases-rx-functional.png']:
    rxp = root.parent / name
    assert rxp.exists(), 'run python3 tools/rxforms.py first'
    shutil.copy(rxp, root / 'dist' / name)
# the Hawley, clasp and acrylic color pictures (tools/pics.py makes them; they sit next to the page in nlo-cases-pics/, loaded when needed)
pics_dir = root.parent / 'nlo-cases-pics'
assert pics_dir.is_dir() and any(pics_dir.glob('acr-*.webp')), 'run python3 tools/pics.py first'
if (root / 'dist' / 'nlo-cases-pics').exists(): shutil.rmtree(root / 'dist' / 'nlo-cases-pics')
shutil.copytree(pics_dir, root / 'dist' / 'nlo-cases-pics')
# the lab-email script the owner copies into each Gmail account (built by tools/build-mail.js; no secrets in it)
gs = root / 'mail' / 'nlo-cases-mail.gs'
assert gs.exists() and '/*NLO_CONFIG*/null' in gs.read_text(), 'run node tools/build-mail.js first'
shutil.copy(gs, root / 'dist' / 'nlo-cases-mail.gs')
print('built', len(out), 'bytes')
