"""NLO X-Ray Reader - the local web app.

Serves the page to the office network and keeps everything in this app folder on this PC: the x-rays
(cases/), the tracings, the trained network (models/) and the settings (settings.json). It makes no
outbound connections, and every page it serves carries a Content-Security-Policy that stops the browser
from loading or sending anything to anywhere but this PC.
"""
import asyncio
import base64
import io
import re
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sys
import threading
import time

for _ext, _mt in ((".js", "application/javascript"), (".mjs", "application/javascript"), (".css", "text/css"),
                  (".html", "text/html"), (".json", "application/json"), (".woff2", "font/woff2"),
                  (".png", "image/png"), (".svg", "image/svg+xml")):
    mimetypes.add_type(_mt, _ext)   # Windows registries sometimes map .js to text/plain

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from xray import __version__  # noqa: E402
from xray import geometry as geo  # noqa: E402
from xray.analysis import DEFAULT_CUTOFFS, DEFAULT_NORMS, MEASURES, analyze  # noqa: E402
from xray.cvm import DEFAULT_THRESHOLDS, clean_marks  # noqa: E402
from xray import iortho  # noqa: E402
from xray.imageio import ImageReadError, is_dicom_bytes, load_png  # noqa: E402
from xray.landmarks import ANCHORS, CODES, GROUP_OF, public_definitions  # noqa: E402
from xray.shape import fill_missing, mean_shape, place_from_anchors  # noqa: E402
from xray.store import Store, age_years  # noqa: E402
from xray.train import MIN_CASES, Nightly, Trainer  # noqa: E402

STATIC = os.path.join(ROOT, "app", "static")
# where the x-rays, tracings, networks and settings are kept: the app folder, unless NLO_XRAY_DATA says otherwise
DATA = os.environ.get("NLO_XRAY_DATA") or ROOT
os.makedirs(DATA, exist_ok=True)
SETTINGS_PATH = os.path.join(DATA, "settings.json")
SESSIONS_PATH = os.path.join(DATA, "sessions.json")
MAX_UPLOAD = 200 * 1024 * 1024

DEFAULT_SETTINGS = {
    "norms": {},
    "cutoffs": {},
    "cvm": {"mode": "auto", "thresholds": {}, "tuned": None},
    "calibration": {"default_mm_per_px": None, "magnification": 1.13},
    "learning": {"nightly": True, "window_start": 19, "window_end": 1, "budget_min": 90},
    "passcode": None,           # {"salt": ..., "hash": ...} when set
}

_settings_lock = threading.RLock()


def _deep_merge(base, extra):
    out = json.loads(json.dumps(base))
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_settings():
    with _settings_lock:
        try:
            with open(SETTINGS_PATH, encoding="utf-8") as f:
                saved = json.load(f)
        except (OSError, ValueError):
            saved = {}
        return _deep_merge(DEFAULT_SETTINGS, saved)


def save_settings(s):
    with _settings_lock:
        tmp = SETTINGS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(s, f, indent=1)
        os.replace(tmp, SETTINGS_PATH)


def effective_settings(s=None):
    """Settings as the analysis uses them: the CVM thresholds tuned to the doctor's calls when on."""
    s = s or load_settings()
    cvm = s.get("cvm") or {}
    thr = dict(DEFAULT_THRESHOLDS)
    if cvm.get("mode") == "auto" and (cvm.get("tuned") or {}).get("accepted"):
        thr.update(cvm["tuned"].get("thresholds") or {})
    elif cvm.get("mode") == "manual":
        thr.update(cvm.get("thresholds") or {})
    return dict(norms=s.get("norms") or {}, cutoffs=s.get("cutoffs") or {}, cvm=dict(thresholds=thr))


STORE = Store(DATA)
LAST_ACTIVITY = [0.0]


def _log(msg):
    print(msg, flush=True)


def _after_training(st):
    """Keep the CVM thresholds the trainer tuned to the doctor's calls."""
    if not st or "cvm" not in st:
        return
    s = load_settings()
    s.setdefault("cvm", {})["tuned"] = dict(st["cvm"], when=st.get("finished") or st.get("started"))
    save_settings(s)


TRAINER = Trainer(DATA, STORE, load_settings, log=_log)
_orig_train = TRAINER.train


def _train_and_keep(*a, **kw):
    st = _orig_train(*a, **kw)
    try:
        _after_training(st)
    except Exception as ex:  # noqa
        _log(f"could not keep the CVM tuning: {ex}")
    return st


