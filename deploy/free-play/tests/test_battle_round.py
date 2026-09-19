import math
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

from test_battle import flat_arena
from freeplay_battle import Battle
from freeplay_battle_ai import step
from freeplay_battle_service import BattleService
from freeplay_battle_terrain import Arena
from freeplay_rules import Refused


def prepared():
    battle = Battle(flat_arena())
    battle.join("ablue", "Blue", "blue")
    battle.join("ared", "Red", "red")
    battle.players["ared"].update(x=50, y=1, z=10)
    return battle


def started():
    battle = prepared()
    for pid in ("ablue", "ared"):
        battle.flags.set_ready(pid)
        battle.recruit(pid, 6)
    return battle


class RoundTests(unittest.TestCase):
    def test_one_button_places_flags_and_both_readies_start_the_round(self):
        battle = prepared()
        battle.flags.set_ready("ablue")
        self.assertEqual(battle.flags.phase, "setup")
        self.assertEqual(battle.flags.ready, {"blue": True, "red": False})
        battle.flags.base("ablue")
        self.assertFalse(battle.flags.ready["blue"])
        battle.flags.set_ready("ared")
        battle.flags.set_ready("ablue")
        self.assertEqual(battle.flags.phase, "active")

    def test_disconnect_preserves_army_pauses_game_time_and_reconnect_resumes(self):
        battle = started()
        army = {key: value.copy() for key, value in battle.soldiers.items()}
        battle.players["ablue"].update(hp=0, respawn=4)
        battle.disconnect("ared")
        before = battle.now
        step(battle, 12)
        self.assertEqual(battle.now, before)
        self.assertEqual(battle.players["ablue"]["respawn"], 4)
        self.assertEqual(battle.soldiers, army)
        self.assertEqual(battle.state()["players"][1]["reconnectIn"], 48)
        with self.assertRaises(Refused):
            battle.shoot(battle.players["ared"], [-1, 0, 0], "plasma")
        self.assertFalse(battle.move("ared", {"x": 51, "y": 1, "z": 10, "yaw": 0}))
        battle.reconnect("ared")
        self.assertFalse(battle.paused())
        self.assertEqual(len(battle.soldiers), 12)
        step(battle, 0.5)
        self.assertEqual(battle.players["ablue"]["respawn"], 3.5)

    def test_grace_expiry_forfeits_and_explicit_forfeit_preserves_winner(self):
        for timeout in (True, False):
            battle = started()
            if timeout:
                battle.disconnect("ared")
                step(battle, 60)
            else:
                battle.forfeit("ared")
            self.assertEqual((battle.flags.phase, battle.flags.winner, battle.flags.reason), ("won", "blue", "forfeit"))
            self.assertNotIn("ared", battle.players)
            self.assertEqual(len(battle.soldiers), 6)
            battle.leave("ablue")
            self.assertEqual(battle.flags.phase, "setup")

    def test_active_exit_and_global_reset_cannot_bypass_forfeit(self):
        battle = started()
        service = object.__new__(BattleService)
        service.core = battle
        peer = SimpleNamespace(pid="ablue")
        for kind in ("battle-leave", "battle-reset"):
            with self.assertRaises(Refused):
                service.execute(peer, {"type": kind})
        for pid in ("ablue", "aspectator"):
            for kind in ("reset", "restore"):
                with self.assertRaises(Refused):
                    service.plan_damage(SimpleNamespace(pid=pid), {"type": kind})
        self.assertFalse(battle.move("ablue", {"x": -1, "y": 1, "z": 10, "yaw": 0}))
        self.assertEqual(len(battle.soldiers), 12)

    def test_reconnecting_members_count_against_player_limit(self):
        battle = prepared()
        for number in range(6):
            battle.join("aextra" + str(number), "Extra", "blue")
        for pid in list(battle.players):
            battle.disconnect(pid)
        with self.assertRaises(Refused):
            battle.join("aoverflow", "Overflow", "red")
        battle.reconnect("ablue")
        self.assertEqual(len(battle.players), 8)

    def test_defend_holds_base_while_attack_advances(self):
        battle = started()
        battle.order("ablue", "defend", [100, 1, 100])
        for _ in range(10):
            step(battle, 0.2)
        defenders = [u for u in battle.soldiers.values() if u["team"] == "blue"]
        self.assertTrue(all(math.hypot(u["x"] - 10, u["z"] - 10) < 6 for u in defenders))

    def test_player_gun_cadence_uses_arrival_time_without_simulation_ticks(self):
        battle = started()
        player = battle.players["ablue"]
        for when in (100, 100.25, 100.5, 100.75):
            battle.shoot(player, [0, 1, 0], "machinegun", shot_time=when)
        self.assertEqual(battle.now, 0)
        self.assertEqual(len(battle.events), 4)
        with self.assertRaises(Refused):
            battle.shoot(player, [0, 1, 0], "machinegun", shot_time=100.9)
        self.assertEqual(player["shotAtReal"], 100.75)
        unit = next(iter(battle.soldiers.values()))
        battle.shoot(unit, [0, 1, 0], "machinegun", ai=True, shot_time=1000)
        with self.assertRaises(Refused):
            battle.shoot(unit, [0, 1, 0], "machinegun", ai=True, shot_time=2000)


class GeneratedArenaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        root = Path(__file__).resolve().parents[3]
        node = shutil.which("node")
        if node is None:
            raise RuntimeError("Node is required for the actual procedural battlefield test")
        subprocess.run([node, str(root / "scripts/export-freeplay-battlefield.mjs"), cls.directory.name],
                       cwd=root, check=True, capture_output=True, timeout=30)
        cls.header = Path(cls.directory.name) / "battlefield.json"

    def test_default_armies_fight_without_an_attack_order_after_ready(self):
        battle = Battle(Arena.load(self.header))
        for team in ("blue", "red"):
            pid = "a" + team
            battle.join(pid, team, team)
            for _ in range(4):
                battle.recruit(pid, 6)
        for _ in range(20):
            step(battle, 0.2)
        self.assertFalse(any(event["type"] == "hit" for event in battle.events))
        for pid in ("ablue", "ared"):
            battle.flags.set_ready(pid)
        hits = 0
        for _ in range(300):
            step(battle, 0.2)
            hits += sum(event["type"] == "hit" for event in battle.events)
            battle.events.clear()
        self.assertGreater(hits, 50)
        self.assertGreater(sum(battle.scores.values()), 5)
        self.assertEqual(len(battle.soldiers), 48)

    def test_real_terrain_crosshair_shot_knockout_and_cover(self):
        arena = Arena.load(self.header)
        battle = Battle(arena)
        for team in ("blue", "red"):
            battle.join("a" + team, team, team)
            battle.flags.set_ready("a" + team)
        blue, red = battle.players["ablue"], battle.players["ared"]
        red.update(x=blue["x"] + 20, z=blue["z"])
        red["y"] = arena.ground(red["x"], red["z"])
        eye = [blue["x"], blue["y"] + 1.62, blue["z"]]
        vector = [red[key] + (1 if key == "y" else 0) - eye[i] for i, key in enumerate(("x", "y", "z"))]
        length = math.sqrt(sum(value * value for value in vector))
        direction = [value / length for value in vector]
        mid_x, mid_z = math.floor(blue["x"] + 10), math.floor(blue["z"])
        wall = [[mid_x, y, z, 208] for y in range(1, 64) for z in range(mid_z - 2, mid_z + 3)]
        arena.changes(wall)
        battle.shoot(blue, direction, "plasma")
        self.assertEqual(red["shield"], 100)
        arena.changes([[x, y, z, None] for x, y, z, _ in wall])
        for _ in range(8):
            battle.now += 0.51
            battle.shoot(blue, direction, "plasma")
        self.assertEqual((red["hp"], red["respawn"]), (0, 5))
        self.assertTrue(all(event["sourceId"] == "ablue" for event in battle.events))


if __name__ == "__main__":
    unittest.main()
