# Relay height parity — run wi': python deploy/world/test_moorsgeo.py
# Asserts the Python mirror returns the same deterministic heights as the JS
# MoorsGeography (reference emitted by scripts/verify-geo-parity.mjs). If this
# drifts, the relay and client disagree about the ground.
import json
from pathlib import Path

import geography_moors as gm

ref = json.loads((Path(__file__).resolve().parent / "parity-ref.json").read_text())
fails = []
for bx, bz, jsh in ref:
    py = gm.height_raw(bx, bz)
    if abs(py - jsh) > 1e-6:
        fails.append((bx, bz, jsh, py))

print(f"  checked {len(ref)} samples, {len(fails)} mismatches")
for f in fails[:8]:
    print("  FAIL", f)
print("\nPARITY:", "FAIL" if fails else "client/relay heights agree")
raise SystemExit(1 if fails else 0)
