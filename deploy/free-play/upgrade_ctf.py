"""Explicit content-5 release and authorised fresh-world reset with recovery."""
import argparse
import asyncio
import json
from pathlib import Path
import shutil
import sys
import tempfile

from backup import backup
from upgrade_battle import inspect_all
from upgrade_pack import command, digest, install, ready, require

EXPECTED = {
    "freeplay_builds.py": "ae2e141a00fb4a36fdbed4740dc03c03e37dea9a011ebf54ed5c54262f3757d0",
    "freeplay_chunks.py": "de18fbb0176541eaf37b5c5e8eeb2287326f18ed40d989cc1224c3bf4815d3a4",
    "freeplay_rules.py": "acc0f782b26f901e9119e4dee6e251839c5853866358c146dbaa215bf31a9e75",
    "freeplay_service.py": "91b1da14988fe1abc958b5ebbcfbededdb419e58cb95645055498a4dfabff48a",
    "freeplay_store.py": "b18b5e0e1ad6be2a11980ca7035f67d45e4af729bbabd53c717ea1f2a7dce9de",
    "freeplay_stream.py": "2c3b626519fb47e0384dad1f56b4180ccb82b39e19d22b5ac84b1ccd3488defc",
    "freeplay_vehicle_control.py": "251e09adef1c61dd4d2c73e0849aa3dae91e86e2afac33b1a658f92f991a485b",
    "freeplay_vehicles.py": "a588c426690f903237ea58ca055285a85fadd9e8a4adec028aac2fc7ceb2dfc0",
    "freeplay_battle.py": "8b9fb99c24d1a8a5aca78b8fd7e4d253a39876b2e9a41e4804dced35694c48e5",
    "freeplay_battle_ai.py": "28b5ba67591d67d7ab710cee43ccea681c3135edd163b292d6da0cad3b804092",
    "freeplay_battle_terrain.py": "595f54b11a6db3f2ab4d9b8ed85b0a59df1ce22a50110f2f002f18cbc87f7ded",
    "freeplay_battle_service.py": "3b6a425059ad64d21936fc5619eb170cc90127b8c3a858c858830bd76d41cbef",
}
NEW = "freeplay_battle_flags.py"
BASELINE = {"battlefield.json": "68c98b57dbd80c223b65e7d15ac594fed48c8217d8d1ca602643262b3003507b",
            "battlefield.u16.zlib": "852bfe85e7feea8fc98107c1529e0c97f6dce805086481d1795044868568319b"}


def reset_command(store, request_id, kind="reset"):
    state = store.state()
    return {"type": kind, "confirm": True, "epoch": state["epoch"],
            "baseRevision": state["revision"], "requestId": request_id}


def verify_reset(path, before, previous, current):
    version, after = inspect_all(path)
    require(version == 4, "Reset changed the schema marker")
    require(all(after[table]["count"] == 0 for table in ("cells", "vehicles", "history", "chunk_counts")), "World is not pristine")
    if before["cells"]["count"] or before["vehicles"]["count"]:
        require(after["checkpoint"] == before["cells"] and after["checkpoint_vehicles"] == before["vehicles"], "Recovery checkpoint differs from previous world")
    else:
        require(after["checkpoint"] == before["checkpoint"] and after["checkpoint_vehicles"] == before["checkpoint_vehicles"], "Existing recovery checkpoint changed")
    require(current["epoch"] == previous["epoch"] + 1 and current["revision"] == previous["revision"] + 1, "Reset ordering incorrect")
    return after


async def lifecycle(stage, baseline):
    from fastapi import FastAPI
    from freeplay_service import mount_freeplay
    with tempfile.TemporaryDirectory(prefix="freeplay-ctf-lifecycle-", dir=stage) as directory:
        app = FastAPI()
        hub = mount_freeplay(app, lambda *args: None, lambda *args: False, Path(directory), baseline)
        async with app.router.lifespan_context(app):
            require(hub.battle.task is not None and not hub.battle.task.done(), "Battle task did not start")
        require(hub.battle.task.done(), "Battle task did not stop")


