"""Bounded, deterministic private-edition brushes and sci-fi prefabs."""
from freeplay_rules import Refused, block_id, coordinate, integer

MAX_BUILD = 1024
BRUSHES = {"line", "wall", "floor", "box"}
PREFABS = {"base": (5, 5, 5), "tower": (5, 9, 5), "bridge": (3, 3, 13)}
STAIRS = [(2, 1), (3, 1), (3, 2), (3, 3), (2, 3), (1, 3), (1, 2), (1, 1)]


def validate_build(command):
    shape = command.get("shape")
    if not isinstance(shape, str) or shape not in BRUSHES | PREFABS.keys():
        raise Refused("build", "Unknown building shape.")
    if not coordinate(command.get("origin")) or not integer(command.get("rotation"), 0, 3):
        raise Refused("coordinate", "Invalid building origin or rotation.")
    if not block_id(command.get("block"), air=False):
        raise Refused("block", "Choose a building material.")
    if shape in BRUSHES:
        if not integer(command.get("size"), 3, 7) or command["size"] not in {3, 5, 7}:
            raise Refused("build", "Brush size must be 3, 5 or 7.")
    elif "size" in command:
        raise Refused("build", "Prefabs have a fixed size.")


def prefab_block(shape, x, y, z):
    if shape == "bridge":
        if y == 0:
            return 205 if z in {0, 6, 12} else 200
        if y == 1 and x in {0, 2}:
            return 201 if z % 3 == 0 else 200
        if y == 2 and x in {0, 2} and z % 3 == 0:
            return 202 if z in {0, 12} else 203
        return 0
    edge = x in {0, 4} or z in {0, 4}
    flat_wall = edge and not (x in {0, 4} and z in {0, 4})
    roof = 4 if shape == "base" else 8
    if y == 0:
        return 205
    if y == roof:
        block = 201 if edge else 202 if (x, z) == (2, 2) else 204
        if shape == "tower" and (x, z) in {(1, 3), (1, 2)}:
            block = 0
    else:
        block = 200 if edge else 0
        if shape == "tower" and y == 4:
            block = 201 if edge else 0 if (x, z) in {(3, 1), (3, 2)} else 204
        if flat_wall and y in ({2} if shape == "base" else {2, 3, 6, 7}):
            block = 203
        if (x, z) == (2, 0):
            if y in {1, 2}:
                block = 0
            elif shape == "base" and y == 3:
                block = 201
    if shape == "tower" and (x, z) == STAIRS[y - 1]:
        block = 205
    return block


def build_cells(command):
    """Validate every resulting coordinate before returning a single atomic action."""
    validate_build(command)
    shape, origin = command["shape"], command["origin"]
    if shape in BRUSHES:
        size = command["size"]
        width, height, length = {
            "line": (size, 1, 1), "wall": (size, size, 1),
            "floor": (size, 1, size), "box": (size, size, size),
        }[shape]
    else:
        width, height, length = PREFABS[shape]
    if width * height * length > MAX_BUILD:
        raise Refused("build", "That shape exceeds the building limit.")
    rows = []
    for y in range(height):
        for z in range(length):
            for x in range(width):
                if shape in PREFABS:
                    block = prefab_block(shape, x, y, z)
                else:
                    inside = 0 < x < width - 1 and 0 < y < height - 1 and 0 < z < length - 1
                    block = 0 if shape == "box" and inside else command["block"]
                rx, rz = ((x, z), (-z, x), (-x, -z), (z, -x))[command["rotation"]]
                position = [origin[0] + rx, origin[1] + y, origin[2] + rz]
                if not coordinate(position):
                    raise Refused("coordinate", "The whole building must fit inside the playable world.")
                rows.append([*position, block])
    return rows
