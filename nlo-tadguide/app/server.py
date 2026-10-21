"""NLO TAD Guide - local web app: CBCT + intraoral scan -> matched -> TAD plan -> printable surgical guide.

Runs on one office PC (run_app.py). Patient files stay in this folder (jobs/), are never sent anywhere, and are
deleted after the number of days in Settings. What the app learns is numbers only (training/, see lessons.py).
"""
import os, sys, io, re, json, time, uuid, shutil, threading, queue, traceback, mimetypes, socket, subprocess, html, base64, struct
from collections import OrderedDict
from typing import List, Optional

import numpy as np

for _ext, _mt in ((".js", "application/javascript"), (".mjs", "application/javascript"), (".css", "text/css"),
                  (".html", "text/html"), (".json", "application/json"), (".stl", "model/stl")):
    mimetypes.add_type(_mt, _ext)
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Body
from fastapi.responses import FileResponse, HTMLResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from tadguide import __version__, dicomio, volume, register, meshio, arch as archmod, tads as tadmod, guide as guidemod, lessons, render  # noqa: E402

JOBS_DIR = os.path.join(ROOT, "jobs")
os.makedirs(JOBS_DIR, exist_ok=True)
STATIC = os.path.join(ROOT, "app", "static")
SETTINGS_PATH = os.path.join(ROOT, "settings.json")
SCAN_EXT = (".stl", ".ply", ".obj")

app = FastAPI(title="NLO TAD Guide")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def office_only(request: Request, call_next):
    """Patient data: answer this PC and the office network only (private addresses), nobody else."""
    import ipaddress
    host = (request.client.host if request.client else "") or ""
    try:
        ip = ipaddress.ip_address(host)
        ok = ip.is_loopback or ip.is_private or ip.is_link_local
    except ValueError:
        ok = host in ("localhost", "testclient")
    if not ok:
        return Response("This app answers the office network only.", status_code=403)
    return await call_next(request)


# ------------------------------------------------------------------ settings

def read_settings():
    s = dict(keep_days=30, preform="", guide={})
    try:
        s.update(json.load(open(SETTINGS_PATH, encoding="utf-8")))
    except Exception:
        pass
    return s


def write_settings(s):
    tmp = SETTINGS_PATH + ".tmp"
    json.dump(s, open(tmp, "w", encoding="utf-8"), indent=1)
    os.replace(tmp, SETTINGS_PATH)


def guide_defaults():
    p = lessons.guide_params(guidemod.DEFAULTS)
    p.update({k: v for k, v in (read_settings().get("guide") or {}).items() if k in guidemod.DEFAULTS})
    return p


# ------------------------------------------------------------------ cases

class Case:
    def __init__(self, cid, state=None):
        self.id = cid
        self.dir = os.path.join(JOBS_DIR, cid)
        self.state = state or {}
        self.lock = threading.RLock()
        self.vol = None
        self.scan = None            # (v, f) in the scan file's own coordinates
        self.scan_col = None        # its colours (PLY), for telling teeth from gum
        self.P = self.N = self.teeth = self.fit = None
        self.arch = None
        self.ctx = None
        self.target = None
        self.mesh_cache = {}
        self.guide_mesh = None
        self.last_used = time.time()

    # -- persistence
    def save(self):
        self.state["updated"] = time.time()
        os.makedirs(self.dir, exist_ok=True)
        tmp = os.path.join(self.dir, "case.json.tmp")
        json.dump(self.state, open(tmp, "w", encoding="utf-8"), indent=1, default=_jsonable)
        os.replace(tmp, os.path.join(self.dir, "case.json"))

    def log(self, msg):
        line = f"{time.strftime('%H:%M:%S')}  {msg}"
        print(f"[{self.id}] {msg}", flush=True)
        lg = self.state.setdefault("log", [])
        lg.append(line)
        del lg[:-200]
        self.state["progress"] = msg

    @property
    def T(self):
        r = self.state.get("registration") or {}
        return np.array(r["T"]) if r.get("T") is not None else None


def _jsonable(o):
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return str(o)


CASES = OrderedDict()
CASES_LOCK = threading.Lock()


def _load_cases():
    for d in sorted(os.listdir(JOBS_DIR)):
        p = os.path.join(JOBS_DIR, d, "case.json")
        if os.path.isfile(p):
            try:
                st = json.load(open(p, encoding="utf-8"))
                st["busy"] = False
                if st.get("stage") in ("loading", "matching", "suggesting", "guide_building"):
                    st["stage"] = st.get("resume_stage") or "error"
                    st["error"] = st.get("error") or "The app was restarted while this was running - start that step again."
                CASES[d] = Case(d, st)
            except Exception:
                pass


def get_case(cid):
    c = CASES.get(cid)
    if c is None:
        raise HTTPException(404, "No such case")
    c.last_used = time.time()
    return c


def _evict_heavy(keep):
    """Keep the big arrays of the 2 most recently used cases in memory."""
    heavy = [c for c in CASES.values() if c.vol is not None and c.id != keep]
    heavy.sort(key=lambda c: c.last_used)
    while len(heavy) > 1:
        c = heavy.pop(0)
        with c.lock:
            c.vol = None
            c.ctx = None
            c.target = None
            c.mesh_cache.clear()


def ensure_loaded(c):
    """Volume, scan, match, arch and context of a case back in memory (after a restart or eviction)."""
    with c.lock:
        if c.vol is None:
            vp = os.path.join(c.dir, "cache", "vol.npy")
            if not os.path.isfile(vp):
                raise HTTPException(409, "This case's CBCT is no longer on file.")
            meta = json.load(open(os.path.join(c.dir, "cache", "vol.json"), encoding="utf-8"))
            c.vol = dicomio.Volume(np.load(vp), np.array(meta["affine"]), meta["meta"])
            _evict_heavy(c.id)
        if c.scan is None and c.state.get("scan_file"):
            v, f, _col = meshio.load_scan(os.path.join(c.dir, c.state["scan_file"]))
            c.scan = (v, f)
        if c.T is not None and c.scan is not None and c.P is None:
            _apply_match(c, quiet=True)
        if c.arch is None and c.state.get("match_accepted") and c.P is not None:
            _build_arch(c)
        if c.ctx is None and c.arch is not None:
            c.ctx = tadmod.Context(c.vol, c.state["levels"], c.P, c.scan[1], c.N, c.arch, c.teeth)


# ------------------------------------------------------------------ worker

WORK = queue.Queue()


def enqueue(c, stage, fn, resume_stage=None):
    with c.lock:
        if c.state.get("busy"):
            raise HTTPException(409, "This case is still working - wait for it to finish.")
        c.state["busy"] = True
        c.state["error"] = None
        c.state["resume_stage"] = resume_stage or c.state.get("stage")
        c.state["stage"] = stage
        c.save()
    WORK.put((c, fn))


def _worker():
    while True:
        c, fn = WORK.get()
        try:
            fn(c)
        except Exception as ex:  # noqa
            traceback.print_exc()
            with c.lock:
                c.state["error"] = str(ex) if isinstance(ex, (ValueError, dicomio.DicomError)) else f"{type(ex).__name__}: {ex}"
                c.state["stage"] = c.state.get("resume_stage") or "error"
                c.log("stopped: " + c.state["error"])
        finally:
            with c.lock:
                c.state["busy"] = False
                c.save()


