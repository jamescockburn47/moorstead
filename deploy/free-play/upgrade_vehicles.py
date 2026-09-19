"""Content 2 to 3 release: preserve all old rows, add vehicles and indexed counts.

Stage with upgrade_pack.py, backup.py and all eight adapter modules; run only when
the matching client is verified and release is authorised. No automatic DB rollback.
"""
import argparse
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

from backup import backup
from upgrade_pack import command, digest, inspect, install, ready, require

EXPECTED = {
    "freeplay_builds.py": "3bd204e333ad1ec3eadb4f2cdd1132e53ebe629f6e315c690f8ff60959739ee5",
    "freeplay_rules.py": "6d4d4e4811bd7c3b1c7992fdaebcbda9d4c84c0657ab231d995ef0b62139b84e",
    "freeplay_service.py": "1aabd62862221d6f93e5d63a6dba12a90039a69ff89a5d46caedeae1d2930232",
    "freeplay_store.py": "fb4566b3b53d2c0ebe7377aa366700da88f62eb28e53e40714f560e844cca0dc",
    "freeplay_stream.py": "f572eb32da2a90e2d09f1ed36511a5a541900f17416eaceeed0b8ac0472515f5",
}
NEW = ("freeplay_chunks.py", "freeplay_vehicles.py", "freeplay_vehicle_control.py")


def verify_added_tables(path, original):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        count, chunks = db.execute("SELECT COALESCE(SUM(count),0),COUNT(*) FROM chunk_counts").fetchone()
        require(count == original["cells"]["count"] and chunks <= 1024, "Override count migration differs")
        require(db.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0] == 0, "Unexpected migrated vehicles")
        require(db.execute("SELECT COUNT(*) FROM checkpoint_vehicles").fetchone()[0] == 0, "Unexpected vehicle checkpoint")
    finally:
        db.close()


def upgrade(stage, root):
    relay, database = root / "worldsvc", root / "world/freeplay/world.sqlite3"
    names = [*EXPECTED, *NEW]
    require(stage != relay and not stage.is_relative_to(relay), "Use a separate private staging directory")
    require(database.is_file(), "Expected existing Free Play database")
    for name, expected in EXPECTED.items():
        require(digest(relay / name) == expected, "Live source diverged: " + name)
    for name in NEW:
        require(not (relay / name).exists(), "Vehicle adapter already present: inspect first")
    for name in names:
        compile((stage / name).read_text(), name, "exec")
    require(command("systemctl", "is-active", "moorstead-world").stdout.strip() == "active", "Relay inactive")
    before = stage / "before"
    before.mkdir(mode=0o700)
    for name in EXPECTED:
        shutil.copy2(relay / name, before / name)
    sys.path.insert(0, str(stage))
    from freeplay_store import Store
    command("sudo", "-n", "systemctl", "stop", "moorstead-world")
    migrated = False
    try:
        version, original = inspect(database)
        require(version == 2, "Expected content-2 database")
        backup(database, before / "world.sqlite3")
        require(inspect(before / "world.sqlite3") == (2, original), "Backup differs from stopped database")
        trial = stage / "migration-rehearsal.sqlite3"
        shutil.copy2(before / "world.sqlite3", trial)
        Store(trial)
        require(inspect(trial) == (3, original), "Migration rehearsal changed saved rows")
        verify_added_tables(trial, original)
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
        require(inspect(database) == (3, original), "Migration changed saved rows")
        verify_added_tables(database, original)
        (stage / "manifest.json").write_text(json.dumps({"contentVersion": 3, "before": original,
            "modules": {name: digest(relay / name) for name in names}}, indent=2))
        command("sudo", "-n", "systemctl", "start", "moorstead-world")
        ready()
        print("FREEPLAY_VEHICLES_INSTALLED: content 3; all prior rows preserved; relay healthy")
    except Exception:
        migrated = migrated or inspect(database)[0] == 3
        if not migrated:
            for name in EXPECTED:
                install(before / name, relay / name)
            for name in NEW:
                target = relay / name
                if target.exists() and digest(target) == digest(stage / name):
                    target.unlink()
            command("sudo", "-n", "systemctl", "start", "moorstead-world")
            print("FREEPLAY_VEHICLES_FAILED_BEFORE_MIGRATION: original code and data retained")
        else:
            print("FREEPLAY_VEHICLES_REQUIRES_ROLLFORWARD: upgraded database preserved")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", required=True)
    parser.add_argument("--root", type=Path, default=Path("/home/james/moorstead"))
    arguments = parser.parse_args()
    upgrade(Path(__file__).resolve().parent, arguments.root.resolve())
