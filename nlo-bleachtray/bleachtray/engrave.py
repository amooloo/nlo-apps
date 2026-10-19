"""Engrave the patient name and the tray type into the model, on the flat strip of the Trimlign base
plate that lies inside the arch (in front of the raised table, z = 1.0): two lines of capitals.

    KARLEY POST
    WHITENING

The strip is y = -13.9 .. -8.0 on the base (between the raised table and the slot). Width is limited by
the arch's lingual wall, so the text is scaled to fit and the name shortened ("K. POST") if needed.
Nothing here can fail the case: on any problem the model is returned unchanged.
"""
import numpy as np, trimesh
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
import manifold3d as m3
from shapely import affinity

BAND_Y0, BAND_Y1, PLATE_Z = -13.5, -8.4, 1.0     # usable strip (0.4 mm inside the real one), plate top
FONT = FontProperties(family="DejaVu Sans", weight="bold")
CAP_PER_EM = 0.742                                # DejaVu Sans Bold capital height / em


def text_geometry(text, cap_height):
    """Capital letters as a shapely (Multi)Polygon, baseline at y=0, left edge near x=0."""
    tp = TextPath((0, 0), text, size=cap_height / CAP_PER_EM, prop=FONT)
    rings = [Polygon(p).buffer(0) for p in tp.to_polygons() if len(p) >= 3]
    rings = [r for r in rings if not r.is_empty and r.area > 1e-4]
    outers, holes = [], []
    for r in rings:
        if any((q is not r) and q.area > r.area and q.contains(r.representative_point()) for q in rings):
            holes.append(r)
        else:
            outers.append(r)
    geoms = [Polygon(o.exterior.coords, [h.exterior.coords for h in holes if o.contains(h.representative_point())]) for o in outers]
    return unary_union(geoms)


def tray_type(params):
    if params.get("engrave_type"):
        return str(params["engrave_type"])
    if float(params.get("reservoir_height", 0) or 0) > 0 and int(params.get("reservoir_max_position", 0) or 0) > 0:
        return "WHITENING"
    if float(params.get("trimline_offset", 0) or 0) > 0:
        return "RETAINER"
    return "MODEL"


def name_variants(first, last):
    first, last = (first or "").strip().upper(), (last or "").strip().upper()
    out = []
    if first and last:
        out += [f"{first} {last}", f"{first[0]}. {last}", last]
    elif last or first:
        out += [last or first]
    return out or ["NLO"]


def free_width(outline, y0, y1, x_limit=19.0):
    """Widest strip centred on x=0 inside the base band that the arch body does not cover."""
    band = box(-x_limit, y0, x_limit, y1)
    free = band.difference(outline) if outline is not None else band
    if free.is_empty:
        return 0.0
    # the piece that contains the centre of the strip
    centre = (0.0, 0.5 * (y0 + y1))
    pieces = list(free.geoms) if hasattr(free, "geoms") else [free]
    piece = next((p for p in pieces if p.contains(Polygon([(centre[0] - .1, centre[1] - .1), (centre[0] + .1, centre[1] - .1), (centre[0], centre[1] + .1)]))), None)
    if piece is None:
        return 0.0
    # half-width at several heights, keep the smallest
    hw = []
    for y in np.linspace(y0 + 0.2, y1 - 0.2, 7):
        seg = piece.intersection(box(-x_limit, y - 0.05, x_limit, y + 0.05))
        if seg.is_empty:
            return 0.0
        minx, _, maxx, _ = seg.bounds
        if minx > -0.5 or maxx < 0.5:
            return 0.0
        hw.append(min(-minx, maxx))
    return 2.0 * min(hw)


LABEL_HEIGHT = 2.4 + 0.5 + 2.0          # the two lines and the gap between them


def _label_rows(params, width):
    """The two text rows scaled to fit `width` (mm): [(shapely geometry, text)] laid out as a block
    centred on the origin, name on top. Shorter name forms first; the last resort is a squeeze."""
    lines = params.get("engrave_text")
    ttype = tray_type(params)
    texts = [t.strip().upper() for t in str(lines).split("|") if t.strip()][:2] if lines else None
    name_opts = name_variants(params.get("patient_first"), params.get("patient_last"))
    rows = [(2.4, name_opts if texts is None else [texts[0]]), (2.0, [ttype] if texts is None or len(texts) < 2 else [texts[1]])]
    out, y_top = [], LABEL_HEIGHT / 2.0
    for cap, options in rows:
        chosen = None
        for txt in options:
            g = text_geometry(txt, cap)
            minx, miny, maxx, maxy = g.bounds
            sx = min(1.0, width / (maxx - minx))
            if sx >= 0.78:
                chosen = (txt, g, sx); break
        if chosen is None:          # even the shortest option is too long: squeeze the last one
            txt = options[-1]; g = text_geometry(txt, cap); minx, _, maxx, _ = g.bounds
            chosen = (txt, g, max(0.6, width / (maxx - minx)))
        txt, g, sx = chosen
        g = affinity.scale(g, xfact=sx, yfact=1.0, origin=(0, 0))
        minx, miny, maxx, maxy = g.bounds
        g = affinity.translate(g, xoff=-(minx + maxx) / 2.0, yoff=(y_top - cap) - miny)
        y_top = y_top - cap - 0.5
        out.append((g, txt))
    return out


