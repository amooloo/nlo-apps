"""The clasp drawings (buccal and occlusal views, side by side) and the lower Schwarz picture for the Retainer and Functional Rx.
Amir, 4 Oct 2026: "I have the clasps that I like to use … delta and arrowhead needs to be written out along with location and a
new type of drawing" — first drawn for the NLO Lab Rx page, now in the tracker's cards (each clasp's card shows its drawing under
its photo; the Schwarz card shows the arch).

    python3 tools/rxdraw.py        writes src/rxdraw.js
"""
import bisect
import math

TOOTH = 'fill="#F8F5EE" stroke="#B3AC9C" stroke-width="1"'
GUM = 'fill="#EDB3B1" stroke="#D88A8A" stroke-width="1"'
WIRE = 'fill="none" stroke="#45443F" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'
HL = 'fill="#EF9F27" fill-opacity="0.45"'
HLBAND = 'fill="none" stroke="#EF9F27" stroke-opacity="0.45" stroke-width="10" stroke-linecap="round"'
ACRYLIC = '<path d="M 0 0 H 200 V 22 C 160 28 130 20 100 24 C 70 28 40 20 0 24 Z" fill="#ED93B1" fill-opacity="0.45"/>'
FRAME = "#ECEAE4"


def teeth(*paths):
    return "".join(
        f'<ellipse cx="{p[1]}" cy="{p[2]}" rx="{p[3]}" ry="{p[4]}" {TOOTH}/>' if isinstance(p, tuple) else f'<path d="{p}" {TOOTH}/>'
        for p in paths
    )


def gum(d):
    return f'<path d="{d}" {GUM}/>'


def wire(*ds):
    return "".join(f'<path d="{d}" {WIRE}/>' for d in ds)


def dots(*pts, r=7):
    return "".join(f'<circle cx="{x}" cy="{y}" r="{r}" {HL}/>' for x, y in pts)


def ball(x, y):
    return f'<circle cx="{x}" cy="{y}" r="5.5" fill="#45443F"/>'


def pair(key, title, buccal, occlusal):
    return (
        f'<svg class="clasp-drawing" viewBox="0 0 420 174" role="img" aria-label="{title}, buccal and occlusal views">'
        f'<defs><clipPath id="clip-{key}-b"><rect width="200" height="150" rx="8"/></clipPath>'
        f'<clipPath id="clip-{key}-o"><rect width="200" height="140" rx="8"/></clipPath></defs>'
        f'<rect width="200" height="150" rx="8" fill="{FRAME}"/><g clip-path="url(#clip-{key}-b)">{buccal}</g>'
        f'<g transform="translate(220,5)"><rect width="200" height="140" rx="8" fill="{FRAME}"/>'
        f'<g clip-path="url(#clip-{key}-o)">{occlusal}</g></g>'
        f'<text x="100" y="169" text-anchor="middle" class="dlabel">Buccal</text>'
        f'<text x="320" y="169" text-anchor="middle" class="dlabel">Occlusal, acrylic side up</text></svg>'
    )


# Shared tooth outlines ---------------------------------------------------
B_PREMOLAR = "M -10 150 C -12 110 -14 70 -8 50 Q 6 32 22 22 Q 40 32 52 44 Q 55 46 55 50 C 57 74 50 110 46 150 Z"
B_MOLAR = "M 69 150 C 64 110 53 72 55 50 Q 56 42 58 40 Q 70 20 100 37 Q 130 20 142 42 Q 144 44 145 50 C 147 72 136 110 131 150 Z"
B_MOLAR2 = "M 154 150 C 150 110 143 72 145 50 Q 146 44 150 41 Q 162 22 186 36 Q 200 24 214 34 L 214 150 Z"
B_GUM3 = "M 0 90 C 20 98 46 94 55 70 C 62 88 78 96 100 96 C 122 96 138 88 145 70 C 154 94 180 98 200 90 L 200 150 L 0 150 Z"
O_PREMOLAR = ("e", 25, 76, 32, 38)
O_MOLAR = "M 64 34 Q 100 28 136 34 Q 144 38 143 54 Q 144 76 143 98 Q 144 118 132 120 Q 100 126 68 120 Q 56 118 57 98 Q 56 76 57 54 Q 56 38 64 34 Z"
O_MOLAR2 = "M 147 34 Q 190 28 236 34 L 236 120 Q 190 126 151 120 Q 143 118 144 98 Q 143 76 144 54 Q 143 38 147 34 Z"
ADAMS_OCC = "M 44 8 Q 50 4 54 10 L 57 30 L 57 104 Q 58 114 63 120 L 70 130 L 130 130 L 137 120 Q 142 114 143 104 L 143 30 L 146 10 Q 150 4 156 8"


