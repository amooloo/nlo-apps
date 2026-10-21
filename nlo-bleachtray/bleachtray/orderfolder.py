"""Write an OrthoFactory (Trimlign) order folder exactly like Titan's export.

Layout learned from a real Titan export (S:\\clinical\\3D printing\\Titan\\...):

    2026-02-12 14 24 09 - A - Dr. Amir Akhavan - Amir Akhavan - a9d5/
        80010_1_Order.xml
        Amir Akhavan - 1 - Mandible.stl
        Amir Akhavan - 1 - Mandible.pts

    <?xml version="1.0" encoding="utf-8"?>            (UTF-8 with BOM)
    <OrderData Type="Titan_Angled">
      <Patient Firstname="Amir" Lastname="Akhavan" ID="80010" DueDate="20260212" />
      <Aligner Name="AL1A" Serialnumber="80010AL1A">
        <Archmodel>Amir Akhavan - 1 - Mandible.stl</Archmodel>
        <TrimlineFile>Amir Akhavan - 1 - Mandible.pts</TrimlineFile>
      </Aligner>
    </OrderData>

Piece code = <A|T><U|L><stage><revision>: A aligner / T template, U upper / L lower.

The revision letter is how OrthoFactory tells two versions of one piece apart: Titan keeps the patient's ID
and moves the letter on (AL1A, AL1B, ...) for a new version, and an export that repeats a piece's name is
taken for the same piece. A second lower retainer sent for the same patient as AL1A again was cut along the
FIRST one's trim path - the first model had been moved 1.4 mm on the base, so the trim came out shifted
(10/19/2026). So every piece written here gets the letter after the highest one any order for this patient in
the folder has used (Titan's included), and the IDs stay within a 32-bit integer like Titan's.
"""
import os, re, shutil, secrets
from datetime import datetime


def _clean(s, keep_spaces=True):
    s = str(s or "").strip()
    s = re.sub(r"[^A-Za-z0-9 _\-\.']", "", s)
    return s if keep_spaces else s.replace(" ", "_")


def piece_code(kind, arch, stage, revision="A"):
    return f"{'T' if kind.upper().startswith('T') else 'A'}{'U' if arch == 'upper' else 'L'}{int(stage)}{revision}"


_PIECE = re.compile(r"^([AT][UL]\d+)([A-Z])$")


def piece_prefix(name):
    """'AL1B' -> 'AL1' (the piece without its revision letter); None for a name that is not a piece code."""
    m = _PIECE.match(str(name or ""))
    return m.group(1) if m else None


def patient_folders(root, first, last):
    """Order folders in `root` for this patient - Titan's and ours - by the patient part of the folder name
    ('<date> - A - <doctor> - <first> <last> - <tag>')."""
    want = f"{_clean(first)} {_clean(last)}".strip().lower()
    out = []
    try:
        names = os.listdir(root)
    except OSError:
        return out
    for nm in names:
        parts = nm.split(" - ")
        if len(parts) >= 5 and parts[-2].strip().lower() == want and os.path.isdir(os.path.join(root, nm)):
            out.append(os.path.join(root, nm))
    return out


def sent_revisions(root, first, last):
    """{'AL1': 'A', 'TU0': 'C', ...}: the highest revision letter each piece has had in any order for this
    patient in the OrthoFactory folder."""
    import glob
    out = {}
    for folder in patient_folders(root, first, last):
        for xml in glob.glob(os.path.join(folder, "*_Order.xml")):
            try:
                text = open(xml, encoding="utf-8-sig", errors="ignore").read()
            except OSError:
                continue
            for name in re.findall(r'<Aligner Name="([^"]+)"', text):
                m = _PIECE.match(name)
                if m and m.group(2) > out.get(m.group(1), ""):
                    out[m.group(1)] = m.group(2)
    return out


def next_revision(*letters):
    """The letter after the highest of `letters` ('' / None = never sent: 'A')."""
    top = max([str(x) for x in letters if x] or [""])
    return chr(min(ord(top) + 1, ord("Z"))) if top else "A"


def new_order_id(when=None):
    """A 9-digit number, unique per second of sending: 100000000 + seconds since 1 Jan 2026. Titan's IDs are
    small whole numbers; ours were yymmddHHMM (2610191015), more than a 32-bit integer holds - no leading
    zero, and below 2^31 for decades. NLO Cases tells the Tray Maker's orders from Titan's by this length (9 or
    10 digits: nlo-cases-src/src/lab.js tmKind), so keep it that long."""
    when = when or datetime.now()
    return str(100000000 + int((when - datetime(2026, 1, 1)).total_seconds()))


