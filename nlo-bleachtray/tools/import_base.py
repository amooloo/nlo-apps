"""One-time setup: extract the Trimlign base from any Titan export and build the app's base assets.

    python tools/import_base.py "S:\\clinical\\3D printing\\Titan\\<order folder>\\<Patient> - 1 - Maxilla.stl"

Titan places the base at a fixed position (locating hole at the origin, fan toward -y, 4.24 mm tall),
so it is found by its bounding box. Writes assets/trimlign_base_titan.stl (verbatim) and
assets/trimlign_base_manifold.ply (clean manifold rebuild for booleans).
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


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    src = sys.argv[1]
    m = trimesh.load(src, force="mesh")
    base = find_base(m)
    if base is None:
        print("No Trimlign base found in", src, "- use a Titan export that includes the base (Trimlign/angled export).")
        sys.exit(2)
    os.makedirs(ASSETS, exist_ok=True)
    titan_path = os.path.join(ASSETS, "trimlign_base_titan.stl")
    base.export(titan_path)
    print("base extracted:", len(base.faces), "faces ->", titan_path)
    subprocess.check_call([sys.executable, os.path.join(ROOT, "tools", "rebuild_base.py"), titan_path], cwd=ROOT)
    print("done. assets:", sorted(os.listdir(ASSETS)))


if __name__ == "__main__":
    main()
