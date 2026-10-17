"""Presets shared by the web app and the watch-folder mode."""
PRESETS = {
    "bleaching": dict(reservoir_height=0.5, reservoir_max_position=5, trimline_offset=0.0, bridge_radius=3.0),
    "bleaching_3_3": dict(reservoir_height=0.5, reservoir_max_position=3, trimline_offset=0.0, bridge_radius=3.0),
    "aligner_high": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=1.25, bridge_radius=4.0, blockout=True),
    "plain_model": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=0.0, bridge_radius=3.0),
    # sports mouthguard, braces on: brackets stay under smooth shields, the line runs into the vestibule with
    # frenum notches and 6 mm onto the palate; no reservoirs, no automatic block-out (the sulcus is not an undercut)
    "mouthguard": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=0.0, bridge_radius=3.0, blockout=False,
                       mouthguard=True, remove_appliances=False, engrave_type="MOUTHGUARD"),
}

# one case can carry several models per arch; each variant = (preset, tag, piece kind, piece stage)
# WT = whitening tray (Template piece, stage 0), TT = thermoformed retainer (Aligner piece, stage 1), MG = mouthguard (Template piece, stage 2)
VARIANTS = {
    "bleaching":     [("bleaching", "WT", "T", 0)],
    "bleaching_3_3": [("bleaching_3_3", "WT", "T", 0)],
    "aligner_high":  [("aligner_high", "TT", "A", 1)],
    "plain_model":   [("plain_model", "MODEL", "T", 0)],
    "mouthguard":    [("mouthguard", "MG", "T", 2)],
    "both":          [("bleaching", "WT", "T", 0), ("aligner_high", "TT", "A", 1)],
}


def variants_for(preset):
    return VARIANTS.get(preset, VARIANTS["bleaching"])
