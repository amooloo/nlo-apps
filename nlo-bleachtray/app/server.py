"""Local web app: drop a scan STL, get a print-ready bleaching-tray model + Trimlign trimline."""
import os
import re, sys, io, json, uuid, threading, time, struct, traceback, mimetypes
import numpy as np
import trimesh

# Windows PCs often have ".js = text/plain" in the registry, which Python's mimetypes picks up and the
# browser then refuses to run the 3D viewer ("Expected a JavaScript module script"). Force the right types.
for _ext, _mt in ((".js", "application/javascript"), (".mjs", "application/javascript"), (".css", "text/css"),
                  (".html", "text/html"), (".json", "application/json"), (".stl", "model/stl")):
    mimetypes.add_type(_mt, _ext)
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from bleachtray.pipeline import process, DEFAULTS  # noqa: E402
from bleachtray.segment import load_models  # noqa: E402
from bleachtray.orderfolder import write_order_folder  # noqa: E402

JOBS_DIR = os.path.join(ROOT, "jobs")
os.makedirs(JOBS_DIR, exist_ok=True)
app = FastAPI(title="NLO Bleach Tray")
app.mount("/static", StaticFiles(directory=os.path.join(ROOT, "app", "static")), name="static")

JOBS = {}
MODELS = load_models()

from bleachtray.server_presets import PRESETS, variants_for  # noqa: E402


CFG_PATH = os.path.join(ROOT, "watch_config.json")


