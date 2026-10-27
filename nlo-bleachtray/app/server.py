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
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from bleachtray.pipeline import process, replace_placement, ADJUST_ZERO, DEFAULTS  # noqa: E402
from bleachtray.segment import load_models  # noqa: E402
from bleachtray.orderfolder import write_order_folder  # noqa: E402
from bleachtray.printfolder import write_print_folder, default_print_root  # noqa: E402

JOBS_DIR = os.path.join(ROOT, "jobs")
os.makedirs(JOBS_DIR, exist_ok=True)
app = FastAPI(title="NLO Tray Maker")
app.mount("/static", StaticFiles(directory=os.path.join(ROOT, "app", "static")), name="static")

JOBS = {}
MODELS = load_models()

from bleachtray.server_presets import PRESETS, variants_for  # noqa: E402
from app.tracker import Tracker  # noqa: E402
from bleachtray import basebuild  # noqa: E402

# the Trimlign base: checked when the app starts (its locating holes must be clear to 3.5 mm) and rebuilt from Titan's
# base when they are not - 19 Oct 2026, a base rebuilt from a light Titan export had a skin across both holes at 1.85 mm.
# load_base waits while this runs, so no model is finished with the old base meanwhile.
BASE_STATUS = {}
def _check_base():
    try:
        BASE_STATUS.update(basebuild.ensure_base(ROOT, log=lambda m: print(m, flush=True)) or {})
    except Exception as ex:  # noqa
        BASE_STATUS.update(ok=None, error=str(ex)); print(f"Trimlign base check failed: {ex}", flush=True)
threading.Thread(target=_check_base, name="basecheck", daemon=True).start()
# the link to NLO Cases (the case tracker): the queue of cases waiting for models, the note back when they are sent
TRACKER = Tracker(JOBS_DIR, log=lambda m: print(m, flush=True))
TRACKER.start()


CFG_PATH = os.path.join(ROOT, "watch_config.json")


def _read_cfg():
    try:
        with open(CFG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def site_config():
    """Settings install.bat saved for this PC (watch_config.json): the OrthoFactory input folder, the
    doctor name, the drop folder, the scanner's export folder, PreForm. The browser app uses them as defaults."""
    cfg = _read_cfg()
    return dict(order_root=cfg.get("titan") or "", doctor=cfg.get("doctor") or "Dr. Amir Akhavan",
                inbox=cfg.get("inbox") or "", scanner_folder=cfg.get("scanner_folder") or "",
                preform=cfg.get("preform") or "", preform_found=_find_preform(cfg) or "", preform_on_send=bool(cfg.get("preform_on_send", True)),
                print_root=cfg.get("print_root") or "", print_root_default=default_print_root(cfg.get("titan") or "", ROOT),
                print_root_used=_print_root(cfg))


def _print_root(cfg=None):
    """Where the finished models are filed (Settings -> Print folder), else next to Titan's folder."""
    cfg = cfg if cfg is not None else _read_cfg()
    return (cfg.get("print_root") or "").strip() or default_print_root(cfg.get("titan") or "", ROOT)


def _scan_tag(sc):
    """WT / TT / MG / P1 for a model: what the case was set up with, else from its preset or kind."""
    return sc.get("tag") or ("MG" if sc.get("preset") == "mouthguard" else "P1" if str(sc.get("preset") or "").startswith("phase1")
                             else "TT" if (sc.get("kind") or "T").upper().startswith("A") else "WT")


def _pick_scans(job, scans):
    """The scans a request names (`scans`: comma-separated indices, "" / None = every finished one): the Export
    and Send dialogs let the staff tick the pieces (the doctor, 10/27/2026). Returns a sorted list of indices."""
    n = len(job.get("scans") or [])
    if scans is None or str(scans).strip() == "":
        return list(range(n))
    out = []
    for tok in str(scans).split(","):
        tok = tok.strip()
        if tok.isdigit() and int(tok) < n:
            out.append(int(tok))
    return sorted(set(out))


def _to_unc(path):
    """A path on a mapped drive (O:\\clinical\\...) as the other PCs can reach it (\\\\server\\share\\clinical\\...).
    Returns the path unchanged when it is already UNC or the drive is a local disk."""
    if not path or not re.match(r"^[A-Za-z]:", path) or os.name != "nt":
        return path
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(1024); n = ctypes.c_ulong(1024)
        if ctypes.windll.mpr.WNetGetConnectionW(path[:2], buf, ctypes.byref(n)) == 0 and buf.value:
            return buf.value.rstrip("\\") + path[2:]
    except Exception:
        pass
    return path


def _print_files_unc(job):
    return [_to_unc(f) for f in (job.get("print_files") or [])]


def _is_local(request):
    """True when the page asking is on this PC (the lab PC) - then PreForm opens here; from another
    PC the models open there instead, through the nlobt: link the browser hands to Windows."""
    if os.environ.get("NLO_EVERY_PAGE_IS_REMOTE"):      # test hook: behave as if every page were on another PC
        return False
    try:
        host = (request.client.host if request and request.client else "") or ""
    except Exception:
        host = ""
    if host in ("127.0.0.1", "::1", "localhost", ""):
        return True
    try:
        import socket
        mine = {i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None)}
        return host in mine
    except Exception:
        return False


def _write_prints(job, log=print, only=None):
    """Copy the case's finished models into the print folder, filed by patient (see printfolder.py).
    `only`: the scan indices to file (None = all). Returns the list of files there (empty when the case has
    no patient name or the copy failed)."""
    job["print_error"] = None
    first, last = job["params"].get("patient_first"), job["params"].get("patient_last")
    if not (first and last):
        job["print_error"] = "patient first + last name needed to file the models in the print folder"
        return []
    pieces = []
    for k, sc in enumerate(job["scans"]):
        if only is not None and k not in only:
            continue
        m = ((sc.get("report") or {}).get("outputs") or {}).get("model")
        if m and os.path.isfile(m):
            pieces.append(dict(arch=sc.get("arch"), tag=_scan_tag(sc), stl=m))
    if not pieces:
        job["print_error"] = "no finished model to file"
        return []
    try:
        folder, files = write_print_folder(_print_root(), first, last, pieces, own=job.get("print_files") or [])
    except Exception as ex:  # noqa
        job["print_error"] = f"models not filed in the print folder: {ex}"
        log(job["print_error"])
        return []
    job["print_folder"], job["print_files"] = folder, files
    log(f"models filed: {folder} ({', '.join(os.path.basename(f) for f in files)})")
    return files


def _preform_in(folder):
    """The PreForm programs an install folder can hold, best first: PreForm.exe beside the launcher
    (older installs), the newest versioned subfolder's PreForm.exe (PreForm 3.6x keeps the program in
    ...\\PreForm\\3.64.1.664\\), then PreFormLauncher.exe itself."""
    import glob, re
    out = [os.path.join(folder, "PreForm.exe")]
    def ver(p):
        return [int(x) for x in re.findall(r"\d+", os.path.basename(os.path.dirname(p)))]
    out += sorted(glob.glob(os.path.join(folder, "*", "PreForm.exe")), key=ver, reverse=True)
    out += [os.path.join(folder, "PreFormLauncher.exe")] + sorted(glob.glob(os.path.join(folder, "PreForm*.exe")))
    return out


def _is_preform_exe(path):
    return os.path.basename(str(path or "")).lower() in ("preform.exe", "preformlauncher.exe")


def _find_preform(cfg=None):
    """PreForm.exe on this PC: the path from the settings, else the usual install folders, else the
    registry's App Paths entry. None when there is none (the app then says so instead of guessing)."""
    cfg = cfg if cfg is not None else _read_cfg()
    typed = (cfg.get("preform") or "").strip().strip('"')
    # only PreForm itself is ever started from here: the setting can be typed from any office PC, and a path to any
    # other program would have the lab PC run it on Open in PreForm
    if typed and os.name == "nt" and not os.path.isdir(typed) and not _is_preform_exe(typed):
        typed = ""
    cands = [typed] if typed else []
    if typed and os.path.isdir(typed):      # the install folder was typed, not the exe: look inside it
        cands += _preform_in(typed)
    bases = [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramW6432"),
             r"C:\Program Files", r"C:\Program Files (x86)", os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs")]
    for base in [b for b in bases if b]:
        cands += _preform_in(os.path.join(base, "Formlabs", "PreForm"))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    if os.name == "nt":
        try:
            import winreg
            for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\PreForm.exe") as k:
                        v = winreg.QueryValue(k, None)
                        if v and os.path.isfile(v):
                            return v
                except OSError:
                    pass
        except Exception:
            pass
    return None


def _open_in_preform(job, log=print):
    """Open this case's finished models (the printable STLs, base and all) in PreForm on this PC - the
    one the app runs on, which is where the printer's PC is. Returns (ok, message)."""
    exe = _find_preform()
    if not exe:
        return False, "PreForm was not found on the PC that runs the app - type its path under Settings (PreForm)"
    # the copies in the print folder (filed by patient) are what PreForm sees, so a file saved from
    # there lands next to them; a case without a patient name opens its working files instead
    # always fresh copies (and the current base): copies kept from before a fix printed the model as it was
    _rebase(job, log=log)
    stls = _write_prints(job, log=log)
    where = job.get("print_folder") if stls else None
    if not stls:
        for sc in job["scans"]:
            m = ((sc.get("report") or {}).get("outputs") or {}).get("model")
            if m and os.path.isfile(m):
                stls.append(m)
    if not stls:
        return False, "no finished model to open"
    try:
        import subprocess
        flags = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == "nt" else 0
        subprocess.Popen([exe] + stls, cwd=os.path.dirname(stls[0]), creationflags=flags, close_fds=True)
    except Exception as ex:  # noqa
        log(f"PreForm did not start: {ex}")
        return False, f"PreForm did not start: {ex}"
    names = ", ".join(os.path.basename(x) for x in stls)
    log(f"opened in PreForm: {names}")
    return True, (f"{len(stls)} model{'s' if len(stls) != 1 else ''} opened in PreForm on {os.environ.get('COMPUTERNAME') or 'this PC'}"
                  + (f" from {where}" if where else "") + f": {names}")


@app.post("/api/settings")
async def save_settings(scanner_folder: str = Form(None), preform: str = Form(None), preform_on_send: str = Form(None), print_root: str = Form(None)):
    """Persist office-wide settings into watch_config.json (only the keys given)."""
    cfg = _read_cfg()
    if scanner_folder is not None:
        cfg["scanner_folder"] = scanner_folder.strip()
    if preform is not None:
        typed = preform.strip().strip('"')
        if typed.lower() not in ("", "auto") and os.name == "nt" and not os.path.isdir(typed) and not _is_preform_exe(typed):
            raise HTTPException(400, "that is not PreForm - type the path of PreForm.exe (or its folder), or auto")
        cfg["preform"] = "" if typed.lower() in ("", "auto") else typed   # "auto" clears a typed path (an empty field does not reach here)
    if preform_on_send is not None:
        cfg["preform_on_send"] = preform_on_send.strip().lower() in ("1", "true", "yes", "on")
    if print_root is not None:
        cfg["print_root"] = "" if print_root.strip().lower() in ("", "auto") else print_root.strip()   # "auto" = back to the folder next to Titan's
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
def scanner_make(paths: str = Form(...), preset: str = Form("bleaching"), params: str = Form("{}")):     # (not async: the copy from a
    # scanner PC's share must not stall every other request while it runs)
    """Make a case from scans still in the scanner's folder (copied into the job, originals untouched)."""
    import shutil
    from bleachtray.watch import parse_name
    folders = [f.strip() for f in site_config()["scanner_folder"].split(";") if f.strip()]
    plist = [p for p in json.loads(paths) if p][:2]
    for p in plist:
        def _under(path, folder):
            try:
                return os.path.commonpath([os.path.abspath(path), os.path.abspath(folder)]) == os.path.abspath(folder)
            except ValueError:          # another drive
                return False
        ok = any(_under(p, f) for f in folders) and p.lower().endswith(('.stl', '.ply'))      # (a folder's name as a prefix is not enough: C:\\scans is not C:\\scans2)
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
    for k in ("adjust", "adjust_by_arch", "mark_by_arch"):       # a new case starts on the automatic placement
        pr.pop(k, None)
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
    _save_case(job)
    _trim_caches()
    _enqueue(job)
    return {"id": jid}


# ---------- case history: every case keeps its recipe on disk (scan, settings, brush fixes, painted areas) ----------
# jobs/<id>/case.json is small and lives for good; the big outputs (models, Titan copies) are kept KEEP_OUTPUT_DAYS and
# then thinned - an old case opened from the history re-makes its models in a minute from the recipe.
KEEP_OUTPUT_DAYS = float(os.environ.get("NLO_KEEP_OUTPUT_DAYS", 30))
HISTORY = {}      # id -> case summary (from case.json), for every case on disk


_CASE_LOCK = threading.Lock()


def _write_json_atomic(path, obj):
    """case.json written whole or not at all (a kill or power cut mid-write left a torn file, and the case vanished
    from Past cases): to a temp file next to it, then swapped in."""
    tmp = f"{path}.{threading.get_ident()}.tmp"
    with _CASE_LOCK:
        with open(tmp, "w") as f:
            json.dump(obj, f, indent=1, default=float)
        os.replace(tmp, path)


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
                              precut_path=(os.path.relpath(sc["precut_path"], jdir) if sc.get("precut_path") else None),
                              braces=({k: v for k, v in sc["braces"].items() if k != "passes"} if sc.get("braces") else None)))
        fixed = job.get("fixed_labels") or {}
        for path, lab in fixed.items():
            np.savez(os.path.join(jdir, "fixedlabels_" + os.path.basename(path) + ".npz"), labels=np.asarray(lab, dtype=np.int16))
        paint = {os.path.relpath(k, jdir): v for k, v in (job.get("paint") or {}).items()}
        braces_edits = {os.path.relpath(k, jdir): v for k, v in (job.get("braces_edits") or {}).items()}
        params = {k: v for k, v in job["params"].items() if k not in ("keep_off_idx", "blockout_idx", "force_on_idx", "shield_idx", "noshield_idx")}
        case = dict(id=job["id"], name=job.get("name"), created=job.get("created"), source=job.get("source"), preset=job.get("preset"),
                    filename=job.get("filename"), params=params, scans=scans, review=job.get("review"), order_folder=job.get("order_folder"),
                    sent_at=job.get("sent_at"), learned=job.get("learned"), fixed=[os.path.relpath(k, jdir) for k in fixed], paint=paint,
                    braces_edits=braces_edits, tracker_told_how=job.get("tracker_told_how") or [],
                    print_folder=job.get("print_folder"), print_files=job.get("print_files") or [],
                    revisions=job.get("revisions") or {}, order_pieces=job.get("order_pieces") or [], order_note=job.get("order_note"),
                    thinned=bool(job.get("thinned")), saved=time.time(), restarts=job.get("restarts"),
                    status=job.get("status"), error=job.get("error"), log=list(job.get("log") or [])[-400:])
        _write_json_atomic(os.path.join(jdir, "case.json"), case)
        HISTORY[job["id"]] = _summary(case)
    except Exception as ex:  # noqa
        job.setdefault("log", []).append(f"case not saved to the history ({ex})")


