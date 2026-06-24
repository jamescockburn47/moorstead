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


def _coast_dist(x, z, maxR):
    for r in range(1, maxR + 1):
        for dx in range(-r, r + 1):
            dz = r - abs(dx)
            if _base(x + dx, z + dz) < WATER_LEVEL:
                return r
            if dz != 0 and _base(x + dx, z - dz) < WATER_LEVEL:
                return r
    return 999


_RBB = None


def _near_river_data(x, z, pad):
    global _RBB
    if _RBB is None:
        _RBB = []
        for r in DATA.get("rivers", []):
            xs = [p[0] for p in r["points"]]
            zs = [p[1] for p in r["points"]]
            _RBB.append((min(xs), max(xs), min(zs), max(zs), r["points"]))
    p2 = pad * pad
    for (x0, x1, z0, z1, pts) in _RBB:
        if x < x0 - pad or x > x1 + pad or z < z0 - pad or z > z1 + pad:
            continue
        for (px, pz) in pts:
            dx = x - px
            dz = z - pz
            if dx * dx + dz * dz < p2:
                return True
    return False


def coast_cliff_top(x, z):
    cs = DATA.get("coastalCliffs")
    if not cs:
        return 6
    wsum = 0.0
    tsum = 0.0
    for c in cs:
        dx = x - c["x"]
        dz = z - c["z"]
        d2 = dx * dx + dz * dz
        if d2 < 4:
            return c["top"]
        w = 1 / (d2 * d2)
        wsum += w
        tsum += w * c["top"]
    return tsum / wsum


def height_raw(x, z):
    base = _base(x, z)
    h = float(base)
    mpb = DATA["transform"]["metresPerBlock"]
    # coast cross-section BEFORE the landmark sculpts (so a headland landmark can rise on top)
    if base >= WATER_LEVEL - 5 and h < WATER_LEVEL + 14 and not _near_river_data(x, z, 5):
        T = coast_cliff_top(x, z)
        BEACH = 6
        FLAT = 10
        TAPER = 6
        RISE = max(1, int(T) - 1)
        COAST_W = BEACH + RISE
        cd = _coast_dist(x, z, COAST_W + FLAT + TAPER)
        if cd < 999:
            if cd <= BEACH:
                prof = 1
            elif cd <= COAST_W:
                prof = 1 + (cd - BEACH)
            elif cd <= COAST_W + FLAT:
                prof = T
            else:
                prof = T * max(0, 1 - (cd - COAST_W - FLAT) / TAPER)
            if cd <= COAST_W:
                h = WATER_LEVEL + prof
            else:
                h = max(h, WATER_LEVEL + prof)
    for lm in DATA["landmarks"]:
        p = lm.get("params") or {}
        kind = lm.get("kind")
        if kind in ("peak", "hill"):
            R = p.get("radius", 12)
            r = math.hypot(x - lm["x"], z - lm["z"])
            if r < R:
                h = max(h, (WATER_LEVEL + p.get("height", 180) / mpb) - (r / R) * 14)
        elif kind == "cliff":
            R = p.get("radius", 12); pr = p.get("plateauR", 7); top = p.get("top", 5); k = p.get("k", 2)
            r = math.hypot(x - lm["x"], z - lm["z"])
            if r < R:
                f = 0.0 if r <= pr else ((r - pr) / (R - pr)) ** k
                h = max(h, WATER_LEVEL + top - f * top)
    t = coast_t(x, z)
    if t > 0 and h <= WATER_LEVEL:
        h = h * (1 - t) + (WATER_LEVEL - 9) * t
    return max(5, min(HEIGHT - 6, h))