def _read_cfg():
    try:
        with open(CFG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def site_config():
    """Settings install.bat saved for this PC (watch_config.json): the OrthoFactory input folder, the
    doctor name, the drop folder, the scanner's export folder. The browser app uses them as defaults."""
    cfg = _read_cfg()
    return dict(order_root=cfg.get("titan") or "", doctor=cfg.get("doctor") or "Dr. Amir Akhavan",
                inbox=cfg.get("inbox") or "", scanner_folder=cfg.get("scanner_folder") or "")


@app.post("/api/settings")
async def save_settings(scanner_folder: str = Form(None)):
    """Persist office-wide settings into watch_config.json (only the keys given)."""
    cfg = _read_cfg()
    if scanner_folder is not None:
        cfg["scanner_folder"] = scanner_folder.strip()
    try:
        with open(CFG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as ex:  # noqa
        raise HTTPException(500, f"could not save settings: {ex}")
    return site_config()


@app.get("/api/scanner/recent")
def scanner_recent(days: int = 14):
    """Scans the scanner exported recently (top folder + one level), grouped by patient."""
    from bleachtray.watch import parse_name
    setting = site_config()["scanner_folder"]
    if not setting:
        return {"folder": "", "patients": []}
    folders = [f.strip() for f in setting.split(";") if f.strip()]   # several PCs: separate with ;
    missing = [f for f in folders if not os.path.isdir(f)]
    if len(missing) == len(folders):
        return {"folder": setting, "error": "folder not found from this PC", "patients": []}
    cutoff = time.time() - days * 86400
    files = []
    for folder in folders:
        if folder in missing:
            continue
        try:
            for root, dirs, names in os.walk(folder):
                if root[len(folder):].count(os.sep) >= 2:
                    dirs[:] = []
                for fn in names:
                    if fn.lower().endswith((".stl", ".ply")):
                        p = os.path.join(root, fn)
                        try:
                            mt = os.path.getmtime(p)
                        except OSError:
                            continue
                        if mt >= cutoff:
                            files.append((p, mt))
        except Exception as ex:  # noqa
            missing.append(folder)
    groups = {}
    for p, mt in sorted(files, key=lambda x: -x[1]):
        first, last, arch = parse_name(os.path.basename(p))
        key = (first.lower(), last.lower(), time.strftime("%Y-%m-%d", time.localtime(mt)))
        g = groups.setdefault(key, dict(first=first, last=last, date=key[2], when=mt, files=[]))
        if len(g["files"]) < 2 and not any(f["arch"] == arch for f in g["files"] if arch):
            g["files"].append(dict(path=p, name=os.path.basename(p), arch=arch, when=mt))
    out = sorted(groups.values(), key=lambda g: -g["when"])[:40]
    res = {"folder": setting, "patients": out}
    if missing:
        res["warning"] = "not reachable from this PC: " + "; ".join(missing)
    return res


@app.post("/api/scanner/make")
async def scanner_make(paths: str = Form(...), preset: str = Form("bleaching"), params: str = Form("{}")):
    """Make a case from scans still in the scanner's folder (copied into the job, originals untouched)."""
    import shutil
    from bleachtray.watch import parse_name
    folders = [f.strip() for f in site_config()["scanner_folder"].split(";") if f.strip()]
    plist = [p for p in json.loads(paths) if p][:2]
    for p in plist:
        ok = any(os.path.abspath(p).startswith(os.path.abspath(f)) for f in folders)
        if not ok or not os.path.isfile(p):
            raise HTTPException(400, f"not a scan in the scanner folder: {p}")
    jid = uuid.uuid4().hex[:10]
    jdir = os.path.join(JOBS_DIR, jid)
    os.makedirs(jdir, exist_ok=True)
    pr = dict(PRESETS.get(preset, PRESETS["bleaching"]))
    try:
        pr.update(json.loads(params or "{}"))
    except Exception:
        pass
    scans = []
    for k, p in enumerate(plist):
        fn = os.path.basename(p)
        dst = os.path.join(jdir, f"scan{k}_{''.join(c for c in fn if c.isalnum() or c in '-_.')}")
        shutil.copyfile(p, dst)
        first, last, arch = parse_name(fn)
        stem = "".join(c for c in os.path.splitext(fn)[0] if c.isalnum() or c in "-_ ").strip().replace(" ", "_") or f"scan{k}"
        for vpreset, tag, kind, stage in variants_for(preset):
            scans.append(dict(path=dst, name=f"{stem}_{tag}", filename=fn, arch=arch, preset=vpreset, tag=tag, kind=kind, stage=stage))
    first, last, _ = parse_name(os.path.basename(plist[0]))
    pr.setdefault("patient_first", first); pr.setdefault("patient_last", last)
    if not pr.get("patient_first"): pr["patient_first"] = first
    if not pr.get("patient_last"): pr["patient_last"] = last
    job = dict(id=jid, dir=jdir, scans=scans, name=f"{first}_{last}", params=pr, status="queued",
               created=time.time(), filename=", ".join(sc["filename"] for sc in scans), preset=preset, source="scanner")
    JOBS[jid] = job
    _trim_caches()
    _enqueue(job)
    return {"id": jid}


# ---------- case history: every case keeps its recipe on disk (scan, settings, brush fixes, painted areas) ----------
# jobs/<id>/case.json is small and lives for good; the big outputs (models, Titan copies) are kept KEEP_OUTPUT_DAYS and
# then thinned - an old case opened from the history re-makes its models in a minute from the recipe.
KEEP_OUTPUT_DAYS = float(os.environ.get("NLO_KEEP_OUTPUT_DAYS", 30))
HISTORY = {}      # id -> case summary (from case.json), for every case on disk


def _save_case(job):
    """Write jobs/<id>/case.json: everything needed to list, reopen and re-make this case."""
    try:
        jdir = job["dir"]
        scans = []
        for sc in job["scans"]:
            r = sc.get("report") or {}
            scans.append(dict(path=os.path.relpath(sc["path"], jdir), name=sc["name"], filename=sc.get("filename"), arch=sc.get("arch"),
                              preset=sc.get("preset"), tag=sc.get("tag"), kind=sc.get("kind"), stage=sc.get("stage"),
                              titan_basename=r.get("titan_basename"), has_report=bool(r), braces_on=bool(sc.get("braces_on")),
                              raw_path=(os.path.relpath(sc["raw_path"], jdir) if sc.get("raw_path") else None),
                              braces=({k: v for k, v in sc["braces"].items() if k != "passes"} if sc.get("braces") else None)))
        fixed = job.get("fixed_labels") or {}
        for path, lab in fixed.items():
            np.savez(os.path.join(jdir, "fixedlabels_" + os.path.basename(path) + ".npz"), labels=np.asarray(lab, dtype=np.int16))
        paint = {os.path.relpath(k, jdir): v for k, v in (job.get("paint") or {}).items()}
        params = {k: v for k, v in job["params"].items() if k not in ("keep_off_idx", "blockout_idx")}
        case = dict(id=job["id"], name=job.get("name"), created=job.get("created"), source=job.get("source"), preset=job.get("preset"),
                    filename=job.get("filename"), params=params, scans=scans, review=job.get("review"), order_folder=job.get("order_folder"),
                    sent_at=job.get("sent_at"), learned=job.get("learned"), fixed=[os.path.relpath(k, jdir) for k in fixed], paint=paint,
                    thinned=bool(job.get("thinned")), saved=time.time())
        with open(os.path.join(jdir, "case.json"), "w") as f:
            json.dump(case, f, indent=1, default=float)
        HISTORY[job["id"]] = _summary(case)
    except Exception as ex:  # noqa
        job.setdefault("log", []).append(f"case not saved to the history ({ex})")


def _summary(case):
    p = case.get("params") or {}
    return dict(id=case["id"], name=case.get("name"), patient=f"{p.get('patient_first', '')} {p.get('patient_last', '')}".strip(),
                created=case.get("created"), review=case.get("review"), sent_at=case.get("sent_at"), thinned=case.get("thinned"), backfilled=case.get("backfilled"),
                models=[f"{sc.get('arch') or '?'} {sc.get('tag') or ''}".strip() for sc in case.get("scans", [])],
                filename=case.get("filename"), fixed=len(case.get("fixed") or []), source=case.get("source"))


def _backfill_case(d):
    """A case folder from before the history existed: build its case.json from the report files."""
    jdir = os.path.join(JOBS_DIR, d)
    reps = sorted(fn for fn in os.listdir(jdir) if fn.endswith("_report.json"))
    scans_on_disk = sorted(fn for fn in os.listdir(jdir) if fn.startswith("scan") and fn.lower().endswith((".stl", ".ply")))
    if not reps or not scans_on_disk:
        return None
    scans, params, first_name = [], {}, None
    for fn in reps:
        try:
            rep = json.load(open(os.path.join(jdir, fn)))
        except Exception:
            continue
        name = fn[: -len("_report.json")]
        tag = name.rsplit("_", 1)[-1] if name.rsplit("_", 1)[-1] in ("WT", "TT", "MODEL") else None
        p = rep.get("params") or {}
        params = params or {k: v for k, v in p.items() if k not in ("keep_off_idx", "blockout_idx")}
        # the scan this model was made from: the one whose name stem matches, else the only one
        stem = name[: -len(tag) - 1] if tag else name
        cand = [sc for sc in scans_on_disk if stem.lower() in sc.lower().replace(" ", "_")] or scans_on_disk
        kind = p.get("kind") or ("A" if tag == "TT" else "T")
        scans.append(dict(path=cand[0], name=name, filename=cand[0].split("_", 1)[-1] if "_" in cand[0] else cand[0], arch=rep.get("arch"),
                          preset="aligner_high" if tag == "TT" else "bleaching", tag=tag, kind=kind, stage=p.get("stage", 1 if tag == "TT" else 0),
                          titan_basename=rep.get("titan_basename"), has_report=True))
        first_name = first_name or rep.get("name")
    if not scans:
        return None
    pf, pl = params.get("patient_first") or "", params.get("patient_last") or ""
    nm = f"{pf}_{pl}".strip("_") or (first_name or d)
    created = min(os.path.getmtime(os.path.join(jdir, fn)) for fn in scans_on_disk)
    # was it sent? the training folder keeps a record of every case that was sent or saved (by case id),
    # and the OrthoFactory input folder may still hold the order folder with the patient's name
    review, sent_at, order_folder = None, None, None
    try:
        tdir = os.path.join(ROOT, "training")
        for td in os.listdir(tdir) if os.path.isdir(tdir) else []:
            cj = os.path.join(tdir, td, "case.json")
            if not os.path.isfile(cj):
                continue
            meta = json.load(open(cj))
            hits = [h for h in meta.get("history", []) if h.get("case") == d] or ([meta] if meta.get("case") == d else [])
            if hits:
                review = "sent"
                try:
                    sent_at = time.mktime(time.strptime(hits[-1].get("sent", ""), "%Y-%m-%d %H:%M"))
                except Exception:
                    sent_at = created
                break
    except Exception:
        pass
    try:
        root = site_config()["order_root"]
        if root and os.path.isdir(root) and pf and pl:
            key = f"{pf} {pl}".lower()
            for od in sorted(os.listdir(root)):
                full = os.path.join(root, od)
                if key in od.lower() and os.path.isdir(full) and abs(os.path.getmtime(full) - created) < 3 * 86400:
                    review, order_folder = "sent", full
                    sent_at = sent_at or os.path.getmtime(full)
    except Exception:
        pass
    case = dict(id=d, name="".join(c for c in nm if c.isalnum() or c in "-_ ").replace(" ", "_"), created=created, source="app", preset=None,
                filename=", ".join(sc["filename"] for sc in scans), params=params, scans=scans, review=review, order_folder=order_folder, sent_at=sent_at,
                learned=None, fixed=[], paint={}, thinned=False, saved=time.time(), backfilled=True, sent_checked=True)
    with open(os.path.join(jdir, "case.json"), "w") as f:
        json.dump(case, f, indent=1, default=float)
    return case


def _load_history():
    n = 0
    for d in os.listdir(JOBS_DIR):
        if not os.path.isdir(os.path.join(JOBS_DIR, d)) or d.startswith("_"):
            continue
        cj = os.path.join(JOBS_DIR, d, "case.json")
        try:
            case = json.load(open(cj)) if os.path.isfile(cj) else None
            # a backfill from the first version of the history did not know whether the case was sent: redo it once
            if case is None or (case.get("backfilled") and case.get("review") is None and not case.get("sent_checked")):
                case = _backfill_case(d) or case
            if case:
                HISTORY[case["id"]] = _summary(case); n += 1
        except Exception:
            pass
    return n


def _job_from_case(jid):
    """Rebuild a lightweight job from jobs/<id>/case.json (no feature cache; reports from disk)."""
    jdir = os.path.join(JOBS_DIR, jid)
    case = json.load(open(os.path.join(jdir, "case.json")))
    scans = []
    for sc in case["scans"]:
        s = dict(sc); s["path"] = os.path.join(jdir, sc["path"])
        if sc.get("raw_path"):
            s["raw_path"] = os.path.join(jdir, sc["raw_path"])
        rp = os.path.join(jdir, f"{sc['name']}_report.json")
        rep = None
        if os.path.exists(rp):
            try:
                rep = json.load(open(rp))
                outs = rep.get("outputs") or {}
                for k, v in list(outs.items()):      # the app folder may have moved since: re-anchor the paths
                    if v and not os.path.exists(v):
                        outs[k] = os.path.join(jdir, os.path.basename(v))
            except Exception:
                rep = None
        s["report"] = rep
        scans.append(s)
    fixed = {}
    for rel in case.get("fixed") or []:
        fp = os.path.join(jdir, "fixedlabels_" + os.path.basename(rel) + ".npz")
        if os.path.exists(fp):
            fixed[os.path.join(jdir, rel)] = np.load(fp)["labels"]
    paint = {os.path.join(jdir, k): v for k, v in (case.get("paint") or {}).items()}
    have_models = all(sc["report"] and os.path.exists((sc["report"].get("outputs") or {}).get("model", "")) for sc in scans) and bool(scans)
    job = dict(id=jid, dir=jdir, scans=scans, name=case.get("name"), params=case.get("params") or {}, status="done" if have_models else "needs_run",
               created=case.get("created") or time.time(), filename=case.get("filename"), preset=case.get("preset"), source=case.get("source"),
               review=case.get("review"), order_folder=case.get("order_folder"), order_error=None, sent_at=case.get("sent_at"), learned=case.get("learned"),
               fixed_labels=fixed, paint=paint, thinned=case.get("thinned"), reopened=True, feat_cache={},
               log=[f"opened from the history ({time.strftime('%m/%d/%Y', time.localtime(case.get('created') or time.time()))}"
                    + (f", sent {time.strftime('%m/%d/%Y %H:%M', time.localtime(case['sent_at']))}" if case.get("sent_at") else "") + ")"])
    reports = [sc["report"] for sc in scans if sc.get("report")]
    if reports:
        job["reports"] = reports; job["report"] = reports[0]
    return job


def _thin_old_cases(log=print):
    """Cases whose outputs are older than KEEP_OUTPUT_DAYS lose the big files (models, Titan copies, bodies);
    the recipe stays, so the case can still be reopened and re-made."""
    cutoff = time.time() - KEEP_OUTPUT_DAYS * 86400
    n = 0
    for jid, h in list(HISTORY.items()):
        if h.get("thinned") or (h.get("sent_at") or h.get("created") or time.time()) > cutoff:
            continue
        if jid in JOBS and JOBS[jid].get("status") in ("queued", "running"):
            continue
        jdir = os.path.join(JOBS_DIR, jid)
        try:
            case = json.load(open(os.path.join(jdir, "case.json")))
            for fn in os.listdir(jdir):
                if fn.endswith(("_model.stl", "_body_only.stl", "_blockout.stl")) or "_scan_with_reservoirs" in fn or any(sc.get("titan_basename") and fn.startswith(sc["titan_basename"]) for sc in case["scans"]):
                    os.remove(os.path.join(jdir, fn))
            case["thinned"] = True
            json.dump(case, open(os.path.join(jdir, "case.json"), "w"), indent=1, default=float)
            HISTORY[jid] = _summary(case)
            JOBS.pop(jid, None)           # out of the live list; reopening from the history re-makes it
            n += 1
        except Exception as ex:  # noqa
            log(f"could not thin case {jid}: {ex}")
    return n


# One case at a time: several people can drop scans at once (each drop is its own case, in line behind
# the others), and a re-run never collides with a run already going. NLO_WORKERS=2 runs two in parallel.
import queue
WORK_Q = queue.Queue()
QLOCK = threading.Lock()


def _enqueue(job):
    with QLOCK:
        if job.get("in_queue"):
            return
        job["in_queue"] = True; job["queued_at"] = time.time()
        if job.get("status") != "running":      # a running case finishes first, then runs again for what was added
            job["status"] = "queued"
    WORK_Q.put(job["id"])


def _worker():
    while True:
        jid = WORK_Q.get()
        job = JOBS.get(jid)
        if job is not None:
            with QLOCK:
                job["in_queue"] = False
            try:
                _run(job)
            except Exception:  # noqa
                traceback.print_exc()
        WORK_Q.task_done()


for _ in range(max(1, int(os.environ.get("NLO_WORKERS", "1") or 1))):
    threading.Thread(target=_worker, daemon=True).start()


def _ahead(job):
    """How many cases are being processed or waiting in front of this one."""
    if job.get("status") not in ("queued",):
        return 0
    t = job.get("queued_at", 0)
    return sum(1 for j in JOBS.values() if j is not job and (j.get("status") == "running" or (j.get("status") == "queued" and j.get("queued_at", 0) < t)))


def _run(job):
    job["status"] = "running"
    job["log"] = job.get("log") or []
    job["started"] = time.time()
    full = job.pop("rerun_all", False)
    me = job.pop("mask_edit", None)
    only = job.pop("rerun_only", None)
    todo = [k for k, sc in enumerate(job["scans"]) if full or me is not None or not sc.get("report") or (only is not None and k in only)]
    job["progress"] = dict(frac=0.0, label="starting", scan=0, of=len(job["scans"]))
    try:
        def log(msg):
            job["log"].append(msg)
        n = max(1, len(todo))
        job.setdefault("feat_cache", {})
        fixed = job.setdefault("fixed_labels", {})   # brush fixes, kept for every later re-run of this case
        overrides = {}                                # ... and applied to every model made from the same scan file
        # braces on? Only when the scan was dropped with "Braces on" ticked (or the job says so): brackets,
        # wire and ties come off the scan file first (once per scan) - except for a scan that only becomes a
        # mouthguard: that model keeps the brackets (under shields). Never assumed: the detector has taken
        # stained or shadowed enamel for a bracket on plain scans
        for path in dict.fromkeys(sc["path"] for sc in job["scans"]):
            mine = [sc for sc in job["scans"] if sc["path"] == path]
            asked = any(sc.get("braces_on") for sc in mine) or bool(job["params"].get("remove_appliances"))
            if not asked:
                # a clean file from a run that assumed braces: back to the scan as scanned
                raw = _raw_scan_for(mine[0])
                if raw and raw != path:
                    for sc in mine:
                        sc["path"] = raw; sc.pop("braces", None); sc.pop("raw_path", None)
                    job.get("braces", {}).pop(raw, None); fixed.pop(path, None); job.get("paint", {}).pop(path, None)
                    job["feat_cache"] = {}
                    log(f"braces were taken off this scan without being asked for - the scan as scanned ({os.path.basename(raw)}) is used again")
                continue
            if path in job.get("braces", {}) or "_clean" in os.path.basename(path):
                continue
            if all(sc.get("preset") == "mouthguard" for sc in mine):
                continue
            job["progress"] = dict(frac=0.01, label="taking the braces off the scan", scan=0, of=len(job["scans"]))
            try:
                _take_off_braces(job, path, log=log)
            except Exception as ex:  # noqa
                log(f"braces step skipped: {ex}")
        # "take off" strokes: a bit of bracket or wire the app missed - cut out and the enamel rebuilt, as a
        # new scan file (every model from it, every later re-run); everything indexed on the old file follows
        remap = None
        paint = job.setdefault("paint", {})
        if me is not None and me.get("takeoff") and job["scans"][me.get("scan", 0)].get("preset") == "mouthguard":
            # on a mouthguard nothing comes off: the painted part joins the bracket shield instead
            path = job["scans"][me.get("scan", 0)]["path"]
            entry = paint.setdefault(path, {"noreservoir": [], "blockout": []})
            entry["shield"] = sorted(set(entry.get("shield", [])) | set(int(i) for i in me["takeoff"]))
            log(f"painted: {len(entry['shield'])} vertices added to the bracket shield")
            me = dict(me); me.pop("takeoff")
        if me is not None and me.get("takeoff"):
            k0 = me.get("scan", 0)
            job["progress"] = dict(frac=0.01, label="taking off the painted parts", scan=k0, of=len(job["scans"]))
            try:
                res = _take_off_braces(job, job["scans"][k0]["path"], log=log, painted=me["takeoff"])
            except Exception as ex:  # noqa
                res = None; log(f"take off skipped: {ex}")
            if res is not None:
                _, remap = res
                me = dict(me)
                for key in ("cut",):      # the cut below works on the new file; the other strokes go through `remap` later
                    idx = np.asarray(me.get(key) or [], dtype=int); idx = idx[(idx >= 0) & (idx < len(remap))]
                    me[key] = [int(i) for i in remap[idx] if i >= 0]
        # "cut away" strokes: those parts leave the scan file itself (every model from it, every later re-run)
        if me is not None and me.get("cut"):
            job["progress"] = dict(frac=0.01, label="cutting away the painted parts of the scan", scan=me.get("scan", 0), of=len(job["scans"]))
            remap2 = _apply_cut(job, me.get("scan", 0), me["cut"], log=log)
            if remap2 is not None:
                if remap is None:
                    remap = remap2
                else:   # old file -> take-off file -> cut file
                    r = -np.ones(len(remap), dtype=np.int64); ok = remap >= 0
                    r[ok] = remap2[remap[ok]]; remap = r
        # "no reservoir" / "block out" strokes: kept per scan file (every model from it, every later re-run)
        if me is not None and (me.get("noreservoir") or me.get("blockout")):
            path = job["scans"][me.get("scan", 0)]["path"]
            entry = paint.setdefault(path, {"noreservoir": [], "blockout": []})
            for key in ("noreservoir", "blockout"):
                idx = np.asarray(me.get(key) or [], dtype=int)
                if remap is not None and len(idx):
                    idx = remap[idx[(idx >= 0) & (idx < len(remap))]]; idx = idx[idx >= 0]
                entry[key] = sorted(set(entry.get(key, [])) | set(int(i) for i in idx))
            log(f"painted: {len(entry['noreservoir'])} vertices without reservoir, {len(entry['blockout'])} to block out")
        for i, k in enumerate(todo):
            scan = job["scans"][k]
            def progress(frac, label, i=i, k=k):
                job["progress"] = dict(frac=round((i + frac) / n, 3), label=label, scan=k, of=len(job["scans"]), step=i, steps=n)
            if me is not None and job["scans"][me.get("scan", 0)]["path"] == scan["path"] and scan["path"] not in overrides and (me.get("add") or me.get("remove")):
                progress(0.02, "applying your brush fixes")
                overrides[scan["path"]] = _apply_mask_edit(job, me.get("scan", 0), edit=me, remap=remap)
                fixed[scan["path"]] = overrides[scan["path"]]
            override = overrides.get(scan["path"], fixed.get(scan["path"]))
            params = dict(job["params"]); params["arch"] = scan.get("arch") or None
            if scan.get("preset"):
                params.update(PRESETS.get(scan["preset"], {}))
            # the page's per-type settings (whitening tray / retainer) sit on top of the preset
            per_type = (job["params"].get("wt") if scan.get("tag") == "WT" else job["params"].get("tt") if scan.get("tag") == "TT" else None) or {}
            params.update({k: v for k, v in per_type.items() if v is not None})
            params["stage"] = scan.get("stage", params.get("stage", 0)); params["kind"] = scan.get("kind", params.get("kind", "T"))
            pe = paint.get(scan["path"]) or {}
            params["keep_off_idx"] = pe.get("noreservoir") or []; params["blockout_idx"] = pe.get("blockout") or []; params["shield_idx"] = pe.get("shield") or []
            rep = process(scan["path"], job["dir"], name=scan["name"], params=params, models=MODELS,
                          label_override=override, log=log, progress=progress, feat_cache=job["feat_cache"])
            scan["arch"] = rep["arch"]; scan["report"] = rep
        reports = [sc["report"] for sc in job["scans"] if sc.get("report")]
        job["report"] = reports[0]
        job["reports"] = reports
        # nothing goes to OrthoFactory until someone looks at the result and clicks Send
        # (jobs created with auto_order=True, e.g. an unattended watcher, skip the review)
        if job.get("auto_order"):
            _write_order(job, log)
        else:
            job["review"] = "review"
            job["order_folder"] = None; job["order_error"] = None; job["learned"] = None
        job["status"] = "queued" if job.get("in_queue") else "done"
        job["thinned"] = False
        _save_case(job)
    except Exception as ex:  # noqa
        job["status"] = "error"
        job["error"] = f"{ex}\n{traceback.format_exc()}"


def _write_order(job, log=print):
    """Write (or replace) this job's OrthoFactory order folder from its finished pieces."""
    site = site_config()
    root = (job["params"].get("order_root") or "").strip() or site["order_root"]
    prev = job.get("order_folder")
    if prev and os.path.isdir(prev):
        try:
            import shutil
            shutil.rmtree(prev)
            log(f"previous order folder removed: {prev}")
        except Exception as ex:  # noqa
            log(f"could not remove the previous order folder ({ex}); delete the older order in OrthoFactory")
    job["order_folder"] = None; job["order_error"] = None
    if not root:
        job["order_error"] = "no OrthoFactory folder set (run install.bat, or type it under Advanced settings)"
        return False
    if not (job["params"].get("patient_first") and job["params"].get("patient_last")):
        job["order_error"] = "patient first + last name needed for an OrthoFactory order"
        return False
    pieces = [dict(arch=sc["arch"], stl=sc["report"]["outputs"]["model"], pts=sc["report"]["outputs"]["trimline"],
                   stage=int(sc.get("stage", job["params"].get("stage", 0))), kind=sc.get("kind", job["params"].get("kind", "T")))
              for sc in job["scans"]]
    try:
        folder = write_order_folder(root, job["params"]["patient_first"], job["params"]["patient_last"], pieces,
                                    patient_id=job["params"].get("patient_id") or None,
                                    doctor=job["params"].get("doctor") or site["doctor"])
        job["order_folder"] = folder
        job["review"] = "sent"
        log(f"OrthoFactory order written: {folder}")
        return True
    except Exception as ex:  # noqa
        job["order_error"] = str(ex)
        log(f"order folder failed: {ex}")
        return False


def register_watcher_result(ent, work, results, log=print):
    """A case processed by the drop-folder watcher shows up in the app for review like any other."""
    jid = uuid.uuid4().hex[:10]
    scans = []
    for r in results:
        rep, scan_path = r[0], r[1]
        extra = r[2] if len(r) > 2 else {}
        scans.append(dict(path=scan_path, name=rep["name"], filename=os.path.basename(scan_path), arch=rep["arch"], report=rep, **extra))
    job = dict(id=jid, dir=work, scans=scans, name=f"{ent['first']} {ent['last']}".replace(" ", "_"),
               params=dict(patient_first=ent["first"], patient_last=ent["last"], stage=ent.get("stage", 0), kind=ent.get("kind", "T"),
                           doctor=ent.get("doctor") or "", adjust=dict(yaw_deg=0, dx=0, dy=0, dz=0)),
               status="done", created=time.time(), filename=", ".join(sc["filename"] for sc in scans), preset=ent.get("preset", "bleaching"),
               report=scans[0]["report"], reports=[sc["report"] for sc in scans], review="review", log=[f"processed from the drop folder: {work}"],
               order_folder=None, order_error=None, source="folder")
    JOBS[jid] = job
    log(f"ready for review in the app: {job['name']} (http://localhost:{8765})")
    return jid


def _apply_cut(job, k, cut, log=print):
    """Remove the painted vertices from the scan: the scan file is rewritten without them (faces
    touching a cut vertex go, then only the largest connected piece is kept, so a pad or a flap that
    was cut loose disappears entirely). Every model made from that scan now points at the new file;
    brush fixes kept for it are re-indexed. Returns the old->new vertex index map (-1 = gone)."""
    from bleachtray.mesh_utils import load_scan
    scan = job["scans"][k]
    old_path = scan["path"]
    raw = load_scan(old_path)
    V, F = np.asarray(raw.vertices), np.asarray(raw.faces)
    cut = np.asarray(cut, dtype=int)
    cut = cut[(cut >= 0) & (cut < len(V))]
    if len(cut) == 0:
        return None
    gone = np.zeros(len(V), bool); gone[cut] = True
    keep_f = ~gone[F].any(axis=1)
    sub = trimesh.Trimesh(V, F[keep_f], process=False)
    comps = trimesh.graph.connected_components(sub.face_adjacency, nodes=np.arange(len(sub.faces)))
    if len(comps) > 1:
        areas = [sub.area_faces[c].sum() for c in comps]
        keep_f2 = np.zeros(len(sub.faces), bool); keep_f2[comps[int(np.argmax(areas))]] = True
        sub = trimesh.Trimesh(V, sub.faces[keep_f2], process=False)
    used = np.zeros(len(V), bool); used[np.unique(sub.faces)] = True
    first = -np.ones(len(V), dtype=np.int64); first[used] = np.arange(int(used.sum()))
    out = trimesh.Trimesh(V[used], first[sub.faces], process=False)
    n_cut = job.setdefault("cuts", 0) + 1
    job["cuts"] = n_cut
    base = os.path.basename(old_path)
    base = base.rsplit("_cut", 1)[0] if "_cut" in base else os.path.splitext(base)[0]
    rgb = raw.metadata.get("rgb")
    if rgb is not None:   # a coloured scan stays coloured: the cut file is a PLY with the colours carried over
        new_path = os.path.join(job["dir"], f"{base}_cut{n_cut}.ply")
        out.visual = trimesh.visual.ColorVisuals(out, vertex_colors=np.column_stack([np.asarray(rgb)[used], np.full(int(used.sum()), 255, np.uint8)]))
        out.export(new_path, encoding="binary")
    else:
        new_path = os.path.join(job["dir"], f"{base}_cut{n_cut}.stl")
        out.export(new_path)
    # the pipeline will read the new file through load_scan, which may order the vertices its own way:
    # map old -> new by position (exact: float32 in, float32 out)
    from scipy.spatial import cKDTree
    re = load_scan(new_path)
    d, idx = cKDTree(np.asarray(re.vertices)).query(V[used])
    remap = -np.ones(len(V), dtype=np.int64)
    ok = d < 1e-3
    remap[np.where(used)[0][ok]] = idx[ok]
    used = remap >= 0
    # re-index what we keep per scan file
    fixed = job.setdefault("fixed_labels", {})
    if old_path in fixed:
        lab = np.asarray(fixed.pop(old_path)); newlab = np.zeros(len(re.vertices), dtype=lab.dtype); newlab[remap[used]] = lab[used]; fixed[new_path] = newlab
    for key in [key for key in job.get("feat_cache", {}) if (key if isinstance(key, str) else key[0]) == old_path]:
        job["feat_cache"].pop(key, None)
    paint = job.setdefault("paint", {})
    if old_path in paint:
        pe = paint.pop(old_path); newpe = {}
        for key, idx in pe.items():
            idx = np.asarray(idx, dtype=int); idx = idx[(idx >= 0) & (idx < len(remap))]
            newpe[key] = sorted(int(i) for i in remap[idx] if i >= 0)
        paint[new_path] = newpe
    for sc in job["scans"]:
        if sc["path"] == old_path:
            sc["path"] = new_path
    log(f"cut away: {int(gone.sum())} painted vertices, {int((~used).sum() - gone.sum())} more came loose with them; "
        f"the scan is now {len(out.vertices)} vertices ({os.path.basename(new_path)})")
    return remap


def _raw_scan_for(sc):
    """The scan as scanned behind a `_clean` / `_clean2` file (recorded on the scan, else by name)."""
    raw = sc.get("raw_path")
    if raw and os.path.exists(raw):
        return raw
    path = sc["path"]
    d, base = os.path.split(path)
    stem, ext = os.path.splitext(base)
    m = re.match(r"^(.*)_clean\d*$", stem)
    if not m:
        return None
    for e in (ext, ".ply", ".stl", ".PLY", ".STL"):
        cand = os.path.join(d, m.group(1) + e)
        if os.path.exists(cand):
            return cand
    return None


def _take_off_braces(job, path, log=print, painted=None):
    """A coloured scan with braces on: find brackets, wire and ties and take them off BEFORE anything
    else sees the scan. The cleaned scan is written as a new PLY next to the case (like a cut), every
    model made from the scan points at it from now on, and the patches are recorded (paint bit 4) so the
    brush view can show where enamel was rebuilt. Done once per scan file; returns the new path or None."""
    from bleachtray.mesh_utils import load_scan, adjacency
    from bleachtray.orient import rough_orient
    from bleachtray.features import compute_features
    from bleachtray.appliance import take_off_appliances
    from scipy.spatial import cKDTree
    done = job.setdefault("braces", {})
    auto = painted is None
    if auto and (path in done or "_clean" in os.path.basename(path) or not path.lower().endswith(".ply")):
        return None
    raw = load_scan(path)
    rgb = raw.metadata.get("rgb")
    if auto and rgb is None:
        done[path] = dict(used=False); return None
    mesh, T_rough = rough_orient(raw)
    A = adjacency(mesh)
    if auto:
        feats = compute_features(mesh, return_aux=True)
        clean, info, A2, feats2 = take_off_appliances(mesh, A, mesh.metadata["rgb"], feats, log=log)
        info = {k: v for k, v in info.items() if k != "passes"} | {"passes": [{kk: vv for kk, vv in p.items()} for p in info.get("passes", [])]}
        if not info.get("used"):
            done[path] = info
            job["feat_cache"][path] = feats       # not wasted: the pipeline uses the same features
            return None
    else:
        # the brush: what was painted is the appliance, no detection
        from bleachtray.appliance import remove_appliances
        idx = np.asarray(painted, dtype=int); idx = idx[(idx >= 0) & (idx < len(mesh.vertices))]
        if len(idx) == 0:
            return None
        pmask = np.zeros(len(mesh.vertices), bool); pmask[idx] = True
        clean, rinfo = remove_appliances(mesh, A, pmask, log=log)
        prev = next((sc.get("braces") for sc in job["scans"] if sc["path"] == path and sc.get("braces")), None) or {}
        info = dict(used=True, pieces=int(prev.get("pieces", 0)) + 1, area_mm2=float(prev.get("area_mm2", 0.0)), vertices=int(prev.get("vertices", 0)) + int(pmask.sum()), painted=True, **{k: v for k, v in rinfo.items() if k != "vertices"})
    # back to the scanner's own coordinates, and out as a coloured PLY (or STL when the scan had no colour)
    clean = clean.copy(); clean.apply_transform(np.linalg.inv(T_rough))
    base = os.path.splitext(os.path.basename(path))[0]
    m = re.match(r"^(.*)_clean(\d*)$", base)
    if m:
        base, n = m.group(1), int(m.group(2) or 1) + 1
        new_name = f"{base}_clean{n}"
    else:
        new_name = f"{base}_clean"
    crgb = clean.metadata.get("rgb")
    if crgb is not None:
        new_path = os.path.join(job["dir"], f"{new_name}.ply")
        crgb = np.asarray(crgb, dtype=np.uint8)
        clean.visual = trimesh.visual.ColorVisuals(clean, vertex_colors=np.column_stack([crgb, np.full(len(crgb), 255, np.uint8)]))
        clean.export(new_path, encoding="binary")
    else:
        new_path = os.path.join(job["dir"], f"{new_name}.stl")
        clean.export(new_path)
    # which vertices of the file as the pipeline will read it are rebuilt enamel: the ones that were not in the scan before
    re_ = load_scan(new_path)
    newV = np.asarray(re_.vertices); rawV = np.asarray(raw.vertices)
    d = cKDTree(rawV).query(newV)[0]
    patched = set(int(i) for i in np.where(d > 1e-3)[0])
    d2, j2 = cKDTree(newV).query(rawV)                      # old index -> new index (-1 = gone)
    remap = np.where(d2 < 1e-3, j2, -1).astype(np.int64)
    paint = job.setdefault("paint", {})
    entry = paint.setdefault(new_path, {"noreservoir": [], "blockout": []})
    old_entry = paint.pop(path, None)
    if old_entry:   # strokes painted on the earlier file (and its rebuilt enamel): carried over by position
        for key in ("noreservoir", "blockout", "removed"):
            idx = np.asarray(old_entry.get(key) or [], dtype=int); idx = idx[(idx >= 0) & (idx < len(remap))]
            kept = set(int(i) for i in remap[idx] if i >= 0)
            if key == "removed":
                patched |= kept
            else:
                entry[key] = sorted(set(entry.get(key, [])) | kept)
    entry["removed"] = sorted(patched)
    for sc in job["scans"]:
        if sc["path"] == path:
            sc["path"] = new_path; sc.setdefault("raw_path", path); sc["braces"] = info
    if job.get("fixed_labels", {}).pop(path, None) is not None:
        log("the brush fixes saved for this scan were dropped: the teeth are found again on the rebuilt enamel")
    for key in [key for key in job.get("feat_cache", {}) if (key if isinstance(key, str) else key[0]) == path]:
        job["feat_cache"].pop(key, None)
    done[path] = info; done[new_path] = info
    if auto:
        log(f"braces taken off: {info['pieces']} piece{'s' if info['pieces'] != 1 else ''}, {info['area_mm2']:.0f} mm2 - the scan is now {len(newV)} vertices ({os.path.basename(new_path)}), "
            f"{len(patched)} of them new enamel")
    else:
        log(f"taken off by hand: {int(pmask.sum())} painted vertices - the scan is now {len(newV)} vertices ({os.path.basename(new_path)})")
    return new_path, remap


def _apply_mask_edit(job, k=0, edit=None, remap=None):
    """Turn brush edits (vertex index lists) into corrected per-tooth labels. `remap` (old->new
    vertex index, from a cut in the same re-run) re-indexes the saved labels and the strokes."""
    edit = edit if edit is not None else (job.get("mask_edit") or {})
    from bleachtray.mesh_utils import load_scan
    from bleachtray.orient import rough_orient
    from bleachtray.segment import predict_tooth_prob, clean_mask
    from bleachtray.pipeline import separate_teeth, detect_arch
    scan = job["scans"][k]
    st = np.load(os.path.join(job["dir"], f"{scan['name']}_state.npz"))
    labels = st["labels"]
    add = np.array(edit.get("add", []), dtype=int)
    rem = np.array(edit.get("remove", []), dtype=int)
    if remap is not None and len(remap) == len(labels):
        kept = remap >= 0
        newlab = np.zeros(int(remap.max()) + 1, dtype=labels.dtype); newlab[remap[kept]] = labels[kept]; labels = newlab
        add = remap[add[(add >= 0) & (add < len(remap))]]; add = add[add >= 0]
        rem = remap[rem[(rem >= 0) & (rem < len(remap))]]; rem = rem[rem >= 0]
    mask = labels > 0
    if len(add):
        mask[add] = True
    if len(rem):
        mask[rem] = False
    raw = load_scan(scan["path"])
    mesh, _ = rough_orient(raw)
    cache = job.setdefault("feat_cache", {})
    feats = cache.get(scan["path"])
    if feats is None:
        from bleachtray.features import compute_features
        feats = compute_features(mesh, return_aux=True)
        cache[scan["path"]] = feats
    p_tooth, p_ip, aux = predict_tooth_prob(mesh, MODELS, feats=feats)
    A = aux["A"]
    mask = clean_mask(mask, A)
    arch = scan.get("arch") or job["params"].get("arch") or detect_arch(mesh, os.path.basename(scan["path"]))
    return separate_teeth(mesh, mask, p_ip, A, aux, arch, log=lambda m: None)


@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(ROOT, "app", "static", "index.html"), encoding="utf-8") as f:
        return f.read()


@app.get("/api/presets")
def presets():
    return {"defaults": DEFAULTS, "presets": PRESETS, "site": site_config()}


@app.get("/api/base.stl")
def base_stl():
    """The Trimlign base (Titan's mesh), for the viewer: shown under the arch so it can be positioned."""
    path = os.path.join(ROOT, "assets", "trimlign_base_titan.stl")
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path, media_type="model/stl")


