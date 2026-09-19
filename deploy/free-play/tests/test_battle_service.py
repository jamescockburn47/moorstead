import asyncio
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worldsvc"))
from freeplay_battle import Battle
from freeplay_service import mount_freeplay
from fastapi import FastAPI
from test_battle import flat_arena
import test_service as original


class BattleServiceTests(unittest.TestCase):
    login = original.ServiceTests.login
    socket = original.ServiceTests.socket
    collect = original.ServiceTests.collect
    command = original.ServiceTests.command

    def setUp(self):
        original.ServiceTests.setUp(self)
        self.hub = self.app.state.freeplay_hub
        self.hub.battle.core = Battle(flat_arena())
        self.hub.battle.core.flags.phase = "active"  # These tests exercise the active-round service.

    def start(self, ws):
        original.ServiceTests.start(self, ws)
        return self.collect(ws, "battle-state")[-1]

    def send(self, ws, login, kind, **fields):
        peer = self.hub.peers["a" + login["acct"]]
        peer.last_battle = peer.last_command = 0
        ws.send_json({"type": "battle-" + kind, "epoch": self.hub.epoch, **fields})

    def test_two_teams_receive_same_armies_and_server_only_hits(self):
        with self.socket(self.henry) as henry, self.socket(self.james) as james:
            self.assertTrue(self.start(henry)["battle"]["available"])
            self.start(james)
            self.send(henry, self.henry, "join", team="blue")
            one, two = self.collect(henry, "battle-state")[-1], self.collect(james, "battle-state")[-1]
            self.assertEqual(one, two)
            self.send(james, self.james, "join", team="red")
            self.collect(henry, "battle-state")
            self.collect(james, "battle-state")
            self.send(henry, self.henry, "recruit", count=6)
            state = self.collect(henry, "battle-state")[-1]["battle"]
            self.collect(james, "battle-state")
            self.assertEqual(len(state["soldiers"]), 6)
            self.send(henry, self.henry, "shot", weapon="plasma", direction=[1, 0, 0])
            shot = self.collect(henry, "battle-event")[-1]
            self.assertEqual(shot["event"]["type"], "shot")
            hit = self.collect(henry, "battle-event")[-1]
            self.assertEqual(hit["event"]["targetId"], "a" + self.james["acct"])
            red = self.hub.battle.core.players["a" + self.james["acct"]]
            self.assertEqual(red["shield"], 75)
            self.assertEqual(self.hub.store.state()["revision"], 0)  # Bullets cannot forge terrain writes.

    def test_forged_shapes_epoch_and_nonparticipant_shots_are_refused(self):
        with self.socket(self.henry) as henry:
            self.start(henry)
            self.send(henry, self.henry, "shot", weapon="plasma", direction=[1, 0, 0])
            error = henry.receive_json()
            self.assertEqual((error["code"], error["command"]), ("battle-player", "battle-shot"))
            for fields in ({"weapon": "plasma", "direction": [1, 0, 0], "damage": 999},
                           {"weapon": "atom", "direction": [1, 0, 0]},
                           {"weapon": "plasma", "direction": [0, 0, 0]},
                           {"weapon": "plasma", "direction": [True, 0, 0]}):
                self.send(henry, self.henry, "shot", **fields)
                self.assertEqual(henry.receive_json()["type"], "error")
            henry.send_json({"type": "battle-join", "epoch": 999, "team": "blue"})
            self.assertEqual(henry.receive_json()["code"], "stale")
            self.assertEqual(self.hub.battle.core.players, {})

    def test_failed_terrain_commit_never_applies_prepared_battle_damage(self):
        with self.socket(self.henry) as henry, self.socket(self.james) as james:
            self.start(henry)
            self.start(james)
            self.send(henry, self.henry, "join", team="blue")
            self.collect(henry, "battle-state")
            self.collect(james, "battle-state")
            self.send(james, self.james, "join", team="red")
            self.collect(henry, "battle-state")
            self.collect(james, "battle-state")
            command = self.command("blast", bomb="demolition", center=[10, 1, 10])
            command["baseRevision"] = 99
            henry.send_json(command)
            self.assertEqual(henry.receive_json()["code"], "stale")
            red = self.hub.battle.core.players["a" + self.james["acct"]]
            self.assertEqual((red["hp"], red["shield"]), (100, 100))
            self.assertEqual(self.hub.store.state()["count"], 0)

    def test_reset_world_rehomes_battle_after_world_commit(self):
        self.hub.battle.core.flags.phase = "setup"
        with self.socket(self.henry) as henry:
            self.start(henry)
            self.send(henry, self.henry, "join", team="blue")
            self.collect(henry, "battle-state")
            before = self.hub.battle.core.players["a" + self.henry["acct"]]["spawnSeq"]
            henry.send_json(self.command("reset", confirm=True))
            frames = self.collect(henry, "battle-state")
            self.assertLess(next(i for i, row in enumerate(frames) if row["type"] == "commit"), len(frames) - 1)
            self.assertEqual(frames[-1]["epoch"], 2)
            self.assertGreater(frames[-1]["battle"]["players"][0]["spawnSeq"], before)

    def test_refused_movement_sends_authoritative_correction_without_respawn(self):
        with self.socket(self.henry) as henry:
            self.start(henry)
            self.send(henry, self.henry, "join", team="blue")
            state = self.collect(henry, "battle-state")[-1]["battle"]
            sequence = state["players"][0]["spawnSeq"]
            self.hub.battle.core.arena.changes([[12, y, 10, 208] for y in (1, 2, 3)])
            henry.send_json({"type": "pos", "epoch": 1, "x": 13, "y": 1, "z": 10, "yaw": 1})
            corrected = self.collect(henry, "battle-state")[-1]["battle"]["players"][0]
            self.assertEqual((corrected["x"], corrected["correctionSeq"], corrected["spawnSeq"]), (10, 1, sequence))
            self.assertGreater(self.hub.peers["a" + self.henry["acct"]].last_position, 0)

    def test_vehicle_and_battle_membership_are_exclusive_in_both_directions(self):
        self.hub.battle.core.flags.phase = "setup"
        self.hub.store.apply("aseed", self.command(edits=[[40, 1, 40, 206]]))
        self.hub.store.apply("aseed", self.command("vehicle-convert", core=[40, 1, 40],
                                                  **{"from": [40, 1, 40], "to": [40, 1, 40]}, mode="car"))
        vehicle_id = self.hub.store.vehicles()[0]["id"]
        with self.socket(self.henry) as henry:
            self.start(henry)
            self.send(henry, self.henry, "join", team="blue")
            self.collect(henry, "battle-state")
            claim = {"type": "vehicle-claim", "epoch": 1, "vehicleId": vehicle_id}
            henry.send_json(claim)
            self.assertEqual(henry.receive_json()["code"], "battle-vehicle")
            self.send(henry, self.henry, "leave")
            self.collect(henry, "battle-state")
            henry.send_json(claim)
            self.collect(henry, "vehicle-lease")
            self.send(henry, self.henry, "join", team="blue")
            self.assertEqual(henry.receive_json()["code"], "battle-vehicle")

    def test_socket_reconnect_restores_participation_and_army_without_rejoining(self):
        with self.socket(self.james) as james:
            self.start(james)
            self.send(james, self.james, "join", team="red")
            self.collect(james, "battle-state")
            with self.socket(self.henry) as henry:
                self.start(henry)
                self.send(henry, self.henry, "join", team="blue")
                self.collect(henry, "battle-state")
                self.collect(james, "battle-state")
                self.send(henry, self.henry, "recruit", count=6)
                self.collect(henry, "battle-state")
                self.collect(james, "battle-state")
                self.send(henry, self.henry, "leave")
                self.assertEqual(henry.receive_json()["code"], "battle-locked")
                henry.close()
                frames = self.collect(james, "leave")
            paused = next(frame["battle"] for frame in frames if frame["type"] == "battle-state")
            self.assertTrue(paused["ctf"]["paused"])
            self.assertEqual(len(paused["soldiers"]), 6)
            with self.socket(self.henry) as returned:
                resumed = self.start(returned)["battle"]
                self.assertFalse(resumed["ctf"]["paused"])
                self.assertEqual(len(resumed["soldiers"]), 6)
                self.send(returned, self.henry, "forfeit")
                won = self.collect(returned, "battle-state")[-1]["battle"]
                self.assertEqual((won["ctf"]["winner"], won["ctf"]["reason"]), ("red", "forfeit"))


