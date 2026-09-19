# Private Free Play — server and release tools

Updated 19 September 2026. **Content 6 release; SQLite schema 4.** No real
invites, sessions, player records or production database are included. The upgrade
adds capture the flag with player-designated bases, grounded armies, real terrain
cover, energy shields and cartoon knockouts/respawns. Existing movable builds and
the eight-million-cell editing capacity remain supported.

This package serves exactly `family-freeplay` at `/freeplay/ws`, using the existing
relay's token-ledger authentication. A dedicated dashboard claim route refuses an
ordinary invite before changing an account or minting a session. The normal relay
route refuses this room before reading or creating ordinary room state.

## Source and installation map

| Source | Destination / purpose |
|---|---|
| `worldsvc/freeplay_rules.py` | Relay directory; protocol limits, validators and deterministic blast cells |
| `worldsvc/freeplay_builds.py` | Relay directory; bounded brushes and fixed sci-fi prefab cells |
| `worldsvc/freeplay_chunks.py` | Transactional chunk/cell counts without full-world scans per shot |
| `worldsvc/freeplay_vehicles.py` | Lossless authored-block transfer, parked bodies and pose validation |
| `worldsvc/freeplay_vehicle_control.py` | Exclusive pilot leases and bounded movement saves |
| `worldsvc/freeplay_store.py` | Relay directory; transactional SQLite persistence/history/recovery |
| `worldsvc/freeplay_stream.py` | Relay directory; bounded snapshot and operation frames |
| `worldsvc/freeplay_service.py` | Relay directory; session validation and exact-room WebSocket endpoint |
| `worldsvc/freeplay_battle.py` | Bounded match state, hit detection, shields and respawns |
| `worldsvc/freeplay_battle_ai.py` | Grounded squad movement and line-of-sight shooting |
| `worldsvc/freeplay_battle_terrain.py` | Verified procedural arena baseline plus saved overrides |
| `worldsvc/freeplay_battle_service.py` | Authenticated match commands and five-Hz state delivery |
| `worldsvc/freeplay_battle_flags.py` | Validated bases, flag carrying/return and round victory |
| `integrate.py` | Locally prepares the minimal relay/dashboard/Caddy modifications |
| `backup.py` | Consistent, integrity-checked SQLite backup into a new file |
| `fixture.py` | Loopback-only synthetic login/server for browser tests; never install in production |
| `verify.py` | Canonical offline backend check |
| `upgrade_pack.py` | Explicit content-1 → content-2 release, after backup and migration rehearsal |
| `upgrade_vehicles.py` | Explicit content-2 → content-3 release, preserving all old rows |
| `upgrade_battle.py` | Explicit content-3 → content-4 release, preserving all nine saved tables |
| `upgrade_ctf.py` | Content-5 release plus explicitly authorised reset with recovery checkpoint |
| `upgrade_war.py` | Content-6 update preserving all saved rows; no world reset |

Live sources were read over `evo-tailscale`, without writes or service changes.
`integrate.py` refuses sources whose SHA-256 differs from these inspected baselines:

| Remote file | SHA-256 |
|---|---|
| `/home/james/moorstead/worldsvc/server.py` | `884f200eee30172216ff0875fdb3119d41f5f59a51ac0080be846d98bb42fd8c` |
| `/home/james/moorstead/dash/app.py` | `f9f8d7c226274f4275c345cd31defefafd589d7345b28580be8d510e5d4995eb` |
| `/etc/caddy/Caddyfile` | `89bf09f58b49b7ba5221acc1448df131071f27d292b2ee1a09ab56fec26d4468` |

The actual live Caddy file was also copied read-only and its narrow route changes
were rehearsed. Caddy modifications require unique exact anchors and preserve its
other games and existing allowlist. None of the separately staged god-mode changes
are incorporated. New handwritten Python modules are gated at 300 logical lines.
`tests/live_claim_excerpt.py` is a frozen, attributed input fixture from the
inspected dashboard, used to execute the actual transformed login function.

## Persistence and limits

The only world store is `DATA/freeplay/world.sqlite3`; it is outside ordinary room
JSON, pockets, companion records and pruning. SQLite transactions atomically commit
overrides, revision, inverse history and idempotency receipts with synchronous FULL
and WAL journalling. Content 4 advances `user_version` to `4`, preserving every
existing row. Its marker prevents older adapters from accepting new cover block
IDs 207–208; it adds no tables. Versions above 4 are refused. The fixed seed is
`419947177`, the existing Moorstead `strSeed('t-moors-1900')` value.

