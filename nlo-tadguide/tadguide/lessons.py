"""Lessons: what the app learns from Dr. A's finished cases. Numbers only - no names, no images, no scans.

Each finished case writes training/lesson_<stamp>_<id>.json:
    scanner, arch, CBCT machine,
    the final match (rotation scan -> CBCT, how it was found, how good it was),
    the intensity levels he worked with,
    every TAD as he left it, in arch terms (site, side, which teeth, depth, angles, size, checks),
    the guide settings used, and - later - how the printed guide fitted (tight / good / loose).

What is learned from them (plain statistics, nothing sent anywhere):
    starting poses   - the matches of the last cases from the same scanner + arch are tried first next time,
                       so a new case usually matches on the first try
    levels           - per CBCT machine, the median of how far he moved the levels from the automatic ones (only
                       cases where he set them by hand)
    site habits      - per site and arch, the median depth, tilt, angle and most used screw size of the TADs he
                       placed or changed by hand (not suggestions used as they came) become the starting point of
                       the site finder, once there are two
    guide fit        - each 'tight' adds 0.03 mm to the fit gap, each 'loose' takes 0.02 off; the same for the
                       sleeve hole with 0.10 / 0.05 mm - so the guides converge on his printer and resin
"""
import os, json, time, glob, uuid
from collections import Counter
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRAIN_DIR = os.path.join(ROOT, "training")


def _dir():
    os.makedirs(TRAIN_DIR, exist_ok=True)
    return TRAIN_DIR


def load_all():
    out = []
    for p in sorted(glob.glob(os.path.join(TRAIN_DIR, "lesson_*.json"))):
        try:
            d = json.load(open(p, encoding="utf-8"))
            d["_path"] = p
            out.append(d)
        except Exception:
            continue
    out.sort(key=lambda d: d.get("when", 0))
    return out


def save(case):
    """case: the app's case dict (see app/server.py). Writes or replaces the case's lesson."""
    reg = case.get("registration") or {}
    T = np.array(reg.get("T")) if reg.get("T") is not None else None
    lesson = dict(
        id=case.get("lesson_id") or uuid.uuid4().hex[:10], when=time.time(),
        scanner=case.get("scanner") or "", arch=case.get("arch") or "",
        cbct=" ".join(x for x in [case.get("cbct_meta", {}).get("manufacturer", ""), case.get("cbct_meta", {}).get("model", "")] if x).strip(),
        match=dict(R=T[:3, :3].round(6).tolist() if T is not None else None, nsign=reg.get("normal_sign", 1.0), method=reg.get("method"),
                   quality=(reg.get("summary") or {}).get("within_05"), accepted=bool(case.get("match_accepted"))),
        levels={k: v for k, v in (case.get("levels") or {}).items() if isinstance(v, (int, float))},
        levels_auto={k: v for k, v in (case.get("levels_auto") or {}).items() if isinstance(v, (int, float))},
        levels_source=(case.get("levels") or {}).get("source"),
        tads=[dict(site=t.get("site"), arch=t.get("arch"), side=t.get("side"), gap=t.get("gap"), label=t.get("label"),
                   a=t.get("a"), alpha=t.get("alpha"), beta=t.get("beta"), diameter=t.get("diameter"), length=t.get("length"),
                   collar=t.get("collar"), status=(t.get("metrics") or {}).get("status"),
                   clearance=(t.get("metrics") or {}).get("root_clearance"), cortical=(t.get("metrics") or {}).get("cortical"),
                   from_suggestion=bool(t.get("from_suggestion")), edited=bool(t.get("edited")), hand=_by_hand(t))
              for t in case.get("tads") or []],
        guide=(case.get("guide") or {}).get("params"),
        feedback=(case.get("lesson_feedback") or None),
    )
    p = os.path.join(_dir(), f"lesson_{time.strftime('%Y%m%d_%H%M%S')}_{lesson['id']}.json")
    for old in glob.glob(os.path.join(TRAIN_DIR, f"lesson_*_{lesson['id']}.json")):
        try:
            prev = json.load(open(old, encoding="utf-8"))
            if prev.get("feedback") and not lesson["feedback"]:
                lesson["feedback"] = prev["feedback"]
            os.remove(old)
        except Exception:
            pass
    json.dump(lesson, open(p, "w", encoding="utf-8"), indent=1)
    return lesson["id"]


def add_feedback(lesson_id, fit=None, sleeve=None, note=""):
    for d in load_all():
        if d.get("id") == lesson_id:
            fb = d.get("feedback") or {}
            if fit:
                fb["fit"] = fit
            if sleeve:
                fb["sleeve"] = sleeve
            if note:
                fb["note"] = note[:500]
            fb["when"] = time.time()
            d["feedback"] = fb
            p = d.pop("_path")
            json.dump(d, open(p, "w", encoding="utf-8"), indent=1)
            return True
    return False


def priors_for(scanner, arch, n=5):
    """Starting rotations from the last n accepted matches with the same scanner and arch."""
    out = []
    for d in reversed(load_all()):
        m = d.get("match") or {}
        if d.get("scanner") == scanner and d.get("arch") == arch and m.get("R") and m.get("accepted"):
            out.append(dict(R=np.array(m["R"]), nsign=float(m.get("nsign") or 1.0)))
        if len(out) >= n:
            break
    return out


