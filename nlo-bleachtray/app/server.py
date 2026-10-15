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

from bleachtray.server_presets import PRESETS  # noqa: E402


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
    folder = site_config()["scanner_folder"]
    if not folder:
        return {"folder": "", "patients": []}
    if not os.path.isdir(folder):
        return {"folder": folder, "error": "folder not found from this PC", "patients": []}
    cutoff = time.time() - days * 86400
    files = []
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
        return {"folder": folder, "error": str(ex), "patients": []}
    groups = {}
    for p, mt in sorted(files, key=lambda x: -x[1]):
        first, last, arch = parse_name(os.path.basename(p))
        key = (first.lower(), last.lower(), time.strftime("%Y-%m-%d", time.localtime(mt)))
        g = groups.setdefault(key, dict(first=first, last=last, date=key[2], when=mt, files=[]))
        if len(g["files"]) < 2 and not any(f["arch"] == arch for f in g["files"] if arch):
            g["files"].append(dict(path=p, name=os.path.basename(p), arch=arch, when=mt))
    out = sorted(groups.values(), key=lambda g: -g["when"])[:40]
    return {"folder": folder, "patients": out}


@app.post("/api/scanner/make")
async def scanner_make(paths: str = Form(...), preset: str = Form("bleaching"), params: str = Form("{}")):
    """Make a case from scans still in the scanner's folder (copied into the job, originals untouched)."""
    import shutil
    from bleachtray.watch import parse_name
    folder = site_config()["scanner_folder"]
    plist = [p for p in json.loads(paths) if p][:2]
    for p in plist:
        if not folder or not os.path.abspath(p).startswith(os.path.abspath(folder)) or not os.path.isfile(p):
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
        scans.append(dict(path=dst, name=stem, filename=fn, arch=arch))
    first, last, _ = parse_name(os.path.basename(plist[0]))
    pr.setdefault("patient_first", first); pr.setdefault("patient_last", last)
    if not pr.get("patient_first"): pr["patient_first"] = first
    if not pr.get("patient_last"): pr["patient_last"] = last
    job = dict(id=jid, dir=jdir, scans=scans, name=f"{first}_{last}", params=pr, status="queued",
               created=time.time(), filename=", ".join(sc["filename"] for sc in scans), preset=preset, source="scanner")
    JOBS[jid] = job
    for old in sorted(JOBS.values(), key=lambda j: -j["created"])[4:]:
        old.pop("feat_cache", None)
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return {"id": jid}


def _run(job):
    job["status"] = "running"
    job["log"] = []
    job["started"] = time.time()
    job["progress"] = dict(frac=0.0, label="starting", scan=0, of=len(job["scans"]))
    try:
        def log(msg):
            job["log"].append(msg)
        reports = []
        n = len(job["scans"])
        job.setdefault("feat_cache", {})
        for k, scan in enumerate(job["scans"]):
            def progress(frac, label, k=k):
                job["progress"] = dict(frac=round((k + frac) / n, 3), label=label, scan=k, of=n)
            override = None
            if job.get("mask_edit") is not None and job["mask_edit"].get("scan", 0) == k:
                progress(0.02, "applying your brush fixes")
                override = _apply_mask_edit(job, k)
            params = dict(job["params"]); params["arch"] = scan.get("arch") or None
            rep = process(scan["path"], job["dir"], name=scan["name"], params=params, models=MODELS,
                          label_override=override, log=log, progress=progress, feat_cache=job["feat_cache"])
            scan["arch"] = rep["arch"]; scan["report"] = rep
            reports.append(rep)
        job["report"] = reports[0]
        job["reports"] = reports
        job["mask_edit"] = None
        # nothing goes to OrthoFactory until someone looks at the result and clicks Send
        # (jobs created with auto_order=True, e.g. an unattended watcher, skip the review)
        if job.get("auto_order"):
            _write_order(job, log)
        else:
            job["review"] = "review"
            job["order_folder"] = None; job["order_error"] = None
        job["status"] = "done"
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
                   stage=int(job["params"].get("stage", 0)), kind=job["params"].get("kind", "T")) for sc in job["scans"]]
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
    for rep, scan_path in results:
        scans.append(dict(path=scan_path, name=rep["name"], filename=os.path.basename(scan_path), arch=rep["arch"], report=rep))
    job = dict(id=jid, dir=work, scans=scans, name=f"{ent['first']} {ent['last']}".replace(" ", "_"),
               params=dict(patient_first=ent["first"], patient_last=ent["last"], stage=ent.get("stage", 0), kind=ent.get("kind", "T"),
                           doctor=ent.get("doctor") or "", adjust=dict(yaw_deg=0, dx=0, dy=0, dz=0)),
               status="done", created=time.time(), filename=", ".join(sc["filename"] for sc in scans), preset=ent.get("preset", "bleaching"),
               report=scans[0]["report"], reports=[sc["report"] for sc in scans], review="review", log=[f"processed from the drop folder: {work}"],
               order_folder=None, order_error=None, source="folder")
    JOBS[jid] = job
    log(f"ready for review in the app: {job['name']} (http://localhost:{8765})")
    return jid


