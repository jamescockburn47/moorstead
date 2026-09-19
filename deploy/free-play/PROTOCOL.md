# Free Play WebSocket protocol 1, content 2

Only `/freeplay/ws?room=family-freeplay&pid=a<account-id>&token=<session-token>`.
The route verifies existing server sessions; ordinary `/ws` rejects this room.
`POST /dash/auth/freeplay-claim` uses the dedicated account/room precondition and
returns the usual account fields plus `edition: "freeplay"`.

1. Client sends `{type:"hello",protocol:1,contentVersion:2}` within ten seconds.
   Older/newer content versions are refused before any snapshot or mutation.
2. Server sends `init` with `protocol`, `freeplay:true`, `room`, numeric `seed`,
   `contentVersion:2`, `minContentVersion:2`, `epoch`, `revision`, `count`, `history`,
   `checkpoint`, `players`, `limits` (including `maxBuild:1024`).
3. Zero or more `{type:"snapshot",edits:[[x,y,z,id],...]}` frames, ≤512 cells each.
4. `{type:"ready",epoch,revision}` commits the complete snapshot. No partial
   snapshot is authoritative. `count` counts unique override cells.

Client commands require `{type,requestId,epoch,baseRevision,...}`. `requestId`
contains 8–80 ASCII letters/digits/underscore/hyphen. Epoch must exactly match,
and baseRevision must equal the most recent committed world revision. Unknown
fields are refused, including room/radius/damage/privilege fields.

| type | Required extra fields |
|---|---|
| `edit` | `edits`: 1–64 unique `[x,y,z,id]`, id 0–62 or 200–205; no null |
| `blast` | `bomb`: grenade/dynamite/demolition/mega/atom; `center:[x,y,z]` |
| `weapon` | `weapon`: plasma/rocket/gravity; `center:[x,y,z]` |
| `build` | `shape`: line/wall/floor/box/base/tower/bridge; `origin:[x,y,z]`; `rotation`: 0–3; `block`: 1–62 or 200–205; `size`: 3/5/7 required only for line/wall/floor/box, forbidden for prefabs |
| `undo` | none; latest retained shared terrain action |
| `reset` | `confirm:true`; pristine baseline with pre-reset checkpoint |
| `restore` | `confirm:true`; swap current world and recovery checkpoint |

All coordinates are integers with x,z ∈ [-8192,8192], y ∈ [1,63]. Every successful
new command increments revision once. Reset/restore also increment epoch. A command
that changes no cells still receives an ordered commit but creates no undo entry.
Gravity always has zero terrain changes: it broadcasts one ordered effect without
consuming the latest undo action. Plasma/rocket use fixed (radius, depth, upper)
ellipsoids of (2,2,3) and (7,5,10), respectively. Clients cannot supply damage.

Build shapes are generated entirely by the server, at most 1,024 unique cells.
Every resulting coordinate must fit the world; a partial shape is refused. Rotation
maps local (x,z) to (x,z), (-z,x), (-x,-z), (z,-x) about the origin. Hollow boxes and
fixed prefabs include explicit air to clear their interiors. Prefabs use the fixed
palette 200 alloy, 201 cyan, 202 magenta, 203 glass, 204 circuit, 205 landing pad;
the validated block selection applies only to brushes. One build is one undo action.

Committed changes broadcast, in order, to every joined player:

1. `{type:"begin",epoch,revision,requestId,actor,kind,replace,count,...}`.
   Blasts include `bomb,center`; weapons include `weapon,center`; builds include
   `shape,origin,rotation,block` and brush-only `size`.
   `actor` is the server-validated display name. `replace:true` requires discarding
   all previous overrides and applying the streamed replacement atomically.
2. Zero or more `{type:"delta",epoch,revision,edits:[[x,y,z,id|null],...]}`.
   `null` means remove an override and regenerate that cell from the baseline;
   `0` means persistent air. Each operation has unique cell coordinates.
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
