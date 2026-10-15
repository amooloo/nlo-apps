"""Watch-folder mode: drop raw scanner STLs into an inbox, finished OrthoFactory orders come out.

    python run_watch.py --inbox "S:\\clinical\\3D printing\\BleachTray" --titan "S:\\clinical\\3D printing\\Titan"

* Any *.stl dropped in the inbox is picked up once its size has stopped changing.
* Patient name and arch are read from the scanner's file name, e.g.
  "Armaan_Shetty_20261015_09-20-31_upper.stl" -> Armaan Shetty, upper. Arch falls back to
  geometry detection; a name that can't be parsed uses the file stem as the last name.
* An upper and a lower for the same patient arriving within `pair_wait` seconds become ONE order.
* Each order folder is written into the Titan input folder (Titan_Angled, Template pieces by
  default); scans and outputs are moved to inbox/done/<order>/, failures to inbox/failed/.
"""
import os, re, sys, time, json, shutil, traceback
from datetime import datetime

NAME_RE = re.compile(r"^(?P<first>[A-Za-z][A-Za-z'\-]*)[ _\-]+(?P<last>[A-Za-z][A-Za-z'\-]*)")
TITLE_RE = re.compile(r"^(dr|mr|mrs|ms|miss|prof)\.?[ _\-]+", re.I)
ARCH_RE = re.compile(r"(upper|maxil|lower|mandib)", re.I)
# a Titan / OrthoFactory export ("First Last - 0 - Maxilla.stl", also with _ instead of spaces, with or
# without a leading timestamp): a reference for training, never a scan to process
TITAN_RE = re.compile(r"^(?:\d{6,}[ _-]+)?(?P<name>.+?)[ _]+-[ _]+(?P<stage>\d+)[ _]+-[ _]+(?P<arch>Maxilla|Mandible)(?P<rest>.*)$", re.I)


def titan_export(filename):
    """(first, last, stage, arch) if the file name is a Titan export, else None."""
    m = TITAN_RE.match(os.path.splitext(os.path.basename(filename))[0])
    if not m:
        return None
    first, last, _ = parse_name(m.group("name").replace("_", " ") + ".stl")
    return first, last, int(m.group("stage")), ("upper" if m.group("arch").lower() == "maxilla" else "lower")


def training_dir(root, first, last, max_age_days=45, fuzzy=False):
    """training/<Last, First> - <date>/ : one folder per patient and visit, holding everything that
    teaches the model (scans, labels, Titan exports). Files for the same patient within `max_age_days`
    go to the same folder; a later visit gets a new dated folder. `fuzzy` (used for Titan exports,
    whose names are typed by hand) tolerates a spelling difference: "Pollenberg" joins "Pellenbarg"."""
    import difflib
    safe = lambda t: "".join(c for c in t if c.isalnum() or c in " -'").strip() or "Unknown"
    base = os.path.join(root, "training")
    os.makedirs(base, exist_ok=True)
    patient = f"{safe(last)}, {safe(first)}"
    cands = []
    for existing in sorted(os.listdir(base)):
        m = re.match(r"^(?P<last>[^,]+), (?P<first>.+?)(?: - (?P<date>\d{4}-\d{2}-\d{2}))?$", existing)
        if not m:
            continue
        same = f"{m.group('last')}, {m.group('first')}".lower() == patient.lower()
        if not same and fuzzy:
            same = difflib.SequenceMatcher(None, f"{m.group('last')}, {m.group('first')}".lower(), patient.lower()).ratio() >= 0.8
        if not same:
            continue
        try:
            when = time.mktime(time.strptime(m.group("date"), "%Y-%m-%d")) if m.group("date") else os.path.getmtime(os.path.join(base, existing))
        except Exception:
            when = os.path.getmtime(os.path.join(base, existing))
        cands.append((when, existing))
    if cands:
        when, existing = max(cands)
        if time.time() - when < max_age_days * 86400:
            return os.path.join(base, existing)
    d = os.path.join(base, f"{patient} - {time.strftime('%Y-%m-%d')}")
    os.makedirs(d, exist_ok=True)
    return d


def file_titan_export(root, path, move=False, log=print, filename=None):
    """Put a Titan export into the patient's training folder (copied, or moved from a drop folder).
    `filename` is the original name when `path` is a temporary upload."""
    import shutil
    info = titan_export(filename or path)
    if not info:
        return None
    first, last, stage, arch = info
    d = training_dir(root, first, last, fuzzy=True)
    dst = os.path.join(d, f"titan_stage{stage}_{arch}{os.path.splitext(filename or path)[1].lower()}")
    if os.path.abspath(dst) != os.path.abspath(path):
        (shutil.move if move else shutil.copyfile)(path, dst)
    log(f"Titan export filed for training: {os.path.relpath(dst, root)}")
    return dst

DEFAULT_CONFIG = dict(
    inbox="", titan="", preset="both", poll=4, pair_wait=45, doctor="Dr. Amir Akhavan", kind="T", stage=0,
    params={},
)


def parse_name(filename):
    stem = TITLE_RE.sub("", os.path.splitext(os.path.basename(filename))[0])
    m = NAME_RE.match(stem)
    first, last = (m.group("first"), m.group("last")) if m else ("Scan", re.sub(r"[^A-Za-z0-9]", "", stem)[:20] or "Unknown")
    a = ARCH_RE.search(stem)
    arch = None
    if a:
        arch = "upper" if a.group(1).lower() in ("upper", "maxil") else "lower"
    return first, last, arch


def stable(path, seconds=3):
    try:
        s1 = os.path.getsize(path)
        time.sleep(seconds)
        return os.path.getsize(path) == s1 and time.time() - os.path.getmtime(path) > seconds
    except OSError:
        return False


