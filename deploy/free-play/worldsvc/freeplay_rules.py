"""Pure, bounded Free Play protocol and stylised voxel blast rules (protocol 1)."""
import json
import math
import re

ROOM = "family-freeplay"
SEED = 419947177  # strSeed('t-moors-1900'), the client generator's MOORS_SEED.
PROTOCOL = 1
LIMIT = 8192
MAX_CELLS = 1_000_000
MAX_CHUNKS = 1024
MAX_EDIT = 64
BATCH_SIZE = 512
MAX_PACKET = 16_384
MAX_PLAYERS = 8
MAX_HISTORY = 20
MAX_INVERSE_CELLS = 400_000
MAX_RECEIPTS = 4096
BOMBS = {
    "grenade": (4, 3, 6),
    "dynamite": (7, 5, 10),
    "demolition": (12, 8, 16),
    "mega": (24, 13, 24),
    "atom": (40, 18, 30),
}
REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,80}\Z")


class Refused(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def coordinate(value):
    return (isinstance(value, list) and len(value) == 3
            and integer(value[0], -LIMIT, LIMIT)
            and integer(value[1], 1, 63)
            and integer(value[2], -LIMIT, LIMIT))


def validate_command(value):
    if not isinstance(value, dict):
        raise Refused("shape", "Expected an object.")
    kind = value.get("type")
    extra = {
        "edit": {"edits"}, "blast": {"bomb", "center"},
        "undo": set(), "reset": {"confirm"}, "restore": {"confirm"},
    }
    if not isinstance(kind, str) or kind not in extra:
        raise Refused("command", "Unknown Free Play command.")
    allowed = {"type", "requestId", "epoch", "baseRevision"} | extra[kind]
    if set(value) != allowed:
        raise Refused("shape", "Unexpected or missing command fields.")
    rid = value.get("requestId")
    if not isinstance(rid, str) or not REQUEST_ID.fullmatch(rid):
        raise Refused("request-id", "Invalid request identifier.")
    if not integer(value.get("epoch"), 1, 2**53 - 1):
        raise Refused("epoch", "Invalid epoch.")
    if not integer(value.get("baseRevision"), 0, 2**53 - 1):
        raise Refused("revision", "Invalid revision.")
    if kind == "blast":
        if not isinstance(value["bomb"], str) or value["bomb"] not in BOMBS:
            raise Refused("bomb", "Unknown bomb.")
        if not coordinate(value["center"]):
            raise Refused("coordinate", "Blast is outside the playable world.")
    elif kind == "edit":
        edits = value["edits"]
        if not isinstance(edits, list) or not 1 <= len(edits) <= MAX_EDIT:
            raise Refused("edits", "A building stroke must contain 1–64 blocks.")
        positions = set()
        for cell in edits:
            if (not isinstance(cell, list) or len(cell) != 4
                    or not coordinate(cell[:3]) or not integer(cell[3], 0, 62)):
                raise Refused("cell", "Invalid block or coordinate.")
            key = tuple(cell[:3])
            if key in positions:
                raise Refused("cell", "A building stroke repeats a block.")
            positions.add(key)
    elif kind in {"reset", "restore"} and value["confirm"] is not True:
        raise Refused("confirmation", "Confirm this shared world change.")
    return value


def blast_cells(bomb, center):
    """Bowl plus ellipsoid/canopy clearance; the y=0 floor survives."""
    radius, depth, above = BOMBS[bomb]
    cx, cy, cz = center
    for x in range(max(-LIMIT, cx - radius), min(LIMIT, cx + radius) + 1):
        for z in range(max(-LIMIT, cz - radius), min(LIMIT, cz + radius) + 1):
            radial = ((x - cx) ** 2 + (z - cz) ** 2) / radius**2
            if radial > 1:
                continue
            fraction = math.sqrt(1 - radial)
            bottom = max(1, math.ceil(cy - depth * fraction))
            top = 63 if bomb in {"mega", "atom"} else min(63, math.floor(cy + above * fraction))
            for y in range(bottom, top + 1):
                yield [x, y, z, 0]


def validate_position(value, epoch):
    if (set(value) != {"type", "epoch", "x", "y", "z", "yaw"}
            or type(value["epoch"]) is not int or value["epoch"] != epoch):
        raise Refused("position", "Position belongs to another world generation.")
    for key, low, high in (("x", -LIMIT, LIMIT), ("z", -LIMIT, LIMIT),
                           ("y", 1, 192), ("yaw", -math.pi * 2, math.pi * 2)):
        number = value[key]
        if (type(number) not in {int, float} or not math.isfinite(number)
                or not low <= number <= high):
            raise Refused("position", "Invalid player position.")
    return {key: value[key] for key in ("x", "y", "z", "yaw")}


def packed(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True, allow_nan=False)
