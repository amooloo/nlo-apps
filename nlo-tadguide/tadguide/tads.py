"""TAD sites: placing a screw from one click, checking it against the CBCT, and finding good sites by itself.

A TAD here is: head (where it meets the gum, on the scan surface), direction (unit, into bone), threaded length,
diameter and collar (the smooth transmucosal part). Checks along it, from Dr. A's TAD course notes:
    root clearance       < 0.5 mm stop, < 1.0 caution, 1.2-1.6 mm is what the literature calls safe
    cortical thickness   < 0.5 mm do not insert; 0.5-1.5 no pre-drill; 1.5-2.5 perforate the cortex;
                         > 2.5 perforate + pilot ~3 mm
    soft tissue          > 3 mm: it is fine not to seat the collar all the way
    bone along the thread, sinus / nasal floor (bicortical is the goal on the palate), lower buccal distal to the
    5s (his rule: no TADs at L5/6 or L6/7)
"Root" here is image evidence, not a diagnosis: dense tissue (dentin-level) deeper than the cortical plate. The
cross-sections in the app are what to trust.
"""
import numpy as np
from scipy import ndimage as ndi

from . import volume as V

# The TADs NLO uses (Dr. A, 10/20/2026): Dentaurum tomas-pins, and the Korean MSE TADs Great Lakes sells (BioMaterials
# Korea, for the MSE Type-2). Thread diameter d, thread length l and gingival collar c in mm, as the makers give them:
#   tomas-pin SD / EP (instructions 989-534-00): thread 1.6 mm, 6 / 8 / 10 mm, collar 2.0 mm high (2.8 mm wide);
#     head 2.3 mm wide - SD with the cross slot (0.56 mm / .022), EP the mushroom head for the palate; driven by a
#     2.5 mm hexagon. Pilot drill (1.1 mm, 4 mm deep) only where the cortex is 2 mm or more.
#   MSE Type-2 TAD (Great Lakes 281-004): 1.8 x 11 and 1.8 x 13 mm (BMK also makes 1.8 x 9). The collar is not
#     published: 2.0 mm is assumed - change it on the TAD card if it differs.
_KIT_ROWS = [
    ("tomas-sd-06", "tomas-pin SD 06", "tomas-pin SD (Dentaurum)", 1.6, 6.0, 2.0),
    ("tomas-sd-08", "tomas-pin SD 08", "tomas-pin SD (Dentaurum)", 1.6, 8.0, 2.0),
    ("tomas-sd-10", "tomas-pin SD 10", "tomas-pin SD (Dentaurum)", 1.6, 10.0, 2.0),
    ("tomas-ep-06", "tomas-pin EP 06", "tomas-pin EP, palatal (Dentaurum)", 1.6, 6.0, 2.0),
    ("tomas-ep-08", "tomas-pin EP 08", "tomas-pin EP, palatal (Dentaurum)", 1.6, 8.0, 2.0),
    ("tomas-ep-10", "tomas-pin EP 10", "tomas-pin EP, palatal (Dentaurum)", 1.6, 10.0, 2.0),
    ("mse-09", "MSE TAD 1.8 x 9", "MSE Type-2 TAD (Great Lakes, Korea)", 1.8, 9.0, 2.0),
    ("mse-11", "MSE TAD 1.8 x 11", "MSE Type-2 TAD (Great Lakes, Korea)", 1.8, 11.0, 2.0),
    ("mse-13", "MSE TAD 1.8 x 13", "MSE Type-2 TAD (Great Lakes, Korea)", 1.8, 13.0, 2.0),
]
KIT = [dict(id=i, name=n, group=g, d=d, l=l, c=c, short=n.replace('tomas-pin ', '').replace('MSE TAD 1.8 x ', 'MSE 1.8×')) for i, n, g, d, l, c in _KIT_ROWS]
KIT_BY_ID = {k["id"]: k for k in KIT}

SITES = {
    # site: label, arches, default apical depth of the entry (mm from the occlusal plane), tilt toward apical (deg),
    #       size (diameter, thread length, collar) and the kit product it is, the gaps (contacts) it goes between
    "buccal":  dict(label="Buccal, between roots", arches=("upper", "lower"), a={"upper": 13.0, "lower": 12.0},
                    alpha={"upper": 25.0, "lower": 15.0}, size={"upper": (1.6, 8.0, 2.0), "lower": (1.6, 8.0, 2.0)},
                    product={"upper": "tomas-sd-08", "lower": "tomas-sd-08"}, gaps={"upper": (2, 3, 4, 5, 6), "lower": (3, 4)}),
    "palatal": dict(label="Palatal, between roots", arches=("upper",), a={"upper": 9.0}, alpha={"upper": 30.0},
                    size={"upper": (1.6, 10.0, 2.0)}, product={"upper": "tomas-ep-10"}, gaps={"upper": (5, 6)}),
    "izc":     dict(label="Infrazygomatic crest", arches=("upper",), a={"upper": 14.0}, alpha={"upper": 65.0},
                    size={"upper": (2.0, 12.0, 3.0)}, product={}, gaps={"upper": (6,)}),
    "shelf":   dict(label="Buccal shelf", arches=("lower",), a={"lower": 9.0}, alpha={"lower": 75.0},
                    size={"lower": (2.0, 10.0, 2.0)}, product={}, gaps={"lower": (6,)}),
    "palate":  dict(label="Palate (paramedian)", arches=("upper",), a={"upper": 0.0}, alpha={"upper": 0.0},
                    size={"upper": (1.8, 11.0, 2.0)}, product={"upper": "mse-11"}, gaps={"upper": (4,)}),
}

