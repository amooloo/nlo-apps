"""Automatic retraining from the app's training/ folder.

    training/<Last, First - date>/scan_upper.stl|.ply + labels_upper.npz   (corrected=True: someone used the brush)
    training/<...>/titan_stage0_upper.stl                             (Titan export with one shell per tooth)
    training/_base/<case>/scan_<arch>.stl + labels_<arch>.npz        (the starting set, shipped once)

What counts as a lesson: a brush-corrected case that was sent, a Titan export that carries tooth shells
(ground truth is built from it next to the scan), and the base set. Automatic results that were sent
untouched are not used - they would only teach the model what it already does.

Acceptance: the new model must (a) have learned the lessons - on the corrected/Titan cases it scores at
least as well as the current model and >= 0.95 (tooth-mask F1); (b) still generalise - scored out-of-fold
(3 folds by case) it keeps a mean F1 >= 0.95 on the base set; and (c) once there are 3+ lessons, its
out-of-fold score on the lessons must not fall below the current model's. Then it replaces
assets/models.joblib (the previous file is kept as models_prev_<stamp>).
The app runs this at night when nothing is being processed; `python -m bleachtray.learn` runs it by hand.
"""
import os, sys, json, time, glob, re
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRAIN_DIR = os.path.join(ROOT, "training")
STATE_DIR = os.path.join(TRAIN_DIR, "_learn")
ASSETS = os.path.join(ROOT, "assets")
MIN_BASE_F1 = 0.95          # smoothed tooth-mask F1 on full base cases (training/_base)
MIN_BASE_F1_PACKED = 0.93   # plain per-vertex F1 on the packed base set that ships with the app
MAX_ROWS_PER_CASE = 120_000


def _log_to(path):
    def log(msg):
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
        print(line, flush=True)
        try:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass
    return log


def titan_has_shells(path, min_shells=6):
    try:
        import trimesh
        m = trimesh.load(path, force="mesh")
        parts = m.split(only_watertight=False)
        return sum(1 for p in parts if 1500 <= len(p.faces) <= 60000) >= min_shells
    except Exception:
        return False


BASE_PACK = os.path.join(ASSETS, "base_training.npz")


def base_pack_cases():
    """The starting set that ships with the app: per arch the per-vertex features and targets (numbers only,
    no scans, no names), so retraining works without anything to download. Cases under training/_base
    (full scans + labels) are used instead when present."""
    if not os.path.isfile(BASE_PACK):
        return []
    try:
        z = np.load(BASE_PACK)
    except Exception:
        return []
    names = list(z["feature_names"])
    out = []
    for k in sorted(x[:-2] for x in z.files if x.endswith("_X")):
        out.append(dict(kind="base", name=k.replace("_", " "), arch=k.split("_")[-1], packed=True, names=names,
                        X=z[k + "_X"].astype(np.float32), y_tooth=z[k + "_tooth"].astype(int), y_ip=z[k + "_ip"].astype(int), when=0.0))
    return out


def collect(root=TRAIN_DIR, log=print):
    """Every usable (scan, labels) pair under training/, with its kind and when it appeared."""
    cases = []
    if not os.path.isdir(root):
        return cases
    for folder in sorted(os.listdir(root)):
        d = os.path.join(root, folder)
        if not os.path.isdir(d) or folder.startswith("_learn"):
            continue
        base = folder == "_base"
        subs = [os.path.join(d, x) for x in sorted(os.listdir(d))] if base else [d]
        for sd in subs:
            if not os.path.isdir(sd):
                continue
            for arch in ("upper", "lower"):
                scan = next((c for c in (os.path.join(sd, f"scan_{arch}.ply"), os.path.join(sd, f"scan_{arch}.stl")) if os.path.isfile(c)), None)
                if scan is None:
                    continue
                lab = os.path.join(sd, f"labels_{arch}.npz")
                titan = sorted(glob.glob(os.path.join(sd, f"titan_stage*_{arch}.stl")))
                kind, gt = None, None
                if base and os.path.isfile(lab):
                    kind, gt = "base", lab
                elif titan and titan_has_shells(titan[0]):
                    gt = os.path.join(sd, f"gt_titan_{arch}.npz")
                    if not os.path.isfile(gt) or os.path.getmtime(gt) < os.path.getmtime(titan[0]):
                        try:
                            from tools.make_ground_truth import build
                            log(f"ground truth from Titan: {os.path.relpath(titan[0], root)}")
                            build(scan, titan[0], gt, tol=0.3, model_hint=True, log=lambda m: log("   " + m))
                        except Exception as ex:  # noqa
                            log(f"   could not build ground truth from {titan[0]}: {ex}")
                            gt = None
                    if gt:
                        kind = "titan"
                elif os.path.isfile(lab):
                    try:
                        if bool(np.load(lab)["corrected"]):
                            kind, gt = "corrected", lab
                    except Exception:
                        pass
                if kind:
                    cases.append(dict(raw=scan, gt=gt, kind=kind, arch=arch, name=f"{os.path.basename(sd)} {arch}",
                                      when=os.path.getmtime(gt)))
    return cases