from typing import List


def _trim_caches():
    """Feature caches are big: keep them only for the few most recent cases."""
    for old in sorted(JOBS.values(), key=lambda j: -j["created"])[4:]:
        old.pop("feat_cache", None)


def _open_case_for(first, last, arch, max_age=45 * 60):
    """An unsent case of this patient from the last 45 minutes that has no model of this arch yet:
    an upper dropped now joins the lower dropped a minute ago instead of becoming a second order."""
    if not (first and last and arch):
        return None
    key = (first.strip().lower(), last.strip().lower())
    for j in sorted(JOBS.values(), key=lambda j: -j["created"]):
        if time.time() - j["created"] > max_age or j.get("review") in ("sent", "discarded") or j.get("status") == "error":
            continue
        pf, pl = (j["params"].get("patient_first") or "").strip().lower(), (j["params"].get("patient_last") or "").strip().lower()
        if (pf, pl) != key:
            continue
        paths = {sc["path"] for sc in j["scans"]}
        arches = {sc.get("arch") for sc in j["scans"]}
        if len(paths) >= 2 or arch in arches:
            continue
        return j
    return None


def _add_scans(job, path, filename, arch, preset, variants=None, braces_on=None):
    same = [sc for sc in job["scans"] if sc["path"] == path]
    if same:   # another model from a scan the case already holds: keep its name stem
        stem = same[0]["name"][: -len(same[0]["tag"]) - 1] if same[0].get("tag") and same[0]["name"].endswith("_" + same[0]["tag"]) else same[0]["name"]
        if braces_on is None:
            braces_on = bool(same[0].get("braces_on"))
    else:
        stem = "".join(c for c in os.path.splitext(filename)[0] if c.isalnum() or c in "-_ ").strip().replace(" ", "_") or "scan"
        k = len({sc["path"] for sc in job["scans"]})
        if any(sc["name"].startswith(stem) for sc in job["scans"]):
            stem = f"{stem}_{k + 1}"
    for vpreset, tag, kind, stage in (variants or variants_for(preset)):
        job["scans"].append(dict(path=path, name=f"{stem}_{tag}", filename=filename, arch=arch, preset=vpreset, tag=tag, kind=kind, stage=stage,
                                 braces_on=bool(braces_on)))
    job["filename"] = ", ".join(dict.fromkeys(sc["filename"] for sc in job["scans"]))


