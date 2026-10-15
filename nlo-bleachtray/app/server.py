"""Local web app: drop a scan STL, get a print-ready bleaching-tray model + Trimlign trimline."""
import os, sys, io, json, uuid, threading, time, struct, traceback
import numpy as np
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


def _run(job):
    job["status"] = "running"
    job["log"] = []
    try:
        def log(msg):
            job["log"].append(msg)
        reports = []
        for k, scan in enumerate(job["scans"]):
            override = None
            if job.get("mask_edit") is not None and job["mask_edit"].get("scan", 0) == k:
                override = _apply_mask_edit(job, k)
            params = dict(job["params"]); params["arch"] = scan.get("arch") or None
            rep = process(scan["path"], job["dir"], name=scan["name"], params=params, models=MODELS,
                          label_override=override, log=log)
            scan["arch"] = rep["arch"]; scan["report"] = rep
            reports.append(rep)
        job["report"] = reports[0]
        job["reports"] = reports
        job["mask_edit"] = None
        root = (job["params"].get("order_root") or "").strip()
        if root and job["params"].get("patient_first") and job["params"].get("patient_last"):
            pieces = [dict(arch=sc["arch"], stl=sc["report"]["outputs"]["model"], pts=sc["report"]["outputs"]["trimline"],
                           stage=int(job["params"].get("stage", 0)), kind=job["params"].get("kind", "T")) for sc in job["scans"]]
            try:
                folder = write_order_folder(root, job["params"]["patient_first"], job["params"]["patient_last"], pieces,
                                            patient_id=job["params"].get("patient_id") or None,
                                            doctor=job["params"].get("doctor") or "Dr. Amir Akhavan")
                job["order_folder"] = folder
                log(f"OrthoFactory order written: {folder}")
            except Exception as ex:  # noqa
                job["order_error"] = str(ex)
                log(f"order folder failed: {ex}")
        job["status"] = "done"
    except Exception as ex:  # noqa
        job["status"] = "error"
        job["error"] = f"{ex}\n{traceback.format_exc()}"


def _apply_mask_edit(job, k=0):
    """Turn brush edits (vertex index lists) into corrected per-tooth labels."""
    from bleachtray.mesh_utils import load_scan
    from bleachtray.orient import rough_orient
    from bleachtray.segment import predict_tooth_prob, clean_mask, split_teeth, merge_small_teeth, resplit_elongated
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
    p_tooth, p_ip, aux = predict_tooth_prob(mesh, MODELS)
    A = aux["A"]
    mask = clean_mask(mask, A)
    labels, _ = split_teeth(mesh, mask, p_ip, A, aux, erode_mm=2.0, concave_cut=-9)
    labels = merge_small_teeth(mesh, labels, A)
    labels = resplit_elongated(mesh, labels, A, aux)
    labels = merge_small_teeth(mesh, labels, A)
    return labels


@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(ROOT, "app", "static", "index.html"), encoding="utf-8") as f:
        return f.read()


@app.get("/api/presets")
def presets():
    return {"defaults": DEFAULTS, "presets": PRESETS}


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
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return {"id": jid}


@app.get("/api/jobs")
def list_jobs():
    return [{k: v for k, v in j.items() if k in ("id", "name", "status", "created", "filename", "preset")}
            for j in sorted(JOBS.values(), key=lambda j: -j["created"])]


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    out = {k: v for k, v in job.items() if k in ("id", "name", "status", "log", "error", "preset", "params", "order_folder", "order_error")}
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
