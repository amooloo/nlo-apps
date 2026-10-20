"""Learning from the doctor's confirmed tracings, on this PC.

    models/current.pt          the network in use (absent until the first one passes its check)
    models/prev_<stamp>.pt     the previous three, for going back
    models/status.json         what happened last time (counts, accuracy, accepted or not, why)
    models/train.log           the full log

What counts as a lesson: every x-ray whose tracing was confirmed. Its points are taken as the truth,
whether the app placed them and the doctor accepted them or he moved them himself.

A new network is used only if it does better than the current one on x-rays it did not learn from
(a fifth of the confirmed tracings, at least 3, held back in turn), and - for the very first one - only
if its average error is under 4 mm. Otherwise the app keeps what it has (and says so).

The CVM thresholds are tuned to the doctor's own flat / concave and body-shape judgements at the same time
(cvm.fit_thresholds).
"""
import datetime as dt
import glob
import hashlib
import json
import math
import os
import random
import shutil
import threading
import time

import numpy as np
import torch

from . import model as M
from .cvm import features as cvm_features, fit_thresholds
from .geometry import to_canonical, facing_of, dist
from .imageio import load_png
from .landmarks import CODES

MIN_CASES = 15           # confirmed tracings before the first network is trained
MIN_PER_LANDMARK = 8     # a landmark needs this many examples to be found by the network
FIRST_MODEL_MAX_MRE = 4.0
KEEP_PREV = 3


def _now():
    return dt.datetime.now().replace(microsecond=0).isoformat()