threading.Thread(target=_worker, daemon=True, name="worker").start()


# ------------------------------------------------------------------ pipeline steps

def _load_cbct(c):
    c.log("reading the CBCT")
    src = c.state.get("cbct_path") or os.path.join(c.dir, "cbct_upload")
    vol = dicomio.load([src], workdir=c.dir, progress=c.log)
    os.makedirs(os.path.join(c.dir, "cache"), exist_ok=True)
    np.save(os.path.join(c.dir, "cache", "vol.npy"), vol.data)
    json.dump(dict(affine=vol.affine.tolist(), meta=vol.meta), open(os.path.join(c.dir, "cache", "vol.json"), "w"), default=_jsonable)
    # the unpacked copy of a zip is not needed any more (the volume is cached)
    for d in os.listdir(c.dir):
        if d.startswith("cbct_") and d != "cbct_upload" and os.path.isdir(os.path.join(c.dir, d)):
            shutil.rmtree(os.path.join(c.dir, d), ignore_errors=True)
    c.vol = vol
    _evict_heavy(c.id)
    meta = vol.meta
    c.state["cbct_meta"] = {k: meta.get(k) for k in ("manufacturer", "model", "shape", "spacing", "study_date", "transfer_syntax", "series_count", "warning")}
    if not c.state.get("patient"):
        c.state["patient"] = meta.get("patient_name") or ""
    c.state["study_date"] = meta.get("study_date") or ""
    machine = " ".join(x for x in [meta.get("manufacturer", ""), meta.get("model", "")] if x).strip()
    lv = volume.auto_levels(vol)
    c.state["levels_auto"] = dict(lv)
    offs = lessons.level_offsets(machine)
    if offs:
        for k, dv in offs.items():
            lv[k] = round(lv[k] + dv, 1)
        if lv["dense"] <= lv["bone"]:
            lv = dict(c.state["levels_auto"])
        else:
            lv["source"] = lv["source"] + " + your usual adjustment"
    c.state["levels"] = lv
    c.log(f"levels ({lv['source']}): bone {lv['bone']:.0f}, teeth {lv['dense']:.0f}, enamel {lv['enamel']:.0f}")
    sh, sp = vol.shape, vol.spacing
    c.log(f"CBCT {machine or '(machine not named)'}: {sh[2]} x {sh[1]} x {sh[0]} voxels of {min(sp):.2f} mm")
    c.state["dentition"] = d = volume.find_dentition(vol, lv)
    if d:
        c.log("crowns found: " + ", ".join(f"{a} {d[a]['n']} mm3 of enamel" + (f" (bite plane tilted {d[a]['tilt_deg']:.0f} deg)" if d[a].get("tilt_deg") is not None else "")
                                          for a in ("upper", "lower") if d.get(a)))
    _surfaces(c)


def _surfaces(c):
    vol, lv = c.vol, c.state["levels"]
    dent = c.state.get("dentition")
    bb = bb_bone = None
    if dent and (dent.get("upper") or dent.get("lower")):
        los = [np.array(dent[a]["lo"]) for a in ("upper", "lower") if dent.get(a)]
        his = [np.array(dent[a]["hi"]) for a in ("upper", "lower") if dent.get(a)]
        lo, hi = np.min(los, axis=0), np.max(his, axis=0)
        bb = volume.bbox_mm_to_index(vol, lo - 12, hi + 12)
        # the jaws, not the whole field of view (spine, skull base): around the crowns, up past the zygoma
        bb_bone = volume.bbox_mm_to_index(vol, lo - np.array([28, 28, 35]), hi + np.array([28, 28, 38]))
    c.log("building the bone surface")
    pts, faces, _n = volume.surface(vol, lv["bone"], step_mm=0.5, bbox=bb_bone, max_faces=500_000)
    _store_mesh(c, "bone", pts, faces, volume.bite_height(dent, pts))     # height above the bite: the page can hide the other jaw
    c.log("building the teeth surface")
    pts, faces, _n = volume.surface(vol, lv["dense"], step_mm=0.35, bbox=bb, max_faces=500_000)
    _store_mesh(c, "teeth", pts, faces, volume.bite_height(dent, pts))


def _store_mesh(c, name, V, F, extra=None):
    os.makedirs(os.path.join(c.dir, "cache"), exist_ok=True)
    b = meshio.mesh_bin(V, F, extra)
    open(os.path.join(c.dir, "cache", name + ".bin"), "wb").write(b)
    c.mesh_cache[name] = b


def _load_scan_file(c):
    v, f, col = meshio.load_scan(os.path.join(c.dir, c.state["scan_file"]))
    c.scan = (v, f)
    c.scan_col = col
    c.P = c.N = c.teeth = c.fit = None
    c.arch = None
    c.ctx = None
    c.target = None


def _match(c, mode="auto", **kw):
    ensure_loaded_vol(c)
    if c.scan is None:
        _load_scan_file(c)
    v, f = c.scan
    lv = c.state["levels"]
    arch = c.state.get("arch") or "upper"
    if c.target is None or c.target[1].get("arch") != arch:
        c.log(f"finding the {arch} crowns in the CBCT")
        c.target = register.cbct_target(c.vol, lv, arch)
    if mode == "auto":
        priors = lessons.priors_for(c.state.get("scanner"), arch)
        if priors:
            c.log(f"trying {len(priors)} starting pose(s) learned from earlier {c.state.get('scanner')} scans first")
        res = register.auto_register(c.vol, lv, v, f, arch, priors=priors, progress=c.log, target=c.target, colors=c.scan_col)
    elif mode == "refine":
        res = register.refine(c.vol, lv, v, f, arch, c.T, target=c.target, nsign=(c.state.get("registration") or {}).get("normal_sign", 1.0),
                              colors=c.scan_col)
        res["normal_sign"] = (c.state.get("registration") or {}).get("normal_sign", 1.0)
    else:
        raise ValueError(mode)
    c.state["registration"] = dict(T=np.asarray(res["T"]).tolist(), method=res.get("method"), stats=res.get("stats"),
                                   normal_sign=res.get("normal_sign", 1.0), crowns=res.get("crowns"), when=time.time())
    if res.get("dentition"):
        c.state["dentition"] = res["dentition"]          # the crowns as this match found them (slices centre on them)
    _apply_match(c)


def ensure_loaded_vol(c):
    if c.vol is None:
        vp = os.path.join(c.dir, "cache", "vol.npy")
        meta = json.load(open(os.path.join(c.dir, "cache", "vol.json"), encoding="utf-8"))
        c.vol = dicomio.Volume(np.load(vp), np.array(meta["affine"]), meta["meta"])
        _evict_heavy(c.id)


