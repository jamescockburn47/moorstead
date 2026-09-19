import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worldsvc"))
from freeplay_rules import BOMBS, MAX_INVERSE_CELLS, Refused, blast_cells, validate_command
from freeplay_store import Store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "world.sqlite3"
        self.store = Store(self.path)
        self.serial = 0

    def command(self, kind="edit", **fields):
        self.serial += 1
        state = self.store.state()
        return {"type": kind, "epoch": state["epoch"], "baseRevision": state["revision"],
                "requestId": f"request-{self.serial}", **fields}

    def apply(self, kind="edit", **fields):
        return self.store.apply("ahenry", self.command(kind, **fields), "Henry")

    def cells(self):
        return [cell for batch in self.store.snapshot() for cell in batch]

    def test_persistent_edits_undo_exact_override_and_baseline(self):
        self.apply(edits=[[15, 40, -1, 8], [16, 40, -1, 4]])
        self.apply(edits=[[15, 40, -1, 0]])
        fresh = Store(self.path)
        self.assertEqual(fresh.state()["revision"], 2)
        self.assertEqual(len(self.cells()), 2)
        restored = self.apply("undo")
        self.assertEqual(restored["changes"], [[15, 40, -1, 8]])
        baseline = self.apply("undo")
        self.assertEqual(baseline["changes"], [[15, 40, -1, None], [16, 40, -1, None]])
        self.assertEqual(self.cells(), [])

    def test_forward_schema_refusal(self):
        with self.store.connect() as db:
            db.execute("PRAGMA user_version=2")
        with self.assertRaisesRegex(ValueError, "newer unsupported"):
            Store(self.path)
        with self.store.connect() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 2)

    def test_backup_restores_persistent_world_and_checkpoint(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from backup import backup
        self.apply(edits=[[2, 40, 2, 8]])
        self.apply("reset", confirm=True)
        self.apply(edits=[[3, 40, 3, 4]])
        destination = Path(self.directory.name) / "recovered.sqlite3"
        backup(self.path, destination)
        recovered = Store(destination)
        self.assertEqual(recovered.state(), self.store.state())
        self.assertEqual(list(recovered.snapshot()), [[[3, 40, 3, 4]]])
        recovered.apply("ahenry", self.command("restore", confirm=True))
        self.assertEqual(list(recovered.snapshot()), [[[2, 40, 2, 8]]])
        with self.assertRaises(ValueError):
            backup(self.path, destination)

    def test_idempotency_identity_and_conflicts(self):
        command = self.command(edits=[[1, 20, 1, 8]])
        result = self.store.apply("ahenry", command)
        receipt = self.store.apply("ahenry", command)
        self.assertTrue(receipt["duplicate"])
        self.assertEqual(receipt["appliedRevision"], result["revision"])
        for value in [dict(command, edits=[[1, 20, 1, 3]]),
                      dict(command, requestId="different", epoch=999),
                      dict(command, requestId="different")]:
            with self.assertRaises(Refused):
                self.store.apply("ahenry", value)
        with self.assertRaises(Refused):
            self.store.apply("ajames", command)
        self.assertEqual(self.store.state()["revision"], 1)

    def test_reset_restore_repeated_reset_and_old_messages(self):
        original = [[20, 30, 20, 7], [-20, 20, -20, 0]]
        self.apply(edits=original)
        stale = self.command(edits=[[0, 1, 0, 8]])
        reset = self.apply("reset", confirm=True)
        self.assertEqual(reset["epoch"], 2)
        self.assertEqual(self.cells(), [])
        self.assertEqual(reset["history"], [])
        self.assertTrue(reset["checkpoint"])
        self.apply("reset", confirm=True)
        self.assertEqual(self.store.state()["epoch"], 3)
        with self.assertRaisesRegex(Refused, "world changed"):
            self.store.apply("ahenry", stale)
        self.store = Store(self.path)
        self.apply("restore", confirm=True)
        self.assertEqual(sorted(self.cells()), sorted(original))
        self.assertEqual(self.store.state()["epoch"], 4)
        self.apply("restore", confirm=True)
        self.assertEqual(self.cells(), [])  # Restore swaps, preserving the other state.

    def test_transaction_rolls_back_partial_write(self):
        self.apply(edits=[[1, 30, 1, 8]])
        with self.store.connect() as db:
            db.execute("CREATE TRIGGER fail_insert BEFORE INSERT ON cells "
                       "WHEN NEW.x=3 BEGIN SELECT RAISE(ABORT,'test failure'); END")
        with self.assertRaises(Exception):
            self.apply(edits=[[2, 30, 1, 4], [3, 30, 1, 4]])
        self.assertEqual(self.cells(), [[1, 30, 1, 8]])
        self.assertEqual(self.store.state()["revision"], 1)
        self.assertEqual(len(self.store.state()["history"]), 1)

    def test_limits_are_atomic_and_undo_remains_available(self):
        self.apply(edits=[[0, 20, 0, 8]])
        for setting, limit, edits in [
            ("MAX_CELLS", 1, [[0, 20, 0, 9], [1, 20, 1, 4]]),
            ("MAX_CHUNKS", 1, [[0, 20, 0, 9], [16, 20, 0, 4]])]:
            with patch("freeplay_store." + setting, limit), self.assertRaises(Refused):
                self.apply(edits=edits)
            self.assertEqual(self.cells(), [[0, 20, 0, 8]])
        self.apply("undo")
        self.assertEqual(self.cells(), [])

    def test_retained_history_is_bounded(self):
        for index in range(24):
            self.apply(edits=[[index, 20, 0, 8]])
        self.assertEqual(len(self.store.state()["history"]), 20)
        for _ in range(20):
            self.apply("undo")
        self.assertEqual(len(self.cells()), 4)
        with self.assertRaises(Refused):
            self.apply("undo")

    def test_all_bombs_strict_growth_and_bedrock_survives(self):
        previous = 0
        for bomb in BOMBS:
            cells = list(blast_cells(bomb, [0, 30, 0]))
            self.assertGreater(len(cells), previous)
            self.assertLessEqual(len(cells), MAX_INVERSE_CELLS)
            self.assertTrue(all(1 <= row[1] <= 63 and row[3] == 0 for row in cells))
            self.assertEqual(len(cells), len({tuple(cell[:3]) for cell in cells}))
            previous = len(cells)
        self.assertTrue([0, 63, 0, 0] in cells)
        self.assertTrue([0, 12, 0, 0] in cells)
        self.assertFalse([0, 11, 0, 0] in cells)
        self.assertGreater(len({(x >> 4, z >> 4) for x, _, z, _ in cells}), 16)

    def test_atom_persistence_and_undo_known_building(self):
        self.apply(edits=[[0, 63, 0, 8], [16, 40, 0, 19]])
        original = self.cells()
        atom = self.apply("blast", bomb="atom", center=[0, 30, 0])
        self.assertGreater(len(atom["changes"]), 200000)
        self.assertEqual(self.cells()[0][3], 0)
        self.store = Store(self.path)
        self.assertEqual(self.store.state()["revision"], 2)
        self.apply("undo")
        self.assertEqual(self.cells(), original)

    def test_malicious_shapes_refused(self):
        valid = self.command("blast", bomb="atom", center=[0, 30, 0])
        invalid = [dict(valid, radius=9999), dict(valid, room="moor"), dict(valid, epoch=True),
                   dict(valid, epoch=2**53), dict(valid, bomb="unknown"),
                   dict(valid, center=[0, 0, 0]), dict(valid, center=[8193, 20, 0]),
                   dict(valid, center=[0, 2.5, 0]), dict(valid, requestId="short"),
                   self.command(edits=[[0, 1, 0, None]]),
                   self.command(edits=[[0, 1, 0, 63]]),
                   self.command(edits=[[0, 1, 0, 8]] * 2),
                   self.command("reset", confirm="yes")]
        for command in invalid:
            with self.subTest(command=command), self.assertRaises(Refused):
                validate_command(command)
        self.assertEqual(self.store.state()["revision"], 0)


if __name__ == "__main__":
    unittest.main()