class Trainer:
    def __init__(self, root, store, get_settings, log=print):
        self.root = root
        self.store = store
        self.get_settings = get_settings
        self.dir = os.path.join(root, "models")
        os.makedirs(self.dir, exist_ok=True)
        self.log_path = os.path.join(self.dir, "train.log")
        self._print = log
        self.lock = threading.Lock()          # one training at a time
        self.model_lock = threading.RLock()   # swapping the network in use
        self.finder = None
        self.running = False
        self.progress = {}
        self.stop_flag = threading.Event()
        self.min_steps = 200          # the shortest round (tests lower it)
        self.load_current()

    # ------------------------------------------------------------------ files
    @property
    def current_path(self):
        return os.path.join(self.dir, "current.pt")

    @property
    def status_path(self):
        return os.path.join(self.dir, "status.json")

    def log(self, msg):
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
        try:
            self._print(line)
        except Exception:  # noqa
            pass
        try:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass

    def status(self):
        try:
            with open(self.status_path, encoding="utf-8") as f:
                st = json.load(f)
        except (OSError, ValueError):
            st = {}
        st["running"] = self.running
        st["progress"] = dict(self.progress)
        st["model"] = self.model_info()
        st["confirmed"] = len(self.confirmed_cases())
        st["min_cases"] = MIN_CASES
        st["previous"] = [os.path.basename(p) for p in sorted(glob.glob(os.path.join(self.dir, "prev_*.pt")))]
        return st

    def _write_status(self, st):
        tmp = self.status_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(st, f, indent=1)
        os.replace(tmp, self.status_path)

    def load_current(self):
        with self.model_lock:
            if os.path.isfile(self.current_path):
                try:
                    self.finder = M.Finder.load(self.current_path)
                    return True
                except Exception as ex:  # noqa
                    self.log(f"could not load the current network ({ex}); tracing by template")
            self.finder = None
            return False

    def model_info(self):
        f = self.finder
        if not f:
            return None
        c = f.ckpt
        return dict(version=c.get("version"), trained=c.get("trained"), n_train=c.get("n_train"),
                    n_val=c.get("n_val"), mre=c.get("val", {}).get("mre"), sdr2=c.get("val", {}).get("sdr2"),
                    per_landmark=c.get("val", {}).get("per_landmark"), usable=sorted(f.usable))

    # ------------------------------------------------------------------ data
    def confirmed_cases(self):
        return [c for c in self.store.list() if c.get("status") == "confirmed" and len(c.get("landmarks") or {}) >= 3]

    def _sample(self, case, max_side=1024):
        """One confirmed tracing, with its image scaled down to max_side (the network sees 512 anyway), so a
        few hundred cases fit in memory."""
        pts = self.store.points_px(case)
        facing = case.get("facing") or facing_of(pts) or "right"
        img = load_png(self.store.image_path(case["id"]))
        mm = (case.get("calibration") or {}).get("mm_per_px")
        if not mm and "S" in pts and "N" in pts and dist(pts["S"], pts["N"]) > 0:
            mm = 68.0 / dist(pts["S"], pts["N"])        # uncalibrated: errors judged on an SN of 68 mm
        mm = mm or 0.1
        h, w = img.shape
        k = min(1.0, max_side / float(max(h, w)))
        if k < 1.0:
            from PIL import Image
            img = np.asarray(Image.fromarray(img).resize((max(1, round(w * k)), max(1, round(h * k))), Image.BILINEAR))
            ky, kx = img.shape[0] / h, img.shape[1] / w
            pts = {c: ((x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5) for c, (x, y) in pts.items()}
            mm = mm / ((kx + ky) / 2)
        return dict(id=case["id"], img=img, facing=facing, pts=pts, mm=mm)

    def _tensorize(self, samples, codes, size):
        X = np.zeros((len(samples), 1, size, size), np.float32)
        XY = np.zeros((len(samples), len(codes), 2), np.float32)
        P = np.zeros((len(samples), len(codes)), np.float32)
        infos = []
        for i, s in enumerate(samples):
            canvas, info = M.prep(s["img"], s["facing"], size)
            X[i, 0] = canvas
            infos.append(info)
            for j, c in enumerate(codes):
                if c in s["pts"]:
                    XY[i, j] = M.to_model(s["pts"][c], info)
                    P[i, j] = 1.0
        return torch.from_numpy(X), torch.from_numpy(XY), torch.from_numpy(P), infos

    # ------------------------------------------------------------------ evaluation
    @staticmethod
    def evaluate(finder, samples):
        """Errors (mm) of a finder on held-out samples: mean radial error and success rates."""
        errs, per = [], {}
        for s in samples:
            pred, _ = finder.predict(s["img"], s["facing"])
            for c, v in pred.items():
                if c in s["pts"]:
                    e = math.hypot(v["x"] - s["pts"][c][0], v["y"] - s["pts"][c][1]) * s["mm"]
                    errs.append(e)
                    per.setdefault(c, []).append(e)
        if not errs:
            return None
        e = np.array(errs)
        return dict(mre=round(float(e.mean()), 2), sdr2=round(float((e <= 2).mean() * 100), 1),
                    sdr25=round(float((e <= 2.5).mean() * 100), 1), sdr3=round(float((e <= 3).mean() * 100), 1),
                    sdr4=round(float((e <= 4).mean() * 100), 1), n_points=int(e.size),
                    per_landmark={c: round(float(np.mean(v)), 2) for c, v in sorted(per.items())})

    # ------------------------------------------------------------------ training
    def _fit(self, train, val, codes, budget_s, seed=0, size=M.INPUT, batch=4):
        torch.manual_seed(seed)
        rng = random.Random(seed)
        X, XY, P, _ = self._tensorize(train, codes, size)
        out = size // M.STRIDE
        net = M.CephNet(len(codes))
        opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
        n = len(train)
        best, best_state, hist = None, None, []
        t0 = time.time()
        step, planned, warm = 0, None, 30
        val_finder_ckpt = dict(codes=codes, input=size, usable=codes)
        eval_every = 100
        max_steps = max(self.min_steps, min(8000, max(600, n * 120)))
        while True:
            if self.stop_flag.is_set():
                self.log("training stopped on request")
                break
            idx = [rng.randrange(n) for _ in range(min(batch, n))]
            imgs, xy = M.augment_batch(X[idx], XY[idx], rng, out)
            pres = P[idx] * ((xy[..., 0] >= 0) & (xy[..., 0] <= out - 1) & (xy[..., 1] >= 0) &
                             (xy[..., 1] <= out - 1)).float()
            net.train()
            loss = M.heat_loss(net(M.normalize(imgs)), xy, pres)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            step += 1
            if step == min(10, self.min_steps) and planned is None:
                per_step = (time.time() - t0) / step
                planned = int(max(self.min_steps, min(max_steps, budget_s / per_step)))
                self.log(f"   {per_step:.2f} s a step -> {planned} steps (budget {budget_s / 60:.0f} min)")
            total = planned or max_steps
            lr = 2e-3 * (step / warm if step < warm else 0.5 * (1 + math.cos(math.pi * min(1.0, step / total))))
            for gp in opt.param_groups:
                gp["lr"] = max(lr, 2e-5)
            opt.step()
            lv = float(loss.detach())
            self.progress.update(step=step, steps=total, loss=round(lv, 4), elapsed=round(time.time() - t0))
            last = planned is not None and step >= planned
            if val and (step % eval_every == 0 or last):
                net.eval()
                ck = dict(val_finder_ckpt, state={k: v.detach().clone() for k, v in net.state_dict().items()})
                ev = self.evaluate(M.Finder(ck), val)
                hist.append(dict(step=step, loss=round(lv, 4), mre=ev and ev["mre"]))
                self.progress.update(val_mre=ev and ev["mre"])
                self.log(f"   step {step}/{total}  loss {lv:.3f}  held-out error {ev and ev['mre']} mm")
                if ev and (best is None or ev["mre"] < best["mre"]):
                    best, best_state = ev, ck["state"]
            if last:
                break
        if best_state is None:
            best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
        return best_state, best, hist

    def train(self, budget_min=None, reason="manual"):
        """One training round. Returns the status dict. Safe to call from a background thread."""
        if not self.lock.acquire(blocking=False):
            return dict(outcome="busy", message="A training round is already running.")
        self.running = True
        self.stop_flag.clear()
        self.progress = dict(stage="preparing")
        st = dict(started=_now(), reason=reason)
        try:
            settings = self.get_settings() or {}
            budget = 60 * float(budget_min or (settings.get("learning") or {}).get("budget_min") or 90)
            cases = self.confirmed_cases()
            st["n_cases"] = len(cases)
            self.log(f"training ({reason}): {len(cases)} confirmed tracings")
            # --- CVM thresholds from the doctor's own judgements (flat / concave, body shapes) on confirmed x-rays
            ex = []
            for c in cases:
                cv = c.get("cvm") or {}
                if cv.get("confirmed") and "cvm" not in (c.get("skipped") or []):
                    pts = self.store.points_px(c)
                    canon = to_canonical(pts, c.get("facing") or facing_of(pts) or "right")
                    ex.append((cvm_features(canon, (c.get("calibration") or {}).get("mm_per_px")), cv["confirmed"]))
            fit = fit_thresholds(ex)
            st["cvm"] = {k: fit[k] for k in ("accepted", "n", "default_agree", "loo_agree", "total", "message")}
            st["cvm"]["thresholds"] = fit["thresholds"]
            self.log("   CVM: " + fit["message"])
            # --- the network
            if len(cases) < MIN_CASES:
                st.update(outcome="waiting", message=f"{len(cases)} of the {MIN_CASES} confirmed tracings needed "
                                                     f"before the app learns to place the points itself.")
                return st
            samples = [self._sample(c) for c in cases]
            counts = {c: sum(1 for s in samples if c in s["pts"]) for c in CODES}
            usable = [c for c in CODES if counts[c] >= MIN_PER_LANDMARK]
            # hold back a fifth (at least 3), chosen by a hash so the split is stable from round to round
            order = sorted(samples, key=lambda s: hashlib.sha1(s["id"].encode()).hexdigest())
            nv = max(3, round(len(order) * 0.2))
            val, trn = order[:nv], order[nv:]
            self.progress = dict(stage="training", step=0)
            self.log(f"   learning from {len(trn)}, checking on {len(val)}; {len(usable)} of {len(CODES)} landmarks "
                     f"have >= {MIN_PER_LANDMARK} examples")
            state, ev, hist = self._fit(trn, val, CODES, budget)
            if self.stop_flag.is_set():
                st.update(outcome="stopped", message="Stopped before it finished; nothing changed.")
                return st
            ver = 1 + max([0] + [int((self.status().get("model") or {}).get("version") or 0)])
            ckpt = dict(state=state, codes=CODES, usable=usable, input=M.INPUT, arch={}, version=ver,
                        trained=_now(), n_train=len(trn), n_val=len(val), counts=counts, val=ev or {}, history=hist)
            # --- the check against the network in use, on the same held-back x-rays
            new_ev = ev
            cur_ev = None
            with self.model_lock:
                if self.finder:
                    cur_ev = self.evaluate(self.finder, val)
            st["new"], st["current"] = new_ev, cur_ev
            if new_ev is None:
                st.update(outcome="rejected", message="Could not check the new network (no held-back points).")
            elif cur_ev is None and new_ev["mre"] > FIRST_MODEL_MAX_MRE:
                st.update(outcome="rejected", message=f"First network averages {new_ev['mre']} mm on the held-back "
                          f"x-rays - not good enough yet (needs under {FIRST_MODEL_MAX_MRE:g} mm). More tracings will help.")
            elif cur_ev is not None and new_ev["mre"] > cur_ev["mre"]:
                st.update(outcome="rejected", message=f"New network {new_ev['mre']} mm vs current {cur_ev['mre']} mm on "
                          f"the same held-back x-rays - keeping the current one.")
            else:
                self._install(ckpt)
                st.update(outcome="accepted", version=ver,
                          message=f"Network v{ver} in use: average error {new_ev['mre']} mm on {len(val)} held-back "
                                  f"x-rays, {new_ev['sdr2']}% of points within 2 mm.")
            self.log("   " + st["message"])
            return st
        except Exception as ex:  # noqa
            import traceback
            self.log("training failed: " + "".join(traceback.format_exception(ex))[-1500:])
            st.update(outcome="error", message=f"Training failed: {ex}")
            return st
        finally:
            st["finished"] = _now()
            try:
                self._write_status({k: v for k, v in st.items()})
            except OSError:
                pass
            self.progress = {}
            self.running = False
            self.lock.release()

    def _install(self, ckpt):
        with self.model_lock:
            if os.path.isfile(self.current_path):
                stamp = time.strftime("%Y%m%d-%H%M%S")
                shutil.move(self.current_path, os.path.join(self.dir, f"prev_{stamp}.pt"))
                prev = sorted(glob.glob(os.path.join(self.dir, "prev_*.pt")))
                for old in prev[:-KEEP_PREV]:
                    try:
                        os.remove(old)
                    except OSError:
                        pass
            tmp = self.current_path + ".tmp"
            torch.save(ckpt, tmp)
            os.replace(tmp, self.current_path)
            self.finder = M.Finder(ckpt)

    def rollback(self):
        with self.model_lock:
            prev = sorted(glob.glob(os.path.join(self.dir, "prev_*.pt")))
            if not prev:
                return False
            if os.path.isfile(self.current_path):
                os.replace(self.current_path, os.path.join(self.dir, "rejected_" + time.strftime("%Y%m%d-%H%M%S") + ".pt"))
            os.replace(prev[-1], self.current_path)
            self.log(f"went back to {os.path.basename(prev[-1])}")
            return self.load_current()

    def predict(self, img_u8, facing=None):
        with self.model_lock:
            if not self.finder:
                return None, facing
            return self.finder.predict(img_u8, facing)


class Nightly:
    """Starts a training round in the evening window when there are new confirmed tracings and the
    app has been idle for a while (default 7 pm - 1 am, so it never overlaps Tray Maker's 1-5 am round
    when both run on the same PC)."""

    def __init__(self, trainer, get_settings, last_activity):
        self.trainer = trainer
        self.get_settings = get_settings
        self.last_activity = last_activity

    def due(self, now=None):
        now = now or dt.datetime.now()
        cfg = (self.get_settings() or {}).get("learning") or {}
        if cfg.get("nightly") is False:
            return False
        start, end = int(cfg.get("window_start", 19)), int(cfg.get("window_end", 1))
        h = now.hour
        in_window = (start <= h or h < end) if start > end else (start <= h < end)
        if not in_window or self.trainer.running:
            return False
        if time.time() - self.last_activity() < 15 * 60:
            return False
        st = self.trainer.status()
        newest = max([c.get("confirmed_at") or "" for c in self.trainer.confirmed_cases()] + [""])
        if not newest or newest <= (st.get("started") or ""):
            return False               # nothing confirmed or corrected since the last round started
        try:                           # at most one round in 6 hours (once an evening)
            if now - dt.datetime.fromisoformat(st.get("finished")) < dt.timedelta(hours=6):
                return False
        except (TypeError, ValueError):
            pass
        return True

    def run_forever(self, every_s=600):
        while True:
            try:
                if self.due():
                    self.trainer.train(reason="nightly")
            except Exception as ex:  # noqa
                self.trainer.log(f"nightly check failed: {ex}")
            time.sleep(every_s)
