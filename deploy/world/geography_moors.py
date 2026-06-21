"""Relay/brain height mirror for the real-Moors world — must match
src/moorsgeo.js _heightRawNoFbm exactly (deterministic base + landmark + coast,
no fbm micro-roughness). The relay uses this for mine-depth / deeds."""
import json
import math
from pathlib import Path

from geo_grid import bilinear, block_to_grid

DATA = json.loads((Path(__file__).resolve().parents[2] / "data" / "moors-data.json").read_text())
WATER_LEVEL = 26
HEIGHT = 64


def _smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def _base(x, z):
    gx, gz = block_to_grid(DATA["transform"], DATA["elevation"], x, z)
    m = bilinear(DATA["elevation"], gx, gz)
    return math.floor(WATER_LEVEL + m / DATA["transform"]["metresPerBlock"])


def coast_t(x, z):
    base = _base(x, z)
    if base >= WATER_LEVEL:
        return 0.0
    return _smoothstep((WATER_LEVEL - base) / 8)


def height_raw(x, z):
    h = float(_base(x, z))
    for lm in DATA["landmarks"]:
        if lm.get("kind") == "peak":
            r = math.hypot(x - lm["x"], z - lm["z"]); R = lm["params"]["radius"]
            if r < R:
                cone = (WATER_LEVEL + lm["params"]["height"] / DATA["transform"]["metresPerBlock"]) - (r / R) * 14
                h = max(h, cone)
    t = coast_t(x, z)
    if t > 0:
        h = h * (1 - t) + (WATER_LEVEL - 9) * t
    return max(5, min(HEIGHT - 6, h))
