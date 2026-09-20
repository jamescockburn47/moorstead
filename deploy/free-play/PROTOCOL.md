# Free Play WebSocket protocol 1, content 7 (SQLite schema 4)

Only `/freeplay/ws?room=family-freeplay&pid=a<account-id>&token=<session-token>`.
The route verifies existing server sessions; ordinary `/ws` rejects this room.
`POST /dash/auth/freeplay-claim` uses the dedicated account/room precondition and
returns the usual account fields plus `edition: "freeplay"`.

1. Client sends `{type:"hello",protocol:1,contentVersion:7}` within ten seconds.
   Older/newer content versions are refused before any snapshot or mutation.
2. Server sends `init` with `protocol`, `freeplay:true`, `room`, numeric `seed`,
   `contentVersion:7`, `minContentVersion:7`, `epoch`, `revision`, `count`, `history`,
   `checkpoint`, `players`, `vehicleCount`, `limits` (including `maxCells:8000000`,
   `maxChunks:1024`, `maxBuild:1024`, `maxVehicles:16`, `maxVehicleCells:512`).
3. Zero or more `{type:"snapshot",edits:[[x,y,z,id],...]}` frames, ≤512 cells each.
   Then exactly `vehicleCount` `{type:"vehicle-snapshot",vehicle}` frames, one body
   per frame. Vehicle records are defined below.
4. `{type:"ready",epoch,revision}` commits the complete snapshot. No partial
   snapshot is authoritative. `count` counts unique override cells.

Client commands require `{type,requestId,epoch,baseRevision,...}`. `requestId`
contains 8–80 ASCII letters/digits/underscore/hyphen. Epoch must exactly match,
and baseRevision must equal the most recent committed world revision. Unknown
fields are refused, including room/radius/damage/privilege fields.

| type | Required extra fields |
|---|---|
| `edit` | `edits`: 1–104 unique `[x,y,z,id]`, id 0–62 or 200–208; no null |
| `blast` | `bomb`: grenade/dynamite/demolition/mega/atom; `center:[x,y,z]` |
| `weapon` | `weapon`: plasma/rocket/gravity/machinegun/sheep; `center:[x,y,z]`; sheep also requires `origin:[x,y,z]` |
| `build` | `shape`: line/wall/floor/box/base/tower/bridge/trench/bunker/barricade/watchpost; `origin:[x,y,z]`; `rotation`: 0–3; `block`: 1–102 or 200–208; `size`: 3/5/7 required only for line/wall/floor/box, forbidden for prefabs |
| `vehicle-convert` | `core:[x,y,z]`, `from:[x,y,z]`, `to:[x,y,z]`, `mode`: car/plane/submarine |
| `vehicle-edit` | `vehicleId`: the 32-character server-issued lowercase hex id |
| `undo` | none; latest retained shared terrain action |
| `reset` | `confirm:true`; vote for pristine baseline with pre-reset checkpoint |
| `restore` | `confirm:true`; vote to swap current world and recovery checkpoint |

Reset and restore require exactly two connected authenticated accounts, each
approving the same action within 30 seconds. First approval broadcasts
`{type:"reset-vote",epoch,requestId,voters:[pid],kind,remaining}` and clears only
that client's pending request; it does not write terrain or advance revision.
The second distinct approval commits the existing atomic replacement operation.
Both sessions are revalidated, repeated approvals cannot extend the window, and
reset/restore votes cannot mix. Expiry, membership/device changes and replacements
clear votes. Used approval request IDs cannot be replayed. A failed save consumes
consent without changing the world; fresh approvals are required. Idle expiry
messages use null requestId/kind and no voters. Checkpoint recovery remains atomic.

All coordinates are integers with x,z ∈ [-8192,8192], y ∈ [1,63]. Every successful
new command increments revision once. Reset/restore also increment epoch. A command
that changes no cells still receives an ordered commit but creates no undo entry.
Gravity always has zero terrain changes: it broadcasts one ordered effect without
consuming the latest undo action. Sheep is another zero-terrain ordered effect;
its integer origin allows y1–182, and the centre must be within 48 blocks. Plasma,
rocket and machinegun use fixed (radius, depth, upper) ellipsoids of (2,2,3),
(7,5,10), and (1,1,1), respectively. The machinegun is limited to about four accepted
shots per second per player. Clients cannot supply damage.

