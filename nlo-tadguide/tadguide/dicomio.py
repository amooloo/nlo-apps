"""Read a CBCT DICOM export (a folder of slices, a zip of it, or one multi-frame file) into a volume.

The volume keeps the scanner's grid: data[slice, row, col] (int16, rescaled - HU-like on the Carestream CS 8200)
and an affine that maps (col, row, slice) indices to patient millimetres (DICOM LPS: +x patient left,
+y posterior, +z superior). Everything else in the app works in those millimetres.

Compressed exports: the CS 8200 export is JPEG Lossless (1.2.840.10008.1.2.4.70), read through pylibjpeg-libjpeg;
JPEG 2000 through pylibjpeg-openjpeg; RLE through pylibjpeg-rle or pydicom itself.
"""
import os, io, zipfile, tempfile, shutil, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np

try:
    import pydicom
    from pydicom.errors import InvalidDicomError
except Exception:  # noqa - the app's guard reports the missing component
    pydicom = None
    InvalidDicomError = Exception

DICOMDIR_UID = "1.2.840.10008.1.3.10"
SKIP_EXT = {".txt", ".xml", ".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".exe", ".dll", ".ini", ".htm", ".html", ".inf",
            ".stl", ".ply", ".obj", ".zip", ".log", ".csv", ".js", ".css", ".ico", ".lnk", ".db"}


class DicomError(Exception):
    """A problem worth showing the doctor as it is."""


class Volume:
    def __init__(self, data, affine, meta):
        self.data = data                      # int16 (nz, ny, nx)
        self.affine = np.asarray(affine, float)
        self.meta = meta

    @property
    def shape(self):
        return self.data.shape

    @property
    def spacing(self):
        """(dx, dy, dz) in mm along col, row, slice."""
        return tuple(float(np.linalg.norm(self.affine[:3, i])) for i in range(3))

    def index_to_mm(self, ijk):
        """ijk: (..., 3) as (col, row, slice) -> (..., 3) LPS mm."""
        ijk = np.asarray(ijk, float)
        return ijk @ self.affine[:3, :3].T + self.affine[:3, 3]

    def mm_to_index(self, p):
        """(..., 3) LPS mm -> (..., 3) fractional (col, row, slice)."""
        p = np.asarray(p, float)
        inv = np.linalg.inv(self.affine[:3, :3])
        return (p - self.affine[:3, 3]) @ inv.T


# ---------------------------------------------------------------- collecting files

def _is_zip(path):
    try:
        return zipfile.is_zipfile(path)
    except Exception:
        return False


