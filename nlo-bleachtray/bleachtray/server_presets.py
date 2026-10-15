"""Presets shared by the web app and the watch-folder mode."""
PRESETS = {
    "bleaching": dict(reservoir_height=0.5, reservoir_max_position=5, trimline_offset=0.0, bridge_radius=3.0),
    "bleaching_3_3": dict(reservoir_height=0.5, reservoir_max_position=3, trimline_offset=0.0, bridge_radius=3.0),
    "aligner_high": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=1.25, bridge_radius=4.0),
    "plain_model": dict(reservoir_height=0.0, reservoir_max_position=0, trimline_offset=0.0, bridge_radius=3.0),
}