def _summary(case):
    p = case.get("params") or {}
    return dict(id=case["id"], name=case.get("name"), patient=f"{p.get('patient_first', '')} {p.get('patient_last', '')}".strip(),
                created=case.get("created"), review=case.get("review"), sent_at=case.get("sent_at"), thinned=case.get("thinned"), backfilled=case.get("backfilled"),
                models=[f"{sc.get('arch') or '?'} {sc.get('tag') or ''}".strip() for sc in case.get("scans", [])],
                filename=case.get("filename"), fixed=len(case.get("fixed") or []), source=case.get("source"),
                status=case.get("status"), restarts=case.get("restarts"))


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
        tag = name.rsplit("_", 1)[-1] if name.rsplit("_", 1)[-1] in ("WT", "TT", "MG", "P1", "MODEL") else None
        p = rep.get("params") or {}
        params = params or {k: v for k, v in p.items() if k not in ("keep_off_idx", "blockout_idx", "force_on_idx", "shield_idx")}
        # the scan this model was made from: the one whose name stem matches, else the only one
        stem = name[: -len(tag) - 1] if tag else name
        cand = [sc for sc in scans_on_disk if stem.lower() in sc.lower().replace(" ", "_")] or scans_on_disk
        kind = p.get("kind") or ("A" if tag in ("TT", "P1") else "T")
        preset_of = {"TT": "aligner_high", "MG": "mouthguard", "P1": ("phase1_bott" if p.get("p1_method") == "bott" else "phase1")}
        scans.append(dict(path=cand[0], name=name, filename=cand[0].split("_", 1)[-1] if "_" in cand[0] else cand[0], arch=rep.get("arch"),
                          preset=preset_of.get(tag, "bleaching"), tag=tag, kind=kind, stage=p.get("stage", {"TT": 1, "MG": 2, "P1": 3}.get(tag, 0)),
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
        if sc.get("precut_path") and os.path.exists(os.path.join(jdir, sc["precut_path"])):
            s["precut_path"] = os.path.join(jdir, sc["precut_path"])
        else:
            s.pop("precut_path", None)
            # a case cut before the file was recorded (10/19/2026): the cut file is named after the one it was cut from
            m = re.match(r"^(.*)_cut\d+$", os.path.splitext(os.path.basename(sc["path"]))[0])
            if m:
                for e in (os.path.splitext(sc["path"])[1], ".ply", ".stl"):
                    cand = os.path.join(jdir, m.group(1) + e)
                    if os.path.exists(cand):
                        s["precut_path"] = cand
                        break
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
    braces_edits = {os.path.join(jdir, k): v for k, v in (case.get("braces_edits") or {}).items()}
    have_models = all(sc["report"] and os.path.exists((sc["report"].get("outputs") or {}).get("model", "")) for sc in scans) and bool(scans)
    job = dict(id=jid, dir=jdir, scans=scans, name=case.get("name"), params=case.get("params") or {}, status="done" if have_models else "needs_run",
               created=case.get("created") or time.time(), filename=case.get("filename"), preset=case.get("preset"), source=case.get("source"),
               review=case.get("review"), order_folder=case.get("order_folder"), order_error=None, sent_at=case.get("sent_at"), learned=case.get("learned"),
               revisions=case.get("revisions") or {}, order_pieces=case.get("order_pieces") or [], order_note=case.get("order_note"),
               print_folder=case.get("print_folder"), print_files=case.get("print_files") or [],
               fixed_labels=fixed, paint=paint, braces_edits=braces_edits, tracker_told_how=list(case.get("tracker_told_how") or []),
               thinned=case.get("thinned"), reopened=True, feat_cache={},
               log=list(case.get("log") or []) + [f"opened from the history ({time.strftime('%m/%d/%Y', time.localtime(case.get('created') or time.time()))}"
                    + (f", sent {time.strftime('%m/%d/%Y %H:%M', time.localtime(case['sent_at']))}" if case.get("sent_at") else "") + ")"])
    if case.get("status") == "error" and case.get("error"):
        job["error"] = case["error"]          # what went wrong last time stays readable; the next run clears it
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
        if jid in JOBS:
            continue                  # on the live list (being made, checked, or reopened from Past cases)
        jdir = os.path.join(JOBS_DIR, jid)
        try:
            case = json.load(open(os.path.join(jdir, "case.json")))
            for fn in os.listdir(jdir):
                if fn.endswith(("_model.stl", "_body_only.stl", "_body_plain.stl", "_blockout.stl", "_mark.stl")) or "_scan_with_reservoirs" in fn or any(sc.get("titan_basename") and fn.startswith(sc["titan_basename"]) for sc in case["scans"]):
                    os.remove(os.path.join(jdir, fn))
            case["thinned"] = True
            _write_json_atomic(os.path.join(jdir, "case.json"), case)
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
                from bleachtray.watch import RUN_SLOTS
                with RUN_SLOTS:          # (shared with the drop-folder watcher: one scan made at a time on the lab PC)
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
    return sum(1 for j in list(JOBS.values()) if j is not job and (j.get("status") == "running" or (j.get("status") == "queued" and j.get("queued_at", 0) < t)))


def _norm_adjust(a):
    out = dict(ADJUST_ZERO)
    out.update({k: round(float(v or 0.0), 4) for k, v in (a or {}).items() if k in out})
    return out


def _adjust_by_arch(params, scans):
    """The placement on the base per arch ({"upper": {yaw_deg, dx, dy, dz}, ...}). A case made before
    the placement was kept per arch has one `adjust` for every model: it counts for every arch it has."""
    m = {a: _norm_adjust(v) for a, v in (params.get("adjust_by_arch") or {}).items() if a in ("upper", "lower")}
    if not m and params.get("adjust"):
        leg = _norm_adjust(params["adjust"])
        if any(abs(v) > 1e-9 for v in leg.values()):
            m = {sc["arch"]: dict(leg) for sc in scans if sc.get("arch")}
    return m


def _mark_by_arch(params):
    """The mark on the model per arch: None = automatic (a first molar), else {raw: [x, y, z] in the
    scan's own coordinates, angle_deg, cap, text, raised}."""
    out = {}
    for a, v in (params.get("mark_by_arch") or {}).items():
        if a in ("upper", "lower"):
            out[a] = _norm_mark(v)
    return out


def _norm_mark(v):
    if not isinstance(v, dict) or v.get("raw") is None:
        return None
    try:
        raw = [round(float(x), 3) for x in v["raw"]][:3]
    except Exception:
        return None
    if len(raw) != 3:
        return None
    return dict(raw=raw, angle_deg=round(float(v.get("angle_deg") or 0.0), 1), cap=round(min(4.0, max(1.4, float(v.get("cap") or 2.4))), 2),
                text=str(v.get("text") or "initials"), raised=bool(v.get("raised", True)))


def _mark_to_raw(job, arch, v):
    """A mark the page placed in the output frame ({x, y, z, frame: "output", ...}) becomes the scan-frame
    form, through the arch's current transform; one already in raw form passes through."""
    if not isinstance(v, dict):
        return None
    if v.get("raw") is not None:
        return _norm_mark(v)
    if v.get("frame") != "output":
        return None
    T = None
    for sc in job["scans"]:
        if sc.get("arch") == arch and (sc.get("report") or {}).get("transform_raw_to_output"):
            T = np.asarray(sc["report"]["transform_raw_to_output"], float); break
    if T is None:
        return None
    p = np.array([float(v.get("x", 0)), float(v.get("y", 0)), float(v.get("z", 0)), 1.0])
    raw = (np.linalg.inv(T) @ p)[:3]
    return _norm_mark(dict(v, raw=raw.tolist()))


def _scan_params(job, scan):
    """The pipeline's parameters for one model: the case's settings, the model's preset, the page's
    per-type settings on top, the painted areas, and the arch's placement on the base."""
    params = dict(job["params"]); params["arch"] = scan.get("arch") or None
    if scan.get("preset"):
        params.update(PRESETS.get(scan["preset"], {}))
    # the page's per-type settings (whitening tray / retainer) sit on top of the preset
    per_type = (job["params"].get("wt") if scan.get("tag") == "WT" else job["params"].get("tt") if scan.get("tag") == "TT"
                else job["params"].get("p1") if scan.get("tag") == "P1" else None) or {}
    params.update({k: v for k, v in per_type.items() if v is not None})
    if scan.get("tag") == "P1":
        # Phase I by block-out needs the bite: the case's other arch, as scanned (the scanners export the two in occlusion)
        other = next((sc for sc in job["scans"] if sc.get("arch") and sc.get("arch") != scan.get("arch") and sc.get("path") != scan.get("path")), None)
        params["opposing_scan"] = (_raw_scan_for(other) or other["path"]) if other else None
    params["stage"] = scan.get("stage", params.get("stage", 0)); params["kind"] = scan.get("kind", params.get("kind", "T"))
    pe = (job.get("paint") or {}).get(scan["path"]) or {}
    params["keep_off_idx"] = pe.get("noreservoir") or []; params["blockout_idx"] = pe.get("blockout") or []; params["shield_idx"] = pe.get("shield") or []
    params["noshield_idx"] = pe.get("noshield") or []
    # "Not a bracket" painted on the retainer of the same scan is a fact about the scan: the mouthguard's band leaves it
    # out too (kept by position for the scan as scanned, which is the file the mouthguard is made from)
    be = (job.get("braces_edits") or {}).get(scan["path"]) or {}
    if scan.get("preset") == "mouthguard" and be.get("not"):
        try:
            from bleachtray.mesh_utils import load_scan
            from bleachtray.appliance import near_points
            m = load_scan(scan["path"])
            hit = np.where(near_points(m.vertices, be["not"], normals=be.get("not_n"), vnormals=m.vertex_normals))[0]
            params["noshield_idx"] = sorted(set(int(i) for i in params["noshield_idx"]) | set(int(i) for i in hit))
        except Exception:
            pass
    params["force_on_idx"] = pe.get("reservoir") or []
    params["p1_span_idx"] = pe.get("p1span") or []; params["p1_end_idx"] = pe.get("p1end") or []; params["p1_six_idx"] = pe.get("p1six") or []   # the Phase I tab's dots
    params["p1_path_idx"] = [list(r) for r in (pe.get("p1path") or []) if isinstance(r, (list, tuple)) and len(r) >= 2]   # ... and its traced cutout outlines (ordered runs of dots)
    params["tooth_ids"] = pe.get("tooth_ids") or {}      # the Teeth tab: {label: [position, primary]}
    params["adjust"] = _adjust_by_arch(job["params"], job["scans"]).get(scan.get("arch") or "", dict(ADJUST_ZERO))
    params.pop("adjust_by_arch", None)
    params["mark"] = _mark_by_arch(job["params"]).get(scan.get("arch") or "") or None
    params.pop("mark_by_arch", None)

    return params


def _run(job):
    job["status"] = "running"
    job["log"] = job.get("log") or []
    job["started"] = time.time()
    job.pop("error", None)                    # (a failure from an earlier run is not this run's)
    full = job.pop("rerun_all", False)
    mes = job.pop("mask_edit", None)
    mes = [] if not mes else (mes if isinstance(mes, list) else [mes])    # one entry per scan file painted on (upper and lower in one Apply)
    me = mes[0] if mes else None                                         # (kept for the todo rule below: any edit re-makes what it touches)
    only = job.pop("rerun_only", None)
    fast = set(job.pop("rerun_fast", None) or [])    # models that only moved on the base: body kept, base + files re-made
    todo = [k for k, sc in enumerate(job["scans"]) if full or not sc.get("report") or (only is not None and k in only) or (only is None and me is not None)]
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
        # a mouthguard is worn over the braces: its model is made from the scan as scanned, even when the same
        # scan's retainer / whitening tray has them taken off (a case made before 10/19/2026 had the guard on the
        # cleaned scan too - no room for the brackets; it goes back to the scan as scanned and is made again)
        for sc in job["scans"]:
            if sc.get("preset") == "mouthguard":
                raw = _raw_scan_for(sc)
                if raw and raw != sc["path"]:
                    sc["path"] = raw; sc.pop("braces", None); sc.pop("raw_path", None); sc.pop("report", None)
                    todo = sorted(set(todo) | {k for k, s in enumerate(job["scans"]) if s is sc})
                    log(f"[{sc.get('name')}] the mouthguard is made from the scan as scanned, braces on - it is worn over them")
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
        # the strokes, scan file by scan file (the upper's and the lower's can come in one Apply)
        paint = job.setdefault("paint", {})
        remaps, edits_by_path = {}, {}
        for me in mes:
            k0 = int(me.get("scan", 0) or 0)
            if not (0 <= k0 < len(job["scans"])):
                continue
            path0 = job["scans"][k0]["path"]
            me = dict(me)
            # "take off" strokes: a bit of bracket or wire the app missed - cut out and the enamel rebuilt, as a
            # new scan file (every model from it, every later re-run); everything indexed on the old file follows
            remap = None
            if me.get("takeoff") and job["scans"][k0].get("preset") == "mouthguard":
                # on a mouthguard nothing comes off: the painted part joins the bracket shield instead
                entry = paint.setdefault(path0, {"noreservoir": [], "blockout": []})
                entry["shield"] = sorted(set(entry.get("shield", [])) | set(int(i) for i in me["takeoff"]))
                log(f"painted: {len(entry['shield'])} vertices added to the bracket shield")
                me.pop("takeoff")
            # strokes made on the scan as scanned (the Braces step's overlay, 10/22/2026): Take off and Not a bracket are
            # vertex numbers of that file - kept by position and the take-off done again from it with both in
            if me.get("raw") and (me.get("notbracket") or me.get("takeoff")) and job["scans"][k0].get("preset") != "mouthguard":
                job["progress"] = dict(frac=0.01, label="taking the braces off again as marked", scan=k0, of=len(job["scans"]))
                try:
                    remap = _redo_take_off(job, k0, me.get("notbracket") or [], log=log, add_idx=me.get("takeoff") or [], on_raw=True)
                except Exception as ex:  # noqa
                    remap = None; log(f"braces as marked skipped: {ex}")
                if remap is not None:
                    for key in ("cut",):
                        idx = np.asarray(me.get(key) or [], dtype=int); idx = idx[(idx >= 0) & (idx < len(remap))]
                        me[key] = [int(i) for i in remap[idx] if i >= 0]
                me.pop("notbracket", None); me.pop("takeoff", None)
            # "Not a bracket" strokes (the doctor, 10/19/2026): on a mouthguard they leave the band; on a scan whose braces
            # the app took off, the take-off is done again from the scan as scanned without them
            if me.get("notbracket"):
                nb = sorted(set(int(i) for i in me["notbracket"]))
                if job["scans"][k0].get("preset") == "mouthguard":
                    entry = paint.setdefault(path0, {"noreservoir": [], "blockout": []})
                    entry["noshield"] = sorted(set(entry.get("noshield", [])) | set(nb))
                    entry["shield"] = sorted(set(entry.get("shield", [])) - set(nb))
                    log(f"not a bracket: {len(entry['noshield'])} painted vertices kept out of the bracket band")
                else:
                    job["progress"] = dict(frac=0.01, label="putting back what was not a bracket", scan=k0, of=len(job["scans"]))
                    try:
                        remap = _redo_take_off(job, k0, nb, log=log)
                    except Exception as ex:  # noqa
                        remap = None; log(f"not a bracket skipped: {ex}")
                    if remap is not None:
                        for key in ("cut", "takeoff"):     # strokes of this Apply on the old file follow it to the new one
                            idx = np.asarray(me.get(key) or [], dtype=int); idx = idx[(idx >= 0) & (idx < len(remap))]
                            me[key] = [int(i) for i in remap[idx] if i >= 0]
                me.pop("notbracket")
            if me.get("takeoff"):
                job["progress"] = dict(frac=0.01, label="taking off the painted parts", scan=k0, of=len(job["scans"]))
                # kept by position for the scan as scanned, so a later automatic take-off (after "Not a bracket") still
                # takes these off
                try:
                    raw_key = _raw_scan_for(job["scans"][k0]) or job["scans"][k0]["path"]
                    be = job.setdefault("braces_edits", {}).setdefault(raw_key, {"not": [], "add": []})
                    be["add"] = be.get("add", []) + _scan_xyz(job["scans"][k0]["path"], me["takeoff"]).round(4).tolist()
                except Exception as ex:  # noqa
                    log(f"take off strokes not kept for later: {ex}")
                try:
                    res = _take_off_braces(job, job["scans"][k0]["path"], log=log, painted=me["takeoff"])
                except Exception as ex:  # noqa
                    res = None; log(f"take off skipped: {ex}")
                if res is not None:
                    _, remap2 = res
                    remap = remap2 if remap is None else np.where(remap >= 0, remap2[np.clip(remap, 0, len(remap2) - 1)], -1)
                    for key in ("cut",):      # the cut below works on the new file; the other strokes go through `remap` later
                        idx = np.asarray(me.get(key) or [], dtype=int); idx = idx[(idx >= 0) & (idx < len(remap2))]
                        me[key] = [int(i) for i in remap2[idx] if i >= 0]
            # "cut away" strokes: those parts leave the scan file itself (every model from it, every later re-run)
            if me.get("cut"):
                job["progress"] = dict(frac=0.01, label="cutting away the painted parts of the scan", scan=k0, of=len(job["scans"]))
                remap2 = _apply_cut(job, k0, me["cut"], log=log)
                if remap2 is not None:
                    if remap is None:
                        remap = remap2
                    else:   # old file -> take-off file -> cut file
                        r = -np.ones(len(remap), dtype=np.int64); ok = remap >= 0
                        r[ok] = remap2[remap[ok]]; remap = r
            # "no reservoir" / "block out" strokes: kept per scan file (every model from it, every later re-run)
            path = job["scans"][k0]["path"]       # (a take-off / cut gave the scan a new file)
            if "p1path" in me or any(me.get(k_) for k_ in ("noreservoir", "blockout", "reservoir", "unblockout", "contact", "uncontact", "nosplit", "unnosplit", "outlines", "p1span", "unp1span", "p1end", "unp1end", "p1six", "unp1six", "teeth")):
                entry = paint.setdefault(path, {"noreservoir": [], "blockout": []})
                # the Teeth tab: the number the doctor gave a tooth ({label: [position, primary]}, position 0 = not a
                # tooth, null = back to the app's count), kept by the tooth's label - the labels are frozen for the
                # scan from here on (fixed_labels), so a later run cannot renumber them under the doctor's numbers
                if isinstance(me.get("teeth"), dict):
                    ids = dict(entry.get("tooth_ids") or {})
                    for k_, v_ in me["teeth"].items():
                        if v_ is None:
                            ids.pop(str(k_), None)
                        else:
                            ids[str(k_)] = [int(v_[0]), bool(v_[1])] if isinstance(v_, (list, tuple)) else [int(v_), False]
                    entry["tooth_ids"] = ids
                    log(f"teeth numbered by hand: {len(ids)} on this scan")
                    if path not in fixed and not (me.get("add") or me.get("remove") or me.get("relabel") or me.get("contact") or me.get("uncontact") or me.get("nosplit") or me.get("unnosplit")):
                        try:
                            st_ = np.load(os.path.join(job["dir"], f"{job['scans'][k0]['name']}_state.npz"))
                            if remap is None:
                                fixed[path] = np.asarray(st_["labels"])
                        except Exception:
                            pass
                # block-out outlines (corner vertices, clicked round an undercut): kept as drawn, for the record and
                # for teaching the automatic block-out where the doctor wants them
                for o in (me.get("outlines") or []):
                    idx = np.asarray(o or [], dtype=int)
                    if remap is not None and len(idx):
                        idx = remap[idx[(idx >= 0) & (idx < len(remap))]]; idx = idx[idx >= 0]
                    if len(idx) >= 3:
                        entry.setdefault("outlines", []).append([int(i) for i in idx])
                if me.get("outlines"):
                    log(f"block-out outlines: {len(me['outlines'])} drawn, {len(entry.get('outlines', []))} on this scan")
                for key in ("noreservoir", "blockout", "reservoir", "contact", "nosplit", "p1span", "p1end", "p1six"):
                    idx = np.asarray(me.get(key) or [], dtype=int)
                    if remap is not None and len(idx):
                        idx = remap[idx[(idx >= 0) & (idx < len(remap))]]; idx = idx[idx >= 0]
                    entry[key] = sorted(set(entry.get(key, [])) | set(int(i) for i in idx))
                # the Phase I tab's dots taken away (the cutout span's ends, where the retainer ends)
                for key in ("p1span", "p1end", "p1six"):
                    if me.get("un" + key):
                        idx = np.asarray(me["un" + key], dtype=int)
                        if remap is not None and len(idx):
                            idx = remap[idx[(idx >= 0) & (idx < len(remap))]]; idx = idx[idx >= 0]
                        entry[key] = sorted(set(entry.get(key, [])) - set(int(i) for i in idx))
                if any(me.get(k_) for k_ in ("p1span", "unp1span", "p1end", "unp1end", "p1six", "unp1six")):
                    log(f"Phase I dots: {len(entry.get('p1span', []))} for the cutout spans, {len(entry.get('p1end', []))} where the retainer ends, {len(entry.get('p1six', []))} on the 6s")
                # the Phase I tab's traced cutout outlines (ordered runs of dots: the 2's distal, round the tongue side, the
                # E/5): the page sends every outline it holds for the scan, so the list replaces the kept one ([] clears)
                if "p1path" in me and isinstance(me["p1path"], list):
                    runs = []
                    for run in me["p1path"]:
                        idx = np.asarray(run or [], dtype=int)
                        if remap is not None and len(idx):
                            idx = remap[idx[(idx >= 0) & (idx < len(remap))]]; idx = idx[idx >= 0]
                        if len(idx) >= 2:
                            runs.append([int(i) for i in idx])
                    entry["p1path"] = runs
                    log(f"Phase I cutout outlines: {len(runs)} traced" + (" (the earlier ones replaced)" if runs else " - cleared"))
                # the two reservoir brushes cancel each other where they overlap: the later stroke wins
                if me.get("reservoir"):
                    entry["noreservoir"] = sorted(set(entry["noreservoir"]) - set(entry["reservoir"]))
                if me.get("noreservoir"):
                    entry["reservoir"] = sorted(set(entry.get("reservoir", [])) - set(entry["noreservoir"]))
                # the Clear brush takes a painted block-out away (what the Block-outs tab shows pale green)
                if me.get("unblockout"):
                    idx = np.asarray(me["unblockout"], dtype=int)
                    if remap is not None and len(idx):
                        idx = remap[idx[(idx >= 0) & (idx < len(remap))]]; idx = idx[idx >= 0]
                    before = len(entry["blockout"])
                    entry["blockout"] = sorted(set(entry["blockout"]) - set(int(i) for i in idx))
                    log(f"painted: block-out cleared on {before - len(entry['blockout'])} vertices")
                # a contact dot taken away again (an applied one shows pale on the Segmentation tab)
                if me.get("uncontact"):
                    idx = np.asarray(me["uncontact"], dtype=int)
                    if remap is not None and len(idx):
                        idx = remap[idx[(idx >= 0) & (idx < len(remap))]]; idx = idx[idx >= 0]
                    before = len(entry.get("contact", []))
                    entry["contact"] = sorted(set(entry.get("contact", [])) - set(int(i) for i in idx))
                    log(f"contact dots: {before - len(entry['contact'])} taken away, {len(entry['contact'])} kept")
                if me.get("contact"):
                    log(f"contact dots: {len(entry['contact'])} on this scan")
                # a "no split here" dot taken away again (the split comes back on this Apply)
                if me.get("unnosplit"):
                    idx = np.asarray(me["unnosplit"], dtype=int)
                    if remap is not None and len(idx):
                        idx = remap[idx[(idx >= 0) & (idx < len(remap))]]; idx = idx[idx >= 0]
                    before = len(entry.get("nosplit", []))
                    entry["nosplit"] = sorted(set(entry.get("nosplit", [])) - set(int(i) for i in idx))
                    log(f"no-split dots: {before - len(entry['nosplit'])} taken away, {len(entry['nosplit'])} kept")
                if me.get("nosplit"):
                    log(f"no-split dots: {len(entry['nosplit'])} on this scan (two colours made one tooth)")
                log(f"painted: {len(entry['noreservoir'])} vertices without reservoir, {len(entry.get('reservoir', []))} with one added, {len(entry['blockout'])} to block out")
            remaps[path] = remap; edits_by_path[path] = (k0, me)
        for i, k in enumerate(todo):
            scan = job["scans"][k]
            def progress(frac, label, i=i, k=k):
                job["progress"] = dict(frac=round((i + frac) / n, 3), label=label, scan=k, of=len(job["scans"]), step=i, steps=n)
            if scan["path"] in edits_by_path and scan["path"] not in overrides:
                k0, me = edits_by_path[scan["path"]]
                if me.get("add") or me.get("remove") or me.get("relabel") or me.get("contact") or me.get("uncontact") or me.get("nosplit") or me.get("unnosplit"):
                    progress(0.02, "applying your brush fixes")
                    old_lab = fixed.get(scan["path"])
                    if old_lab is None:
                        try:
                            old_lab = np.asarray(np.load(os.path.join(job["dir"], f"{job['scans'][k0]['name']}_state.npz"))["labels"])
                        except Exception:
                            old_lab = None
                    overrides[scan["path"]] = _apply_mask_edit(job, k0, edit=me, remap=remaps.get(scan["path"]))
                    fixed[scan["path"]] = overrides[scan["path"]]
                    ids = ((job.get("paint") or {}).get(scan["path"]) or {}).get("tooth_ids")
                    if ids and old_lab is not None and len(old_lab) == len(overrides[scan["path"]]):
                        new_lab = overrides[scan["path"]]
                        moved = {}
                        for k_, v_ in ids.items():
                            m_ = old_lab == int(k_)
                            cand = new_lab[m_ & (new_lab > 0)]
                            if len(cand):
                                moved[str(int(np.bincount(cand).argmax()))] = v_
                        job["paint"][scan["path"]]["tooth_ids"] = moved
            override = overrides.get(scan["path"], fixed.get(scan["path"]))
            params = _scan_params(job, scan)
            if k in fast and not full and scan.get("report") and os.path.exists(os.path.join(job["dir"], f"{scan['name']}_body_only.stl")):
                try:
                    rep = replace_placement(job["dir"], scan["name"], params, scan["report"], params["adjust"], log=log, progress=progress)
                except Exception as ex:  # noqa
                    log(f"[{scan['name']}] could not be moved on the base ({ex}); re-made instead")
                    rep = process(scan["path"], job["dir"], name=scan["name"], params=params, models=MODELS,
                                  label_override=override, log=log, progress=progress, feat_cache=job.setdefault("feat_cache", {}))
            else:
                rep = process(scan["path"], job["dir"], name=scan["name"], params=params, models=MODELS,
                              label_override=override, log=log, progress=progress, feat_cache=job.setdefault("feat_cache", {}))
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
        job.pop("restarts", None)              # made: a later restart while it is re-made counts from zero again
        _save_case(job)
    except Exception as ex:  # noqa
        job["status"] = "error"
        job["error"] = f"{ex}\n{traceback.format_exc()}"
        _save_case(job)                        # the case, its scans and what went wrong survive a restart


def _write_order(job, log=print, preform_here=True, only=None):
    """Write (or replace) this job's OrthoFactory order folder from its finished pieces. preform_here:
    the click came from this PC, so the models may open in PreForm on this screen (Settings). `only`: the
    scan indices to send (None = every piece) - the Send dialog's ticks; the case remembers which went."""
    site = site_config()
    root = (job["params"].get("order_root") or "").strip() or site["order_root"]
    prev = job.get("order_folder")
    # the revision letters this patient's pieces have had (read before this case's own earlier folder goes:
    # OrthoFactory still has that one) - every piece is written with the next letter, so OrthoFactory makes
    # a fresh cut path instead of reusing the earlier piece's (orderfolder.py)
    seen = dict(job.get("revisions") or {})
    if root and job["params"].get("patient_first") and job["params"].get("patient_last"):
        try:
            from bleachtray.orderfolder import sent_revisions
            for k, v in sent_revisions(root, job["params"]["patient_first"], job["params"]["patient_last"]).items():
                if v > seen.get(k, ""):
                    seen[k] = v
        except Exception as ex:  # noqa
            log(f"earlier revision letters not read: {ex}")
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
                   stage=int(sc.get("stage", job["params"].get("stage", 0))), kind=sc.get("kind", job["params"].get("kind", "T")), scan=k)
              for k, sc in enumerate(job["scans"]) if only is None or k in only]
    if not pieces:
        job["order_error"] = "no piece ticked to send"
        return False
    job["sent_scans"] = [p["scan"] for p in pieces]
    try:
        folder = write_order_folder(root, job["params"]["patient_first"], job["params"]["patient_last"], pieces,
                                    patient_id=job["params"].get("patient_id") or None,
                                    doctor=job["params"].get("doctor") or site["doctor"], seen=seen)
        job["order_folder"] = folder
        job["review"] = "sent"
        revs = dict(seen)
        for p in pieces:
            if p.get("code"):
                revs[p["code"][:-1]] = max(p["code"][-1], revs.get(p["code"][:-1], ""))
        job["revisions"] = revs
        job["order_pieces"] = [p.get("code") for p in pieces]
        log(f"OrthoFactory order written: {folder} ({', '.join(p.get('code') or '?' for p in pieces)})")
        # another case of this patient already sent the same piece: OrthoFactory lists both orders, and the
        # two models need not sit alike on the base (one moved by hand) - say so, the trimmer must not mix them
        job["order_note"] = None
        try:
            from bleachtray.orderfolder import earlier_orders, earlier_orders_note
            note = earlier_orders_note(earlier_orders(root, job["params"]["patient_first"], job["params"]["patient_last"], pieces, this_folder=folder))
            if note:
                job["order_note"] = note
                log(note)
        except Exception as ex:  # noqa
            log(f"earlier orders not checked: {ex}")
    except Exception as ex:  # noqa
        job["order_error"] = str(ex)
        log(f"order folder failed: {ex}")
        return False
    # the printable models are filed by patient in the print folder (Settings -> Print folder) ...
    _write_prints(job, log=log, only=only)
    # ... and go straight to the printer's software from there (Settings -> PreForm), so printing is the next click
    if site.get("preform_on_send", True) and preform_here:
        ok, msg = _open_in_preform(job, log=log)
        job["preform"] = dict(ok=ok, message=msg, when=time.time())
    elif site.get("preform_on_send", True):
        job["preform"] = None     # the page that sent it (another PC) opens PreForm there
        log("sent from another PC: PreForm opens there, not on this one")
    return True


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


