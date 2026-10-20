"""The cephalometric landmarks the app traces, in the order the guided tracing walks them.

Each landmark has a short code (used in case files and the model), a name, the group it belongs to and
the definition shown to whoever is tracing. TEMPLATE gives every landmark a starting position for an
average adolescent, in millimetres, in the app's canonical frame:

    origin at sella, X = anterior (the face looks toward +X), Y = superior, Frankfort horizontal level.

The template only seeds the first tracings (click S, N and Me, everything else lands roughly in place
and is dragged to where it belongs). Once there are confirmed tracings the mean of those replaces it.
"""

GROUPS = [
    ("cranial", "Cranial base"),
    ("maxilla", "Maxilla"),
    ("mandible", "Mandible"),
    ("teeth", "Teeth"),
    ("soft", "Soft tissue"),
    ("cvm", "Vertebrae (CVM)"),
]

# code, name, group, definition
_DEFS = [
    ("S", "Sella", "cranial",
     "Centre of the sella turcica (the pituitary fossa): the middle of its rounded outline."),
    ("N", "Nasion", "cranial",
     "Most anterior point of the frontonasal suture, where the nasal bones meet the frontal bone."),
    ("Or", "Orbitale", "cranial",
     "Lowest point on the lower rim of the orbit. If the two orbits show separately, go midway between them."),
    ("Po", "Porion", "cranial",
     "Top of the external auditory meatus (anatomic porion). If left and right show separately, go midway."),
    ("Ar", "Articulare", "cranial",
     "Where the back edge of the ramus (condylar process) crosses the lower outline of the cranial base."),
    ("PNS", "Posterior nasal spine", "maxilla",
     "Tip of the posterior nasal spine: the back end of the hard palate."),
    ("ANS", "Anterior nasal spine", "maxilla",
     "Tip of the anterior nasal spine."),
    ("A", "A point (subspinale)", "maxilla",
     "Deepest point of the front curve of the maxilla, between ANS and the alveolar crest over the upper incisors."),
    ("U1A", "Upper incisor apex", "teeth",
     "Root apex of the most prominent upper central incisor."),
    ("U1T", "Upper incisor tip", "teeth",
     "Incisal tip of the same upper central incisor."),
    ("L1T", "Lower incisor tip", "teeth",
     "Incisal tip of the most prominent lower central incisor."),
    ("L1A", "Lower incisor apex", "teeth",
     "Root apex of the same lower incisor."),
    ("B", "B point (supramentale)", "mandible",
     "Deepest point of the front curve of the mandible, between the alveolar crest under the lower incisors and pogonion."),
    ("Pog", "Pogonion", "mandible",
     "Most anterior point of the bony chin."),
    ("Gn", "Gnathion", "mandible",
     "Point on the chin outline midway between pogonion and menton (the most anterior-inferior point)."),
    ("Me", "Menton", "mandible",
     "Lowest point on the outline of the symphysis."),
    ("Go", "Gonion", "mandible",
     "The angle of the mandible: where the bisector of the angle between the ramus and the lower border meets "
     "the outline. If the two angles show separately, go midway."),
    ("MPt", "Lower border point", "mandible",
     "Where a line from menton just touches the lower border of the mandible, in front of the angle: the back "
     "end of the mandibular plane used for FMA and IMPA (Tweed, Downs)."),
    ("MOL", "Molar contact", "teeth",
     "Where the mesial cusps of the upper and lower first molars meet: the back end of the functional occlusal plane."),
    ("PM", "Premolar contact", "teeth",
     "Where the first premolars (or first primary molars) meet: the front end of the functional occlusal plane."),
    ("Prn", "Pronasale", "soft",
     "Most anterior point of the tip of the nose."),
    ("Sn", "Subnasale", "soft",
     "Where the columella of the nose meets the upper lip."),
    ("Ls", "Upper lip", "soft",
     "Labrale superius: most anterior point of the upper lip."),
    ("Li", "Lower lip", "soft",
     "Labrale inferius: most anterior point of the lower lip."),
    ("Pos", "Soft-tissue pogonion", "soft",
     "Most anterior point of the soft-tissue chin."),
    ("C2lp", "C2 lower border - back corner", "cvm",
     "Baccetti's C2p: the most posterior point on the lower border of the body of C2 (its back-lower corner)."),
    ("C2d", "C2 lower border - deepest point", "cvm",
     "Baccetti's C2m: the deepest point on the lower border of the body of C2 - the one farthest from the line "
     "joining C2p and C2a (the two ends of the lower border). If the border is flat, put it in the middle."),
    ("C2la", "C2 lower border - front corner", "cvm",
     "Baccetti's C2a: the most anterior point on the lower border of the body of C2 (its front-lower corner)."),
    ("C3up", "C3 upper back corner", "cvm",
     "Baccetti's C3up: the most superior point of the posterior border of the body of C3 (its back-upper corner)."),
    ("C3ua", "C3 upper front corner", "cvm",
     "Baccetti's C3ua: the most superior point of the anterior border of the body of C3 (its front-upper corner)."),
    ("C3lp", "C3 lower back corner", "cvm",
     "Baccetti's C3lp: the most posterior point on the lower border of the body of C3 (its back-lower corner)."),
    ("C3d", "C3 lower border - deepest point", "cvm",
     "Baccetti's C3m: the deepest point on the lower border of the body of C3 - the one farthest from the line "
     "joining C3lp and C3la. If the border is flat, put it in the middle."),
    ("C3la", "C3 lower front corner", "cvm",
     "Baccetti's C3la: the most anterior point on the lower border of the body of C3 (its front-lower corner)."),
    ("C4up", "C4 upper back corner", "cvm",
     "Baccetti's C4up: the most superior point of the posterior border of the body of C4 (its back-upper corner)."),
    ("C4ua", "C4 upper front corner", "cvm",
     "Baccetti's C4ua: the most superior point of the anterior border of the body of C4 (its front-upper corner)."),
    ("C4lp", "C4 lower back corner", "cvm",
     "Baccetti's C4lp: the most posterior point on the lower border of the body of C4 (its back-lower corner)."),
    ("C4d", "C4 lower border - deepest point", "cvm",
     "Baccetti's C4m: the deepest point on the lower border of the body of C4 - the one farthest from the line "
     "joining C4lp and C4la. If the border is flat, put it in the middle."),
    ("C4la", "C4 lower front corner", "cvm",
     "Baccetti's C4la: the most anterior point on the lower border of the body of C4 (its front-lower corner)."),
]

