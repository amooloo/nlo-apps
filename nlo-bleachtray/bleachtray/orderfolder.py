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
"""
import os, re, shutil, secrets
from datetime import datetime


def _clean(s, keep_spaces=True):
    s = str(s or "").strip()
    s = re.sub(r"[^A-Za-z0-9 _\-\.']", "", s)
    return s if keep_spaces else s.replace(" ", "_")


def piece_code(kind, arch, stage, revision="A"):
    return f"{'T' if kind.upper().startswith('T') else 'A'}{'U' if arch == 'upper' else 'L'}{int(stage)}{revision}"


def write_order_folder(root, first, last, pieces, patient_id=None, doctor="Dr. Amir Akhavan", due=None,
                       order_type="Titan_Angled", when=None, revision="A"):
    """pieces: list of dicts {arch:'upper'|'lower', stl: path, pts: path, stage: int, kind: 'T'|'A'}.
    Returns the created folder path."""
    first, last, doctor = _clean(first), _clean(last), _clean(doctor)
    when = when or datetime.now()
    due = due or when
    pid = str(patient_id).strip() if patient_id else when.strftime("%y%m%d%H%M")
    pid = re.sub(r"[^A-Za-z0-9]", "", pid) or when.strftime("%y%m%d%H%M")
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
        code = piece_code(p.get("kind", "T"), p["arch"], p.get("stage", 0), revision)
        lines += [f'  <Aligner Name="{code}" Serialnumber="{pid}{code}">',
                  f'    <Archmodel>{stl_name}</Archmodel>',
                  f'    <TrimlineFile>{pts_name}</TrimlineFile>',
                  '  </Aligner>']
    lines.append('</OrderData>')
    # write the XML last so a folder watcher never sees an order whose files are missing
    with open(os.path.join(folder, f"{pid}_1_Order.xml"), "w", encoding="utf-8", newline="") as f:
        f.write("\r\n".join(lines) + "\r\n")
    return folder
