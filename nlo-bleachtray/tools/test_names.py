"""Patient names from scanner file names (bleachtray/watch.py parse_name - the page's nameOf follows the same rule).
python tools/test_names.py  -> prints each case, exits 1 on a mismatch."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bleachtray.watch import parse_name

CASES = [
    ("Maria B Lopez_20261019_05-56-37_upper.ply", ("Maria B", "Lopez", "upper")),     # a middle initial (10/19/2026: a real one became "<first> B")
    ("Mary Ann Smith_20261019_05-56-37_lower.stl", ("Mary Ann", "Smith", "lower")),
    ("Juan De La Cruz_20261019_05-56-37_upper.ply", ("Juan", "De La Cruz", "upper")),
    ("Rose_St_James_20261017_12-05-35_lower.ply", ("Rose", "St James", "lower")),       # was "Rose St"
    ("Jane_Roe_20261018_10-00-32_lower.ply", ("Jane", "Roe", "lower")),
    ("Liam O'Brien_20261019_10-00-00_upper.ply", ("Liam", "O'Brien", "upper")),
    ("José Núñez_20261019_10-00-00_upper.ply", ("José", "Núñez", "upper")),            # was "Scan JosNez..."
    ("Anna-Maria Lopez_20261019_10-00-00_upper.ply", ("Anna-Maria", "Lopez", "upper")),
    ("Dr._John_Roe_20261016_20-03-45_lower.stl", ("John", "Roe", "lower")),
    ("1792090108716_Anna_Roe_20261015_14-48-08_lower.stl", ("Anna", "Roe", "lower")),
    ("Jane_Doe_20261015_09-20-31_upper.stl", ("Jane", "Doe", "upper")),
    ("123456789_lprofile_occlusion_u.ply", ("Scan", "123456789lprofileocc", "upper")),  # iTero: no name in it
    ("Jane_Flowers_20261019_10-00-00_upper.stl", ("Jane", "Flowers", "upper")),        # was read as a lower ("Flowers")
    ("Ann_Upperman_20261019_10-00-00_lower.ply", ("Ann", "Upperman", "lower")),        # was read as an upper
]

bad = 0
for fn, want in CASES:
    got = parse_name(fn)
    ok = got == want
    bad += not ok
    print(("ok   " if ok else "FAIL ") + f"{fn!r:66} -> {got}" + ("" if ok else f"  (expected {want})"))
sys.exit(1 if bad else 0)
