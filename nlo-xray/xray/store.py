"""Where the x-rays and tracings live: one folder per x-ray under cases/ in the app folder, on this PC.

    cases/<id>/case.json      patient, date, calibration, landmarks, status, CVM call, history
    cases/<id>/original.<ext> the file as it was dropped (DICOM, JPG, ...)
    cases/<id>/image.png      the greyscale image the app shows and learns from
    cases/<id>/thumb.jpg      small picture for the case list

Deleting moves the folder to cases/_deleted/ (nothing is erased by the app).
"""
import datetime as dt
import hashlib
import json
import os
import secrets
import shutil
import threading

from . import imageio
from .landmarks import CODES

STATUSES = ("new", "traced", "confirmed")


def _now():
    return dt.datetime.now().replace(microsecond=0).isoformat()


def age_years(dob, taken):
    try:
        d0 = dt.date.fromisoformat(dob)
        d1 = dt.date.fromisoformat(taken) if taken else dt.date.today()
    except (TypeError, ValueError):
        return None
    if d1 < d0:
        return None
    return round((d1 - d0).days / 365.25, 1)


class Store:
    def __init__(self, root):
        self.root = root
        self.dir = os.path.join(root, "cases")
        os.makedirs(self.dir, exist_ok=True)
        self._lock = threading.RLock()
        self._cache = {}          # id -> (mtime, case)

    # ------------------------------------------------------------------ paths
    def case_dir(self, cid):
        if not cid or "/" in cid or "\\" in cid or cid.startswith(".") or cid.startswith("_"):
            raise KeyError(cid)
        return os.path.join(self.dir, cid)

    def image_path(self, cid):
        return os.path.join(self.case_dir(cid), "image.png")

    def thumb_path(self, cid):
        return os.path.join(self.case_dir(cid), "thumb.jpg")

    # ------------------------------------------------------------------ create
    def _find_sha(self, sha):
        for c in self.list():
            if c.get("source", {}).get("sha1") == sha:
                return c
        return None

    def create(self, data, filename, settings=None):
        """A new case from an uploaded file. Returns (case, already_there)."""
        settings = settings or {}
        sha = hashlib.sha1(data).hexdigest()
        with self._lock:
            dup = self._find_sha(sha)
            if dup:
                return dup, True
            cal = settings.get("calibration") or {}
            img, meta = imageio.read_any(data, filename, cal.get("magnification", 1.13))
            stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
            cid = f"{stamp}-{secrets.token_hex(2)}"
            d = os.path.join(self.dir, cid)
            os.makedirs(d)
            ext = os.path.splitext(filename or "")[1].lower() or (".dcm" if meta["format"] == "dicom" else ".img")
            if not ext.replace(".", "").isalnum() or len(ext) > 8:
                ext = ".bin"
            with open(os.path.join(d, "original" + ext), "wb") as f:
                f.write(data)
            imageio.save_png(img, os.path.join(d, "image.png"))
            imageio.save_thumb(img, os.path.join(d, "thumb.jpg"))
            mm, src = meta.get("mm_per_px"), meta.get("calibration")
            if not mm and cal.get("default_mm_per_px"):
                try:
                    mm = float(cal["default_mm_per_px"])
                    src = f"office default for exported images ({mm:.4f} mm per pixel)"
                except (TypeError, ValueError):
                    mm, src = None, None
            case = dict(
                id=cid, kind="ceph_lateral", created=_now(), updated=_now(),
                patient=dict(name=meta.get("patient") or "", dob=meta.get("dob"), sex=meta.get("sex"),
                             chart=meta.get("patient_id") or ""),
                taken=meta.get("taken"),
                source=dict(file="original" + ext, name=os.path.basename(filename or ""), format=meta["format"],
                            sha1=sha, manufacturer=meta.get("manufacturer"), device=meta.get("device"),
                            description=meta.get("description")),
                image=dict(w=int(img.shape[1]), h=int(img.shape[0])),
                calibration=dict(mm_per_px=mm, source=src),
                facing=None, landmarks={}, skipped=[], status="new",
                cvm=dict(doctor=None), notes="", details_confirmed=False,
                history=[dict(t=_now(), what=f"imported {os.path.basename(filename or '')}")],
            )
            self.save(case)
            return case, False

    # ------------------------------------------------------------------ read / write
    def get(self, cid):
        path = os.path.join(self.case_dir(cid), "case.json")
        with self._lock:
            try:
                mt = os.path.getmtime(path)
            except OSError:
                raise KeyError(cid)
            hit = self._cache.get(cid)
            if hit and hit[0] == mt:
                return json.loads(json.dumps(hit[1]))
            with open(path, encoding="utf-8") as f:
                case = json.load(f)
            self._cache[cid] = (mt, case)
            return json.loads(json.dumps(case))

    def save(self, case):
        case["updated"] = _now()
        d = self.case_dir(case["id"])
        path = os.path.join(d, "case.json")
        tmp = path + ".tmp"
        with self._lock:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(case, f, indent=1)
            os.replace(tmp, path)
            self._cache.pop(case["id"], None)
        return case

    def list(self, q=None):
        """Every case (newest x-ray first), optionally filtered by text in the name, chart number or date."""
        out = []
        try:
            names = os.listdir(self.dir)
        except OSError:
            names = []
        for n in names:
            if n.startswith("_") or n.startswith("."):
                continue
            try:
                out.append(self.get(n))
            except (KeyError, ValueError, OSError):
                continue
        if q:
            ql = q.lower().strip()
            out = [c for c in out if ql in (c["patient"].get("name") or "").lower()
                   or ql in (c["patient"].get("chart") or "").lower()
                   or ql in (c.get("taken") or "") or ql in c["id"]]
        out.sort(key=lambda c: (c.get("taken") or c["created"][:10], c["created"]), reverse=True)
        return out

    def delete(self, cid):
        with self._lock:
            src = self.case_dir(cid)
            if not os.path.isdir(src):
                raise KeyError(cid)
            dst_root = os.path.join(self.dir, "_deleted")
            os.makedirs(dst_root, exist_ok=True)
            shutil.move(src, os.path.join(dst_root, cid))
            self._cache.pop(cid, None)

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def points_px(case):
        """Landmarks as {code: (x, y)} image pixels."""
        return {c: (float(v["x"]), float(v["y"])) for c, v in (case.get("landmarks") or {}).items()
                if c in CODES and v and v.get("x") is not None}

    @staticmethod
    def summary_row(case):
        """What the case list needs."""
        lm = case.get("landmarks") or {}
        return dict(id=case["id"], name=case["patient"].get("name") or "(no name)", taken=case.get("taken"),
                    status=case.get("status", "new"), n_points=len(lm),
                    age=age_years(case["patient"].get("dob"), case.get("taken")),
                    stage=(case.get("cvm") or {}).get("doctor") or (case.get("result") or {}).get("cvm"),
                    sagittal=(case.get("result") or {}).get("sagittal"), created=case["created"])
