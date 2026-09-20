# War gameplay upgrade — 20 September 2026

Local development only. No commit, push, client deployment or EVO mutation.

Implemented: radius-three capture zones, grounded player/infantry entry wins
without carrying a flag; elevated flags remain capturable from below. Attack
infantry advance under fire and breach obstructing walls at four hits per voxel,
one hit per voxel per second. Holes use existing durable, shared, undoable edits.
Ten recruits per 25 seconds, three selectable squads, 30 soldiers per team;
25-second reinforcement waves with minimum eight seconds out of action. Added
limited automatic turrets and commanded firing tanks, distinct procedural models,
and corrected health-bar depth. Resource harvesting is deferred; cooldowns and
equipment caps provide scarcity for this pass.

The backend deterministic suite passes 75 tests, including an actual enclosure
breach → traversal → elevated flag capture journey, squad isolation, cooldowns,
equipment damage/cover, wave timing and failed terrain commit. Client guards
exercise models, zones, health bars, protocol limits and resource disposal.
The real adapter browser journey and a separate procedural visual fixture pass;
the production build and full `npm run verify` gate pass. Visual inspection of `war-units-zones.png` confirms
distinct infantry/turret/tank shapes, different health fills and a ground-reaching
zone boundary. The visual fixture is staged rendering, not additional gameplay proof.

Independent review found a narrow breach that soldiers could not traverse. The
fix checks lateral shoulder clearance and the reviewer reran the reproducer:
all five tactics tests passed. No remaining material finding from that review.

## Release prerequisite: reconcile the live backend

Read-only SSH confirmed that EVO `~/moorstead/worldsvc/freeplay_battle.py`,
`freeplay_battle_flags.py` and `freeplay_battle_service.py` already contain newer
ready/reconnect/pause/forfeit behaviour absent from this checkout. Preserve that
behaviour when merging this change for release; do not replace those live files
wholesale with this checkout. The client now exposes Ready when the server sends
the readiness state, but the local adapter still uses its existing automatic
start after both bases are selected. Browser evidence is against that adapter.

Free-play content negotiation rises to 6 because army capacity and respawn bounds
would be rejected by older clients. Ordinary Moorstead versions are unchanged.
Client and backend need a coordinated release after the live-source merge and
readiness/reconnect regression checks. Historical upgrade installers are not a
deployment path for this release. Preserve their checksum refusal gates.

Balance values are initial tuning, not evidence of multiplayer fun or tablet
performance. Tanks are commanded units; they are not rideable creative vehicles.