Build shapes are generated entirely by the server, at most 1,024 unique cells.
Every resulting coordinate must fit the world; a partial shape is refused. Rotation
maps local (x,z) to (x,z), (-z,x), (-x,-z), (z,-x) about the origin. Hollow boxes and
fixed prefabs include explicit air to clear their interiors. Prefabs use the fixed
palette 200 alloy, 201 cyan, 202 magenta, 203 glass, 204 circuit, 205 landing pad;
the validated block selection applies only to brushes. One build is one undo action.

Committed changes broadcast, in order, to every joined player:

1. `{type:"begin",epoch,revision,requestId,actor,kind,replace,count,vehicleCount,...}`.
   Blasts include `bomb,center`; weapons include `weapon,center` plus sheep `origin`; builds include
   `shape,origin,rotation,block` and brush-only `size`.
   `actor` is the server-validated display name. `replace:true` requires discarding
   all previous overrides and applying the streamed replacement atomically.
2. Zero or more `{type:"delta",epoch,revision,edits:[[x,y,z,id|null],...]}`.
   `null` means remove an override and regenerate that cell from the baseline;
   `0` means persistent air. Each operation has unique cell coordinates.
   Also zero or more `{type:"vehicle-delta",epoch,revision,vehicleId,vehicle}` frames.
   A null vehicle removes that body. Replacement operations discard previous
   vehicles as well as overrides and stream all replacement bodies. Verify the
   resulting body count against `begin.vehicleCount` before committing.
3. `{type:"commit",epoch,revision,requestId,history,checkpoint}`. Only now apply
   the staged changes together, queue affected chunk rebuilds, and show blast
   effects. Reset/restore must also rehome players and discard old queued actions.

History is newest-first, up to twenty `{revision,actor,kind,bomb}` entries; bomb
is null for building and weapon actions. `checkpoint` reports whether restore is possible. The full
history is trimmed by the inverse-cell budget too, so a large blast can leave fewer
than twenty entries. Undo removes one latest action; it is not itself undoable.

A repeated exact request receives `{type:"ack",duplicate:true,requestId,epoch,
revision,appliedEpoch,appliedRevision}` without applying again. Reconnect if local
state does not already include the action. Errors are `{type:"error",code,message,
epoch,revision,requestId?}`. On `stale`, reconnect for a fresh snapshot and require
a fresh player action; do not automatically resubmit destruction. `world-limit`
leaves recovery operations available. Authentication errors close with 4003;
duplicate login closes the old socket with 4004 (terminal: another device has this
login; never automatically reconnect and evict it); slow delivery closes with 1013.

Positions are independent and may interleave frames:
`{type:"pos",epoch,x,y,z,yaw}`. The server validates finite bounded values, exact
epoch and a maximum broadcast frequency of 12.5 Hz. Server messages add `pid,name`;
join/leave notices identify a peer. Positions are never persisted. y may range
1–192 for flight; yaw is within ±2π. `{type:"ping"}` receives `{type:"pong"}`.

## Vehicles

A vehicle is `{id,mode,core,cells,pose,pilot}`. `core` and solid `cells` are integer
coordinates relative to the selection's minimum corner. `pose` is `{x,y,z,yaw}`;
`pilot` is an account pid or null and is never persisted. The body has 1–512 authored
solid blocks, exactly one control block 206, inside a selection of at most 16×12×16.
Natural/procedural blocks and explicit air are excluded from conversion. The source
solids become persistent air in the same transaction that creates the vehicle.

Body rotation is about the origin voxel's centre: rendered group position is
`(pose.x+.5,pose.y,pose.z+.5)`; local block centres are `(x,y+.5,z)`; yaw rotates
indices as `(x cosθ-z sinθ,x sinθ+z cosθ)`. Parking retains the separate body. Explicit
`vehicle-edit` rounds xyz with `floor(v+.5)` and yaw to the nearest quarter turn,
then materialises exact blocks. The server rejects any occupied authored target
cell; the client additionally previews collisions with generated terrain. There
is no server-side procedural terrain generator. Piloted vehicles cannot be edited.

Vehicle conversion/materialisation are atomic terrain operations. Their compound
undo records carry both override and vehicle inverses. Legacy cell-only undo records
remain valid. Reset and checkpoint restore include parked bodies and saved poses.