def _apply_mask_edit(job, k=0):
    """Turn brush edits (vertex index lists) into corrected per-tooth labels."""
    from bleachtray.mesh_utils import load_scan
    from bleachtray.orient import rough_orient
    from bleachtray.segment import predict_tooth_prob, clean_mask
    from bleachtray.pipeline import separate_teeth, detect_arch
    scan = job["scans"][k]
    st = np.load(os.path.join(job["dir"], f"{scan['name']}_state.npz"))
    labels = st["labels"]
    mask = labels > 0
    add = np.array(job["mask_edit"].get("add", []), dtype=int)
    rem = np.array(job["mask_edit"].get("remove", []), dtype=int)
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


@app.post("/api/jobs")
async def create_job(files: List[UploadFile] = File(...), preset: str = Form("bleaching"), params: str = Form("{}"),
                     name: str = Form(""), arches: str = Form("[]")):
    jid = uuid.uuid4().hex[:10]
    jdir = os.path.join(JOBS_DIR, jid)
    os.makedirs(jdir, exist_ok=True)
    p = dict(PRESETS.get(preset, PRESETS["bleaching"]))
    try:
        p.update(json.loads(params or "{}"))
    except Exception:
        pass
    try:
        arch_list = json.loads(arches or "[]")
    except Exception:
        arch_list = []
    scans = []
    for k, f in enumerate(files[:2]):
        path = os.path.join(jdir, f"scan{k}_{''.join(c for c in f.filename if c.isalnum() or c in '-_.')}")
        with open(path, "wb") as fh:
            fh.write(await f.read())
        stem = "".join(c for c in os.path.splitext(f.filename)[0] if c.isalnum() or c in "-_ ").strip().replace(" ", "_") or f"scan{k}"
        scans.append(dict(path=path, name=stem, filename=f.filename, arch=(arch_list[k] if k < len(arch_list) else None) or None))
    clean_name = "".join(c for c in (name or f"{p.get('patient_first','')} {p.get('patient_last','')}".strip() or scans[0]["name"]) if c.isalnum() or c in "-_ ").strip() or "case"
    job = dict(id=jid, dir=jdir, scans=scans, name=clean_name.replace(" ", "_"), params=p, status="queued",
               created=time.time(), filename=", ".join(sc["filename"] for sc in scans), preset=preset)
    JOBS[jid] = job
    # feature caches are big: keep them only for the few most recent cases
    for old in sorted(JOBS.values(), key=lambda j: -j["created"])[4:]:
        old.pop("feat_cache", None)
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return {"id": jid}


@app.post("/api/jobs/{jid}/rerun")
async def rerun(jid: str, edits: str = Form("{}"), params: str = Form("{}")):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    try:
        job["mask_edit"] = json.loads(edits or "{}")
    except Exception:
        job["mask_edit"] = None
    try:
        job["params"].update(json.loads(params or "{}"))
    except Exception:
        pass
    job["status"] = "queued"
    job["auto_order"] = False
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return {"id": jid}


@app.get("/api/jobs")
def list_jobs():
    return [{k: v for k, v in j.items() if k in ("id", "name", "status", "created", "filename", "preset", "review", "source")}
            for j in sorted(JOBS.values(), key=lambda j: -j["created"])]


def _review_view(job):
    return {k: job.get(k) for k in ("id", "name", "status", "review", "order_folder", "order_error")} | {"scans": [dict(arch=sc.get("arch")) for sc in job["scans"]]}


@app.post("/api/jobs/{jid}/approve")
def approve(jid: str):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    job.setdefault("log", [])
    _write_order(job, log=lambda m: job["log"].append(m))
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
    out = {k: v for k, v in job.items() if k in ("id", "name", "status", "log", "error", "preset", "params", "order_folder", "order_error", "review", "source", "progress")}
    out["started"] = job.get("started")
    out["scans"] = [dict(name=sc["name"], filename=sc["filename"], arch=sc.get("arch")) for sc in job["scans"]]
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
