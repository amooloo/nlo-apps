"""Rebuild the Trimlign base as a clean manifold solid from Titan's base (see bleachtray/basebuild.py) and check it.

    python tools/rebuild_base.py [assets/trimlign_base_titan.stl]

Writes assets/trimlign_base_manifold.ply only when the rebuilt base passes its check (the locating holes clear to
3.5 mm, no skins where Titan's base is open, watertight); exits 3 otherwise and keeps the old file.
"""
import os, sys, json, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import trimesh  # noqa: E402
from bleachtray import basebuild as BB  # noqa: E402

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "assets", "trimlign_base_titan.stl")
t0 = time.time()
src = trimesh.load(SRC, force="mesh")
print("base z range", round(float(src.bounds[0][2]), 3), round(float(src.bounds[1][2]), 3), "-", len(src.faces), "faces")
out = BB.rebuild(src, log=print)
ok, summary = BB.verify(src, out, log=print)
titan, man, okf = BB.asset_paths(ROOT)
if not ok:
    print("NOT saved: the rebuilt base failed its check", json.dumps(summary)[:400])
    sys.exit(3)
tmp = man + ".tmp.ply"
out.export(tmp)   # PLY keeps vertex connectivity; load with process=False
os.replace(tmp, man)
json.dump(dict(ok=True, sig=BB._md5(man), hole_depths=summary["hole_depths"], rebuilt=True, check=summary, checked=time.time()), open(okf, "w"))
print("faces", len(out.faces), "watertight", out.is_watertight, "volume", round(out.volume, 2), "bounds", [[round(v, 3) for v in r] for r in out.bounds.tolist()])
print(f"saved {man} ({time.time() - t0:.0f} s)")