An absent override means procedural baseline. A stored `0` means air. Undo sends
`null` to remove an override, preserving this distinction. Damage has no expiry.
Reset copies current overrides into the pre-reset checkpoint, clears world/history,
advances epoch and clears peer positions. Resetting pristine terrain again retains
the useful previous checkpoint. Restore swaps the active world and checkpoint,
advances epoch and clears history; the replaced world remains recoverable.

Limits are explicit: 8,000,000 override cells; 1,024 touched 16×16 chunks;
20 recent actions and at most 400,000 inverse cells; 4,096 idempotency receipts;
16 parked/driven vehicles of at most 512 solid blocks and 16×12×16 extent each;
8 simultaneous identities; 64 blocks per direct stroke; 1,024 generated cells per
brush/prefab command; 512 rows per outgoing
batch; 16 KiB incoming command; one command per peer per 100 ms. Each peer may have
one command awaiting the room lock, so there is no unbounded operation queue.
World-limit refusals roll back completely and leave undo/reset/restore available.
The inspected `moorstead-world` systemd unit runs one Uvicorn worker, which is
required because live peer broadcasts are in-process. Keep that deployment model;
multiple workers would require an explicit shared broadcast mechanism. The 16 KiB
limit is enforced by the route after receipt; the existing shared relay transport
limits remain unchanged so ordinary player saves are not silently truncated.

World changes are serialized and computed on a worker thread. Frames yield between
batches. Each socket send has a three-second deadline and a complete transfer a
30-second deadline (120 seconds for snapshots/replacements); slow or broken peers close and recover from the durable
snapshot on reconnect. Receipt identity is stable account pid plus requestId;
reused IDs with changed content are refused. Even after old receipts are pruned,
the original exact epoch/revision makes a delayed duplicate stale.

No player pockets are read or saved. Positions are ephemeral, bounded and checked
against the exact epoch. Token expiry/revocation is rechecked on operations and
approximately every second when idle. Authentication comes only from the existing
server callback and the exact room-bound session, never a client capability flag.
The hello handshake additionally requires content version 6 before any snapshot.

Vehicle conversion selects only authored non-air overrides and exactly one control
block 206. Conversion, explicit block editing, undo and checkpoint recovery include
both voxel and vehicle state in one transaction. Parking retains an object until
the player explicitly edits it. One authenticated socket holds a vehicle's pilot
lease; either child can take unpiloted controls. Validated poses persist at about
4 Hz without changing terrain revision; disconnect retains the last accepted pose.
See `PROTOCOL.md` for exact frames, movement bounds and baseline-collision limits.

Battlefield participants explicitly choose a team. There are at most 24 soldiers
per team, with six recruited per command, and eight players. Match state is
ephemeral; terrain and fortifications use the existing durable world operations.
The server loads a hash-checked 128×128×64 baseline exported from the actual client
generator, then applies saved overrides. Bullet rays, movement and explosion cover
use that combined terrain. Explosion victims are planned before cover destruction;
health changes occur only after the corresponding terrain transaction commits.
The real exported arena trial ran 48 opposing soldiers for 60 simulated seconds:
first hit at 7.4 seconds, 438 hit events and 86 score points, with a maximum tick
of 4.732 ms. These measurements establish server behaviour, not tablet frame rate.

Content 6 makes recruitment default to Attack. Squads wait around their base
during setup, then advance and shoot when both teams press Ready; Defend guards
the selected home base. The canonical Python gate freshly exports the actual
client terrain and rejects armies that merely stand still: 48 default recruits
must cause hits and knockouts without an extra Attack command. Another test fires
from the actual client eye direction at 20 metres and proves exact cover blocks
the same shot. Human gun cooldowns use monotonic receipt time; AI uses the match
simulation clock, so five-Hz updates cannot reject normal quarter-second fire.

An active round requires explicit forfeiture to leave. Disconnects keep armies
for 60 seconds and pause combat, movement and respawn timers; the independent
grace clock continues. The same authenticated account resumes without rejoining.
Expiry forfeits. Player capacity includes reconnecting identities, and socket
replacement is checked atomically before cleanup can touch a participant.

## Stylised damage rules