def write_order_folder(root, first, last, pieces, patient_id=None, doctor="Dr. Amir Akhavan", due=None,
                       order_type="Titan_Angled", when=None, revision=None, seen=None):
    """pieces: list of dicts {arch:'upper'|'lower', stl: path, pts: path, stage: int, kind: 'T'|'A'[, revision]}.
    Each piece gets the revision letter after the highest one this patient's orders in `root` have used for it
    (and after `seen`, {'AL1': 'B', ...}: what the caller knows was sent before - a case's own earlier folder,
    removed before this one is written, is still in OrthoFactory). `revision` forces one letter for all pieces.
    The code written is put back into each piece dict as p['code']. Returns the created folder path."""
    first, last, doctor = _clean(first), _clean(last), _clean(doctor)
    when = when or datetime.now()
    due = due or when
    pid = str(patient_id).strip() if patient_id else new_order_id(when)
    pid = re.sub(r"[^A-Za-z0-9]", "", pid) or new_order_id(when)
    before = sent_revisions(root, first, last)
    for k, v in (seen or {}).items():
        if v and v > before.get(k, ""):
            before[k] = v
    tag = secrets.token_hex(2)
    folder = os.path.join(root, f"{when.strftime('%Y-%m-%d %H %M %S')} - A - {doctor} - {first} {last} - {tag}")
    os.makedirs(folder, exist_ok=False)
    lines = ['\ufeff<?xml version="1.0" encoding="utf-8"?>', f'<OrderData Type="{order_type}">',
             f'  <Patient Firstname="{first}" Lastname="{last}" ID="{pid}" DueDate="{due.strftime("%Y%m%d")}" />']
    for p in pieces:
        archname = "Maxilla" if p["arch"] == "upper" else "Mandible"
        base = f"{first} {last} - {int(p.get('stage', 0))} - {archname}"
        stl_name, pts_name = base + ".stl", base + ".pts"
        shutil.copyfile(p["stl"], os.path.join(folder, stl_name))
        shutil.copyfile(p["pts"], os.path.join(folder, pts_name))
        pre = piece_code(p.get("kind", "T"), p["arch"], p.get("stage", 0), "")
        code = pre + (revision or p.get("revision") or next_revision(before.get(pre)))
        p["code"] = code
        lines += [f'  <Aligner Name="{code}" Serialnumber="{pid}{code}">',
                  f'    <Archmodel>{stl_name}</Archmodel>',
                  f'    <TrimlineFile>{pts_name}</TrimlineFile>',
                  '  </Aligner>']
    lines.append('</OrderData>')
    # write the XML last so a folder watcher never sees an order whose files are missing
    with open(os.path.join(folder, f"{pid}_1_Order.xml"), "w", encoding="utf-8", newline="") as f:
        f.write("\r\n".join(lines) + "\r\n")
    return folder


def _read_pts(path):
    import numpy as np
    rows = []
    with open(path, errors="ignore") as f:
        for line in f:
            s = line.strip()
            if s and (s[0].isdigit() or s[0] == "-"):
                try:
                    rows.append([float(v) for v in s.split()[:3]])
                except ValueError:
                    pass
    return np.array(rows, float)


def earlier_orders(root, first, last, pieces, this_folder=None, days=30, now=None):
    """Other order folders for the same patient that hold one of these pieces (same arch, same kind, same
    stage - e.g. a second lower retainer AL1), from the last `days`, with how far each one's trim line is
    from the new one (90th percentile of the distances): OrthoFactory lists both, and a tray formed on one model and trimmed with the other
    order's line is cut off by that much (two cases of one patient, one moved on the base by hand,
    10/19/2026). [{folder, when, id, piece, shift_mm}] - only lines more than 0.3 mm apart."""
    import glob
    import numpy as np
    from scipy.spatial import cKDTree
    first, last = _clean(first).lower(), _clean(last).lower()
    now = now or datetime.now()
    want = {}
    for p in pieces:
        want[piece_code(p.get("kind", "T"), p["arch"], p.get("stage", 0), "")] = p.get("pts")
    out = []
    try:
        names = os.listdir(root)
    except OSError:
        return out
    for nm in names:
        folder = os.path.join(root, nm)
        if this_folder and os.path.normcase(os.path.abspath(folder)) == os.path.normcase(os.path.abspath(this_folder)):
            continue
        parts = nm.split(" - ")
        if len(parts) < 5 or parts[-2].strip().lower() != f"{first} {last}":
            continue
        try:
            when = datetime.strptime(parts[0].strip(), "%Y-%m-%d %H %M %S")
        except ValueError:
            continue
        if (now - when).days > days or not os.path.isdir(folder):
            continue
        xmls = glob.glob(os.path.join(folder, "*_Order.xml"))
        if not xmls:
            continue
        try:
            xml = open(xmls[0], encoding="utf-8-sig", errors="ignore").read()
        except OSError:
            continue
        pid = (re.search(r'<Patient [^>]*ID="([^"]*)"', xml) or [None, ""])[1]
        for name, pts_name in re.findall(r'<Aligner Name="([^"]+)"[^>]*>.*?<TrimlineFile>([^<]+)</TrimlineFile>', xml, re.S):
            new_pts = want.get(piece_prefix(name))
            if not new_pts:
                continue
            shift = None
            try:
                a, b = _read_pts(os.path.join(folder, pts_name)), _read_pts(new_pts)
                if len(a) > 10 and len(b) > 10:
                    shift = float(np.percentile(cKDTree(b).query(a)[0], 90))
            except Exception:  # noqa
                shift = None
            if shift is None or shift > 0.3:
                out.append(dict(folder=folder, when=when, id=pid, piece=name, shift_mm=None if shift is None else round(shift, 1)))
    return sorted(out, key=lambda o: o["when"])


def earlier_orders_note(found):
    """One sentence for the page about earlier orders (earlier_orders), or ''."""
    if not found:
        return ""
    kinds = {"A": "retainer", "T": "whitening tray"}
    items = []
    for o in found:
        arch = "upper" if o["piece"][1:2] == "U" else "lower"
        what = f"{arch} {kinds.get(o['piece'][:1], 'piece')} {o['piece']}"
        items.append(f"{what} from {o['when'].strftime('%m/%d %H:%M')} (order {o['id']})" + (f", its trim line {o['shift_mm']} mm away from this one's" if o.get("shift_mm") else ""))
    return ("OrthoFactory still has an earlier order for this patient: " + "; ".join(items) +
            ". Trim each tray with the order of the model it was printed from, and delete the earlier order in OrthoFactory if its model is not used.")