LANDMARKS = [dict(code=c, name=n, group=g, definition=d) for c, n, g, d in _DEFS]
CODES = [lm["code"] for lm in LANDMARKS]
BY_CODE = {lm["code"]: lm for lm in LANDMARKS}
GROUP_OF = {lm["code"]: lm["group"] for lm in LANDMARKS}
GROUP_NAMES = dict(GROUPS)

# The three points clicked first on an untraced x-ray; the rest of the template is fitted to them.
ANCHORS = ["S", "N", "Me"]

# Starting positions, mm, canonical frame (see the module docstring). Built from textbook norms for a
# ~12-year-old: SN 68 mm at 7 deg to FH, SNA 81, SNB 78, FMA 25, gonial angle 126, U1-SN 103, IMPA 93,
# interincisal 132, lips just behind the E-line, C2-C4 behind the ramus.
TEMPLATE = {
    "S": (0.0, 0.0), "N": (67.5, 8.3), "Or": (56.0, -22.0), "Po": (-18.0, -22.0), "Ar": (-14.5, -29.7),
    "PNS": (23.0, -42.0), "ANS": (71.0, -41.0), "A": (65.6, -46.7),
    "U1A": (61.0, -46.0), "U1T": (69.5, -69.0), "L1T": (66.5, -67.0), "L1A": (56.6, -85.5),
    "B": (60.1, -76.4), "Pog": (61.5, -89.0), "Gn": (58.5, -96.5), "Me": (55.1, -99.6), "Go": (-6.5, -70.9),
    "MPt": (2.7, -75.2),
    "MOL": (38.3, -63.8), "PM": (50.2, -65.5),
    "Prn": (95.0, -33.0), "Sn": (84.0, -43.0), "Ls": (84.5, -55.0), "Li": (80.5, -72.0), "Pos": (75.0, -94.0),
    "C2lp": (-37.0, -70.5), "C2d": (-29.5, -69.6), "C2la": (-22.0, -69.5),
    "C3up": (-37.5, -73.0), "C3ua": (-22.5, -74.0), "C3lp": (-37.5, -84.5), "C3d": (-30.0, -83.6), "C3la": (-22.5, -83.5),
    "C4up": (-37.5, -87.5), "C4ua": (-22.5, -88.5), "C4lp": (-37.5, -98.0), "C4d": (-30.0, -97.2), "C4la": (-22.5, -97.0),
}

assert set(TEMPLATE) == set(CODES), "every landmark needs a template position"

# Lines drawn over the x-ray (and used by the report), by landmark pair.
TRACING_LINES = [
    ("S", "N", "SN"), ("Po", "Or", "FH"), ("N", "A", "NA"), ("N", "B", "NB"), ("MPt", "Me", "MP"),
    ("ANS", "PNS", "PP"), ("U1A", "U1T", "U1"), ("L1A", "L1T", "L1"), ("Prn", "Pos", "E-line"),
    ("MOL", "PM", "FOP"), ("Ar", "Go", "Ramus"),
]

# Outlines of the vertebral bodies (drawn as polylines) for the CVM view.
VERTEBRA_OUTLINES = [
    ["C2lp", "C2d", "C2la"],
    ["C3up", "C3ua", "C3la", "C3d", "C3lp", "C3up"],
    ["C4up", "C4ua", "C4la", "C4d", "C4lp", "C4up"],
]


def codes_in_group(group):
    return [c for c in CODES if GROUP_OF[c] == group]


def public_definitions():
    """What the browser needs to draw and guide: landmarks in tracing order, groups, anchors, lines."""
    return dict(
        landmarks=LANDMARKS,
        groups=[dict(id=g, name=n, codes=codes_in_group(g)) for g, n in GROUPS],
        anchors=ANCHORS,
        lines=[dict(a=a, b=b, name=n) for a, b, n in TRACING_LINES],
        outlines=VERTEBRA_OUTLINES,
        template={c: list(p) for c, p in TEMPLATE.items()},
    )
