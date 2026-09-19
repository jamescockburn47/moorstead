"""Consistent SQLite backup, including committed WAL data, into a new file only."""
import argparse
from contextlib import closing
import os
from pathlib import Path
import sqlite3


def backup(database, output):
    database, output = Path(database).resolve(strict=True), Path(output).resolve()
    if output.exists() or database == output:
        raise ValueError("Backup output must be a new file")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".incomplete")
    with temporary.open("xb"):
        pass
    try:
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as source:
            with closing(sqlite3.connect(temporary)) as destination:
                source.backup(destination, pages=1024, sleep=0.01)
                if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Backup integrity check failed")
        with temporary.open("r+b") as result:
            os.fsync(result.fileno())
        # Same-directory hard link publishes the complete file atomically and
        # refuses an existing destination on both NTFS and the EVO's Linux FS.
        os.link(temporary, output)
        if os.name == "posix":
            directory = os.open(output.parent, os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database")
    parser.add_argument("output")
    args = parser.parse_args()
    backup(args.database, args.output)