def _group_uploads(items):
    """items: [(index, filename, arch or None)] -> list of cases, each [(index, filename, arch, first, last)].
    Files are grouped by the patient name in the file name; within a patient one upper + one lower make
    a case; a file whose name holds no patient name is a case of its own."""
    from bleachtray.watch import parse_name
    cases, by_patient = [], {}
    for idx, fn, arch in items:
        first, last, a = parse_name(fn)
        arch = arch or a
        known = first != "Scan"
        key = (first.lower(), last.lower()) if known else ("", f"#{idx}")
        subs = by_patient.setdefault(key, [])
        home = None
        for sj in subs:
            if len(sj) < 2 and (arch is None or all(e[2] != arch for e in sj)):
                home = sj; break
        if home is None:
            home = []; subs.append(home); cases.append(home)
        home.append((idx, fn, arch, first if known else "", last if known else ""))
    return cases


def _variants_from_makes(makes, preset):
    """Per-file choice from the page ("WT", "TT", both or none) -> variant tuples."""
    wt = "bleaching_3_3" if preset == "bleaching_3_3" else "bleaching"
    table = {"WT": (wt, "WT", "T", 0), "TT": ("aligner_high", "TT", "A", 1), "MG": ("mouthguard", "MG", "T", 2)}
    out = [table[t] for t in (makes or []) if t in table]
    return out or [("plain_model", "MODEL", "T", 0)]


