"""Explicit EVO content-2 install; run only after release approval and client checks.

Place beside backup.py and the five candidate freeplay_*.py modules. This updates
only the private relay adapter. A migrated database is preserved on failure;
roll forward instead of silently discarding subsequent play with an old backup.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

from backup import backup

EXPECTED = {
    "freeplay_rules.py": "e631a8bda2aba52061d5a1e6e3fbfcf1c119cb454efd0069cc67483e7f1c8725",
    "freeplay_service.py": "99abba389c3a38e41b21cf86d27e76ad90d9b2831ac4939b6da551faacffa8a6",
    "freeplay_store.py": "275883634cfe741a886781bd2dcdac2a678e9ab40a127bbab08dedd522611092",
    "freeplay_stream.py": "b7c02850574365096bfae02f8ebac35c465bf4361e828690dae3535fedd1e54b",
}
TABLE_KEYS = {"meta": "singleton", "cells": "x,y,z", "checkpoint": "x,y,z",
              "history": "revision", "receipts": "serial", "sqlite_sequence": "name"}


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=60)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect(path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        require(db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "Database integrity failure")
        state = {}
        for table, keys in TABLE_KEYS.items():
            hashed, count = hashlib.sha256(), 0
            for row in db.execute(f"SELECT * FROM {table} ORDER BY {keys}"):
                serial = [value.hex() if isinstance(value, bytes) else value for value in row]
                hashed.update(json.dumps(serial, separators=(",", ":")).encode() + b"\n")
                count += 1
            state[table] = {"count": count, "sha256": hashed.hexdigest()}
        return db.execute("PRAGMA user_version").fetchone()[0], state
    finally:
        db.close()


def install(source, target):
    temporary = target.with_name(target.name + ".freeplay-install")
    shutil.copy2(source, temporary)
    temporary.chmod(0o644)
    os.replace(temporary, target)


def ready():
    for attempt in range(40):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8096/status", timeout=1) as response:
                require(isinstance(json.load(response).get("rooms"), dict), "Unexpected relay health")
                return
        except (OSError, urllib.error.URLError):
            if attempt == 39:
                raise
        time.sleep(0.25)


def upgrade(stage, root):
    relay, database = root / "worldsvc", root / "world/freeplay/world.sqlite3"
    names = [*EXPECTED, "freeplay_builds.py"]
    require(stage != relay and not stage.is_relative_to(relay), "Use a separate private staging directory")
    require(database.is_file(), "Expected existing Free Play database")
    require(not (relay / "freeplay_builds.py").exists(), "Pack already present: inspect before updating")
    for name, expected in EXPECTED.items():
        require(digest(relay / name) == expected, "Live source diverged: " + name)
    for name in names:
        compile((stage / name).read_text(), name, "exec")
    require(command("systemctl", "is-active", "moorstead-world").stdout.strip() == "active", "Relay inactive")
    before = stage / "before"
    before.mkdir(mode=0o700)  # Refuse a reused staging directory.
    for name in EXPECTED:
        shutil.copy2(relay / name, before / name)
    sys.path.insert(0, str(stage))
    from freeplay_store import Store
    command("sudo", "-n", "systemctl", "stop", "moorstead-world")
    migrated = False
    try:
        version, original = inspect(database)
        require(version == 1, "Expected content-1 database")
        backup(database, before / "world.sqlite3")
        require(inspect(before / "world.sqlite3") == (1, original), "Backup differs from stopped database")
        trial = stage / "migration-rehearsal.sqlite3"
        shutil.copy2(before / "world.sqlite3", trial)
        Store(trial)
        require(inspect(trial) == (2, original), "Migration rehearsal changed saved data")
        legacy_probe = (
            "from freeplay_store import Store; import sys\n"
            "try: Store(sys.argv[1])\n"
            "except ValueError as error:\n"
            " sys.exit(0 if 'newer unsupported schema' in str(error) else 2)\n"
            "sys.exit(1)\n")
        subprocess.run([sys.executable, "-c", legacy_probe, str(trial)], cwd=relay,
                       check=True, capture_output=True, timeout=15)
        for name in names:
            install(stage / name, relay / name)
        Store(database)
        migrated = True
        require(inspect(database) == (2, original), "Migration changed saved data")
        manifest = {"contentVersion": 2, "before": original,
                    "modules": {name: digest(relay / name) for name in names}}
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2))
        command("sudo", "-n", "systemctl", "start", "moorstead-world")
        ready()
        print("FREEPLAY_PACK_INSTALLED: content 2; all saved table hashes preserved; relay healthy")
    except Exception:
        # Never restore an older world after this new content could have been used.
        migrated = migrated or inspect(database)[0] == 2
        if not migrated:
            for name in EXPECTED:
                install(before / name, relay / name)
            new_module = relay / "freeplay_builds.py"
            if new_module.exists() and digest(new_module) == digest(stage / "freeplay_builds.py"):
                new_module.unlink()
            command("sudo", "-n", "systemctl", "start", "moorstead-world")
            print("FREEPLAY_PACK_FAILED_BEFORE_MIGRATION: original code and data retained")
        else:
            print("FREEPLAY_PACK_REQUIRES_ROLLFORWARD: upgraded database preserved; inspect relay before recovery")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", required=True)
    parser.add_argument("--root", type=Path, default=Path("/home/james/moorstead"))
    arguments = parser.parse_args()
    upgrade(Path(__file__).resolve().parent, arguments.root.resolve())
