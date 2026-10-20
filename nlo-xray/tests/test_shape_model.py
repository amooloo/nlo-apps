"""The average tracing (anchors -> all points) and the network's geometry helpers."""
import random

import numpy as np
import pytest
import torch

from xray import model as M
from xray.landmarks import CODES, TEMPLATE
from xray.shape import fill_missing, mean_shape, place_from_anchors


def to_px(shape, facing="right", mm=0.1, ox=600, oy=400):
    return {k: ((v[0] if facing == "right" else -v[0]) / mm + ox, -v[1] / mm + oy) for k, v in shape.items()}


@pytest.mark.parametrize("facing", ["right", "left"])
def test_anchors_reproduce_the_template(facing):
    px = to_px(TEMPLATE, facing)
    got = place_from_anchors({c: px[c] for c in ("S", "N", "Me")})
    for c in CODES:
        assert got[c][0] == pytest.approx(px[c][0], abs=1e-6)
        assert got[c][1] == pytest.approx(px[c][1], abs=1e-6)


def test_mean_shape_follows_the_doctor():
    rng = np.random.default_rng(1)
    tracings = []
    for _ in range(6):
        sh = {k: np.array(v) + rng.normal(0, 0.3, 2) for k, v in TEMPLATE.items()}
        sh["A"] = sh["A"] + [3.0, 0]            # this doctor puts A 3 mm further forward than the textbook
        tracings.append((to_px(sh, "left" if rng.random() < 0.5 else "right"), None, None))
    shape, n = mean_shape(tracings)
    assert n == 6
    assert shape["A"][0] - TEMPLATE["A"][0] == pytest.approx(3.0, abs=0.6)
    assert abs(shape["N"][0] - TEMPLATE["N"][0]) < 0.6


def test_fill_missing_from_known_points():
    px = to_px(TEMPLATE)
    known = {c: px[c] for c in ("S", "N", "Me", "Go", "A", "B")}
    got = fill_missing(known, ["C3d", "Pos"])
    assert got["C3d"] == pytest.approx(px["C3d"], abs=1e-6)
    assert fill_missing({"S": px["S"]}, ["N"]) == {}


@pytest.mark.parametrize("facing", ["right", "left"])
def test_model_coordinates_round_trip(facing):
    img = np.zeros((900, 1200), np.uint8)
    canvas, info = M.prep(img, facing)
    assert canvas.shape == (M.INPUT, M.INPUT)
    for pt in [(0, 0), (1199, 899), (321.5, 654.25)]:
        back = M.from_model(M.to_model(pt, info), info)
        assert back[0] == pytest.approx(pt[0], abs=1e-6) and back[1] == pytest.approx(pt[1], abs=1e-6)


def test_decode_finds_a_peak_to_subpixel():
    H = W = 64
    yy, xx = np.mgrid[0:H, 0:W]
    logits = torch.from_numpy(-((xx - 20.3) ** 2 + (yy - 40.7) ** 2) / 2.0).float()[None]
    xy, conf = M.decode(logits)
    assert xy[0, 0] == pytest.approx(20.3, abs=0.15) and xy[0, 1] == pytest.approx(40.7, abs=0.15)
    assert conf[0] > 0.9


def test_augment_moves_points_with_the_image():
    out = M.INPUT // M.STRIDE
    img = torch.zeros(1, 1, M.INPUT, M.INPUT)
    cx, cy = 300, 180                       # a bright dot in input pixels
    img[0, 0, cy - 3:cy + 4, cx - 3:cx + 4] = 1.0
    cell = ((cx + 0.5) / M.STRIDE - 0.5, (cy + 0.5) / M.STRIDE - 0.5)
    xy = torch.tensor([[cell]], dtype=torch.float32)
    rng = random.Random(4)
    for _ in range(5):
        a, b = M.augment_batch(img.clone(), xy.clone(), rng, out)
        # where is the dot now (input pixels)? compare with the moved point
        m = a[0, 0]
        ys, xs = torch.nonzero(m > m.max() * 0.6, as_tuple=True)
        got = (float(xs.float().mean()), float(ys.float().mean()))
        want = ((b[0, 0, 0] + 0.5) * M.STRIDE - 0.5, (b[0, 0, 1] + 0.5) * M.STRIDE - 0.5)
        assert abs(got[0] - float(want[0])) < 2.0 and abs(got[1] - float(want[1])) < 2.0


def test_network_shapes_and_loss_falls():
    torch.manual_seed(0)
    net = M.CephNet(3)
    x = torch.randn(2, 1, M.INPUT, M.INPUT)
    out = net(x)
    assert out.shape == (2, 3, M.INPUT // M.STRIDE, M.INPUT // M.STRIDE)
    xy = torch.tensor([[[30.0, 40.0], [100.0, 120.0], [200.0, 60.0]]] * 2)
    pres = torch.tensor([[1.0, 1.0, 0.0]] * 2)
    opt = torch.optim.Adam(net.parameters(), 3e-3)
    first = None
    for _ in range(8):
        loss = M.heat_loss(net(x), xy, pres)
        first = first if first is not None else loss.item()
        opt.zero_grad()
        loss.backward()
        opt.step()
    assert loss.item() < first
