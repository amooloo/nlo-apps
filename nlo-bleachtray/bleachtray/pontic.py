"""Pontics (the Pontics tab, 11/6/2026 - the doctor: "when we need to make retainers with missing teeth we can click +
and add optional pontics; the pontic's shape including height, width and thickness should be adjustable").

A pontic is a library tooth shape (Christian Brenes' pontic library, `assets/pontics/`: 28 shapes, #2-#15 and #18-#31)
stood where a tooth is missing and fused into the model like a block-out, so the thermoformed retainer carries a
tooth-shaped pocket there for the lab to fill. Each shape lives in its own frame - X along the arch, Y facial, Z occlusal,
the origin at the deepest point of its base ("the seat") - with a natural width / height / thickness (w0, h0, t0).

The page keeps one entry per pontic with the scan (`paint[path]["pontics"]`):
    {"id": "p1", "n": 4, "slot": "R5", "w": 7.0, "h": 9.5, "t": 8.5, "mirror": false,
     "m": [16 floats]}      # the pontic's frame in the scan's own coordinates (row-major 4x4: columns = X, Y, Z axes, seat)
`m` is in raw scan coordinates (not the page's rough frame) so a cut or a take-off, which re-indexes the scan but moves
no vertex, leaves it valid - the same reason the label on the model is kept raw. At build time it goes through the
model's raw-to-output transform (T_total), the shape is scaled to w / h / t about its seat (mirrored in X when a shape
from the other side is used), fused into the scan surface (fuse.py: collar at the seams, foot down to the ridge) and
unioned into the body as an extra solid."""
import os, json
import numpy as np
import trimesh

LIB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "pontics")
_LIB = {}
_MESH = {}


def library():
    """{n: shape meta} from assets/pontics/lib.json (cached)."""
    if not _LIB:
        with open(os.path.join(LIB_DIR, "lib.json"), "r", encoding="utf-8") as f:
            d = json.load(f)
        for s in d.get("shapes", []):
            _LIB[int(s["n"])] = dict(s)
    return _LIB


def shape_mesh(n):
    """The canonical mesh of shape n (cached copy; callers must not modify it in place)."""
    n = int(n)
    if n not in _MESH:
        if n not in library():
            raise KeyError(f"no pontic shape #{n} in the library")
        z = np.load(os.path.join(LIB_DIR, f"p{n:02d}.npz"))
        _MESH[n] = trimesh.Trimesh(np.asarray(z["V"], dtype=np.float64), np.asarray(z["F"], dtype=np.int64), process=False)
    return _MESH[n]


def norm_spec(p):
    """One pontic as the page sends it -> a clean dict, or None when it cannot be used."""
    if not isinstance(p, dict):
        return None
    try:
        n = int(p.get("n"))
        if n not in library():
            return None
        m = np.asarray(p.get("m"), dtype=float).reshape(4, 4)
        if not np.all(np.isfinite(m)):
            return None
        R = m[:3, :3]
        # a rigid frame: orthonormal columns (re-orthonormalised, the page's floats are close), right-handed
        u, _, vt = np.linalg.svd(R)
        R = u @ vt
        if np.linalg.det(R) < 0:
            return None
        m[:3, :3] = R; m[3] = [0.0, 0.0, 0.0, 1.0]
        s = library()[n]
        w = float(p.get("w") or s["w0"]); h = float(p.get("h") or s["h0"]); t = float(p.get("t") or s["t0"])
        if not (2.0 <= w <= 16.0 and 2.0 <= h <= 20.0 and 2.0 <= t <= 16.0):
            return None
        sink = min(6.0, max(0.0, float(p.get("sink") or 0.0)))     # (the page's own number: the seat's depth under the gum; the frame already has it)
        return dict(id=str(p.get("id") or f"p{n}"), n=n, slot=str(p.get("slot") or ""), w=round(w, 2), h=round(h, 2), t=round(t, 2), sink=round(sink, 2),
                    mirror=bool(p.get("mirror", False)), m=[[round(float(x), 5) for x in row] for row in m.tolist()])
    except Exception:
        return None