def _remap_entry(pe, remap, skip=()):
    """A scan file's painted areas carried to its new file by `remap` (old -> new vertex index, -1 = gone): every
    vertex list, and the block-out outlines (lists of corners, kept while 3 corners survive)."""
    out = {}
    for key, vals in (pe or {}).items():
        if key in skip or not isinstance(vals, list):
            continue
        if key in ("outlines", "p1path"):
            outl = []
            for o in vals:
                o = np.asarray(o or [], dtype=int); o = o[(o >= 0) & (o < len(remap))]
                o = [int(i) for i in remap[o] if i >= 0]
                if len(o) >= (3 if key == "outlines" else 2):
                    outl.append(o)
            out[key] = outl
            continue
        if vals and not isinstance(vals[0], (int, np.integer)):
            continue
        v = np.asarray(vals, dtype=int); v = v[(v >= 0) & (v < len(remap))]
        out[key] = sorted(set(int(i) for i in remap[v] if i >= 0))
    return out


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
        paint[new_path] = _remap_entry(paint.pop(old_path), remap)     # (outlines too: a ragged list broke the cut)
    for sc in job["scans"]:
        if sc["path"] == old_path:
            sc.setdefault("precut_path", old_path)     # what "Bring back what was cut" goes back to
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


def _take_off_braces(job, path, log=print, painted=None, exclude_pts=None, add_pts=None, force=False, exclude_normals=None):
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
    if auto and not force and (path in done or "_clean" in os.path.basename(path) or not path.lower().endswith(".ply")):
        return None
    # painted "Not a bracket" / "Take off" strokes kept for this scan as scanned (positions in the scanner's own
    # coordinates): an automatic take-off honours them, whenever it runs again
    be = (job.get("braces_edits") or {}).get(path) or {}
    if exclude_pts is None:
        exclude_pts = be.get("not"); exclude_normals = be.get("not_n")
    if add_pts is None:
        add_pts = be.get("add")
    raw = load_scan(path)
    rgb = raw.metadata.get("rgb")
    if auto and rgb is None:
        done[path] = dict(used=False); return None
    mesh, T_rough = rough_orient(raw)
    A = adjacency(mesh)
    if auto:
        feats = compute_features(mesh, return_aux=True)
        to_rough = lambda P: (trimesh.transform_points(np.asarray(P, float).reshape(-1, 3), T_rough) if P is not None and len(P) else None)
        ex_n = None
        if exclude_pts is not None and exclude_normals is not None and len(exclude_normals) == len(exclude_pts):
            ex_n = np.asarray(exclude_normals, float).reshape(-1, 3) @ np.asarray(T_rough)[:3, :3].T      # (normals turn, never move)
        clean, info, A2, feats2 = take_off_appliances(mesh, A, mesh.metadata["rgb"], feats, log=log,
                                                      exclude_pts=to_rough(exclude_pts), add_pts=to_rough(add_pts), exclude_normals=ex_n)
        # what was found on the scan as scanned (vertex numbers of that file), for the Braces step's overlay on it
        m0 = info.pop("_mask0", None)
        try:
            np.save(_braces_mask_path(job, path), np.asarray(m0 if m0 is not None else [], dtype=np.int64))
        except Exception:
            pass
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
        info = dict(used=True, pieces=int(prev.get("pieces", 0)) + 1, area_mm2=float(prev.get("area_mm2", 0.0)), vertices=int(prev.get("vertices", 0)) + int(pmask.sum()), painted=True, **{k: v for k, v in rinfo.items() if k not in ("vertices", "_new_mask")})
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
    # a mouthguard made from this very file keeps its painted areas and tooth fixes (its band strokes, Not a bracket):
    # they used to move to the cleaned file with the retainer, and the guard lost them
    mg_here = any(sc["path"] == path and sc.get("preset") == "mouthguard" for sc in job["scans"])
    old_entry = None if mg_here else paint.pop(path, None)
    if old_entry:   # strokes painted on the earlier file (and its rebuilt enamel): carried over by position
        moved = _remap_entry(old_entry, remap, skip=("large",))
        patched |= set(moved.pop("removed", []))
        for key, vals in moved.items():
            if key in ("outlines", "p1path"):
                entry[key] = (entry.get(key) or []) + vals
            else:
                entry[key] = sorted(set(entry.get(key, [])) | set(vals))
    entry["removed"] = sorted(patched)
    # rebuilt areas bigger than most of a tooth (brackets, wire and ties run together on crowded teeth): red on
    # the Braces tab and named on the case - the enamel there is a guess
    try:
        from bleachtray.appliance import rebuilt_areas, LARGE_PATCH_MM2
        orig = next((sc.get("raw_path") for sc in job["scans"] if sc["path"] == path and sc.get("raw_path")), None)
        before = load_scan(orig) if orig and orig != path and os.path.exists(orig) else raw
        areas, per_v = rebuilt_areas(before, re_)
        entry["large"] = [int(i) for i in np.where(per_v > LARGE_PATCH_MM2)[0]]
        info["large_patches"] = [round(a) for a in areas if a > LARGE_PATCH_MM2]
        info["rebuilt_mm2"] = [round(a) for a in areas[:16]]
    except Exception as ex:  # noqa
        log(f"rebuilt areas not measured: {ex}")
    for sc in job["scans"]:
        if sc["path"] == path:
            if sc.get("preset") == "mouthguard":
                continue          # worn over the braces: its model keeps them (under shields), from the scan as scanned
            sc["path"] = new_path; sc.setdefault("raw_path", path); sc["braces"] = info
    if not mg_here and job.get("fixed_labels", {}).pop(path, None) is not None:
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


