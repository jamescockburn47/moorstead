"""Guarded content-5 to content-6 adapter update; preserve every saved world row."""
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

# Read from the actual live adapter on 19 September 2026, after the empty-round fix.
EXPECTED = {
    "freeplay_battle_ai.py": "57f27a132fe364a0d488675f0b988a20d615300f44e284fdea46e8185d34c8dc",
    "freeplay_battle_flags.py": "d645bb99f5e3c2d060a769f94c635f91fc0f696e4a7c71317748131f0b8ff18d",
    "freeplay_battle.py": "0fb6abf7446236282297870327f117a0d3b73b07167228f18a34f283a03081fd",
    "freeplay_battle_service.py": "2bcb90e4d90392ffa96812fede2328d529dba214408d84d7a4c1815e921b8125",
    "freeplay_battle_terrain.py": "595f54b11a6db3f2ab4d9b8ed85b0a59df1ce22a50110f2f002f18cbc87f7ded",
    "freeplay_builds.py": "ae2e141a00fb4a36fdbed4740dc03c03e37dea9a011ebf54ed5c54262f3757d0",
    "freeplay_chunks.py": "de18fbb0176541eaf37b5c5e8eeb2287326f18ed40d989cc1224c3bf4815d3a4",
    "freeplay_rules.py": "4cee87157a206a9b340a03bb32dc79958671ce0e6a5383865934be0efb9e3c18",
    "freeplay_service.py": "91b1da14988fe1abc958b5ebbcfbededdb419e58cb95645055498a4dfabff48a",
    "freeplay_store.py": "b18b5e0e1ad6be2a11980ca7035f67d45e4af729bbabd53c717ea1f2a7dce9de",
    "freeplay_stream.py": "2c3b626519fb47e0384dad1f56b4180ccb82b39e19d22b5ac84b1ccd3488defc",
    "freeplay_vehicle_control.py": "251e09adef1c61dd4d2c73e0849aa3dae91e86e2afac33b1a658f92f991a485b",
    "freeplay_vehicles.py": "a588c426690f903237ea58ca055285a85fadd9e8a4adec028aac2fc7ceb2dfc0",
}
BASELINE = {"battlefield.json": "68c98b57dbd80c223b65e7d15ac594fed48c8217d8d1ca602643262b3003507b",
            "battlefield.u16.zlib": "852bfe85e7feea8fc98107c1529e0c97f6dce805086481d1795044868568319b"}


def upgrade(stage, root):
    relay, data = root / "worldsvc", root / "world/freeplay"
    database = data / "world.sqlite3"
    require(stage != relay and not stage.is_relative_to(relay), "Use separate private staging")
    for name, expected in EXPECTED.items():
        require(digest(relay / name) == expected, "Live source diverged: " + name)
        compile((stage / name).read_text(), name, "exec")
    for name, expected in BASELINE.items():
        require(digest(data / name) == expected, "Live arena changed: " + name)
    sys.path.insert(0, str(stage))
    from freeplay_rules import CONTENT_VERSION
    from freeplay_store import Store
    require(CONTENT_VERSION == 6, "Expected content 6 candidate")
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
        for name in EXPECTED:
            install(stage / name, relay / name)
        require(inspect_all(database) == (4, original), "Installation changed saved rows")
        manifest = {"contentVersion": 6, "schema": 4, "savedState": state, "tables": original,
                    "baseline": BASELINE, "modules": {name: digest(relay / name) for name in EXPECTED}}
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2))
        command("sudo", "-n", "systemctl", "start", "moorstead-world")
        ready()
        print("FREEPLAY_WAR_READY: content 6; all nine saved tables preserved; no reset; relay healthy")
    except Exception:
        # Reverting code is schema-compatible. Never replace the live database:
        # its committed cells/vehicles and any subsequent play remain authoritative.
        for name in EXPECTED:
            install(before_path / name, relay / name)
        command("sudo", "-n", "systemctl", "restart", "moorstead-world")
        print("FREEPLAY_WAR_FAILED: previous adapter restored; current world retained")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", required=True)
    parser.add_argument("--root", type=Path, default=Path("/home/james/moorstead"))
    args = parser.parse_args()
    upgrade(Path(__file__).resolve().parent, args.root.resolve())