| Bomb | Horizontal radius | Bowl depth | Upper ellipsoid radius |
|---|---:|---:|---:|
| grenade | 4 | 3 | 6 |
| dynamite | 7 | 5 | 10 |
| demolition | 12 | 8 | 16 |
| mega | 24 | 13 | clear to world ceiling |
| atom | 40 | 18 | clear to world ceiling |

For integer x,z within the radius, let `q = (dx² + dz²) / radius²` and
`f = sqrt(1-q)`. Clear from `max(1, ceil(centerY-depth*f))` through
`min(63, floor(centerY+above*f))`; mega/atom instead clear through y=63 so roofs and
tree crowns cannot float over the crater. Coordinates are bounded to ±8192, and
the y=0 floor is preserved. The server accepts only a bomb name and integer centre,
never client damage cells or a radius. At centre `[0,30,0]`, counts are 286, 1516,
7145, 75747 and 228592. The maximum atom payload at y=1 is 316575 cells. These are
stylised voxel mechanics, with no real-world explosive calculations.

## Local verification and browser fixture

Tested locally with Python **3.13.7**; deployed EVO Python is **3.12.3**. The runtime
modules use the standard library and the relay's existing FastAPI dependency.
The EVO currently uses FastAPI **0.136.3**; the local fixture pins **0.115.12**.
Lifecycle registration uses the router API supported by both. The content-4
release exercised task startup/shutdown with the actual EVO dependency before
its compatibility roll-forward; a regression rejects reliance on the removed
top-level `app.add_event_handler` helper.
Create an isolated environment using the fully pinned test dependency file:

```powershell
python -m venv "$env:TEMP/moorstead-freeplay-venv"
& "$env:TEMP/moorstead-freeplay-venv/Scripts/python.exe" -m pip install -r deploy/free-play/requirements-test.txt
& "$env:TEMP/moorstead-freeplay-venv/Scripts/python.exe" deploy/free-play/verify.py
```

With dependencies already available, the canonical command is
`python deploy/free-play/verify.py`. Tests exercise two real WebSocket clients,
maximum damage across chunks, reconnect, SQLite reopening, exact undo, reset and
checkpoint recovery, a backed-up database restored into a fresh store, stale and
simultaneous operations, token revocation, forged/oversized messages, capacity
rollback, future-schema refusal and ordinary-account isolation.

For owned browser tests, first probe the chosen port against current exclusions
and occupancy, then run:

```powershell
python deploy/free-play/fixture.py --port <checked-port> --data <disposable-test-directory>
```

Add `--battlefield <generated-header-path>` for battlefield journeys. The adjacent
`battlefield.u16.zlib` must match the header's raw SHA-256. Without these optional
files the fixture keeps ordinary Free Play available and refuses battle commands.

It binds **127.0.0.1 only**. Without `--data`, it creates and cleans a temporary
store. Its synthetic codes are `henry-test-only` and `james-test-only`. POST
`/auth/freeplay-claim` with `{code: ...}` returns synthetic acct/token/name/room and
`edition: "freeplay"`. Connect `/freeplay/ws?room=family-freeplay&pid=a<acct>&token=<token>`.
Browser interception may redirect only those fixture requests; the shipped client
has no bypass or test login. The fixture authenticates synthetic in-memory sessions
through the same production adapter. It does not establish live invite validity.

## Content-6 update — preserve the current world

Stage the thirteen adapter modules with `backup.py`, `upgrade_pack.py`,
`upgrade_battle.py`, `upgrade_ctf.py` and `upgrade_war.py` in a new private directory.
The new helper pins all thirteen hashes read from the actual content-5 relay and
both existing arena files. It proves lifecycle compatibility with the installed
FastAPI, stops only the relay, backs up the complete SQLite store and old source,
then opens a restored rehearsal database with the candidate. Every row in all
nine tables, including vehicle/checkpoint data and epoch/revision, must retain its
count and hash. The live store is checked again before restart. There is no reset
and no schema migration. A failed update restores only prior code, preserving the
current live database; matching client recovery or roll-forward may still be needed.

```sh
/home/james/moorstead/venv/bin/python /path/to/private-stage/upgrade_war.py --install
```

## Content-5 reset record — already performed

