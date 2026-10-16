"""Local web app: drop a scan STL, get a print-ready bleaching-tray model + Trimlign trimline."""
import os, sys, io, json, uuid, threading, time, struct, traceback, mimetypes
import numpy as np

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
                    if fn.lower().endswith(".stl"):
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
    todo = [k for k, sc in enumerate(job["scans"]) if full or me is not None or not sc.get("report")]
    job["progress"] = dict(frac=0.0, label="starting", scan=0, of=len(job["scans"]))
    try:
        def log(msg):
            job["log"].append(msg)
        n = max(1, len(todo))
        job.setdefault("feat_cache", {})
        fixed = job.setdefault("fixed_labels", {})   # brush fixes, kept for every later re-run of this case
        overrides = {}                                # ... and applied to every model made from the same scan file
        for i, k in enumerate(todo):
            scan = job["scans"][k]
            def progress(frac, label, i=i, k=k):
                job["progress"] = dict(frac=round((i + frac) / n, 3), label=label, scan=k, of=len(job["scans"]), step=i, steps=n)
            if me is not None and job["scans"][me.get("scan", 0)]["path"] == scan["path"] and scan["path"] not in overrides:
                progress(0.02, "applying your brush fixes")
                overrides[scan["path"]] = _apply_mask_edit(job, me.get("scan", 0), edit=me)
                fixed[scan["path"]] = overrides[scan["path"]]
            override = overrides.get(scan["path"], fixed.get(scan["path"]))
            params = dict(job["params"]); params["arch"] = scan.get("arch") or None
            if scan.get("preset"):
                params.update(PRESETS.get(scan["preset"], {}))
            params["stage"] = scan.get("stage", params.get("stage", 0)); params["kind"] = scan.get("kind", params.get("kind", "T"))
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


def _apply_mask_edit(job, k=0, edit=None):
    """Turn brush edits (vertex index lists) into corrected per-tooth labels."""
    edit = edit if edit is not None else (job.get("mask_edit") or {})
    from bleachtray.mesh_utils import load_scan
    from bleachtray.orient import rough_orient
    from bleachtray.segment import predict_tooth_prob, clean_mask
    from bleachtray.pipeline import separate_teeth, detect_arch
    scan = job["scans"][k]
    st = np.load(os.path.join(job["dir"], f"{scan['name']}_state.npz"))
    labels = st["labels"]
    mask = labels > 0
    add = np.array(edit.get("add", []), dtype=int)
    rem = np.array(edit.get("remove", []), dtype=int)
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


def _add_scans(job, path, filename, arch, preset, variants=None):
    stem = "".join(c for c in os.path.splitext(filename)[0] if c.isalnum() or c in "-_ ").strip().replace(" ", "_") or "scan"
    k = len({sc["path"] for sc in job["scans"]})
    if any(sc["name"].startswith(stem) for sc in job["scans"]):
        stem = f"{stem}_{k + 1}"
    for vpreset, tag, kind, stage in (variants or variants_for(preset)):
        job["scans"].append(dict(path=path, name=f"{stem}_{tag}", filename=filename, arch=arch, preset=vpreset, tag=tag, kind=kind, stage=stage))
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
    table = {"WT": (wt, "WT", "T", 0), "TT": ("aligner_high", "TT", "A", 1)}
    out = [table[t] for t in (makes or []) if t in table]
    return out or [("plain_model", "MODEL", "T", 0)]


@app.post("/api/jobs")
async def create_job(files: List[UploadFile] = File(...), preset: str = Form("bleaching"), params: str = Form("{}"),
                     name: str = Form(""), arches: str = Form("[]"), makes: str = Form("")):
    """Any number of scans at once: one case per patient (upper + lower paired by the file names).
    `makes`: per-file list of what to make (["WT","TT"]); without it every file gets the preset's variants."""
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
                _add_scans(other, path, fn, arch, other.get("preset") or preset, variants=per_file.get(k))
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
            _add_scans(job, path, fn, arch, preset, variants=per_file.get(k))
        nm = f"{first} {last}".strip() or (name if single else "") or job["scans"][0]["name"]
        job["name"] = ("".join(c for c in nm if c.isalnum() or c in "-_ ").strip() or "case").replace(" ", "_")
        JOBS[jid] = job
        ids.append(jid)
    _trim_caches()
    for jid in ids:
        if jid not in joined:
            _enqueue(JOBS[jid])
    return {"id": ids[0], "ids": ids, "joined": joined, "cases": len(ids), "filed": filed}


@app.post("/api/jobs/{jid}/rerun")
async def rerun(jid: str, edits: str = Form("{}"), params: str = Form("{}")):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    try:
        me = json.loads(edits or "{}")
        # a re-run without any painted vertex is just a re-run: it must not count as a brush correction
        job["mask_edit"] = me if (me.get("add") or me.get("remove")) else None
    except Exception:
        job["mask_edit"] = None
    try:
        job["params"].update(json.loads(params or "{}"))
    except Exception:
        pass
    job["auto_order"] = False
    job["rerun_all"] = True
    _enqueue(job)
    return {"id": jid}


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
            h = time.localtime().tm_hour
            busy = any(j.get("status") in ("queued", "running") for j in JOBS.values())
            st = _learn_status()
            fresh = time.time() - float(st.get("finished") or 0) < 20 * 3600
            if 1 <= h < 5 and not busy and st.get("new_since_last") and not fresh and not st["running"]:
                _start_learning()
        except Exception:  # noqa
            traceback.print_exc()


threading.Thread(target=_learn_loop, daemon=True).start()


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


def _review_view(job):
    return {k: job.get(k) for k in ("id", "name", "status", "review", "order_folder", "order_error", "learned")} | {"scans": [dict(arch=sc.get("arch"), tag=sc.get("tag")) for sc in job["scans"]]}


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
        try:
            shutil.copyfile(path, os.path.join(d, f"scan_{arch}.stl"))
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
    return _review_view(job)


@app.post("/api/jobs/{jid}/discard")
def discard(jid: str):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    job["review"] = "discarded"
    return _review_view(job)


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    out = {k: v for k, v in job.items() if k in ("id", "name", "status", "log", "error", "preset", "params", "order_folder", "order_error", "review", "source", "progress", "learned")}
    out["started"] = job.get("started")
    out["ahead"] = _ahead(job)
    out["scans"] = [dict(name=sc["name"], filename=sc["filename"], arch=sc.get("arch"), tag=sc.get("tag"), preset=sc.get("preset")) for sc in job["scans"]]
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
    Layout: uint32 nV, uint32 nF, float32 V[nV*3], uint32 F[nF*3], uint16 labels[nV], float32 disp[nV]"""
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
    return Response(content=buf.getvalue(), media_type="application/octet-stream")


@app.get("/api/jobs/{jid}/trimline.json")
def trimline_json(jid: str, scan: int = 0):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    st = np.load(os.path.join(job["dir"], f"{job['scans'][scan]['name']}_state.npz"))
    return JSONResponse(np.round(st["margin"], 3).tolist())
