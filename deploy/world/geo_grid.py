"""Python port of src/geo-grid.js — keep in lockstep (client/relay height parity)."""
import math


def bilinear(grid, gx, gz):
    cols, rows, metres = grid["cols"], grid["rows"], grid["metres"]
    cx = max(0.0, min(cols - 1, gx))
    cz = max(0.0, min(rows - 1, gz))
    x0 = int(cx); z0 = int(cz)
    x1 = min(cols - 1, x0 + 1); z1 = min(rows - 1, z0 + 1)
    fx = cx - x0; fz = cz - z0
    at = lambda x, z: metres[z * cols + x]
    top = at(x0, z0) + (at(x1, z0) - at(x0, z0)) * fx
    bot = at(x0, z1) + (at(x1, z1) - at(x0, z1)) * fx
    return top + (bot - top) * fz


def point_to_segment(px, pz, ax, az, bx, bz):
    dx = bx - ax; dz = bz - az
    L2 = dx * dx + dz * dz or 1e-9
    t = ((px - ax) * dx + (pz - az) * dz) / L2
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + dx * t), pz - (az + dz * t))


def point_to_polyline(px, pz, pts):
    best = float("inf")
    for i in range(len(pts) - 1):
        d = point_to_segment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
        if d < best:
            best = d
    return best


def block_to_grid(tr, grid, bx, bz):
    E = tr["minE"] + bx * tr["metresPerBlock"]
    N = tr["maxN"] - bz * tr["metresPerBlock"]
    gx = (E - tr["minE"]) / (tr["maxE"] - tr["minE"]) * (grid["cols"] - 1)
    gz = (tr["maxN"] - N) / (tr["maxN"] - tr["minN"]) * (grid["rows"] - 1)
    return gx, gz