Controls use separate messages without `requestId` or `baseRevision`:

| Client type | Fields besides type |
|---|---|
| `vehicle-claim` | `epoch,vehicleId` |
| `vehicle-drive` | `epoch,vehicleId,lease,seq,pose` |
| `vehicle-release` | `epoch,vehicleId,lease`; optionally both final `seq,pose` |

The authenticated socket can pilot only one body, with one pilot per body. Claim
broadcasts `{type:"vehicle-lease",epoch,vehicleId,pilot,lease,pose}`. A matching
lease nonce and owning socket are required for driving/release. Increasing integer
`seq` rejects replay. Drives save at about 4 Hz and broadcast
`{type:"vehicle-pos",epoch,vehicleId,seq,pose,pilot}`. A final release pose bypasses
that cadence but receives the same finite/bounds/speed validation. Position updates
do not increment terrain revision. Disconnect releases the lease and retains the
last accepted saved pose; either player can subsequently claim or edit it.

Server movement bounds are 12/28/12 units per second for car/plane/submarine with
a three-unit jitter allowance, and 3 radians per second plus 0.35 radians. Elapsed
time is capped at one second; every rotated block must fit x/z bounds and the body
must fit y1–180. Terrain collision and movement simulation remain client-side.
Control errors include `command` and `vehicleId`; route those separately from any
pending terrain request. Reset/restore/affected undo operations invalidate leases.

Snapshots and replacement transfers have a 120-second overall delivery deadline;
ordinary actions retain 30 seconds, with three seconds per individual socket send.

## Battlefield

Battle commands require `type,epoch` but no terrain request ID or revision. Unknown
fields, stale epochs and expired/revoked sessions are refused. Errors include the
originating `command`, so they do not clear a pending terrain operation.

| Type | Additional fields |
|---|---|
| `battle-join` | `team`: blue/red |
| `battle-leave` | none; refused during active rounds |
| `battle-forfeit` | none; opposing team wins an active round and actor leaves |
| `battle-recruit` | `count`: integer 1–10; at most 30 soldiers per team |
| `battle-order` | `order`: follow/hold/attack/defend; `rally:[x,y,z]` inside arena; optional `squad`: 0–3 |
| `battle-deploy` | `kind`: turret/tank; `point:[x,y,z]` within 18 blocks; `squad`: 1–3 |
| `battle-shot` | `weapon`: machinegun/plasma; finite `direction:[dx,dy,dz]` with length 0.5–1.5, normalized by server |
| `battle-shield` | none; radius 6, lasts 12 seconds, cooldown 25 seconds |
| `battle-rally` | none; return to camp preserving health, cooldown 10 seconds |
| `battle-base` | none; designate own base using current server-accepted foot position |
| `battle-ready` | none; place a base if missing, otherwise validate own existing base, then ready own team |
| `battle-reset` | none; reset match state, preserving terrain; refused during active rounds |

The server sends `battle-state` after `ready` when the configured arena is available,
then at five Hz while anyone participates. Its envelope is `{type,epoch,battle}`;
`battle` contains `available:true,revision,bounds:{minX,minZ,maxX,maxZ},camps,scores,
players,soldiers,equipment,shields`. Player/soldier records have `id,team,x,y,z,yaw,hp,shield,
respawn,spawnSeq`; player records add `name,correctionSeq,shieldCooldown,recruitCooldown,equipmentCooldown`, soldiers
add `owner,order,squad`. Players also expose `connected` and `reconnectIn` (0–60 seconds).
Respawn and cooldown values are seconds remaining. Shield records
are `{id,team,x,y,z,radius,remaining}`. Soldier yaw zero faces positive Z.

Participants use the existing `pos` channel; arena bounds, swept terrain cover,
body clearance and speed 30 units/second plus two units jitter are enforced.
Rejected movement increments `correctionSeq` and promptly returns authoritative
state, bounded to five corrections/second. Apply a changed correction sequence by
snapping position; preserve view direction. A changed `spawnSeq` means join,
respawn or return to camp. Battle participation and vehicle piloting are mutually
exclusive on the server. Other Free Play players are immune to match damage.

