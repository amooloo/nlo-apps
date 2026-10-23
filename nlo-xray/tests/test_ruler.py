"""The nasion-rod ruler: found and measured on synthetic cephs with a drawn rod; nothing found where there is none."""
import numpy as np
import pytest
from PIL import Image, ImageDraw

from xray import ruler as R

MM = 0.24        # synthetic cephs: mm per pixel


def ceph(seed=0, scale=1.0):
    from synth import render
    a, pts, facing, _ = render(np.random.default_rng(seed))
    if scale != 1.0:
        a = np.asarray(Image.fromarray(a).resize((round(a.shape[1] * scale), round(a.shape[0] * scale)), Image.BICUBIC))
    return a.astype(np.float64), {k: np.array(v) * scale for k, v in pts.items()}, facing


def add_rod(a, pts, facing, mm_per_px, marks=4, skip=(), spacing_mm=10.0, horizontal=False, jitter=None, seed=0):
    """A nasion rod in front of the forehead: a grey bar with small round radiopaque marks, drawn 4x larger and shrunk
    (smooth edges), plus noise."""
    q = 4
    H, W = a.shape
    sx = 1 if facing == "right" else -1
    px = 1.0 / mm_per_px
    n = pts["N"]
    x = n[0] + sx * 12 * px
    y0 = n[1] - (marks * spacing_mm + 8) * px
    big = Image.new("F", (W * q, H * q), 0.0)
    d = ImageDraw.Draw(big)
    bar = 4.5 * px
    if horizontal:
        d.rectangle([q * (x - 60 * px), q * (y0 - bar / 2), q * (x + 10 * px), q * (y0 + bar / 2)], fill=35.0)
    else:
        d.rectangle([q * (x - bar / 2), q * y0 - q * 4 * px, q * (x + bar / 2), q * (n[1] - 3 * px)], fill=35.0)
    rng = np.random.default_rng(seed)
    r = 0.5 * px
    for k in range(marks):
        if k in skip:
            continue
        off = k * spacing_mm * px + (jitter[k] if jitter is not None else 0.0)
        cx, cy = (x - 50 * px + off, y0) if horizontal else (x - 0.25 * bar, y0 + off)
        d.ellipse([q * (cx - r), q * (cy - r), q * (cx + r), q * (cy + r)], fill=35.0 + 110.0)
    layer = np.asarray(big.resize((W, H), Image.BOX), dtype=np.float64)
    out = np.where(layer > 0, np.maximum(a, 20) + layer, a) + rng.normal(0, 2.0, a.shape)
    return np.clip(out, 0, 255)


@pytest.mark.parametrize("scale", [1.0, 2.5])
def test_ruler_found_and_measured(scale):
    a, pts, facing = ceph(seed=3, scale=scale)
    mm = MM / scale
    img = add_rod(a, pts, facing, mm, marks=5)
    r = R.find_ruler(img)
    assert r is not None and r["n"] == 5
    assert r["mm_per_px"] == pytest.approx(mm, rel=0.005)
    assert r["spacing_px"] == pytest.approx(10.0 / mm, rel=0.005)
    xs = [p[0] for p in r["points"]]
    assert max(xs) - min(xs) < 2.0                                      # one vertical line


def test_one_mark_lost_in_the_middle_is_fine():
    a, pts, facing = ceph(seed=5)
    r = R.find_ruler(add_rod(a, pts, facing, MM, marks=5, skip=(2,)))
    assert r is not None and r["n"] == 4 and r["mm_per_px"] == pytest.approx(MM, rel=0.006)


def test_the_mark_spacing_is_a_setting():
    a, pts, facing = ceph(seed=5)
    r = R.find_ruler(add_rod(a, pts, facing, MM, marks=4), mark_mm=5.0)
    assert r is not None and r["mm_per_px"] == pytest.approx(MM / 2, rel=0.006)


@pytest.mark.parametrize("case", ["no rod", "three marks", "horizontal", "uneven"])
def test_nothing_found_without_a_proper_ruler(case):
    a, pts, facing = ceph(seed=8)
    if case == "no rod":
        img = a
    elif case == "three marks":
        img = add_rod(a, pts, facing, MM, marks=3)
    elif case == "horizontal":
        img = add_rod(a, pts, facing, MM, marks=5, horizontal=True)
    else:
        img = add_rod(a, pts, facing, MM, marks=5, jitter=np.array([0, 9, -7, 11, -10]) * 1.0)
    assert R.find_ruler(img) is None


def test_plain_noise_and_tiny_images():
    rng = np.random.default_rng(1)
    assert R.find_ruler(np.clip(rng.normal(100, 25, (900, 700)), 0, 255)) is None
    assert R.find_ruler(np.zeros((40, 40))) is None