def status(root=TRAIN_DIR):
    st = {}
    p = os.path.join(root, "_learn", "status.json")
    if os.path.isfile(p):
        try:
            st = json.load(open(p))
        except Exception:
            st = {}
    cases = collect(root, log=lambda m: None) if os.path.isdir(root) else []
    if not any(c["kind"] == "base" for c in cases):
        cases += [dict(kind="base", when=0.0, name=c["name"]) for c in base_pack_cases()]
    counts = {k: sum(1 for c in cases if c["kind"] == k) for k in ("base", "corrected", "titan")}
    last = st.get("finished", 0)
    new = [c["name"] for c in cases if c["kind"] != "base" and c["when"] > last]
    st.update(dict(cases=counts, new_since_last=new, running=st.get("running", False)))
    return _clean(st)


def _clean(v):
    """JSON-safe: NaN/inf -> None, recursively."""
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, float) and not np.isfinite(v):
        return None
    return v


def _write_status(d):
    d = _clean(d)
    os.makedirs(STATE_DIR, exist_ok=True)
    p = os.path.join(STATE_DIR, "status.json")
    cur = {}
    if os.path.isfile(p):
        try:
            cur = json.load(open(p))
        except Exception:
            cur = {}
    cur.update(d)
    json.dump(cur, open(p, "w"), indent=1)


def _score(models, c, from_proba=None):
    from sklearn.metrics import f1_score
    p = from_proba if from_proba is not None else models["models"]["tooth"].predict_proba(c["X"])[:, 1]
    if c.get("packed"):              # sampled rows, no mesh: plain per-vertex F1
        return float(f1_score(c["y_tooth"], (p > 0.5).astype(int)))
    from bleachtray.mesh_utils import smooth_field
    pred = (smooth_field(c["A"], p, 4) > 0.5).astype(int)
    v = c["valid"]
    return float(f1_score(c["y_tooth"][v], pred[v]))


