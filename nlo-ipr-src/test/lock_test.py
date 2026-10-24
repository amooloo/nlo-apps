"""The old copy's lock (../../tools/rtdb-rules-ipr-lock.py): what it does to the Realtime Database rules, with no database.
    python3 test/lock_test.py
(test/e2e.py runs the locked rules on the database emulator.)"""
import copy, importlib.util, json, pathlib, sys
sys.dont_write_bytecode = True   # (no __pycache__ next to the published tools/ script)

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('lock', HERE.parent.parent / 'tools' / 'rtdb-rules-ipr-lock.py')
lock = importlib.util.module_from_spec(spec); spec.loader.exec_module(lock)

STAFF = "auth != null && auth.token.email_verified == true && (auth.token.email === 'akhavan.ak@gmail.com' || auth.token.email.endsWith('@thenextlevelorthodontics.com'))"
OFFICE = "auth != null && auth.token.email_verified == true && (auth.token.email === 'akhavan.ak@gmail.com' || auth.token.email === 'records@thenextlevelorthodontics.com')"
# the shape of the live rules (27 Sep 2026, as published, and the 14 Oct change to cadence)
LIVE = {'rules': {'nlo': {
    'items': {'.read': 'auth != null', '.write': OFFICE},
    'cadence': {'.read': STAFF, 'roster': {'.write': lock.owner_only('akhavan.ak@gmail.com')}, '$other': {'.write': STAFF}},
    'ipr': {'.read': STAFF, '.write': STAFF},
    'calendar': {'.read': STAFF, '.write': STAFF},
    'elastoPrices': {'.read': OFFICE, '.write': OFFICE}}}}

results = []
def check(name, ok, detail=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:600]))

before = copy.deepcopy(LIVE)
new, was = lock.lock_ipr(LIVE)
own = lock.owner_only('akhavan.ak@gmail.com')
check('nlo/ipr: only Dr. A’s verified Google account reads or writes it', new['rules']['nlo']['ipr']['.read'] == own and new['rules']['nlo']['ipr']['.write'] == own, new['rules']['nlo']['ipr'])
check('…the moved mark stays readable by everyone who could read nlo/ipr before (it sends an old page to the new one)', new['rules']['nlo']['ipr']['moved'] == {'.read': STAFF})
check('…it reports what nlo/ipr was', was == {'.read': STAFF, '.write': STAFF})
check('nothing else in the rules changes (and the rules handed in aren’t touched)', {k: v for k, v in new['rules']['nlo'].items() if k != 'ipr'} == {k: v for k, v in before['rules']['nlo'].items() if k != 'ipr'} and LIVE == before)
check('the order of the blocks is kept (the console shows them as they were)', list(new['rules']['nlo']) == list(LIVE['rules']['nlo']))
again, was2 = lock.lock_ipr(new)
check('run again: locked already, nothing to do', again is None and was2 == new['rules']['nlo']['ipr'])
check('a test owner address goes where Dr. A’s does', lock.lock_ipr(LIVE, 'dr.test@example.com')[0]['rules']['nlo']['ipr']['.write'] == lock.owner_only('dr.test@example.com'))
for label, bad in [('no nlo block', {'rules': {}}), ('no ipr rules', {'rules': {'nlo': {'items': {}}}}),
                   ('rules it doesn’t know under ipr', {'rules': {'nlo': {'ipr': {'.read': STAFF, '.write': STAFF, '.indexOn': ['x']}}}})]:
    try: lock.lock_ipr(bad); check('stops, changing nothing: ' + label, False, 'no stop')
    except SystemExit as e: check('stops, changing nothing: ' + label, 'nothing changed' in str(e), str(e))
json.dumps(new)
print('\n%d passed, %d failed' % (results.count(True), results.count(False)))
sys.exit(0 if all(results) else 1)