def upgrade(stage, root):
    relay, data = root / "worldsvc", root / "world/freeplay"
    database, names = data / "world.sqlite3", [*EXPECTED, NEW]
    require(stage != relay and not stage.is_relative_to(relay), "Use separate private staging")
    for name, expected in EXPECTED.items():
        require(digest(relay / name) == expected, "Live source diverged: " + name)
    require(not (relay / NEW).exists(), "CTF is already installed")
    for name, expected in BASELINE.items():
        require(digest(data / name) == expected, "Arena baseline changed")
    for name in names:
        compile((stage / name).read_text(), name, "exec")
    sys.path.insert(0, str(stage))
    from freeplay_rules import CONTENT_VERSION
    from freeplay_store import Store
    require(CONTENT_VERSION == 5, "Expected content 5 candidate")
    asyncio.run(lifecycle(stage, data / "battlefield.json"))
    require(command("systemctl", "is-active", "moorstead-world").stdout.strip() == "active", "Relay inactive")
    before_path = stage / "before"
    before_path.mkdir(mode=0o700)
    for name in EXPECTED:
        shutil.copy2(relay / name, before_path / name)
    command("sudo", "-n", "systemctl", "stop", "moorstead-world")
    reset_applied, previous = False, None
    try:
        version, before = inspect_all(database)
        require(version == 4, "Expected schema 4")
        backup(database, before_path / "world.sqlite3")
        require(inspect_all(before_path / "world.sqlite3") == (4, before), "Backup differs from stopped world")
        trial = stage / "reset-rehearsal.sqlite3"
        shutil.copy2(before_path / "world.sqlite3", trial)
        candidate = Store(trial)
        require(inspect_all(trial) == (4, before), "Candidate startup changed saved data")
        prior = candidate.state()
        result = candidate.apply("release-admin", reset_command(candidate, "ctf-reset-rehearsal"), "Fresh world")
        verify_reset(trial, before, prior, result)
        if result["checkpoint"]:
            candidate.apply("release-admin", reset_command(candidate, "ctf-restore-rehearsal", "restore"))
            _, restored = inspect_all(trial)
            expected_cells = before["cells"] if before["cells"]["count"] or before["vehicles"]["count"] else before["checkpoint"]
            expected_vehicles = before["vehicles"] if before["cells"]["count"] or before["vehicles"]["count"] else before["checkpoint_vehicles"]
            require(restored["cells"] == expected_cells and restored["vehicles"] == expected_vehicles, "Recovery rehearsal failed")
        for name in names:
            install(stage / name, relay / name)
        store = Store(database)
        previous = store.state()
        require(inspect_all(database) == (4, before), "Live data changed before authorised reset")
        result = store.apply("release-admin", reset_command(store, "ctf-fresh-world-" + stage.name[-16:]), "Fresh world")
        reset_applied = True
        after = verify_reset(database, before, previous, result)
        manifest = {"contentVersion": 5, "schema": 4, "before": before, "after": after,
                    "beforeState": previous, "afterState": store.state(),
                    "modules": {name: digest(relay / name) for name in names}, "baseline": BASELINE}
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2))
        command("sudo", "-n", "systemctl", "start", "moorstead-world")
        ready()
        print("FREEPLAY_CTF_READY: content 5; pristine world; old world retained in checkpoint and backup; relay healthy")
    except Exception:
        if previous is not None:
            reset_applied = reset_applied or Store(database).state()["epoch"] != previous["epoch"]
        if reset_applied:
            print("FREEPLAY_CTF_REQUIRES_ROLLFORWARD: fresh world and recovery checkpoint preserved")
        else:
            for name in EXPECTED:
                install(before_path / name, relay / name)
            target = relay / NEW
            if target.exists() and digest(target) == digest(stage / NEW):
                target.unlink()
            command("sudo", "-n", "systemctl", "start", "moorstead-world")
            print("FREEPLAY_CTF_FAILED_BEFORE_RESET: original world retained")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install-and-reset", action="store_true", required=True)
    parser.add_argument("--root", type=Path, default=Path("/home/james/moorstead"))
    args = parser.parse_args()
    upgrade(Path(__file__).resolve().parent, args.root.resolve())
