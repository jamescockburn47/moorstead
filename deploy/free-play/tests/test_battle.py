from array import array
import hashlib
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worldsvc"))
from freeplay_battle import Battle
from freeplay_battle_ai import step
from freeplay_battle_terrain import Arena
from freeplay_rules import Refused


def flat_arena():
    values = array("H", [0]) * (128 * 128 * 64)
    for index in range(128 * 128):
        values[index] = 1
    raw = values.tobytes()
    header = {"version": 1, "width": 128, "height": 64, "seed": 419947177, "origin": [0, 0],
              "camps": {"blue": [10, 1, 10], "red": [16, 1, 10]}, "solidIds": [1, 200, 207, 208],
              "sha256": hashlib.sha256(raw).hexdigest()}
    return Arena(header, raw)


class BattleTests(unittest.TestCase):
    def setUp(self):
        self.arena = flat_arena()
        self.battle = Battle(self.arena)
        self.battle.flags.phase = "active"  # Isolate the existing combat mechanism from round setup.
        self.battle.join("ablue", "Blue", "blue")
        self.battle.join("ared", "Red", "red")

    def test_cover_blocks_and_removing_exact_cover_changes_same_shot(self):
        wall = [[12, y, 10, 208] for y in (1, 2, 3)]
        self.arena.changes(wall)
        self.battle.shoot(self.battle.players["ablue"], [1, 0, 0], "plasma")
        self.assertEqual(self.battle.players["ared"]["shield"], 100)
        self.arena.changes([[x, y, z, 0] for x, y, z, _ in wall])
        self.battle.now = 1
        self.battle.shoot(self.battle.players["ablue"], [1, 0, 0], "plasma")
        self.assertEqual(self.battle.players["ared"]["shield"], 75)

    def test_dome_team_immunity_and_regeneration_have_real_effect(self):
        red = self.battle.players["ared"]
        self.battle.shield("ared")
        self.battle.damage(red, 250, "blue")
        self.assertEqual((red["hp"], red["shield"]), (100, 100))
        self.battle.now = 13
        self.battle.damage(red, 120, "blue")
        self.assertEqual((red["hp"], red["shield"]), (80, 0))
        self.battle.damage(red, 500, "red")
        self.assertEqual(red["hp"], 80)
        with self.assertRaises(Refused):
            self.battle.shield("ared")
        self.battle.now = 17
        step(self.battle, 0.5)
        self.assertEqual(red["shield"], 5)

    def test_knockout_scoring_respawn_and_nonparticipant_immunity(self):
        red = self.battle.players["ared"]
        self.battle.damage(red, 250, "blue")
        self.battle.damage(red, 250, "blue")
        self.assertEqual(self.battle.scores["blue"], 3)
        self.assertEqual(red["respawn"], 5)
        with self.assertRaises(Refused):
            self.battle.alive("ared")
        old_sequence = red["spawnSeq"]
        for _ in range(10):
            step(self.battle, 0.5)
        self.assertEqual((red["hp"], red["shield"], red["respawn"]), (100, 100, 0))
        self.assertEqual(red["spawnSeq"], old_sequence + 1)
        with self.assertRaises(Refused):
            self.battle.alive("aspectator")

    def test_army_caps_orders_move_under_fire_and_disconnect_dismisses(self):
        for _ in range(4):
            self.battle.recruit("ablue", 6)
            self.battle.recruit("ared", 6)
        self.assertEqual(len(self.battle.soldiers), 48)
        blue_positions = {(unit["x"], unit["z"]) for unit in self.battle.soldiers.values() if unit["team"] == "blue"}
        self.assertEqual(len(blue_positions), 24)
        for order in ("follow", "hold"):
            self.battle.order("ablue", order, [30, 1, 30])
            with patch("freeplay_battle_ai.move") as moved, patch.object(self.battle, "shoot"):
                step(self.battle, 0.2)
            goals = {tuple(call.args[2]) for call in moved.call_args_list if call.args[1]["owner"] == "ablue"}
            self.assertEqual(len(goals), 24)
        with self.assertRaises(Refused):
            self.battle.recruit("ablue", 1)
        unit = next(unit for unit in self.battle.soldiers.values() if unit["owner"] == "ablue")
        old = unit["x"], unit["z"]
        self.battle.order("ablue", "hold", [unit["x"], 1, unit["z"] + 10])
        step(self.battle, 0.2)
        self.assertNotEqual((unit["x"], unit["z"]), old)  # Visible enemies cannot cancel a move order.
        self.battle.leave("ablue")
        self.assertEqual(len(self.battle.soldiers), 24)

    def test_recruit_reuses_vacant_team_slots_without_overlapping_survivors(self):
        self.battle.join("afriend", "Friend", "blue")
        self.battle.recruit("ablue", 6)
        self.battle.recruit("afriend", 6)
        self.battle.leave("ablue")
        self.battle.recruit("afriend", 6)
        self.assertEqual(len({unit["slot"] for unit in self.battle.soldiers.values()}), 12)

    def test_movement_bounds_rally_preserves_health_and_match_reset_preserves_terrain(self):
        blue = self.battle.players["ablue"]
        self.assertFalse(self.battle.move("ablue", {"x": 100, "y": 1, "z": 100, "yaw": 0}))
        self.assertFalse(self.battle.move("ablue", {"x": -1, "y": 1, "z": 10, "yaw": 0}))
        self.assertEqual(blue["correctionSeq"], 2)
        self.assertTrue(self.battle.move("ablue", {"x": 11, "y": 1, "z": 10, "yaw": 0}))
        blue.update(hp=40, shield=20)
        self.battle.rally("ablue")
        self.assertEqual((blue["hp"], blue["shield"], blue["x"]), (40, 20, 10))
        self.arena.changes([[20, 1, 20, 208]])
        self.battle.reset()
        self.assertTrue(self.arena.solid(20, 1, 20))
        self.assertEqual(blue["hp"], 100)

    def test_explosion_targets_use_cover_before_terrain_damage(self):
        self.arena.changes([[12, y, 10, 208] for y in (1, 2, 3)])
        before = self.battle.explosion_targets([10, 1, 10], 10, "blue")
        self.assertEqual(before, [])
        self.arena.changes([[12, y, 10, 0] for y in (1, 2, 3)])
        after = self.battle.explosion_targets([10, 1, 10], 10, "blue")
        self.assertEqual([target["id"] for target, _ in after], ["ared"])

    def test_fractional_clock_never_exceeds_client_timer_bounds(self):
        for _ in range(21):
            step(self.battle, 0.2)
        self.battle.shield("ablue")
        state = self.battle.state()
        self.assertTrue(0 <= state["shields"][0]["remaining"] <= 12)
        self.assertTrue(all(0 <= player["shieldCooldown"] <= 25 for player in state["players"]))


if __name__ == "__main__":
    unittest.main()
