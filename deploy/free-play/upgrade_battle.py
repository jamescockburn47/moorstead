"""Guarded content 3 to 4 release, preserving every saved table and adding arena data."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

from backup import backup
from upgrade_pack import command, digest, install, ready, require

EXPECTED = {
    "freeplay_builds.py": "3bd204e333ad1ec3eadb4f2cdd1132e53ebe629f6e315c690f8ff60959739ee5",
    "freeplay_chunks.py": "de18fbb0176541eaf37b5c5e8eeb2287326f18ed40d989cc1224c3bf4815d3a4",
    "freeplay_rules.py": "80d0301304fab7f58923cac5aad4419e270b276a863910a55707c34660f98680",
    "freeplay_service.py": "c5ae5e49fd35062897a42e7f95dcdc5b9efa11bd53ccca98a5a1c6ec84b567d6",
    "freeplay_store.py": "077cfd8dbeb0566ebd3a5ae8bc0046af9880b2259ddf8028170aae1071d3267f",
    "freeplay_stream.py": "4961dfe41c78d64e5b941700cd261e8bc0ff0e4b62f18472a3685a25987d83f8",
    "freeplay_vehicle_control.py": "f46abd6ab8e223f29c9254e1d3192916b476431c44b5a78f8a3a74c20b0a05f1",
    "freeplay_vehicles.py": "a588c426690f903237ea58ca055285a85fadd9e8a4adec028aac2fc7ceb2dfc0",
}
NEW = ("freeplay_battle.py", "freeplay_battle_ai.py", "freeplay_battle_terrain.py", "freeplay_battle_service.py")
BASELINE = ("battlefield.json", "battlefield.u16.zlib")
BASELINE_HASH = "1e931025f7a060c0b75dc720965b1aa0c278db1ea9bfd42d99e8efb711bf2ec2"
TABLES = {"meta": "singleton", "cells": "x,y,z", "checkpoint": "x,y,z", "history": "revision",
          "receipts": "serial", "sqlite_sequence": "name", "vehicles": "id",
          "checkpoint_vehicles": "id", "chunk_counts": "x,z"}


def inspect_all(path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        db.execute("BEGIN")
        require(db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "Database integrity failure")
        state = {}
        for table, keys in TABLES.items():
            hashed, count = hashlib.sha256(), 0
            for row in db.execute(f"SELECT * FROM {table} ORDER BY {keys}"):
                serial = [value.hex() if isinstance(value, bytes) else value for value in row]
                hashed.update(json.dumps(serial, separators=(",", ":")).encode() + b"\n")
                count += 1
            state[table] = {"count": count, "sha256": hashed.hexdigest()}
        return db.execute("PRAGMA user_version").fetchone()[0], state
    finally:
        db.close()


def upgrade(stage, root):
    relay, data = root / "worldsvc", root / "world/freeplay"
    database, names = data / "world.sqlite3", [*EXPECTED, *NEW]
    require(stage != relay and not stage.is_relative_to(relay), "Use separate private staging")
    for name, expected in EXPECTED.items():
        require(digest(relay / name) == expected, "Live source diverged: " + name)
    for name in NEW:
        require(not (relay / name).exists(), "Battle module already present: inspect first")
    for name in BASELINE:
        require(not (data / name).exists(), "Battlefield baseline already present: inspect first")
    for name in names:
        compile((stage / name).read_text(), name, "exec")
    sys.path.insert(0, str(stage))
    from freeplay_battle_terrain import Arena
    from freeplay_store import Store
    arena = Arena.load(stage / "battlefield.json")
    require(json.loads((stage / "battlefield.json").read_text())["sha256"] == BASELINE_HASH, "Unexpected generated arena")
    require(command("systemctl", "is-active", "moorstead-world").stdout.strip() == "active", "Relay inactive")
    before = stage / "before"
    before.mkdir(mode=0o700)
    for name in EXPECTED:
        shutil.copy2(relay / name, before / name)
    command("sudo", "-n", "systemctl", "stop", "moorstead-world")
    migrated = False
    try:
        version, original = inspect_all(database)
        require(version == 3, "Expected content-3 database")
        backup(database, before / "world.sqlite3")
        require(inspect_all(before / "world.sqlite3") == (3, original), "Backup differs from stopped world")
        trial = stage / "migration-rehearsal.sqlite3"
        shutil.copy2(before / "world.sqlite3", trial)
        candidate = Store(trial)
        require(inspect_all(trial) == (4, original), "Migration rehearsal changed existing saved rows")
        arena.reload(candidate)
        legacy = ("from freeplay_store import Store; import sys\ntry: Store(sys.argv[1])\n"
                  "except ValueError as error:\n sys.exit(0 if 'newer unsupported schema' in str(error) else 2)\nsys.exit(1)\n")
        subprocess.run([sys.executable, "-c", legacy, str(trial)], cwd=relay, check=True, capture_output=True, timeout=15)
        for name in names:
            install(stage / name, relay / name)
        for name in BASELINE:
            install(stage / name, data / name)
        Store(database)
        migrated = True
        require(inspect_all(database) == (4, original), "Migration changed existing saved rows")
        manifest = {"contentVersion": 4, "before": original, "baselineRawHash": BASELINE_HASH,
                    "modules": {name: digest(relay / name) for name in names},
                    "baseline": {name: digest(data / name) for name in BASELINE}}
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2))
        command("sudo", "-n", "systemctl", "start", "moorstead-world")
        ready()
        print("FREEPLAY_BATTLE_INSTALLED: content 4; all nine saved tables preserved; relay healthy")
    except Exception:
        migrated = migrated or inspect_all(database)[0] == 4
        if not migrated:
            for name in EXPECTED:
                install(before / name, relay / name)
            for name in NEW:
                target = relay / name
                if target.exists() and digest(target) == digest(stage / name):
                    target.unlink()
            for name in BASELINE:
                target = data / name
                if target.exists() and digest(target) == digest(stage / name):
                    target.unlink()
            command("sudo", "-n", "systemctl", "start", "moorstead-world")
            print("FREEPLAY_BATTLE_FAILED_BEFORE_MIGRATION: original code and world retained")
        else:
            print("FREEPLAY_BATTLE_REQUIRES_ROLLFORWARD: upgraded world preserved")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", required=True)
    parser.add_argument("--root", type=Path, default=Path("/home/james/moorstead"))
    args = parser.parse_args()
    upgrade(Path(__file__).resolve().parent, args.root.resolve())
