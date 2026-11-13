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
        out = dict(id=str(p.get("id") or f"p{n}"), n=n, slot=str(p.get("slot") or ""), w=round(w, 2), h=round(h, 2), t=round(t, 2), sink=round(sink, 2),
                   mirror=bool(p.get("mirror", False)), m=[[round(float(x), 5) for x in row] for row in m.tolist()])
        # a build-up (11/13/2026): the same library crown stood over a worn or chipped tooth instead of in a space
        if p.get("bu"):
            out["bu"] = True
            try:
                out["tooth"] = int(p.get("tooth") or 0)
            except Exception:
                out["tooth"] = 0
            src = norm_src(p.get("src"))
            if src is not None:
                out["src"] = src; out["mirror"] = False
        return out
    except Exception:
        return None


def norm_src(q):
    """The patient's own tooth a build-up is mirrored from (11/13/2026): {"tooth": its label, "m": that tooth's frame in
    the scan's own coordinates, "w0" / "h0" / "t0": its sizes in that frame} -> a clean dict, or None."""
    if not isinstance(q, dict):
        return None
    try:
        tooth = int(q.get("tooth") or 0)
        m = np.asarray(q.get("m"), dtype=float).reshape(4, 4)
        if tooth <= 0 or not np.all(np.isfinite(m)):
            return None
        u, _, vt = np.linalg.svd(m[:3, :3]); R = u @ vt
        if np.linalg.det(R) < 0:
            return None
        m[:3, :3] = R; m[3] = [0.0, 0.0, 0.0, 1.0]
        w0, h0, t0 = float(q.get("w0")), float(q.get("h0")), float(q.get("t0"))
        if not (2.0 <= w0 <= 16.0 and 2.0 <= h0 <= 20.0 and 2.0 <= t0 <= 16.0):
            return None
        return dict(tooth=tooth, m=[[round(float(x), 5) for x in row] for row in m.tolist()], w0=round(w0, 2), h0=round(h0, 2), t0=round(t0, 2))
    except Exception:
        return None


def _loops(F):
    """The open edges of a triangle list as closed loops of vertex indices, each in its faces' own direction."""
    E = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    key = np.sort(E, axis=1); _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    B = E[cnt[np.ravel(inv)] == 1]
    nxt = {}
    for a, b in B.tolist():
        nxt.setdefault(a, []).append(b)
    loops = []
    while nxt:
        a0 = next(iter(nxt)); loop = [a0]; a = a0
        while True:
            outs = nxt.get(a)
            if not outs:
                break
            b = outs.pop()
            if not outs:
                del nxt[a]
            if b == a0:
                break
            loop.append(b); a = b
            if len(loop) > len(B) + 1:
                break
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def mirror_shape(src, V_raw, F, labels):
    """The patient's own tooth `src` as a closed shape in a build-up's frame, mirrored: the crown's surface (the largest
    piece of its label) in its own frame (X along the arch, Y facial, Z up the tooth, the origin at its seat), closed
    underneath - the gum-line ring to a point at the seat, any other hole flat across - and then X turned round, so the
    mesial side of a right tooth is the mesial side of the left one."""
    labels = np.asarray(labels); F = np.asarray(F, dtype=np.int64)
    if len(labels) != len(V_raw):
        raise ValueError("the tooth colours do not match this scan")
    on = labels == int(src["tooth"])
    Ft = F[on[F].all(axis=1)]
    if len(Ft) < 50:
        raise ValueError(f"tooth {src['tooth']} is not on the scan any more")
    adj = trimesh.graph.face_adjacency(Ft)
    comps = trimesh.graph.connected_components(adj, nodes=np.arange(len(Ft)), min_len=1)
    Ft = Ft[max(comps, key=len)]
    used, inv = np.unique(Ft, return_inverse=True)
    Fl = inv.reshape(-1, 3)
    M = np.linalg.inv(np.asarray(src["m"], dtype=float))
    V = np.asarray(V_raw, dtype=float)[used] @ M[:3, :3].T + M[:3, 3]
    loops = sorted(_loops(Fl), key=len, reverse=True)
    if not loops:
        raise ValueError("the tooth has no gum-line edge to close")
    Vn = [V]; Fn = [Fl]; k = len(V)
    for i, lp in enumerate(loops):
        c = V[lp].mean(axis=0)
        if i == 0:
            c[2] = min(0.0, float(V[lp][:, 2].min()) - 0.2)      # the gum-line ring: closed to a point at the seat
        Vn.append(c[None, :])
        a = np.asarray(lp); b = np.roll(a, -1)
        Fn.append(np.column_stack([b, a, np.full(len(a), k)]))
        k += 1
    V = np.vstack(Vn); Fl = np.vstack(Fn)
    V[:, 0] *= -1.0; Fl = Fl[:, ::-1]
    m = trimesh.Trimesh(V, Fl, process=False)
    m.merge_vertices()
    if not m.is_watertight:
        trimesh.repair.fill_holes(m)
    if not m.is_watertight:
        raise ValueError("the mirrored tooth could not be closed")
    if m.volume < 0:
        m.invert()
    return m


def pontic_mesh(spec, T=None, scan=None):
    """The shape of `spec` scaled to its width / height / thickness about the seat, mirrored in X when asked, placed by
    its frame `m` (raw scan coordinates) and then by `T` (raw -> the model's frame) when given. A build-up mirrored from
    the patient's own tooth (`src`) takes its shape from `scan` = (the scan's vertices in its own coordinates, faces,
    labels) instead of the library."""
    if spec.get("src"):
        if scan is None:
            raise ValueError("the scan's tooth colours are needed to mirror a tooth")
        q = spec["src"]
        m = mirror_shape(q, *scan)
        S = np.diag([spec["w"] / q["w0"], spec["t"] / q["t0"], spec["h"] / q["h0"], 1.0])
        M = np.asarray(spec["m"], dtype=float)
        if T is not None:
            M = np.asarray(T, dtype=float) @ M
        m.apply_transform(M @ S)
        return m
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


