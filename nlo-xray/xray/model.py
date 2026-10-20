"""The landmark finder: a small convolutional network trained only on this office's own confirmed tracings.

Design (built to learn from tens, not thousands, of x-rays, and to train on an ordinary office PC's CPU):
  - every x-ray is turned to face right and fitted into a 512 x 512 square (about 0.5 mm per pixel);
  - a U-Net looks at local appearance and scores, per landmark, every cell of a 256 x 256 grid
    (about 1 mm a cell; the position is refined to a fraction of a cell afterwards);
  - a "spatial configuration" branch works on a coarse copy of those scores and learns where the
    landmarks sit relative to each other (Payer et al. 2019), so an A point is not found on the chin;
  - the two are added and turned into a probability map per landmark (softmax over the image); the
    landmark is the peak, refined by the probability-weighted mean around it;
  - confidence = how much of the probability lies within ~4 mm of the peak.

No pre-trained weights and no downloads: the network starts from scratch on this PC.
"""
import math

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

INPUT = 512        # input square, pixels
STRIDE = 2         # output grid = INPUT / STRIDE
SC_DOWN = 8        # spatial-configuration branch works at output / SC_DOWN
SIGMA = 1.5        # target spread, output cells


def _gn(c):
    return nn.GroupNorm(max(1, min(8, c // 4)), c)


def conv_block(cin, cout):
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1, bias=False), _gn(cout), nn.LeakyReLU(0.1, inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False), _gn(cout), nn.LeakyReLU(0.1, inplace=True),
    )


class CephNet(nn.Module):
    def __init__(self, n_landmarks, ch=(16, 32, 48, 64, 96), sc_ch=64, sc_down=SC_DOWN):
        super().__init__()
        self.n = n_landmarks
        self.sc_down = sc_down
        self.stem = nn.Sequential(nn.Conv2d(1, ch[0], 5, stride=STRIDE, padding=2, bias=False), _gn(ch[0]),
                                  nn.LeakyReLU(0.1, inplace=True))
        self.enc = nn.ModuleList()
        cin = ch[0]
        for c in ch:
            self.enc.append(conv_block(cin, c))
            cin = c
        self.dec = nn.ModuleList()
        for i in range(len(ch) - 1, 0, -1):
            self.dec.append(conv_block(ch[i] + ch[i - 1], ch[i - 1]))
        self.local = nn.Conv2d(ch[0], n_landmarks, 1)
        k = 7
        self.sc = nn.Sequential(
            nn.Conv2d(n_landmarks, sc_ch, k, padding=k // 2), nn.LeakyReLU(0.1, inplace=True),
            nn.Conv2d(sc_ch, sc_ch, k, padding=k // 2), nn.LeakyReLU(0.1, inplace=True),
            nn.Conv2d(sc_ch, sc_ch, k, padding=k // 2), nn.LeakyReLU(0.1, inplace=True),
            nn.Conv2d(sc_ch, n_landmarks, k, padding=k // 2),
        )

    def forward(self, x):
        x = self.stem(x)
        skips = []
        for i, blk in enumerate(self.enc):
            if i:
                x = F.max_pool2d(x, 2)
            x = blk(x)
            skips.append(x)
        x = skips[-1]
        for j, blk in enumerate(self.dec):
            skip = skips[-2 - j]
            x = F.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
            x = blk(torch.cat([x, skip], 1))
        local = self.local(x)
        h, w = local.shape[-2:]
        small = F.avg_pool2d(local, self.sc_down)
        sc = F.interpolate(self.sc(small), size=(h, w), mode="bilinear", align_corners=False)
        return local + sc


# ------------------------------------------------------------------------------------------ geometry

def prep(img_u8, facing, size=INPUT):
    """uint8 image -> (float32 canvas size x size in [0,1], info). Face turned to the right."""
    a = img_u8[:, ::-1] if facing == "left" else img_u8
    h, w = a.shape
    s = size / float(max(h, w))
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    im = Image.fromarray(np.ascontiguousarray(a)).resize((nw, nh), Image.BILINEAR)
    canvas = np.zeros((size, size), np.float32)
    canvas[:nh, :nw] = np.asarray(im, np.float32) / 255.0
    return canvas, dict(scale=s, flip=facing == "left", w=w, h=h, size=size, out=size // STRIDE)


def to_model(pt, info):
    """Image pixel -> output-grid cell coordinates."""
    x, y = float(pt[0]), float(pt[1])
    if info["flip"]:
        x = info["w"] - 1 - x
    s = info["scale"] / STRIDE
    return ((x + 0.5) * s - 0.5, (y + 0.5) * s - 0.5)


def from_model(pt, info):
    s = info["scale"] / STRIDE
    x = (pt[0] + 0.5) / s - 0.5
    y = (pt[1] + 0.5) / s - 0.5
    if info["flip"]:
        x = info["w"] - 1 - x
    return (float(x), float(y))


def normalize(t):
    return (t - 0.5) / 0.25


# ------------------------------------------------------------------------------------------ loss

def heat_loss(logits, xy, present, sigma=SIGMA):
    """Cross-entropy between each landmark's softmax over the grid and a Gaussian around the truth.

    logits (B,N,H,W); xy (B,N,2) in output cells; present (B,N) 1/0."""
    B, N, H, W = logits.shape
    logp = F.log_softmax(logits.reshape(B, N, H * W), dim=-1).reshape(B, N, H, W)
    xs = torch.arange(W, dtype=logits.dtype, device=logits.device)
    ys = torch.arange(H, dtype=logits.dtype, device=logits.device)
    gx = torch.exp(-((xs[None, None, :] - xy[..., 0:1]) ** 2) / (2 * sigma ** 2))       # B,N,W
    gy = torch.exp(-((ys[None, None, :] - xy[..., 1:2]) ** 2) / (2 * sigma ** 2))       # B,N,H
    gx = gx / gx.sum(-1, keepdim=True).clamp_min(1e-12)
    gy = gy / gy.sum(-1, keepdim=True).clamp_min(1e-12)
    # sum_y sum_x gy(y) gx(x) logp(y,x)  (separable target, no full target tensor needed)
    ce = -torch.einsum("bnh,bnhw,bnw->bn", gy, logp, gx)
    w = present.to(ce.dtype)
    return (ce * w).sum() / w.sum().clamp_min(1.0)


# ------------------------------------------------------------------------------------------ decoding

def decode(logits, r_refine=2, r_conf=4):
    """logits (N,H,W) -> (N,2) output-cell coords (x, y), (N,) confidence."""
    N, H, W = logits.shape
    p = F.softmax(logits.reshape(N, -1), dim=-1).reshape(N, H, W)
    idx = p.reshape(N, -1).argmax(-1)
    yi, xi = (idx // W).tolist(), (idx % W).tolist()
    out = np.zeros((N, 2), np.float64)
    conf = np.zeros(N, np.float64)
    pn = p.detach().cpu().numpy()
    for k in range(N):
        y0, y1 = max(0, yi[k] - r_refine), min(H, yi[k] + r_refine + 1)
        x0, x1 = max(0, xi[k] - r_refine), min(W, xi[k] + r_refine + 1)
        win = pn[k, y0:y1, x0:x1]
        tot = win.sum()
        if tot > 0:
            yy, xx = np.mgrid[y0:y1, x0:x1]
            out[k] = ((win * xx).sum() / tot, (win * yy).sum() / tot)
        else:
            out[k] = (xi[k], yi[k])
        cy0, cy1 = max(0, yi[k] - r_conf), min(H, yi[k] + r_conf + 1)
        cx0, cx1 = max(0, xi[k] - r_conf), min(W, xi[k] + r_conf + 1)
        conf[k] = float(pn[k, cy0:cy1, cx0:cx1].sum())
    return out, conf


# ------------------------------------------------------------------------------------------ the finder

class Finder:
    """A trained network with its landmark list."""

    def __init__(self, ckpt):
        self.ckpt = ckpt
        self.codes = list(ckpt["codes"])
        self.size = int(ckpt.get("input", INPUT))
        self.usable = set(ckpt.get("usable") or self.codes)
        self.net = CephNet(len(self.codes), **(ckpt.get("arch") or {}))
        self.net.load_state_dict(ckpt["state"])
        self.net.eval()

    @classmethod
    def load(cls, path):
        ckpt = torch.load(path, map_location="cpu", weights_only=False)
        return cls(ckpt)

    @torch.no_grad()
    def _run(self, img_u8, facing):
        canvas, info = prep(img_u8, facing, self.size)
        x = normalize(torch.from_numpy(canvas))[None, None]
        logits = self.net(x)[0]
        xy, conf = decode(logits)
        pts = {c: from_model(xy[i], info) for i, c in enumerate(self.codes)}
        return pts, {c: float(conf[i]) for i, c in enumerate(self.codes)}

    def predict(self, img_u8, facing=None):
        """Landmarks in image pixels. Without a facing, both are tried and the surer one kept."""
        if facing in ("left", "right"):
            pts, conf = self._run(img_u8, facing)
        else:
            best = None
            for f in ("right", "left"):
                pts, conf = self._run(img_u8, f)
                core = [conf[c] for c in ("S", "N", "A", "B", "Me", "Go") if c in conf]
                score = float(np.mean(core)) if core else float(np.mean(list(conf.values())))
                # the predicted S-N must also agree with the facing that was assumed
                if "S" in pts and "N" in pts and ((pts["N"][0] >= pts["S"][0]) != (f == "right")):
                    score -= 1.0
                if best is None or score > best[0]:
                    best = (score, f, pts, conf)
            _, facing, pts, conf = best
        out = {c: dict(x=pts[c][0], y=pts[c][1], conf=round(conf[c], 3)) for c in self.codes if c in self.usable}
        return out, facing


def count_params(net):
    return sum(p.numel() for p in net.parameters())


def augment_batch(imgs, xy, rng, out_size, rot=8.0, scale=(0.9, 1.1), shift=0.05):
    """Random rotation/scale/shift (same for the image and its points) and grey-level changes.

    imgs (B,1,S,S) float in [0,1]; xy (B,N,2) output cells (grid of out_size). Returns new tensors."""
    B = imgs.shape[0]
    thetas, mats = [], []
    for _ in range(B):
        a = math.radians(rng.uniform(-rot, rot))
        s = rng.uniform(*scale)
        tx, ty = rng.uniform(-shift, shift) * 2, rng.uniform(-shift, shift) * 2      # normalised units
        M = np.array([[s * math.cos(a), -s * math.sin(a)], [s * math.sin(a), s * math.cos(a)]])
        c = np.array([tx, ty])
        Minv = np.linalg.inv(M)
        thetas.append(np.hstack([Minv, (-Minv @ c)[:, None]]))
        mats.append((M, c))
    theta = torch.tensor(np.stack(thetas), dtype=imgs.dtype)
    grid = F.affine_grid(theta, list(imgs.shape), align_corners=False)
    out = F.grid_sample(imgs, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
    xy_n = (2 * xy + 1) / out_size - 1                                  # cells -> normalised
    new = torch.empty_like(xy)
    for b, (M, c) in enumerate(mats):
        q = xy_n[b] @ torch.tensor(M, dtype=xy.dtype).T + torch.tensor(c, dtype=xy.dtype)
        new[b] = ((q + 1) * out_size - 1) / 2
    for b in range(B):                                                  # grey levels
        g = rng.uniform(0.7, 1.5)
        ctr = rng.uniform(0.75, 1.3)
        br = rng.uniform(-0.1, 0.1)
        o = out[b].clamp(0, 1) ** g
        o = (o - 0.5) * ctr + 0.5 + br
        if rng.random() < 0.5:
            o = o + torch.randn_like(o) * rng.uniform(0.0, 0.03)
        out[b] = o.clamp(0, 1)
    return out, new