class Watcher:
    def __init__(self, cfg, log=print, on_result=None):
        """on_result(ent, work_dir, [(report, scan_path), ...]) -> called instead of writing the order
        (the app registers the case for review); without it (or with cfg auto_approve) the order is written."""
        self.cfg = dict(DEFAULT_CONFIG); self.cfg.update(cfg)
        self.log = log
        self.on_result = on_result
        self.inbox = self.cfg["inbox"]
        self.pending = {}   # (first,last) -> dict(files=[(path, arch)], first_seen=t)
        self.seen = set()
        os.makedirs(os.path.join(self.inbox, "done"), exist_ok=True)
        os.makedirs(os.path.join(self.inbox, "failed"), exist_ok=True)
        from .segment import load_models
        self.models = load_models()
        from .pipeline import DEFAULTS
        from .orderfolder import write_order_folder  # noqa  (import check)
        self.log(f"watching {self.inbox}  ->  orders to {self.cfg['titan']}  (preset {self.cfg['preset']})")

    def scan_inbox(self):
        for fn in sorted(os.listdir(self.inbox)):
            p = os.path.join(self.inbox, fn)
            if not (fn.lower().endswith(".stl") or (fn.lower().endswith(".pts") and titan_export(fn))) or not os.path.isfile(p) or p in self.seen:
                continue
            if not stable(p):
                continue
            if titan_export(fn):
                self.seen.add(p)
                try:
                    file_titan_export(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), p, move=True, log=self.log)
                except Exception as ex:  # noqa
                    self.log(f"could not file {fn}: {ex}")
                continue
            first, last, arch = parse_name(fn)
            key = (first.lower(), last.lower())
            self.seen.add(p)
            ent = self.pending.setdefault(key, dict(first=first, last=last, files=[], t=time.time()))
            ent["files"].append((p, arch))
            self.log(f"queued {fn}  ({first} {last}, {arch or 'arch: auto'})")

    def ready_orders(self):
        now = time.time()
        out = []
        for key, ent in list(self.pending.items()):
            arches = {a for _, a in ent["files"] if a}
            complete = len(ent["files"]) >= 2 or ({"upper", "lower"} <= arches)
            if complete or now - ent["t"] > self.cfg["pair_wait"]:
                out.append(self.pending.pop(key))
        return out

    def process_order(self, ent):
        from .pipeline import process
        from .orderfolder import write_order_folder
        from .server_presets import PRESETS
        tag = datetime.now().strftime("%Y-%m-%d %H-%M-%S") + f" {ent['first']} {ent['last']}"
        work = os.path.join(self.inbox, "done", tag)
        os.makedirs(work, exist_ok=True)
        params = dict(PRESETS.get(self.cfg["preset"], PRESETS["bleaching"]))
        params.update(self.cfg.get("params") or {})
        pieces = []; results = []
        from .server_presets import variants_for
        variants = variants_for(self.cfg.get("preset") or "both")
        feat_cache = {}
        try:
            for path, arch in ent["files"][:2]:
                moved = None
                for vpreset, tag, kind, stage in variants:
                    p = dict(params); p.update(PRESETS.get(vpreset, {})); p["arch"] = arch; p["stage"] = stage; p["kind"] = kind
                    name = f"{ent['first']}_{ent['last']}_{arch or 'scan'}_{tag}"
                    rep = process(path, work, name=name, params=p, models=self.models, log=self.log, feat_cache=feat_cache)
                    pieces.append(dict(arch=rep["arch"], stl=rep["outputs"]["model"], pts=rep["outputs"]["trimline"], stage=stage, kind=kind))
                    results.append((rep, path, dict(preset=vpreset, tag=tag, kind=kind, stage=stage)))
                moved = os.path.join(work, os.path.basename(path))
                shutil.move(path, moved)
                results = [(r[0], moved if r[1] == path else r[1], r[2]) for r in results]
            if self.on_result is not None and not self.cfg.get("auto_approve"):
                ent2 = dict(ent); ent2.update(stage=int(self.cfg["stage"]), kind=self.cfg["kind"], doctor=self.cfg["doctor"], preset=self.cfg["preset"])
                self.on_result(ent2, work, results)
                self.log(f"READY FOR REVIEW: {ent['first']} {ent['last']} - open the app, check it, click Send to OrthoFactory")
            elif self.cfg["titan"]:
                folder = write_order_folder(self.cfg["titan"], ent["first"], ent["last"], pieces,
                                            doctor=self.cfg["doctor"])
                self.log(f"ORDER READY: {folder}")
                with open(os.path.join(work, "ORDER_FOLDER.txt"), "w") as f:
                    f.write(folder + "\n")
            else:
                self.log(f"finished (no Titan folder configured): {work}")
        except Exception as ex:  # noqa
            self.log(f"FAILED {ent['first']} {ent['last']}: {ex}")
            fail = os.path.join(self.inbox, "failed", tag)
            os.makedirs(fail, exist_ok=True)
            with open(os.path.join(fail, "error.txt"), "w") as f:
                f.write(traceback.format_exc())
            for path, _ in ent["files"]:
                if os.path.exists(path):
                    shutil.move(path, os.path.join(fail, os.path.basename(path)))
            if os.path.isdir(work):
                shutil.move(work, os.path.join(fail, "partial_outputs"))

    def run_forever(self):
        while True:
            try:
                self.scan_inbox()
                for ent in self.ready_orders():
                    self.process_order(ent)
            except Exception as ex:  # noqa
                self.log(f"watcher error: {ex}")
            time.sleep(self.cfg["poll"])
