"""Learning rounds on synthetic cephs: waiting, rejected, accepted, rollback, and the evening schedule."""
import datetime as dt
import io
import os

import numpy as np
import pytest
from PIL import Image

from xray import train as T
from xray.store import Store


def make_store(root, n, seed=0):
    from synth import render
    st = Store(str(root))
    rng = np.random.default_rng(seed)
    for i in range(n):
        a, pts, facing, _ = render(rng)
        buf = io.BytesIO()
        Image.fromarray(a).save(buf, format="PNG")
        case, _ = st.create(buf.getvalue(), f"Synthetic_{i:02d}.png", {})
        case["landmarks"] = {k: dict(x=v[0], y=v[1], by="doctor") for k, v in pts.items()}
        case["facing"] = facing
        case["calibration"] = dict(mm_per_px=0.24, source="synthetic")
        case["status"] = "confirmed"
        case["confirmed_at"] = f"2026-10-20T08:{i:02d}:00"
        st.save(case)
    return st


@pytest.fixture()
def trainer(tmp_path, monkeypatch):
    st = make_store(tmp_path, 5)
    tr = T.Trainer(str(tmp_path), st, lambda: {"learning": {"budget_min": 0.01}}, log=lambda m: None)
    tr.min_steps = 12
    monkeypatch.setattr(T, "MIN_CASES", 4)
    return tr


def test_waits_for_enough_tracings(tmp_path):
    st = make_store(tmp_path, 2)
    tr = T.Trainer(str(tmp_path), st, lambda: {}, log=lambda m: None)
    res = tr.train()
    assert res["outcome"] == "waiting" and "2 of the 15" in res["message"]
    assert tr.status()["confirmed"] == 2 and tr.finder is None


def test_first_network_must_be_good_enough(trainer, monkeypatch):
    monkeypatch.setattr(T, "FIRST_MODEL_MAX_MRE", 0.001)
    res = trainer.train()
    assert res["outcome"] == "rejected" and "not good enough" in res["message"]
    assert trainer.finder is None and not os.path.exists(trainer.current_path)


def test_accept_predict_and_roll_back(trainer, monkeypatch):
    monkeypatch.setattr(T, "FIRST_MODEL_MAX_MRE", 1e9)
    res = trainer.train()
    assert res["outcome"] == "accepted", res
    assert os.path.isfile(trainer.current_path) and trainer.finder is not None
    info = trainer.model_info()
    assert info["version"] == 1 and info["n_val"] == 3 and info["mre"] is not None
    img = np.asarray(Image.open(trainer.store.image_path(trainer.confirmed_cases()[0]["id"])).convert("L"))
    pts, facing = trainer.predict(img)
    assert len(pts) == 37 and facing in ("left", "right")
    assert all(0 <= v["conf"] <= 1 for v in pts.values())
    # a second network replaces the first; going back restores it
    trainer._install(dict(trainer.finder.ckpt, version=2))
    assert trainer.model_info()["version"] == 2
    assert trainer.status()["previous"]
    assert trainer.rollback()
    assert trainer.model_info()["version"] == 1
    st = trainer.status()
    assert st["outcome"] == "accepted" and st["finished"]


def test_evening_schedule(trainer):
    seen = {"activity": 0.0}
    n = T.Nightly(trainer, lambda: {"learning": {"window_start": 19, "window_end": 1}}, lambda: seen["activity"])
    evening = dt.datetime(2026, 10, 20, 21, 0)
    morning = dt.datetime(2026, 10, 20, 10, 0)
    assert n.due(evening)                       # new confirmed tracings, never trained
    assert not n.due(morning)                   # outside the window
    assert n.due(dt.datetime(2026, 10, 21, 0, 30))   # the window runs past midnight
    import time
    seen["activity"] = time.time()
    assert not n.due(evening)                   # someone is using the app
    seen["activity"] = 0.0
    trainer._write_status(dict(started="2026-10-20T20:00:00", finished="2026-10-20T20:30:00", outcome="accepted"))
    assert not n.due(evening)                   # nothing confirmed since that round
    n2 = T.Nightly(trainer, lambda: {"learning": {"nightly": False}}, lambda: 0.0)
    assert not n2.due(evening)