def build_pontics(specs, T_total, surface, fuse=True, radius=0.6, overlap=0.2, foot_mm=8.0, foot_drop_mm=None, floor_z=None, labels=None, log=None):
    """Every pontic of a scan as one mesh in the model's frame, each fused into `surface` (the scan as the body is built
    from it, same frame). `foot_mm`: how far down the air under the pontic is filled to the gum - every column under its
    silhouette, so the crown's bulge stands on a wall flush with its contour (the pontic comes with its own block-out: a
    thermoformed sheet must not get under it) and a seat a little high over a resorbed ridge still reaches it; 8 mm covers
    any sensible placement (the block-out fills use 3). `floor_z`: the model's floor - the foot stops there and the piece
    is cut flat at it: over a cheek-side gum that falls away below the floor the foot hung under the model as a curtain
    (11/12/2026). `labels`: the tooth labels on `surface`'s vertices, for a build-up mirrored from the patient's own
    tooth. Returns (mesh or None, info)."""
    info = dict(count=0, pontics=[])
    pieces = []
    scan = None
    if labels is not None and surface is not None and len(labels) == len(surface.vertices):
        Vs = np.asarray(surface.vertices, dtype=float)
        if T_total is not None:
            Ti = np.linalg.inv(np.asarray(T_total, dtype=float)); Vs = Vs @ Ti[:3, :3].T + Ti[:3, 3]
        scan = (Vs, np.asarray(surface.faces), np.asarray(labels))
    for p in specs or []:
        spec = norm_spec(p)
        if spec is None:
            info.setdefault("dropped", []).append(str((p or {}).get("id", "?")) if isinstance(p, dict) else "?")
            continue
        s = library()[spec["n"]]
        try:
            m = pontic_mesh(spec, T_total, scan=scan)
        except Exception as ex:  # noqa
            info.setdefault("dropped", []).append(spec["id"])
            if log:
                log(f"{'build-up' if spec.get('bu') else 'pontic'} {spec['slot'] or spec['id']}: could not be made ({ex})")
            continue
        seat = (np.asarray(T_total, float) @ np.asarray(spec["m"], float))[:3, 3] if T_total is not None else np.asarray(spec["m"], float)[:3, 3]
        entry = dict(id=spec["id"], n=spec["n"], shape="the other side's tooth, mirrored" if spec.get("src") else s["name"], slot=spec["slot"], w=spec["w"], h=spec["h"], t=spec["t"], mirror=spec["mirror"],
                     seat=[round(float(x), 2) for x in seat], volume_ml=round(float(abs(m.volume)) / 1000.0, 3))
        if spec.get("bu"):
            entry["bu"] = True; entry["tooth"] = spec.get("tooth", 0)
            if spec.get("src"):
                entry["mirrored_from"] = spec["src"]["tooth"]
        if fuse:
            try:
                from .fuse import fuse_many
                if spec.get("bu"):
                    # a build-up stands on its own tooth: joined to it with a small fillet, nothing filled down to the
                    # gum under it (a template must show the tooth's own shape there, not a block-out)
                    m2, finfo = fuse_many(m, surface, radius=min(radius, 0.3), overlap=overlap, foot_mm=0.0, reach_below=0.0, floor_z=floor_z, log=None)
                else:
                    m2, finfo = fuse_many(m, surface, radius=radius, overlap=overlap, foot_mm=foot_mm, reach_below=foot_mm, foot_drop_mm=foot_drop_mm, floor_z=floor_z, log=None)
                entry["fused"] = dict(fillet_mm3=finfo.get("fillet_mm3"), fused=finfo.get("fused"), failed=finfo.get("failed"))
                if finfo.get("errors"):
                    entry["fused"]["errors"] = finfo["errors"]
                if m2 is not None:
                    m = m2
            except Exception as ex:  # noqa
                entry["fused"] = dict(error=str(ex)[:120])
        if floor_z is not None and float(m.bounds[0][2]) < float(floor_z) - 1e-6:
            try:
                from .fuse import _to_manifold, _from_manifold
                man = _to_manifold(m)
                cut = _from_manifold(man.trim_by_plane((0.0, 0.0, 1.0), float(floor_z))) if man is not None else None
                if cut is not None and len(cut.faces) >= 4:
                    m = cut
                    entry["cut_at_floor"] = True
            except Exception:  # noqa
                pass
        pieces.append(m)
        info["pontics"].append(entry)
        if log:
            log(f"{'build-up' if spec.get('bu') else 'pontic'} {spec['slot'] or spec['id']}: {("the other side's tooth mirrored (label " + str(spec['src']['tooth']) + ")") if spec.get('src') else (s['name'] + " (#" + str(spec['n']) + (', mirrored' if spec['mirror'] else '') + ")")}, {spec['w']} x {spec['h']} x {spec['t']} mm (w x h x t)"
                + (f" - fused, {entry['fused'].get('fillet_mm3', 0)} mm3 of fillet" if entry.get("fused") and "error" not in entry["fused"] else ""))
    info["count"] = len(pieces)
    info["buildups"] = sum(1 for e in info["pontics"] if e.get("bu"))
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
