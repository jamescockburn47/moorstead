# clint-body — Phase 5a in-world presence

> **Out of date (2026-06-20).** This README describes the original Phase-5a scripted greeter. Since then `clint_body.py` became **Merlin**, an LLM-backed in-world wizard: summoned by name, holds world-aware conversations through the brain at `:8010` (with the game-facts mini-RAG in `npc_facts.py` + `game-facts.json`), leads players to places, and casts spells. Current behaviour + architecture: the `clint-moorstead-warden` and `moorstead-npc-memory` memories.
>
> **Deploy:** `scp clint-body/{clint_body.py,npc_facts.py,game-facts.json}` → `~/moorstead/clint-body/` on the EVO (`evo-tailscale`), then `sudo systemctl restart clint-body clint-body-bairns`. Back up first (`cp x x.bak-YYYYMMDD-tag`) and smoke-test. The historical walkthrough follows.

A lightweight Python process that connects to the Moorstead relay as the
character **Clint** (`pid=clint-body`, `name=Clint`).  It maintains a visible
avatar near spawn, sends position keep-alives every ~2 seconds, and greets
real players with a scripted Yorkshire welcome when they join.

**Adult worlds only.**  Phase 5a does not support the bairns room.

---

## What it does

- Connects to `ws://127.0.0.1:8096/ws?room=moor&pid=clint-body&name=Clint`
- Idles near spawn at a fixed Y=40 (see below on terrain height)
- Slowly patrols between four waypoints close to spawn, rotating yaw to look
  around
- On `{type:"join"}` for any other player, waits ~1.5 s then sends one
  scripted greeting.  Each pid is greeted at most once per session; greetings
  are throttled to at most one every 5 s so a join storm cannot spam the room.
- Also greets players already in the room at the moment Clint connects (via
  the `init` message's `players` field).
- On disconnect (relay restart, network blip), waits 3 s and reconnects.
  Greeting state resets on reconnect so returning players are welcomed again.
- Logs to stdout/journal.  Never crashes — all exceptions are caught and
  trigger a reconnect cycle.

---

## Requirements

- Python 3.10+
- `websockets` library (already in the EVO venv at
  `/home/james/moorstead/venv`)

Local syntax check (no relay needed):

```bash
python -m py_compile clint_body.py && echo "OK"
```

---

## Config (environment variables)

| Variable | Default | Description |
|---|---|---|
| `RELAY_WS_BASE` | `ws://127.0.0.1:8096/ws` | Relay WebSocket base URL |
| `CLINT_BODY_ROOM` | `moor` | Room to join.  **Must not be `bairns`** in 5a. |
| `CLINT_BODY_PID` | `clint-body` | Player-ID sent to the relay |
| `CLINT_BODY_NAME` | `Clint` | Display name |
| `CLINT_BODY_ENABLED` | `true` | Kill-switch — set `false` to exit 0 immediately |

---

## How to run (manual, on the EVO)

```bash
cd /home/james/moorstead/clint-body
/home/james/moorstead/venv/bin/python clint_body.py
```

Or with environment overrides:

```bash
CLINT_BODY_ROOM=dale /home/james/moorstead/venv/bin/python clint_body.py
```

---

## Kill-switches

### Immediate stop

```bash
sudo systemctl stop clint-body
```

Clint disconnects from the relay and vanishes for other players.  Does not
auto-restart until the service is started again.

### Soft disable (persists across restarts)

Set `CLINT_BODY_ENABLED=false` in the environment before starting, or use a
systemd drop-in:

```bash
sudo systemctl edit clint-body
```

Add:

```ini
[Service]
Environment="CLINT_BODY_ENABLED=false"
```

Then `sudo systemctl daemon-reload && sudo systemctl restart clint-body`.
The process starts, logs "disabled", and exits 0.  The unit is listed as
`active (exited)` — not an error.

### Re-enable

Remove the drop-in (`sudo systemctl edit clint-body`, delete the lines) then
`sudo systemctl restart clint-body`.

---

## Systemd installation

```bash
# Copy files to the EVO
scp clint_body.py evo-tailscale:/home/james/moorstead/clint-body/
scp clint-body.service evo-tailscale:/etc/systemd/system/

# On the EVO
sudo systemctl daemon-reload
sudo systemctl enable clint-body
sudo systemctl start clint-body
sudo journalctl -u clint-body -f
```

---

## Known limitations / notes for the controller

- **Terrain height is not sampled.**  Y=40 is a fixed idle height near spawn.
  The relay has no server-side height oracle.  Players see Clint floating or
  slightly below ground depending on spawn-area terrain.  A later refinement
  can derive ground height from the relay's `init.edits` array (finding the
  highest edit within a few blocks of the waypoints); deferred to Phase 5b.

- **No LLM.**  All responses are scripted templates.  Conversational depth
  (respond to player chat) is Phase 5b / 5c territory.

- **Bairns room hard-blocked.**  Attempting `CLINT_BODY_ROOM=bairns` exits
  with code 1.  Phase 5c (children's world) is a separate, gated stage.

- **Single room.**  One process, one room.  To be present in multiple rooms
  simultaneously, run one process per room with different `CLINT_BODY_ROOM`
  and `CLINT_BODY_PID` values.

- **Greeting on re-entry.**  The relay's `init` message includes current
  players; Clint will greet them.  But if Clint disconnects and reconnects
  while a player is still present, that player will be greeted again (state
  resets on reconnect).  Acceptable in 5a.