def pontic_mesh(spec, T=None):
    """The shape of `spec` scaled to its width / height / thickness about the seat, mirrored in X when asked, placed by
    its frame `m` (raw scan coordinates) and then by `T` (raw -> the model's frame) when given."""
    s = library()[int(spec["n"])]
    m = shape_mesh(spec["n"]).copy()
    S = np.diag([spec["w"] / s["w0"] * (-1.0 if spec.get("mirror") else 1.0), spec["t"] / s["t0"], spec["h"] / s["h0"], 1.0])
    M = np.asarray(spec["m"], dtype=float)
    if T is not None:
        M = np.asarray(T, dtype=float) @ M
    m.apply_transform(M @ S)
    if spec.get("mirror"):
        m.invert()          # a mirror turns the triangles inside out
    m.fix_normals()
    return m


def build_pontics(specs, T_total, surface, fuse=True, radius=0.6, overlap=0.2, foot_mm=8.0, log=None):
    """Every pontic of a scan as one mesh in the model's frame, each fused into `surface` (the scan as the body is built
    from it, same frame). `foot_mm`: how far down the air under the pontic is filled to the gum - every column under its
    silhouette, so the crown's bulge stands on a wall flush with its contour (the pontic comes with its own block-out: a
    thermoformed sheet must not get under it) and a seat a little high over a resorbed ridge still reaches it; 8 mm covers
    any sensible placement (the block-out fills use 3). Returns (mesh or None, info)."""
    info = dict(count=0, pontics=[])
    pieces = []
    for p in specs or []:
        spec = norm_spec(p)
        if spec is None:
            info.setdefault("dropped", []).append(str((p or {}).get("id", "?")) if isinstance(p, dict) else "?")
            continue
        s = library()[spec["n"]]
        try:
            m = pontic_mesh(spec, T_total)
        except Exception as ex:  # noqa
            info.setdefault("dropped", []).append(spec["id"])
            if log:
                log(f"pontic {spec['slot'] or spec['id']}: could not be made ({ex})")
            continue
        seat = (np.asarray(T_total, float) @ np.asarray(spec["m"], float))[:3, 3] if T_total is not None else np.asarray(spec["m"], float)[:3, 3]
        entry = dict(id=spec["id"], n=spec["n"], shape=s["name"], slot=spec["slot"], w=spec["w"], h=spec["h"], t=spec["t"], mirror=spec["mirror"],
                     seat=[round(float(x), 2) for x in seat], volume_ml=round(float(abs(m.volume)) / 1000.0, 3))
        if fuse:
            try:
                from .fuse import fuse_many
                m2, finfo = fuse_many(m, surface, radius=radius, overlap=overlap, foot_mm=foot_mm, reach_below=foot_mm, log=None)
                entry["fused"] = dict(fillet_mm3=finfo.get("fillet_mm3"), fused=finfo.get("fused"), failed=finfo.get("failed"))
                if finfo.get("errors"):
                    entry["fused"]["errors"] = finfo["errors"]
                if m2 is not None:
                    m = m2
            except Exception as ex:  # noqa
                entry["fused"] = dict(error=str(ex)[:120])
        pieces.append(m)
        info["pontics"].append(entry)
        if log:
            log(f"pontic {spec['slot'] or spec['id']}: {s['name']} (#{spec['n']}{', mirrored' if spec['mirror'] else ''}), {spec['w']} x {spec['h']} x {spec['t']} mm (w x h x t)"
                + (f" - fused, {entry['fused'].get('fillet_mm3', 0)} mm3 of fillet" if entry.get("fused") and "error" not in entry["fused"] else ""))
    info["count"] = len(pieces)
    if not pieces:
        return None, info
    return (trimesh.util.concatenate(pieces) if len(pieces) > 1 else pieces[0]), info


def slot_frame(seat, tangent, up=(0.0, 0.0, 1.0), outward=None):
    """A pontic frame from a seat point, the arch's direction there and the occlusal direction (the page does the same in
    JS): X along the arch, Y facial = outward (perpendicular to X and Z), Z = up. Returns a 4x4."""
    seat = np.asarray(seat, float); Z = np.asarray(up, float); Z /= np.linalg.norm(Z)
    X = np.asarray(tangent, float); X -= np.dot(X, Z) * Z; X /= max(np.linalg.norm(X), 1e-9)
    Y = np.cross(Z, X)
    if outward is not None and np.dot(Y, np.asarray(outward, float)) < 0:
        X, Y = -X, -Y
    M = np.eye(4); M[:3, 0] = X; M[:3, 1] = Y; M[:3, 2] = Z; M[:3, 3] = seat
    return M