def _scan_xyz(path, idx):
    """Positions (the scanner's own coordinates, as the file holds them) of vertices `idx` of the scan file at `path`."""
    from bleachtray.mesh_utils import load_scan
    V = np.asarray(load_scan(path).vertices)
    idx = np.asarray(idx, dtype=int); idx = idx[(idx >= 0) & (idx < len(V))]
    return V[idx]


def _redo_take_off(job, k, not_idx, log=print, add_idx=None, on_raw=False):
    """'Not a bracket' strokes (the doctor, 10/19/2026) on a scan whose braces the app took off: the take-off is done
    again from the scan as scanned, leaving the painted areas as they were scanned (the strokes are kept by position
    for every later take-off of that scan, and saved with the case's lesson). Strokes kept for the current file go
    with it by position. Returns old -> new vertex index map of the scan file (-1 = gone), or None."""
    from bleachtray.mesh_utils import load_scan
    from scipy.spatial import cKDTree
    sc = job["scans"][k]; cur = sc["path"]
    raw = _raw_scan_for(sc)
    if not raw or raw == cur or not os.path.exists(raw):
        log("not a bracket: the app did not take braces off this scan - nothing to put back (a mouthguard's band is changed instead)")
        return None
    mc = load_scan(cur); Vc = np.asarray(mc.vertices)
    # strokes painted on the scan as scanned (the Braces step's overlay): vertex numbers of that file
    ms = load_scan(raw) if on_raw else mc
    Vs = np.asarray(ms.vertices); Ns = np.asarray(ms.vertex_normals)
    idx = np.asarray(not_idx if not_idx is not None else [], dtype=int); idx = idx[(idx >= 0) & (idx < len(Vs))]
    aidx = np.asarray(add_idx if add_idx is not None else [], dtype=int); aidx = aidx[(aidx >= 0) & (aidx < len(Vs))]
    if not len(idx) and not len(aidx):
        return None
    be = job.setdefault("braces_edits", {}).setdefault(raw, {"not": [], "add": []})
    # each painted point with the painted surface's normal: the stroke is on the smooth rebuilt enamel, and what the
    # detector took off stood over it (near_points matches along that line)
    nn = be.get("not_n") or []
    nn = list(nn) + [[0.0, 0.0, 0.0]] * max(0, len(be.get("not", [])) - len(nn))
    be["not"] = be.get("not", []) + Vs[idx].round(4).tolist()
    be["not_n"] = nn[:len(be["not"]) - len(idx)] + Ns[idx].round(3).tolist()
    if len(aidx):
        be["add"] = be.get("add", []) + Vs[aidx].round(4).tolist()
    # a Clean-up cut made after the braces came off: the scan as scanned still has what was cut, so the cut is made
    # again on the new file (what it took away, by position: the cut file is the cleaned file less those vertices)
    cut_pts = None
    pre = sc.get("precut_path")
    if pre and pre != cur and os.path.exists(pre) and "_clean" in os.path.basename(pre):
        Vp = np.asarray(load_scan(pre).vertices)
        cut_pts = Vp[cKDTree(Vc).query(Vp)[0] > 1e-3]
    paint = job.setdefault("paint", {})
    pe = paint.pop(cur, None)          # the retainer's own strokes: carried to its new file below, by position
    for s2 in job["scans"]:
        if s2["path"] == cur and s2.get("preset") != "mouthguard":
            s2["path"] = raw; s2.pop("braces", None)
    job.setdefault("braces", {}).pop(raw, None); job["braces"].pop(cur, None)
    job.setdefault("fixed_labels", {}).pop(cur, None)
    for key in [key for key in job.get("feat_cache", {}) if (key if isinstance(key, str) else key[0]) in (cur, raw)]:
        job["feat_cache"].pop(key, None)
    _take_off_braces(job, raw, log=log, exclude_pts=be["not"], exclude_normals=be.get("not_n"), add_pts=be.get("add") or None, force=True)
    if cut_pts is not None and len(cut_pts):
        newp = job["scans"][k]["path"]
        recut = np.where(cKDTree(cut_pts).query(np.asarray(load_scan(newp).vertices))[0] < 1e-3)[0]
        for s2 in job["scans"]:
            if s2["path"] == newp:
                s2.pop("precut_path", None)          # "Bring back" goes to the new cleaned file from now on
        if len(recut):
            _apply_cut(job, k, recut, log=log)
            log(f"not a bracket: the Clean-up cut made again on the new file ({len(recut)} vertices)")
    new = job["scans"][k]["path"]
    d2, j2 = cKDTree(np.asarray(load_scan(new).vertices)).query(Vc)
    if pe:
        c2n = np.where(d2 < 1e-3, j2, -1).astype(np.int64)
        ne = paint.setdefault(new, {"noreservoir": [], "blockout": []})
        for key, vals in _remap_entry(pe, c2n, skip=("removed", "large")).items():
            ne[key] = (ne.get(key) or []) + vals if key in ("outlines", "p1path") else sorted(set(ne.get(key, [])) | set(vals))
    log((f"not a bracket: {len(idx)} painted vertices" if len(idx) else "take off") + (f", take off: {len(aidx)} painted vertices" if len(aidx) and len(idx) else (f": {len(aidx)} painted vertices on the scan as scanned" if len(aidx) else ""))
        + f" - braces taken off the scan as scanned again{', those areas left as scanned' if len(idx) else ''} ({os.path.basename(new)})")
    return np.where(d2 < 1e-3, j2, -1).astype(np.int64)


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
    # the Tooth brush with a tooth picked (Shift-click on it): each stroke vertex carries the picked label as
    # label * 1e6 + vertex (the doctor, 10/21/2026: "wherever the brush picks from will be the colour that is painted -
    # paint over the area that bled from the adjacent tooth, nice separation between teeth")
    rel = np.array(edit.get("relabel", []), dtype=np.int64)
    rel_lab, rel_v = (rel // 1000000).astype(int), (rel % 1000000).astype(int)
    raw = load_scan(scan["path"])
    nV = len(raw.vertices)
    known = np.ones(nV, bool)
    if remap is not None and len(remap) == len(labels):
        kept = remap >= 0
        # sized to the new file: a take-off in the same Apply adds the rebuilt enamel's vertices at its end (the label
        # array sized by the remap was too short for them and the run failed)
        newlab = np.zeros(nV, dtype=labels.dtype); newlab[remap[kept]] = labels[kept]; labels = newlab
        known = np.zeros(nV, bool); known[remap[kept]] = True
        add = remap[add[(add >= 0) & (add < len(remap))]]; add = add[add >= 0]
        rem = remap[rem[(rem >= 0) & (rem < len(remap))]]; rem = rem[rem >= 0]
        okr = (rel_v >= 0) & (rel_v < len(remap)); rel_v, rel_lab = remap[rel_v[okr]], rel_lab[okr]; rel_lab = rel_lab[rel_v >= 0]; rel_v = rel_v[rel_v >= 0]
    elif len(labels) != nV:
        lab2 = np.zeros(nV, dtype=labels.dtype); m_ = min(nV, len(labels)); lab2[:m_] = labels[:m_]; labels = lab2
        known = np.zeros(nV, bool); known[:m_] = True
    add = add[(add >= 0) & (add < nV)]; rem = rem[(rem >= 0) & (rem < nV)]
    okr = (rel_v >= 0) & (rel_v < nV); rel_v, rel_lab = rel_v[okr], rel_lab[okr]
    if len(rel_v):
        add = np.unique(np.concatenate([add, rel_v]))            # what is painted with a tooth's colour is tooth
    mask = labels > 0
    if len(add):
        mask[add] = True
    if len(rem):
        mask[rem] = False
    mesh, _ = rough_orient(raw)
    cache = job.setdefault("feat_cache", {})
    feats = cache.get(scan["path"])
    if feats is None:
        from bleachtray.features import compute_features
        feats = compute_features(mesh, return_aux=True)
        cache[scan["path"]] = feats
    p_tooth, p_ip, aux = predict_tooth_prob(mesh, MODELS, feats=feats)
    if not known.all():                  # vertices the earlier labels never saw (rebuilt enamel): the model decides
        from bleachtray.segment import tooth_threshold
        unk = ~known
        mask[unk] = np.asarray(p_tooth)[unk] > tooth_threshold(MODELS)
        if len(add):
            mask[add] = True
        if len(rem):
            mask[rem] = False
    A = aux["A"]
    mask = clean_mask(mask, A)
    arch = scan.get("arch") or job["params"].get("arch") or detect_arch(mesh, os.path.basename(scan["path"]))
    # the doctor's contact dots (this edit's and the ones kept from earlier) decide where crowded teeth split
    dots = set(int(i) for i in ((job.get("paint") or {}).get(scan["path"]) or {}).get("contact", []))
    con = np.array(edit.get("contact", []), dtype=int)
    if remap is not None and len(remap) == len(st["labels"]) and len(con):
        con = remap[con[(con >= 0) & (con < len(remap))]]; con = con[con >= 0]
    dots |= set(int(i) for i in con)
    # and the "no split here" dots (a click on a split the app made inside one tooth)
    nos = set(int(i) for i in ((job.get("paint") or {}).get(scan["path"]) or {}).get("nosplit", []))
    nn = np.array(edit.get("nosplit", []), dtype=int)
    if remap is not None and len(remap) == len(st["labels"]) and len(nn):
        nn = remap[nn[(nn >= 0) & (nn < len(remap))]]; nn = nn[nn >= 0]
    nos |= set(int(i) for i in nn)
    nos -= set(int(i) for i in np.asarray(edit.get("unnosplit", []), dtype=int))
    log_lines = []
    labels2 = separate_teeth(mesh, mask, p_ip, A, aux, arch, log=log_lines.append, contacts=sorted(dots), nosplits=sorted(nos))
    if len(rel_v):
        # the picked colours are the page's labels (the earlier run's): each maps to the new label it mostly became;
        # the painted vertices take that label, so a neighbour's bleed is given back to the tooth it belongs to
        newid = {}
        for k in np.unique(rel_lab):
            m = labels == k
            cand = labels2[m & (labels2 > 0)]
            newid[int(k)] = int(np.bincount(cand).argmax()) if len(cand) else int(labels2.max()) + 1 + len(newid)
        for k, v in zip(rel_lab, rel_v):
            labels2[v] = newid[int(k)]
        log_lines.append(f"tooth colour painted on {len(rel_v)} vertices ({len(newid)} teeth picked)")
    for ln in log_lines:
        if "contact dots" in ln or "no-split dots" in ln or "tooth colour" in ln or "loose pieces" in ln:
            job.setdefault("log", []).append(f"[{scan['name']}] {ln}")
    return labels2


@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(ROOT, "app", "static", "index.html"), encoding="utf-8") as f:
        return f.read()


