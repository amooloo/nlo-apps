"""Build NLO Inventory: one self-contained page, dist/index.html, published to Firebase Hosting (nlo-inventory.web.app)
with logo-white.png beside it, plus dist/demo.html — the same app with made-up data and nothing to sign in to, for trying it
before it goes live (no Firebase, the logo inside the page)."""
import base64, hashlib, json, pathlib, re, shutil, subprocess, sys
root = pathlib.Path(__file__).parent
src = root / 'src'
FILES = ['core.js', 'money.js', 'units.js', 'data.js', 'backend.js', 'demo.js', 'who.js', 'ui.js', 'ops.js', 'home.js', 'supplies.js',
         'cart.js', 'orders.js', 'receive.js', 'slip.js', 'quick.js', 'budget.js', 'activity.js', 'vendors.js', 'settings.js', 'scan.js', 'ai.js', 'editor.js']
missing = [f for f in FILES if not (src / f).exists()]
assert not missing, 'missing source files: %s' % missing

# The vendor list's account numbers, reps and card notes are kept out of the public repo. src/vendors.private.js (not in git)
# holds the whole list as the live page has it; --vendors-from-live recreates that file from the live page.
PRIVATE = src / 'vendors.private.js'
PUBLIC_START = '/* Account numbers, reps and card notes stay out of the public repo'
if '--vendors-from-live' in sys.argv:
    live = subprocess.run(['curl', '-sS', '-f', '--max-time', '60', 'https://nlo-inventory.web.app/index.html'], capture_output=True, check=True).stdout.decode()
    a = live.index('const VENDORS = ['); b = live.index('\nconst VENDOR_LOGOS', a)
    PRIVATE.write_text(live[a:b]); print('wrote', PRIVATE, 'from the live page')

t = (src / 'template.html').read_text()
js = '\n'.join((src / f).read_text() for f in FILES)
js += "\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();\n"
a = js.index(PUBLIC_START); b = js.index('\nconst VENDOR_LOGOS', a)
with_private = PRIVATE.exists()
if with_private: js = js[:a] + PRIVATE.read_text() + js[b:]
else: print('NOTE: built without src/vendors.private.js — the vendor list has no account numbers or reps. Don’t publish this build '
            '(deploy.py refuses); run python3 build.py --vendors-from-live first.')
live_js = js
assert t.count('/*STYLE*/') == 1 and t.count('/*SCRIPT*/') == 1 and t.count('__SCRIPT_HASH__') == 1
assert '</script' not in js.lower(), 'script body must not contain </script'
css = (src / 'style.css').read_text()

def page(template, body_js):
    # CSP: allow exactly this inline script (by SHA-256), so injected scripts and handlers can't run
    script_text = '\n' + body_js + '\n'
    h = "'sha256-" + base64.b64encode(hashlib.sha256(script_text.encode('utf-8')).digest()).decode() + "'"
    return template.replace('/*STYLE*/', css).replace('/*SCRIPT*/', body_js).replace('__SCRIPT_HASH__', h)

out = page(t, live_js)
dist = root / 'dist'; dist.mkdir(exist_ok=True)
(dist / 'index.html').write_text(out)
(dist / 'app.js').write_text(live_js)
logo = root.parent / 'logo-white.png'
shutil.copy(logo, dist / 'logo-white.png')
(dist / 'build-info.json').write_text(json.dumps({'vendorDetails': with_private, 'sha256': hashlib.sha256(out.encode('utf-8')).hexdigest()}) + '\n')
print('built index.html', len(out), 'bytes')

