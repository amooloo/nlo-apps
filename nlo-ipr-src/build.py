"""Build NLO IPR Tracker 4 (on the NLO Cases platform):
  dist/IPR_Tracker.html       the page (published as ../IPR_Tracker.html on GitHub Pages — the same address as before)
  dist/IPR_Tracker_old.html   IPR Tracker 3 as it was (old/IPR_Tracker_v3.html), kept beside it until Dr. A moves the records:
                              staff use it until then; afterwards it sends everyone to the new one (published as
                              ../IPR_Tracker_old.html)
  dist/firestore.rules        the shared rules with the owner's email filled in (tests use a made-up address)
The rules live in ../nlo-cases-src/firestore.rules — one file for the whole Firebase project (NLO Cases, Leads, A/R, Time Off,
the Time Clock, Inventory and the IPR Tracker). The page carries a copy (owner's email left as a placeholder) for Dr. A's
"publish the rules" card.
React 18 (production build, src/react.js) is inside the page, as it was in IPR Tracker 3: the page loads no code it doesn't
carry except the pinned Firebase SDK."""
import base64, hashlib, json, os, pathlib, shutil
root = pathlib.Path(__file__).parent
src = root / 'src'
FILES = ['react.js', 'core.js', 'backend.js', 'lock.js', 'move.js', 'photos.js', 'app.js']
t = (src / 'template.html').read_text()
js = '\n'.join((src / f).read_text() for f in FILES)
js += "\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();\n"

# the shared rules (Dr. A's "publish the rules" card)
rules = (root.parent / 'nlo-cases-src' / 'firestore.rules').read_text()
assert rules.count('__OWNER_EMAIL__') == 1
for need in ['match /iprPts/{id}', 'match /iprVis/{id}', 'match /iprPtLog/{lid}', 'match /iprVisLog/{lid}', 'match /iprMeta/{id}', 'match /meta/rules_ipr_1', 'function iprPtSavedNow(id)',
             'match /invItems/{id}', 'match /tcPunch/{id}', 'match /toReq/{id}', 'match /cases/{id}']:
    assert need in rules, need
assert js.count('const IPR_RULES = "";') == 1
js = js.replace('const IPR_RULES = "";', 'const IPR_RULES = ' + json.dumps(rules) + ';', 1)
# the NLO Cases project's web config (public by design; security is the rules and the encryption)
conf = json.loads((root / 'fbconfig.js').read_text())
for k, ph in [('apiKey', '__API_KEY__'), ('authDomain', '__AUTH_DOMAIN__'), ('projectId', '__PROJECT_ID__'), ('appId', '__APP_ID__')]:
    assert js.count('"' + ph + '"') == 1, ph
    js = js.replace('"' + ph + '"', json.dumps(conf[k]), 1)
assert t.count('__AUTH_FRAME__') == 1
t = t.replace('__AUTH_FRAME__', 'https://' + conf['authDomain'])
assert t.count('/*STYLE*/') == 1 and t.count('/*SCRIPT*/') == 1 and t.count('__SCRIPT_HASH__') == 1
assert '</script' not in js.lower(), 'script body must not contain </script'
assert '<!--' not in js, 'script body must not contain <!--'
css = (src / 'style.css').read_text()
assert '</style' not in css.lower()
# CSP: allow exactly this inline script (by SHA-256), so injected scripts and handlers can't run
script_text = '\n' + js + '\n'
h = "'sha256-" + base64.b64encode(hashlib.sha256(script_text.encode('utf-8')).digest()).decode() + "'"
out = t.replace('/*STYLE*/', css).replace('/*SCRIPT*/', js).replace('__SCRIPT_HASH__', h)
assert out.count(script_text) == 1

# ---- IPR Tracker 3, kept beside it until the move: unchanged, except that once the records have moved (the move leaves
# nlo/ipr/moved in its database) it sends everyone to the new page, and a page left open says so
old = (root / 'old' / 'IPR_Tracker_v3.html').read_text()
def swap(s, a, b):
    assert s.count(a) == 1, a[:80]
    return s.replace(a, b)
