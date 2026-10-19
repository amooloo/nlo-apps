"""Regression sweep: every scan in a folder through the pipeline the way the app runs it (whitening tray +
retainer, the page's default settings), each result checked mechanically, one table at the end.

    python tools/sweep.py <scan folder or files...> [--out DIR] [--only WT,TT] [--thumbs]

Checks per model: ran without error, body watertight, base joined (union), trim line long enough for a full
arch, plausible tooth count and body volume, mark and base engraving present (or the reason given), no
pipeline warnings, every output file written. Patient scans never leave the machine: the output folder is
outside the repo (default: a `sweep` folder next to the scans).

The table is written as Markdown (`sweep.md`) and JSON (`sweep.json`); with --thumbs a contact sheet of
facial views with the trim line (`sweep_thumbs.png`) for a look by eye.
"""
import argparse, glob, json, os, sys, time, traceback
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from bleachtray.pipeline import process, DEFAULTS  # noqa: E402
from bleachtray.server_presets import PRESETS  # noqa: E402

# the page's defaults (Settings > Model settings) and the per-type layer it sends, as of this version
PAGE = dict(reservoir_setback=1.0, recession_auto=False, recession_leeway=1.0, facial_offset=3.0, lingual_offset=3.0,
            floor_below=3.0, distal_keep=3.0, level=True, add_base=True, tooth_mark=True, engrave=True, engrave_text="")
TYPES = {
    "WT": dict(PRESETS["bleaching"], blockout=False, blockout_proud=0.0, stage=0, kind="T"),
    "TT": dict(PRESETS["aligner_high"], blockout=False, blockout_depth=0.75, fill_reach=1.25, fill_top=20.0, blockout_proud=0.0, stage=1, kind="A"),
}
RAW_SKIP = ("_-_", "Template")        # Titan exports ("Name - 0 - Maxilla") and templates are references, not scans


def is_scan(fn):
    low = fn.lower()
    return low.endswith((".stl", ".ply")) and not any(k in fn for k in RAW_SKIP)


def name_of(path):
    b = os.path.splitext(os.path.basename(path))[0]
    return "".join(c for c in b if c.isalnum() or c in "-_").strip("_")[:60] or "scan"


