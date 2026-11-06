"""One-off: build assets/pontics/ (the Pontics tab's shapes) from the Christian Brenes Pontic Library (Meshmixer
OBJs, 28 pontics #2-#15 and #18-#31, plus the maxilla and mandible sets they were placed in).

    python tools/make_pontic_lib.py "C:\\...\\Brenes Tooth & Pontic Libraries\\Christian Brenes Pontic Library"

Each pontic goes into its own frame - X along the arch, Y facial (outward), Z occlusal, the origin at the deepest point
of the base on the pontic's own axis - decimated to ~8000 triangles and saved as pNN.npz (V float32, F uint32), with
lib.json listing every shape's natural width / height / thickness. The orientation comes from the library's own arch
sets: every pontic is an exact translated copy of its tooth in the set (vertex order kept), so the arch's outward
direction at the tooth is its facial direction, and the sets stand in occlusion: -Y of the file is occlusal for an upper
tooth, +Y for a lower."""
import sys, os, re, glob, json
import numpy as np

# the pontic files carry no tooth number: Brenes exported them 31 -> 2 in one sitting (the file names are the export
# timestamps, the suffix is the quadrant), checked against the arch sets below - each matches its place in the arch
PONTIC_ORDER = [31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]
SETS = {"upper": "1479098194_00001_1.obj", "lower": "1479098135_00001_4.obj"}    # maxilla, mandible
NAMES = {1: "central incisor", 2: "lateral incisor", 3: "canine", 4: "first premolar", 5: "second premolar", 6: "first molar", 7: "second molar", 8: "third molar"}
TARGET_FACES = 8000


def universal_info(n):
    """Universal number -> (arch, side, position 1-8)."""
    if 1 <= n <= 8:
        return "upper", "R", 9 - n
    if 9 <= n <= 16:
        return "upper", "L", n - 8
    if 17 <= n <= 24:
        return "lower", "L", 25 - n
    return "lower", "R", n - 24


def load_obj(path):
    with open(path, "rb") as f:
        data = f.read()
    V = np.array(re.findall(rb"^v\s+(\S+)\s+(\S+)\s+(\S+)", data, re.M), dtype=np.float64)
    F = np.array(re.findall(rb"^f\s+(\d+)\S*\s+(\d+)\S*\s+(\d+)\S*", data, re.M), dtype=np.int64) - 1
    return V, F


def components(V, F):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    i = np.r_[F[:, 0], F[:, 1], F[:, 2]]; j = np.r_[F[:, 1], F[:, 2], F[:, 0]]
    A = coo_matrix((np.ones(len(i)), (i, j)), shape=(len(V), len(V)))
    return connected_components(A, directed=False)


def main(src, out):
    import trimesh, fast_simplification
    os.makedirs(out, exist_ok=True)
    files = sorted(glob.glob(os.path.join(src, "*.obj")))
    indiv, k = {}, 0
    for f in files:
        b = os.path.basename(f)
        if os.path.getsize(f) > 20_000_000 or b.startswith("1479183599") or b.startswith("1479098482"):
            continue          # the arch sets, the logo, the anterior set
        n = PONTIC_ORDER[k]; k += 1
        indiv[n] = (f, b)
    assert len(indiv) == 28, len(indiv)
    # where each pontic stands in its arch set: the centre of the matching component (same vertex count, same vertex order)
    centres = {}
    for arch, setname in SETS.items():
        V, F = load_obj(os.path.join(src, setname))
        ncomp, lab = components(V, F)
        counts = {n: len(load_obj(indiv[n][0])[0]) for n in indiv if universal_info(n)[0] == arch}
        for c in range(ncomp):
            idx = np.where(lab == c)[0]
            cand = [n for n, nv in counts.items() if nv == len(idx) and n not in centres]
            best = None
            for n in cand:
                Vi = load_obj(indiv[n][0])[0]
                d = V[idx] - Vi
                rms = float(np.sqrt((np.linalg.norm(d - d.mean(0), axis=1) ** 2).mean()))     # a pure translation: zero
                if best is None or rms < best[1]:
                    best = (n, rms)
            if best is None or best[1] > 1e-3:
                raise SystemExit(f"{setname}: component {c} ({len(idx)} vertices) matches no pontic")
            centres[best[0]] = V[idx].mean(0)
    lib = []
    for n in sorted(indiv):
        arch, side, pos = universal_info(n)
        order = list(range(2, 16)) if arch == "upper" else list(range(18, 32))
        i = order.index(n)
        prev_, next_ = order[max(0, i - 1)], order[min(len(order) - 1, i + 1)]
        t = centres[next_] - centres[prev_]; t[1] = 0.0; t /= np.linalg.norm(t)
        cen = np.mean([centres[m] for m in order], axis=0)
        outw = cen * 0; outw[:] = [t[2], 0.0, -t[0]]
        if np.dot(outw, centres[n] - cen) < 0:
            outw = -outw
        # occlusal: the library's two arches stand in occlusion - the upper teeth hang (occlusal -Y), the lower stand (+Y)
        Zo = np.array([0.0, -1.0 if arch == "upper" else 1.0, 0.0])
        Yf = outw / np.linalg.norm(outw)         # facial: the arch's outward direction at the tooth
        Xt = np.cross(Yf, Zo); Xt /= np.linalg.norm(Xt)
        R = np.vstack([Xt, Yf, Zo])              # rows: canonical axes in file coordinates
        V, F = load_obj(indiv[n][0])
        V2, F2 = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_count=TARGET_FACES)
        m = trimesh.Trimesh(np.asarray(V2, float), np.asarray(F2, np.int64), process=True)
        m.remove_unreferenced_vertices()
        if not m.is_watertight:
            m.fill_holes()
        m.fix_normals()
        C = np.asarray(m.vertices) @ R.T         # canonical coordinates
        C[:, 2] -= C[:, 2].min()                  # z = 0 at the deepest point of the base
        band = (C[:, 2] > 1.0) & (C[:, 2] < 4.0)  # the emergence region: its centroid is the pontic's axis
        C[:, :2] -= C[band, :2].mean(0)
        w0, t0, h0 = (C.max(0) - C.min(0)).tolist()
        np.savez_compressed(os.path.join(out, f"p{n:02d}.npz"), V=C.astype(np.float32), F=np.asarray(m.faces, np.uint32))
        lib.append(dict(n=n, arch=arch, side=side, pos=pos, name=f"{'U' if arch == 'upper' else 'L'}{side} {NAMES[pos]}", w0=round(w0, 2), h0=round(h0, 2), t0=round(t0, 2),
                        faces=int(len(m.faces)), watertight=bool(m.is_watertight), src=indiv[n][1]))
        print(f"#{n:>2} {lib[-1]['name']:22s} w {w0:5.2f} h {h0:5.2f} t {t0:5.2f}  faces {len(m.faces)}  watertight {m.is_watertight}")
    json.dump(dict(library="Christian Brenes Pontic Library (Meshmixer), 2016", frame="X along the arch, Y facial (outward), Z occlusal; origin at the deepest point of the base",
                   shapes=lib), open(os.path.join(out, "lib.json"), "w"), indent=1)
    print("written", out)


if __name__ == "__main__":
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "assets", "pontics"))
