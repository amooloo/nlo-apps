"""One-time setup: extract the Trimlign base from any Titan export and build the app's base assets.

    python tools/import_base.py "S:\\clinical\\3D printing\\Titan\\<order folder>\\<Patient> - 1 - Maxilla.stl"

Titan places the base at a fixed position (locating hole at the origin, fan toward -y, 4.24 mm tall),
so it is found by its bounding box. Writes assets/trimlign_base_titan.stl (verbatim) and
assets/trimlign_base_manifold.ply (clean manifold rebuild for booleans) - only when the rebuilt base passes its
check (bleachtray/basebuild.py: locating holes clear to 3.5 mm, no skins, watertight); a folder is searched until
an export gives a base that passes.
"""
import os, sys, subprocess
import numpy as np, trimesh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
EXPECT_MIN = np.array([-23.79, -29.0, 0.0])
EXPECT_MAX = np.array([23.78, 3.0, 4.25])


def find_base(mesh):
    for c in mesh.split(only_watertight=False):
        if np.allclose(c.bounds[0], EXPECT_MIN, atol=0.15) and np.allclose(c.bounds[1], EXPECT_MAX, atol=0.15):
            return c
    return None


def candidates(path):
    """A file, or a folder searched (newest first) for Titan exports that contain the base."""
    if os.path.isfile(path):
        return [path]
    named, others = [], []
    for root, _, files in os.walk(path):
        for f in files:
            if f.lower().endswith(".stl"):
                (named if ("maxilla" in f.lower() or "mandible" in f.lower()) else others).append(os.path.join(root, f))
    named.sort(key=os.path.getmtime, reverse=True)
    others.sort(key=os.path.getmtime, reverse=True)
    return (named + others)[:60]


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    sys.path.insert(0, ROOT)
    import json, time
    from bleachtray import basebuild as BB
    found = 0
    for src in candidates(sys.argv[1]):
        try:
            m = trimesh.load(src, force="mesh")
        except Exception:
            continue
        base = find_base(m)
        if base is None:
            continue
        found += 1
        print("base found in", src, "-", len(base.faces), "faces; rebuilding it as a clean solid…")
        out = BB.rebuild(base, log=print)
        ok, summary = BB.verify(base, out, log=print)
        if not ok:
            print("  that one did not rebuild cleanly - trying the next export")
            continue
        os.makedirs(ASSETS, exist_ok=True)
        titan_path = os.path.join(ASSETS, "trimlign_base_titan.stl")
        base.export(titan_path)
        titan, man, okf = BB.asset_paths(ROOT)
        out.export(man + ".tmp.ply"); os.replace(man + ".tmp.ply", man)
        json.dump(dict(ok=True, sig=BB._md5(man), hole_depths=summary["hole_depths"], rebuilt=True, check=summary, checked=time.time()), open(okf, "w"))
        print("done. assets:", sorted(os.listdir(ASSETS)))
        return
    if not found:
        print("No Trimlign base found in", sys.argv[1], "- use a Titan export that includes the base (Trimlign/angled export).")
        sys.exit(2)
    print("No export gave a base that passed its check - send one of the Titan exports to be looked at.")
    sys.exit(3)


if __name__ == "__main__":
    main()
