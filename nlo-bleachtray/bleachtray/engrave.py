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


def engrave_model(model, params, outline=None, depth=0.4, log=print):
    """Return the model with the name + type engraved into the base plate inside the arch."""
    from .solid import to_manifold, from_manifold
    try:
        lines = params.get("engrave_text")
        ttype = tray_type(params)
        width = free_width(outline, BAND_Y0, BAND_Y1) - 1.0
        if width < 8.0:
            log(f"engraving skipped: only {width:.1f} mm free inside the arch")
            return model, None
        solids, placed = [], []
        specs = []
        if lines:
            texts = [t.strip().upper() for t in str(lines).split("|") if t.strip()][:2]
        else:
            texts = None
        name_opts = name_variants(params.get("patient_first"), params.get("patient_last"))
        rows = [(2.4, name_opts if texts is None else [texts[0]]), (2.0, [ttype] if texts is None or len(texts) < 2 else [texts[1]])]
        y_top = BAND_Y1
        for cap, options in rows:
            chosen = None
            for txt in options:
                g = text_geometry(txt, cap)
                minx, miny, maxx, maxy = g.bounds
                w = maxx - minx
                sx = min(1.0, width / w)
                if sx >= 0.78:
                    chosen = (txt, g, sx, minx); break
            if chosen is None:          # even the shortest option is too long: squeeze the last one
                txt = options[-1]; g = text_geometry(txt, cap); minx, _, maxx, _ = g.bounds
                chosen = (txt, g, max(0.6, width / (maxx - minx)), minx)
            txt, g, sx, minx = chosen
            g = affinity.scale(g, xfact=sx, yfact=1.0, origin=(0, 0))
            minx, miny, maxx, maxy = g.bounds
            g = affinity.translate(g, xoff=-(minx + maxx) / 2.0, yoff=(y_top - cap) - miny)
            y_top = y_top - cap - 0.5
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
            return model, None
        out = from_manifold(mm - ml, drop_zero_volume=False)
        log(f"engraved: {' / '.join(placed)}")
        return out, placed
    except Exception as ex:  # noqa
        log(f"engraving skipped: {ex}")
        return model, None


def emboss_on_tooth(model, mesh_f, labels, info, params, height=0.35, cap=2.4, depth_in=1.5, log=print):
    """Raised initials + tray letter on the buccal surface of a first molar (right side if present),
    so the mark forms into the tray itself: a recess on the inside that touches nothing, legible
    letters on the outside (the way aligner makers mark their trays). Letters are placed one by one
    on the local tangent plane of the tooth, so the curve of the crown does not change their height.
    Returns (model, text or None). Never fails the case."""
    from .solid import to_manifold, from_manifold
    try:
        first, last = (params.get("patient_first") or "").strip(), (params.get("patient_last") or "").strip()
        initials = ((first[:1] + last[:1]) or "NL").upper()
        ttype = tray_type(params)
        letter = {"WHITENING": "W", "RETAINER": "R"}.get(ttype, "M")
        text = initials + " " + letter
        V = mesh_f.vertices
        N = mesh_f.vertex_normals
        centre = V[labels > 0][:, :2].mean(0)
        # the tooth: first molar (position 6), else second premolar / second molar; right side first
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
            return model, None
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
            return model, None
        P = V[m][buccal]; PN = N[m][buccal]
        p0 = P.mean(0)
        # reading direction for someone looking at that cheek from outside: along the arch, anterior
        # first on the right side (viewer's left is anterior there) - i.e. towards -y on the right
        along = np.array([0.0, -1.0, 0.0]) if side > 0 else np.array([0.0, 1.0, 0.0])
        # local arch tangent at the tooth (perpendicular to the mean outward normal, horizontal)
        n0 = PN.mean(0); n0[2] = 0; n0 /= max(np.linalg.norm(n0), 1e-6)
        tang = np.cross([0, 0, 1.0], n0); tang /= max(np.linalg.norm(tang), 1e-6)
        if np.dot(tang, along) < 0:
            tang = -tang
        # glyphs laid along the tangent, each on its own tangent plane; the text is shrunk to fit
        # the flat middle of the buccal surface (the mark must not run onto the embrasures)
        extent = float(((P - p0) @ tang).max() - ((P - p0) @ tang).min())
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
        if total > 0.72 * extent:
            cap = max(1.6, cap * 0.72 * extent / total)
            widths, total = layout(cap)
        x_cursor = -total / 2.0
        from scipy.spatial import cKDTree
        tree = cKDTree(P)
        solids = []
        for ch, g, w in widths:
            if g is None:
                x_cursor += w; continue
            minx, miny, maxx, maxy = g.bounds
            cx = x_cursor + (maxx - minx) / 2.0
            x_cursor += w
            target = p0 + tang * cx
            _, j = tree.query(target)
            p = P[j]; n = PN[j].copy(); n /= max(np.linalg.norm(n), 1e-6)
            up = np.array([0, 0, 1.0]) - n * n[2]; up /= max(np.linalg.norm(up), 1e-6)
            right = np.cross(up, n); right /= max(np.linalg.norm(right), 1e-6)
            if np.dot(right, tang) < 0:
                right = -right
            g2 = affinity.translate(g, xoff=-(minx + maxx) / 2.0, yoff=-(miny + maxy) / 2.0)
            polys = list(g2.geoms) if hasattr(g2, "geoms") else [g2]
            for poly in polys:
                if poly.is_empty or poly.area < 1e-3:
                    continue
                prism = trimesh.creation.extrude_polygon(poly, height=depth_in + height)   # local z: 0..depth
                T = np.eye(4)
                T[:3, 0] = right; T[:3, 1] = up; T[:3, 2] = n
                T[:3, 3] = p - n * depth_in
                prism.apply_transform(T)
                solids.append(prism)
        if not solids:
            return model, None
        letters = trimesh.util.concatenate(solids)
        mm, ml = to_manifold(model), to_manifold(letters)
        if mm is None or ml is None:
            log("tooth mark skipped: mesh not manifold")
            return model, None
        out_m = from_manifold(mm + ml, drop_zero_volume=False)
        log(f"tooth mark: '{text}' raised {height} mm on the buccal of tooth {tid} (side {side:+d}, position {info[tid][1]})")
        return out_m, text
    except Exception as ex:  # noqa
        log(f"tooth mark skipped: {ex}")
        return model, None
