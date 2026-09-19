"""Verified procedural arena plus authoritative saved overrides and voxel cover."""
from array import array
import hashlib
import json
import math
from pathlib import Path
import sys
import zlib

from freeplay_rules import SEED


class Arena:
    def __init__(self, header, raw):
        self.width, self.height = header["width"], header["height"]
        if (header["version"] != 1 or header["seed"] != SEED or self.width != 128 or self.height != 64
                or len(raw) != 128 * 128 * 64 * 2
                or hashlib.sha256(raw).hexdigest() != header["sha256"]):
            raise ValueError("Invalid battlefield baseline")
        self.origin, self.camps = header["origin"], header["camps"]
        self.solids = frozenset(header["solidIds"])
        self.base = array("H")
        self.base.frombytes(raw)
        if sys.byteorder != "little":
            self.base.byteswap()
        self.cells = self.base[:]

    @classmethod
    def load(cls, header_path):
        path = Path(header_path)
        header = json.loads(path.read_text())
        compressed = path.with_name("battlefield.u16.zlib").read_bytes()
        raw = zlib.decompress(compressed)
        return cls(header, raw)

    def inside(self, x, z):
        return self.origin[0] + 1 <= x < self.origin[0] + self.width - 1 and self.origin[1] + 1 <= z < self.origin[1] + self.width - 1

    def index(self, x, y, z):
        x, y, z = math.floor(x) - self.origin[0], math.floor(y), math.floor(z) - self.origin[1]
        if 0 <= x < self.width and 0 <= z < self.width and 0 <= y < self.height:
            return (y * self.width + z) * self.width + x
        return None

    def solid(self, x, y, z):
        index = self.index(x, y, z)
        return (y < 0 or not self.inside(x, z)) if index is None else self.cells[index] in self.solids

    def changes(self, rows):
        for x, y, z, block in rows:
            index = self.index(x, y, z)
            if index is not None:
                self.cells[index] = self.base[index] if block is None else block

    def reload(self, store):
        self.cells = self.base[:]
        x, z = self.origin
        with store.connect() as db:
            rows = db.execute("SELECT x,y,z,id FROM cells WHERE x BETWEEN ? AND ? AND z BETWEEN ? AND ?",
                              (x, x + self.width - 1, z, z + self.width - 1))
            self.changes(rows)

    def ground(self, x, z, near=None):
        if not self.inside(x, z):
            return None
        high, low = (63, 1) if near is None else (min(63, math.floor(near) + 1), max(1, math.floor(near) - 3))
        for y in range(high, low - 1, -1):
            if self.solid(x, y - 1, z) and not self.solid(x, y, z) and not self.solid(x, y + 1, z):
                return float(y)
        return None

    def ray(self, origin, direction, distance):
        """First solid distance; a quarter-voxel step cannot skip a full cover voxel."""
        for step in range(math.ceil(distance * 4) + 1):
            length = min(distance, step / 4)
            point = [origin[i] + direction[i] * length for i in range(3)]
            if self.solid(*point):
                return length
        return distance

    def visible(self, origin, target):
        distance = math.dist(origin, target)
        if distance < 0.01:
            return True
        direction = [(target[i] - origin[i]) / distance for i in range(3)]
        return self.ray(origin, direction, distance) >= distance - 0.25