def _build_info():
    """This copy of the app: a hash of its program files (the same for the same code on every PC) and the time of the
    newest one (the update sets each file's time to its commit). Shown in Settings -> Office; /api/version."""
    import hashlib
    h = hashlib.sha1(); newest = 0.0
    # (not update.ps1: on the lab PC a .ps1 cannot be written, so it is never in the folder - with it in the list the
    # figure there never matched the release note, 10/21/2026)
    rels = ["app/server.py", "app/tracker.py", "app/static/index.html", "run_app.py"] + [f"bleachtray/{m}.py" for m in (
        "appliance", "basebuild", "blockout", "colour", "engrave", "features", "interprox", "learn", "mesh_utils", "mouthguard",
        "orderfolder", "orient", "phase1", "pipeline", "printfolder", "register", "reservoir", "segment", "server_presets", "solid", "watch")]
    for rel in rels:
        fp = os.path.join(ROOT, *rel.split("/"))
        try:
            with open(fp, "rb") as fh:
                h.update(rel.encode() + b"\0" + fh.read().replace(b"\r\n", b"\n"))
            newest = max(newest, os.path.getmtime(fp))
        except OSError:
            continue
    return dict(build=h.hexdigest()[:10], newest=time.strftime("%m/%d/%Y %H:%M", time.localtime(newest)) if newest else "?")


BUILD = _build_info()


@app.get("/api/version")
def version():
    return BUILD


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
    """Feature caches are big: keep them only for the few most recent cases (never a case waiting or being made: its
    run reads the cache between models - dropping it under a running case failed that run)."""
    for old in sorted(list(JOBS.values()), key=lambda j: -j["created"])[4:]:
        if old.get("status") not in ("queued", "running"):
            old.pop("feat_cache", None)


def _open_case_for(first, last, arch, max_age=45 * 60):
    """An unsent case of this patient from the last 45 minutes that has no model of this arch yet:
    an upper dropped now joins the lower dropped a minute ago instead of becoming a second order."""
    if not (first and last and arch):
        return None
    key = (first.strip().lower(), last.strip().lower())
    for j in sorted(list(JOBS.values()), key=lambda j: -j["created"]):
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
        if tag == "MG" and (arch or "") == "lower":
            continue                                  # a mouthguard is made for the upper only (for now)
        job["scans"].append(dict(path=path, name=f"{stem}_{tag}", filename=filename, arch=arch, preset=vpreset, tag=tag, kind=kind, stage=stage,
                                 braces_on=bool(braces_on)))
    job["filename"] = ", ".join(dict.fromkeys(sc["filename"] for sc in job["scans"]))


def _group_uploads(items):
    """items: [(index, filename, arch or None)] -> list of cases, each [(index, filename, arch, first, last)].
    Files are grouped by the patient name in the file name; within a patient one upper + one lower make
    a case; an iTero export's upper + lower are paired by their order number (the names hold no patient); any
    other file whose name holds no patient name is a case of its own."""
    from bleachtray.watch import parse_name, itero_order
    cases, by_patient = [], {}
    for idx, fn, arch in items:
        first, last, a = parse_name(fn)
        arch = arch or a
        known = first != "Scan"
        order = None if known else itero_order(fn)
        key = (first.lower(), last.lower()) if known else (("#itero", order) if order else ("", f"#{idx}"))
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
    table = {"WT": (wt, "WT", "T", 0), "TT": ("aligner_high", "TT", "A", 1), "MG": ("mouthguard", "MG", "T", 2), "P1": ("phase1", "P1", "A", 3)}
    out = [table[t] for t in (makes or []) if t in table]
    return out or [("plain_model", "MODEL", "T", 0)]


@app.post("/api/jobs")
async def create_job(files: List[UploadFile] = File(...), preset: str = Form("bleaching"), params: str = Form("{}"),
                     name: str = Form(""), arches: str = Form("[]"), makes: str = Form(""), braces: str = Form(""),
                     one_case: str = Form("")):
    """Any number of scans at once: one case per patient (upper + lower paired by the file names).
    `makes`: per-file list of what to make (["WT","TT"]); without it every file gets the preset's variants.
    `braces`: per-file list of booleans - the scan has braces on and they are to come off first (never assumed).
    `one_case`: the New case pop-up's Start - its one or two scans are one patient's, under the name typed
    there, whatever the file names say (an iTero export's hold an order number, no name)."""
    p0 = dict(PRESETS.get(preset, PRESETS["bleaching"]))
    try:
        p0.update(json.loads(params or "{}"))
    except Exception:
        pass
    # a new case starts on the automatic placement and mark: the page's maps belong to the case on screen (another
    # patient's shift and turn used to be built into the new case)
    for k in ("adjust", "adjust_by_arch", "mark_by_arch"):
        p0.pop(k, None)
    try:
        arch_list = json.loads(arches or "[]")
    except Exception:
        arch_list = []
    arch_list = [a if a in ("upper", "lower") else None for a in (arch_list if isinstance(arch_list, list) else [])]
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
    items = [(k, fn, (arch_list[i] if i < len(arch_list) else None) or None) for i, (k, fn, _) in enumerate(blobs)]
    cases = None
    if one_case and len(items) <= 2:
        from bleachtray.watch import parse_name
        arch_k = [a or parse_name(fn)[2] for _, fn, a in items]
        if len(items) == 1 or None in arch_k or arch_k[0] != arch_k[1]:       # two uppers stay two cases
            cases = [[(k, fn, a, "", "") for (k, fn, _), a in zip(items, arch_k)]]
    if cases is None:
        cases = _group_uploads(items)
    data = {k: (fn, b) for k, fn, b in blobs}
    per_file = {k: (_variants_from_makes(makes_list[i], preset) if makes_list and i < len(makes_list) else None) for i, (k, fn, _) in enumerate(blobs)}
    per_braces = {k: bool(braces_list[i]) if i < len(braces_list) else bool(p0.get("remove_appliances")) for i, (k, fn, _) in enumerate(blobs)}
    single = len(cases) == 1
    ids, joined = [], []
    for case in cases:
        first, last = case[0][3], case[0][4]
        p = dict(p0)
        if (single or one_case) and (p0.get("patient_first") or p0.get("patient_last")):
            first, last = p0.get("patient_first", ""), p0.get("patient_last", "")
        p["patient_first"], p["patient_last"] = first, last
        # the queue case picked on the page ties this case to NLO Cases only when it is this patient's (a pick left on
        # the page used to tie other patients' cases to it - and a drop of several patients, every one of them)
        if p.get("tracker_case") and not (single and _tracker_item_fits(p["tracker_case"], first, last)):
            p.pop("tracker_case", None)
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
                _save_case(other)
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
        _link_tracker(job, log=lambda m: job.setdefault("log", []).append(m))
        JOBS[jid] = job
        _save_case(job)
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
    if src is None or make not in ("WT", "TT", "MG", "P1"):
        raise HTTPException(400, "no such scan in this case")
    if make == "MG" and arch == "lower":
        raise HTTPException(400, "a mouthguard is made for the upper only")
    if any(sc["path"] == src["path"] and sc.get("tag") == make for sc in job["scans"]):
        raise HTTPException(409, f"{make} {arch} is already part of this case")
    variants = _variants_from_makes([make], job.get("preset") or "bleaching")
    _add_scans(job, src["path"], src["filename"], arch, job.get("preset") or "bleaching", variants=variants)
    job.setdefault("log", []).append(f"{ {'WT': 'whitening tray', 'TT': 'retainer', 'MG': 'mouthguard', 'P1': 'Phase I retainer'}[make] } added for the {arch} from the scan already in the case")
    job["auto_order"] = False
    _save_case(job)                            # the added model is part of the case from now, run or not
    _enqueue(job)
    return {"id": jid, "models": len(job["scans"])}