def extract_zip(path, dest, max_bytes=6_000_000_000):
    """Unpack a zip safely (no paths outside dest, a size cap). Returns dest."""
    total = 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = info.filename.replace("\\", "/")
            if info.is_dir() or name.endswith("/"):
                continue
            parts = [p for p in name.split("/") if p not in ("", ".", "..")]
            if not parts:
                continue
            total += info.file_size
            if total > max_bytes:
                raise DicomError("The zip is larger than 6 GB unpacked - that is not a single CBCT export.")
            out = os.path.join(dest, *parts)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with z.open(info) as src, open(out, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
    return dest


def collect_files(paths, workdir=None):
    """Expand folders and zips into a flat list of candidate DICOM files."""
    out = []

    def one(f):
        if f.lower().endswith(".zip") or (os.path.splitext(f)[1] == "" and _is_zip(f)):
            if _is_zip(f):
                dest = tempfile.mkdtemp(prefix="cbct_", dir=workdir)
                extract_zip(f, dest)
                out.extend(collect_files([dest], workdir))
            return
        if os.path.splitext(f)[1].lower() not in SKIP_EXT and os.path.getsize(f) > 256:
            out.append(f)
    for p in paths:
        if os.path.isdir(p):
            for root, _dirs, files in os.walk(p):
                for f in files:
                    one(os.path.join(root, f))
        elif os.path.isfile(p):
            one(p)
    return out


# ---------------------------------------------------------------- headers

def _f(v, default=None):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except Exception:
        return default


def _seq_first(ds, *names):
    """The first item of ds.A[0].B[0]... (a dataset), or None."""
    cur = ds
    for nm in names:
        try:
            seq = cur.get(nm, None)
            if seq is None or len(seq) == 0:
                return None
            cur = seq[0]
        except Exception:
            return None
    return cur


def _read_header(path):
    try:
        ds = pydicom.dcmread(path, stop_before_pixels=True, force=True)
    except (InvalidDicomError, Exception):  # noqa
        return None
    try:
        sop = str(getattr(ds.file_meta, "MediaStorageSOPClassUID", "") or "") if hasattr(ds, "file_meta") else ""
    except Exception:
        sop = ""
    if sop == DICOMDIR_UID or "DirectoryRecordSequence" in ds:
        return None
    if "Rows" not in ds or "Columns" not in ds:
        return None
    return ds


def _str(ds, name):
    try:
        v = ds.get(name, "")
        return str(v).strip() if v is not None else ""
    except Exception:
        return ""


def _geometry(ds):
    iop = ds.get("ImageOrientationPatient", None)
    if iop is None:
        iop = _seq_first(ds, "SharedFunctionalGroupsSequence", "PlaneOrientationSequence")
        iop = iop.get("ImageOrientationPatient", None) if iop is not None else None
    if iop is None:
        iop = [1, 0, 0, 0, 1, 0]
    iop = np.array([float(x) for x in iop], float)
    r, c = iop[:3], iop[3:]
    r = r / (np.linalg.norm(r) or 1.0)
    c = c / (np.linalg.norm(c) or 1.0)
    n = np.cross(r, c)
    ps = ds.get("PixelSpacing", None)
    if ps is None:
        pm = _seq_first(ds, "SharedFunctionalGroupsSequence", "PixelMeasuresSequence")
        ps = pm.get("PixelSpacing", None) if pm is not None else None
    if ps is None:
        ps = ds.get("ImagerPixelSpacing", None)
    if ps is None:
        ps = [1.0, 1.0]
    dy, dx = float(ps[0]), float(ps[1])
    ipp = ds.get("ImagePositionPatient", None)
    ipp = np.array([float(x) for x in ipp], float) if ipp is not None else None
    return r, c, n, dx, dy, ipp


# ---------------------------------------------------------------- pixels

def _decode(path, frame=None):
    ds = pydicom.dcmread(path, force=True)
    if "TransferSyntaxUID" not in getattr(ds, "file_meta", {}):
        # files without a meta header: implicit VR little endian is what such exports use
        ds.file_meta = getattr(ds, "file_meta", pydicom.dataset.FileMetaDataset())
        ds.file_meta.TransferSyntaxUID = pydicom.uid.ImplicitVRLittleEndian
    try:
        arr = ds.pixel_array
    except Exception as ex:
        ts = str(ds.file_meta.get("TransferSyntaxUID", "?"))
        name = getattr(pydicom.uid.UID(ts), "name", ts)
        raise DicomError(f"This CBCT export is compressed as '{name}', which this PC cannot read ({ex}). "
                         "In CS Imaging export it again as DICOM, or run update.bat on this PC.") from ex
    slope = _f(ds.get("RescaleSlope", None), None)
    inter = _f(ds.get("RescaleIntercept", None), None)
    if slope is None or inter is None:     # enhanced multi-frame: in the functional groups
        pvt = _seq_first(ds, "SharedFunctionalGroupsSequence", "PixelValueTransformationSequence")
        if pvt is not None:
            slope = _f(pvt.get("RescaleSlope", None), slope)
            inter = _f(pvt.get("RescaleIntercept", None), inter)
    slope = 1.0 if slope is None else slope
    inter = 0.0 if inter is None else inter
    if arr.ndim == 3 and frame is None and int(ds.get("NumberOfFrames", 1) or 1) == 1:
        arr = arr[..., 0] if arr.shape[-1] in (3, 4) else arr[0]       # RGB secondary capture: first channel
    return arr, slope, inter, ds


def _to_int16(a, slope, inter):
    if slope == 1.0 and inter == 0.0 and a.dtype == np.int16:
        return a
    v = a.astype(np.float32) * np.float32(slope) + np.float32(inter)
    np.clip(v, -32768, 32767, out=v)
    return np.rint(v).astype(np.int16)


# ---------------------------------------------------------------- the series

def load(paths, workdir=None, progress=None, max_threads=4):
    """paths: folders, zips or files. Returns a Volume. Raises DicomError with a readable message."""
    if pydicom is None:
        raise DicomError("The DICOM component (pydicom) is not installed - run install.bat.")
    say = progress or (lambda *_: None)
    t0 = time.time()
    files = collect_files(paths, workdir)
    if not files:
        raise DicomError("No files found in what was dropped. Drop the CBCT export folder, or its .zip.")
    say(f"reading headers of {len(files)} files")
    headers = []
    with ThreadPoolExecutor(max_workers=max(1, min(max_threads, os.cpu_count() or 2))) as ex:
        for f, ds in zip(files, ex.map(_read_header, files)):
            if ds is not None:
                headers.append((f, ds))
    if not headers:
        raise DicomError("None of the files is a DICOM image. Export the CBCT from CS Imaging as DICOM (not as a "
                         "project / CSI file), then drop that folder or its zip.")

    # group into series; the CBCT is the series with the most voxels
    groups = {}
    for f, ds in headers:
        uid = _str(ds, "SeriesInstanceUID") or f"{_str(ds, 'Rows')}x{_str(ds, 'Columns')}"
        groups.setdefault(uid, []).append((f, ds))

    def voxels(item):
        lst = item[1]
        ds = lst[0][1]
        frames = sum(int(d.get("NumberOfFrames", 1) or 1) for _, d in lst)
        return frames * int(ds.Rows) * int(ds.Columns)
    uid, members = max(groups.items(), key=voxels)
    ds0 = members[0][1]
    nframes0 = int(ds0.get("NumberOfFrames", 1) or 1)
    r, c, n, dx, dy, _ = _geometry(ds0)
    rows, cols = int(ds0.Rows), int(ds0.Columns)
    meta = dict(
        patient_name=str(ds0.get("PatientName", "") or "").replace("^", " ").strip(),
        patient_id=_str(ds0, "PatientID"), study_date=_str(ds0, "StudyDate"),
        manufacturer=_str(ds0, "Manufacturer"), model=_str(ds0, "ManufacturerModelName"),
        series=_str(ds0, "SeriesDescription"), modality=_str(ds0, "Modality"),
        transfer_syntax=str(getattr(getattr(ds0, "file_meta", None), "TransferSyntaxUID", "") or ""),
        series_count=len(groups), files=len(members))
    pad = ds0.get("PixelPaddingValue", None)

    if len(members) == 1 and nframes0 > 1:
        f = members[0][0]
        say(f"decoding {nframes0} frames")
        arr, slope, inter, ds = _decode(f, frame=True)
        if arr.ndim == 2:
            arr = arr[None]
        data = _to_int16(arr, slope, inter)
        pfg = ds.get("PerFrameFunctionalGroupsSequence", None)
        pos = []
        if pfg is not None:
            for fr in pfg:
                pp = None
                if "PlanePositionSequence" in fr:
                    pp = fr.PlanePositionSequence[0].get("ImagePositionPatient", None)
                pos.append(np.array([float(x) for x in pp]) if pp is not None else None)
        if pos and all(p is not None for p in pos):
            proj = np.array([p @ n for p in pos])
            order = np.argsort(proj)
            data = data[order]
            pos = [pos[i] for i in order]
            dz = float(np.median(np.diff(proj[order]))) if len(pos) > 1 else 1.0
            origin = pos[0]
        else:
            dz = _f(ds.get("SpacingBetweenSlices", None)) or _f(ds.get("SliceThickness", None)) or dx
            ipp = ds.get("ImagePositionPatient", None)
            origin = np.array([float(x) for x in ipp]) if ipp is not None else np.zeros(3)
        if pad is not None:
            meta["padding_value"] = float(pad)
    else:
        # one slice per file: order along the slice normal, drop exact duplicates
        recs = []
        for f, ds in members:
            ipp = ds.get("ImagePositionPatient", None)
            if ipp is None:
                inst = _f(ds.get("InstanceNumber", None), 0.0)
                recs.append((f, None, inst))
            else:
                p = np.array([float(x) for x in ipp])
                recs.append((f, p, float(p @ n)))
        if all(rp[1] is None for rp in recs):
            dz = _f(ds0.get("SpacingBetweenSlices", None)) or _f(ds0.get("SliceThickness", None)) or dx
            recs.sort(key=lambda x: x[2])
            origin = np.zeros(3)
            meta["warning"] = "The slices carry no position; they were stacked by instance number."
        else:
            recs = [rp for rp in recs if rp[1] is not None]
            recs.sort(key=lambda x: x[2])
            dedup = [recs[0]]
            for rp in recs[1:]:
                if abs(rp[2] - dedup[-1][2]) > 1e-3:
                    dedup.append(rp)
            recs = dedup
            proj = np.array([rp[2] for rp in recs])
            d = np.diff(proj)
            dz = float(np.median(d)) if len(d) else (_f(ds0.get("SliceThickness", None)) or dx)
            if len(d) and (d.max() > dz * 1.5 or d.min() < dz * 0.5):
                meta["warning"] = (f"Slice spacing is uneven ({d.min():.3f}-{d.max():.3f} mm); "
                                   "a slice may be missing from the export.")
            origin = recs[0][1]
        say(f"decoding {len(recs)} slices")
        data = np.empty((len(recs), rows, cols), np.int16)

        def work(k):
            arr, slope, inter, _ds = _decode(recs[k][0])
            if arr.shape != (rows, cols):
                raise DicomError(f"Slice {k + 1} has a different size ({arr.shape}) from the rest ({rows}x{cols}).")
            data[k] = _to_int16(arr, slope, inter)
            return k
        with ThreadPoolExecutor(max_workers=max(1, min(max_threads, os.cpu_count() or 2))) as ex:
            done = 0
            for _ in ex.map(work, range(len(recs))):
                done += 1
                if done % 50 == 0:
                    say(f"decoded {done}/{len(recs)} slices")
        if pad is not None:
            meta["padding_value"] = float(pad)

    if data.shape[0] < 8:
        raise DicomError(f"The export has only {data.shape[0]} image(s). That is a 2D image, not a CBCT volume.")
    affine = np.eye(4)
    affine[:3, 0] = r * dx
    affine[:3, 1] = c * dy
    affine[:3, 2] = n * dz
    affine[:3, 3] = origin
    vol = Volume(data, affine, meta)
    # the padding outside the round field of view (the CS 8200 writes -1000 there)
    vmin = int(data.min())
    frac_min = float(np.count_nonzero(data[:, ::4, ::4] == vmin)) / data[:, ::4, ::4].size
    meta["outside_value"] = vmin if frac_min > 0.03 else None
    meta["shape"] = list(data.shape)
    meta["spacing"] = [round(s, 4) for s in vol.spacing]
    meta["load_seconds"] = round(time.time() - t0, 1)
    say(f"CBCT read: {data.shape[2]}x{data.shape[1]}x{data.shape[0]} voxels at "
        f"{vol.spacing[0]:.3f}/{vol.spacing[1]:.3f}/{vol.spacing[2]:.3f} mm")
    return vol


def from_array(data, spacing=(0.5, 0.5, 0.5), origin=(0, 0, 0), meta=None):
    """For tests and non-DICOM inputs (nrrd/gipl read elsewhere): data (nz, ny, nx), spacing (dx, dy, dz)."""
    affine = np.eye(4)
    affine[0, 0], affine[1, 1], affine[2, 2] = spacing
    affine[:3, 3] = origin
    return Volume(np.ascontiguousarray(data, dtype=np.int16), affine, dict(meta or {}, shape=list(data.shape)))
