"""The print folder: every finished model, filed by patient, where PreForm opens it from.

    <print root>\\Doe, Jane\\2026-10-18_Doe_Jane_Upper_WT.stl
                               2026-10-18_Doe_Jane_Lower_WT.stl
                               2026-10-18_Doe_Jane_Upper_MG.stl

One folder per patient (Last, First), one file per model with the date it was made, the arch and
the type (WT whitening tray, TT retainer template, MG mouthguard). A second set made on the same
day for the same patient (a new case, not a re-send) gets _2, _3 ... so nothing is overwritten.
The OrthoFactory order folder is a different thing: that one carries the trim line (.pts) the
Trimlign needs and is written next to Titan's own exports; the print folder is only models.
"""
import os, re, shutil, ntpath, posixpath
from datetime import datetime


def _clean(s):
    s = re.sub(r"[^A-Za-z0-9 _\-']", "", str(s or "").strip())
    return re.sub(r"\s+", " ", s).strip()


def _pathmod(p):
    """Windows path handling for a Windows path even when the code runs elsewhere (tests)."""
    return ntpath if ("\\" in p or re.match(r"^[A-Za-z]:", p or "")) else os.path


def default_print_root(order_root, app_root):
    """Next to Titan's export folder when the OrthoFactory folder is known (…\\3D printing\\Models),
    else a models folder inside the app."""
    if order_root:
        pm = _pathmod(order_root)
        parent = pm.dirname(order_root.rstrip("\\/"))
        if parent:
            return pm.join(parent, "Models")
    return os.path.join(app_root, "models")


def model_filename(first, last, arch, tag, when=None, n=1):
    when = when or datetime.now()
    base = f"{when.strftime('%Y-%m-%d')}_{_clean(last).replace(' ', '')}_{_clean(first).replace(' ', '')}_{'Upper' if arch == 'upper' else 'Lower'}_{tag or 'MODEL'}"
    return base + ("" if n <= 1 else f"_{n}") + ".stl"


def write_print_folder(root, first, last, pieces, when=None, own=(), dry=False):
    """pieces: [{arch, tag, stl}]. Copies each model into root\\<Last>, <First>\\ and returns
    (folder, [paths]). A file that is already there from an earlier Send of the same case (`own`)
    is replaced; one from another case keeps its name and the new one is numbered. `dry`: only the
    names the files will get (nothing is written) - the page hands them to PreForm on another PC
    the moment the button is clicked, then has them written."""
    first, last = _clean(first), _clean(last)
    if not (first and last):
        raise ValueError("patient first + last name needed to file the models")
    folder = os.path.join(root, f"{last}, {first}")
    if not dry:
        os.makedirs(folder, exist_ok=True)
    own = {os.path.normcase(os.path.abspath(p)) for p in own}
    out = []
    for p in pieces:
        n = 1
        while True:
            dst = os.path.join(folder, model_filename(first, last, p["arch"], p.get("tag"), when, n))
            if dst not in out and (not os.path.exists(dst) or os.path.normcase(os.path.abspath(dst)) in own):
                break
            n += 1
        if not dry:
            shutil.copyfile(p["stl"], dst)
        out.append(dst)
    return folder, out