@app.post("/api/jobs")
async def create_job(files: List[UploadFile] = File(...), preset: str = Form("bleaching"), params: str = Form("{}"),
                     name: str = Form(""), arches: str = Form("[]"), makes: str = Form(""), braces: str = Form("")):
    """Any number of scans at once: one case per patient (upper + lower paired by the file names).
    `makes`: per-file list of what to make (["WT","TT"]); without it every file gets the preset's variants.
    `braces`: per-file list of booleans - the scan has braces on and they are to come off first (never assumed)."""
    p0 = dict(PRESETS.get(preset, PRESETS["bleaching"]))
    try:
        p0.update(json.loads(params or "{}"))
    except Exception:
        pass
    try:
        arch_list = json.loads(arches or "[]")
    except Exception:
        arch_list = []
    try:
        makes_list = json.loads(makes) if makes else None
    except Exception:
        makes_list = None
    try:
        braces_list = json.loads(braces) if braces else []
    except Exception:
        braces_list = []
    from bleachtray.watch import titan_export, file_titan_export
    blobs, filed = [], []
    for k, f in enumerate(files):
        if not f.filename or not f.filename.lower().endswith((".stl", ".ply", ".pts")):
            continue
        if f.filename.lower().endswith(".pts") and not titan_export(f.filename):
            continue
        data_k = await f.read()
        if titan_export(f.filename):
            # a Titan export is a reference for training, not a scan to process
            tmp = os.path.join(JOBS_DIR, "_titan_" + "".join(c for c in f.filename if c.isalnum() or c in "-_. "))
            os.makedirs(JOBS_DIR, exist_ok=True)
            with open(tmp, "wb") as fh:
                fh.write(data_k)
            dst = file_titan_export(ROOT, tmp, move=True, log=lambda m: None, filename=f.filename)
            filed.append(os.path.relpath(dst, ROOT) if dst else f.filename)
            continue
        blobs.append((k, f.filename, data_k))
    if not blobs:
        if filed:
            return {"id": None, "ids": [], "joined": [], "cases": 0, "filed": filed}
        raise HTTPException(400, "no STL files")
    cases = _group_uploads([(k, fn, (arch_list[i] if i < len(arch_list) else None) or None) for i, (k, fn, _) in enumerate(blobs)])
    data = {k: (fn, b) for k, fn, b in blobs}
    per_file = {k: (_variants_from_makes(makes_list[i], preset) if makes_list and i < len(makes_list) else None) for i, (k, fn, _) in enumerate(blobs)}
    per_braces = {k: bool(braces_list[i]) if i < len(braces_list) else bool(p0.get("remove_appliances")) for i, (k, fn, _) in enumerate(blobs)}
    single = len(cases) == 1
    ids, joined = [], []
    for case in cases:
        first, last = case[0][3], case[0][4]
        p = dict(p0)
        if single and (p0.get("patient_first") or p0.get("patient_last")):
            first, last = p0.get("patient_first", ""), p0.get("patient_last", "")
        p["patient_first"], p["patient_last"] = first, last
        # a lone arch of a patient who already has an unsent case: join it
        if len(case) == 1 and case[0][2]:
            other = _open_case_for(first, last, case[0][2])
            if other is not None:
                k, fn, arch, _, _ = case[0]
                path = os.path.join(other["dir"], f"scan{len({sc['path'] for sc in other['scans']})}_{''.join(c for c in fn if c.isalnum() or c in '-_.')}")
                with open(path, "wb") as fh:
                    fh.write(data[k][1])
                _add_scans(other, path, fn, arch, other.get("preset") or preset, variants=per_file.get(k), braces_on=per_braces.get(k))
                other.setdefault("log", []).append(f"{arch} scan added to this case: {fn}")
                ids.append(other["id"]); joined.append(other["id"])
                _enqueue(other)
                continue
        jid = uuid.uuid4().hex[:10]
        jdir = os.path.join(JOBS_DIR, jid)
        os.makedirs(jdir, exist_ok=True)
        job = dict(id=jid, dir=jdir, scans=[], params=p, status="queued", created=time.time(), preset=preset, source="app")
        for k, fn, arch, _, _ in case:
            path = os.path.join(jdir, f"scan{len({sc['path'] for sc in job['scans']})}_{''.join(c for c in fn if c.isalnum() or c in '-_.')}")
            with open(path, "wb") as fh:
                fh.write(data[k][1])
            _add_scans(job, path, fn, arch, preset, variants=per_file.get(k), braces_on=per_braces.get(k))
        nm = f"{first} {last}".strip() or (name if single else "") or job["scans"][0]["name"]
        job["name"] = ("".join(c for c in nm if c.isalnum() or c in "-_ ").strip() or "case").replace(" ", "_")
        JOBS[jid] = job
        ids.append(jid)
    _trim_caches()
    for jid in ids:
        if jid not in joined:
            _enqueue(JOBS[jid])
    return {"id": ids[0], "ids": ids, "joined": joined, "cases": len(ids), "filed": filed}