def _apply_match(c, quiet=False):
    """After any change of the match: matched scan, normals, tooth / gum, fit map, summary."""
    ensure_loaded_vol(c)
    v, f = c.scan
    T = c.T
    lv = c.state["levels"]
    reg = c.state["registration"]
    ns = float(reg.get("normal_sign", 1.0))
    vn = register.vertex_normals(v, f) * ns
    c.P = register.apply(T, v)
    c.N = vn @ T[:3, :3].T
    if c.target is None:
        try:
            c.target = register.cbct_target(c.vol, lv, c.state.get("arch") or "upper")
        except Exception:
            c.target = None
    c.teeth = register.tooth_labels(c.vol, lv, v, vn, T)
    c.fit = register.fit_map(c.target[0], v, vn, T) if c.target else np.full(len(v), np.nan)
    occl = c.target[1]["occlusal"] if c.target else ([0, 0, -1.0] if (c.state.get("arch") or "upper") == "upper" else [0, 0, 1.0])
    reg["summary"] = register.summary(c.fit, c.teeth, register.crown_mask(v, f, c.scan_col, T, occl))
    if not quiet:
        c.log("match: " + reg["summary"]["text"])
    c.mesh_cache.pop("scan", None)
    c.arch = None
    c.ctx = None


def _build_arch(c):
    c.arch = archmod.build(c.state.get("arch") or "upper", c.P, c.N, c.teeth)
    sh = (c.state.get("arch_info") or {}).get("shift")
    if sh:
        c.arch.shift.update(sh)
    c.state["arch_info"] = c.arch.to_json()
    c.ctx = tadmod.Context(c.vol, c.state["levels"], c.P, c.scan[1], c.N, c.arch, c.teeth)


# ------------------------------------------------------------------ pages

@app.get("/", response_class=HTMLResponse)
def index():
    p = os.path.join(STATIC, "index.html")
    return HTMLResponse(open(p, encoding="utf-8").read(), headers={"Cache-Control": "no-store"})


@app.get("/api/version")
def version():
    return dict(version=__version__, host=socket.gethostname(), sites={k: dict(label=v["label"], arches=v["arches"]) for k, v in tadmod.SITES.items()},
                kit=tadmod.KIT, sizes=tadmod.SIZES, guide_defaults=guidemod.DEFAULTS)


def _summary(c):
    st = c.state
    return dict(id=c.id, patient=st.get("patient") or "", created=st.get("created"), updated=st.get("updated"), stage=st.get("stage"),
                busy=bool(st.get("busy")), arch=st.get("arch"), tads=len(st.get("tads") or []), guide=bool((st.get("guide") or {}).get("files")),
                done=bool(st.get("done")), error=st.get("error"), study_date=st.get("study_date"))


@app.get("/api/cases")
def list_cases():
    _housekeeping()
    items = sorted((_summary(c) for c in CASES.values()), key=lambda s: -(s["updated"] or 0))
    return dict(cases=items)


def _safe_rel(name):
    parts = [p for p in re.split(r"[\\/]+", name or "") if p not in ("", ".", "..")]
    parts = [re.sub(r"[^\w.\- ]", "_", p)[:120] for p in parts]
    return os.path.join(*parts) if parts else None


@app.post("/api/cases")
async def create_case(files: List[UploadFile] = File(default=[]), relpaths: str = Form("[]"), arch: str = Form(""),
                      cbct_path: str = Form(""), patient: str = Form("")):
    cid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    c = Case(cid, dict(id=cid, created=time.time(), stage="new", tads=[], log=[], patient=patient.strip()))
    os.makedirs(c.dir, exist_ok=True)
    try:
        rel = json.loads(relpaths or "[]")
    except Exception:
        rel = []
    n_cbct = 0
    for k, uf in enumerate(files or []):
        name = (rel[k] if k < len(rel) and rel[k] else uf.filename) or f"file{k}"
        ext = os.path.splitext(name)[1].lower()
        if ext in SCAN_EXT:
            dst = os.path.join(c.dir, "scan" + ext)
            with open(dst, "wb") as fh:
                shutil.copyfileobj(uf.file, fh, 1 << 20)
            c.state["scan_file"] = "scan" + ext
            c.state["scan_name"] = os.path.basename(name)
            c.state["scanner"] = meshio.scanner_tag(dst)
            if not arch:
                arch = meshio.guess_arch(os.path.basename(name)) or ""
        else:
            r = _safe_rel(name) or f"file{k}"
            dst = os.path.join(c.dir, "cbct_upload", r)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as fh:
                shutil.copyfileobj(uf.file, fh, 1 << 20)
            n_cbct += 1
    cbct_path = (cbct_path or "").strip().strip('"')
    if cbct_path:
        if not os.path.exists(cbct_path):
            shutil.rmtree(c.dir, ignore_errors=True)
            raise HTTPException(400, f"This PC cannot see the folder {cbct_path}.")
        c.state["cbct_path"] = cbct_path
    elif not n_cbct:
        shutil.rmtree(c.dir, ignore_errors=True)
        raise HTTPException(400, "No CBCT in what was dropped - drop the CBCT export folder (or its zip) together with the scan.")
    c.state["arch"] = arch if arch in ("upper", "lower") else (c.state.get("arch") or "upper")
    c.state["arch_guessed"] = arch not in ("upper", "lower")
    with CASES_LOCK:
        CASES[cid] = c
    c.save()

    def job(c):
        _load_cbct(c)
        if c.state.get("scan_file"):
            c.state["stage"] = "matching"
            c.save()
            _match(c)
            c.state["stage"] = "match"
        else:
            c.state["stage"] = "need_scan"
        c.log("ready")
    enqueue(c, "loading", job, resume_stage="error")
    return _state(c)


@app.post("/api/cases/{cid}/scan")
async def add_scan(cid: str, file: UploadFile = File(...), arch: str = Form("")):
    c = get_case(cid)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in SCAN_EXT:
        raise HTTPException(400, "The scan must be an STL, PLY or OBJ file.")
    for old in SCAN_EXT:
        p = os.path.join(c.dir, "scan" + old)
        if os.path.exists(p):
            os.remove(p)
    dst = os.path.join(c.dir, "scan" + ext)
    with open(dst, "wb") as fh:
        shutil.copyfileobj(file.file, fh, 1 << 20)
    c.state.update(scan_file="scan" + ext, scan_name=file.filename, scanner=meshio.scanner_tag(dst), registration=None,
                   match_accepted=False, tads=[], guide=None)
    c.state["arch"] = arch if arch in ("upper", "lower") else (meshio.guess_arch(file.filename or "") or c.state.get("arch") or "upper")
    c.scan = None
    c.mesh_cache.clear()

    def job(c):
        _load_scan_file(c)
        _match(c)
        c.state["stage"] = "match"
    enqueue(c, "matching", job, resume_stage="need_scan")
    return _state(c)


def _state(c):
    st = dict(c.state)
    return JSONResponse(json.loads(json.dumps(st, default=_jsonable)))


@app.get("/api/cases/{cid}")
def case_state(cid: str):
    return _state(get_case(cid))


@app.post("/api/cases/{cid}/rename")
def rename(cid: str, body: dict = Body(...)):
    c = get_case(cid)
    c.state["patient"] = str(body.get("patient") or "").strip()[:80]
    c.save()
    return _state(c)