def adams():
    b = teeth(B_PREMOLAR, B_MOLAR, B_MOLAR2) + gum(B_GUM3) + dots((67, 80), (133, 80)) + wire(
        "M 50 32 Q 58 38 62 48 L 63 76 Q 63 82 67 82 Q 71 82 71 76 L 71 56 L 129 56 L 129 76 Q 129 82 133 82 Q 137 82 137 76 L 138 48 Q 142 38 150 32"
    )
    o = teeth(O_PREMOLAR, O_MOLAR, O_MOLAR2) + dots((65, 122), (135, 122)) + wire(ADAMS_OCC) + ACRYLIC
    return pair("adams", "Adams clasp", b, o)


def delta():
    b = teeth(B_PREMOLAR, B_MOLAR, B_MOLAR2) + gum(B_GUM3) + dots((70, 76), (130, 76)) + wire(
        "M 50 32 Q 60 40 70 52 L 63.5 75 Q 62.5 78 65.5 78 L 74.5 78 Q 77.5 78 76.5 75 L 70 52 "
        "L 130 52 L 123.5 75 Q 122.5 78 125.5 78 L 134.5 78 Q 137.5 78 136.5 75 L 130 52 Q 140 40 150 32"
    )
    o = teeth(O_PREMOLAR, O_MOLAR, O_MOLAR2) + dots((65, 122), (135, 122)) + wire(
        ADAMS_OCC, "M 62 118 L 71 130 L 57 128 Z", "M 138 118 L 129 130 L 143 128 Z"
    ) + ACRYLIC
    return pair("delta", "Delta clasp", b, o)


def ball_clasp():
    b = teeth(
        "M 30 150 C 34 110 42 72 41 50 Q 40 42 34 38 Q 22 28 8 24 Q -6 28 -16 40 L -16 150 Z",
        "M 52 150 C 48 110 38 72 41 50 Q 42 40 48 36 Q 58 26 70 21 Q 84 26 94 38 Q 99 44 100 50 C 102 72 94 110 88 150 Z",
        "M 112 150 C 108 110 98 72 100 50 Q 101 42 103 40 Q 115 20 145 37 Q 175 20 187 42 Q 189 44 190 50 C 192 72 181 110 175 150 Z",
        "M 199 150 C 195 110 188 72 190 50 Q 192 44 196 42 Q 205 30 220 34 L 220 150 Z",
    ) + gum(
        "M 0 88 C 14 92 34 92 41 70 C 46 86 58 94 70 94 C 82 94 94 86 100 70 C 106 88 122 96 145 96 "
        "C 168 96 184 88 190 70 C 194 84 198 88 200 88 L 200 150 L 0 150 Z"
    ) + dots((100, 62), r=10) + wire("M 100 30 L 100 57") + ball(100, 62)
    o = teeth(
        ("e", 9, 76, 30, 38),
        ("e", 70, 76, 30, 38),
        "M 104 34 Q 142 28 180 34 Q 188 38 187 54 Q 188 76 187 98 Q 188 118 176 120 Q 142 126 114 120 Q 102 116 101 98 Q 100 76 101 54 Q 100 38 104 34 Z",
        "M 191 34 Q 230 30 250 34 L 250 120 Q 230 124 195 120 Q 187 118 188 98 Q 187 76 188 54 Q 187 38 191 34 Z",
    ) + dots((100, 104), r=10) + wire("M 90 8 Q 96 4 98 10 L 100 30 L 100 98") + ball(100, 104) + ACRYLIC
    return pair("ball", "Ball clasp", b, o)


def c_clasp():
    b = teeth(
        "M 46 150 C 50 110 57 72 55 50 Q 54 44 50 41 Q 38 22 14 36 Q 0 24 -14 34 L -14 150 Z", B_MOLAR
    ) + gum(
        "M 0 90 C 20 98 46 94 55 70 C 62 88 78 96 100 96 C 122 96 138 90 146 80 C 154 72 180 78 200 86 L 200 150 L 0 150 Z"
    ) + f'<path d="M 70 82 Q 100 93 134 80" {HLBAND}/>' + wire(
        "M 50 32 Q 58 38 61 48 L 63 70 Q 65 82 80 86 Q 100 90 120 86 Q 136 82 142 72 Q 146 66 146 60"
    )
    o = teeth(
        "M 53 34 Q 10 28 -36 34 L -36 120 Q 10 126 49 120 Q 57 118 56 98 Q 57 76 56 54 Q 57 38 53 34 Z", O_MOLAR
    ) + f'<path d="M 72 127 Q 100 133 128 127" {HLBAND}/>' + wire(
        "M 44 8 Q 50 4 54 10 L 57 30 L 57 104 Q 58 120 70 125 Q 100 132 130 125 Q 146 120 148 100 L 148 76 Q 148 66 146 60"
    ) + ACRYLIC
    return pair("cclasp", "C-clasp", b, o)