Stage all **thirteen** adapter modules with `backup.py`, `upgrade_pack.py`,
`upgrade_battle.py` and `upgrade_ctf.py` in a new private directory. The existing
arena files remain unchanged. Content 5 requires a matching client but retains
SQLite schema 4; flags, bases and round results are ephemeral.

```sh
/home/james/moorstead/venv/bin/python /path/to/private-stage/upgrade_ctf.py --install-and-reset
```

This command requires explicit authorisation for the fresh-world reset. It pins
all twelve previous module hashes and both arena hashes, proves task lifecycle
with the actual installed FastAPI, stops only the relay, and saves a consistent
database backup. A restored rehearsal copy must reset to pristine active state,
retain exact previous cells/vehicles in its checkpoint and restore those cells
and vehicles with identical hashes. Only then does installation reset the real
world through the existing transactional Store operation. Epoch/revision advance
once; active cells, vehicles and history clear. The previous world remains both
in the in-game recovery checkpoint and `before/world.sqlite3`. Failure after the
reset preserves that state and requires roll-forward. Accounts/codes stay valid.

Both teams must ready supported clear bases at least 32 blocks apart before
combat starts. Players carry enemy flags home, with their own flag home to win;
cover blocks pickup through walls. Knockout drops a flag, teammates return it,
and dropped flags return after 20 seconds. Leaving returns carried flags. Capture
ends combat until a new round. Mega/atom blasts by any player are refused where
they overlap the arena while a participant remains; participants cannot use them
anywhere. New rounds preserve terrain; the one-time deployment reset is separate.

## Content-4 upgrade record — already performed

Stage all **twelve** adapter modules beside `backup.py`, `upgrade_pack.py`,
`upgrade_battle.py`, and the generated `battlefield.json`/`battlefield.u16.zlib`
in a new private directory outside `worldsvc`. The helper pins all eight live
content-3 source hashes and refuses existing battle modules or baseline files.
The baseline comes from the release client's generator, origin `[-2048,1024]`,
seed `419947177`, with raw SHA-256
`1e931025f7a060c0b75dc720965b1aa0c278db1ea9bfd42d99e8efb711bf2ec2`.

```sh
/home/james/moorstead/venv/bin/python /path/to/private-stage/upgrade_battle.py --install
```

Only the relay stops. The helper backs up its eight modules and the complete
SQLite database, rehearses schema-marker 3→4 on a restored copy, proves the actual
old adapter refuses version 4, and compares counts and SHA-256 for all nine saved
tables: cells, checkpoint, history, receipts, meta, SQLite sequences, vehicles,
checkpoint vehicles and chunk counts. It repeats preservation checks on the
stopped live database before restart. Baseline files go into `DATA/freeplay`.
After migration, failures retain the upgraded world and require roll-forward;
never silently replace it with the older backup or downgrade its version marker.
The private stage retains `before/world.sqlite3` and `manifest.json` for recovery.
No dashboard, Caddy, account, ordinary world, brain or model changes are needed.

## Content-3 upgrade record — already performed

Stage all **eight** adapter modules alongside `backup.py`, `upgrade_pack.py` and
`upgrade_vehicles.py` in a new private directory outside `worldsvc`. The executable
source guards pin the five actual content-2 modules; new vehicle module names must
not already exist. Run the current relay Python only after release is authorised:

```sh
/home/james/moorstead/venv/bin/python /path/to/private-stage/upgrade_vehicles.py --install
```

Only the relay stops. The helper saves original modules and a consistent SQLite
backup, restores a separate rehearsal copy, migrates to version 3 and verifies all
old table counts/hashes are identical. Derived chunk counts must match saved cells,
new vehicle tables must be empty, and the actual old adapter must refuse version 3.
It repeats preservation checks on the stopped live database before restarting.
After migration, failure preserves the current database and requires roll-forward.
There is no automatic restoration of older world data or version-marker downgrade.
Do not touch invites, dashboard, Caddy, ordinary saves, or disabled model services.

An isolated EVO benchmark with 8,000,000 rows delivered/decoded a snapshot in 7.809s
(130,042,819 uncompressed bytes; ≤8,513 bytes/frame). Machinegun transactions at that
capacity took median 2.336ms, maximum 6.216ms. This establishes bounded server work,
not physical tablet/network performance. The actual live content-2 backup also
migrated on an isolated copy with every pre-existing table hash preserved.

## Content-2 upgrade record — already performed