old = swap(old, '<title>IPR Tracker</title>', '<title>IPR Tracker (old)</title>')
for f in ['async function sbPost(table, body) {\n', 'async function sbPatch(path, body) {\n', 'async function sbDelete(path) {\n']:
    old = swap(old, f, f + '  iprNoSave();\n')
old = swap(old, '''    if (!appMounted) {
      appMounted = true;
      root.render(/*#__PURE__*/React.createElement(App, null));
    }
    iprRosterStart();''', '''    // IPR Tracker 4 (23 Oct 2026): once Dr. A has moved the records to the NLO Cases logins, this old page sends everyone there
    fbDB.ref(IPR_ROOT + "/moved").once("value").then(s => {
      if (s.exists()) { iprGoNew(); return; }
      if (!appMounted) {
        appMounted = true;
        root.render(/*#__PURE__*/React.createElement(App, null));
      }
      iprRosterStart();
      iprWatchMoved();
    }, () => {
      if (!appMounted) {
        appMounted = true;
        root.render(/*#__PURE__*/React.createElement(App, null));
      }
      iprRosterStart();
    });''')
old = swap(old, '''// ─── Auth gate: mount the app only after an allowed Google sign-in''', '''// ─── IPR Tracker 4: the records moved to the NLO Cases logins (IPR_Tracker.html) ───
function iprGoNew() { location.replace("IPR_Tracker.html" + location.search + location.hash); }
// once the records have moved, this page saves nothing more here (Amir's review, 23 Oct 2026: a page left open kept saving where
// nobody would see it)
let iprMovedNow = false;
function iprNoSave() { if (iprMovedNow) throw new Error("The IPR Tracker has moved to your NLO Cases login: this old page no longer saves. Open the new one."); }
let iprMovedRef = null;
function iprWatchMoved() {
  if (iprMovedRef) return;
  iprMovedRef = fbDB.ref(IPR_ROOT + "/moved");
  iprMovedRef.on("value", s => {
    if (!s.exists() || document.getElementById("iprMovedBar")) return;
    const bar = document.createElement("div"); bar.id = "iprMovedBar"; bar.setAttribute("role", "alert");
    bar.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:100000;background:#1B2F4C;color:#fff;padding:12px 18px;font:600 14px system-ui,sans-serif;display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;";
    iprMovedNow = true;
    const t = document.createElement("span"); t.textContent = "The IPR Tracker has moved to your NLO Cases login, and this page no longer saves. Open the new one to chart.";
    const b = document.createElement("button"); b.type = "button"; b.textContent = "Open the new IPR Tracker";
    b.style.cssText = "padding:7px 16px;border-radius:999px;border:0;background:#64F4C9;color:#11203A;font:700 13px system-ui,sans-serif;cursor:pointer;";
    b.addEventListener("click", iprGoNew);
    bar.appendChild(t); bar.appendChild(b); document.body.appendChild(bar);
  }, () => {});
}
// ─── Auth gate: mount the app only after an allowed Google sign-in''')

dist = root / 'dist'; dist.mkdir(exist_ok=True)
(dist / 'IPR_Tracker.html').write_text(out)
(dist / 'IPR_Tracker_old.html').write_text(old)
(dist / 'app.js').write_text(js)
(dist / 'firestore.rules').write_text(rules.replace('__OWNER_EMAIL__', os.environ.get('OWNER_EMAIL', 'dr.test@example.com')))
for f in ['logo-white.png', 'nlo-home.js', 'nlo-aisa.js']:
    if (root.parent / f).exists(): shutil.copy(root.parent / f, dist / f)
(dist / 'build-info.json').write_text(json.dumps({'sha256': hashlib.sha256(out.encode('utf-8')).hexdigest(), 'script': h}) + '\n')
print('built IPR_Tracker.html', len(out), 'bytes; IPR_Tracker_old.html', len(old), 'bytes')