TRAINER.train = _train_and_keep
NIGHTLY = Nightly(TRAINER, load_settings, lambda: LAST_ACTIVITY[0])
if not os.environ.get("NLO_XRAY_NO_NIGHTLY"):
    threading.Thread(target=NIGHTLY.run_forever, name="nightly", daemon=True).start()

app = FastAPI(title="NLO X-Ray Reader", docs_url=None, redoc_url=None, openapi_url=None)

CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
       "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; "
       "form-action 'self'")

# ----------------------------------------------------------------------------- passcode (optional)
_sessions_lock = threading.Lock()


def _load_sessions():
    try:
        with open(SESSIONS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_sessions(d):
    tmp = SESSIONS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(tmp, SESSIONS_PATH)


def _hash_code(code, salt):
    return base64.b64encode(hashlib.pbkdf2_hmac("sha256", code.encode(), salt.encode(), 120_000)).decode()


def passcode_on():
    return bool((load_settings().get("passcode") or {}).get("hash"))


def _session_ok(request):
    tok = request.cookies.get("nlo_xray")
    if not tok:
        return False
    with _sessions_lock:
        exp = _load_sessions().get(hashlib.sha256(tok.encode()).hexdigest())
    return bool(exp and exp > time.time())


OPEN_PATHS = {"/", "/api/login", "/api/hello", "/favicon.ico"}


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if request.method in ("POST", "PATCH", "PUT", "DELETE") and path.startswith("/api/") and path != "/api/login":
        LAST_ACTIVITY[0] = time.time()
    if (path.startswith("/api/") and path not in OPEN_PATHS) and passcode_on() and not _session_ok(request):
        resp = JSONResponse({"detail": "passcode"}, status_code=401)
    else:
        resp = await call_next(request)
    resp.headers["Content-Security-Policy"] = CSP
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    if path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    elif path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"          # always ask: after an update the new files are used at once
    return resp


@app.post("/api/login")
async def login(request: Request):
    body = await request.json()
    pc = load_settings().get("passcode") or {}
    if not pc.get("hash"):
        return {"ok": True}
    code = str(body.get("code") or "")
    if not hmac.compare_digest(_hash_code(code, pc["salt"]), pc["hash"]):
        await asyncio.sleep(0.8)          # slows guessing without holding up anyone else
        raise HTTPException(403, "That passcode is not right.")
    tok = secrets.token_urlsafe(32)
    with _sessions_lock:
        d = {k: v for k, v in _load_sessions().items() if v > time.time()}
        d[hashlib.sha256(tok.encode()).hexdigest()] = time.time() + 30 * 86400
        _save_sessions(d)
    resp = JSONResponse({"ok": True})
    resp.set_cookie("nlo_xray", tok, max_age=30 * 86400, httponly=True, samesite="strict")
    return resp


@app.get("/api/hello")
def hello(request: Request):
    """Open to everyone: does this browser need the passcode?"""
    return {"app": "NLO X-Ray Reader", "version": __version__, "build": BUILD, "passcode": passcode_on(),
            "signed_in": (not passcode_on()) or _session_ok(request)}


# ----------------------------------------------------------------------------- definitions & status

@app.get("/api/defs")
def defs():
    d = public_definitions()
    d["measures"] = [dict(key=k, label=lb, group=gr, unit=u, needs=list(n), needs_mm=nm, desc=ds)
                     for k, lb, gr, u, n, nm, ds in MEASURES]
    d["default_norms"] = {k: dict(mean=m, sd=s) for k, (m, s) in DEFAULT_NORMS.items()}
    d["default_cutoffs"] = DEFAULT_CUTOFFS
    d["default_cvm"] = DEFAULT_THRESHOLDS
    d["min_cases"] = MIN_CASES
    return d


@app.get("/api/status")
def status():
    cases = STORE.list()
    st = TRAINER.status()
    return dict(version=__version__, build=BUILD, cases=len(cases), confirmed=sum(1 for c in cases if c.get("status") == "confirmed"),
                learning=st, model=st.get("model"), passcode=passcode_on(), min_cases=MIN_CASES)


# ----------------------------------------------------------------------------- cases

def _required_codes(case):
    skipped = set(case.get("skipped") or [])
    return [c for c in CODES if GROUP_OF[c] not in skipped]


def _analysis(case, settings=None):
    pts = STORE.points_px(case)
    cal = case.get("calibration") or {}
    age = age_years((case.get("patient") or {}).get("dob"), case.get("taken"))
    a = analyze(pts, cal.get("mm_per_px"), case.get("facing"), (case.get("patient") or {}).get("sex"),
                effective_settings(settings), cvm_marks=(case.get("cvm") or {}).get("marks"), age=age)
    a["age"] = age
    req = _required_codes(case)
    a["progress"] = dict(placed=sum(1 for c in req if c in pts), total=len(req),
                         reviewed=sum(1 for c in req if (case["landmarks"].get(c) or {}).get("by") == "doctor"))
    return a


def _refresh(case, settings=None):
    """Derived fields: facing, traced/new status, and the short result shown in the case list."""
    pts = STORE.points_px(case)
    f = geo.facing_of(pts)
    if f:
        case["facing"] = f
    req = _required_codes(case)
    if case.get("status") != "confirmed":
        case["status"] = "traced" if req and all(c in pts for c in req) else "new"
    a = _analysis(case, settings)
    sag = next((s for s in a["summary"] if s["key"] == "sagittal"), None)
    case["result"] = dict(sagittal=sag["call"] if sag else None, cvm=(a["cvm"] or {}).get("stage"))
    return case, a


def _get(cid):
    try:
        return STORE.get(cid)
    except KeyError:
        raise HTTPException(404, "No such x-ray (it may have been deleted).")


def _reply(case, a=None):
    if a is None:
        a = _analysis(case)
    return dict(case=case, analysis=a)


@app.get("/api/cases")
def list_cases(q: str = ""):
    return [STORE.summary_row(c) for c in STORE.list(q or None)]


@app.post("/api/cases")
async def import_cases(files: list[UploadFile] = File(...)):
    settings = load_settings()
    out = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_UPLOAD:
            out.append(dict(name=f.filename, error="File too large."))
            continue
        try:
            case, dup = await run_in_threadpool(STORE.create, data, f.filename or "", settings)
            out.append(dict(name=f.filename, id=case["id"], duplicate=dup, case=case))
        except ImageReadError as ex:
            out.append(dict(name=f.filename, error=str(ex)))
        except Exception as ex:  # noqa
            out.append(dict(name=f.filename, error=f"Could not import: {ex}"))
    return out


@app.get("/api/cases/{cid}")
def get_case(cid: str):
    case = _get(cid)
    return _reply(case)


_PATIENT_FIELDS = ("name", "dob", "sex", "chart")


def _valid_date(v):
    if v in (None, ""):
        return None
    try:
        return dt.date.fromisoformat(str(v)).isoformat()
    except ValueError:
        raise HTTPException(400, f"Not a date: {v}")


@app.patch("/api/cases/{cid}")
async def patch_case(cid: str, request: Request):
    body = await request.json()
    return await run_in_threadpool(_patch_case, cid, body)


def _patch_case(cid, body):
    case = _get(cid)
    hist = []
    if "patient" in body:
        p = case.setdefault("patient", {})
        for k in _PATIENT_FIELDS:
            if k in body["patient"]:
                v = body["patient"][k]
                if k == "dob":
                    v = _valid_date(v)
                elif k == "sex":
                    v = (str(v or "").upper()[:1] or None)
                    v = v if v in ("M", "F") else None
                else:
                    v = str(v or "").strip()[:120]
                p[k] = v
    if "taken" in body:
        case["taken"] = _valid_date(body["taken"])
    if body.get("details_confirmed"):
        case["details_confirmed"] = True
    if "calibration" in body:
        c = body["calibration"] or {}
        mm = c.get("mm_per_px")
        if mm is not None:
            mm = float(mm)
            if not (0.005 <= mm <= 2.0):
                raise HTTPException(400, "That pixel size is outside what an x-ray could have.")
        case["calibration"] = dict(mm_per_px=mm, source=str(c.get("source") or "set by hand")[:200])
        hist.append("calibration " + (f"{mm:.4f} mm per pixel" if mm else "cleared"))
    if "landmarks" in body:
        lm = case.setdefault("landmarks", {})
        changed = 0
        for code, v in (body["landmarks"] or {}).items():
            if code not in CODES:
                continue
            if v is None:
                lm.pop(code, None)
                changed += 1
                continue
            x, y = float(v["x"]), float(v["y"])
            if not (-50 <= x <= case["image"]["w"] + 50 and -50 <= y <= case["image"]["h"] + 50):
                continue
            lm[code] = dict(x=round(x, 2), y=round(y, 2), by=v.get("by") if v.get("by") in ("doctor", "model", "template", "import") else "doctor",
                            conf=v.get("conf"))
            changed += 1
        if changed and case.get("status") == "confirmed":
            case["confirmed_at"] = dt.datetime.now().replace(microsecond=0).isoformat()   # learn from the edit
    if "skipped" in body:
        sk = [g for g in (body["skipped"] or []) if g in ("soft", "cvm")]
        case["skipped"] = sk
        for code in list(case.get("landmarks", {})):
            if GROUP_OF.get(code) in sk:
                case["landmarks"].pop(code, None)
    if "cvm_marks" in body:
        cv = case.setdefault("cvm", {})
        marks = dict(cv.get("marks") or {})
        upd = body["cvm_marks"]
        if upd is None:
            marks = {}
            hist.append("CVM back to the app's reading")
        else:
            for k, v in upd.items():
                if v is None:
                    marks.pop(k, None)
                elif clean_marks({k: v}):
                    marks[k] = v
                    hist.append(f"CVM {k.replace('shape', ' body')}: {v.replace('_', ' ')}")
        cv["marks"] = marks
    if "notes" in body:
        case["notes"] = str(body["notes"] or "")[:4000]
    if "status" in body:
        s = body["status"]
        if s == "confirmed":
            missing = [c for c in _required_codes(case) if c not in (case.get("landmarks") or {})]
            if missing:
                raise HTTPException(400, f"{len(missing)} points still to place: {', '.join(missing[:6])}")
            for code in case["landmarks"]:
                case["landmarks"][code]["by"] = "doctor"
            case["status"] = "confirmed"
            case["confirmed_at"] = dt.datetime.now().replace(microsecond=0).isoformat()
            hist.append("tracing confirmed")
        elif s in ("traced", "new", "reopen"):
            if case.get("status") == "confirmed":
                hist.append("tracing reopened")
            case["status"] = "new"
            case.pop("confirmed_at", None)
            cv = case.setdefault("cvm", {})
            cv.pop("confirmed", None)                 # taken again at the next confirm
            cv.pop("doctor", None)
    now = dt.datetime.now().replace(microsecond=0).isoformat()
    case, a = _refresh(case)
    if case.get("status") == "confirmed" and "cvm" not in (case.get("skipped") or []):
        # what the doctor confirmed: every flat / concave and body-shape judgement as shown (his picks and the
        # app's readings he let stand) and the stage they give - the lessons for tuning the CVM thresholds.
        # A confirmed case that is corrected later keeps them up to date.
        cv = case.setdefault("cvm", {})
        jd = (a.get("cvm") or {}).get("judgements") or {}
        now_conf = {k: v.get("value") for k, v in jd.items() if v.get("value")}
        stage_now = (a.get("cvm") or {}).get("stage")
        # only when he confirms or changes the tracing / a pick - never because the thresholds moved since
        touched = body.get("status") == "confirmed" or "landmarks" in body or "cvm_marks" in body
        if touched and (now_conf != cv.get("confirmed") or stage_now != cv.get("doctor")):
            if body.get("status") == "confirmed" and stage_now:
                hist.append(f"CVM {stage_now} confirmed")
            cv["confirmed"], cv["doctor"] = now_conf, stage_now
            if body.get("status") != "confirmed":
                case["confirmed_at"] = now          # a correction is a new lesson
    for h in hist:
        case.setdefault("history", []).append(dict(t=now, what=h))
    STORE.save(case)
    return _reply(case, a)


@app.delete("/api/cases/{cid}")
def delete_case(cid: str):
    _get(cid)
    STORE.delete(cid)
    return {"ok": True}


def _no_store_file(path, media):
    if not os.path.isfile(path):
        raise HTTPException(404, "missing image")
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-store"})


@app.get("/api/cases/{cid}/image")
def case_image(cid: str):
    _get(cid)
    return _no_store_file(STORE.image_path(cid), "image/png")


@app.get("/api/cases/{cid}/thumb")
def case_thumb(cid: str):
    _get(cid)
    return _no_store_file(STORE.thumb_path(cid), "image/jpeg")


# ----------------------------------------------------------------------------- placing points

_shape_cache = {"key": None, "shape": None, "n": 0}


def current_shape():
    conf = TRAINER.confirmed_cases()
    key = (len(conf), max([c.get("confirmed_at") or "" for c in conf] + [""]))
    if _shape_cache["key"] != key:
        tr = [(STORE.points_px(c), c.get("facing"), (c.get("calibration") or {}).get("mm_per_px")) for c in conf]
        shp, n = mean_shape(tr)
        _shape_cache.update(key=key, shape=shp, n=n)
    return _shape_cache["shape"], _shape_cache["n"]


@app.post("/api/cases/{cid}/anchors")
async def from_anchors(cid: str, request: Request):
    """The doctor clicked S, N and Me: put every other point where the average tracing says."""
    body = await request.json()
    return await run_in_threadpool(_from_anchors, cid, body)


def _from_anchors(cid, body):
    case = _get(cid)
    anchors = {}
    for c in ANCHORS:
        v = body.get(c)
        if not v:
            raise HTTPException(400, f"Click {c} first.")
        anchors[c] = (float(v[0]), float(v[1]))
    shape, _ = current_shape()
    try:
        pts = place_from_anchors(anchors, shape)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    req = set(_required_codes(case))
    lm = {}
    for code, (x, y) in pts.items():
        if code not in req:
            continue
        lm[code] = dict(x=round(x, 2), y=round(y, 2), by="doctor" if code in anchors else "template", conf=None)
    case["landmarks"] = lm
    case.setdefault("history", []).append(dict(t=dt.datetime.now().replace(microsecond=0).isoformat(),
                                               what="points placed from S, N, Me"))
    case, a = _refresh(case)
    STORE.save(case)
    return _reply(case, a)


# ----------------------------------------------------------------------------- importing iOrtho tracings

def _last_first(name):
    """iOrtho writes 'First Last'; the case list uses 'Last, First'."""
    parts = [w for w in str(name or "").replace(",", " ").split() if w]
    if len(parts) >= 2:
        return f"{parts[-1].title()}, {' '.join(w.title() for w in parts[:-1])}"
    return " ".join(w.title() for w in parts)


def _apply_iortho(case, result, report, confirm=False):
    """iOrtho's points onto a case: verified ones marked as such, the vertebrae (iOrtho has none) skipped."""
    now = dt.datetime.now().replace(microsecond=0).isoformat()
    lm = case.setdefault("landmarks", {})
    for c, (x, y) in result["points"].items():
        lm[c] = dict(x=round(x, 2), y=round(y, 2), by="import", conf=1.0 if c in result["verified"] else 0.4)
    p = case.setdefault("patient", {})
    rp = report.get("patient") or {}
    from_file = (case.get("source") or {}).get("format") != "dicom"
    if rp.get("name") and (from_file or not p.get("name")):
        p["name"] = _last_first(rp["name"])
    if rp.get("dob") and not p.get("dob"):
        p["dob"] = rp["dob"]
    if rp.get("sex") in ("M", "F") and not p.get("sex"):
        p["sex"] = rp["sex"]
    if rp.get("taken") and not case.get("taken"):
        case["taken"] = rp["taken"]
    if p.get("name"):
        case["details_confirmed"] = True
    cal = case.get("calibration") or {}
    mm = result.get("mm_per_px")
    if mm and 0.01 < mm < 2 and (not cal.get("mm_per_px") or str(cal.get("source") or "").startswith("office default")):
        case["calibration"] = dict(mm_per_px=round(mm, 5), source="from iOrtho's measurements (its S-N length)")
    if not any(GROUP_OF[c] == "cvm" for c in lm):
        case["skipped"] = sorted(set(case.get("skipped") or []) | {"cvm"})
    missing = [c for c in _required_codes(case) if c not in lm]
    if missing:                                # anything iOrtho did not give: from the average tracing
        shape, _ = current_shape()
        known = {c: (v["x"], v["y"]) for c, v in lm.items()}
        for c, (x, y) in fill_missing(known, missing, shape).items():
            lm[c] = dict(x=round(x, 2), y=round(y, 2), by="template", conf=None)
    n_ok = sum(1 for r in result["checks"] if r["ok"])
    case["import"] = dict(source="iOrtho", when=now, verified=result["verified"], unverified=result["unverified"],
                          checks=result["checks"], registration=result["registration"])
    case["status"] = "new" if case.get("status") != "confirmed" else case["status"]
    case.setdefault("history", []).append(dict(t=now, what=f"tracing imported from iOrtho: {len(result['verified'])} points "
                                               f"match iOrtho's numbers ({n_ok} of {len(result['checks'])} checks)"))
    case, a = _refresh(case)
    STORE.save(case)
    real_doubt = [c for c in result["unverified"] if c != "PM"]
    if confirm and not real_doubt and case.get("status") != "confirmed":
        out = _patch_case(case["id"], {"status": "confirmed"})
        return out["case"], out["analysis"]
    return case, a


def _import_one(case, traced_rgb, report, confirm):
    img = load_png(STORE.image_path(case["id"]))
    result = iortho.import_tracing(img, traced_rgb, report)
    case, a = _apply_iortho(case, result, report, confirm)
    n_ok = sum(1 for r in result["checks"] if r["ok"])
    return dict(id=case["id"], name=case["patient"].get("name") or "", verified=len(result["verified"]),
                unverified=result["unverified"], checks_ok=n_ok, checks=len(result["checks"]),
                confirmed=case.get("status") == "confirmed", registration=result["registration"])


def _tokens(s):
    return {w for w in re.split(r"[^a-z]+", str(s or "").lower()) if len(w) >= 2} - {
        "cephalometry", "report", "ceph", "cephalometric", "lateral", "lat", "traced", "tracing", "image", "export",
        "iortho", "icep", "iceph", "png", "jpg", "jpeg", "dcm", "xlsx", "the", "and"}


def _import_iortho_batch(items, confirm):
    """items: [(filename, bytes)]. One or more patients: per patient the original x-ray, iOrtho's traced image and
    iOrtho's Excel report. Files are grouped by the patient's name when there is more than one patient."""
    reports, originals, traced, errors, other_reports = [], [], [], [], []
    for name, data in items:
        low = (name or "").lower()
        if low.endswith((".xlsx", ".xlsm")):
            try:
                reports.append((name, iortho.read_report(data)))
            except iortho.ImportError_ as ex:
                errors.append(dict(name=name, error=str(ex)))
        elif low.endswith((".pdf", ".xls", ".csv", ".txt", ".doc", ".docx")):
            other_reports.append(name)            # iOrtho's PDF next to its Excel report: not needed
        elif is_dicom_bytes(data) or low.endswith((".dcm", ".dicom")):
            originals.append((name, data, None))
        else:
            try:
                rgb = iortho.load_rgb(data)
            except iortho.ImportError_ as ex:
                errors.append(dict(name=name, error=str(ex)))
                continue
            (traced if iortho.looks_traced(rgb) else originals).append((name, data, rgb))
    if not reports:
        raise HTTPException(400, "No iOrtho Excel report (.xlsx) among the files" + (
            " - the PDF report cannot be read; export the Excel one from iOrtho too." if other_reports else "."))
    groups = []
    if len(reports) == 1:
        groups.append((reports[0], originals, traced))
    else:
        for rname, rep in reports:
            want = _tokens(rep["patient"].get("name")) or _tokens(rname)
            def mine(fname, data):
                t = _tokens(fname)
                if is_dicom_bytes(data):
                    try:
                        import pydicom
                        ds = pydicom.dcmread(io.BytesIO(data), stop_before_pixels=True, force=True)
                        t |= _tokens(str(getattr(ds, "PatientName", "")))
                    except Exception:  # noqa
                        pass
                return len(t & want) >= min(2, len(want))
            groups.append(((rname, rep), [o for o in originals if mine(o[0], o[1])], [x for x in traced if mine(x[0], x[1])]))
    out = []
    settings = load_settings()
    for (rname, rep), origs, trs in groups:
        who = _last_first(rep["patient"].get("name")) or rname
        if len(origs) != 1 or len(trs) != 1:
            what = []
            if len(origs) != 1:
                what.append("the original x-ray" if not origs else f"{len(origs)} possible original x-rays")
            if len(trs) != 1:
                what.append("iOrtho's traced image" if not trs else f"{len(trs)} possible traced images")
            out.append(dict(name=who, error="Could not find " + " and ".join(what) + " for this report. "
                            "Drop one patient's three files at a time, or name the files after the patient."))
            continue
        oname, odata, _ = origs[0]
        tname, tdata, trgb = trs[0]
        try:
            case, dup = STORE.create(odata, oname, settings)
        except ImageReadError as ex:
            out.append(dict(name=who, error=f"{oname}: {ex}"))
            continue
        if dup and case.get("status") == "confirmed":      # never overwrite a tracing the doctor has confirmed
            out.append(dict(name=case["patient"].get("name") or who, id=case["id"], confirmed=True,
                            skipped="Already here and confirmed - left as it is."))
            continue
        try:
            out.append(_import_one(case, trgb, rep, confirm))
        except iortho.ImportError_ as ex:
            out.append(dict(name=who, id=case["id"], error=str(ex)))
    return dict(results=out, errors=errors)


@app.post("/api/import/iortho")
async def import_iortho(files: list[UploadFile] = File(...), confirm: bool = Form(False)):
    items = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_UPLOAD:
            raise HTTPException(400, f"{f.filename}: file too large.")
        items.append((f.filename or "", data))
    return await run_in_threadpool(_import_iortho_batch, items, confirm)


@app.post("/api/cases/{cid}/iortho")
async def import_iortho_onto(cid: str, files: list[UploadFile] = File(...), confirm: bool = Form(False)):
    """iOrtho's tracing for an x-ray that is already here: the traced image and the Excel report."""
    case = _get(cid)
    if case.get("status") == "confirmed":
        raise HTTPException(409, "This tracing is confirmed. Reopen it first if iOrtho's tracing should replace it.")
    rep, rgb = None, None
    for f in files:
        data = await f.read()
        low = (f.filename or "").lower()
        if low.endswith((".xlsx", ".xlsm")):
            try:
                rep = iortho.read_report(data)
            except iortho.ImportError_ as ex:
                raise HTTPException(400, str(ex))
        else:
            try:
                rgb = iortho.load_rgb(data)
            except iortho.ImportError_ as ex:
                raise HTTPException(400, str(ex))
    if rep is None or rgb is None:
        raise HTTPException(400, "Drop iOrtho's traced image and its Excel report (.xlsx) together.")
    if not iortho.looks_traced(rgb):
        raise HTTPException(400, "That image has no iOrtho tracing on it (no red landmark dots).")
    try:
        res = await run_in_threadpool(_import_one, case, rgb, rep, confirm)
    except iortho.ImportError_ as ex:
        raise HTTPException(400, str(ex))
    return dict(result=res, **_reply(STORE.get(cid)))


@app.post("/api/cases/{cid}/fill")
def fill_case(cid: str):
    """Points still missing (a group switched back on) go where the average tracing says, from the others."""
    case = _get(cid)
    known = {c: (v["x"], v["y"]) for c, v in (case.get("landmarks") or {}).items()}
    missing = [c for c in _required_codes(case) if c not in known]
    if missing:
        shape, _ = current_shape()
        for c, (x, y) in fill_missing(known, missing, shape).items():
            case["landmarks"][c] = dict(x=round(x, 2), y=round(y, 2), by="template", conf=None)
    case, a = _refresh(case)
    STORE.save(case)
    return _reply(case, a)


@app.post("/api/cases/{cid}/auto")
def auto_trace(cid: str):
    """The trained network places the points; anything it is not trained for comes from the average tracing."""
    case = _get(cid)
    if not TRAINER.finder:
        raise HTTPException(409, "The app has not learned to place points yet.")
    img = load_png(STORE.image_path(cid))
    pred, facing = TRAINER.predict(img, None)
    req = set(_required_codes(case))
    lm = {c: dict(x=round(v["x"], 2), y=round(v["y"], 2), by="model", conf=v["conf"]) for c, v in pred.items() if c in req}
    rest = [c for c in req if c not in lm]
    if rest:
        shape, _ = current_shape()
        known = {c: (v["x"], v["y"]) for c, v in lm.items()}
        for c, (x, y) in fill_missing(known, rest, shape).items():
            lm[c] = dict(x=round(x, 2), y=round(y, 2), by="template", conf=None)
    case["landmarks"] = lm
    case["facing"] = facing
    ver = (TRAINER.model_info() or {}).get("version")
    case["model_version"] = ver
    case.setdefault("history", []).append(dict(t=dt.datetime.now().replace(microsecond=0).isoformat(),
                                               what=f"points placed by the trained network v{ver}"))
    case, a = _refresh(case)
    STORE.save(case)
    return _reply(case, a)


# ----------------------------------------------------------------------------- learning

@app.get("/api/model")
def model_status():
    st = TRAINER.status()
    s = load_settings()
    st["cvm_tuned"] = (s.get("cvm") or {}).get("tuned")
    st["cvm_mode"] = (s.get("cvm") or {}).get("mode")
    try:
        with open(TRAINER.log_path, encoding="utf-8") as f:
            st["log_tail"] = f.read()[-4000:]
    except OSError:
        st["log_tail"] = ""
    return st


@app.post("/api/model/train")
def model_train():
    if TRAINER.running:
        return {"started": False, "message": "Already learning."}
    threading.Thread(target=TRAINER.train, kwargs=dict(reason="Train now"), name="train", daemon=True).start()
    return {"started": True}


@app.post("/api/model/stop")
def model_stop():
    TRAINER.stop_flag.set()
    return {"ok": True}


@app.post("/api/model/rollback")
def model_rollback():
    if not TRAINER.rollback():
        raise HTTPException(400, "There is no earlier network to go back to.")
    return {"ok": True, "model": TRAINER.model_info()}


# ----------------------------------------------------------------------------- settings

def _public_settings(s):
    out = json.loads(json.dumps(s))
    out["passcode"] = bool((s.get("passcode") or {}).get("hash"))
    return out


@app.get("/api/settings")
def get_settings():
    return _public_settings(load_settings())


def _num(v, lo, hi, what):
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{what}: not a number")
    if not (lo <= x <= hi):
        raise HTTPException(400, f"{what}: {x:g} is outside {lo:g}-{hi:g}")
    return x


@app.put("/api/settings")
async def put_settings(request: Request):
    body = await request.json()
    s = load_settings()
    if "norms" in body:
        norms = {}
        for k, v in (body["norms"] or {}).items():
            if k in DEFAULT_NORMS and isinstance(v, dict):
                norms[k] = dict(mean=_num(v.get("mean"), -200, 400, k), sd=_num(v.get("sd"), 0.01, 100, k))
        s["norms"] = norms
    if "cutoffs" in body:
        s["cutoffs"] = {k: _num(v, -200, 400, k) for k, v in (body["cutoffs"] or {}).items() if k in DEFAULT_CUTOFFS}
    if "cvm" in body:
        c = body["cvm"] or {}
        cv = s.setdefault("cvm", {})
        if c.get("mode") in ("auto", "manual", "defaults"):
            cv["mode"] = c["mode"]
        if "thresholds" in c:
            cv["thresholds"] = {k: _num(v, 0.01, 50, k) for k, v in (c["thresholds"] or {}).items() if k in DEFAULT_THRESHOLDS}
    if "calibration" in body:
        c = body["calibration"] or {}
        cal = s.setdefault("calibration", {})
        if "default_mm_per_px" in c:
            cal["default_mm_per_px"] = None if c["default_mm_per_px"] in (None, "") else _num(c["default_mm_per_px"], 0.005, 2.0, "pixel size")
        if "magnification" in c:
            cal["magnification"] = _num(c["magnification"], 1.0, 1.5, "magnification")
    if "learning" in body:
        c = body["learning"] or {}
        le = s.setdefault("learning", {})
        if "nightly" in c:
            le["nightly"] = bool(c["nightly"])
        for k, lo, hi in (("window_start", 0, 23), ("window_end", 0, 23), ("budget_min", 5, 600)):
            if k in c:
                le[k] = int(_num(c[k], lo, hi, k))
    save_settings(s)
    return _public_settings(s)


@app.post("/api/settings/passcode")
async def set_passcode(request: Request):
    body = await request.json()
    code = str(body.get("code") or "").strip()
    s = load_settings()
    if not code:
        s["passcode"] = None
    else:
        if len(code) < 4:
            raise HTTPException(400, "Use at least 4 characters.")
        salt = secrets.token_hex(8)
        s["passcode"] = dict(salt=salt, hash=_hash_code(code, salt))
    save_settings(s)
    with _sessions_lock:
        _save_sessions({})            # everyone signs in again with the new code
    resp = JSONResponse({"ok": True, "passcode": bool(code)})
    if code:                          # the browser that set it stays signed in
        tok = secrets.token_urlsafe(32)
        with _sessions_lock:
            _save_sessions({hashlib.sha256(tok.encode()).hexdigest(): time.time() + 30 * 86400})
        resp.set_cookie("nlo_xray", tok, max_age=30 * 86400, httponly=True, samesite="strict")
    return resp


# ----------------------------------------------------------------------------- the page

def _build_id():
    """Changes with every update: the version and the page's own files. Open pages compare it to offer a reload."""
    h = hashlib.sha1(__version__.encode())
    for name in ("index.html", "app.js", "style.css"):
        try:
            with open(os.path.join(STATIC, name), "rb") as f:
                h.update(f.read())
        except OSError:
            pass
    return h.hexdigest()[:10]


BUILD = _build_id()


@app.get("/")
def index():
    with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
        html = f.read()
    # the page's script and styles under a name that changes with each update, so no browser keeps an old copy
    html = (html.replace('/static/app.js"', f'/static/app.js?v={BUILD}"')
                .replace('/static/style.css"', f'/static/style.css?v={BUILD}"')
                .replace('<meta name="build" content="">', f'<meta name="build" content="{BUILD}">'))
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
