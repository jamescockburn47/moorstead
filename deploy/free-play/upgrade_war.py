"""Guarded content-6 to content-7 adapter update; preserve every saved world row."""
import argparse
import asyncio
import json
from pathlib import Path
import shutil
import sys

from backup import backup
from upgrade_battle import inspect_all
from upgrade_ctf import lifecycle
from upgrade_pack import command, digest, install, ready, require

# Read from the actual live adapter on 20 September 2026, from the live warflow release.
EXPECTED = {
    "freeplay_battle.py": "f3c295d5b4ef37a9e5a734e0c87f665427d8610654168262e33b1987b4f532be",
    "freeplay_battle_ai.py": "2ddbdf4bce77b3ef87626b56f991c801a5b8f1c6c87889723ab15f751d38654d",
    "freeplay_battle_flags.py": "bbbaf33002accbd031fcf5cae29a8467e4b8acb1ba34f267397376d97c2c0de0",
    "freeplay_battle_service.py": "da88d94a35184a6576813fc3441c6946dfe3fc3cd5fd8450ab608ad9e4824518",
    "freeplay_battle_terrain.py": "595f54b11a6db3f2ab4d9b8ed85b0a59df1ce22a50110f2f002f18cbc87f7ded",
    "freeplay_builds.py": "ae2e141a00fb4a36fdbed4740dc03c03e37dea9a011ebf54ed5c54262f3757d0",
    "freeplay_chunks.py": "de18fbb0176541eaf37b5c5e8eeb2287326f18ed40d989cc1224c3bf4815d3a4",
    "freeplay_rules.py": "3f02c064dea6b3074c14a8a1c0687de4ff61fee436295e6f170b332273bbd999",
    "freeplay_service.py": "d06e0dc13184f5d63a00137bff7761abb6665b41e0828c0562528035bedbf848",
    "freeplay_store.py": "b18b5e0e1ad6be2a11980ca7035f67d45e4af729bbabd53c717ea1f2a7dce9de",
    "freeplay_stream.py": "2c3b626519fb47e0384dad1f56b4180ccb82b39e19d22b5ac84b1ccd3488defc",
    "freeplay_vehicle_control.py": "251e09adef1c61dd4d2c73e0849aa3dae91e86e2afac33b1a658f92f991a485b",
    "freeplay_vehicles.py": "a588c426690f903237ea58ca055285a85fadd9e8a4adec028aac2fc7ceb2dfc0"
}
NEW = ("freeplay_battle_equipment.py", "freeplay_battle_breach.py", "freeplay_reset_vote.py")

BASELINE = {"battlefield.json": "68c98b57dbd80c223b65e7d15ac594fed48c8217d8d1ca602643262b3003507b",
            "battlefield.u16.zlib": "852bfe85e7feea8fc98107c1529e0c97f6dce805086481d1795044868568319b"}


def upgrade(stage, root):
    relay, data = root / "worldsvc", root / "world/freeplay"
    database = data / "world.sqlite3"
    require(stage != relay and not stage.is_relative_to(relay), "Use separate private staging")
    for name, expected in EXPECTED.items():
        require(digest(relay / name) == expected, "Live source diverged: " + name)
        compile((stage / name).read_text(), name, "exec")
    for name in NEW:
        require(not (relay / name).exists(), "New module already exists: " + name)
        compile((stage / name).read_text(), name, "exec")
    for name, expected in BASELINE.items():
        require(digest(data / name) == expected, "Live arena changed: " + name)
    sys.path.insert(0, str(stage))
    from freeplay_rules import CONTENT_VERSION
    from freeplay_store import Store
    require(CONTENT_VERSION == 7, "Expected content 7 candidate")
    asyncio.run(lifecycle(stage, data / "battlefield.json"))
    require(command("systemctl", "is-active", "moorstead-world").stdout.strip() == "active", "Relay inactive")
    before_path = stage / "before"
    before_path.mkdir(mode=0o700)
    for name in EXPECTED:
        shutil.copy2(relay / name, before_path / name)
    command("sudo", "-n", "systemctl", "stop", "moorstead-world")
    try:
        version, original = inspect_all(database)
        require(version == 4, "Expected unchanged schema 4")
        backup(database, before_path / "world.sqlite3")
        require(inspect_all(before_path / "world.sqlite3") == (4, original), "Backup differs from stopped world")
        trial = stage / "startup-rehearsal.sqlite3"
        shutil.copy2(before_path / "world.sqlite3", trial)
        candidate = Store(trial)
        state = candidate.state()
        require(inspect_all(trial) == (4, original), "Candidate startup changed saved rows")
        for name in [*EXPECTED, *NEW]:
            install(stage / name, relay / name)
        require(inspect_all(database) == (4, original), "Installation changed saved rows")
        manifest = {"contentVersion": 7, "schema": 4, "savedState": state, "tables": original,
                    "baseline": BASELINE, "modules": {name: digest(relay / name) for name in [*EXPECTED, *NEW]}}
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2))
        command("sudo", "-n", "systemctl", "start", "moorstead-world")
        ready()
        print("FREEPLAY_WAR_READY: content 7; all nine saved tables preserved; no reset; relay healthy")
    except Exception:
        # Reverting code is schema-compatible. Never replace the live database:
        # its committed cells/vehicles and any subsequent play remain authoritative.
        for name in EXPECTED:
            install(before_path / name, relay / name)
        for name in NEW:
            (relay / name).unlink(missing_ok=True)
        command("sudo", "-n", "systemctl", "restart", "moorstead-world")
        print("FREEPLAY_WAR_FAILED: previous adapter restored; current world retained")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", required=True)
    parser.add_argument("--root", type=Path, default=Path("/home/james/moorstead"))
    args = parser.parse_args()
    upgrade(Path(__file__).resolve().parent, args.root.resolve())