# ---- the demo page: no Firebase, the logo inside the page; the page skeleton is added where it's hosted (an Artifact)
assert js.count('const DEMO_ONLY = false;') == 1 and js.count("const LOGO = 'logo-white.png';") == 1
logo_uri = 'data:image/png;base64,' + base64.b64encode(logo.read_bytes()).decode()
djs = js.replace('const DEMO_ONLY = false;', 'const DEMO_ONLY = true;', 1).replace("const LOGO = 'logo-white.png';", 'const LOGO = ' + json.dumps(logo_uri) + ';', 1)
# the demo is shared as a page: the built-in vendor list goes in without account numbers, reps or notes (one note has a card hint)
import subprocess
a = djs.index('const VENDORS = ['); b = djs.index('\nconst VENDOR_LOGOS', a)
clean = subprocess.run(['node', '-e', '''
const src = require("fs").readFileSync(0, "utf8");
const V = eval("(" + src.replace(/^const VENDORS = /, "").replace(/;\\s*$/, "") + ")");
const keep = ["id", "name", "portal", "phone", "tollFree", "email", "address"];
process.stdout.write(JSON.stringify(V.map(v => { const o = {}; keep.forEach(k => { o[k] = v[k] == null ? null : v[k]; }); o.acct = null; o.rep = null; o.repPhone = null; o.repEmail = null; o.note = null; return o; })));
'''], input=djs[a:b], capture_output=True, text=True, check=True).stdout
djs = djs[:a] + 'const VENDORS = ' + clean + ';' + djs[b:]
# none of the private details may be left (account numbers, reps' phones and emails, card notes)
if with_private:
    secrets = json.loads(subprocess.run(['node', '-e', '''
const s = require("fs").readFileSync(0, "utf8"); const V = eval("(" + s.replace(/^const VENDORS = /, "").replace(/;\\s*$/, "") + ")");
const out = []; V.forEach(v => { if (v.acct) out.push(String(v.acct)); if (v.repEmail) out.push(String(v.repEmail)); if (v.repPhone && v.repPhone !== v.phone) out.push(String(v.repPhone));
  const m = String(v.note || "").match(/ending\\s+(\\d{4})/i); if (m) out.push(m[1]); });
process.stdout.write(JSON.stringify(out));'''], input=PRIVATE.read_text(), capture_output=True, text=True, check=True).stdout)
    left = [x for x in secrets if x in djs]
    assert not left, 'vendor details left in the demo (%d)' % len(left)
# ...and without the office's sign-in details (the demo never signs in)
a = djs.index('const FB_CONFIG = {'); b = djs.index('};', a) + 2
djs = djs[:a] + 'const FB_CONFIG = {};' + djs[b:]
a = djs.index("const OWNER_EMAIL = '"); b = djs.index('\n', djs.index('const ALLOWED_EMAILS', a))
djs = djs[:a] + "const OWNER_EMAIL = 'owner@example.com';\nconst ALLOWED_EMAILS = [OWNER_EMAIL];" + djs[b:]
for secret in ['akhavan', 'records@', 'AIzaSy', 'nlo-inventory-default-rtdb']:
    assert secret not in djs, 'demo still has ' + secret
# ...and the fallback staff list is the demo's made-up people (the demo never reads the real roster)
a = djs.index('const FALLBACK_STAFF = ['); b = djs.index('];', a) + 2
djs = djs[:a] + 'const FALLBACK_STAFF = Object.values(DEMO_PEOPLE).map(p => ({ id: p.id, name: p.name, short: p.short, title: p.title }));' + djs[b:]
for real in ['Akhavan', 'Sarah B.', 'Savannah', 'Wila', 'Angelika', 'Kaylee', 'Gwen', 'Eve P.']:
    assert real not in djs, 'demo still names ' + real
head_links = ''.join(l + '\n' for l in t.split('\n') if 'fonts.g' in l and l.strip().startswith('<link'))
body = t.split('<body>', 1)[1].split('<!-- the Firebase SDK', 1)[0].replace('src="logo-white.png"', 'src="' + logo_uri + '"')
demo_head = '<title>NLO Inventory Demo</title>\n' + head_links + '<style>\n:root{color-scheme:light}\n' + css + '\n</style>\n'
demo_body = body + '<script>\n' + djs + '\n</script>\n'
demo = demo_head + demo_body
assert '</script' not in djs.lower() and 'gstatic.com/firebasejs' not in demo
(dist / 'demo.html').write_text(demo)
# a full page of the demo for the browser tests
(dist / 'demo-page.html').write_text('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + demo_head + '</head><body>' + demo_body + '</body></html>')
print('built demo.html', len(demo), 'bytes')