def check(rep, out_dir, name):
    """-> list of problems (empty = clean)."""
    bad = []
    if not rep.get("body_watertight"):
        bad.append("NOT watertight")
    if rep.get("base") not in ("union",):
        bad.append(f"base {rep.get('base')}")
    n = rep.get("trimline_points") or 0
    if n < 320:
        bad.append(f"trim line {n} pts")
    t = len(rep.get("teeth") or {})
    if not 10 <= t <= 16:
        bad.append(f"{t} teeth")
    v = rep.get("body_volume_ml") or 0
    if not 6.0 <= v <= 32.0:
        bad.append(f"{v} mL")
    if rep.get("warnings"):
        bad.append("warning: " + "; ".join(rep["warnings"]))
    if rep.get("engrave", True) is not False and not rep.get("engraved"):
        bad.append("no base engraving" + (f" ({rep['label_error']})" if rep.get("label_error") else ""))
    if not rep.get("tooth_mark"):
        bad.append("no mark")
    if (rep.get("loose_pieces_dropped") or 0) > 40:
        bad.append(f"{rep['loose_pieces_dropped']} loose pieces")
    mc = rep.get("midline_check") or {}
    if mc.get("used") == "arch_shape":
        bad.append("midline from arch shape (tooth pairs disagreed)")
    for suffix in ("_model.stl", "_trimline.pts", "_body_only.stl", "_body_plain.stl", "_state.npz", "_report.json"):
        if not os.path.exists(os.path.join(out_dir, name + suffix)):
            bad.append(f"missing {suffix}")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--out", default=None)
    ap.add_argument("--only", default="WT,TT")
    ap.add_argument("--thumbs", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    files = []
    for p in a.paths:
        if os.path.isdir(p):
            files += sorted(f for f in glob.glob(os.path.join(p, "*")) if is_scan(f))
        elif os.path.exists(p) and is_scan(p):
            files.append(p)
    # one file per patient + arch: the newest of duplicates
    seen = {}
    for f in files:
        seen.setdefault(name_of(f).lower(), f)
    files = list(seen.values())
    if a.limit:
        files = files[: a.limit]
    out = a.out or os.path.join(os.path.dirname(files[0]) if files else ".", "sweep")
    os.makedirs(out, exist_ok=True)
    import joblib
    models = joblib.load(os.path.join(ROOT, "assets", "models.joblib"))
    types = [t.strip().upper() for t in a.only.split(",") if t.strip()]
    rows, t_all = [], time.time()
    print(f"{len(files)} scans x {types} -> {out}", flush=True)
    for i, f in enumerate(files):
        feat_cache = {}
        for tag in types:
            P = dict(DEFAULTS); P.update(PAGE); P.update(TYPES[tag])
            P.update(patient_first="Sweep", patient_last=name_of(f).split("_")[0][:12] or "Case")
            name = f"{name_of(f)}_{tag}"
            lines = []
            t0 = time.time()
            try:
                rep = process(f, out, name=name, params=P, models=models, log=lines.append, feat_cache=feat_cache)
                bad = check(rep, out, name)
                row = dict(scan=os.path.basename(f), model=tag, arch=rep.get("arch"), teeth=len(rep.get("teeth") or {}), watertight=bool(rep.get("body_watertight")),
                           base=rep.get("base"), pts=rep.get("trimline_points"), ml=rep.get("body_volume_ml"), engraved=bool(rep.get("engraved")), mark=rep.get("tooth_mark"),
                           bridges=rep.get("line_bridges", 0), renumbered=bool(rep.get("renumbered")), gaps=len(rep.get("gaps") or []), s=round(time.time() - t0, 1), problems=bad)
            except Exception as ex:  # noqa
                row = dict(scan=os.path.basename(f), model=tag, arch=None, teeth=None, watertight=False, base=None, pts=None, ml=None, engraved=False, mark=None,
                           bridges=0, renumbered=False, gaps=0, s=round(time.time() - t0, 1), problems=[f"ERROR {type(ex).__name__}: {str(ex)[:120]}"])
                lines.append(traceback.format_exc())
            with open(os.path.join(out, name + "_log.txt"), "w") as fh:
                fh.write("\n".join(lines))
            rows.append(row)
            flag = "OK " if not row["problems"] else "!! "
            print(f"[{i + 1}/{len(files)}] {flag}{row['scan'][:48]:48s} {tag} {row['arch'] or '?':5s} teeth {row['teeth']} wt {row['watertight']} {row['base']} pts {row['pts']} {row['ml']} mL {row['s']} s  {'; '.join(row['problems'])}", flush=True)
    json.dump(rows, open(os.path.join(out, "sweep.json"), "w"), indent=1)
    md = ["| scan | model | arch | teeth | watertight | base | trim pts | mL | engraved | mark | bridges | s | problems |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        md.append(f"| {r['scan']} | {r['model']} | {r['arch']} | {r['teeth']} | {'yes' if r['watertight'] else 'NO'} | {r['base']} | {r['pts']} | {r['ml']} | {'yes' if r['engraved'] else 'no'} | {r['mark'] or '-'} | {r['bridges']} | {r['s']} | {'; '.join(r['problems']) or '-'} |")
    n_bad = sum(1 for r in rows if r["problems"])
    md.append(f"\n{len(rows)} models, {n_bad} with something to look at, {round(time.time() - t_all)} s")
    open(os.path.join(out, "sweep.md"), "w").write("\n".join(md))
    print(f"\n{len(rows)} models, {n_bad} flagged, {round(time.time() - t_all)} s -> {out}/sweep.md")
    if a.thumbs:
        try:
            thumbs(rows, out)
        except Exception as ex:  # noqa
            print("thumbs skipped:", ex)


def thumbs(rows, out):
    """Facial view of every model with its trim line, on one sheet."""
    import trimesh, matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    ok_rows = [r for r in rows if r["arch"]]
    n = len(ok_rows)
    cols = 4
    fig, axes = plt.subplots((n + cols - 1) // cols, cols, figsize=(6 * cols, 4.2 * ((n + cols - 1) // cols)))
    axes = np.atleast_1d(axes).ravel()
    for ax in axes:
        ax.axis("off")
    for ax, r in zip(axes, ok_rows):
        name = f"{name_of(r['scan'])}_{r['model']}"
        try:
            body = trimesh.load(os.path.join(out, name + "_body_only.stl"), force="mesh")
            st = np.load(os.path.join(out, name + "_state.npz"))
            V = body.vertices; F = body.faces
            # facial view: look along -y with a little from above; cheap painter's order by depth
            R = np.array([[1, 0, 0], [0, 0.35, 0.94], [0, -0.94, 0.35]])
            P = V @ R.T
            tri = P[F]; depth = tri[:, :, 2].mean(1); order = np.argsort(depth)
            nrm = body.face_normals @ R.T
            shade = np.clip(0.55 + 0.45 * nrm[:, 2], 0, 1)
            cols_ = np.c_[shade * 0.93, shade * 0.91, shade * 0.86]
            pc = PolyCollection(tri[order][:, :, :2], facecolors=cols_[order], edgecolors="none")
            ax.add_collection(pc)
            L = st["margin"] @ R.T
            ax.plot(L[:, 0], L[:, 1], "r-", lw=0.9)
            ax.set_xlim(P[:, 0].min() - 2, P[:, 0].max() + 2); ax.set_ylim(P[:, 1].min() - 2, P[:, 1].max() + 2); ax.set_aspect("equal")
        except Exception as ex:  # noqa
            ax.text(0.5, 0.5, f"no picture: {ex}", ha="center", va="center", transform=ax.transAxes)
        ax.set_title(f"{r['scan'][:34]} {r['model']}  {r['teeth']}t {r['ml']}mL" + ("  !! " + "; ".join(r["problems"])[:50] if r["problems"] else ""), fontsize=8, color="crimson" if r["problems"] else "black")
    plt.tight_layout()
    plt.savefig(os.path.join(out, "sweep_thumbs.png"), dpi=45)
    print("thumbs ->", os.path.join(out, "sweep_thumbs.png"))


if __name__ == "__main__":
    main()