The existing relay/dashboard/Caddy integration stays unchanged. Do not re-run the
initial integration transformer, mint replacement codes or start disabled services.
The four current live adapter hashes were read and matched the content-1 baseline
in `upgrade_pack.py`. A changed hash must be inspected before release.

Create a new private staging directory outside `worldsvc` (mode 0700). Copy
`upgrade_pack.py`, `backup.py`, and all **five** `worldsvc/freeplay_*.py` candidate
modules into that directory. Run with the relay's existing Python:

```sh
/home/james/moorstead/venv/bin/python /path/to/private-stage/upgrade_pack.py --install
```

The helper stops only `moorstead-world`, retains the original adapter modules and
a consistent SQLite backup, rehearses migration on a separate restored copy, and
checks count/hash equality for every saved table. It also executes the actual old
adapter to prove it refuses the upgraded rehearsal database. It then installs the
five modules, migrates the live database, verifies identical table hashes before
restart and waits for relay health. The fresh restart closes legacy sockets.
The parent release still checks the real live login → build/weapon → undo journey;
relay health alone does not establish product readiness.

Before database migration, failure restores the original adapter. After migration,
the helper preserves the upgraded database and reports that roll-forward is needed.
Do not run old code against version 2, lower the version marker, or silently replace
the world from the pre-upgrade backup. Emergency restoration would discard later
play and requires an explicit decision with the current database retained first.
No dashboard, Caddy, invite, account, ordinary world or NPC/model changes are needed.

## Initial installation record — already performed for content 1

1. Run the canonical client/backend checks and browser journeys, inspect actual
   output, and resolve material findings from fresh independent review. Retain
   the mixed-device performance gap until a representative device has been tried.
2. Copy current relay, dashboard and Caddy source read-only into a local directory
   as `server.py`, `app.py`, `Caddyfile`. Run
   `python deploy/free-play/integrate.py <source-directory> <different-staging-directory>`.
   It never writes the input files or starts services. A changed hash is an explicit
   merge/review requirement; do not bypass it or overwrite newer server work.
3. On the EVO, back up each live source to a dated path before changing it, and
   retain current client deployment identity. If Free Play already has data, run
   `backup.py <live-world.sqlite3> <new-dated-backup.sqlite3>` and test opening a
   separate restored copy. Do not copy a running SQLite main file without its WAL;
   the backup API includes committed WAL state. Never replace invite/account stores.
4. Install the `worldsvc` modules next to the relay, and the staged relay,
   dashboard and Caddy sources. Validate Caddy configuration before reload. Changes
   add only `/freeplay/ws` and public `/dash/auth/freeplay-claim`; mint, revoke,
   administration and reset administration endpoints remain outside the public
   allowlist. Restart only `moorstead-world` and `moorstead-dash`, and reload Caddy.
   Do not start disabled NPC/model services or touch other games.
5. Release the matching client through `npm run deploy` after its clean-tree,
   main-branch and pushed-baseline prerequisites are resolved. The dedicated claim
   route is fail-closed on the older backend, so partial rollout cannot silently
   submit an ordinary account through the new entrance.
6. Privately provision **fresh** codes bound to exactly `family-freeplay`, one for
   Henry and one for James. Preserve existing codes/accounts. Verify both from the
   actual `/freeplay` URL through build/blast/reconnect/undo/reset/restore, then an
   ordinary login. Only then deliver the working codes to James; never commit them.
   The inspected private Board route is `POST http://evo:8099/api/moor/mint` with
   JSON `{"room":"family-freeplay"}`; it forwards to dashboard loopback
   `POST http://127.0.0.1:8095/api/mint`. Mint twice, then use the new dedicated
   claim route with the respective name. Do not reassign an existing code through
   setroom. These are release instructions only, not evidence of minted codes.
7. For code rollback, restore the dated relay/dashboard/Caddy sources, restore the
   previous client deployment and restart/reload only those services. Preserve the
   Free Play SQLite directory intact; old services ignore it. For world recovery,
   stop the relay first, retain the current SQLite database plus WAL/SHM as a
   separate incident copy, restore the verified backup into the Free Play path,
   start the relay and probe both identities. Never restore over ordinary pockets,
   codes or worlds. Restoring a database disconnects all sessions before its older
   epoch can return; clients must begin with a fresh snapshot.

The offline suite proves neither live release readiness nor physical tablet
performance; those need their corresponding live/device evidence.
