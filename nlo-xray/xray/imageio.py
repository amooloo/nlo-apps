"""Reading x-ray files: DICOM (as exported by CS Imaging or any other imaging software), JPEG, PNG, TIFF, BMP.

Returns an 8-bit greyscale image (bone light, as on a light box) plus what the file says about the patient
and the pixel size. Nothing is sent anywhere; the file is only read.

Pixel size (mm per pixel at the patient's midsagittal plane), in order of trust:
  1. DICOM PixelSpacing when the file marks it as calibrated (or it differs from the detector spacing);
  2. DICOM ImagerPixelSpacing (at the detector) divided by the magnification - from the file's
     EstimatedRadiographicMagnificationFactor, else the office setting (1.13 for the CS 8200 ceph arm);
  3. nothing (JPEG/PNG exports): the office default from Settings, or a ruler calibration on the x-ray.
"""
import io
import os
import re
import datetime as dt

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE = 4096          # larger images are scaled down (mm per pixel follows)
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}


class ImageReadError(Exception):
    pass


def is_dicom_bytes(data):
    return len(data) > 132 and data[128:132] == b"DICM"


def _to_uint8(a, lo_pct=0.5, hi_pct=99.5):
    a = np.asarray(a, dtype=np.float64)
    finite = a[np.isfinite(a)]
    if finite.size == 0:
        raise ImageReadError("the image has no pixel data")
    lo, hi = np.percentile(finite, [lo_pct, hi_pct])
    if hi <= lo:
        lo, hi = float(finite.min()), float(finite.max())
        if hi <= lo:
            hi = lo + 1.0
    out = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
    return (out * 255.0 + 0.5).astype(np.uint8)


def _dicom_date(v):
    v = str(v or "").strip()
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", v)
    if not m:
        return None
    try:
        return dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def _person_name(v):
    s = str(v or "").strip()
    if not s:
        return ""
    parts = [p.strip() for p in s.split("^")]
    last = parts[0] if parts else ""
    first = parts[1] if len(parts) > 1 else ""
    if first and last:
        return f"{last.title()}, {first.title()}"
    return (last or first).title()


def _float_pair(v):
    try:
        vals = [float(x) for x in v]
        if len(vals) >= 2 and vals[0] > 0 and vals[1] > 0:
            return vals[0], vals[1]
        if len(vals) == 1 and vals[0] > 0:
            return vals[0], vals[0]
    except (TypeError, ValueError):
        pass
    return None


def read_dicom(data, default_magnification=1.13):
    try:
        import pydicom
        from pydicom.pixels import apply_modality_lut, apply_voi_lut
    except ImportError as ex:  # pragma: no cover
        raise ImageReadError(f"DICOM support is not installed ({ex})")
    try:
        ds = pydicom.dcmread(io.BytesIO(data), force=True)
        arr = ds.pixel_array
    except Exception as ex:
        raise ImageReadError(f"could not read the DICOM image ({ex.__class__.__name__}: {ex})")
    if arr.ndim == 3 and getattr(ds, "SamplesPerPixel", 1) == 1:
        arr = arr[0]                                    # multi-frame: first frame
    photometric = str(getattr(ds, "PhotometricInterpretation", "MONOCHROME2")).upper()
    if arr.ndim == 3:                                   # colour: to grey
        arr = arr[..., :3].astype(np.float64) @ np.array([0.299, 0.587, 0.114])
        img = _to_uint8(arr, 0.0, 100.0)
    else:
        try:
            arr = apply_modality_lut(arr, ds)
        except Exception:
            arr = arr.astype(np.float64)
        windowed = False
        if "WindowCenter" in ds and "WindowWidth" in ds:
            try:
                arr = apply_voi_lut(arr, ds)
                windowed = True
            except Exception:
                windowed = False
        img = _to_uint8(arr, 0.0, 100.0) if windowed else _to_uint8(arr)
        if photometric == "MONOCHROME1":
            img = 255 - img

    meta = dict(format="dicom",
                patient=_person_name(getattr(ds, "PatientName", "")),
                patient_id=str(getattr(ds, "PatientID", "") or ""),
                dob=_dicom_date(getattr(ds, "PatientBirthDate", "")),
                sex=(str(getattr(ds, "PatientSex", "") or "").strip().upper()[:1] or None),
                taken=_dicom_date(getattr(ds, "AcquisitionDate", "") or getattr(ds, "StudyDate", "")
                                  or getattr(ds, "ContentDate", "")),
                manufacturer=str(getattr(ds, "Manufacturer", "") or ""),
                device=str(getattr(ds, "ManufacturerModelName", "") or ""),
                modality=str(getattr(ds, "Modality", "") or ""),
                description=str(getattr(ds, "SeriesDescription", "") or getattr(ds, "StudyDescription", "") or ""))
    if meta["sex"] not in ("M", "F"):
        meta["sex"] = None

    ps = _float_pair(getattr(ds, "PixelSpacing", None))
    ips = _float_pair(getattr(ds, "ImagerPixelSpacing", None))
    cal_type = str(getattr(ds, "PixelSpacingCalibrationType", "") or "").upper()
    try:
        mag = float(getattr(ds, "EstimatedRadiographicMagnificationFactor", 0) or 0)
    except (TypeError, ValueError):
        mag = 0.0
    mm, src = None, None
    if ps and (cal_type in ("GEOMETRY", "FIDUCIAL") or not ips or abs(ps[0] - ips[0]) > 1e-6):
        mm, src = (ps[0] + ps[1]) / 2.0, f"DICOM pixel spacing {ps[0]:.4f} mm (calibrated to the patient)"
    elif ips or ps:
        sp = ips or ps
        m = mag if mag > 1.0 else float(default_magnification or 1.0)
        from_file = mag > 1.0
        mm = (sp[0] + sp[1]) / 2.0 / m
        src = (f"DICOM detector spacing {sp[0]:.4f} mm ÷ magnification {m:.3f}"
               f" ({'from the file' if from_file else 'office setting'})")
    meta["mm_per_px"] = mm
    meta["calibration"] = src
    return img, meta


