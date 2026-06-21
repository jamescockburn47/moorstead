# Relay epoch gate — run wi': python deploy/world/test_epoch.py
# A client may only write edits / pocket-saves once it has acknowledged the room's
# current epoch. A stale client (an old bundle, or a session from before a warden
# reset) is refused, so it cannot re-seed a freshly wiped world.
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from epoch_gate import may_persist

fails = []
def check(cond, msg):
    print(("  ok    " if cond else "  FAIL  ") + msg)
    if not cond:
        fails.append(msg)

check(may_persist(0, 0) is True,    "a never-reset room (0) accepts a fresh client (0)")
check(may_persist(1, 1) is True,    "an in-sync client (1/1) may write")
check(may_persist(2, 1) is True,    "a client ahead of the room (2/1) may write")
check(may_persist(0, 1) is False,   "a stale client (0) is refused after a reset to epoch 1")
check(may_persist(None, 1) is False, "a client that never sent an epoch is refused once the room advanced")
check(may_persist("x", 1) is False, "a garbage epoch is refused")
check(may_persist(3, 0) is True,    "any client may write to a never-reset room (epoch 0)")

# the same gate decides whether a STORED POCKET is still current: on join the relay
# withholds a pocket stamped older than the room's epoch, so a reset clears materials.
check(may_persist(0, 1) is False, "[pocket] an unstamped pre-reset pocket (0) is withheld at epoch 1")
check(may_persist(1, 2) is False, "[pocket] a pocket stamped at an older epoch (1) is withheld at epoch 2")
check(may_persist(2, 2) is True,  "[pocket] a pocket stamped at the current epoch (2) is restored")

print("\nEPOCH(py): FAIL" if fails else "\nEPOCH(py): all good")
sys.exit(1 if fails else 0)