@app.get("/api/cases/{cid}/mesh/{name}")
def mesh(cid: str, name: str):
    c = get_case(cid)
    if name in c.mesh_cache:
        return Response(c.mesh_cache[name], media_type="application/octet-stream", headers={"Cache-Control": "no-store"})
    p = os.path.join(c.dir, "cache", name + ".bin")
    if name in ("bone", "teeth", "guide") and os.path.isfile(p):
        b = open(p, "rb").read()
        if name in ("bone", "teeth") and len(b) >= 12 and struct.unpack("<III", b[:12])[2] == 0:
            # a surface from before 1.4.1 has no bite height yet: add it, so the other jaw can be hidden
            nv, nf, _ = struct.unpack("<III", b[:12])
            V = np.frombuffer(b, np.float32, nv * 3, 12).reshape(-1, 3)
            F = np.frombuffer(b, np.uint32, nf * 3, 12 + nv * 12).reshape(-1, 3)
            h = volume.bite_height(c.state.get("dentition"), V)
            if h is not None:
                _store_mesh(c, name, V, F, h)
                b = c.mesh_cache[name]
        c.mesh_cache[name] = b
        return Response(b, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})
    if name == "scan":
        ensure_loaded(c)
        if c.scan is None:
            raise HTTPException(404, "no scan")
        if c.P is not None:
            fit = np.where(np.isfinite(c.fit), c.fit, 99.0) if c.fit is not None else None
            if fit is not None and c.teeth is not None:
                fit = np.where(c.teeth, fit, 99.0)          # gum: no colour
            b = meshio.mesh_bin(c.P, c.scan[1], fit)
        else:
            b = meshio.mesh_bin(c.scan[0], c.scan[1])
        c.mesh_cache["scan"] = b
        return Response(b, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})
    if name == "tads":
        Vs, Fs = _tads_mesh(c.state.get("tads") or [])
        return Response(meshio.mesh_bin(Vs, Fs), media_type="application/octet-stream", headers={"Cache-Control": "no-store"})
    raise HTTPException(404, "no such mesh")


def _tads_mesh(tlist):
    Vs, Fs, off = [], [], 0
    for t in tlist:
        v, f = tadmod.cylinder_mesh(t)
        Vs.append(v)
        Fs.append(f + off)
        off += len(v)
    if not Vs:
        return np.zeros((0, 3)), np.zeros((0, 3), int)
    return np.vstack(Vs), np.vstack(Fs)


# ------------------------------------------------------------------ slices