def read_picture(data):
    try:
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
    except Exception as ex:
        raise ImageReadError(f"not an image file this app can read ({ex.__class__.__name__})")
    if im.mode in ("I;16", "I;16B", "I;16L", "I", "F"):
        arr = np.asarray(im, dtype=np.float64)
        img = _to_uint8(arr, 0.0, 100.0)
    else:
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGB")
        img = np.asarray(im.convert("L"), dtype=np.uint8)
    return img, dict(format=(im.format or "image").lower(), patient="", patient_id="", dob=None, sex=None,
                     taken=None, manufacturer="", device="", modality="", description="",
                     mm_per_px=None, calibration=None)


_SKIP_WORDS = {"ceph", "cephalometric", "lat", "lateral", "pano", "pan", "panoramic", "xray", "x", "ray", "img",
               "image", "export", "dcm", "jpg", "jpeg", "png", "tif", "tiff", "copy", "final", "scan", "cbct", "cs"}


def name_from_filename(filename):
    """A guess at the patient's name from a file name like 'Jane_Doe_ceph_20261015.jpg' -> 'Jane Doe'."""
    stem = os.path.splitext(os.path.basename(filename or ""))[0]
    words = [w for w in re.split(r"[\s_\-.,()]+", stem) if w]
    keep = [w for w in words if w.isalpha() and w.lower() not in _SKIP_WORDS and len(w) > 1]
    return " ".join(w.capitalize() for w in keep[:3])


def date_from_filename(filename):
    m = re.search(r"(20\d{2})[-_]?(\d{2})[-_]?(\d{2})", os.path.basename(filename or ""))
    if not m:
        return None
    try:
        return dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def read_any(data, filename="", default_magnification=1.13):
    """Bytes of an uploaded file -> (uint8 greyscale image, meta). Scales very large images down."""
    ext = os.path.splitext(filename or "")[1].lower()
    if is_dicom_bytes(data) or ext in (".dcm", ".dicom"):
        img, meta = read_dicom(data, default_magnification)
    elif ext in IMAGE_EXT or ext == "":
        try:
            img, meta = read_picture(data)
        except ImageReadError:
            if ext == "":
                img, meta = read_dicom(data, default_magnification)   # DICOM files often have no extension
            else:
                raise
    else:
        raise ImageReadError(f"'{ext}' files are not x-ray images this app reads (DICOM, JPG, PNG, TIFF, BMP)")
    if img.ndim != 2 or min(img.shape) < 64:
        raise ImageReadError("the image is too small to be an x-ray")
    h, w = img.shape
    scale = 1.0
    if max(h, w) > MAX_SIDE:
        scale = MAX_SIDE / float(max(h, w))
        im = Image.fromarray(img).resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        img = np.asarray(im, dtype=np.uint8)
        if meta.get("mm_per_px"):
            meta["mm_per_px"] = meta["mm_per_px"] / scale
            meta["calibration"] = (meta.get("calibration") or "") + f" (image scaled to {img.shape[1]}x{img.shape[0]})"
    meta["scaled"] = scale
    if not meta.get("patient"):
        meta["patient"] = name_from_filename(filename)
    if not meta.get("taken"):
        meta["taken"] = date_from_filename(filename)
    return img, meta


def save_png(img, path):
    Image.fromarray(img).save(path, format="PNG", optimize=False, compress_level=6)


def save_thumb(img, path, size=320):
    im = Image.fromarray(img)
    im.thumbnail((size, size), Image.LANCZOS)
    im.save(path, format="JPEG", quality=82)


def load_png(path):
    with Image.open(path) as im:
        return np.asarray(im.convert("L"), dtype=np.uint8)
