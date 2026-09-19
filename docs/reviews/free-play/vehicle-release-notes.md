# Vehicle and sheep pack — 19 September 2026

User request: “we want a block, its you have to make something, put this new block on it, press the block, and it gives you a highlight, you highlight the thing you put the block on, go inside and it becomes something you can drive around, so it can become a car, submarine, plane or whatever. also, make a machine gun and a gun that fires live sheep. raise the block edit window at the same time”.

Clarifications: choose Car, Plane or Submarine regardless of shape; save vehicles
and let either boy park/edit them; increase total world edits, not the edit menu
position or building height. Existing Free Play deployment authority continues.

Tier A: converting durable terrain to a moving object and back must preserve all
blocks and cannot duplicate vehicles or discard the existing shared world.
The direct experiment was a four-block build, actual highlight/conversion,
driving, then parking/materialisation/recovery across the two identities.

## Implementation

- Control206, authored-block selection only;512 cells within16×12×16;16 vehicles.
- Terrain and vehicle inverses commit atomically. Driving has a separate epoch,
  exclusive pilot lease, finite bounded poses and4Hz persistence, no terrain
  revision churn. Release flushes its final pose; disconnect retains the last
  accepted position. Explicit Edit build snaps to integer/quarter-turn blocks.
- Car follows terrain; plane flies; submarine crawls on land and dives in water.
  Occupied-voxel collision, swept steps, loaded-region and world bounds are pure.
- Machinegun held bursts are server-capped; sheep are shared bounded live rigs,
  landing alive and ambling. Existing accounts and ordinary world are unchanged.
- Override capacity8m, transactional chunk counts replacing per-shot table scans.
  Content3/schema3 forward-refuse older clients/adapters. Initial and replacement
  snapshots allow120s; normal operations retain30s delivery bounds.

## Evidence and review

Canonical release-clone headless gate passed, including46 backend tests. Build
passed and production assets contain no playtest bridge. Focused guards exercise
exact selection, quarter-turn negative-coordinate rounding, complete vehicle
transfers, pending-command isolation, rejected lease recovery and resource bounds.

Independent review covered vehicle physics/renderer parity, controller/protocol,
weapons,17 store tests, four authenticated adapter socket tests, and an actual
schema2 migration trial preserving legacy history and checkpoint recovery. Fixed
findings: error-pending recovery, arrow keys, Home/reset ordering and release
retry/ack handling. Actual HTML/CDP touch tests cover held Fire and all cancellation
paths. Layout checks include driving controls in the existing bottom toolbar.

EVO8m rehearsal:15,627 frames,130,042,819 uncompressed bytes, largest frame8,513
bytes,7.809s snapshot generation/decoding. Machinegun transactions median2.336ms,
maximum6.216ms. These are server measurements, not tablet frame-rate claims.
Consistent live schema2 backup of1,451,333 cells migrated on an isolated copy with
every old table hash unchanged; the actual old adapter refused schema3.

Two simultaneous SwiftShader views completed conversion, lift and flight but
starved local browser control delivery; parking assertion timed out. That run
does not prove the full browser journey. A discriminating single-renderer journey
switches the real Henry/James fixture logins sequentially; concurrent leases and
broadcasts are covered separately by actual adapter tests. Its result and release
identity are recorded below once finished. Physical Fire/Silk performance remains
an explicit device check. No production boy account is used for probes.

Final browser verdict: PASS in20.5s on the release clone. Real UI build → control
core → four-block highlight → conversion → keyboard flight → confirmed park →
James login/claim/park → Edit to the exact same four blocks → Undo restores exact
body/pose → Henry login confirms persistence. No page errors. The bounded-input
journey waits for native dialog close/canvas focus before moving; otherwise the
close listener correctly clears keys. Both HTML-only touch/layout tests passed,
including one sheep shot per long press and subsequent keyboard activation.
Release target: v1.1.72 through the canonical deployment command.
