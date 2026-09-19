# Private Free Play — staged backend

Prepared 19 September 2026. **Not deployed.** No real invites, sessions, player
records or production database are included. The approved plan authorises building
and testing; its release step requires separate approval of the tested result.

This package serves exactly `family-freeplay` at `/freeplay/ws`, using the existing
relay's token-ledger authentication. A dedicated dashboard claim route refuses an
ordinary invite before changing an account or minting a session. The normal relay
route refuses this room before reading or creating ordinary room state.

## Source and installation map

| Source | Destination / purpose |
|---|---|
| `worldsvc/freeplay_rules.py` | Relay directory; protocol limits, validators and deterministic blast cells |
| `worldsvc/freeplay_store.py` | Relay directory; transactional SQLite persistence/history/recovery |
| `worldsvc/freeplay_stream.py` | Relay directory; bounded snapshot and operation frames |
| `worldsvc/freeplay_service.py` | Relay directory; session validation and exact-room WebSocket endpoint |
| `integrate.py` | Locally prepares the minimal relay/dashboard/Caddy modifications |
| `backup.py` | Consistent, integrity-checked SQLite backup into a new file |
| `fixture.py` | Loopback-only synthetic login/server for browser tests; never install in production |
| `verify.py` | Canonical offline backend check |

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
and WAL journalling. `user_version=1` refuses future schemas. The fixed seed is
`419947177`, the existing Moorstead `strSeed('t-moors-1900')` value.

An absent override means procedural baseline. A stored `0` means air. Undo sends
`null` to remove an override, preserving this distinction. Damage has no expiry.
Reset copies current overrides into the pre-reset checkpoint, clears world/history,
advances epoch and clears peer positions. Resetting pristine terrain again retains
the useful previous checkpoint. Restore swaps the active world and checkpoint,
advances epoch and clears history; the replaced world remains recoverable.

Limits are explicit: 1,000,000 override cells; 1,024 touched 16×16 chunks;
20 recent actions and at most 400,000 inverse cells; 4,096 idempotency receipts;
8 simultaneous identities; 64 blocks per building stroke; 512 rows per outgoing
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
30-second deadline; slow or broken peers close and recover from the durable
snapshot on reconnect. Receipt identity is stable account pid plus requestId;
reused IDs with changed content are refused. Even after old receipts are pruned,
the original exact epoch/revision makes a delayed duplicate stale.

No player pockets are read or saved. Positions are ephemeral, bounded and checked
against the exact epoch. Token expiry/revocation is rechecked on operations and
approximately every second when idle. Authentication comes only from the existing
server callback and the exact room-bound session, never a client capability flag.

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

It binds **127.0.0.1 only**. Without `--data`, it creates and cleans a temporary
store. Its synthetic codes are `henry-test-only` and `james-test-only`. POST
`/auth/freeplay-claim` with `{code: ...}` returns synthetic acct/token/name/room and
`edition: "freeplay"`. Connect `/freeplay/ws?room=family-freeplay&pid=a<acct>&token=<token>`.
Browser interception may redirect only those fixture requests; the shipped client
has no bypass or test login. The fixture authenticates synthetic in-memory sessions
through the same production adapter. It does not establish live invite validity.

## Release and recovery — after explicit release approval

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
4. Install the four `worldsvc` modules next to the relay, and the staged relay,
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

No live release, real credential provisioning, production rollback or physical
tablet performance is proved by this staged backend test suite.