@app.get("/api/cases/{cid}/slice.png")
def slice_png(cid: str, view: str = "axial", x: float = None, y: float = None, z: float = None, tad: str = "", half: float = 15.0,
              px: float = 0.1, roots: int = 1, guide: int = 1, off: float = 0.0, du: float = 0.0, dv: float = 0.0):
    """off: mm along the plane's normal (scrolling through the slices); du / dv: mm along the image's right / up."""
    c = get_case(cid)
    ensure_loaded(c)
    lv = c.state["levels"]
    tl = c.state.get("tads") or []
    scan = (c.P, c.scan[1]) if (c.P is not None and c.scan is not None) else None
    gm = c.guide_mesh if guide else None
    if gm is None and guide and os.path.isfile(os.path.join(c.dir, "cache", "guide.npz")):
        z_ = np.load(os.path.join(c.dir, "cache", "guide.npz"))
        c.guide_mesh = gm = (z_["V"], z_["F"])
    half = float(np.clip(half, 5, 60))
    px = float(np.clip(px, 0.05, 0.5))
    roi = None
    if view.startswith("tad"):
        t = next((t for t in tl if t.get("id") == tad), None)
        if t is None:
            raise HTTPException(404, "no such TAD")
        H, d = np.array(t["head"]), tadmod.unit(t["dir"])
        center = H + d * (t.get("collar", 1.5) + t["length"]) / 2
        if c.arch is not None and t["site"] != "palate":
            _p, tan, buc = c.arch.at(t["s"])
        else:
            tan = np.cross(d, [0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
        md = tadmod.unit(tan - np.dot(tan, d) * d)
        bl = tadmod.unit(np.cross(d, md))
        if view == "tad_md":           # along the screw, seen from the cheek: neighbouring roots left and right
            e1, e2 = md, d
        elif view == "tad_bl":         # along the screw, seen from the side: cortex, depth, sinus
            e1, e2 = bl, d
        else:                          # across the screw at mid-thread
            e1, e2 = md, bl
        if roots and c.ctx is not None:
            roi = c.ctx.roi(center)
    else:
        t = next((t for t in tl if t.get("id") == tad), None) if tad else None
        if t is not None:                                   # an anatomical view through the selected TAD
            H, d = np.array(t["head"]), tadmod.unit(t["dir"])
            center = H + d * (t.get("collar", 1.5) + t["length"]) / 2
            if roots and c.ctx is not None:
                roi = c.ctx.roi(center)
        else:
            if x is None:
                d = c.state.get("dentition") or {}
                a = d.get(c.state.get("arch") or "upper") or {}
                x, y, z = a.get("centroid") or c.vol.index_to_mm(np.array(c.vol.shape[::-1]) / 2)
            center = np.array([x, y, z], float)
        e1, e2 = render.anatomical(view)
    e1, e2 = tadmod.unit(np.asarray(e1, float)), tadmod.unit(np.asarray(e2, float))
    nrm = np.cross(e1, e2)
    center = center + nrm * float(np.clip(off, -60, 60)) + e1 * float(np.clip(du, -80, 80)) + e2 * float(np.clip(dv, -80, 80))
    if roi is not None and (abs(off) > 0 or abs(du) > 0 or abs(dv) > 0) and c.ctx is not None:
        roi = c.ctx.roi(center)                       # the root tint follows the view
    png = render.plane(c.vol, lv, center, e1, e2, half=half, px=px, scan=scan, guide=gm, tads=tl, roi=roi, sel=tad or None)
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.post("/api/cases/{cid}/tads/restore")
def restore_tads(cid: str, body: dict = Body(...)):
    """Undo: put back an earlier list of TADs (as the page kept it). Measured again, so the numbers are live."""
    c = get_case(cid)
    ensure_loaded(c)
    if c.ctx is None:
        raise HTTPException(409, "Accept the match first.")
    out = []
    for t in body.get("tads") or []:
        if not isinstance(t, dict) or "head" not in t or "dir" not in t:
            continue
        t = dict(t)
        t["id"] = str(t.get("id") or _new_tad_id())[:12]
        try:
            t["metrics"] = c.ctx.measure(t)
        except Exception:
            continue
        out.append(t)
    c.state["tads"] = out
    c.state["guide_stale"] = bool(c.state.get("guide"))
    c.save()
    return _state(c)


# ------------------------------------------------------------------ matching

@app.post("/api/cases/{cid}/register")
def do_register(cid: str, body: dict = Body(...)):
    c = get_case(cid)
    mode = body.get("mode", "auto")
    if mode in ("auto", "refine"):
        if mode == "auto" and body.get("arch") in ("upper", "lower"):
            c.state["arch"] = body["arch"]
            c.target = None

        def job(c, mode=mode):
            ensure_loaded_vol(c)
            if c.scan is None:
                _load_scan_file(c)
            _match(c, mode=mode)
            c.state["match_accepted"] = False
            c.state["stage"] = "match"
        enqueue(c, "matching", job, resume_stage="match")
        return _state(c)
    ensure_loaded(c)
    if mode == "landmarks":
        sp = np.array(body["scan"], float)          # picks on the scan as shown (world coords of the shown scan)
        cp = np.array(body["cbct"], float)
        off = np.array(body.get("scan_offset") or [0, 0, 0], float)
        T = c.T if c.T is not None else np.eye(4)
        sp_file = register.apply(np.linalg.inv(T), sp - off)
        T2, res = register.landmarks(sp_file, cp)
        c.state["registration"] = dict(T=T2.tolist(), method="3 points", stats=dict(point_residuals=res.round(2).tolist()),
                                       normal_sign=(c.state.get("registration") or {}).get("normal_sign", 1.0), when=time.time())
        _apply_match(c)
        # then let the surfaces settle it - with the scan's surface facing either way (scan files differ), and
        # only if that fits better than the three points alone
        best = None
        for ns in (1.0, -1.0):
            r = register.refine(c.vol, c.state["levels"], c.scan[0], c.scan[1], c.state.get("arch") or "upper", T2, target=c.target,
                                nsign=ns, colors=c.scan_col)
            q = r["quality"]["within_10"] + r["quality"]["within_05"]
            if best is None or q > best[0]:
                best = (q, r, ns)
        q, r, ns = best
        if q > 0.3:
            c.state["registration"].update(T=np.asarray(r["T"]).tolist(), method="3 points + surface", stats=r["stats"], normal_sign=ns)
        _apply_match(c)
    elif mode == "restore":
        T = np.asarray(body.get("T"), float)
        if T.shape != (4, 4):
            raise HTTPException(400, "bad T")
        reg = c.state.get("registration") or {}
        c.state["registration"] = dict(reg, T=T.tolist(), method=str(body.get("method") or reg.get("method") or "restored"),
                                       normal_sign=float(body.get("normal_sign") or reg.get("normal_sign", 1.0)), when=time.time())
        _apply_match(c)
    elif mode == "nudge":
        T = c.T
        d = np.array(body.get("d") or [0, 0, 0], float)
        rdeg = np.array(body.get("r") or [0, 0, 0], float)
        cen = c.P.mean(axis=0)
        Rn = register.rodrigues(np.radians(rdeg))
        Tn = register.make_T(Rn, cen - Rn @ cen + d)
        c.state["registration"]["T"] = (Tn @ T).tolist()
        c.state["registration"]["method"] = (c.state["registration"].get("method") or "") .split(" +")[0] + " + adjusted"
        _apply_match(c)
    else:
        raise HTTPException(400, "unknown mode")
    c.state["match_accepted"] = False
    c.state["stage"] = "match"
    c.save()
    return _state(c)


@app.post("/api/cases/{cid}/accept")
def accept(cid: str):
    c = get_case(cid)
    ensure_loaded(c)
    if c.P is None:
        raise HTTPException(409, "Nothing matched yet.")
    c.state["match_accepted"] = True
    _build_arch(c)
    c.state["stage"] = "plan"
    # TADs placed before a re-match keep their place relative to the CBCT
    for t in c.state.get("tads") or []:
        t["metrics"] = c.ctx.measure(t)
    c.save()
    return _state(c)


@app.post("/api/cases/{cid}/levels")
def set_levels(cid: str, body: dict = Body(...)):
    c = get_case(cid)
    lv = dict(c.state["levels"])
    for k in ("bone", "dense"):
        if body.get(k) is not None:
            lv[k] = float(body[k])
    if lv["dense"] <= lv["bone"]:
        raise HTTPException(400, "The teeth level must be above the bone level.")
    lv["source"] = "set by hand"
    c.state["levels"] = lv

    def job(c):
        ensure_loaded_vol(c)
        c.state["dentition"] = volume.find_dentition(c.vol, lv)
        _surfaces(c)
        c.target = None
        if c.scan is not None and c.T is not None:
            if c.scan is None:
                _load_scan_file(c)
            _apply_match(c)
            if c.state.get("match_accepted"):
                _build_arch(c)
        c.log("levels applied")
    enqueue(c, "loading", job, resume_stage=c.state.get("stage"))
    return _state(c)


@app.post("/api/cases/{cid}/arch")
def arch_shift(cid: str, body: dict = Body(...)):
    c = get_case(cid)
    ensure_loaded(c)
    side = body.get("side")
    if side not in ("L", "R") or c.arch is None:
        raise HTTPException(400, "side L or R, after the match is accepted")
    c.arch.shift[side] = int(np.clip(c.arch.shift.get(side, 0) + int(body.get("delta", 0)), -2, 2))
    c.state["arch_info"] = c.arch.to_json()
    for t in c.state.get("tads") or []:
        t["label"] = c.ctx.label(t)
    c.save()
    return _state(c)


# ------------------------------------------------------------------ TADs

def _new_tad_id():
    return uuid.uuid4().hex[:6]


def _prefs(c, site):
    arch = c.state.get("arch") or "upper"
    sd = tadmod.SITES[site]
    p = dict(a=sd["a"].get(arch, 10.0), alpha=sd["alpha"].get(arch, 20.0), beta=0.0, size=list(sd["size"].get(arch, (1.6, 8.0, 2.0))),
             product=(sd.get("product") or {}).get(arch))
    learned = lessons.site_prefs(site, arch)
    if learned and learned.get("n", 0) >= 2:
        p.update({k: v for k, v in learned.items() if k in ("a", "alpha", "beta", "size", "product")})
        if "size" in learned and "product" not in learned:
            p["product"] = tadmod.product_for(p["size"][0], p["size"][1], p.get("product"))
    return p


@app.post("/api/cases/{cid}/suggest")
def suggest(cid: str, body: dict = Body(...)):
    c = get_case(cid)
    site = body.get("site", "buccal")
    sides = [s for s in (body.get("sides") or ["R", "L"]) if s in ("R", "L")]
    if site not in tadmod.SITES:
        raise HTTPException(400, "unknown site")

    def job(c):
        ensure_loaded(c)
        if c.ctx is None:
            raise ValueError("Accept the match first.")
        c.log(f"looking for {tadmod.SITES[site]['label'].lower()} sites")
        pr = _prefs(c, site)
        res = c.ctx.suggest(site, sides=sides, prefs=pr)
        for r in res:
            r["id"] = _new_tad_id()
            r["product"] = tadmod.product_for(r["diameter"], r["length"], pr.get("product"))
            r.pop("metrics", None)
            r["metrics"] = c.ctx.measure(r)
        c.state["suggestions"] = dict(site=site, items=res, when=time.time())
        ok = sum(1 for r in res if r["metrics"]["status"] == "ok")
        c.log(f"{len(res)} sites checked, {ok} without warnings")
    enqueue(c, "suggesting", job, resume_stage="plan")
    return _state(c)


@app.post("/api/cases/{cid}/tads")
def add_tad(cid: str, body: dict = Body(...)):
    c = get_case(cid)
    ensure_loaded(c)
    if c.ctx is None:
        raise HTTPException(409, "Accept the match first.")
    if body.get("suggestion"):
        sug = next((s for s in (c.state.get("suggestions") or {}).get("items", []) if s["id"] == body["suggestion"]), None)
        if sug is None:
            raise HTTPException(404, "That suggestion is gone - look for sites again.")
        t = dict(sug)
        t["from_suggestion"] = True
        t["hand"] = False             # the app's own choice: not a habit to learn (it would only learn from itself)
    else:
        site = body.get("site", "buccal")
        if site not in tadmod.SITES:
            raise HTTPException(400, "unknown site")
        p = np.array(body["point"], float)
        A = c.arch
        pr = _prefs(c, site)
        size, product = _size_from(body, tuple(pr["size"]), pr.get("product"))
        if site == "palate":
            q = A.to_plane(p)
            side = "L" if q[0] >= 0 else "R"
            t = c.ctx.place(site, side, 0, 0, pr["alpha"], pr["beta"], size, u_w=(float(q[0]), float(q[1])))
        else:
            s, _off = A.s_of(p[None])
            s = float(s[0])
            a = float(-np.dot(p - A.O, A.n))
            side = "L" if s >= 0 else "R"
            t = c.ctx.place(site, side, s, max(0.0, a), pr["alpha"], pr["beta"], size)
        if t is None:
            raise HTTPException(400, "Could not reach the gum there along that direction - click a little further from the teeth.")
        t["gap"] = None
        t["hand"] = True
        t["product"] = product
    t["id"] = _new_tad_id()
    t["metrics"] = c.ctx.measure(t)
    t["label"] = c.ctx.label(t)
    c.state.setdefault("tads", []).append(t)
    c.state["stage"] = "plan"
    c.save()
    return _state(c)


def _size_from(body, size, product):
    """(diameter, length, collar) and the kit product from a request: {product: id} takes that TAD of the kit,
    {size: [d, l, collar]} a size (and keeps the product when it is still that size); else what was there."""
    pid = body.get("product")
    if pid:
        k = tadmod.KIT_BY_ID.get(pid)
        if k is None:
            raise HTTPException(400, "unknown TAD")
        return (k["d"], k["l"], k["c"]), pid
    if body.get("size"):
        sz = [float(x) for x in body["size"]]
        if len(sz) == 2:
            sz.append(float(size[2]))
        if not (1.0 <= sz[0] <= 3.0 and 4.0 <= sz[1] <= 20.0 and 0.0 <= sz[2] <= 6.0):
            raise HTTPException(400, "That size is out of range.")
        size = tuple(sz[:3])
    return tuple(size), tadmod.product_for(size[0], size[1], product)


def _replace_tad(c, tid, t):
    tl = c.state.get("tads") or []
    for i, x in enumerate(tl):
        if x["id"] == tid:
            t["id"] = tid
            tl[i] = t
            break
    c.state["tads"] = tl
    c.state["guide_stale"] = bool(c.state.get("guide"))


@app.patch("/api/cases/{cid}/tads/{tid}")
def edit_tad(cid: str, tid: str, body: dict = Body(...)):
    c = get_case(cid)
    ensure_loaded(c)
    t = next((x for x in c.state.get("tads") or [] if x["id"] == tid), None)
    if t is None:
        raise HTTPException(404, "no such TAD")
    size, product = _size_from(body, (t["diameter"], t["length"], t.get("collar", 2.0)), t.get("product"))
    al = t["alpha"] + float(body.get("dalpha", 0))
    be = t["beta"] + float(body.get("dbeta", 0))
    A = c.arch
    if body.get("dir") is not None:
        # aimed by hand in 3D: the head stays, the direction is the given one; the angles are read back from it
        d = tadmod.unit(np.asarray(body["dir"], float))
        if t["site"] == "palate":
            al = float(np.degrees(np.arcsin(np.clip(np.dot(d, A.L * (1 if t["s"] >= 0 else -1)), -1, 1))))
            be = float(np.degrees(np.arcsin(np.clip(np.dot(d, A.A), -1, 1))))
        else:
            _p, tan, buc = A.at(t["s"])
            inward = -buc if t["site"] in ("buccal", "izc", "shelf") else buc
            al = float(np.degrees(np.arctan2(np.dot(d, -A.n), max(1e-6, np.dot(d, inward)))))
            be = float(np.degrees(np.arcsin(np.clip(np.dot(d, tan * (1 if t["s"] >= 0 else -1)), -1, 1))))
        n = dict(t)
        n.pop("metrics", None)
        n["dir"] = d.tolist()
        n["alpha"], n["beta"] = al, be
        n["diameter"], n["length"], n["collar"] = size
        n["head"] = (np.array(t["head"]) - tadmod.unit(t["dir"]) * float(t.get("depth", 0.0))).tolist()   # depth re-applied below
    elif body.get("point") is not None:
        # dragged along the gum in 3D: re-placed at that spot with its angles
        p = np.asarray(body["point"], float)
        if t["site"] == "palate":
            q = A.to_plane(p)
            n = c.ctx.place("palate", "L" if q[0] >= 0 else "R", 0, 0, al, be, size, u_w=(float(q[0]), float(q[1])))
        else:
            s_, _off = A.s_of(p[None])
            s_ = float(s_[0])
            a_ = float(-np.dot(p - A.O, A.n))
            n = c.ctx.place(t["site"], "L" if s_ >= 0 else "R", s_, max(0.0, a_), al, be, size)
    elif t["site"] == "palate":
        u, w = t.get("uw") or (t["s"], 0.0)
        u += float(body.get("du", 0)) + float(body.get("ds", 0))
        w += float(body.get("dw", 0)) + float(body.get("da", 0))
        n = c.ctx.place("palate", "L" if u >= 0 else "R", 0, 0, al, be, size, u_w=(u, w))
    else:
        n = c.ctx.place(t["site"], t["side"], t["s"] + float(body.get("ds", 0)) * (1 if t["s"] >= 0 else -1), max(0.0, t["a"] + float(body.get("da", 0))), al, be, size)
    if n is None:
        raise HTTPException(400, "That move takes the screw off the gum - try a smaller step.")
    if body.get("dir") is not None:
        n["label"] = c.ctx.label(n)
    depth = float(t.get("depth", 0.0)) + float(body.get("depth", 0.0))
    if depth:
        dd = tadmod.unit(n["dir"])
        n["head"] = (np.array(n["head"]) + dd * depth).tolist()
    n["depth"] = depth
    n["gap"] = t.get("gap")
    n["from_suggestion"] = t.get("from_suggestion", False)
    n["edited"] = True
    n["hand"] = True                  # he moved, tilted or resized it: how he wants it
    n["product"] = product
    n["metrics"] = c.ctx.measure(n)
    _replace_tad(c, tid, n)
    c.save()
    return _state(c)


@app.post("/api/cases/{cid}/tads/{tid}/optimize")
def optimize_tad(cid: str, tid: str):
    c = get_case(cid)
    ensure_loaded(c)
    t = next((x for x in c.state.get("tads") or [] if x["id"] == tid), None)
    if t is None:
        raise HTTPException(404, "no such TAD")
    size = (t["diameter"], t["length"], t.get("collar", 1.5))
    if t["site"] == "palate":
        n = c.ctx.optimize("palate", t["side"], 0, 0, t["alpha"], t["beta"], size, u_w=tuple(t.get("uw") or (t["s"], 0.0)))
    else:
        n = c.ctx.optimize(t["site"], t["side"], t["s"], t["a"], t["alpha"], t["beta"], size, ds=1.5, da=1.5, dal=8, dbe=8)
    if n is None:
        raise HTTPException(400, "No better spot nearby.")
    n["gap"] = t.get("gap")
    n["edited"] = True
    n["from_suggestion"] = t.get("from_suggestion", False)
    n["hand"] = False                 # the angles are the fine-tune's now, not his (until he changes it again)
    n["product"] = t.get("product")
    n["metrics"]["status"], n["metrics"]["notes"] = tadmod.judge(n, n["metrics"])     # with the product's own notes
    _replace_tad(c, tid, n)
    c.save()
    return _state(c)


@app.delete("/api/cases/{cid}/tads/{tid}")
def delete_tad(cid: str, tid: str):
    c = get_case(cid)
    c.state["tads"] = [x for x in c.state.get("tads") or [] if x["id"] != tid]
    c.state["guide_stale"] = bool(c.state.get("guide"))
    c.save()
    return _state(c)


# ------------------------------------------------------------------ guide

@app.get("/api/guide/defaults")
def guide_defaults_api():
    return guide_defaults()


@app.post("/api/cases/{cid}/guide")
def make_guide(cid: str, body: dict = Body(default={})):
    c = get_case(cid)
    if not c.state.get("tads"):
        raise HTTPException(400, "Place at least one TAD first.")
    params = guide_defaults()
    params.update({k: (float(v) if not isinstance(v, bool) else v) for k, v in (body.get("params") or {}).items() if k in guidemod.DEFAULTS})

    def job(c):
        ensure_loaded(c)
        c.log("making the guide")
        V, F, info = guidemod.build(c.P, c.scan[1], c.N, c.teeth, c.state["tads"], c.arch, params, progress=c.log)
        holes = guidemod.check_holes(V, F, c.state["tads"], params["hole"])
        info["holes"] = holes
        c.guide_mesh = (V, F)
        np.savez_compressed(os.path.join(c.dir, "cache", "guide.npz"), V=V.astype(np.float32), F=F.astype(np.int32))
        _store_mesh(c, "guide", V, F)
        # files in the scan file's own coordinates (they sit on the scan / printed model)
        Tinv = np.linalg.inv(c.T)
        name = _file_stem(c)
        os.makedirs(os.path.join(c.dir, "out"), exist_ok=True)
        gpath = os.path.join(c.dir, "out", f"{name}_TAD-guide.stl")
        meshio.write_stl(gpath, register.apply(Tinv, V), F)
        tv, tf = _tads_mesh(c.state["tads"])
        tpath = os.path.join(c.dir, "out", f"{name}_TADs-check.stl")
        meshio.write_stl(tpath, register.apply(Tinv, tv), tf)
        c.state["guide"] = dict(params=params, info=info, files=dict(guide=os.path.basename(gpath), tads=os.path.basename(tpath)), when=time.time())
        c.state["guide_stale"] = False
        c.state["stage"] = "guide"
        if info.get("warning"):
            c.log(info["warning"])
        if not all(h["clear"] for h in holes):
            c.log("WARNING: a sleeve hole is blocked - check the guide.")
    enqueue(c, "guide_building", job, resume_stage="plan")
    return _state(c)


def _file_stem(c):
    nm = re.sub(r"[^\w\-]+", "_", (c.state.get("patient") or "patient").strip()) or "patient"
    return f"{nm}_{(c.state.get('arch') or 'arch')}_{time.strftime('%Y-%m-%d', time.localtime(c.state.get('created') or time.time()))}"


@app.get("/api/cases/{cid}/file/{what}")
def get_file(cid: str, what: str):
    c = get_case(cid)
    g = c.state.get("guide") or {}
    if what in ("guide", "tads"):
        fn = (g.get("files") or {}).get(what)
        if not fn:
            raise HTTPException(404, "Make the guide first.")
        return FileResponse(os.path.join(c.dir, "out", fn), filename=fn, media_type="model/stl")
    if what == "scan_matched":
        ensure_loaded(c)
        p = os.path.join(c.dir, "out", f"{_file_stem(c)}_scan-on-CBCT.stl")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        meshio.write_stl(p, c.P, c.scan[1])
        return FileResponse(p, filename=os.path.basename(p), media_type="model/stl")
    if what == "plan":
        return JSONResponse(dict(patient=c.state.get("patient"), arch=c.state.get("arch"), registration=c.state.get("registration"),
                                 tads=c.state.get("tads"), guide=g.get("params")), headers={"Content-Disposition": f'attachment; filename="{_file_stem(c)}_plan.json"'})
    if what == "report":
        return HTMLResponse(_report(c))
    raise HTTPException(404, "unknown file")


def _seat_text(gi):
    if gi.get("split"):
        sides = ", ".join(f"{'right' if q.get('side') == 'R' else 'left'} {float(q.get('tilt_deg') or 0):.0f} deg"
                          for q in gi.get("per_side") or [])
        return f"two guides, one per side, each seated at its own angle ({sides})"
    t = float(gi.get("tilt_deg") or 0)
    return "seats straight occlusal" if t < 0.5 else f"seats {t:.0f} deg tilted toward the TAD side"


def _report(c):
    ensure_loaded(c)
    st = c.state
    g = st.get("guide") or {}
    reg = st.get("registration") or {}
    rows = []
    for t in st.get("tads") or []:
        m = t.get("metrics") or {}
        imgs = []
        for v in ("tad_md", "tad_bl"):
            try:
                png = slice_png(c.id, view=v, tad=t["id"], half=12.0, px=0.08).body
                imgs.append(f'<img src="data:image/png;base64,{base64.b64encode(png).decode()}" alt="{v}">')
            except Exception:
                pass
        notes = "".join(f"<li>{html.escape(n)}</li>" for n in m.get("notes") or [])
        rows.append(f"""<section class="tad"><h2>{html.escape(t.get('label',''))} <span class="st {m.get('status','')}">{html.escape(m.get('status',''))}</span></h2>
<p><b>{html.escape(tadmod.product_name(t))}</b>{'' if not t.get('product') else f" ({t['diameter']} x {t['length']} mm)"}, collar {t.get('collar',2.0)} mm &middot; tilt {t.get('alpha',0):.0f}&deg; apical, {t.get('beta',0):.0f}&deg; mesiodistal</p>
<table><tr><td>Root clearance</td><td>{('none near' if (m.get('root_clearance') or 0) >= 20 else str(m.get('root_clearance','-')) + ' mm')}</td><td>Cortical bone (along the screw)</td><td>{m.get('cortical','-')} mm</td></tr>
<tr><td>Soft tissue</td><td>{m.get('soft_tissue','-')} mm</td><td>Thread in bone</td><td>{m.get('bone_in_thread','-')} mm</td></tr></table>
<ul>{notes}</ul><div class="imgs">{''.join(imgs)}</div></section>""")
    gp = g.get("params") or {}
    gi = g.get("info") or {}
    stop = (gp.get("tissue_gap", 0) or 0) + (gp.get("sleeve_height", 0) or 0)
    guide_html = (f"<p>Fit gap {gp.get('gap_teeth')} mm, gum relief {gp.get('gap_gum')} mm, shell {gp.get('thickness')} mm, sleeve hole {gp.get('hole')} mm, "
                  f"sleeve {gp.get('sleeve_height')} mm tall standing {gp.get('tissue_gap')} mm off the gum. "
                  f"<b>Driver stop: the sleeve top is {stop:.1f} mm above the seated TAD head</b> (along the screw).</p>"
                  f"<p>{gi.get('volume_ml','-')} mL, watertight: {gi.get('watertight')}, {_seat_text(gi)}.</p>") if g else "<p>No guide made yet.</p>"
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>TAD plan - {html.escape(st.get('patient') or '')}</title>
<style>body{{font-family:Segoe UI,Arial,sans-serif;color:#1B2F4C;margin:24px;max-width:900px}}h1{{font-size:20px;margin:0 0 4px}}
h2{{font-size:15px;margin:18px 0 6px}}.st{{font-size:11px;padding:2px 8px;border-radius:9px;background:#E2FBF4;color:#1F9E7E;text-transform:uppercase}}
.st.caution{{background:#FEF2D7;color:#C2820A}}.st.stop{{background:#FFE7E1;color:#D8412E}}table{{border-collapse:collapse;font-size:13px}}
td{{padding:3px 10px 3px 0}}.imgs img{{width:48%;margin-right:1%;border-radius:6px}}.muted{{color:#6B7685;font-size:12px}}
section.tad{{page-break-inside:avoid;border-top:1px solid #DCE0E4;padding-top:6px}}</style></head><body>
<h1>TAD plan &middot; {html.escape(st.get('patient') or 'patient')}</h1>
<p class="muted">{html.escape(st.get('arch') or '')} arch &middot; CBCT {html.escape(st.get('study_date') or '')} &middot; planned {time.strftime('%m/%d/%Y')} &middot; NLO TAD Guide {__version__}</p>
<p>Scan matched to the CBCT: {html.escape(((reg.get('summary') or {}).get('text')) or '-')} ({html.escape(reg.get('method') or '')}).</p>
{''.join(rows)}
<h2>Guide</h2>{guide_html}
<p class="muted">Roots, cortex and sinus are estimated from the CBCT's grey values (red in the images = what was counted as root).
The images are what to trust. The guide is designed for Formlabs Surgical Guide resin; check its seat on the teeth and the sleeve
direction before use.</p></body></html>"""


@app.post("/api/cases/{cid}/preform")
def open_preform(cid: str, request: Request):
    c = get_case(cid)
    fn = ((c.state.get("guide") or {}).get("files") or {}).get("guide")
    if not fn:
        raise HTTPException(404, "Make the guide first.")
    host = (request.client.host if request.client else "") or ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(400, "PreForm opens on the PC that runs the app - download the STL here instead.")
    exe = _find_preform()
    if not exe:
        raise HTTPException(404, "PreForm was not found on this PC - set its path in Settings.")
    subprocess.Popen([exe, os.path.join(c.dir, "out", fn)], close_fds=True)
    return dict(ok=True)


def _find_preform():
    s = read_settings()
    if s.get("preform") and os.path.isfile(s["preform"]):
        return s["preform"]
    for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")):
        for sub in ("Formlabs\\PreForm\\PreForm.exe", "PreForm\\PreForm.exe"):
            p = os.path.join(base, sub)
            if os.path.isfile(p):
                return p
    return None


# ------------------------------------------------------------------ finishing, lessons, settings

@app.post("/api/cases/{cid}/finish")
def finish(cid: str):
    c = get_case(cid)
    c.state["lesson_id"] = lessons.save(c.state)
    c.state["done"] = True
    c.state["stage"] = "done"
    c.save()
    return _state(c)


@app.post("/api/cases/{cid}/reopen")
def reopen(cid: str):
    c = get_case(cid)
    c.state["done"] = False
    c.state["stage"] = "guide" if (c.state.get("guide") or {}).get("files") else ("plan" if c.state.get("match_accepted") else "match")
    c.save()
    return _state(c)


@app.post("/api/cases/{cid}/feedback")
def feedback(cid: str, body: dict = Body(...)):
    c = get_case(cid)
    fb = {k: body.get(k) for k in ("fit", "sleeve", "note") if body.get(k)}
    for k in ("fit", "sleeve"):
        if fb.get(k) and fb[k] not in ("tight", "good", "loose"):
            raise HTTPException(400, "tight / good / loose")
    c.state["lesson_feedback"] = dict(c.state.get("lesson_feedback") or {}, **fb)
    if not c.state.get("lesson_id"):
        c.state["lesson_id"] = lessons.save(c.state)
    else:
        lessons.add_feedback(c.state["lesson_id"], fb.get("fit"), fb.get("sleeve"), fb.get("note") or "")
    c.save()
    return _state(c)


@app.post("/api/cases/{cid}/discard")
def discard(cid: str):
    c = get_case(cid)
    if c.state.get("busy"):
        raise HTTPException(409, "Still working - wait a moment.")
    with CASES_LOCK:
        CASES.pop(cid, None)
    shutil.rmtree(c.dir, ignore_errors=True)
    return dict(ok=True)


@app.get("/api/learn")
def learn_status():
    return lessons.status(guidemod.DEFAULTS)


@app.get("/api/settings")
def get_settings():
    s = read_settings()
    s["preform_found"] = _find_preform() or ""
    s["guide_learned"] = lessons.guide_params(guidemod.DEFAULTS)
    return s


@app.post("/api/settings")
def save_settings(body: dict = Body(...)):
    s = read_settings()
    if "keep_days" in body:
        s["keep_days"] = int(np.clip(int(body["keep_days"]), 1, 365))
    if "preform" in body:
        s["preform"] = str(body["preform"] or "").strip().strip('"')
    if "guide" in body and isinstance(body["guide"], dict):
        s["guide"] = {k: float(v) for k, v in body["guide"].items() if k in guidemod.DEFAULTS and not isinstance(v, bool) and v not in (None, "")}
    write_settings(s)
    return get_settings()


_LAST_CLEAN = [0.0]


def _housekeeping():
    """Patient files are kept `keep_days` (Settings, default 30) after the case was last touched, then deleted."""
    now = time.time()
    if now - _LAST_CLEAN[0] < 3600:
        return
    _LAST_CLEAN[0] = now
    keep = read_settings().get("keep_days", 30) * 86400
    for cid, c in list(CASES.items()):
        if c.state.get("busy"):
            continue
        if now - float(c.state.get("updated") or c.state.get("created") or now) > keep:
            if not c.state.get("lesson_id") and c.state.get("tads") and c.state.get("match_accepted"):
                try:
                    c.state["lesson_id"] = lessons.save(c.state)
                except Exception:
                    pass
            with CASES_LOCK:
                CASES.pop(cid, None)
            shutil.rmtree(c.dir, ignore_errors=True)
            print(f"[{cid}] removed after {keep // 86400} days", flush=True)


_load_cases()
