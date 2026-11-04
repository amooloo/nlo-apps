"""Phase I: the count from the first molar with spaces (phase1.count_from_six / anchor_six / the "6 is here" dot).

    python tools/test_phase1_count.py

Synthetic sides: crowns as discs of points laid along an arc, with the spaces given, so no scan is needed."""
import os, sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from bleachtray.phase1 import count_from_six, anchor_six, tooth_gaps, GAP_TOOTH_MM


def side(widths, gaps, side_sign=-1, start=(0.0, 20.0), seed=0):
    """Crowns of the given mesiodistal widths (mm) with the given spaces between them (len(widths) - 1), laid along
    an arc from the midline back. Returns (V, labels, seq) with labels 1.. in arch order."""
    rng = np.random.default_rng(seed)
    V, L = [], []
    s = 0.0                        # arc length from the midline contact
    seq = []
    r_arc = 24.0
    for k, w in enumerate(widths):
        c = s + w / 2.0
        th = c / r_arc                                      # angle round the arch's centre (0, 0) from the front
        cx, cy = side_sign * r_arc * np.sin(th), r_arc * np.cos(th) - 4.0
        n = int(60 * w)                                      # a few hundred points per crown
        ang = rng.uniform(0, 2 * np.pi, n); rad = np.sqrt(rng.uniform(0, 1, n)) * (w / 2.0)
        pts = np.column_stack([cx + rad * np.cos(ang), cy + rad * np.sin(ang), rng.uniform(4.0, 10.0, n)])
        V.append(pts); L.append(np.full(n, k + 1)); seq.append(k + 1)
        s += w + (gaps[k] if k < len(gaps) else 0.0)
    return np.vstack(V), np.concatenate(L), seq


def check(name, widths, gaps, six_k, want):
    V, labels, seq = side(widths, gaps)
    new, g = count_from_six(V, labels, seq, six_k)
    got = [new[t] for t in seq]
    ok = got == want
    print(f"{'ok ' if ok else 'BAD'} {name}: gaps {[round(x, 1) for x in g]} -> {got}" + ("" if ok else f"  (wanted {want})"))
    return ok


def check_anchor(name, widths, gaps, info_positions, want):
    V, labels, seq = side(widths, gaps)
    info = {t: (-1, p) for t, p in zip(seq, info_positions)}
    contact = np.array([0.0, 20.0])
    labels2, info2, notes = anchor_six(V, labels, info, contact, arch="upper")
    got = [info2[t][1] for t in seq if t in info2]
    ok = got == want
    print(f"{'ok ' if ok else 'BAD'} anchor_six {name}: {info_positions} -> {got}" + ("" if ok else f"  (wanted {want})"))
    for n in notes:
        print("      ", n)
    return ok


C, D, E, M, I1, I2 = 6.5, 7.0, 8.5, 10.0, 8.5, 6.5
allok = True
allok &= check("all there, touching", [I1, I2, C, D, E, M], [0.3, 0.2, 0.3, 0.2, 0.3], 5, [1, 2, 3, 4, 5, 6])
allok &= check("E gone, 6 mm space (Bodhi's right)", [I1, I2, C, D, M], [0.3, 0.2, 0.3, 6.2], 4, [1, 2, 3, 4, 6])
allok &= check("D and E gone, 14 mm", [I1, I2, C, M], [0.3, 0.2, 14.0], 3, [1, 2, 3, 6])
allok &= check("a 3.9 mm diastema behind the 2 (Josiah)", [I1, I2, C, D, E, M], [0.3, 3.9, 0.3, 0.2, 0.3], 5, [1, 2, 3, 4, 5, 6])
allok &= check("C gone 5 mm, D E there", [I1, I2, D, E, M], [0.3, 5.0, 0.2, 0.3], 4, [1, 2, 4, 5, 6])
allok &= check("C gone 5 mm, E gone 6 mm", [I1, I2, D, M], [0.3, 5.0, 6.0], 3, [1, 2, 4, 6])
allok &= check("a 7 behind the 6", [I1, I2, C, D, E, M, 9.0], [0.3, 0.2, 0.3, 0.2, 0.3, 0.5], 5, [1, 2, 3, 4, 5, 6, 7])
allok &= check("a space too big for the count (20 mm): the C stays the 3 at least", [I1, I2, C, M], [0.3, 0.2, 20.0], 3, [1, 2, 3, 6])
allok &= check("a 3 mm space behind the D is not a tooth gone", [I1, I2, C, D, E, M], [0.3, 0.2, 0.3, 3.0, 0.3], 5, [1, 2, 3, 4, 5, 6])
allok &= check("the 5 half in, 4.4 mm from the 6: still the 5", [I1, I2, C, D, 4.0, M], [0.3, 0.2, 0.3, 2.0, 4.4], 5, [1, 2, 3, 4, 5, 6])
# anchor_six end to end: the count from the midline (edentulous_gaps' positions) goes in, the count from the 6 comes out
allok &= check_anchor("E gone, 6 mm (the midline count had the 6 as the 6 and the D as the 4)", [I1, I2, C, D, M], [0.3, 0.2, 0.3, 6.2], [1, 2, 3, 4, 6], [1, 2, 3, 4, 6])
allok &= check_anchor("E gone, 6 mm, the gap not counted (the D as the 4, the 6 as the 5)", [I1, I2, C, D, M], [0.3, 0.2, 0.3, 6.2], [1, 2, 3, 4, 5], [1, 2, 3, 4, 6])
allok &= check_anchor("Josiah: the diastema counted as a tooth gone made the 6 a 7", [I1, I2, C, D, E, M], [0.3, 3.9, 0.3, 0.2, 0.3], [1, 2, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6])
allok &= check_anchor("all there, touching (unchanged)", [I1, I2, C, D, E, M], [0.3, 0.2, 0.3, 0.2, 0.3], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6])
allok &= check_anchor("C gone (space counted): D is the 4, E the 5 (unchanged)", [I1, I2, D, E, M], [0.3, 5.0, 0.2, 0.3], [1, 2, 4, 5, 6], [1, 2, 4, 5, 6])
print("ALL OK" if allok else "FAILURES")
sys.exit(0 if allok else 1)
