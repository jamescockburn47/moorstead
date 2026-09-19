"""Transactional override counts; rapid edits must not rescan millions of cells."""


def rebuild(db):
    db.execute("DELETE FROM chunk_counts")
    db.execute("INSERT INTO chunk_counts SELECT x >> 4,z >> 4,COUNT(*) FROM cells GROUP BY x >> 4,z >> 4")


def count(db):
    return db.execute("SELECT COALESCE(SUM(count),0) FROM chunk_counts").fetchone()[0]


def adjust(db, changes):
    for (x, z), delta in changes.items():
        db.execute("INSERT INTO chunk_counts VALUES(?,?,?) ON CONFLICT(x,z) DO UPDATE SET count=count+?",
                   (x, z, delta, delta))
    db.execute("DELETE FROM chunk_counts WHERE count=0")


def restore_cells(db, rows):
    counts = {}
    for x, y, z, block in rows:
        exists = db.execute("SELECT 1 FROM cells WHERE x=? AND y=? AND z=?", (x, y, z)).fetchone() is not None
        delta = int(block is not None) - int(exists)
        key = (x >> 4, z >> 4)
        counts[key] = counts.get(key, 0) + delta
    db.executemany("DELETE FROM cells WHERE x=? AND y=? AND z=?", (row[:3] for row in rows if row[3] is None))
    db.executemany("INSERT OR REPLACE INTO cells VALUES(?,?,?,?)", (row for row in rows if row[3] is not None))
    adjust(db, counts)
