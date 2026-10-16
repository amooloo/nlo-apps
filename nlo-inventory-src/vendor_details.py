"""The vendor list's account numbers, reps and card notes, into the old database's saved vendors — once, right before the move,
so the move carries them into NLO Inventory's database (where only the office's logins can read them). The 5.0 page itself
carries only the public vendor list, since it's published from the public repo.

    python3 build.py                                   # makes dist/vendor-details.json from src/vendors.private.js (not in git)
    npx firebase database:get /nlo/vendors --project nlo-inventory > deploy/vendors-now.json
    python3 vendor_details.py deploy/vendors-now.json  # → deploy/vendors-patch.json: only what's missing, nothing replaced
    npx firebase database:update /nlo/vendors deploy/vendors-patch.json --project nlo-inventory --force

A saved vendor that already has an account number (say, one Sarah typed in) keeps it. The old app shows the same details either
way: it merges saved vendors over its built-in list."""
import json, pathlib, sys
root = pathlib.Path(__file__).resolve().parent
details = json.loads((root / 'dist' / 'vendor-details.json').read_text())
now = json.loads(pathlib.Path(sys.argv[1]).read_text() or 'null') or {}
if isinstance(now, list): now = {str(v.get('id')): v for v in now if isinstance(v, dict) and v.get('id')}
patch, kept = {}, 0
for vid, d in details.items():
    cur = now.get(vid) if isinstance(now.get(vid), dict) else {}
    for k, v in d.items():
        if cur.get(k) in (None, ''): patch[vid + '/' + k] = v
        else: kept += 1
    if patch and any(p.startswith(vid + '/') for p in patch) and not cur.get('id'): patch[vid + '/id'] = vid
out = root / 'deploy' / 'vendors-patch.json'; out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(patch, indent=1, ensure_ascii=False) + '\n')
print('%d vendors: %d details to add, %d already saved there (kept). Wrote %s' % (len(details), len([k for k in patch if not k.endswith('/id')]), kept, out))