Player health/shield are 100/100; shields regenerate after three seconds without a
hit. Soldiers have 50 health. Knockouts respawn players after five seconds and
soldiers on 25-second waves, after 8–33 seconds. Enemy knockouts score three points
for players, one for soldiers. Explicit allowed departure dismisses that player's army. Match state,
including scores, is ephemeral and resets with world reset/recovery or a restart.

Shots originate at the server's accepted player position and stop at actual solid
terrain. Direct battle shots damage entities only. Existing bomb/weapon commands
still apply terrain damage; participating actors must be alive and target inside
the arena within 96 units. Victims and cover are resolved before terrain damage,
and health changes only follow a successful, nonduplicate world commit. Friendly
dome shields protect allies inside; friendly fire is disabled.

Effects are `{type:"battle-event",epoch,event}`. Shot events contain
`type:"shot",from,to,team,weapon,sourceId`; hit events contain
`type:"hit",targetId,x,y,z,shield,team` and optional `sourceId`. Only the matching
player source ID warrants personal hit feedback; army fire has soldier source IDs.
State and effects are bounded by eight players, 60 soldiers, ten equipment units,
eight domes and at most 128 events per flush.

`battle.ctf` contains `{phase,winner,bases,flags,ready,reason,paused,captureRadius,objective}`. Ready maps
blue/red to booleans; reason is null/capture/forfeit; paused is boolean.
Phase is `setup`, `active` or
`won`; winner is null or a team. Bases map each team to null or a foot-position
`[x,y,z]`. Flags contain entries only for selected bases, keyed by team. Each
entry is `{team,x,y,z,status,carrier,returnIn}`: status home/carried/dropped,
carrier null or a player pid, and returnIn seconds in [0,20]. Flag coordinates
are base anchors. Zone capture keeps flags at home with no carrier.

Base selection requires supported ground, clear surrounding headroom and at least
32 horizontal blocks between bases. Moving a base clears that team's ready flag.
Only both teams ready and connected locks bases and enables combat. Default
recruits Attack automatically when active; they wait at base during setup. Defend
retains a base formation while firing at nearby visible enemies.
The objective is `zone`, with `captureRadius:3` in `battle.ctf`. A living player
or soldier within three horizontal blocks of the enemy base and within one block
of supported ground wins immediately. Base height and line of sight to the flag
do not affect capture. Equipment cannot capture. No flag carrying is required.
Winning freezes damage and shots; a new round resets bases/flags/armies/scores
and restores default camps, preserving terrain.

Recruit count is 1–10, with a 25-second per-player cooldown and 30 soldiers per
team. Recruits carry squad 1–3. `battle-order` accepts optional `squad` (0 means
all); legacy commands with no squad still control all owned units.
`battle-deploy` requires `{kind,point,squad}`: kind turret/tank, squad 1–3, a
visible supported point within 18 blocks. Limits are three turrets/two tanks per
team and a 20-second per-player cooldown. State includes bounded `equipment`,
player `recruitCooldown`/`equipmentCooldown`, and unit `squad`/`kind`.

Attack infantry slowly damage blocking wall voxels. Four hits open a voxel,
limited to one hit/second/voxel. Up to 32 completed holes are committed once a
second using Store.apply and normal begin/delta/commit framing. Collision changes
only after commit. Capacity and vehicle-edit protection still apply; history is
undoable. No public command accepts a breach coordinate or damage amount.

Mega and atom commands are refused for participants. While any participant
remains, a spectator's mega/atom is also refused if its horizontal blast circle
touches the arena rectangle, including blasts originating outside. Enforcement
occurs on receipt, so a previously armed bomb cannot bypass the restriction.

Disconnect preserves the participant, flag and army for 60 seconds. During an
active round any disconnected participant pauses combat, movement and respawn
timers. A separate elapsed-time clock advances the grace deadline; it cannot be
extended by freezing simulation time. Reconnecting with the same authenticated
account resumes the retained state automatically. Grace expiry forfeits an active
round. Active participants cannot leave without `battle-forfeit`; match reset is refused while a round remains active. Global terrain reset/restore
requires both authenticated players to approve and can end an active round. Normal departure is available during setup or after victory.

Human direct-shot cooldowns use trusted monotonic receipt times, with a separate
per-player timestamp. AI cooldowns use simulation time. Neither timestamp can be
supplied over the wire. This avoids rejecting valid 250-ms shots merely because
the five-Hz simulation advanced only 200 ms.