def arrowhead():
    b = teeth(
        "M 32 150 C 36 110 42 72 40 50 Q 39 42 35 39 Q 22 24 4 30 Q -8 26 -20 36 L -20 150 Z",
        "M 47 150 C 44 110 38 72 40 50 Q 41 43 45 40 Q 54 26 66 33 Q 78 24 92 37 Q 99 43 100 50 C 102 72 96 110 93 150 Z",
        "M 107 150 C 104 110 98 72 100 50 Q 101 43 104 40 Q 116 24 134 34 Q 152 24 166 40 Q 169 44 170 50 C 172 72 165 110 162 150 Z",
        "M 178 150 C 174 110 168 72 170 50 Q 171 43 175 40 Q 188 24 206 34 L 220 34 L 220 150 Z",
    ) + gum(
        "M 0 88 C 20 92 34 90 40 70 C 46 86 58 94 70 94 C 82 94 94 86 100 70 C 106 88 118 96 135 96 "
        "C 152 96 164 88 170 70 C 176 86 190 92 200 90 L 200 150 L 0 150 Z"
    ) + dots((40, 63), (100, 63), (170, 63), r=8) + wire(
        "M 34 30 Q 40 36 40 46 L 40 55 L 34 63 L 40 71 L 46 63 L 40 55 L 100 55 L 94 63 L 100 71 L 106 63 L 100 55 "
        "L 170 55 L 164 63 L 170 71 L 176 63 L 170 55 L 170 46 Q 170 36 176 30"
    )
    o = teeth(("e", 10, 76, 30, 38), ("e", 70, 76, 30, 38), ("e", 135, 77, 35, 41), ("e", 210, 77, 40, 42)) + dots(
        (40, 108), (100, 108), (170, 108)
    ) + wire(
        "M 30 8 Q 36 4 38 10 L 40 30 L 40 100",
        "M 40 100 L 35 108 L 40 116 L 45 108 Z",
        "M 100 100 L 95 108 L 100 116 L 105 108 Z",
        "M 170 100 L 165 108 L 170 116 L 175 108 Z",
        "M 40 116 Q 70 126 100 116",
        "M 100 116 Q 135 132 170 116",
        "M 170 100 L 170 30 L 172 10 Q 174 4 180 8",
    ) + ACRYLIC
    return pair("arrowhead", "Arrowhead (Schwarz) clasp", b, o)