@app.post("/api/jobs/{jid}/rerun")
async def rerun(jid: str, edits: str = Form("{}"), params: str = Form("{}")):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    try:
        me = json.loads(edits or "{}")
        # one edit per scan file (the upper's and the lower's strokes come in one Apply); a re-run without
        # any painted vertex is just a re-run: it must not count as a brush correction
        mes = me if isinstance(me, list) else ([me] if me else [])
        mes = [e for e in mes if isinstance(e, dict) and ("p1path" in e or any(e.get(k) for k in ("add", "remove", "relabel", "cut", "noreservoir", "blockout", "unblockout", "takeoff", "notbracket", "reservoir", "contact", "uncontact", "nosplit", "unnosplit", "outlines", "p1span", "unp1span", "p1end", "unp1end", "p1six", "unp1six", "teeth")))]
    except Exception:
        mes = []
    # strokes are vertex numbers of the scan file as the page showed it: while the case is waiting or being made, the
    # file can change under them (a cut, a take-off) and a second Apply used to replace the first one's strokes
    busy = job.get("status") in ("queued", "running")
    if mes and busy:
        raise HTTPException(409, "the case is being made - your strokes are kept on screen: click Apply again when it is done")
    if not busy:                       # (a case waiting in line keeps the strokes it was queued with)
        job["mask_edit"] = mes or None
    # only the models a change touches are re-made: a retainer-line change leaves the whitening trays
    # alone (and the other way round); a change to the base, marks or anything shared re-makes them all
    try:
        new = json.loads(params or "{}")
    except Exception:
        new = {}
    # the page sends its New-case fields with every re-run; after a reload those are empty, and an
    # empty name / folder / doctor must never wipe the ones the case was made with
    for k in IDENTITY_KEYS:
        if k in new and not (str(new[k]).strip() if new[k] is not None else ""):
            new.pop(k)
    # the NLO Cases case a case is tied to is set when it is made (or matched by name), never by a re-run: the page's
    # queue pick belongs to whatever was picked last, and an empty one used to wipe the tie
    new.pop("tracker_case", None)
    old = job["params"]
    # ... and a case keeps the patient it was made for: the page's name fields are a shared card that may
    # still show the previous patient, and a re-run must never rename (and re-engrave) a case from them.
    # A case that has no name yet takes one through the patient line (_name_from_form), nowhere else.
    for k in ("patient_first", "patient_last", "patient_id"):
        if k in new and str(old.get(k) or "").strip() and str(new[k]).strip() != str(old[k]).strip():
            job.setdefault("log", []).append(f"{k.replace('_', ' ')} '{new[k]}' from the page ignored - this case is {old.get('patient_first', '')} {old.get('patient_last', '')}".strip())
            new.pop(k)
        elif k in new and str(old.get(k) or "").strip():
            new.pop(k)
    volatile = {"adjust", "adjust_by_arch", "mark_by_arch", "tracker_case"}
    def changed(a, b):
        return json.dumps(a, sort_keys=True, default=str) != json.dumps(b, sort_keys=True, default=str)
    shared_changed = any(changed(old.get(k), v) for k, v in new.items() if k not in ("wt", "tt", "p1") and k not in volatile)
    per_type = {t: changed(old.get(t), new.get(t)) for t in ("wt", "tt", "p1") if t in new}
    # the placement on the base is kept per arch: moving the lower touches the lower's models only, and
    # a turn / shift (same height) moves the finished body instead of re-making it
    old_by = _adjust_by_arch(old, job["scans"])
    new_by = _adjust_by_arch(new, job["scans"]) if ("adjust_by_arch" in new or "adjust" in new) else old_by
    zero = dict(ADJUST_ZERO)
    adj_arches = {a for a in set(old_by) | set(new_by) if old_by.get(a, zero) != new_by.get(a, zero)}
    fast_arches = {a for a in adj_arches if abs(old_by.get(a, zero)["dz"] - new_by.get(a, zero)["dz"]) < 1e-9}
    # the mark on the model is kept per arch too: moving it alone re-finishes that arch's models from the
    # body kept before the mark (seconds), unless a model has no such body yet (made before this)
    old_mk = _mark_by_arch(old)
    new_mk = {a: _mark_to_raw(job, a, v) for a, v in (new.get("mark_by_arch") or {}).items() if a in ("upper", "lower")} if "mark_by_arch" in new else old_mk
    mark_arches = {a for a in set(old_mk) | set(new_mk) if old_mk.get(a) != new_mk.get(a)}
    for a in mark_arches:
        # back to the automatic spot needs the teeth (a full run); a placed spot only needs the plain body
        if a not in adj_arches and new_mk.get(a) is not None and all(os.path.exists(os.path.join(job["dir"], f"{sc['name']}_body_plain.stl")) for sc in job["scans"] if sc.get("arch") == a and sc.get("report")):
            fast_arches.add(a)
    adj_arches = adj_arches | mark_arches
    new.pop("adjust", None); new.pop("adjust_by_arch", None); new.pop("mark_by_arch", None)
    job["params"].update(new)
    job["params"]["adjust_by_arch"] = new_by; job["params"].pop("adjust", None)
    job["params"]["mark_by_arch"] = new_mk
    me = job.get("mask_edit")
    # a scan cleaned of braces without being asked for (an earlier version assumed them) goes back to the
    # scan as scanned on this re-run - everything is re-made from it
    undo = any(not sc.get("braces_on") and not job["params"].get("remove_appliances") and _raw_scan_for(sc) not in (None, sc["path"]) for sc in job["scans"])
    fast = set()
    if shared_changed or undo or not job.get("reports") or job.get("status") == "error":
        only = None                                   # everything (a case whose last run failed is made again whole)
    else:
        only = set()
        # a brush edit is on a scan file: the models made from it are re-made, an arch not painted on is left alone
        painted_paths = {job["scans"][int(e.get("scan", 0) or 0)]["path"] for e in (me or []) if 0 <= int(e.get("scan", 0) or 0) < len(job["scans"])}
        for k, sc in enumerate(job["scans"]):
            typed = per_type.get({"WT": "wt", "TT": "tt", "P1": "p1"}.get(sc.get("tag"), ""), False)
            moved = sc.get("arch") in adj_arches
            brushed = sc["path"] in painted_paths
            if typed or moved or brushed or not sc.get("report"):
                only.add(k)
            if moved and not typed and not brushed and sc.get("report") and sc.get("arch") in fast_arches:
                fast.add(k)
        if not only:
            only = None if not job.get("reports") else set()   # nothing changed: nothing to do
    if only is not None and not only:
        return {"id": jid, "nothing": True}          # (before anything is set: a case waiting in line keeps its own run)
    job["auto_order"] = False
    job["rerun_all"] = only is None
    job["rerun_only"] = sorted(only) if only else None
    job["rerun_fast"] = sorted(fast) if fast else None
    job["thinned"] = False
    if only:
        label = lambda k: f"{job['scans'][k].get('arch') or ''} {job['scans'][k].get('tag') or ''}".strip()
        remade = sorted(only - fast)
        if fast:
            job.setdefault("log", []).append(("moving the mark (model kept): " if not (adj_arches - mark_arches) else "moving on the base (model kept): ") + ", ".join(label(k) for k in sorted(fast)))
        if remade:
            job.setdefault("log", []).append("re-making only the models the changed settings touch: " + ", ".join(label(k) for k in remade))
    _enqueue(job)
    return {"id": jid, "models": None if only is None else len(only), "moved": len(fast)}


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
            busy = any(j.get("status") in ("queued", "running") for j in list(JOBS.values()))
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
            elif h.get("status") in ("queued", "running") and int(h.get("restarts") or 0) < 2:
                # a case the app was making, or had in line, when it stopped (an update, a restart of the PC): it used
                # to drop off the list until someone found it in Past cases - it is made now. Twice at most: a case
                # that stops the app every time it is made must not keep stopping it
                job["restarts"] = int(h.get("restarts") or 0) + 1
                job["log"] = ["the app was restarted before this case was finished - making it now"]
                job.pop("reopened", None); job["rerun_all"] = True; job["auto_order"] = False
                JOBS[jid] = job
                _enqueue(job)
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
    busy = any(j.get("status") in ("queued", "running") for j in list(JOBS.values()))
    if busy:
        raise HTTPException(409, "a case is being processed - try again when the list is quiet")
    started = _start_learning(force=True)
    return dict(started=started, status=_learn_status())


@app.get("/api/jobs")
def list_jobs():
    """The live list: cases still waiting for a decision (processing, or done and not yet sent / discarded).
    A sent or discarded case leaves it at once and lives on in Past cases; it stays open in memory, so the
    viewer showing it keeps working (Send again, Open in PreForm, add the opposing arch)."""
    return [{k: v for k, v in j.items() if k in ("id", "name", "status", "created", "filename", "preset", "review", "source")}
            | dict(ahead=_ahead(j), arches=sorted({sc.get("arch") for sc in j["scans"] if sc.get("arch")}), models=len(j["scans"]),
                   progress=(j.get("progress") if j.get("status") == "running" else None), tracker_case=(j.get("params") or {}).get("tracker_case") or "")
            for j in sorted(list(JOBS.values()), key=lambda j: -j["created"])
            if j.get("review") not in ("sent", "discarded") or j.get("status") in ("queued", "running")]


def _fixed_arches(job):
    """Arches of this case that carry an applied brush fix (the only ones that can be a lesson)."""
    fixed = job.get("fixed_labels") or {}
    return sorted({sc.get("arch") or "scan" for sc in job["scans"] if sc["path"] in fixed})