@app.post("/api/jobs/{jid}/add")
async def add_model(jid: str, arch: str = Form(...), make: str = Form(...)):
    """One more model from a scan the case already holds (chose the retainer, now the whitening tray
    is wanted too): the scan is not uploaded again, its tooth split is reused, and the case goes back
    to review - Send then writes the order with every model."""
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    if job.get("status") in ("running", "queued"):
        raise HTTPException(409, "the case is still being processed - add it when it is done")
    make = (make or "").upper()
    src = next((sc for sc in job["scans"] if sc.get("arch") == arch), None)
    if src is None or make not in ("WT", "TT", "MG"):
        raise HTTPException(400, "no such scan in this case")
    if any(sc["path"] == src["path"] and sc.get("tag") == make for sc in job["scans"]):
        raise HTTPException(409, f"{make} {arch} is already part of this case")
    variants = _variants_from_makes([make], job.get("preset") or "bleaching")
    _add_scans(job, src["path"], src["filename"], arch, job.get("preset") or "bleaching", variants=variants)
    job.setdefault("log", []).append(f"{ {'WT': 'whitening tray', 'TT': 'retainer', 'MG': 'mouthguard'}[make] } added for the {arch} from the scan already in the case")
    job["auto_order"] = False
    _enqueue(job)
    return {"id": jid, "models": len(job["scans"])}


