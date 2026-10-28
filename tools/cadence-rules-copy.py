#!/usr/bin/env python3
"""Cadence (cadence.html, a compiled bundle with no source folder) ships a copy of the shared Firestore rules
(nlo-cases-src/firestore.rules) for Dr. A's "publish the rules" card on Admin → Move to NLO Cases, as NLO Cases, A/R,
Time Off, the Time Clock and Inventory do in their pages. Whenever that file changes, put the new one into the page too:

    python3 tools/cadence-rules-copy.py          (from the repo root; then commit cadence.html with the rebuilt pages)

Only the copy changes (the JSON string after `const NLO_RULES = `); --check just says whether it's current."""
import json
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
page = root / 'cadence.html'
rules = (root / 'nlo-cases-src' / 'firestore.rules').read_text(encoding='utf-8')
assert rules.count('__OWNER_EMAIL__') == 1 and 'match /cadInst/{id}' in rules and 'match /meta/rules_cad_1' in rules, \
    'not the shared rules file with Cadence\'s block'
html = page.read_text(encoding='utf-8')
assert html.count('const NLO_RULES = ') == 1, 'cadence.html has no rules copy (or more than one)'
m = re.search(r'const NLO_RULES = ("(?:[^"\\]|\\.)*");', html)
assert m, 'the rules copy in cadence.html is not where expected'
new = json.dumps(rules).replace('</', '<\\/')  # (as the page was patched: never a "</" inside the script)
if m.group(1) == new:
    print('cadence.html: its rules copy is current')
    sys.exit(0)
if '--check' in sys.argv:
    print('cadence.html: its rules copy is OLDER than nlo-cases-src/firestore.rules')
    sys.exit(1)
page.write_text(html[:m.start(1)] + new + html[m.end(1):], encoding='utf-8')
print('cadence.html: rules copy updated')
