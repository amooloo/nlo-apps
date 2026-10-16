"""Get the old address (nlo-inventory.web.app, Firebase Hosting in the nlo-inventory project) ready to send people to NLO
Inventory's new page on the NLO Apps site, once Inventory has moved over (5.0, Oct 2026).

    python3 build.py && python3 deploy.py

It makes deploy/ with firebase.json (every file served no-cache, as before) and public/:
  - index.html: the page that opens the new Inventory (dist/redirect/index.html), and logo-white.png
  - a copy of the page that's live right now, saved as index.html.backup-<today>-v<its version>
  - the older backup copies already on the site (a Hosting deploy replaces the whole site, so they go up again)
It stops without making anything if the live page isn't the one expected (EXPECT_LIVE_SHA256 below, or --expect <sha>),
so a newer page published from somewhere else is never overwritten unseen. Then, from deploy/:
    npx firebase deploy --only hosting --project nlo-inventory --non-interactive
"""
import hashlib, json, pathlib, re, shutil, subprocess, sys, datetime

SITE = 'https://nlo-inventory.web.app/'
# v4.0.0, live since Oct 16 2026 (the redesign). Update this after each publish.
EXPECT_LIVE_SHA256 = '056d50af3bb6d1ce61f0e38c15a281371230a42f24d4115a9abe07e65a070762'
OLD_BACKUPS = ['index.html.backup-2026-07-31', 'index.html.backup-2026-09-03', 'index.html.backup-2026-10-01', 'index.html.backup-2026-10-01-alerts',
               'index.html.backup-2026-10-16-v3.0.1']

root = pathlib.Path(__file__).resolve().parent
dist, out = root / 'dist', root / 'deploy'
pub = out / 'public'

def fetch(name):
    r = subprocess.run(['curl', '-sS', '-f', '--max-time', '60', SITE + name], capture_output=True)
    if r.returncode != 0: sys.exit('Couldn’t download ' + name + ' from the live site: ' + r.stderr.decode()[:200])
    return r.stdout

def sha(b): return hashlib.sha256(b).hexdigest()

expect = EXPECT_LIVE_SHA256
if '--expect' in sys.argv: expect = sys.argv[sys.argv.index('--expect') + 1]
for f in ['redirect/index.html', 'logo-white.png']:
    if not (dist / f).exists(): sys.exit('dist/' + f + ' is missing — run python3 build.py first.')

live = fetch('index.html')
if sha(live) != expect:
    sys.exit('The live page isn’t the one expected (live sha256 ' + sha(live)[:16] + '…, expected ' + expect[:16] + '…). '
             'Someone may have published a newer page. Look at it first; to go ahead anyway, pass --expect ' + sha(live))
m = re.search(rb"VERSION = ['\"]([0-9.]+)['\"]", live) or re.search(rb"APP_VERSION = ['\"]([0-9.]+)['\"]", live)
ver = m.group(1).decode() if m else 'unknown'

if out.exists(): shutil.rmtree(out)
pub.mkdir(parents=True)
shutil.copy(dist / 'redirect' / 'index.html', pub / 'index.html')
shutil.copy(dist / 'logo-white.png', pub / 'logo-white.png')
today = datetime.date.today().isoformat()
(pub / ('index.html.backup-' + today + '-v' + ver)).write_bytes(live)
for b in OLD_BACKUPS:
    (pub / b).write_bytes(fetch(b))
(out / 'firebase.json').write_text(json.dumps({'hosting': {
    'public': 'public', 'ignore': ['firebase.json', '**/.*'],
    'headers': [{'source': '**', 'headers': [{'key': 'Cache-Control', 'value': 'no-cache'}]}]}}, indent=2) + '\n')

print('Ready in deploy/:')
for p in sorted(pub.iterdir()): print('  %-48s %9d bytes  sha256 %s…' % (p.name, p.stat().st_size, sha(p.read_bytes())[:16]))
print('After publishing, the live index.html should have sha256 ' + sha((pub / 'index.html').read_bytes()))
