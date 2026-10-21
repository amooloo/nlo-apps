"""Presets shared by the web app and the watch-folder mode."""
PRESETS = {
    "bleaching": dict(reservoir_height=0.5, reservoir_max_position=5, trimline_offset=1.0, bridge_radius=3.0),   # line 1 mm onto the gum: the ~1 mm bur runs centred on it (the doctor, 10/19/2026)
    "bleaching_3_3": dict(reservoir_height=0.5, reservoir_max_position=3, trimline_offset=1.0, bridge_radius=3.0),
    "aligner_high": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=1.25, bridge_radius=4.0, blockout=False),  # the interproximal fill is a choice in the app, not a default
    "plain_model": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=0.0, bridge_radius=3.0),
    # sports mouthguard, braces on: brackets stay under smooth shields, the line runs into the vestibule with
    # frenum notches and 6 mm onto the palate; no reservoirs, no automatic block-out (the sulcus is not an undercut)
    "mouthguard": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=0.0, bridge_radius=3.0, blockout=False,
                       mouthguard=True, remove_appliances=False, engrave_type="MOUTHGUARD"),
    # Phase I retainer (mixed dentition, phase1.py): the retainer's 1.25 mm line on the cheek side, a palate plate open
    # behind the Es (upper) / a deep lingual flange (lower); COTT cuts the C/D chunks out, BOTT blocks them out instead
    "phase1": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=1.25, bridge_radius=4.0, blockout=False,
                   phase1=True, p1_method="cott", engrave_type="PHASE I"),
    "phase1_bott": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=1.25, bridge_radius=4.0, blockout=False,
                        phase1=True, p1_method="bott", engrave_type="PHASE I"),
}

# one case can carry several models per arch; each variant = (preset, tag, piece kind, piece stage)
# WT = whitening tray (Template piece, stage 0), TT = thermoformed retainer (Aligner piece, stage 1), MG = mouthguard (Template piece, stage 2),
# P1 = Phase I retainer (Aligner piece, stage 3 - the doctor, 10/20/2026: its own trim settings in OrthoFactory)
VARIANTS = {
    "bleaching":     [("bleaching", "WT", "T", 0)],
    "bleaching_3_3": [("bleaching_3_3", "WT", "T", 0)],
    "aligner_high":  [("aligner_high", "TT", "A", 1)],
    "plain_model":   [("plain_model", "MODEL", "T", 0)],
    "mouthguard":    [("mouthguard", "MG", "T", 2)],
    "phase1":        [("phase1", "P1", "A", 3)],          # Phase I retainer: an Aligner piece of its own, stage 3 (AU3A / AL3A)
    "phase1_bott":   [("phase1_bott", "P1", "A", 3)],
    "both":          [("bleaching", "WT", "T", 0), ("aligner_high", "TT", "A", 1)],
}


def variants_for(preset):
    return VARIANTS.get(preset, VARIANTS["bleaching"])
