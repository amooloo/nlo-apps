"""An outline that runs into the scan's edge comes back as open chains; they are joined into one loop, so the line is
never one chain closed by a straight chord across the tongue space (a lower Phase I, 11/12/2026)."""
import os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from bleachtray.phase1 import _join_open

fails = []
def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        fails.append(name)

a = np.linspace(0.05, np.pi - 0.05, 200)
outer = np.column_stack([25 * np.cos(a), 30 * np.sin(a), np.zeros(200)])           # cheek side, molar to molar
inner = np.column_stack([18 * np.cos(a), 22 * np.sin(a), np.zeros(200)])           # tongue side, same ends
t = np.linspace(0, 2 * np.pi, 40)
hole = np.column_stack([5 + np.cos(t), 10 + np.sin(t), np.zeros(40)])              # a closed loop (first point = last)

for nm, chains in (("same direction", [outer, inner]), ("one reversed", [outer, inner[::-1]]), ("with a closed loop", [outer, hole, inner])):
    L = _join_open(chains)
    main = L[0]
    check(f"{nm}: the two open chains make one loop", len(main) == 400 and len(L) == (2 if "closed" in nm else 1), [len(l) for l in L])
    step = np.linalg.norm(np.diff(np.vstack([main, main[:1]]), axis=0), axis=1)
    check(f"{nm}: no straight chord across the arch (longest step {step.max():.1f} mm)", step.max() < 10.0)
L = _join_open([hole, hole + 20])
check("closed loops are left alone", len(L) == 2 and all(len(l) == 40 for l in L))
far = inner + np.array([200.0, 0, 0])
L = _join_open([outer, far])
check("chains far apart are not joined", len(L) == 2)
print("\nALL OK" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
