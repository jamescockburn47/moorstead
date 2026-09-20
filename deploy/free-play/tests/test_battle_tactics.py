import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from test_battle import flat_arena
from freeplay_battle import Battle
from freeplay_battle_ai import step
from freeplay_battle_breach import breach, commit_breaches
from freeplay_battle_equipment import step_equipment
from freeplay_rules import Refused
from freeplay_store import Store


class TacticsTests(unittest.TestCase):
    def setUp(self):
        self.b = Battle(flat_arena())
        self.b.join('ablue', 'Blue', 'blue')
        self.b.join('ared', 'Red', 'red')
        self.b.flags.phase = 'active'

    def test_batches_cooldown_squads_and_atomic_cap(self):
        b = self.b
        b.recruit('ablue', 10)
        with self.assertRaises(Refused):
            b.recruit('ablue', 10)
        self.assertEqual(len(b.soldiers), 10)
        self.assertEqual(b.state()['players'][0]['recruitCooldown'], 25)
        for now in (25, 50):
            b.now = now
            b.recruit('ablue', 10)
        self.assertEqual({u['squad'] for u in b.soldiers.values()}, {1, 2, 3})
        b.order('ablue', 'hold', [50, 1, 10], 2)
        self.assertEqual(sum(u['order'] == 'hold' for u in b.soldiers.values()), 10)
        self.assertTrue(all(u['order'] == 'attack' for u in b.soldiers.values() if u['squad'] != 2))
        b.now = 75
        with self.assertRaises(Refused):
            b.recruit('ablue', 1)
        self.assertEqual(len(b.soldiers), 30)

    def test_casualties_return_in_same_wave_not_individual_timers(self):
        b = self.b
        b.recruit('ablue', 2)
        first, second = b.soldiers.values()
        b.now = 2
        b.damage(first, 100, 'red')
        b.now = 5
        first['respawn'] -= 3  # Advance the first timer by the same elapsed time.
        b.damage(second, 100, 'red')
        self.assertEqual((first['respawn'], second['respawn']), (20, 20))
        b.flags.phase = 'setup'  # No shots during timer assertion.
        for _ in range(39):
            step(b, .5)
        self.assertEqual((first['hp'], second['hp']), (0, 0))
        step(b, .5)
        self.assertEqual((first['hp'], second['hp']), (50, 50))

    def test_equipment_fires_moderately_cover_blocks_and_tank_moves(self):
        b = self.b
        b.deploy('ablue', 'turret', [10, 1, 15], 1)
        turret = next(iter(b.equipment.values()))
        red = b.players['ared']
        red.update(x=16, z=15, shield=0)
        b.now = 2
        step_equipment(b, .2, lambda *args: None)
        self.assertEqual(red['hp'], 94)
        b.arena.changes([[12, y, 15, 208] for y in (1, 2, 3)])
        b.now = 4
        step_equipment(b, .2, lambda *args: None)
        self.assertEqual(red['hp'], 94)
        b.now = 20
        b.deploy('ablue', 'tank', [10, 1, 20], 2)
        tank = list(b.equipment.values())[-1]
        red.update(x=16, z=20)
        b.now = 24
        turret["shotAt"] = 24  # Isolate the tank shot.
        step_equipment(b, .2, lambda *args: None)
        self.assertEqual(red['hp'], 66)
        b.order('ablue', 'hold', [10, 1, 30], 2)
        z = tank['z']
        step(b, .2)
        self.assertGreater(tank['z'], z)
        self.assertEqual(turret['order'], 'hold')
        b.damage(tank, 500, 'red')
        step(b, .2)
        self.assertNotIn(tank['id'], b.equipment)

    def test_tank_defends_flag_instead_of_players_order_location(self):
        b = self.b
        b.deploy('ablue', 'tank', [10, 1, 20], 2)
        tank = next(iter(b.equipment.values()))
        b.arena.camps['blue'] = [10, 1, 10]
        b.order('ablue', 'defend', [10, 1, 40], 2)
        step(b, .2)
        self.assertLess(tank['z'], 20, 'defend must head toward the flag, away from the order location')

    def test_breach_is_gradual_and_committed_shared_undoable(self):
        b = self.b
        b.recruit('ablue', 1)
        unit = next(iter(b.soldiers.values()))
        unit.update(x=10, y=1, z=10)
        b.arena.changes([[12, y, 10, 208] for y in (1, 2)])
        for now in (0, 1, 2):
            b.now = now
            breach(b, unit, [50, 1, 10])
        self.assertFalse(b.breaches)
        b.now = 3
        breach(b, unit, [50, 1, 10])
        self.assertEqual(b.breaches, {(12, 1, 10)})
        self.assertTrue(b.arena.solid(12, 1, 10), 'collision cannot change before durable commit')
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / 'world.sqlite')
            control = SimpleNamespace(check_edit=lambda _: None, changed=lambda _: None, pilots=lambda: {})
            hub = SimpleNamespace(store=store, peers={}, control=control)
            service = SimpleNamespace(core=b, hub=hub)
            with patch.object(store, 'apply', side_effect=OSError('simulated disk failure')):
                with self.assertRaises(OSError):
                    asyncio.run(commit_breaches(service))
            self.assertTrue(b.arena.solid(12, 1, 10))
            b.now = 4
            asyncio.run(commit_breaches(service))
            self.assertFalse(b.arena.solid(12, 1, 10))
            state = store.state()
            self.assertEqual(state['revision'], 1)
            result = store.apply('fixture', {'type': 'undo', 'requestId': 'undo-breach',
                                           'epoch': state['epoch'], 'baseRevision': state['revision']})
            self.assertEqual(result['changes'], [[12, 1, 10, None]])

    def test_attack_breaches_enclosure_and_captures_high_flag(self):
        b = self.b
        b.flags.bases = {'blue': [10, 1, 10], 'red': [50, 40, 10]}
        for team in ('blue', 'red'):
            b.flags.home(team)
        b.players['ared'].update(x=80, z=80)
        b.recruit('ablue', 1)
        b.order('ablue', 'attack', [50, 1, 10])
        walls = [[x, y, z, 208] for x in range(43, 58) for z in range(3, 18)
                 for y in range(1, 6) if x in (43, 57) or z in (3, 17)]
        b.arena.changes(walls)
        opened = set()
        for _ in range(600):
            step(b, .2)
            # The persistence/broadcast boundary is covered separately above.
            opened.update(b.breaches)
            b.arena.changes([[*point, 0] for point in b.breaches])
            for point in b.breaches:
                b.wall_damage.pop(point, None)
            b.breaches.clear()
            if b.flags.winner:
                break
        self.assertEqual(b.flags.winner, 'blue', 'must actually traverse the breach and reach the zone')
        self.assertGreaterEqual(len(opened), 4, 'shoulders need a wider opening than a single ray')


if __name__ == '__main__':
    unittest.main()