# ----------------------------------------------------------------------------- in the app

@pytest.fixture()
def client(tmp_path, monkeypatch):
    import importlib
    import sys
    from fastapi.testclient import TestClient
    monkeypatch.setenv("NLO_XRAY_DATA", str(tmp_path))
    monkeypatch.setenv("NLO_XRAY_NO_NIGHTLY", "1")
    sys.modules.pop("app.server", None)
    srv = importlib.import_module("app.server")
    with TestClient(srv.app) as c:
        c.srv = srv
        yield c
    sys.modules.pop("app.server", None)


def png(a):
    import io
    b = io.BytesIO()
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(b, format="PNG")
    return b.getvalue()


def test_new_xray_is_calibrated_from_the_ruler(client):
    a, pts, facing = ceph(seed=3)
    r = client.post("/api/cases", files=[("files", ("rod.png", png(add_rod(a, pts, facing, MM, marks=5)), "image/png"))]).json()[0]
    case = r["case"]
    assert case["calibration"]["mm_per_px"] == pytest.approx(MM, rel=0.006)
    assert case["calibration"]["source"].startswith("nasion-rod ruler: 5 marks 10 mm apart")
    assert case["ruler"]["n"] == 5 and case["ruler"]["mark_mm"] == 10.0
    cid = case["id"]
    # traced: S-N in the expected range, no warning
    lm = {k: dict(x=float(v[0]), y=float(v[1]), by="doctor") for k, v in pts.items()}
    got = client.patch(f"/api/cases/{cid}", json={"landmarks": lm}).json()
    assert got["analysis"]["calibration_check"] is None
    # the mark spacing set to 5 mm: the pixel size follows, and S-N is flagged as impossible
    client.put("/api/settings", json={"calibration": {"ruler_mm": 5}})
    got = client.get(f"/api/cases/{cid}").json()
    assert got["case"]["calibration"]["mm_per_px"] == pytest.approx(MM / 2, rel=0.006)
    assert "S-N comes out" in got["analysis"]["calibration_check"]
    client.put("/api/settings", json={"calibration": {"ruler_mm": 10}})
    # a pixel size set by hand stays
    client.patch(f"/api/cases/{cid}", json={"calibration": {"mm_per_px": 0.2, "source": "ruler on this x-ray: 10 mm over 50.0 px"}})
    client.put("/api/settings", json={"calibration": {"ruler_mm": 5}})
    assert client.get(f"/api/cases/{cid}").json()["case"]["calibration"]["mm_per_px"] == 0.2
    # ... unless it makes S-N impossible (the ruler clicked on marks 20 mm apart, say) and the ruler's makes it right
    client.put("/api/settings", json={"calibration": {"ruler_mm": 10}})
    hand = {"mm_per_px": MM / 2, "source": "ruler on this x-ray: 10 mm over 83.3 px"}
    client.patch(f"/api/cases/{cid}", json={"calibration": hand})
    got = client.get(f"/api/cases/{cid}").json()
    cal = got["case"]["calibration"]
    assert cal["mm_per_px"] == pytest.approx(MM, rel=0.006)
    assert "set by hand" in cal["source"] and "made S-N" in cal["source"]
    assert got["analysis"]["calibration_check"] is None
    assert "nasion-rod ruler" in got["case"]["history"][-1]["what"]


def test_an_older_xray_is_checked_when_opened_and_the_switch_works(client):
    a, pts, facing = ceph(seed=5)
    srv = client.srv
    client.put("/api/settings", json={"calibration": {"ruler_auto": False}})
    cid = client.post("/api/cases", files=[("files", ("rod.png", png(add_rod(a, pts, facing, MM)), "image/png"))]).json()[0]["id"]
    case = client.get(f"/api/cases/{cid}").json()["case"]
    assert "ruler" not in case and not case["calibration"].get("mm_per_px")
    client.put("/api/settings", json={"calibration": {"ruler_auto": True}})
    case = client.get(f"/api/cases/{cid}").json()["case"]                 # opened again: looked for now
    assert case["ruler"]["n"] == 4 and case["calibration"]["mm_per_px"] == pytest.approx(MM, rel=0.006)
    assert any("nasion-rod ruler" in h["what"] for h in case["history"])
    assert srv.STORE.get(cid)["ruler"]                                      # and kept
    with pytest.raises(Exception):
        srv._num(0.5, 1.0, 50.0, "ruler mark spacing")
    assert client.put("/api/settings", json={"calibration": {"ruler_mm": 0.5}}).status_code == 400