@app.post("/api/jobs/{jid}/rerun")
async def rerun(jid: str, edits: str = Form("{}"), params: str = Form("{}")):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    try:
        me = json.loads(edits or "{}")
        # a re-run without any painted vertex is just a re-run: it must not count as a brush correction
        job["mask_edit"] = me if any(me.get(k) for k in ("add", "remove", "cut", "noreservoir", "blockout", "takeoff")) else None
    except Exception:
        job["mask_edit"] = None
    # only the models a change touches are re-made: a retainer-line change leaves the whitening trays
    # alone (and the other way round); a change to the base, marks or anything shared re-makes them all
    try:
        new = json.loads(params or "{}")
    except Exception:
        new = {}
    old = job["params"]
    volatile = {"adjust", "tracker_case"}
    def changed(a, b):
        return json.dumps(a, sort_keys=True, default=str) != json.dumps(b, sort_keys=True, default=str)
    shared_changed = any(changed(old.get(k), v) for k, v in new.items() if k not in ("wt", "tt") and k not in volatile)
    adjust_changed = changed(old.get("adjust"), new.get("adjust")) if "adjust" in new else False
    per_type = {t: changed(old.get(t), new.get(t)) for t in ("wt", "tt") if t in new}
    job["params"].update(new)
    me = job.get("mask_edit")
    # a scan cleaned of braces without being asked for (an earlier version assumed them) goes back to the
    # scan as scanned on this re-run - everything is re-made from it
    undo = any(not sc.get("braces_on") and not job["params"].get("remove_appliances") and _raw_scan_for(sc) not in (None, sc["path"]) for sc in job["scans"])
    if me is not None or shared_changed or adjust_changed or undo or not job.get("reports"):
        only = None                                   # everything
    else:
        only = {k for k, sc in enumerate(job["scans"]) if per_type.get({"WT": "wt", "TT": "tt"}.get(sc.get("tag"), ""), False) or not sc.get("report")}
        if not only:
            only = None if not job.get("reports") else set()   # nothing changed: nothing to do
    job["auto_order"] = False
    job["rerun_all"] = only is None
    job["rerun_only"] = sorted(only) if only else None
    job["thinned"] = False
    if only is not None and not only:
        return {"id": jid, "nothing": True}
    if only:
        job.setdefault("log", []).append("re-making only the models the changed settings touch: " + ", ".join(f"{job['scans'][k].get('arch') or ''} {job['scans'][k].get('tag') or ''}".strip() for k in sorted(only)))
    _enqueue(job)
    return {"id": jid, "models": None if only is None else len(only)}


# ---------- learning: retrain at night from training/ (brush-corrected cases, Titan exports) ----------
LEARN = dict(thread=None, last_run=None)


def _learn_status():
    from bleachtray.learn import status
    st = status()
    try:
        st["model"] = dict(trained_on=len(MODELS.get("trained_on", [])), trained=MODELS.get("trained"))
    except Exception:
        st["model"] = {}
    st["running"] = bool(st.get("running")) or bool(LEARN["thread"] and LEARN["thread"].is_alive())
    return st


def _run_learning(force=False):
    """In a separate process (a crash or a memory spike never takes the app down), low priority."""
    global MODELS
    import subprocess
    from bleachtray.segment import load_models
    cmd = [sys.executable, "-m", "bleachtray.learn"] + (["--force"] if force else [])
    flags = 0x4000 if os.name == "nt" else 0   # BELOW_NORMAL_PRIORITY_CLASS
    try:
        print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  learning: retraining from the training folder...")
        subprocess.run(cmd, cwd=ROOT, creationflags=flags, timeout=4 * 3600)
    except Exception as ex:  # noqa
        print(f"learning: could not run ({ex})")
    LEARN["last_run"] = time.time()
    try:
        from bleachtray.learn import status
        st = status()
        if st.get("outcome") == "accepted":
            MODELS = load_models()
            print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  learning: new model in use ({len(MODELS.get('trained_on', []))} arches)")
        else:
            print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  learning: {st.get('outcome', '?')} - model unchanged")
    except Exception as ex:  # noqa
        print(f"learning: status unreadable ({ex})")


def _start_learning(force=False):
    if LEARN["thread"] and LEARN["thread"].is_alive():
        return False
    LEARN["thread"] = threading.Thread(target=_run_learning, args=(force,), daemon=True)
    LEARN["thread"].start()
    return True


def _learn_loop():
    """Between 1 and 5 in the morning, when nothing is being processed and there are new corrections."""
    while True:
        time.sleep(1800)
        try:
            _thin_old_cases(log=lambda m: None)
        except Exception:
            pass
        try:
            h = time.localtime().tm_hour
            busy = any(j.get("status") in ("queued", "running") for j in JOBS.values())
            st = _learn_status()
            fresh = time.time() - float(st.get("finished") or 0) < 20 * 3600
            if 1 <= h < 5 and not busy and st.get("new_since_last") and not fresh and not st["running"]:
                _start_learning()
        except Exception:  # noqa
            traceback.print_exc()


threading.Thread(target=_learn_loop, daemon=True).start()


def _restore_recent(days=2):
    """After a restart the work in hand is still there: cases from the last two days that were not sent or
    discarded yet. Everything else is in Past cases."""
    cutoff = time.time() - days * 86400
    for jid, h in sorted(HISTORY.items(), key=lambda kv: kv[1].get("created") or 0):
        if (h.get("created") or 0) < cutoff or jid in JOBS or h.get("review") in ("sent", "discarded") or h.get("backfilled"):
            continue
        try:
            job = _job_from_case(jid)
            if job["status"] == "done":
                job["log"] = []; job.pop("reopened", None)
                JOBS[jid] = job
        except Exception:
            pass


_load_history()
_restore_recent()
threading.Thread(target=lambda: _thin_old_cases(log=lambda m: None), daemon=True).start()


@app.get("/api/learn")
def learn_status():
    return _learn_status()


@app.post("/api/learn/run")
def learn_run():
    busy = any(j.get("status") in ("queued", "running") for j in JOBS.values())
    if busy:
        raise HTTPException(409, "a case is being processed - try again when the list is quiet")
    started = _start_learning(force=True)
    return dict(started=started, status=_learn_status())


@app.get("/api/jobs")
def list_jobs():
    return [{k: v for k, v in j.items() if k in ("id", "name", "status", "created", "filename", "preset", "review", "source")}
            | dict(ahead=_ahead(j), arches=sorted({sc.get("arch") for sc in j["scans"] if sc.get("arch")}), models=len(j["scans"]),
                   progress=(j.get("progress") if j.get("status") == "running" else None))
            for j in sorted(JOBS.values(), key=lambda j: -j["created"])]


def _fixed_arches(job):
    """Arches of this case that carry an applied brush fix (the only ones that can be a lesson)."""
    fixed = job.get("fixed_labels") or {}
    return sorted({sc.get("arch") or "scan" for sc in job["scans"] if sc["path"] in fixed})


def _review_view(job):
    return {k: job.get(k) for k in ("id", "name", "status", "review", "order_folder", "order_error", "learned", "sent_at", "reopened")} | {"scans": [dict(arch=sc.get("arch"), tag=sc.get("tag")) for sc in job["scans"]], "fixed": _fixed_arches(job)}


def _save_training(job, log=print):
    """Every case that is sent goes to training/<Last, First>/: the raw scan of each arch, the tooth
    labels that were sent (marked 'corrected' when someone used the brush, 'automatic' otherwise) and
    a case.json. Titan exports dropped on the page land in the same folder, so one patient's folder
    holds everything that teaches the model (tools/train_eval.py picks it up)."""
    import shutil
    from bleachtray.watch import training_dir
    first, last = job["params"].get("patient_first") or "", job["params"].get("patient_last") or ""
    if not (first or last):
        return []
    d = training_dir(ROOT, first, last)
    fixed = job.get("fixed_labels") or {}
    saved, meta = [], dict(first=first, last=last, sent=time.strftime("%Y-%m-%d %H:%M"), case=job["id"], arches={})
    for path in dict.fromkeys(sc["path"] for sc in job["scans"]):
        sc = next(sc for sc in job["scans"] if sc["path"] == path)
        arch = sc.get("arch") or "scan"
        # a scan with braces on is not a lesson: its labels belong to the enamel as rebuilt, not to the
        # brackets the raw file still carries
        if sc.get("braces") or ((sc.get("report") or {}).get("appliances") or {}).get("area_mm2"):
            log(f"training: {sc['filename']} skipped (brackets were taken off this scan)")
            continue
        try:
            ext = ".ply" if path.lower().endswith(".ply") else ".stl"   # a PLY keeps its colour for the retraining
            for other in (".stl", ".ply"):
                if other != ext and os.path.exists(os.path.join(d, f"scan_{arch}{other}")):
                    os.remove(os.path.join(d, f"scan_{arch}{other}"))
            shutil.copyfile(path, os.path.join(d, f"scan_{arch}{ext}"))
            labels = fixed.get(path)
            if labels is None:
                st = os.path.join(job["dir"], f"{sc['name']}_state.npz")
                if os.path.exists(st):
                    labels = np.load(st)["labels"]
            if labels is not None:
                np.savez(os.path.join(d, f"labels_{arch}.npz"), labels=np.asarray(labels, dtype=np.int16), arch=arch,
                         corrected=path in fixed, source=os.path.basename(path), approved=time.time())
            meta["arches"][arch] = dict(source=sc["filename"], corrected=path in fixed, teeth=len((sc.get("report") or {}).get("teeth", {})))
            saved.append(arch)
        except Exception as ex:  # noqa
            log(f"could not save the training example ({ex})")
    try:
        prev = {}
        cj = os.path.join(d, "case.json")
        if os.path.exists(cj):
            prev = json.load(open(cj))
        prev.update(meta); prev.setdefault("history", []).append(dict(sent=meta["sent"], case=job["id"], corrected=[a for a, m in meta["arches"].items() if m["corrected"]]))
        json.dump(prev, open(cj, "w"), indent=1)
    except Exception as ex:  # noqa
        log(f"case.json not written ({ex})")
    if saved:
        log(f"saved for training: {os.path.relpath(d, ROOT)} ({', '.join(saved)}{'; brush-corrected' if fixed else ''})")
    return saved