def _review_view(job):
    return {k: job.get(k) for k in ("id", "name", "status", "review", "order_folder", "order_error", "order_note", "order_pieces", "learned", "sent_at", "reopened", "preform", "print_folder", "print_files", "print_error")} | {"scans": [dict(arch=sc.get("arch"), tag=sc.get("tag")) for sc in job["scans"]], "fixed": _fixed_arches(job), "print_files_unc": _print_files_unc(job)}


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
    # the folder is per patient and visit; a DIFFERENT scan of the same arch must never overwrite the one
    # already there (a case filed under the wrong name did exactly that once) - it gets a folder of its own
    import hashlib
    def digest(fp):
        h = hashlib.md5()
        with open(fp, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    clash = False
    for path in dict.fromkeys(sc["path"] for sc in job["scans"]):
        sc = next(sc for sc in job["scans"] if sc["path"] == path)
        arch = sc.get("arch") or "scan"
        for ext in (".stl", ".ply"):
            there = os.path.join(d, f"scan_{arch}{ext}")
            if os.path.exists(there) and (os.path.getsize(there) != os.path.getsize(path) or digest(there) != digest(path)):
                clash = True
    if clash:
        k = 2
        while os.path.exists(f"{d} ({k})"):
            k += 1
        log(f"training: {os.path.basename(d)} already holds a different scan - this case goes to '{os.path.basename(d)} ({k})'")
        d = f"{d} ({k})"; os.makedirs(d, exist_ok=True)
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
    # the braces strokes (Take off / Not a bracket on a retainer, the band's on a mouthguard - the doctor, 10/19/2026) are
    # the bracket detector's lesson: the scan as scanned and what was painted on it, in the scanner's own coordinates
    braces_saved = []
    for raw_p, be in (job.get("braces_edits") or {}).items():
        if not (be.get("not") or be.get("add")) or not os.path.exists(raw_p):
            continue
        sc = next((s for s in job["scans"] if (_raw_scan_for(s) or s["path"]) == raw_p), None) or {}
        arch = sc.get("arch") or "scan"
        try:
            ext = os.path.splitext(raw_p)[1].lower()
            shutil.copyfile(raw_p, os.path.join(d, f"braces_{arch}{ext}"))
            json.dump(dict(scan=f"braces_{arch}{ext}", source=sc.get("filename"), sent=meta["sent"], not_a_bracket=be.get("not") or [],
                           not_a_bracket_normals=be.get("not_n") or [], take_off=be.get("add") or []),
                      open(os.path.join(d, f"braces_{arch}.json"), "w"))
            braces_saved.append(arch)
        except Exception as ex:  # noqa
            log(f"the braces strokes were not saved for training ({ex})")
    for sc in job["scans"]:
        pe = (job.get("paint") or {}).get(sc["path"]) or {}
        if sc.get("preset") != "mouthguard" or not (pe.get("noshield") or pe.get("shield")):
            continue
        arch = sc.get("arch") or "scan"
        try:
            ext = os.path.splitext(sc["path"])[1].lower()
            if not os.path.exists(os.path.join(d, f"braces_{arch}{ext}")):
                shutil.copyfile(sc["path"], os.path.join(d, f"braces_{arch}{ext}"))
            jp = os.path.join(d, f"braces_{arch}.json")
            rec = json.load(open(jp)) if os.path.exists(jp) else dict(scan=f"braces_{arch}{ext}", source=sc.get("filename"), sent=meta["sent"])
            rec["band_not_a_bracket"] = _scan_xyz(sc["path"], pe.get("noshield") or []).round(4).tolist()
            rec["band_painted"] = _scan_xyz(sc["path"], pe.get("shield") or []).round(4).tolist()
            json.dump(rec, open(jp, "w"))
            braces_saved.append(f"{arch} band")
        except Exception as ex:  # noqa
            log(f"the band strokes were not saved for training ({ex})")
    if braces_saved:
        log(f"saved for training (bracket detector): {os.path.relpath(d, ROOT)} ({', '.join(braces_saved)})")
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


IDENTITY_KEYS = ("patient_first", "patient_last", "patient_id", "doctor", "order_root")


def _name_from_form(job, first, last):
    """A case that lost (or never had) its patient name takes the one typed in the New case card when
    Send / Save as lesson is clicked - the typed name never replaces one the case already has."""
    p = job["params"]
    if first and last and not (p.get("patient_first") and p.get("patient_last")):
        p["patient_first"], p["patient_last"] = first.strip(), last.strip()
        if not job.get("name") or job["name"].lower().startswith(("scan", "upload")):
            job["name"] = f"{p['patient_first']}_{p['patient_last']}"
        job.setdefault("log", []).append(f"patient name set from the page: {p['patient_first']} {p['patient_last']}")


@app.post("/api/jobs/{jid}/approve")
def approve(jid: str, request: Request, patient_first: str = Form(""), patient_last: str = Form(""), scans: str = Form("")):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    job.setdefault("log", [])
    _name_from_form(job, patient_first, patient_last)
    only = _pick_scans(job, scans)
    if not only:
        raise HTTPException(400, "tick at least one piece to send")
    if len(only) < len(job["scans"]):
        job["log"].append(f"sending {len(only)} of {len(job['scans'])} pieces: " + ", ".join(f"{job['scans'][k].get('arch')} {_scan_tag(job['scans'][k])}" for k in only))
    _rebase(job, log=lambda m: job["log"].append(m))
    _write_order(job, log=lambda m: job["log"].append(m), preform_here=_is_local(request), only=only if len(only) < len(job["scans"]) else None)
    if _save_training(job, log=lambda m: job["log"].append(m)):
        job["learned"] = _learned_note(job)
    if job.get("review") == "sent":
        job["sent_at"] = time.time()
        _tell_tracker(job)
    _save_case(job)
    return _review_view(job)


def _tracker_item_fits(case_id, first, last):
    """The NLO Cases queue case `case_id` is this patient's: the same name (letters only, any case), or one a slip of the
    keyboard away with the same last name. True when the queue cannot be read (the pick stands, as before)."""
    import difflib
    try:
        items = TRACKER.queue()
    except Exception:
        return True
    it = next((x for x in items if x.get("case") == case_id), None)
    if it is None:
        return not items
    norm = lambda t: re.sub(r"[^a-z]", "", (t or "").lower())
    words = (it.get("patient") or "").split()
    me, nm = norm(f"{first}{last}"), norm("".join(words))
    if not me:
        return True
    return nm == me or (bool(words) and norm(words[-1]) == norm(last) and difflib.SequenceMatcher(None, nm, me).ratio() >= 0.85)


def _match_tracker(job):
    """A case made here without clicking it in the NLO Cases queue (the scan was dropped straight on the page): the
    queue's case for the same patient - the same name, or one a slip of the keyboard away (Jonh / John) when
    the last name, the arch and what is made agree too - and, when the patient has more than one waiting, the one
    for what is made here. None unless exactly one fits (a sibling's case is never taken by a near name: a near
    name must be the only case close to it)."""
    import difflib
    p = job.get("params") or {}
    first, last = (p.get("patient_first") or "").strip(), (p.get("patient_last") or "").strip()
    if not (first and last) or not TRACKER.state().get("linked"):
        return None
    norm = lambda t: re.sub(r"[^a-z]", "", (t or "").lower())
    me, my_last = norm(first + last), norm(last)
    tags = {sc.get("tag") for sc in job.get("scans") or []}
    arches = {sc.get("arch") for sc in job.get("scans") or [] if sc.get("arch")}
    exact, near = [], []
    my_first = norm(first)
    for it in TRACKER.queue():
        here = (it.get("here") or {}).get("job")
        if here and here != job.get("id"):
            continue                    # already being made in another case here
        words = (it.get("patient") or "").split()
        nm = norm("".join(words))
        if not nm:
            continue
        if nm == me:
            exact.append(it)
            continue
        # a slip of the keyboard, never a sibling: a short first name (Mia / Max, Ava / Eva, Liam / Lia) must match
        # exactly; a longer one may differ by a letter or two (Gabrielle / Gabriele reads 0.94)
        their_first = norm("".join(words[:-1]))
        first_ok = (their_first == my_first) or (min(len(their_first), len(my_first)) >= 5 and difflib.SequenceMatcher(None, their_first, my_first).ratio() >= 0.85)
        if words and norm(words[-1]) == my_last and first_ok and difflib.SequenceMatcher(None, nm, me).ratio() >= 0.85 \
                and set(it.get("make") or []) & tags and (not it.get("arches") or not arches or set(it["arches"]) & arches):
            near.append(it)
    cands = exact or near
    if len(cands) > 1:
        fit = [it for it in cands if set(it.get("make") or []) & tags]
        cands = fit if fit else cands
    return cands[0] if len(cands) == 1 else None


def _link_tracker(job, log=None):
    """Tie the case to its NLO Cases case by name when it was not picked from the queue (see _match_tracker)."""
    p = job.setdefault("params", {})
    if p.get("tracker_case"):
        return p["tracker_case"]
    try:
        it = _match_tracker(job)
    except Exception as ex:  # noqa
        it = None
        if log:
            log(f"NLO Cases queue not searched: {ex}")
    if not it:
        return ""
    p["tracker_case"] = it["case"]
    if log:
        log(f"NLO Cases: tied to the case waiting under To make for {it.get('patient') or 'this patient'} ({', '.join(it.get('make') or [])}) - matched by name")
    return it["case"]


def _tell_tracker(job, how="orthofactory"):
    """The case is in NLO Cases (picked from the queue, or matched by name): a sealed note to its inbox that the models
    are in OrthoFactory (`how` "orthofactory": Send) or on their way to the printer ("printer": PreForm) - the case notes
    them and moves on from To make to Printing (the doctor, 10/19/2026). Once per case and kind. Never fails the Send."""
    if not TRACKER.state().get("linked"):
        return
    job.setdefault("log", [])
    cid = _link_tracker(job, log=lambda m: job["log"].append(m))
    if not cid:
        return
    told = job.setdefault("tracker_told_how", [])
    if how in told:
        return
    try:
        models = [" ".join(x for x in (sc.get("arch"), sc.get("tag")) if x) for sc in job["scans"]]
        TRACKER.sent_models(cid, f"{job['params'].get('patient_first', '')} {job['params'].get('patient_last', '')}".strip(), models, how=how)
        job["log"].append(f"NLO Cases told: models for case {cid} " + ("are in OrthoFactory" if how == "orthofactory" else "went to the printer")
                          + f" ({', '.join(models)}) - it moves to Printing")
        job["tracker_told"] = time.time()
        told.append(how)
    except Exception as ex:  # noqa
        job["log"].append(f"NLO Cases not told (the case tracker link): {ex}")


@app.post("/api/jobs/{jid}/preform")
def open_preform(jid: str):
    """Open the case's finished models in PreForm on the PC that runs the app."""
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    job.setdefault("log", [])
    ok, msg = _open_in_preform(job, log=lambda m: job["log"].append(m))
    job["preform"] = dict(ok=ok, message=msg, when=time.time())
    if ok:
        _tell_tracker(job, how="printer")      # on its way to the printer: NLO Cases moves it to Printing
        _save_case(job)
    return {"ok": ok, "message": msg}


@app.post("/api/jobs/{jid}/prints")
def file_prints(jid: str, scans: str = Form("")):
    """File the case's models in the print folder (no PreForm here) and return their paths as the
    other PCs see them - the page then opens them in PreForm on its own PC. `scans`: the pieces ticked in the
    Export dialog (all when empty)."""
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    job.setdefault("log", [])
    only = _pick_scans(job, scans)
    _rebase(job, log=lambda m: job["log"].append(m))
    files = _write_prints(job, log=lambda m: job["log"].append(m), only=only if len(only) < len(job["scans"]) else None)      # always fresh copies (a fix since the last copy)
    if not files:
        raise HTTPException(400, job.get("print_error") or "no finished model to file")
    _tell_tracker(job, how="printer")          # opened in PreForm on another PC: on its way to the printer
    _save_case(job)
    return {"files": _print_files_unc(job), "folder": _to_unc(job.get("print_folder") or "")}


# ---------- NLO Cases (the case tracker): the queue of cases waiting for models ----------
@app.get("/api/tracker")
def tracker_state():
    return TRACKER.state()


@app.post("/api/tracker/link")
def tracker_link(code: str = Form("")):
    try:
        return TRACKER.link(code)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    except Exception as ex:  # noqa
        raise HTTPException(400, f"could not link: {ex}")


@app.post("/api/tracker/unlink")
def tracker_unlink():
    TRACKER.unlink()
    return TRACKER.state()


@app.post("/api/tracker/refresh")
def tracker_refresh():
    TRACKER.refresh()
    return TRACKER.state()


@app.get("/api/queue")
def tracker_queue():
    """The cases waiting for models, with what this PC has done about each: the live job started from it
    (status / review) when there is one."""
    here = {}
    for j in list(JOBS.values()):
        cid = (j.get("params") or {}).get("tracker_case")
        if cid and (cid not in here or j["created"] > here[cid]["created"]):
            here[cid] = dict(job=j["id"], status=j.get("status"), review=j.get("review"), created=j["created"])
    out = []
    for it in TRACKER.queue():
        h = here.get(it["case"])
        it["here"] = {k: v for k, v in h.items() if k != "created"} if h else None
        out.append(it)
    return dict(state=TRACKER.state(), items=out)


@app.get("/api/whoami")
def whoami(request: Request):
    """Is the page on the PC that runs the app? (decides where PreForm opens)"""
    return {"local": _is_local(request), "pc": os.environ.get("COMPUTERNAME") or "", "print_root_unc": _to_unc(_print_root())}


@app.post("/api/jobs/{jid}/resend")
def resend(jid: str, request: Request, scans: str = Form("")):
    """Write the OrthoFactory order again from the models as they are (a lost print, a second set). `scans`: the
    pieces ticked in the Send dialog (all when empty)."""
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    only = _pick_scans(job, scans)
    if not only:
        raise HTTPException(400, "tick at least one piece to send")
    job.setdefault("log", []).append("sent again" + (f" ({len(only)} of {len(job['scans'])} pieces)" if len(only) < len(job["scans"]) else ""))
    _rebase(job, log=lambda m: job["log"].append(m))
    _write_order(job, log=lambda m: job["log"].append(m), preform_here=_is_local(request), only=only if len(only) < len(job["scans"]) else None)
    if job.get("review") == "sent":
        job["sent_at"] = time.time()
        _tell_tracker(job)
    _save_case(job)
    return _review_view(job)


def _rebase(job, log=print):
    """Models finished with a Trimlign base that has been replaced since (the app's start-up check rebuilt it) are
    finished again with the current one before they go to OrthoFactory and the print folder: the body is kept, only
    the base plate, its engraving and the files are made again (replace_placement, a few seconds a model)."""
    cur = basebuild.base_sig(ROOT)
    if not cur:
        return
    for sc in job["scans"]:
        rep = sc.get("report") or {}
        if rep.get("base") not in ("union", "concat") or rep.get("base_sig") == cur:
            continue
        if not os.path.exists(os.path.join(job["dir"], f"{sc['name']}_body_only.stl")):
            continue
        try:
            t0 = time.time()
            params = _scan_params(job, sc)
            quiet = lambda m: None if ("moved on the base" in m or " moved in " in m) else log(m)
            sc["report"] = replace_placement(job["dir"], sc["name"], params, rep, rep.get("adjust") or params.get("adjust"), log=quiet)
            log(f"[{sc['name']}] made before the Trimlign base was corrected (its locating holes were not deep enough) - base made again ({time.time() - t0:.0f} s)")
        except Exception as ex:  # noqa
            log(f"[{sc['name']}] the base could not be made again ({ex}) - re-run the case before printing")
    reports = [sc["report"] for sc in job["scans"] if sc.get("report")]
    if reports:
        job["report"] = reports[0]; job["reports"] = reports


def _learned_note(job):
    fixed = job.get("fixed_labels") or {}
    arches = [sc.get("arch") or "scan" for sc in job["scans"] if sc["path"] in fixed]
    return dict(at=time.time(), corrected=sorted(set(arches)))


@app.post("/api/jobs/{jid}/uncut")
def uncut(jid: str, scan: int = Form(0)):
    """Clean-up's "Bring back what was cut" (the doctor, 10/19/2026: a cut made by mistake could not be taken back): the
    scan goes back to the file it was before the first cut, every model made from it is re-made, and what was painted
    on the cut file (reservoir, block-out, contact dots, tooth labels) goes with it by position."""
    from bleachtray.mesh_utils import load_scan
    from scipy.spatial import cKDTree
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    if job.get("status") in ("queued", "running"):
        raise HTTPException(409, "the case is being made - try again when it is done")
    if not (0 <= scan < len(job["scans"])):
        raise HTTPException(400, "no such model")
    cur = job["scans"][scan]["path"]; before = job["scans"][scan].get("precut_path")
    if not before or not os.path.exists(before):
        raise HTTPException(400, "nothing was cut away on this scan")
    Vc = np.asarray(load_scan(cur).vertices); Vb = np.asarray(load_scan(before).vertices)
    d, j = cKDTree(Vb).query(Vc)
    c2b = np.where(d < 1e-3, j, -1).astype(np.int64)
    paint = job.setdefault("paint", {})
    pe = paint.pop(cur, None)
    if pe:
        paint[before] = _remap_entry(pe, c2b)
    fixed = job.setdefault("fixed_labels", {})
    if cur in fixed:
        lab = np.asarray(fixed.pop(cur)); nl = np.zeros(len(Vb), dtype=lab.dtype); ok = c2b >= 0
        nl[c2b[ok]] = lab[ok]; fixed[before] = nl
    idx = []
    for k, sc in enumerate(job["scans"]):
        if sc["path"] == cur:
            sc["path"] = before; sc.pop("precut_path", None); idx.append(k)
    for key in [key for key in job.get("feat_cache", {}) if (key if isinstance(key, str) else key[0]) in (cur, before)]:
        job["feat_cache"].pop(key, None)
    job.setdefault("log", []).append(f"brought back what was cut away: the scan is {os.path.basename(before)} again ({len(Vb)} vertices, {len(Vb) - len(Vc)} more) - re-making " + ", ".join(f"{job['scans'][k].get('arch') or ''} {job['scans'][k].get('tag') or ''}".strip() for k in idx))
    job["auto_order"] = False; job["rerun_all"] = False; job["rerun_only"] = idx; job["rerun_fast"] = None; job["mask_edit"] = None
    _enqueue(job)
    return {"id": jid, "models": len(idx)}


@app.post("/api/jobs/{jid}/learn")
def learn_from(jid: str, patient_first: str = Form(""), patient_last: str = Form("")):
    """'Looks good' without an order: file the case (scan + labels as they stand) for the night-time
    retraining. Same thing Send does on the side, minus OrthoFactory."""
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    job.setdefault("log", [])
    _name_from_form(job, patient_first, patient_last)
    if not _save_training(job, log=lambda m: job["log"].append(m)):
        raise HTTPException(400, "nothing to save - the case has no patient name: type the first and last name in the New case card and click Save as lesson again")
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
    for h in sorted(list(HISTORY.values()), key=lambda h: -(h.get("created") or 0)):
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
    out = {k: v for k, v in job.items() if k in ("id", "name", "status", "log", "error", "preset", "params", "order_folder", "order_error", "order_note", "order_pieces", "review", "source", "progress", "learned", "sent_at", "reopened", "created", "preform", "print_folder", "print_files", "print_error")}
    out["started"] = job.get("started")
    out["ahead"] = _ahead(job)
    out["fixed"] = _fixed_arches(job)
    out["print_files_unc"] = _print_files_unc(job)
    paint = job.get("paint") or {}
    out["scans"] = [dict(name=sc["name"], filename=sc["filename"], arch=sc.get("arch"), tag=sc.get("tag"), preset=sc.get("preset"),
                         braces=({k: v for k, v in sc["braces"].items() if k != "passes"} if sc.get("braces") else None), braces_on=bool(sc.get("braces_on")),
                         cut=bool(sc.get("precut_path")),
                         painted={k: len(v) for k, v in (paint.get(sc["path"]) or {}).items()}) for sc in job["scans"]]
    if job.get("reports"):
        out["reports"] = [{k: r[k] for k in r if k not in ("transform_raw_to_output",)} for r in job["reports"]]
        out["report"] = out["reports"][0]
    return out


@app.get("/api/jobs/{jid}/pieces")
def job_pieces(jid: str):
    """What the case holds, piece by piece, for the Export and Send dialogs: arch, type, whether its model is made,
    the file name it gets in the print folder, the OrthoFactory piece name it had last, and its warnings."""
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404)
    from bleachtray.printfolder import model_filename
    first, last = job["params"].get("patient_first") or "", job["params"].get("patient_last") or ""
    words = {"WT": "Whitening tray", "TT": "Retainer", "MG": "Mouthguard", "P1": "Phase I retainer"}
    out = []
    sent_pieces = job.get("order_pieces") or []
    sent_scans = job.get("sent_scans")
    for k, sc in enumerate(job["scans"]):
        rep_ = sc.get("report") or {}
        m = (rep_.get("outputs") or {}).get("model")
        tag = _scan_tag(sc)
        code = None
        if sent_scans is not None and k in sent_scans and len(sent_pieces) == len(sent_scans):
            code = sent_pieces[sent_scans.index(k)]
        elif sent_scans is None and k < len(sent_pieces):
            code = sent_pieces[k]
        out.append(dict(scan=k, arch=sc.get("arch"), tag=tag, label=f"{(sc.get('arch') or 'arch').capitalize()} · {words.get(tag, tag)} ({tag})",
                        made=bool(m and os.path.isfile(m)), file=model_filename(first, last, sc.get("arch"), tag) if first and last else None,
                        piece=code, warnings=len(rep_.get("warnings") or []), watertight=rep_.get("body_watertight")))
    return {"pieces": out, "print_folder": _to_unc(job.get("print_folder") or "") or _to_unc(os.path.join(_print_root(), f"{last}, {first}")) if first and last else "",
            "patient": f"{first} {last}".strip(), "review": job.get("review")}