def schwarz_arch():
    """Occlusal schematic of a lower Schwarz: mixed-dentition arch, lingual horseshoe, midline screw,
    delta clasps on the 6s and ball clasps at the D-E contacts."""
    cx, y0, xmax, ytop = 150.0, 168.0, 104.0, 44.0
    k = (y0 - ytop) / xmax**2
    f = lambda xp: y0 - k * xp * xp
    fp = lambda xp: -2 * k * xp
    n_steps = 4000
    xs = [xmax * i / n_steps for i in range(n_steps + 1)]
    arc = [0.0]
    for i in range(1, n_steps + 1):
        arc.append(arc[-1] + math.hypot(xs[i] - xs[i - 1], f(xs[i]) - f(xs[i - 1])))
    length = arc[-1]

    def xp_at(s):
        return xs[min(bisect.bisect_left(arc, s), n_steps)]

    def frame(s, side):
        xp = xp_at(s)
        p = (cx + side * xp, f(xp))
        tx, ty = side * 1.0, fp(xp)
        tn = math.hypot(tx, ty)
        t = (tx / tn, ty / tn)
        nx, ny = side * fp(xp), -1.0  # inward (lingual) normal
        nn = math.hypot(nx, ny)
        return p, t, (nx / nn, ny / nn)

    def off(p, v, d, t=None, a=0.0):
        x, y = p[0] + v[0] * d, p[1] + v[1] * d
        if t:
            x, y = x + t[0] * a, y + t[1] * a
        return f"{x:.1f} {y:.1f}"

    kinds = [("A", 5.0, 5.2), ("B", 5.6, 5.6), ("C", 6.0, 6.6), ("D", 7.8, 8.0), ("E", 9.6, 9.2), ("6", 11.0, 10.4)]
    gap = 0.8
    scale = (length - gap) / sum(w for _, w, _ in kinds)

    out = ['<svg class="arch" viewBox="0 0 300 200" role="img" aria-label="Lower Schwarz, occlusal view: lingual acrylic, '
           'midline screw, delta clasps on the first molars, ball clasps at the D-E contacts">',
           '<rect width="300" height="200" fill="#FFFFFF"/>']

    # acrylic horseshoe, drawn first so the teeth sit on top of it
    outer, inner = [], []
    for side in (-1, 1):
        rng = range(n_steps, -1, -40) if side == -1 else range(0, n_steps + 1, 40)
        for i in rng:
            p, t, n = frame(arc[i], side)
            outer.append(off(p, n, 3))
            inner.append(off(p, n, 30))
    out.append(f'<path d="M {" L ".join(outer)} L {" L ".join(reversed(inner))} Z" fill="#ED93B1" fill-opacity="0.6" '
               'stroke="#D96A93" stroke-width="0.8"/>')

    # teeth
    cum = 0.0
    contacts = {}
    for name, w, bl in kinds:
        s_mid = gap + scale * (cum + w / 2)
        for side in (-1, 1):
            p, t, n = frame(s_mid, side)
            ang = math.degrees(math.atan2(t[1], t[0]))
            out.append(f'<ellipse cx="{p[0]:.1f}" cy="{p[1]:.1f}" rx="{scale * w / 2 - 0.6:.1f}" ry="{scale * bl / 2:.1f}" '
                       f'transform="rotate({ang:.1f} {p[0]:.1f} {p[1]:.1f})" fill="#F8F5EE" stroke="#B3AC9C" stroke-width="0.9"/>')
        cum += w
        contacts[name] = gap + scale * cum  # distal contact of this tooth

    # midline split and screw
    out.append('<path d="M 150 138 V 143 M 150 152 V 157" stroke="#9E2E5A" stroke-width="1.2"/>')
    out.append('<rect x="139" y="143" width="22" height="9" rx="2" fill="#D5D9DE" stroke="#69727C" stroke-width="0.9"/>'
               '<path d="M 150 143 V 152" stroke="#69727C" stroke-width="0.9"/>')

    w6, bl6 = 11.0 * scale, 10.4 * scale / 2
    s6a, s6b = contacts["E"], contacts["6"]
    wire_d, tris, balls = [], [], []
    for side in (-1, 1):
        pa, ta, na = frame(s6a, side)
        pm, tm, nm = frame((s6a + s6b) / 2, side)
        pb, tb, nb = frame(s6b - 1.5, side)
        pe, te, ne = frame(s6b, side)
        wire_d.append(
            f"M {off(pa, na, 20)} L {off(pa, na, -(bl6 + 2))} "
            f"Q {off(pm, nm, -(bl6 + 6))} {off(pb, nb, -(bl6 + 2))} "
            f"Q {off(pe, ne, 0, te, 9)} {off(pe, ne, 19, te, 2)}"
        )
        for s_corner in (s6a + 0.2 * w6, s6b - 0.2 * w6):
            pc, tc, nc = frame(s_corner, side)
            tris.append(f"M {off(pc, nc, -(bl6 - 2.5))} L {off(pc, nc, -(bl6 + 3), tc, 3)} L {off(pc, nc, -(bl6 + 3), tc, -3)} Z")
        pd, td, nd = frame(contacts["D"], side)
        bl_de = scale * 8.6 / 2
        wire_d.append(f"M {off(pd, nd, 16)} L {off(pd, nd, -(bl_de + 2))}")
        x, y = off(pd, nd, -(bl_de + 2)).split()
        balls.append(f'<circle cx="{x}" cy="{y}" r="2.8" fill="#45443F"/>')
    out.append(f'<path d="{" ".join(wire_d)}" fill="none" stroke="#45443F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')
    out.append(f'<path d="{" ".join(tris)}" fill="none" stroke="#45443F" stroke-width="1.3" stroke-linejoin="round"/>')
    out.extend(balls)
    out.append("</svg>")
    return "".join(out)


CLASP_DRAWINGS = {
    "delta": delta,
    "ball": ball_clasp,
    "adams": adams,
    "arrowhead": arrowhead,
    "c": c_clasp,
}


def main():
    import json
    root = pathlib.Path(__file__).resolve().parent.parent
    draw = {k: fn() for k, fn in CLASP_DRAWINGS.items()}
    js = ("/* the clasp drawings (buccal and occlusal views) and the lower Schwarz picture for the Retainer and Functional Rx (Amir, 4 Oct 2026);\n"
          "   generated by tools/rxdraw.py, do not edit by hand */\n"
          "const RX_CLASP_DRAW = " + json.dumps(draw, separators=(",", ":")) + ";\n"
          "const RX_SCHWARZ_PIC = " + json.dumps(schwarz_arch()) + ";\n")
    (root / "src" / "rxdraw.js").write_text(js)
    print("wrote src/rxdraw.js", len(js), "bytes")


if __name__ == "__main__":
    import pathlib
    main()