def engrave_model(model, params, outline=None, depth=0.4, log=print):
    """Return (model, info): the name + type engraved into the base plate, on the flat strip inside the
    arch, scaled to the room there. info: {placed, label (where it went), error (why it was skipped)}."""
    from .solid import to_manifold, from_manifold
    try:
        width = free_width(outline, BAND_Y0, BAND_Y1) - 1.0
        if width < 8.0:
            log(f"engraving skipped: only {width:.1f} mm free inside the arch")
            return model, dict(placed=None, label=None, error=f"only {width:.1f} mm free inside the arch")
        rows = _label_rows(params, width)
        solids, placed = [], []
        wmax = 0.0
        for g, txt in rows:
            g = affinity.translate(g, xoff=0.0, yoff=BAND_Y1 - LABEL_HEIGHT / 2.0)
            minx, _, maxx, _ = g.bounds; wmax = max(wmax, maxx - minx)
            placed.append(txt)
            polys = list(g.geoms) if hasattr(g, "geoms") else [g]
            for p in polys:
                if p.is_empty or p.area < 1e-3:
                    continue
                m = trimesh.creation.extrude_polygon(p, height=depth + 0.4)
                m.apply_translation([0, 0, PLATE_Z - depth])
                solids.append(m)
        if not solids:
            return model, None
        letters = trimesh.util.concatenate(solids)
        mm, ml = to_manifold(model), to_manifold(letters)
        if mm is None or ml is None:
            log("engraving skipped: mesh not manifold")
            return model, dict(placed=None, label=None, error="mesh not manifold")
        out = from_manifold(mm - ml, drop_zero_volume=False)
        log(f"engraved: {' / '.join(placed)}")
        return out, dict(placed=placed, label=dict(x=0.0, y=BAND_Y1 - LABEL_HEIGHT / 2.0, angle_deg=0.0, width=round(wmax, 1), z=PLATE_Z, auto=True))
    except Exception as ex:  # noqa
        log(f"engraving skipped: {ex}")
        return model, dict(placed=None, label=None, error=str(ex))


def mark_text(params, mode="initials"):
    """The mark's words: 'initials' -> "SP W", 'last' -> "POSADA W", 'full' -> "SERGIO POSADA"."""
    first, last = (params.get("patient_first") or "").strip(), (params.get("patient_last") or "").strip()
    ttype = tray_type(params)
    letter = {"WHITENING": "W", "RETAINER": "R", "MOUTHGUARD": "G"}.get(ttype, "M")
    if mode == "full" and (first or last):
        return f"{first} {last}".strip().upper()
    if mode == "last" and last:
        return f"{last} {letter}".upper()
    initials = ((first[:1] + last[:1]) or "NL").upper()
    return initials + " " + letter