# other sizes (not in the kit) - for the infrazygomatic crest and the buccal shelf, which want longer, thicker screws
SIZES = [(1.4, 6), (1.4, 8), (1.5, 11), (1.5, 13), (1.6, 12), (1.8, 8), (1.8, 10), (2.0, 8), (2.0, 10), (2.0, 12), (2.0, 14)]


def product_for(d, l, prefer=None):
    """The kit product with this thread diameter and length - the preferred one when it fits (tomas SD and EP have
    the same sizes) - or None for a size that is not in the kit."""
    fits = lambda k: abs(k["d"] - float(d)) < 1e-6 and abs(k["l"] - float(l)) < 1e-6
    if prefer in KIT_BY_ID and fits(KIT_BY_ID[prefer]):
        return prefer
    return next((k["id"] for k in KIT if fits(k)), None)


def product_name(t):
    k = KIT_BY_ID.get(t.get("product") or "")
    return k["name"] if k else f"{t.get('diameter')} x {t.get('length')} mm"


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) + 1e-12)


class Context:
    """Per case: the volume and levels, the matched scan (mm), the arch, a ray caster on the scan."""

    def __init__(self, vol, levels, P, F, N, arch_obj, teeth=None):
        self.vol, self.lv, self.P, self.F, self.N, self.arch = vol, levels, P, F, N, arch_obj
        self.teeth = teeth
        self._ray = None
        self._roi = {}

    # -- rays against the scan
    def ray(self, origins, dirs):
        """First hit of each ray on the scan surface: (points (n,3) NaN where none, hit face normals)."""
        import trimesh
        if self._ray is None:
            m = trimesh.Trimesh(self.P, self.F, process=False)
            try:
                from trimesh.ray.ray_triangle import RayMeshIntersector
                self._ray = RayMeshIntersector(m)
            except Exception:
                self._ray = m.ray
            self._mesh = m
        origins = np.atleast_2d(origins).astype(float)
        dirs = np.atleast_2d(dirs).astype(float)
        locs, ray_idx, tri_idx = self._ray.intersects_location(origins, dirs, multiple_hits=True)
        out = np.full((len(origins), 3), np.nan)
        nrm = np.full((len(origins), 3), np.nan)
        if len(locs):
            d = np.einsum("ij,ij->i", locs - origins[ray_idx], dirs[ray_idx])
            order = np.lexsort((d, ray_idx))
            seen = set()
            fn = self._mesh.face_normals
            for k in order:
                r = ray_idx[k]
                if r in seen or d[k] < 0:
                    continue
                seen.add(r)
                out[r] = locs[k]
                nrm[r] = fn[tri_idx[k]]
        return out, nrm

    # -- arch-frame entry points
    def entries(self, site, s_list, a_list, allow_estimate=True):
        """Where a site's screw meets the gum, for arc lengths s and apical depths a (one ray each, batched).
        The scan is the gum surface where it reaches; a hit on the wrong side of the arch (the ray passed over
        the scan's edge and met the far side) is thrown out. Where the scan ends - the vestibule above a
        buccal site, a palate scanned only in part - the gum is estimated from the CBCT: the bone surface
        along the same ray plus the soft-tissue thickness measured where the scan does reach (2 mm when it
        never does); the TAD then carries entry='estimated' and the plan says so."""
        A = self.arch
        O, D, P, B = [], [], [], []
        for s, a in zip(s_list, a_list):
            p, tan, buc = A.at(s)
            down = -A.n
            if site in ("buccal", "izc", "shelf"):
                O.append(p + buc * 25.0 + down * a); D.append(-buc)
            else:                                           # palatal: from inside the arch outward
                O.append(p - buc * 13.0 + down * a); D.append(buc)
            P.append(p); B.append(buc)
        O, D, P, B = (np.array(x) for x in (O, D, P, B))
        hit, _n = self.ray(O, D)
        self._entry_est = getattr(self, "_entry_est", {})
        for k in range(len(hit)):
            if not np.isfinite(hit[k, 0]):
                continue
            proj = float(np.dot(hit[k] - P[k], B[k]))
            good = (0.0 < proj < 14.0) if site in ("buccal", "izc", "shelf") else (-14.0 < proj < 0.0)
            if not good:
                hit[k] = np.nan
        if allow_estimate:
            for k in range(len(hit)):
                if np.isfinite(hit[k, 0]):
                    continue
                est = self._gum_from_cbct(O[k], D[k], P[k], B[k], site)
                if est is not None:
                    hit[k] = est
                    self._entry_est[tuple(np.round(est, 2))] = True
        return hit

    def _soft_thickness_default(self, site):
        """Soft-tissue thickness measured at the scanned entries of this site so far (median), else 2 mm."""
        v = getattr(self, "_soft_seen", {}).get(site) or []
        return float(np.median(v)) if len(v) >= 2 else 2.0

    def _gum_from_cbct(self, o, d, p, buc, site):
        """The gum along a ray from the CBCT alone: the first bone along it (within 14 mm of the arch point
        on the right side), backed off by the usual soft-tissue thickness of this site."""
        t = np.arange(0.0, 40.0, 0.25)
        pts = o + t[:, None] * d
        I = ndi.gaussian_filter1d(V.sample(self.vol, pts).astype(np.float32), 2)
        proj = (pts - p) @ buc
        side_ok = (proj > 0) & (proj < 14.0) if site in ("buccal", "izc", "shelf") else (proj < 0) & (proj > -14.0)
        bone = (I >= self.lv["soft"] + 0.5 * (self.lv["bone"] - self.lv["soft"])) & side_ok
        if not bone.any():
            return None
        k = int(np.argmax(bone))
        return pts[k] - d * self._soft_thickness_default(site)

    def entry_is_estimated(self, H):
        return tuple(np.round(np.asarray(H, float), 2)) in getattr(self, "_entry_est", {})

    def entry(self, site, side, s, a):
        h = self.entries(site, [s], [a])[0]
        return h if np.isfinite(h[0]) else None

    # -- the midpalatal suture
    def palate_suture(self):
        """The midpalatal suture as a line in the arch plane, u = u0 + k (w - w0), found in the CBCT rather than
        taken from the dental midline (the teeth can stand off-centre by a few mm). Coronal cuts through the hard
        palate from behind the canines to the first molars; in each, the axis of mirror symmetry of the palatal
        bone, moved to the nasal crest (the ridge where the septum stands on the nasal floor) when one stands out
        within 4 mm of it; then a straight line through those points, outliers dropped. Cached. Only for the
        upper arch; the result has ok=False when the palate is not in the volume or the points do not line up."""
        if getattr(self, "_suture", None) is not None:
            return self._suture
        A = self.arch
        out = dict(ok=False, u0=0.0, k=0.0, w0=0.0, n=0, rms=None, pts=[])
        if A.arch != "upper":
            self._suture = out
            return out
        try:
            w34, w45 = self.palate_levels()
            ws = np.arange(w45 - 16.0, w34 + 2.01, 1.0)
            du = 0.3
            us = np.arange(-16.0, 16.0 + 1e-6, du)
            hs = np.arange(-1.0, -32.0 - 1e-6, -du)             # up from the occlusal plane into the vault
            bone_in = self.lv["soft"] + 0.5 * (self.lv["bone"] - self.lv["soft"])
            pts = []
            for w in ws:
                U, Hh = np.meshgrid(us, hs, indexing="ij")
                P = A.from_plane(U.ravel()[:, None], w, Hh.ravel()[:, None])
                I = V.sample(self.vol, P).reshape(len(us), len(hs))
                B = ndi.gaussian_filter(I.astype(np.float32), 1.0) >= bone_in
                # the palatal plate per column: the first bone run going up (>= 0.9 mm thick), its top side
                top = np.full(len(us), np.nan)
                band = np.zeros_like(B)
                for i in range(len(us)):
                    col = B[i]
                    j = 0
                    while j < len(col):
                        if col[j]:
                            k = j
                            while k < len(col) and (col[k] or (k + 2 < len(col) and col[k + 1] and col[k + 2])):
                                k += 1
                            if (k - j) * du >= 0.9:
                                top[i] = hs[min(k, len(hs) - 1)]
                                band[i, j:min(k, j + int(12 / du))] = True
                                break
                            j = k
                        j += 1
                mid = np.abs(us) <= 10.0
                if band[mid].sum() * du * du < 20.0:
                    continue
                # mirror symmetry of the plate within +-9 mm of each candidate axis
                best, bu = -1.0, None
                xs = np.arange(du, 9.0 + 1e-6, du)
                for u0 in np.arange(-5.0, 5.0 + 1e-6, du):
                    ip = np.round((u0 + xs - us[0]) / du).astype(int)
                    im = np.round((u0 - xs - us[0]) / du).astype(int)
                    ok = (ip >= 0) & (ip < len(us)) & (im >= 0) & (im < len(us))
                    if ok.sum() < 10:
                        continue
                    a, b = band[ip[ok]], band[im[ok]]
                    sc = float((a & b).sum()) / max(float((a | b).sum()), 1.0)
                    if sc > best:
                        best, bu = sc, float(u0)
                if bu is None or best < 0.55:
                    continue
                u_s = bu
                # the nasal crest: the plate's top rising sharply within 4 mm of the symmetry axis
                sel = np.abs(us - bu) <= 4.0
                if np.isfinite(top[sel]).sum() >= 8:
                    t_sel = top[sel]
                    ref = np.nanmedian(top[np.abs(us - bu) <= 8.0])
                    j = int(np.nanargmin(t_sel))                 # most superior (h most negative)
                    if ref - t_sel[j] >= 1.5:
                        u_s = float(us[sel][j])
                pts.append((float(w), u_s, best))
            if len(pts) >= 5:
                Pw = np.array(pts)
                w0 = float(np.mean(Pw[:, 0]))
                keep = np.ones(len(Pw), bool)
                for _ in range(3):
                    k, u0 = np.polyfit(Pw[keep, 0] - w0, Pw[keep, 1], 1)
                    res = Pw[:, 1] - (u0 + k * (Pw[:, 0] - w0))
                    new = np.abs(res) <= 1.5
                    if new.sum() < 5 or (new == keep).all():
                        break
                    keep = new
                rms = float(np.sqrt(np.mean(res[keep] ** 2)))
                out = dict(ok=bool(keep.sum() >= 5 and rms <= 1.0 and abs(np.degrees(np.arctan(k))) <= 8.0), u0=float(u0), k=float(k), w0=w0,
                           n=int(keep.sum()), rms=round(rms, 2), angle_deg=round(float(np.degrees(np.arctan(k))), 1),
                           pts=[(round(a, 1), round(b, 2)) for a, b, _c in pts])
        except Exception:
            pass
        self._suture = out
        return out

    def suture_u(self, w):
        """Raw plane coordinate u of the suture at anterior coordinate w (0 when the suture was not found)."""
        S = self.palate_suture()
        return S["u0"] + S["k"] * (float(w) - S["w0"]) if S["ok"] else 0.0

    def pal_from_point(self, p):
        """(u, w) of a point in the palate frame: u is the lateral distance from the suture (+ patient left)."""
        q = self.arch.to_plane(np.asarray(p, float))
        return float(q[0]) - self.suture_u(q[1]), float(q[1])

    def suture_plane(self):
        """(point, unit normal) of the vertical plane through the suture line, or None."""
        S = self.palate_suture()
        if not S["ok"]:
            return None
        A = self.arch
        p0 = A.from_plane(S["u0"], S["w0"], -10.0)
        along = unit(A.A + S["k"] * A.L)                        # du/dw = k
        return p0, unit(np.cross(along, A.n))

    def palate_entry(self, u, w):
        """Palate site at palate coordinates (lateral u from the suture, anterior w): a ray from the occlusal
        side up into the vault."""
        A = self.arch
        o = A.from_plane(u + self.suture_u(w), w, 6.0)
        hit, nrm = self.ray(o, -A.n)
        if np.isfinite(hit[0, 0]) and 0.0 < float(np.dot(hit[0] - o, -A.n)) < 30.0:
            n = nrm[0] if np.dot(nrm[0], A.n) > 0 else -nrm[0]     # facing the mouth
            return hit[0], n
        # the scan does not cover the vault there: the palate from the CBCT - the first bone up the ray (the
        # palatal plate), backed off by the mucosa thickness (3 mm paramedian is typical); flagged as estimated
        t = np.arange(0.0, 30.0, 0.25)
        pts = o + t[:, None] * (-A.n)
        I = ndi.gaussian_filter1d(V.sample(self.vol, pts).astype(np.float32), 2)
        bone = I >= self.lv["soft"] + 0.5 * (self.lv["bone"] - self.lv["soft"])
        if not bone.any():
            return None, None
        H = pts[int(np.argmax(bone))] + A.n * 3.0
        self._entry_est = getattr(self, "_entry_est", {})
        self._entry_est[tuple(np.round(H, 2))] = True
        return H, A.n

    def direction(self, site, s, alpha, beta, surf_n=None):
        A = self.arch
        if site == "palate":
            d = -unit(surf_n) if surf_n is not None else -A.n
            d = unit(np.cos(np.radians(alpha)) * d + np.sin(np.radians(alpha)) * A.L * (1 if s >= 0 else -1))
            return unit(np.cos(np.radians(beta)) * d + np.sin(np.radians(beta)) * A.A)
        _p, tan, buc = A.at(s)
        inward = -buc if site in ("buccal", "izc", "shelf") else buc
        d = np.cos(np.radians(alpha)) * inward + np.sin(np.radians(alpha)) * (-A.n)
        d = np.cos(np.radians(beta)) * unit(d) + np.sin(np.radians(beta)) * tan * (1 if s >= 0 else -1)
        return unit(d)

    # -- the CBCT around a site
    def roi(self, center, half=15.0, step=None):
        """Resampled cube around `center` with the masks the checks need (cached by rounded centre)."""
        key = tuple(np.round(np.asarray(center) / 6.0).astype(int))
        if key in self._roi:
            return self._roi[key]
        step = step or max(0.25, min(self.vol.spacing))
        c = np.round(np.asarray(center) / 6.0) * 6.0
        ax = np.arange(-half, half + 1e-6, step)
        n = len(ax)
        gx, gy, gz = np.meshgrid(ax, ax, ax, indexing="ij")
        pts = np.column_stack([gx.ravel(), gy.ravel(), gz.ravel()]) + c
        I = V.sample(self.vol, pts).reshape(n, n, n).astype(np.float32)
        lv = self.lv
        bone_in = lv["soft"] + 0.5 * (lv["bone"] - lv["soft"])
        bone = I >= bone_in
        bone = ndi.binary_closing(bone, iterations=1)
        depth = ndi.distance_transform_edt(bone, sampling=step)
        metal = I >= lv["metal"]
        if metal.any():
            metal = ndi.binary_dilation(metal, iterations=max(1, int(1.0 / step)))
        # Roots. Dentin is often no brighter than cortical bone in a CBCT, so two kinds of evidence:
        #  - bright: above half way from the bone level to the dense level, deeper than the cortical plate
        #    (depth from the OUTER bone surface, PDL / canals / marrow filled in, so roots are not eroded),
        #    grown back out to the root wall;
        #  - ridge: a local bright ridge (0.35 mm smoothed image minus a 2 mm background) - the root wall around
        #    the darker canal and PDL - also deeper than the cortical plate.
        # A piece counts as root when it reaches a crown of the matched scan (dentin is continuous from crown to
        # apex), or when it is long and thin like a root (>= 5 mm3, longest axis >= 2.5 x the next).
        Is = ndi.gaussian_filter(I, 0.35 / step)
        r1 = max(1, int(round(1.0 / step)))
        envelope = ndi.binary_fill_holes(ndi.binary_closing(bone, iterations=r1))
        depth_out = ndi.distance_transform_edt(envelope, sampling=step)
        # Two kinds of CBCT. On a sharp one (the CS 8200 at 0.15 mm) dentin reads well above cortical bone, and
        # the root is simply what lies at the tooth level, deeper than the cortical plate: a tight mask that stops
        # at the PDL. On a soft or low-dose one dentin is no brighter than the cortex; then the half-way level and
        # the ridge of the root wall are needed, and the mask runs a little fat (lamina dura). Which one: whether
        # enough tooth-level tissue is found under the crowns (the roots of three teeth are > 300 mm3).
        tune = getattr(self, "root_tune", None) or {}
        sharp = tune.get("sharp")
        core_dense = (Is >= lv["dense"]) & ~metal & (depth_out >= 1.5)
        if sharp is None:
            sharp = float(core_dense.sum()) * step ** 3 >= 300.0
        if sharp:
            core = core_dense
            grown = ndi.binary_dilation(core, iterations=max(1, int(round(0.8 / step))), mask=(Is >= lv["dense"]) & ~metal)
            cand = grown
        else:
            root_thr = lv["bone"] + 0.5 * (lv["dense"] - lv["bone"])
            bright = (Is >= root_thr) & ~metal
            core = bright & (depth_out >= 1.5)
            grown = ndi.binary_dilation(core, iterations=max(1, int(round(0.8 / step))), mask=bright)
            ridge = ((Is - ndi.gaussian_filter(I, 2.0 / step)) > 0.08 * (lv["dense"] - lv["soft"])) & (Is >= lv["bone"]) & (depth_out >= 1.5) & ~metal
            cand = grown | ridge
        self.root_sharp = bool(sharp)
        seeds = np.zeros(I.shape, bool)
        if self.teeth is not None and self.teeth.any():
            tp = self.P[self.teeth] - self.N[self.teeth] * 0.8
            f = np.round((tp - c - ax[0]) / step).astype(int)
            ok = np.all((f >= 0) & (f < n), axis=1)
            f = f[ok]
            seeds[f[:, 0], f[:, 1], f[:, 2]] = True
            seeds = ndi.binary_dilation(seeds, iterations=max(1, int(round(2.5 / step))))
        lab, nl = ndi.label(cand)
        rootlike = np.zeros(I.shape, bool)
        if nl:
            idx = np.arange(1, nl + 1)
            sz = ndi.sum(cand, lab, idx) * step ** 3
            touch = ndi.maximum(seeds, lab, idx) if seeds.any() else np.zeros(nl, bool)
            # Roots live in the alveolar process, i.e. near the dental arch. Dense rod-shaped bone far from it -
            # the midpalatal ridge and nasal crest, the mylohyoid ridge, the zygomatic buttress - must not pass as
            # a root on shape alone: beyond 10 mm (in the occlusal plane) from the arch line only a piece that
            # reaches a crown counts.
            com = np.asarray(ndi.center_of_mass(cand, lab, idx), float).reshape(-1, 3)
            _s_, arch_dist = self.arch.s_of(c + ax[0] + com * step)
            near_arch = np.abs(arch_dist) <= 10.0
            keep = np.zeros(nl + 1, bool)
            objs = ndi.find_objects(lab)
            for k in range(nl):
                if touch[k] and sz[k] >= 4.0:
                    keep[k + 1] = True
                    continue
                if sz[k] < 5.0 or not near_arch[k]:
                    continue
                zz = np.argwhere(lab[objs[k]] == k + 1).astype(float)
                if len(zz) > 20000:
                    zz = zz[:: len(zz) // 20000 + 1]
                ev = np.sort(np.linalg.eigvalsh(np.cov(zz.T)))[::-1]
                keep[k + 1] = ev[0] >= 2.5 ** 2 * max(ev[1], 1e-6)      # variance ratio = (length ratio)^2
            rootlike = keep[lab] & cand
        droot = ndi.distance_transform_edt(~rootlike, sampling=step) if rootlike.any() else np.full(I.shape, 99.0, np.float32)
        # inside the bone: the outer envelope of the bone (closed over 2 mm, cavities filled) minus the air
        # spaces - at 0.15 mm the marrow between the trabeculae reads as soft tissue, and a screw that sits in the
        # alveolar process would otherwise count as half out of bone
        r2 = max(1, int(round(2.0 / step)))
        air = I <= lv["air"]
        inside = ndi.binary_fill_holes(ndi.binary_closing(bone, iterations=r2)) & ~ndi.binary_dilation(air, iterations=max(1, int(round(0.5 / step))))
        r = dict(c=c, ax=ax, step=step, I=I, depth=depth.astype(np.float32), droot=droot.astype(np.float32), bone_in=bone_in,
                 root=rootlike, inside=inside.astype(np.float32))
        if len(self._roi) > 12:
            self._roi.clear()
        self._roi[key] = r
        return r

    def _roi_sample(self, roi, field, pts):
        f = (np.asarray(pts) - roi["c"] - roi["ax"][0]) / roi["step"]
        return ndi.map_coordinates(roi[field], [f[:, 0], f[:, 1], f[:, 2]], order=1, mode="nearest")

    # -- one screw
    def measure(self, tad, roi=None):
        """Checks along one TAD. tad: dict(head, dir, length, diameter, collar, site, arch, side)."""
        H = np.asarray(tad["head"], float)
        d = unit(tad["dir"])
        L, D, c = float(tad["length"]), float(tad["diameter"]), float(tad.get("collar", 1.5))
        roi = roi or self.roi(H + d * (c + L) / 2)
        lv = self.lv
        step = 0.15
        t = np.arange(0.0, c + L + 1e-6, step)
        pts = H + t[:, None] * d
        I = self._roi_sample(roi, "I", pts)
        droot = self._roi_sample(roi, "droot", pts)
        # a ring at the screw radius as well: the thread's outer edge
        e1 = unit(np.cross(d, [1, 0, 0] if abs(d[0]) < 0.9 else [0, 1, 0]))
        e2 = np.cross(d, e1)
        ring = []
        for ang in np.linspace(0, 2 * np.pi, 8, endpoint=False):
            off = (np.cos(ang) * e1 + np.sin(ang) * e2) * (D / 2)
            ring.append(self._roi_sample(roi, "droot", pts + off))
        droot_edge = np.min(np.vstack(ring), axis=0)
        bone_in = roi["bone_in"]
        cort = 0.5 * (lv["bone"] + lv["dense"])
        inb = I >= bone_in
        k_bone = int(np.argmax(inb)) if inb.any() else len(t)
        soft = float(t[k_bone]) if k_bone < len(t) else float(c + L)
        # cortical plate: the first run above the cortical level within 3 mm of the bone surface (the edge itself
        # is blurred over ~1 voxel, so the run starts where the level is first reached, not at the surface)
        # Thickness = width at half height of the cortical peak (outer edge: half way from soft tissue to the
        # peak; inner edge: half way from the peak down to the cancellous bone behind it).
        cortical = 0.0
        if k_bone < len(t):
            k_end = min(len(t), k_bone + int(3.0 / step))
            seg = I[max(0, k_bone - int(1.0 / step)):k_end]
            off = max(0, k_bone - int(1.0 / step))
            kp = off + int(np.argmax(seg))
            pk = float(I[kp])
            deep = I[min(len(t) - 1, kp + int(1.5 / step)):min(len(t), kp + int(4.5 / step))]
            base_in = float(np.median(deep)) if len(deep) >= 3 else bone_in
            base_in = min(base_in, pk)
            if pk - base_in >= 0.12 * (lv["dense"] - lv["soft"]) and pk >= lv["bone"]:
                half_out = lv["soft"] + 0.5 * (pk - lv["soft"])
                half_in = base_in + 0.5 * (pk - base_in)
                a_ = kp
                while a_ > 0 and I[a_ - 1] >= half_out:
                    a_ -= 1
                b_ = kp
                while b_ < len(t) - 1 and I[b_ + 1] >= half_in:
                    b_ += 1
                cortical = float((b_ - a_ + 1) * step)
            else:
                cortical = 0.3 if pk >= bone_in else 0.0     # no distinct plate: thin or missing
        thread = t >= c
        inside = self._roi_sample(roi, "inside", pts) > 0.5
        in_bone = float(np.mean((inb | inside)[thread])) if thread.any() else 0.0
        if k_bone >= len(t) and inside.any():
            soft = float(t[int(np.argmax(inside))])
        if not self.entry_is_estimated(H) and soft < c + L:
            self._soft_seen = getattr(self, "_soft_seen", {})
            self._soft_seen.setdefault(tad.get("site"), []).append(soft)
        # air along the thread (sinus, nasal cavity); for the palate, reaching the nasal floor = bicortical
        air = I <= lv["air"]
        air_len = float(np.sum(air & thread) * step)
        tip_air = bool(air[-max(1, int(1.5 / step)):].any())
        clearance = float(np.min(np.minimum(droot, droot_edge + D / 2)[thread | (t >= max(0.0, soft))] - D / 2)) if len(t) else 9.9
        m = dict(root_clearance=round(clearance, 2), cortical=round(cortical, 2), soft_tissue=round(soft, 2),
                 bone_fraction=round(in_bone, 2), bone_in_thread=round(in_bone * L, 1), air_len=round(air_len, 2), tip_air=tip_air)
        status, notes = judge(tad, m)
        m["status"], m["notes"] = status, notes
        m["profile"] = dict(t=t[::2].round(2).tolist(), I=I[::2].round(0).tolist())
        return m

    # -- placing
    def place(self, site, side, s, a, alpha, beta, size, u_w=None):
        """A TAD at arch coordinates; None when the gum cannot be reached there."""
        if site == "palate":
            u, w = u_w
            H, n = self.palate_entry(u, w)
            if H is None:
                return None
            d = self.direction("palate", u, alpha, beta, surf_n=n)
            s_val = float(u)
            w34, _w45 = self.palate_levels()
            zone = dict(canal=bool(w > w34 - 3.0), suture=bool(abs(u) < 2.5))
        else:
            H = self.entry(site, side, s, a)
            if H is None:
                return None
            d = self.direction(site, s, alpha, beta)
            s_val = float(s)
        D, L, c = size
        tad = dict(site=site, arch=self.arch.arch, side=side, head=H.tolist(), dir=d.tolist(), diameter=D, length=L, collar=c,
                   s=s_val, a=float(a), alpha=float(alpha), beta=float(beta), uw=list(u_w) if u_w is not None else None,
                   entry="estimated" if self.entry_is_estimated(H) else "scan")
        if site == "palate":
            tad["palate_zone"] = zone
        tad["label"] = self.label(tad)
        return tad

    def palate_levels(self):
        """Anterior coordinate (w, + = anterior) of the canine / first-premolar and first / second-premolar
        contact lines, averaged over the sides that have them."""
        A = self.arch
        out = []
        for g in (3, 4):
            ws = []
            for side in ("L", "R"):
                s_ = A.gap(side, g)
                if s_ is not None:
                    ws.append(float(A.to_plane(A.at(s_)[0])[1]))
            out.append(float(np.mean(ws)) if ws else None)
        w34, w45 = out
        if w34 is None and w45 is None:
            w34, w45 = 8.0, 1.0
        elif w34 is None:
            w34 = w45 + 7.0
        elif w45 is None:
            w45 = w34 - 7.0
        return w34, w45

    def label(self, tad):
        A = self.arch
        site = tad["site"]
        if site == "palate":
            w34, w45 = self.palate_levels()
            w = float(A.to_plane(np.asarray(tad["head"], float))[1])
            lvl = "4/5 level" if w <= w45 + 1.5 else ("3/4 level" if w >= w34 - 1.5 else "premolar level")
            return f"Palate {'L' if tad['s'] >= 0 else 'R'} {abs(tad['s']):.1f} mm paramedian, {lvl}"
        q, n = A.tooth_at(tad["s"])
        s_c = tad["s"]
        # between n and n+1 when near a boundary
        side = "L" if s_c >= 0 else "R"
        b = A.bounds.get(side) or []
        txt = f"{q}{n}"
        if b:
            a_ = abs(s_c)
            k = int(np.argmin([abs(a_ - x) for x in b]))
            if abs(a_ - b[k]) < 2.2 and k >= 1:
                txt = f"{q} {k + A.shift[side]}/{k + 1 + A.shift[side]}"
        return f"{txt} {SITES[site]['label'].split(',')[0].lower()}"

    def optimize(self, site, side, s0, a0, alpha0, beta0, size, ds=2.0, da=2.0, dal=10.0, dbe=10.0, u_w=None):
        """Best nearby placement: maximise root clearance and bone along the thread, respecting the rules."""
        best = None
        if site == "palate":
            u0, w0 = u_w
            w34, _w45 = self.palate_levels()
            grid = [(u0 + du, w0 + dw, alpha0 + dl, beta0 + db) for du in (-0.5, 0.0, 0.5) for dw in np.arange(-2, 2.01, 1.0)
                    for dl in (-8, 0, 8) for db in (-8, 0, 8)]
            for u, w, al, be in grid:
                if w > w34 - 3.0 or abs(u) < 2.5:              # the incisive canal zone / the suture: not a site
                    continue
                tad = self.place(site, side, 0, 0, al, be, size, u_w=(u, w))
                if tad is None:
                    continue
                m = self.measure(tad)
                sc = score(tad, m, alpha0, beta0)
                if best is None or sc > best[0]:
                    best = (sc, tad, m)
        else:
            S = np.arange(-ds, ds + 1e-6, 0.5)
            Aa = np.arange(-da, da + 1e-6, 0.75)
            keys = [(dsv, dav) for dsv in S for dav in Aa]
            hits = self.entries(site, [s0 + k[0] for k in keys], [max(0.0, a0 + k[1]) for k in keys])
            entries = {k: h for k, h in zip(keys, hits) if np.isfinite(h[0])}
            if not entries:
                return None
            roi = self.roi(np.mean(list(entries.values()), axis=0))
            for (dsv, dav), H in entries.items():
                for dl in np.arange(-dal, dal + 1e-6, dal / 2 if dal else 1):
                    for db in np.arange(-dbe, dbe + 1e-6, dbe / 2 if dbe else 1):
                        d = self.direction(site, s0 + dsv, alpha0 + dl, beta0 + db)
                        D, L, c = size
                        est = self.entry_is_estimated(H)
                        tad = dict(site=site, arch=self.arch.arch, side=side, head=H.tolist(), dir=d.tolist(), diameter=D, length=L,
                                   collar=c, s=float(s0 + dsv), a=float(max(0.0, a0 + dav)), alpha=float(alpha0 + dl), beta=float(beta0 + db),
                                   entry="estimated" if est else "scan")
                        m = self.measure(tad, roi=roi)
                        sc = score(tad, m, alpha0, beta0) - (0.6 if est else 0.0)     # a scanned gum is worth more
                        if best is None or sc > best[0]:
                            best = (sc, tad, m)
        if best is None:
            return None
        sc, tad, m = best
        tad["label"] = self.label(tad)
        tad["metrics"] = self.measure(tad)
        tad["score"] = round(float(sc), 3)
        return tad

    def suggest(self, site, sides=("R", "L"), prefs=None, top=None):
        """Ranked sites for one site type on the given sides: one per gap, each optimised."""
        A = self.arch
        sd = SITES[site]
        if A.arch not in sd["arches"]:
            return []
        p = dict(prefs or {})
        a0 = p.get("a", sd["a"][A.arch])
        al0 = p.get("alpha", sd["alpha"][A.arch])
        be0 = p.get("beta", 0.0)
        size = tuple(p.get("size", sd["size"][A.arch]))
        out = []
        for side in sides:
            if site == "palate":
                # Paramedian palate (Ludwig et al. JCO 2011, Wilmes' T-zone): 3 mm (3-6) beside the suture, at the
                # premolar level - the thickest bone is 3-4 mm distal to the incisive foramen, whose distal margin
                # lies about at the canine / first-premolar contact line; so between the 3/4 and 4/5 contact
                # lines, never nearer than 3 mm to the 3/4 line (the incisive canal), never on the suture.
                w34, w45 = self.palate_levels()
                w0 = w45 + 1.0                                 # the premolar level, just in front of the 4/5 line
                u = 3.5 if side == "L" else -3.5
                tad = self.optimize(site, side, 0, 0, al0, be0, size, u_w=(u, w0))
                if tad:
                    tad["gap"] = None
                    out.append(tad)
                continue
            for g in sd["gaps"][A.arch]:
                s_gap = A.gap(side, g)
                if s_gap is None:
                    continue
                if site == "shelf":                      # posterior half of the second molar (from the 6/7 contact)
                    s_n = A.gap(side, 7)
                    s_gap = s_gap + 0.7 * (s_n - s_gap) if s_n is not None else s_gap + (7.0 if side == "L" else -7.0)
                tad = self.optimize(site, side, s_gap, a0, al0, be0, size)
                if tad:
                    tad["gap"] = g
                    out.append(tad)
        out.sort(key=lambda t: -t["score"])
        return out[:top] if top else out


def score(tad, m, alpha0, beta0):
    clr = min(m["root_clearance"], 2.5)
    sc = 2.0 * clr + 2.0 * m["bone_fraction"]
    if tad["site"] != "palate":
        sc -= 2.0 * m["air_len"]
    else:
        sc += 0.6 if m["tip_air"] else 0.0         # bicortical
        sc += 0.15 * min(m["bone_in_thread"], 8)
    if m["cortical"] < 0.5:
        sc -= 1.5
    elif m["cortical"] > 2.5:
        sc -= 0.4
    if m["soft_tissue"] > 3.0:
        sc -= 0.5 * (m["soft_tissue"] - 3.0)
    sc -= 0.012 * abs(tad["alpha"] - alpha0) + 0.012 * abs(tad["beta"] - beta0)
    return sc


def judge(tad, m):
    notes = []
    status = "ok"

    def worse(s):
        nonlocal status
        order = ["ok", "caution", "stop"]
        if order.index(s) > order.index(status):
            status = s
    c = m["root_clearance"]
    if c < 0.5:
        worse("stop"); notes.append(f"Dense structure (likely a root) {max(c, 0):.1f} mm from the thread - too close.")
    elif c < 1.0:
        worse("caution"); notes.append(f"Root clearance {c:.2f} mm - under 1 mm; aim for 1.2-1.6 mm.")
    elif c < 1.2:
        notes.append(f"Root clearance {c:.1f} mm.")
    ct = m["cortical"]
    if ct < 0.5:
        worse("caution"); notes.append("No distinct cortical plate at the entry (thin, or blurred in this CBCT) - check the slices; "
                                       "your protocol: under 0.5 mm, do not insert.")
    elif ct <= 1.5:
        notes.append(f"Cortical bone {ct:.1f} mm along the screw: no pre-drilling needed.")
    elif ct <= 2.5:
        notes.append(f"Cortical bone {ct:.1f} mm along the screw: perforate the cortex first.")
    else:
        notes.append(f"Cortical bone {ct:.1f} mm along the screw: perforate the cortex + pilot hole ~3 mm into cancellous.")
    if str(tad.get("product") or "").startswith("tomas") and ct >= 2.0:
        notes.append("tomas instructions: cortex 2 mm or more - pilot with the tomas-drill SD 1.1 (4 mm deep, 800 rpm).")
    if m["soft_tissue"] > 3.0:
        notes.append(f"Soft tissue {m['soft_tissue']:.1f} mm (> 3 mm): fine not to seat the collar all the way; consider a longer collar.")
    if m["bone_fraction"] < 0.75:
        worse("caution"); notes.append(f"Only {m['bone_in_thread']:.1f} mm of the thread is in bone.")
    if tad["site"] == "palate":
        pz = tad.get("palate_zone") or {}
        if pz.get("canal"):
            worse("stop"); notes.append("Too far forward: within 3 mm of the canine / first-premolar line, the incisive canal zone. "
                                        "The site is 3-4 mm (up to 6-9) distal to the incisive foramen, at the premolar level.")
        if pz.get("suture"):
            worse("caution"); notes.append("On the midpalatal suture: go 3 mm paramedian (the suture's bone is thin and variable).")
        if m["tip_air"]:
            notes.append("Bicortical: the tip reaches the nasal floor.")
        if m["air_len"] > 2.0:
            worse("caution"); notes.append(f"{m['air_len']:.1f} mm of the thread is in the nasal cavity - shorter screw?")
    elif m["air_len"] > 0.5:
        worse("caution" if m["air_len"] < 2.0 else "stop"); notes.append(f"The thread enters the sinus / nasal cavity by {m['air_len']:.1f} mm.")
    if tad["site"] == "buccal" and tad["arch"] == "lower":
        lab = tad.get("label", "")
        if any(x in lab for x in ("5/6", "6/7")):
            worse("caution"); notes.append("Your rule: no lower buccal TADs at 5/6 or 6/7 (bone too thick) - check.")
    if tad["arch"] == "lower" and tad["site"] in ("shelf", "buccal"):
        notes.append("Check the mandibular canal / mental foramen on the slices.")
    if tad.get("entry") == "estimated":
        notes.append("The scan does not reach this spot: the gum surface here is estimated from the CBCT (bone + the usual "
                     "soft-tissue thickness). The guide's sleeve stands on that estimate - check it on the slices.")
    return status, notes


def cylinder_mesh(tad, segments=24):
    """A simple screw stand-in (thread + collar + head) for display and export: vertices, faces."""
    H = np.asarray(tad["head"], float)
    d = unit(tad["dir"])
    D, L, c = float(tad["diameter"]), float(tad["length"]), float(tad.get("collar", 1.5))
    e1 = unit(np.cross(d, [1, 0, 0] if abs(d[0]) < 0.9 else [0, 1, 0]))
    e2 = np.cross(d, e1)
    rings = [(-1.6, D * 0.75 + 0.6), (0.0, D * 0.75 + 0.6), (0.0, D / 2 + 0.15), (c, D / 2 + 0.15), (c, D / 2),
             (c + L - D * 0.6, D / 2), (c + L, 0.25)]
    ang = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    V_ = []
    for t, r in rings:
        for a in ang:
            V_.append(H + d * t + r * (np.cos(a) * e1 + np.sin(a) * e2))
    V_ = np.array(V_)
    F_ = []
    n = segments
    for k in range(len(rings) - 1):
        for j in range(n):
            a0, a1 = k * n + j, k * n + (j + 1) % n
            b0, b1 = (k + 1) * n + j, (k + 1) * n + (j + 1) % n
            F_ += [[a0, b0, a1], [a1, b0, b1]]
    top = len(V_)
    V_ = np.vstack([V_, H - d * 1.6, H + d * (c + L)])
    for j in range(n):
        F_.append([top, j, (j + 1) % n][::-1])
        F_.append([top + 1, (len(rings) - 1) * n + (j + 1) % n, (len(rings) - 1) * n + j][::-1])
    return V_, np.array(F_)