@app.post("/api/jobs/{jid}/approve")
def approve(jid: str):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    job.setdefault("log", [])
    _write_order(job, log=lambda m: job["log"].append(m))
    if _save_training(job, log=lambda m: job["log"].append(m)):
        job["learned"] = _learned_note(job)
    if job.get("review") == "sent":
        job["sent_at"] = time.time()
    _save_case(job)
    return _review_view(job)


@app.post("/api/jobs/{jid}/resend")
def resend(jid: str):
    """Write the OrthoFactory order again from the models as they are (a lost print, a second set)."""
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    job.setdefault("log", []).append("sent again")
    _write_order(job, log=lambda m: job["log"].append(m))
    if job.get("review") == "sent":
        job["sent_at"] = time.time()
    _save_case(job)
    return _review_view(job)


def _learned_note(job):
    fixed = job.get("fixed_labels") or {}
    arches = [sc.get("arch") or "scan" for sc in job["scans"] if sc["path"] in fixed]
    return dict(at=time.time(), corrected=sorted(set(arches)))


@app.post("/api/jobs/{jid}/learn")
def learn_from(jid: str):
    """'Looks good' without an order: file the case (scan + labels as they stand) for the night-time
    retraining. Same thing Send does on the side, minus OrthoFactory."""
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    job.setdefault("log", [])
    if not _save_training(job, log=lambda m: job["log"].append(m)):
        raise HTTPException(400, "nothing to save - the case has no patient name")
    job["learned"] = _learned_note(job)
    _save_case(job)
    return _review_view(job)


@app.post("/api/jobs/{jid}/discard")
def discard(jid: str):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    job["review"] = "discarded"
    _save_case(job)
    return _review_view(job)


@app.post("/api/jobs/{jid}/close")
def close_job(jid: str):
    """Take a case off the live list (it stays in Past cases, nothing about it changes)."""
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    if job.get("status") in ("queued", "running"):
        raise HTTPException(400, "still processing")
    _save_case(job)
    JOBS.pop(jid, None)
    return {"ok": True}


@app.get("/api/history")
def history(q: str = "", limit: int = 60):
    """Past cases (every case on disk), newest first, filtered by a bit of the name / patient / file / date."""
    words = [w for w in (q or "").lower().split() if w]
    out = []
    for h in sorted(HISTORY.values(), key=lambda h: -(h.get("created") or 0)):
        hay = " ".join(str(x) for x in (h.get("name"), h.get("patient"), h.get("filename"), time.strftime("%m/%d/%Y %Y-%m-%d", time.localtime(h.get("created") or 0)), " ".join(h.get("models") or []))).lower()
        if all(w in hay for w in words):
            out.append(dict(h, live=h["id"] in JOBS))
        if len(out) >= limit:
            break
    return dict(cases=out, total=len(HISTORY))


@app.post("/api/history/{jid}/open")
def history_open(jid: str):
    """Bring a past case back into the list: as it was when its models are still on disk, re-made from the
    recipe (scan + settings + brush fixes + painted areas) when they have been thinned."""
    if jid in JOBS:
        return {"id": jid, "status": JOBS[jid].get("status")}
    if jid not in HISTORY:
        raise HTTPException(404)
    try:
        job = _job_from_case(jid)
    except Exception as ex:  # noqa
        raise HTTPException(500, f"could not open that case: {ex}")
    JOBS[jid] = job
    if job["status"] != "done":
        job["status"] = "queued"; job["rerun_all"] = True; job["auto_order"] = False
        job["log"].append("the models of this case were cleared to save space - making them again from the scan, with the same fixes and settings")
        _enqueue(job)
    return {"id": jid, "status": job["status"]}


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    out = {k: v for k, v in job.items() if k in ("id", "name", "status", "log", "error", "preset", "params", "order_folder", "order_error", "review", "source", "progress", "learned", "sent_at", "reopened", "created")}
    out["started"] = job.get("started")
    out["ahead"] = _ahead(job)
    out["fixed"] = _fixed_arches(job)
    paint = job.get("paint") or {}
    out["scans"] = [dict(name=sc["name"], filename=sc["filename"], arch=sc.get("arch"), tag=sc.get("tag"), preset=sc.get("preset"),
                         braces=({k: v for k, v in sc["braces"].items() if k != "passes"} if sc.get("braces") else None),
                         painted={k: len(v) for k, v in (paint.get(sc["path"]) or {}).items()}) for sc in job["scans"]]
    if job.get("reports"):
        out["reports"] = [{k: r[k] for k in r if k not in ("transform_raw_to_output",)} for r in job["reports"]]
        out["report"] = out["reports"][0]
    return out


@app.get("/api/jobs/{jid}/file/{kind}")
def job_file(jid: str, kind: str, scan: int = 0):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    name = job["scans"][scan]["name"]
    files = {
        "model": (f"{name}_model.stl", "model/stl"),
        "trimline": (f"{name}_trimline.pts", "text/plain"),
        "scan_res": (f"{name}_scan_with_reservoirs.stl", "model/stl"),
        "body": (f"{name}_body_only.stl", "model/stl"),
        "blockout": (f"{name}_blockout.stl", "model/stl"),
        "report": (f"{name}_report.json", "application/json"),
    }
    tb = (job["scans"][scan].get("report") or {}).get("titan_basename")
    if tb:
        files["titan_stl"] = (tb + ".stl", "model/stl")
        files["titan_pts"] = (tb + ".pts", "text/plain")
    if kind not in files:
        raise HTTPException(404)
    fn, mt = files[kind]
    path = os.path.join(job["dir"], fn)
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path, media_type=mt, filename=fn)


@app.get("/api/jobs/{jid}/segmesh")
def seg_mesh(jid: str, scan: int = 0):
    """Binary blob of the rough-oriented scan with labels + displacement, for the brush view.
    Layout: uint32 nV, uint32 nF, float32 V[nV*3], uint32 F[nF*3], uint16 labels[nV], float32 disp[nV], uint8 paint[nV][, uint8 rgb[nV*3]]"""
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    from bleachtray.mesh_utils import load_scan
    from bleachtray.orient import rough_orient
    sc = job["scans"][scan]
    st = np.load(os.path.join(job["dir"], f"{sc['name']}_state.npz"))
    raw = load_scan(sc["path"])
    mesh, _ = rough_orient(raw)
    V = np.asarray(mesh.vertices, dtype=np.float32)
    F = np.asarray(mesh.faces, dtype=np.uint32)
    lab = np.asarray(st["labels"], dtype=np.uint16)
    disp = np.asarray(st["d"], dtype=np.float32)
    buf = io.BytesIO()
    buf.write(struct.pack("<II", len(V), len(F)))
    buf.write(V.tobytes()); buf.write(F.tobytes()); buf.write(lab.tobytes()); buf.write(disp.tobytes())
    # painted areas kept for this scan file: bit 1 = no reservoir, bit 2 = block out; bit 4 = brackets / wire removed; bit 8 = bracket shield
    pe = (job.get("paint") or {}).get(sc["path"]) or {}
    flags = np.zeros(len(V), dtype=np.uint8)
    for bit, key in ((1, "noreservoir"), (2, "blockout"), (4, "removed")):
        idx = np.asarray(pe.get(key) or [], dtype=int); idx = idx[(idx >= 0) & (idx < len(V))]
        flags[idx] |= bit
    # bit 8 = under the mouthguard's bracket shield (found + painted)
    if "shield" in st.files and len(st["shield"]) == len(V):
        flags[np.asarray(st["shield"], bool)] |= 8
    buf.write(flags.tobytes())
    # the scanner's colour per vertex, when the scan has one (a PLY): uint8 rgb[nV*3]
    rgb = st["rgb"] if "rgb" in st.files else None
    if rgb is not None and len(rgb) == len(V):
        buf.write(np.asarray(rgb, dtype=np.uint8).tobytes())
    return Response(content=buf.getvalue(), media_type="application/octet-stream")


@app.get("/api/jobs/{jid}/trimline.json")
def trimline_json(jid: str, scan: int = 0):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    st = np.load(os.path.join(job["dir"], f"{job['scans'][scan]['name']}_state.npz"))
    return JSONResponse(np.round(st["margin"], 3).tolist())