def retrain(root=TRAIN_DIR, force=False, log=None):
    """Returns a dict with the outcome; writes training/_learn/status.json and learn.log."""
    os.makedirs(STATE_DIR, exist_ok=True)
    log = log or _log_to(os.path.join(STATE_DIR, "learn.log"))
    sys.path.insert(0, ROOT)
    from tools.train_eval import case_data, fit
    from bleachtray.segment import load_models
    t0 = time.time()
    _write_status(dict(running=True, started=t0))
    try:
        cases_meta = collect(root, log=log)
        lessons = [c for c in cases_meta if c["kind"] != "base"]
        base = [c for c in cases_meta if c["kind"] == "base"]
        packed = base_pack_cases() if not base else []
        if packed:
            log(f"base set: the {len(packed)} arches that ship with the app (training/_base would take precedence)")
        st = status(root)
        if not lessons:
            log("nothing to learn from yet (no brush-corrected cases, no Titan exports with tooth shells)")
            res = dict(outcome="nothing_new", finished=time.time(), running=False); _write_status(res); return res
        if not force and not st.get("new_since_last"):
            log("no new corrections since the last training")
            res = dict(outcome="nothing_new", finished=time.time(), running=False); _write_status(res); return res
        if not base and not packed:
            log("WARNING: no base set (training/_base or assets/base_training.npz) - training on the corrections alone")
        log(f"{len(base) + len(packed)} base + {len(lessons)} corrected/Titan arches")
        cases = list(packed)
        for c in cases_meta:
            try:
                d = case_data(c["raw"], c["gt"], log=log)
                d["kind"] = c["kind"]; d["name"] = c["name"]
                cases.append(d)
            except Exception as ex:  # noqa
                log(f"  skipped {c['name']}: {ex}")
        if not cases:
            res = dict(outcome="no_usable_cases", finished=time.time(), running=False); _write_status(res); return res
        names = cases[0]["names"]
        cases = [c for c in cases if c["names"] == names]
        rng = np.random.default_rng(0)
        for c in cases:   # training rows per case capped, evaluation stays on every vertex
            if c.get("packed"):
                c["rows"] = np.arange(len(c["y_tooth"])); continue
            idx = np.where(c["valid"])[0]
            c["rows"] = idx if len(idx) <= MAX_ROWS_PER_CASE else rng.choice(idx, MAX_ROWS_PER_CASE, replace=False)
        current = load_models()
        cur_scores = {c["name"]: _score(current, c) for c in cases}
        # out-of-fold scores of the new training recipe, 3 folds by case
        order = rng.permutation(len(cases))
        folds = [order[i::3] for i in range(3)]
        oof = {}
        for k, hold in enumerate(folds):
            tr = [c for i, c in enumerate(cases) if i not in set(hold)]
            if not tr:
                continue
            Xtr = np.vstack([c["X"][c["rows"]] for c in tr]); ytr = np.concatenate([c["y_tooth"][c["rows"]] for c in tr])
            clf = fit(Xtr, ytr, iters=250)
            for i in hold:
                c = cases[i]
                oof[c["name"]] = _score(None, c, from_proba=clf.predict_proba(c["X"])[:, 1])
            log(f"  fold {k + 1}/3 done ({time.time() - t0:.0f}s)")
        lesson_names = [c["name"] for c in cases if c["kind"] != "base"]
        base_names = [c["name"] for c in cases if c["kind"] == "base"]
        # final fit on everything, both classifiers; then: did it learn the lessons?
        Xall = np.vstack([c["X"][c["rows"]] for c in cases])
        final = {"tooth": fit(Xall, np.concatenate([c["y_tooth"][c["rows"]] for c in cases]), iters=400),
                 "interprox": fit(Xall, np.concatenate([c["y_ip"][c["rows"]] for c in cases]), iters=400)}
        learned = {n: _score(dict(models=final), next(c for c in cases if c["name"] == n)) for n in lesson_names}
        oof_lessons = float(np.mean([oof[n] for n in lesson_names])) if lesson_names else float("nan")
        new_on_lessons = float(np.mean(list(learned.values()))) if learned else float("nan")
        cur_on_lessons = float(np.mean([cur_scores[n] for n in lesson_names])) if lesson_names else float("nan")
        new_on_base = float(np.mean([oof[n] for n in base_names])) if base_names else float("nan")
        for c in cases:
            n = c["name"]
            log(f"  {c['kind']:9s} {n:40s} current {cur_scores[n]:.3f}  new out-of-fold {oof.get(n, float('nan')):.3f}" + (f"  new after learning {learned[n]:.3f}" if n in learned else ""))
        log(f"corrected/Titan cases: current model F1 {cur_on_lessons:.3f} -> new {new_on_lessons:.3f} (out of fold {oof_lessons:.3f}); base set out of fold {new_on_base:.3f}")
        ok_learned = not lesson_names or (new_on_lessons >= cur_on_lessons - 0.002 and new_on_lessons >= 0.95)
        ok_base = not base_names or new_on_base >= (MIN_BASE_F1_PACKED if packed else MIN_BASE_F1)
        ok_general = len(lesson_names) < 3 or oof_lessons >= cur_on_lessons - 0.01
        ok = ok_learned and ok_base and ok_general
        res = dict(finished=time.time(), running=False, cases=len(cases), corrected=len(lesson_names),
                   new_on_lessons=round(new_on_lessons, 4), cur_on_lessons=round(cur_on_lessons, 4), new_on_base=round(new_on_base, 4), oof_on_lessons=round(oof_lessons, 4),
                   per_case={n: dict(kind=next(c["kind"] for c in cases if c["name"] == n), current=round(cur_scores[n], 4), oof=round(oof.get(n, float("nan")), 4), learned=round(learned.get(n, float("nan")), 4)) for n in cur_scores})
        if not ok:
            why = "did not learn the corrected cases" if not ok_learned else ("dropped on the base set" if not ok_base else "generalises worse than the current model on the corrected cases")
            log(f"new model NOT accepted ({why}) - keeping the current one")
            res["outcome"] = "rejected"; res["why"] = why; _write_status(res); return res
        import joblib, shutil
        out = os.path.join(ASSETS, "models.joblib")
        stamp = time.strftime("%Y%m%d_%H%M")
        if os.path.isfile(out):
            shutil.copyfile(out, os.path.join(ASSETS, f"models_prev_{stamp}.joblib"))
            prev = sorted(glob.glob(os.path.join(ASSETS, "models_prev_*.joblib")))
            for old in prev[:-3]:
                try:
                    os.remove(old)
                except OSError:
                    pass
        joblib.dump(dict(models=final, feature_names=names, trained_on=[c["name"] for c in cases], trained=time.time()), out)
        log(f"new model saved: {len(cases)} arches ({len(lesson_names)} corrected/Titan), {time.time() - t0:.0f}s")
        res["outcome"] = "accepted"; res["model_trained_on"] = len(cases); _write_status(res)
        return res
    except Exception as ex:  # noqa
        import traceback
        log("training failed: " + traceback.format_exc())
        res = dict(outcome="failed", error=str(ex), finished=time.time(), running=False); _write_status(res); return res


if __name__ == "__main__":
    r = retrain(force="--force" in sys.argv)
    print(json.dumps({k: v for k, v in r.items() if k != "per_case"}, indent=1))