def auto_mark_anchor(mesh_f, labels, info, log=print):
    """Where the automatic mark goes: the middle of the buccal surface of a first molar (right side
    first; a second premolar or second molar when there is none). Returns (point, side) or None."""
    V = mesh_f.vertices
    N = mesh_f.vertex_normals
    centre = V[labels > 0][:, :2].mean(0)
    choice = None
    for pos in (6, 5, 7):
        for side in (1, -1):
            cand = [t for t, (sd, ps) in info.items() if sd == side and ps == pos]
            if cand:
                choice = (cand[0], side); break
        if choice:
            break
    if choice is None:
        log("tooth mark skipped: no molar found")
        return None
    tid, side = choice
    m = labels == tid
    out = V[m][:, :2] - centre
    out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-6)
    n_out = (N[m][:, :2] * out).sum(1)
    zt = V[m][:, 2]
    z_lo, z_hi = np.percentile(zt, 8), np.percentile(zt, 92)
    buccal = (n_out > 0.75) & (zt > z_lo + 0.35 * (z_hi - z_lo)) & (zt < z_lo + 0.7 * (z_hi - z_lo))
    if buccal.sum() < 40:
        buccal = (n_out > 0.6) & (zt > z_lo + 0.3 * (z_hi - z_lo)) & (zt < z_lo + 0.75 * (z_hi - z_lo))
    if buccal.sum() < 40:
        log("tooth mark skipped: buccal surface not found")
        return None
    P = V[m][buccal]; PN = N[m][buccal]
    p0 = P.mean(0)
    # the anchor must be a point ON the surface (the mean of a curved patch sits inside the tooth)
    from scipy.spatial import cKDTree
    _, j = cKDTree(P).query(p0)
    # how much of this tooth's cheek there is along the arch: the mark must not run onto the embrasures
    n0 = PN.mean(0); n0[2] = 0; n0 /= max(np.linalg.norm(n0), 1e-6)
    tang = np.cross([0, 0, 1.0], n0); tang /= max(np.linalg.norm(tang), 1e-6)
    extent = float(((P - p0) @ tang).max() - ((P - p0) @ tang).min())
    return np.asarray(P[j], float), int(side), int(tid), int(info[tid][1]), extent