class LifecycleTests(unittest.TestCase):
    def test_old_socket_cleanup_cannot_disconnect_or_remove_queued_replacement(self):
        async def run():
            with tempfile.TemporaryDirectory() as directory:
                app = FastAPI()
                hub = mount_freeplay(app, lambda *args: None, lambda *args: False, Path(directory))
                hub.battle.core = Battle(flat_arena())
                hub.battle.core.join("ablue", "Blue", "blue")
                hub.battle.core.recruit("ablue", 6)
                old, new = SimpleNamespace(pid="ablue"), SimpleNamespace(pid="ablue")
                hub.peers[old.pid] = old
                notices = []
                async def notice(value, skip=None):
                    notices.append(value)
                hub.notice = notice
                await hub.lock.acquire()
                cleanup = asyncio.create_task(hub.disconnect(old))
                await asyncio.sleep(0)
                async def reconnect():
                    async with hub.lock:
                        hub.peers[new.pid] = new
                        hub.battle.reconnect(new)
                replacement = asyncio.create_task(reconnect())
                await asyncio.sleep(0)
                hub.lock.release()
                await asyncio.gather(cleanup, replacement)
                self.assertIs(hub.peers["ablue"], new)
                self.assertTrue(hub.battle.core.players["ablue"]["connected"])
                self.assertEqual(len(hub.battle.core.soldiers), 6)
                self.assertEqual(notices, [])
        asyncio.run(run())

    def test_router_lifecycle_starts_and_stops_without_app_event_helper(self):
        async def run():
            with tempfile.TemporaryDirectory() as directory:
                app = FastAPI()
                boundary = SimpleNamespace(router=app.router, add_api_websocket_route=app.add_api_websocket_route)
                hub = mount_freeplay(boundary, lambda *args: None, lambda *args: False, Path(directory))
                hub.battle.core = Battle(flat_arena())
                async with app.router.lifespan_context(app):
                    self.assertIsNotNone(hub.battle.task)
                    self.assertFalse(hub.battle.task.done())
                self.assertTrue(hub.battle.task.done())
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
