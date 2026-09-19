"""Lossless authored-block vehicles, parked as objects until explicitly edited."""
import json
import math
import uuid

from freeplay_rules import LIMIT, Refused, coordinate, integer, packed

MAX_VEHICLES = 16
MAX_VEHICLE_CELLS = 512
MODES = {"car", "plane", "submarine"}
SPEEDS = {"car": 12, "plane": 28, "submarine": 12}


def valid_id(value):
    return isinstance(value, str) and len(value) == 32 and all(char in "0123456789abcdef" for char in value)


def validate_conversion(command):
    if not all(coordinate(command.get(key)) for key in ("core", "from", "to")):
        raise Refused("vehicle", "Choose a valid build selection and control block.")
    low, high, core = command["from"], command["to"], command["core"]
    if (any(not 1 <= high[i] - low[i] + 1 <= limit for i, limit in enumerate((16, 12, 16)))
            or any(not low[i] <= core[i] <= high[i] for i in range(3))
            or not isinstance(command.get("mode"), str) or command["mode"] not in MODES):
        raise Refused("vehicle", "Select at most 16 by 12 by 16 blocks and a vehicle mode.")


def get(db, vehicle_id):
    row = db.execute("SELECT body FROM vehicles WHERE id=?", (vehicle_id,)).fetchone()
    if row is None:
        raise Refused("vehicle", "That vehicle is no longer here.")
    return json.loads(row[0])


def all_vehicles(db):
    return [json.loads(row[0]) for row in db.execute("SELECT body FROM vehicles ORDER BY id")]


def save(db, vehicle):
    db.execute("INSERT OR REPLACE INTO vehicles VALUES(?,?)", (vehicle["id"], packed(vehicle)))


def restore(db, changes):
    for vehicle_id, vehicle in changes.items():
        if vehicle is None:
            db.execute("DELETE FROM vehicles WHERE id=?", (vehicle_id,))
        else:
            save(db, vehicle)


def convert(db, command):
    validate_conversion(command)
    if db.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0] >= MAX_VEHICLES:
        raise Refused("vehicle-limit", "Park and edit a vehicle before making another.")
    low, high = command["from"], command["to"]
    rows = [list(row) for row in db.execute(
        "SELECT x,y,z,id FROM cells WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ? AND z BETWEEN ? AND ? AND id<>0 ORDER BY y,z,x",
        (low[0], high[0], low[1], high[1], low[2], high[2]))]
    if not 1 <= len(rows) <= MAX_VEHICLE_CELLS:
        raise Refused("vehicle-limit", "Select 1–512 placed solid blocks.")
    if [*command["core"], 206] not in rows or sum(row[3] == 206 for row in rows) != 1:
        raise Refused("vehicle-core", "The selected build needs exactly one control block.")
    vehicle = {"id": uuid.uuid4().hex, "mode": command["mode"],
               "core": [command["core"][i] - low[i] for i in range(3)],
               "cells": [[x - low[0], y - low[1], z - low[2], block] for x, y, z, block in rows],
               "pose": {"x": low[0], "y": low[1], "z": low[2], "yaw": 0}}
    save(db, vehicle)
    return [[x, y, z, 0] for x, y, z, _ in rows], {vehicle["id"]: None}, {vehicle["id"]: vehicle}


def snapped_cells(vehicle):
    pose = vehicle["pose"]
    origin = [math.floor(pose[key] + 0.5) for key in ("x", "y", "z")]
    rotation = math.floor(pose["yaw"] / (math.pi / 2) + 0.5) % 4
    rows = []
    for x, y, z, block in vehicle["cells"]:
        rx, rz = ((x, z), (-z, x), (-x, -z), (z, -x))[rotation]
        position = [origin[0] + rx, origin[1] + y, origin[2] + rz]
        if not coordinate(position):
            raise Refused("vehicle-place", "Land the whole vehicle inside the buildable world first.")
        rows.append([*position, block])
    return rows


def materialise(db, vehicle_id):
    vehicle = get(db, vehicle_id)
    rows = snapped_cells(vehicle)
    occupied = any(db.execute("SELECT 1 FROM cells WHERE x=? AND y=? AND z=? AND id<>0", row[:3]).fetchone()
                   for row in rows)
    if occupied:
        raise Refused("vehicle-place", "The parked build would overlap placed blocks. Move it first.")
    db.execute("DELETE FROM vehicles WHERE id=?", (vehicle_id,))
    return rows, {vehicle_id: vehicle}, {vehicle_id: None}


def validate_pose(pose, vehicle, previous, elapsed):
    if not isinstance(pose, dict) or set(pose) != {"x", "y", "z", "yaw"}:
        raise Refused("vehicle-pose", "Invalid vehicle position.")
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in pose.values()):
        raise Refused("vehicle-pose", "Invalid vehicle position.")
    if not -math.pi <= pose["yaw"] <= math.pi:
        raise Refused("vehicle-pose", "Invalid vehicle heading.")
    distance = math.sqrt(sum((pose[key] - previous[key]) ** 2 for key in ("x", "y", "z")))
    turn = abs((pose["yaw"] - previous["yaw"] + math.pi) % (math.pi * 2) - math.pi)
    if distance > SPEEDS[vehicle["mode"]] * min(elapsed, 1) + 3 or turn > 3 * min(elapsed, 1) + 0.35:
        raise Refused("vehicle-speed", "The vehicle moved too far. Its last saved position is safe.")
    sine, cosine = math.sin(pose["yaw"]), math.cos(pose["yaw"])
    for x, y, z, _ in vehicle["cells"]:
        wx, wz = pose["x"] + cosine * x - sine * z, pose["z"] + sine * x + cosine * z
        if not (-LIMIT <= wx <= LIMIT and -LIMIT <= wz <= LIMIT and 1 <= pose["y"] + y <= 179):
            raise Refused("vehicle-pose", "Keep the whole vehicle inside the world.")
    return dict(pose)
