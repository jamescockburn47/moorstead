from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worldsvc"))
from freeplay_builds import BRUSHES, MAX_BUILD, PREFABS, build_cells
from freeplay_rules import MAX_CELLS, MAX_CHUNKS, MAX_INVERSE_CELLS, Refused, validate_command, weapon_cells
from freeplay_store import Store
import test_store as original


class PackTests(unittest.TestCase):
    setUp = original.StoreTests.setUp
    command = original.StoreTests.command
    apply = original.StoreTests.apply
    cells = original.StoreTests.cells

    def build(self, shape="box", **changes):
        fields = {"shape": shape, "origin": [0, 10, 0], "rotation": 0, "block": 200}
        if shape in BRUSHES:
            fields["size"] = 5
        return self.command("build", **(fields | changes))

    def test_all_shapes_bounded_unique_and_build_undo_is_atomic(self):
        for shape in BRUSHES | PREFABS.keys():
            for rotation in range(4):
                command = self.build(shape, rotation=rotation)
                rows = build_cells(command)
                self.assertLessEqual(len(rows), MAX_BUILD)
                self.assertEqual(len(rows), len({tuple(row[:3]) for row in rows}))
        self.apply(edits=[[2, 11, 2, 8], [0, 10, 0, 4]])
        before = self.cells()
        command = self.build()
        result = self.store.apply("ahenry", command)
        self.assertEqual(result["kind"], "build")
        self.assertEqual(result["shape"], "box")
        self.assertIn([2, 11, 2, 0], self.cells())
        self.assertEqual(result["history"][0]["kind"], "build")
        self.assertTrue(self.store.apply("ahenry", command)["duplicate"])
        self.assertEqual(self.store.state()["revision"], 2)
        self.apply("undo")
        self.assertEqual(self.cells(), before)

    def test_shape_validation_and_full_bounds_never_clip(self):
        self.apply(edits=[[0, 10, 0, 8]])
        before = self.store.state(), self.cells()
        invalid = [self.build(size=4), self.build(block=0), self.build(block=True),
                   self.build(block=199), self.build(block=206), self.build(rotation=4),
                   self.build(rotation=False), self.build(shape="unknown"),
                   self.build(origin=[0, 60, 0]), self.build(origin=[8191, 10, 0]),
                   self.build(origin=[-8191, 10, 0], rotation=2), self.build("base", size=5),
                   self.build("tower", origin=[0, 56, 0])]
        for command in invalid:
            with self.subTest(command=command), self.assertRaises(Refused):
                self.store.apply("ahenry", command)
            self.assertEqual((self.store.state(), self.cells()), before)
        exact = self.build("line", origin=[8190, 63, 8192], size=3)
        self.assertEqual(build_cells(exact)[-1], [8192, 63, 8192, 200])

    def test_future_blocks_persist_in_cells_checkpoint_and_inverse(self):
        self.apply(edits=[[index, 20, 0, 200 + index] for index in range(6)])
        before = self.cells()
        self.apply("reset", confirm=True)
        self.store = Store(self.path)
        self.apply("restore", confirm=True)
        self.assertEqual(self.cells(), before)
        self.apply("weapon", weapon="plasma", center=[2, 20, 0])
        self.store = Store(self.path)
        self.apply("undo")
        self.assertEqual(self.cells(), before)

    def test_gravity_is_ordered_idempotent_event_preserving_undo(self):
        self.apply(edits=[[0, 20, 0, 205]])
        before = self.store.state(), self.cells()
        gravity = self.command("weapon", weapon="gravity", center=[0, 20, 0])
        result = self.store.apply("ahenry", gravity)
        self.assertEqual(result["changes"], [])
        self.assertEqual(result["revision"], 2)
        self.assertEqual(result["weapon"], "gravity")
        self.assertEqual(result["center"], [0, 20, 0])
        self.assertEqual((result["history"], self.cells()), (before[0]["history"], before[1]))
        self.assertTrue(self.store.apply("ahenry", gravity)["duplicate"])
        self.assertEqual(self.store.state()["revision"], 2)
        with self.assertRaises(Refused):
            self.store.apply("ahenry", dict(gravity, center=[1, 20, 0]))
        self.apply("undo")
        self.assertEqual(self.cells(), [])

    def test_weapons_have_fixed_damage_and_cannot_forge_radius(self):
        self.assertEqual(list(weapon_cells("gravity", [0, 30, 0])), [])
        plasma = list(weapon_cells("plasma", [0, 30, 0]))
        rocket = list(weapon_cells("rocket", [0, 30, 0]))
        self.assertGreater(len(rocket), len(plasma))
        self.assertIn([0, 28, 0, 0], plasma)
        self.assertIn([0, 33, 0, 0], plasma)
        self.assertNotIn([0, 34, 0, 0], plasma)
        self.assertTrue(all(abs(row[0]) <= 2 and abs(row[2]) <= 2 for row in plasma))
        self.assertTrue(all(1 <= row[1] <= 63 for row in weapon_cells("rocket", [8192, 1, 8192])))
        valid = self.command("weapon", weapon="rocket", center=[0, 30, 0])
        for command in (dict(valid, radius=20), dict(valid, weapon="atom"),
                        dict(valid, damage=9), dict(valid, edits=[[0, 1, 0, 0]])):
            with self.assertRaises(Refused):
                validate_command(command)

    def test_two_million_cell_capacity_preserves_other_resource_bounds(self):
        self.assertEqual((MAX_CELLS, MAX_CHUNKS, MAX_INVERSE_CELLS), (2_000_000, 1024, 400_000))
        with self.store.connect() as db:
            changes, _ = self.store.edit(db, [[0, 20, 0, 200]], MAX_CELLS - 1)
            self.assertEqual(changes, [[0, 20, 0, 200]])
        with self.assertRaises(Refused), self.store.connect() as db:
            self.store.edit(db, [[0, 20, 0, 201], [1, 20, 0, 202]], MAX_CELLS)
        self.assertEqual(self.cells(), [[0, 20, 0, 200]])

    def test_content_one_migration_preserves_world_recovery_history_receipts(self):
        self.apply(edits=[[0, 10, 0, 8]])
        self.apply("reset", confirm=True)
        command = self.command(edits=[[1, 10, 0, 4]])
        self.store.apply("ahenry", command)
        before = self.store.state(), self.cells()
        with self.store.connect() as db:
            db.execute("PRAGMA user_version=1")
            checkpoint = list(db.execute("SELECT * FROM checkpoint"))
        migrated = Store(self.path)
        self.assertEqual((migrated.state(), self.cells()), before)
        self.assertTrue(migrated.apply("ahenry", command)["duplicate"])
        with migrated.connect() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 2)
            self.assertEqual(list(db.execute("SELECT * FROM checkpoint")), checkpoint)
        self.apply("undo")
        self.assertEqual(self.cells(), [])
        self.apply("restore", confirm=True)
        self.assertEqual(self.cells(), [[0, 10, 0, 8]])


if __name__ == "__main__":
    unittest.main()
