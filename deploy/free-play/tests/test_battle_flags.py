import unittest
from types import SimpleNamespace

from test_battle import flat_arena
from freeplay_battle import Battle
from freeplay_battle_ai import step
from freeplay_battle_service import BattleService
from freeplay_rules import Refused


class FlagTests(unittest.TestCase):
    def setUp(self):
        self.battle = Battle(flat_arena())
        self.battle.join("ablue", "Blue", "blue")
        self.battle.join("ared", "Red", "red")
        self.blue, self.red = self.battle.players["ablue"], self.battle.players["ared"]

    def activate(self):
        self.battle.flags.base("ablue")
        self.red.update(x=50, y=1, z=10)
        self.battle.flags.base("ared")
        self.battle.flags.set_ready("ablue")
        self.battle.flags.set_ready("ared")
        self.assertEqual(self.battle.flags.phase, "active")

    def pickup(self):
        self.blue.update(x=49, y=1, z=10)
        self.battle.flags.tick()
        self.assertEqual(self.battle.flags.flags["red"]["carrier"], "ablue")

    def test_setup_combat_refused_bases_use_supported_position_and_lock(self):
        with self.assertRaises(Refused):
            self.battle.shoot(self.blue, [1, 0, 0], "plasma")
        self.battle.flags.base("ablue")
        with self.assertRaises(Refused):
            self.battle.flags.base("ared")  # Original camps are only six apart.
        self.red.update(x=50, y=5)
        with self.assertRaises(Refused):
            self.battle.flags.base("ared")
        self.red.update(y=1)
        self.battle.arena.changes([[51, y, 10, 208] for y in (1, 2, 3)])
        with self.assertRaises(Refused):
            self.battle.flags.base("ared")  # Flag needs clear space around it.
        self.battle.arena.changes([[51, y, 10, 0] for y in (1, 2, 3)])
        self.battle.flags.base("ared")
        self.assertEqual(self.battle.flags.phase, "setup")
        self.battle.flags.set_ready("ablue")
        self.battle.flags.set_ready("ared")
        with self.assertRaises(Refused):
            self.battle.flags.base("ablue")
        self.assertEqual(self.battle.arena.camps["red"], [50, 1, 10])

    def test_pickup_capture_and_winner_freezes_combat(self):
        self.activate()
        self.pickup()
        with self.assertRaises(Refused):
            self.battle.rally("ablue")
        self.blue.update(x=10, z=10)
        self.battle.flags.tick()
        self.assertEqual((self.battle.flags.phase, self.battle.flags.winner), ("won", "blue"))
        self.battle.damage(self.red, 999, "blue")
        self.assertEqual(self.red["hp"], 100)
        with self.assertRaises(Refused):
            self.battle.shoot(self.blue, [1, 0, 0], "plasma")

    def test_wall_blocks_pickup_and_npcs_cannot_carry(self):
        self.activate()
        self.blue.update(x=48.5, z=10)
        self.battle.arena.changes([[49, y, 10, 208] for y in (1, 2, 3)])
        self.battle.flags.tick()
        self.assertEqual(self.battle.flags.flags["red"]["status"], "home")
        self.battle.recruit("ablue", 1)
        unit = next(iter(self.battle.soldiers.values()))
        unit.update(x=50, y=1, z=10)
        self.battle.flags.tick()
        self.assertEqual(self.battle.flags.flags["red"]["status"], "home")

    def test_knockout_drops_teammate_returns_and_timeout_returns(self):
        self.activate()
        self.pickup()
        self.battle.damage(self.blue, 999, "red")
        flag = self.battle.flags.flags["red"]
        self.assertEqual((flag["status"], flag["carrier"]), ("dropped", None))
        self.battle.flags.tick()  # Red is near its dropped flag.
        self.assertEqual(self.battle.flags.flags["red"]["status"], "home")
        self.battle.spawn(self.blue)
        self.pickup()
        self.red.update(x=90)
        self.battle.damage(self.blue, 999, "red")
        self.battle.now += 20
        self.battle.flags.tick()
        self.assertEqual(self.battle.flags.flags["red"]["status"], "home")

    def test_own_flag_must_be_home_and_absent_team_cannot_lose(self):
        self.activate()
        self.pickup()
        self.red.update(x=10)
        self.battle.flags.tick()
        self.blue.update(x=10)
        self.battle.flags.tick()
        self.assertIsNone(self.battle.flags.winner)
        self.battle.leave("ared")  # Red's carried blue flag returns automatically.
        self.assertEqual(self.battle.flags.flags["blue"]["status"], "home")
        self.battle.flags.tick()
        self.assertIsNone(self.battle.flags.winner)  # No red participant remains.
        self.battle.leave("ablue")
        self.assertEqual(self.battle.flags.phase, "setup")
        self.assertEqual(self.battle.flags.flags, {})

    def test_only_last_participant_leaving_resets_bases_and_round(self):
        self.activate()
        self.battle.scores["blue"] = 8
        self.battle.leave("aspectator")
        self.assertEqual(self.battle.flags.phase, "active")
        self.battle.leave("ared")
        self.assertEqual(self.battle.flags.bases["red"], [50, 1, 10])
        self.assertEqual(self.battle.flags.phase, "active")
        self.battle.arena.changes([[30, 1, 30, 208]])
        self.battle.leave("ablue")
        state = self.battle.state()
        self.assertEqual(state["ctf"], {"phase": "setup", "winner": None,
                                       "bases": {"blue": None, "red": None}, "flags": {},
                                       "ready": {"blue": False, "red": False}, "reason": None, "paused": False})
        self.assertEqual(state["scores"], {"blue": 0, "red": 0})
        self.assertEqual(state["camps"]["red"], [16, 1, 10])
        self.assertTrue(self.battle.arena.solid(30, 1, 30))

    def test_new_round_restores_default_camps_without_touching_terrain(self):
        self.activate()
        self.battle.arena.changes([[30, 1, 30, 208]])
        self.battle.reset()
        state = self.battle.state()["ctf"]
        self.assertEqual((state["phase"], state["winner"], state["flags"]), ("setup", None, {}))
        self.assertEqual(self.battle.arena.camps["red"], [16, 1, 10])
        self.assertTrue(self.battle.arena.solid(30, 1, 30))

    def test_custom_base_under_roof_respawns_at_selected_floor(self):
        self.battle.arena.changes([[x, 4, z, 208] for x in range(8, 13) for z in range(8, 13)])
        self.battle.flags.base("ablue")
        self.blue.update(x=30)
        self.battle.rally("ablue")
        self.assertEqual((self.blue["x"], self.blue["y"], self.blue["z"]), (10, 1, 10))

    def test_large_bomb_ban_covers_participant_and_spectator_overlap(self):
        service = object.__new__(BattleService)
        service.core = self.battle
        spectator, blue = SimpleNamespace(pid="aspectator"), SimpleNamespace(pid="ablue")
        for peer, center in ((blue, [300, 1, 300]), (spectator, [-39, 1, 64]), (spectator, [64, 63, 64])):
            with self.assertRaises(Refused):
                service.plan_damage(peer, {"type": "blast", "bomb": "atom", "center": center})
        service.block_large_bombs(spectator, {"type": "blast", "bomb": "atom", "center": [-41, 1, 64]})
        self.battle.leave("ablue")
        self.battle.leave("ared")
        service.block_large_bombs(spectator, {"type": "blast", "bomb": "atom", "center": [64, 1, 64]})


if __name__ == "__main__":
    unittest.main()