def emboss_at(model, surface, point, text, angle_deg=0.0, cap=2.4, raised=True, height=0.35, depth_in=1.5, fit_extent=None, min_cap=1.4, log=print):
    """`text` laid on the surface of `surface` (a mesh in the same frame as `model`) round `point`:
    each letter on its own local tangent plane, so the curve of the crown does not change its height,
    reading left to right for someone looking at that spot from outside; `angle_deg` turns the line
    within the surface. Raised (`height` mm proud, the way aligner makers mark their trays: forms into
    the tray, legible on it) or cut in. Returns (model, info) - info None when nothing was made;
    info: text, anchor (on the surface), normal, right, up, cap, width_mm, angle_deg, raised."""
    from .solid import to_manifold, from_manifold
    from scipy.spatial import cKDTree
    try:
        V = np.asarray(surface.vertices); N = np.asarray(surface.vertex_normals)
        point = np.asarray(point, float)
        tree = cKDTree(V)
        d0, j0 = tree.query(point)
        if d0 > 3.0:
            log(f"mark skipped: the chosen spot is {d0:.1f} mm off the model")
            return model, None
        p_anchor = V[j0]
        # the patch round the anchor: the surface facing the same way (within ~60 deg), a text-width round
        reach = max(6.0, 0.8 * cap * max(len(text), 3))
        idx = tree.query_ball_point(p_anchor, reach)
        idx = np.asarray(idx, dtype=int)
        n_ref = N[j0] / max(np.linalg.norm(N[j0]), 1e-6)
        n_loc = N[idx]; n_loc = n_loc / np.maximum(np.linalg.norm(n_loc, axis=1, keepdims=True), 1e-6)
        face_same = (n_loc @ n_ref) > 0.5
        P, PN = V[idx][face_same], n_loc[face_same]
        if len(P) < 30:
            log("mark skipped: too little surface facing the same way round the spot")
            return model, None
        n0 = PN.mean(0); n0 /= max(np.linalg.norm(n0), 1e-6)
        # reading frame: 'up' is up on the model (towards the crowns on an upper too: the mark is read with
        # the model standing on its base), 'right' is the viewer's right looking at the spot from outside
        up = np.array([0, 0, 1.0]) - n0 * n0[2]
        if np.linalg.norm(up) < 0.3:                      # a flat occlusal spot: read front-to-back
            up = np.array([0, -1.0, 0]) - n0 * (-n0[1])
        up /= max(np.linalg.norm(up), 1e-6)
        right = np.cross(up, n0); right /= max(np.linalg.norm(right), 1e-6)
        if abs(angle_deg) > 1e-6:                          # turn the line within the surface
            a = np.deg2rad(angle_deg); c, s_ = np.cos(a), np.sin(a)
            right, up = c * right + s_ * up, -s_ * right + c * up
        def layout(cap):
            ws = []
            for ch in text:
                if ch == " ":
                    ws.append((ch, None, 0.4 * cap)); continue
                g = text_geometry(ch, cap)
                minx, miny, maxx, maxy = g.bounds
                ws.append((ch, g, (maxx - minx) + 0.22 * cap))
            return ws, sum(w for _, _, w in ws)
        widths, total = layout(cap)
        # the text must not run off the patch (on a tooth: the flat middle of the buccal surface; on the
        # side wall: the end of the model) - it stays centred on the spot, so the room is twice the
        # shorter side
        along = (P - p_anchor) @ right
        extent = fit_extent if fit_extent is not None else 2.0 * float(min(-along.min(), along.max()))
        if total > 0.85 * extent:
            cap = max(min_cap, cap * 0.85 * extent / total)
            widths, total = layout(cap)
        x_cursor = -total / 2.0
        ptree = cKDTree(P)
        solids, dropped = [], 0
        for ch, g, w in widths:
            if g is None:
                x_cursor += w; continue
            minx, miny, maxx, maxy = g.bounds
            cx = x_cursor + (maxx - minx) / 2.0
            x_cursor += w
            target = p_anchor + right * cx
            dj, j = ptree.query(target)
            if dj > 1.2 * cap:                             # no surface there (past the end of the wall): no floating letter
                dropped += 1; continue
            p = P[j]; n = PN[j].copy(); n /= max(np.linalg.norm(n), 1e-6)
            u = up - n * np.dot(up, n); u /= max(np.linalg.norm(u), 1e-6)
            r = np.cross(u, n); r /= max(np.linalg.norm(r), 1e-6)
            if np.dot(r, right) < 0:
                r = -r
            g2 = affinity.translate(g, xoff=-(minx + maxx) / 2.0, yoff=-(miny + maxy) / 2.0)
            polys = list(g2.geoms) if hasattr(g2, "geoms") else [g2]
            for poly in polys:
                if poly.is_empty or poly.area < 1e-3:
                    continue
                if raised:
                    prism = trimesh.creation.extrude_polygon(poly, height=depth_in + height)   # local z: 0..depth
                    base_off = depth_in
                else:
                    prism = trimesh.creation.extrude_polygon(poly, height=0.4 + 0.6)           # 0.4 in, 0.6 out
                    base_off = 0.4
                T = np.eye(4)
                T[:3, 0] = r; T[:3, 1] = u; T[:3, 2] = n
                T[:3, 3] = p - n * base_off
                prism.apply_transform(T)
                solids.append(prism)
        if not solids:
            return model, None
        if dropped:
            log(f"mark: {dropped} letter{'s' if dropped > 1 else ''} left out - the surface ends there (move the mark or make it smaller)")
        letters = trimesh.util.concatenate(solids)
        mm, ml = to_manifold(model), to_manifold(letters)
        if mm is None or ml is None:
            log("mark skipped: mesh not manifold")
            return model, None
        out_m = from_manifold((mm + ml) if raised else (mm - ml), drop_zero_volume=False)
        info = dict(dropped=dropped, text=text, anchor=np.round(p_anchor, 3).tolist(), normal=np.round(n0, 4).tolist(), right=np.round(right, 4).tolist(), up=np.round(up, 4).tolist(),
                    cap=round(float(cap), 2), width_mm=round(float(total), 2), angle_deg=round(float(angle_deg), 1), raised=bool(raised))
        # the letters on their own, for the page to show in colour: the part standing proud when raised,
        # the part sunk into the model when cut in (not saved in the report - the caller writes it to a file)
        try:
            vis = (ml - mm) if raised else (ml ^ mm)
            info["_letters"] = from_manifold(vis, drop_zero_volume=False) if vis.status() == m3.Error.NoError else letters
        except Exception:  # noqa
            info["_letters"] = letters
        return out_m, info
    except Exception as ex:  # noqa
        log(f"mark skipped: {ex}")
        return model, None


def emboss_on_tooth(model, mesh_f, labels, info, params, height=0.35, cap=2.4, depth_in=1.5, log=print):
    """The automatic mark: initials + tray letter raised on the buccal of a first molar (right side if
    present) - see auto_mark_anchor / emboss_at. Returns (model, mark info or None). Never fails the case."""
    try:
        where = auto_mark_anchor(mesh_f, labels, info, log=log)
        if where is None:
            return model, None
        point, side, tid, pos, extent = where
        text = mark_text(params, "initials")
        out, minfo = emboss_at(model, model, point, text, angle_deg=0.0, cap=cap, raised=True, height=height, depth_in=depth_in,
                               fit_extent=0.72 / 0.85 * extent, min_cap=1.6, log=log)      # the text within 72 % of the cheek, letters 1.6 mm at least, as before
        if minfo:
            minfo.update(auto=True, tooth=tid, side=side, position=pos)
            log(f"tooth mark: '{text}' raised {height} mm on the buccal of tooth {tid} (side {side:+d}, position {pos})")
        return out, minfo
    except Exception as ex:  # noqa
        log(f"tooth mark skipped: {ex}")
        return model, None