def level_offsets(cbct):
    """How far he moved the bone / teeth levels from the automatic ones on this CBCT machine (median, only from
    cases where he set them by hand). Applied on top of each new scan's own automatic levels, so a scan with a
    different exposure still starts from its own histogram."""
    offs = {}
    for d in load_all():
        lv, la = d.get("levels") or {}, d.get("levels_auto") or {}
        if not cbct or d.get("cbct") != cbct or d.get("levels_source") != "set by hand":
            continue
        for k in ("bone", "dense"):
            if isinstance(lv.get(k), (int, float)) and isinstance(la.get(k), (int, float)):
                offs.setdefault(k, []).append(lv[k] - la[k])
    return {k: float(np.median(v)) for k, v in offs.items()} if offs else None


def _by_hand(t):
    """Placed by clicking, or moved / tilted / resized by hand - his choice. A suggestion used as it came (or a
    fine-tune result) is the app's own choice: learning from those would only feed the site finder its own output
    back and let the angles drift."""
    if "hand" in t:
        return bool(t["hand"])
    return bool(t.get("edited")) or not t.get("from_suggestion")


def site_prefs(site, arch):
    """His usual depth, tilt and screw size for a site, from the TADs he set by hand."""
    rows = [t for d in load_all() for t in d.get("tads") or []
            if t.get("site") == site and t.get("arch") == arch and _by_hand(t)]
    if not rows:
        return None
    med = lambda k: float(np.median([r[k] for r in rows if r.get(k) is not None])) if any(r.get(k) is not None for r in rows) else None
    sizes = Counter((r.get("diameter"), r.get("length"), r.get("collar")) for r in rows if r.get("diameter"))
    p = dict(n=len(rows))
    for k in ("a", "alpha", "beta"):
        v = med(k)
        if v is not None:
            p[k] = round(v, 2)
    if sizes:
        p["size"] = list(sizes.most_common(1)[0][0])
    return p


def _adjust(p, fb):
    if fb.get("fit") == "tight":
        p["gap_teeth"] = min(0.35, p["gap_teeth"] + 0.03)
    elif fb.get("fit") == "loose":
        p["gap_teeth"] = max(0.0, p["gap_teeth"] - 0.02)
    if fb.get("sleeve") == "tight":
        p["hole"] = min(5.0, p["hole"] + 0.10)
    elif fb.get("sleeve") == "loose":
        p["hole"] = max(1.0, p["hole"] - 0.05)


# the guide settings he chooses carry over to the next guide; the build's own (grid size, seat search) do not
_CARRIED = ("gap_teeth", "gap_gum", "thickness", "hole", "sleeve_wall", "sleeve_height", "tissue_gap", "teeth_each_side")


def guide_params(defaults):
    """The settings of the last guide he made, corrected by its own fit report - and by any report on an older
    guide that came in after that last guide was made (those corrections were not in it yet)."""
    p = dict(defaults)
    src_when = 0.0
    all_ = load_all()
    for d in all_:
        g = d.get("guide")
        if not g:
            continue
        q = dict(p)
        q.update({k: v for k, v in g.items() if k in q and k in _CARRIED and isinstance(v, (int, float)) and not isinstance(v, bool)})
        _adjust(q, d.get("feedback") or {})
        p, src_when = q, float(d.get("when") or 0)
    for d in all_:
        fb = d.get("feedback") or {}
        if fb and d.get("guide") and float(d.get("when") or 0) < src_when and float(fb.get("when") or 0) > src_when:
            _adjust(p, fb)
    return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in p.items()}


def status(defaults=None):
    all_ = load_all()
    fb = [d for d in all_ if d.get("feedback")]
    lines = []
    sc = Counter((d.get("scanner"), d.get("arch")) for d in all_ if (d.get("match") or {}).get("accepted"))
    for (s, a), n in sc.most_common():
        lines.append(f"{s or 'scan'} {a}: starts from {min(n, 5)} earlier match{'es' if n > 1 else ''}")
    for site in ("buccal", "palatal", "izc", "shelf", "palate"):
        for arch in ("upper", "lower"):
            p = site_prefs(site, arch)
            if p:
                size = f", {p['size'][0]}x{p['size'][1]} mm" if p.get("size") else ""
                lines.append(f"{arch} {site}: {p['n']} TAD{'s' if p['n'] > 1 else ''} set by hand - depth {p.get('a', '-')} mm, "
                             f"tilt {p.get('alpha', '-')} deg{size}" + ("" if p["n"] >= 2 else " (used from the second on)"))
    if defaults is not None:
        gp = guide_params(defaults)
        lines.append(f"guide fit gap {gp['gap_teeth']:.2f} mm, sleeve hole {gp['hole']:.2f} mm ({len(fb)} fit report{'s' if len(fb) != 1 else ''})")
    return dict(lessons=len(all_), feedback=len(fb), lines=lines)