@app.get("/api/jobs/{jid}/export")
def job_export(jid: str, scans: str = ""):
    """The chosen pieces' print files in one zip, named as the print folder names them (the Export dialog's Download)."""
    import zipfile
    job = JOBS.get(jid)
    if not job or job.get("status") != "done":
        raise HTTPException(404)
    from bleachtray.printfolder import model_filename
    first, last = job["params"].get("patient_first") or "Patient", job["params"].get("patient_last") or job.get("name") or "Case"
    only = _pick_scans(job, scans)
    buf = io.BytesIO()
    n = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for k in only:
            sc = job["scans"][k]
            m = ((sc.get("report") or {}).get("outputs") or {}).get("model")
            if not (m and os.path.isfile(m)):
                continue
            z.write(m, model_filename(first, last, sc.get("arch"), _scan_tag(sc)))
            n += 1
    if not n:
        raise HTTPException(400, "no finished model among the ticked pieces")
    job.setdefault("log", []).append(f"exported {n} print file{'s' if n != 1 else ''} as a zip")
    fn = f"{re.sub(r'[^A-Za-z0-9_-]', '', last)}_{re.sub(r'[^A-Za-z0-9_-]', '', first)}_models.zip"
    return Response(content=buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{fn}"', "Cache-Control": "no-store"})


@app.get("/api/jobs/{jid}/file/{kind}")
def job_file(jid: str, kind: str, scan: int = 0):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done" or not (0 <= scan < len(job["scans"])):
        raise HTTPException(404)
    name = job["scans"][scan]["name"]
    files = {
        "model": (f"{name}_model.stl", "model/stl"),
        "trimline": (f"{name}_trimline.pts", "text/plain"),
        "scan_res": (f"{name}_scan_with_reservoirs_NOBASE_not_for_trimlign.stl", "model/stl"),   # (the page's "Scan + reservoirs" button: the old name was never written)
        "body": (f"{name}_body_only.stl", "model/stl"),
        "blockout": (f"{name}_blockout.stl", "model/stl"),
        "mark": (f"{name}_mark.stl", "model/stl"),
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
    # rewritten at the same URL on every re-run: the browser must not keep a copy (without this, Chrome's
    # heuristic freshness served the previous body for a while after a move on the base)
    return FileResponse(path, media_type=mt, filename=fn, headers={"Cache-Control": "no-store"})


def _braces_mask_path(job, raw_path):
    return os.path.join(job["dir"], "bracesmask_" + os.path.basename(raw_path) + ".npy")


@app.get("/api/jobs/{jid}/rawmesh")
def raw_mesh(jid: str, scan: int = 0):
    """The scan as scanned, for the Braces step's overlay (the doctor, 10/22/2026: "the original model should be
    available and braces removal should be an overlay ... if I see something incorrect I don't have a chance to go back
    and correct it"): the same layout as /segmesh - uint32 nV, uint32 nF, float32 V[nV*3], uint32 F[nF*3],
    uint16 labels[nV] (all 0), float32 disp[nV] (all 0), uint8 paint[nV][, uint8 rgb[nV*3]] - on the rough-oriented
    scan file behind the case's cleaned one, with bit 4 = what the take-off takes (found, plus what was painted Take off)
    and bit 128 = painted Not a bracket. Brush strokes on it are vertex numbers of that file."""
    job = JOBS.get(jid)
    if not job or job.get("status") != "done" or not (0 <= scan < len(job["scans"])):
        raise HTTPException(404)
    from bleachtray.mesh_utils import load_scan
    from bleachtray.orient import rough_orient
    from bleachtray.appliance import near_points
    sc = job["scans"][scan]
    raw_p = _raw_scan_for(sc) or sc["path"]
    raw = load_scan(raw_p)
    mesh, _ = rough_orient(raw)
    V = np.asarray(mesh.vertices, dtype=np.float32); F = np.asarray(mesh.faces, dtype=np.uint32)
    buf = io.BytesIO()
    buf.write(struct.pack("<II", len(V), len(F)))
    buf.write(V.tobytes()); buf.write(F.tobytes())
    buf.write(np.zeros(len(V), dtype=np.uint16).tobytes()); buf.write(np.zeros(len(V), dtype=np.float32).tobytes())
    flags = np.zeros(len(V), dtype=np.uint8)
    mp = _braces_mask_path(job, raw_p)
    if not os.path.exists(mp) and raw.metadata.get("rgb") is not None and raw_p != sc["path"]:
        # a case cleaned before the overlay existed: find the braces on the scan as scanned once, for the overlay
        try:
            from bleachtray.mesh_utils import adjacency
            from bleachtray.features import compute_features
            from bleachtray.appliance import detect_appliances
            A = adjacency(mesh); feats = compute_features(mesh, return_aux=True)
            m0, _ = detect_appliances(mesh, A, mesh.metadata["rgb"], feats=feats)
            np.save(mp, np.where(m0)[0].astype(np.int64))
        except Exception:
            pass
    if os.path.exists(mp):
        try:
            idx = np.load(mp).astype(int); idx = idx[(idx >= 0) & (idx < len(V))]; flags[idx] |= 4
        except Exception:
            pass
    be = (job.get("braces_edits") or {}).get(raw_p) or {}
    Vs = np.asarray(raw.vertices); Ns = np.asarray(raw.vertex_normals)
    try:
        if be.get("add"):
            flags[near_points(Vs, be["add"], vnormals=Ns)] |= 4
        if be.get("not"):
            nb = near_points(Vs, be["not"], normals=be.get("not_n"), vnormals=Ns)
            flags[nb] |= 128; flags[nb] &= ~np.uint8(4)
    except Exception:
        pass
    buf.write(flags.tobytes())
    rgb = raw.metadata.get("rgb")
    if rgb is not None and len(rgb) == len(V):
        buf.write(np.asarray(rgb, dtype=np.uint8).tobytes())
    return Response(content=buf.getvalue(), media_type="application/octet-stream")


@app.get("/api/jobs/{jid}/segmesh")
def seg_mesh(jid: str, scan: int = 0):
    """Binary blob of the rough-oriented scan with labels + displacement, for the brush view.
    Layout: uint32 nV, uint32 nF, float32 V[nV*3], uint32 F[nF*3], uint16 labels[nV], float32 disp[nV], uint8 paint[nV][, uint8 rgb[nV*3]]"""
    job = JOBS.get(jid)
    if not job or job.get("status") != "done" or not (0 <= scan < len(job["scans"])):
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
    # painted areas kept for this scan file: bit 1 = no reservoir, bit 2 = block out; bit 4 = brackets / wire removed; bit 8 = bracket shield; bit 16 = reservoir added
    pe = (job.get("paint") or {}).get(sc["path"]) or {}
    flags = np.zeros(len(V), dtype=np.uint8)
    # bit 64 = rebuilt over a large area (most of a tooth, or two teeth: the enamel there is a guess)
    # bit 128 = painted "Not a bracket" (a mouthguard's band leaves it out; a take-off leaves it as scanned)
    for bit, key in ((1, "noreservoir"), (2, "blockout"), (4, "removed"), (16, "reservoir"), (32, "contact"), (64, "large"), (128, "noshield")):
        idx = np.asarray(pe.get(key) or [], dtype=int); idx = idx[(idx >= 0) & (idx < len(V))]
        flags[idx] |= bit
    be = (job.get("braces_edits") or {}).get(_raw_scan_for(sc) or sc["path"]) or {}
    if be.get("not"):
        try:
            from bleachtray.appliance import near_points
            flags[near_points(np.asarray(raw.vertices), be["not"], normals=be.get("not_n"), vnormals=raw.vertex_normals)] |= 128
        except Exception:
            pass
    # bit 8 = under the mouthguard's bracket shield (found + painted)
    if "shield" in st.files and len(st["shield"]) == len(V):
        flags[np.asarray(st["shield"], bool)] |= 8
    buf.write(flags.tobytes())
    # the scanner's colour per vertex, when the scan has one (a PLY): uint8 rgb[nV*3]
    rgb = st["rgb"] if "rgb" in st.files else None
    if rgb is not None and len(rgb) == len(V):
        buf.write(np.asarray(rgb, dtype=np.uint8).tobytes())
    return Response(content=buf.getvalue(), media_type="application/octet-stream")


@app.get("/api/jobs/{jid}/p1dots")
def p1_dots(jid: str, scan: int = 0):
    """The Phase I tab's dots kept for a scan (vertex numbers of the scan file): the cutout spans' ends and where the
    retainer ends."""
    job = JOBS.get(jid)
    if not job or not (0 <= scan < len(job["scans"])):
        raise HTTPException(404)
    pe = (job.get("paint") or {}).get(job["scans"][scan]["path"]) or {}
    return {"span": [int(i) for i in pe.get("p1span") or []], "end": [int(i) for i in pe.get("p1end") or []], "six": [int(i) for i in pe.get("p1six") or []],
            "path": [[int(i) for i in r] for r in (pe.get("p1path") or []) if isinstance(r, (list, tuple))],
            "nosplit": [int(i) for i in pe.get("nosplit") or []]}


@app.get("/api/jobs/{jid}/teeth")
def teeth_of(jid: str, scan: int = 0):
    """The Teeth tab: every tooth label's number as the case has it (side, position - from the report) and the numbers
    the doctor gave by hand ({label: [position, primary]})."""
    job = JOBS.get(jid)
    if not job or not (0 <= scan < len(job["scans"])):
        raise HTTPException(404)
    sc = job["scans"][scan]
    pe = (job.get("paint") or {}).get(sc["path"]) or {}
    rep_ = sc.get("report") or {}
    return {"teeth": rep_.get("teeth") or {}, "ids": pe.get("tooth_ids") or {}, "arch": sc.get("arch")}


@app.get("/api/jobs/{jid}/trimline.json")
def trimline_json(jid: str, scan: int = 0):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done" or not (0 <= scan < len(job["scans"])):
        raise HTTPException(404)
    st = np.load(os.path.join(job["dir"], f"{job['scans'][scan]['name']}_state.npz"))
    pts = np.round(st["margin"], 3)
    # with the body's surface normal per point when the model has them: [x, y, z, nx, ny, nz] - the page
    # lifts the drawn line a hair along it, so it lies on the surface from every angle
    if "margin_n" in st.files and len(st["margin_n"]) == len(pts):
        pts = np.column_stack([pts, np.round(st["margin_n"], 3)])
    return JSONResponse(pts.tolist())
