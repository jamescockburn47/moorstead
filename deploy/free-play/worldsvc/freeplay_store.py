"""Atomic Free Play overrides, bounded inverse history and reset recovery."""
import hashlib
import json
import sqlite3
import zlib
from contextlib import contextmanager
from pathlib import Path

from freeplay_rules import (MAX_CELLS, MAX_CHUNKS, MAX_HISTORY, MAX_INVERSE_CELLS, MAX_RECEIPTS,
                            ROOM, SEED, Refused, blast_cells, packed, validate_command)


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            if db.execute("PRAGMA user_version").fetchone()[0] not in {0, 1}:
                raise ValueError("Free Play database uses a newer unsupported schema")
            db.executescript("""
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS meta (
                singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                room TEXT NOT NULL, seed TEXT NOT NULL,
                epoch INTEGER NOT NULL, revision INTEGER NOT NULL,
                has_checkpoint INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE IF NOT EXISTS cells (
                x INTEGER, y INTEGER, z INTEGER, id INTEGER NOT NULL,
                PRIMARY KEY(x,y,z)) WITHOUT ROWID;
              CREATE TABLE IF NOT EXISTS checkpoint (
                x INTEGER, y INTEGER, z INTEGER, id INTEGER NOT NULL,
                PRIMARY KEY(x,y,z)) WITHOUT ROWID;
              CREATE TABLE IF NOT EXISTS history (
                revision INTEGER PRIMARY KEY, actor TEXT NOT NULL,
                kind TEXT NOT NULL, bomb TEXT, count INTEGER NOT NULL,
                inverse BLOB NOT NULL);
              CREATE TABLE IF NOT EXISTS receipts (
                serial INTEGER PRIMARY KEY AUTOINCREMENT,
                actor TEXT NOT NULL, request_id TEXT NOT NULL,
                digest TEXT NOT NULL, epoch INTEGER NOT NULL,
                revision INTEGER NOT NULL, UNIQUE(actor,request_id));
            """)
            db.execute("INSERT OR IGNORE INTO meta VALUES (1,?,?,1,0,0)", (ROOM, SEED))
            meta = db.execute("SELECT room,seed FROM meta").fetchone()
            if tuple(meta) != (ROOM, str(SEED)):
                raise ValueError("Free Play database belongs to another room or seed")
            db.execute("PRAGMA user_version=1")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA busy_timeout=10000")
        try:
            with db:
                yield db
        finally:
            db.close()

    def state(self, db=None):
        if db is None:
            with self.connect() as connection:
                return self.state(connection)
        meta = db.execute("SELECT epoch,revision,has_checkpoint FROM meta").fetchone()
        history = [dict(row) for row in db.execute(
            "SELECT revision,actor,kind,bomb FROM history ORDER BY revision DESC")]
        return {"epoch": meta["epoch"], "revision": meta["revision"],
                "checkpoint": bool(meta["has_checkpoint"]), "history": history,
                "count": db.execute("SELECT COUNT(*) FROM cells").fetchone()[0]}

    def snapshot(self, batch=512):
        with self.connect() as db:
            cursor = db.execute("SELECT x,y,z,id FROM cells ORDER BY x,y,z")
            while rows := cursor.fetchmany(batch):
                yield [list(row) for row in rows]

    def apply(self, actor, value, display=None):
        command = validate_command(value)
        digest = hashlib.sha256(packed(command).encode()).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            state = self.state(db)
            receipt = db.execute("SELECT * FROM receipts WHERE actor=? AND request_id=?",
                                 (actor, command["requestId"])).fetchone()
            if receipt:
                if receipt["digest"] != digest:
                    raise Refused("request-reuse", "That request identifier has already been used.")
                return {"type": "ack", "duplicate": True, "requestId": command["requestId"],
                        "epoch": state["epoch"], "revision": state["revision"],
                        "appliedEpoch": receipt["epoch"], "appliedRevision": receipt["revision"]}
            if command["epoch"] != state["epoch"] or command["baseRevision"] != state["revision"]:
                raise Refused("stale", "The world changed. Reconnect before trying again.")
            revision, epoch = state["revision"] + 1, state["epoch"]
            kind = command["type"]
            replace = kind in {"reset", "restore"}
            if replace:
                self.replace(db, kind, state)
                epoch += 1
                changes = None  # Stream the replacement from disk, never load all cells.
            elif kind == "undo":
                changes = self.undo(db)
            else:
                edits = command["edits"] if kind == "edit" else blast_cells(command["bomb"], command["center"])
                changes, inverse = self.edit(db, edits, state["count"])
                if inverse:
                    db.execute("INSERT INTO history VALUES (?,?,?,?,?,?)", (
                        revision, display or actor, kind, command.get("bomb"), len(inverse),
                        zlib.compress(packed(inverse).encode(), 1)))
                    self.trim_history(db)
            db.execute("UPDATE meta SET epoch=?,revision=?", (epoch, revision))
            db.execute("INSERT INTO receipts(actor,request_id,digest,epoch,revision) VALUES(?,?,?,?,?)",
                       (actor, command["requestId"], digest, epoch, revision))
            db.execute("DELETE FROM receipts WHERE serial NOT IN "
                       "(SELECT serial FROM receipts ORDER BY serial DESC LIMIT ?)", (MAX_RECEIPTS,))
            result = {"type": "operation", "kind": kind, "actor": display or actor,
                      "requestId": command["requestId"], "replace": replace,
                      "changes": changes, **self.state(db)}
            if kind == "blast":
                result.update(bomb=command["bomb"], center=command["center"])
            return result

    @staticmethod
    def edit(db, edits, count):
        changes, inverse = [], []
        chunks = {tuple(row) for row in db.execute("SELECT DISTINCT x >> 4, z >> 4 FROM cells")}
        for x, y, z, block in edits:
            row = db.execute("SELECT id FROM cells WHERE x=? AND y=? AND z=?", (x, y, z)).fetchone()
            previous = row[0] if row else None
            if previous == block:
                continue
            if previous is None:
                count += 1
                if count > MAX_CELLS:
                    raise Refused("world-limit", "This world is full. Undo or reset to keep building.")
                chunks.add((x >> 4, z >> 4))
                if len(chunks) > MAX_CHUNKS:
                    raise Refused("world-limit", "This world covers its limit. Undo or reset to explore farther.")
            inverse.append([x, y, z, previous])
            changes.append([x, y, z, block])
        db.executemany("INSERT OR REPLACE INTO cells VALUES(?,?,?,?)", changes)
        return changes, inverse

    @staticmethod
    def trim_history(db):
        total = 0
        for index, row in enumerate(db.execute("SELECT revision,count FROM history ORDER BY revision DESC")):
            total += row["count"]
            if index >= MAX_HISTORY or total > MAX_INVERSE_CELLS:
                db.execute("DELETE FROM history WHERE revision<=?", (row["revision"],))
                break

    @staticmethod
    def undo(db):
        row = db.execute("SELECT revision,inverse FROM history ORDER BY revision DESC LIMIT 1").fetchone()
        if not row:
            raise Refused("empty-history", "There is no earlier shared action to undo.")
        changes = json.loads(zlib.decompress(row["inverse"]))
        db.executemany("DELETE FROM cells WHERE x=? AND y=? AND z=?",
                       (cell[:3] for cell in changes if cell[3] is None))
        db.executemany("INSERT OR REPLACE INTO cells VALUES(?,?,?,?)",
                       (cell for cell in changes if cell[3] is not None))
        db.execute("DELETE FROM history WHERE revision=?", (row["revision"],))
        return changes

    @staticmethod
    def replace(db, kind, state):
        if kind == "restore":
            if not state["checkpoint"]:
                raise Refused("no-checkpoint", "There is no pre-reset world to restore.")
            db.execute("CREATE TEMP TABLE swap AS SELECT * FROM cells")
            db.execute("DELETE FROM cells")
            db.execute("INSERT INTO cells SELECT * FROM checkpoint")
            db.execute("DELETE FROM checkpoint")
            db.execute("INSERT INTO checkpoint SELECT * FROM swap")
        else:
            # A second reset of pristine terrain must not erase the useful checkpoint.
            if state["count"]:
                db.execute("DELETE FROM checkpoint")
                db.execute("INSERT INTO checkpoint SELECT * FROM cells")
                db.execute("UPDATE meta SET has_checkpoint=1")
            db.execute("DELETE FROM cells")
        db.execute("DELETE FROM history")
