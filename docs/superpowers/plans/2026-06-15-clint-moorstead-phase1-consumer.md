# Clint↔Moorstead Phase 1 (Consumer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Clint the ability to receive Moorstead game events over HTTP and curate them to James on WhatsApp — immediate pings for notable events, a daily digest for routine activity, and a session-end roundup when a room empties.

**Architecture:** A new `src/moorstead/` module in the clawdbot repo with three pure, dependency-injected units (event store, curation, ingest) plus a thin HTTP route and a scheduler task. The relay and client only need to POST a small JSON event to `/api/moorstead-event`; all intelligence lives here in the agent. Pure modules take their collaborators as parameters so they unit-test without booting the app or touching `config.js`.

**Tech Stack:** Node ≥20, ESM, `node:test` via `tsx --test`, `node:assert/strict`. No new dependencies.

---

## Working directory

**All tasks in this plan operate on the clawdbot repo, NOT the Moorstead repo:**

```
C:\Users\James\Downloads\clawdbot-claude-code
```

This is a separate git repo. All file paths and git commands below are relative to that root. (This plan document itself lives in the Moorstead repo's `docs/superpowers/plans/`.)

## Scope

**In scope (Plan 1 — the consumer):**
- `POST /api/moorstead-event` intake endpoint (auth-gated, reusing `DASHBOARD_TOKEN`).
- Event store (in-memory recent ring + dated JSONL persistence + room presence).
- Curation: notable-vs-routine classification, notable formatting, daily digest, session-end digest.
- Ingest orchestration (validate → store → notify).
- Daily digest scheduler task.

**Out of scope (Plan 2 — the sensors, separate plan):**
- The relay emit hook (`~/moorstead/server.py` on the EVO) that POSTs real events.
- Client `src/telemetry.js` bug capture in the Moorstead repo.
- Active-triage **log correlation** (needs the relay's `/admin/logs`, built in Plan 2). Plan 1 still emits a useful error ping (message + location snapshot from the event payload); it just doesn't yet fetch server logs.
- A dedicated "Moorstead" WhatsApp thread (Phase 5). Plan 1 sends to `MOORSTEAD_JID` if set, else the owner DM.

## Event contract (the JSON the relay will POST)

```json
{ "type": "join|leave|edit|error|milestone",
  "room": "moor",
  "pid": "a1b2c3",
  "name": "Alice",
  "detail": { "message": "…", "lookingAt": "…", "protected": true, "milestone": "…", "target": "…" },
  "ts": 1718000000000 }
```
`type` and `room` are required; everything else is optional. `ts` is epoch milliseconds (defaults to now if absent).

## File structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/moorstead/store.js` | Event persistence + in-memory recent + room presence. Factory `createStore()` + default singleton. | Create |
| `src/moorstead/curate.js` | Pure classification + formatting (notable, digest, session digest). | Create |
| `src/moorstead/ingest.js` | Orchestrate validate → store → notify. Injected `send` + `store`. | Create |
| `src/tasks/moorstead-digest.js` | Daily digest scheduler task. | Create |
| `src/config.js` | Add `MOORSTEAD_ENABLED`, `MOORSTEAD_JID`. | Modify |
| `src/http-server.js` | Add thin `POST /api/moorstead-event` route; return the server. | Modify |
| `src/scheduler.js` | Import + dispatch the digest task. | Modify |
| `test/moorstead-store.test.js` | Store unit tests. | Create |
| `test/moorstead-curate.test.js` | Curation unit tests. | Create |
| `test/moorstead-ingest.test.js` | Ingest unit tests. | Create |
| `test/moorstead-digest.test.js` | Digest task test (env-set + singleton store). | Create |

---

### Task 1: Event store

**Files:**
- Create: `src/moorstead/store.js`
- Test: `test/moorstead-store.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/moorstead-store.test.js`:

```js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/moorstead/store.js';

describe('moorstead/store', () => {
  let dir, store;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'moor-store-')); store = createStore({ dataDir: dir }); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('records an event and returns it with its ts', () => {
    const e = store.recordEvent({ type: 'join', room: 'moor', pid: 'a1', name: 'Alice', ts: 1718000000000 });
    assert.equal(e.type, 'join');
    assert.equal(e.ts, 1718000000000);
  });

  it('defaults a missing ts to a number', () => {
    const e = store.recordEvent({ type: 'edit', room: 'moor', pid: 'a1' });
    assert.equal(typeof e.ts, 'number');
  });

  it('tracks room presence on join/leave', () => {
    store.recordEvent({ type: 'join', room: 'moor', pid: 'a1', ts: 1 });
    store.recordEvent({ type: 'join', room: 'moor', pid: 'a2', ts: 2 });
    assert.equal(store.roomCount('moor'), 2);
    store.recordEvent({ type: 'leave', room: 'moor', pid: 'a1', ts: 3 });
    assert.equal(store.roomCount('moor'), 1);
    assert.deepEqual(store.roomPresence('moor'), ['a2']);
  });

  it('filters recent events by room and sinceTs', () => {
    store.recordEvent({ type: 'edit', room: 'moor', pid: 'a1', ts: 10 });
    store.recordEvent({ type: 'edit', room: 'dale', pid: 'a2', ts: 20 });
    assert.equal(store.recentEvents({ room: 'moor' }).length, 1);
    assert.equal(store.recentEvents({ sinceTs: 15 }).length, 1);
  });

  it('persists events to a dated JSONL file', () => {
    store.recordEvent({ type: 'join', room: 'moor', pid: 'a1', ts: 1718000000000 });
    const day = new Date(1718000000000).toISOString().slice(0, 10);
    const f = join(dir, `events-${day}.jsonl`);
    assert.ok(existsSync(f));
    assert.match(readFileSync(f, 'utf8'), /"type":"join"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-store.test.js`
Expected: FAIL — `Cannot find module '../src/moorstead/store.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/moorstead/store.js`:

```js
// src/moorstead/store.js — Moorstead event store: in-memory recent ring,
// room presence bookkeeping, and dated JSONL persistence. Factory so tests
// get isolated instances; a default singleton is shared by route + task.
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export function createStore({ dataDir = join('data', 'moorstead'), maxRecent = 500 } = {}) {
  const recent = [];
  const presence = new Map(); // room -> Set(pid)

  function dayFile(ts) {
    const day = new Date(ts).toISOString().slice(0, 10);
    return join(dataDir, `events-${day}.jsonl`);
  }

  function recordEvent(evt) {
    const e = { ...evt, ts: typeof evt.ts === 'number' ? evt.ts : Date.now() };
    recent.push(e);
    if (recent.length > maxRecent) recent.shift();

    if (e.type === 'join') {
      if (!presence.has(e.room)) presence.set(e.room, new Set());
      presence.get(e.room).add(e.pid);
    } else if (e.type === 'leave') {
      presence.get(e.room)?.delete(e.pid);
    }

    try {
      mkdirSync(dataDir, { recursive: true });
      appendFileSync(dayFile(e.ts), JSON.stringify(e) + '\n');
    } catch { /* persistence is best-effort; never block ingest */ }
    return e;
  }

  function recentEvents({ sinceTs = 0, room = null } = {}) {
    return recent.filter((e) => e.ts >= sinceTs && (!room || e.room === room));
  }

  function roomPresence(room) { return [...(presence.get(room) || [])]; }
  function roomCount(room) { return presence.get(room)?.size || 0; }

  return { recordEvent, recentEvents, roomPresence, roomCount };
}

const store = createStore();
export default store;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-store.test.js`
Expected: PASS — `# pass 5  # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/moorstead/store.js test/moorstead-store.test.js
git commit -m "feat(moorstead): event store with presence + JSONL persistence"
```

---

### Task 2: Curation (classification + formatting)

**Files:**
- Create: `src/moorstead/curate.js`
- Test: `test/moorstead-curate.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/moorstead-curate.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNotable, formatNotable, composeDigest, composeSessionDigest } from '../src/moorstead/curate.js';

describe('moorstead/curate', () => {
  it('classifies join/leave/error/milestone as notable', () => {
    for (const type of ['join', 'leave', 'error', 'milestone']) {
      assert.equal(isNotable({ type, room: 'moor' }), true);
    }
  });

  it('classifies a normal edit routine, a protected-landmark edit notable', () => {
    assert.equal(isNotable({ type: 'edit', room: 'moor' }), false);
    assert.equal(isNotable({ type: 'edit', room: 'moor', detail: { protected: true } }), true);
  });

  it('formats a join with name and room', () => {
    assert.equal(formatNotable({ type: 'join', name: 'Alice', room: 'moor' }), '*Moorstead:* Alice joined moor.');
  });

  it('formats an error with its message', () => {
    const s = formatNotable({ type: 'error', name: 'Alice', room: 'moor', detail: { message: 'boom' } });
    assert.match(s, /Moorstead error/);
    assert.match(s, /boom/);
  });

  it('composes a digest with player count and edits per room', () => {
    const evs = [
      { type: 'join', name: 'Alice', room: 'moor' },
      { type: 'edit', name: 'Alice', room: 'moor' },
      { type: 'edit', name: 'Alice', room: 'moor' },
    ];
    const d = composeDigest(evs);
    assert.match(d, /1 active: Alice/);
    assert.match(d, /moor: 2 blocks changed/);
  });

  it('returns null digest when there are no events', () => {
    assert.equal(composeDigest([]), null);
  });

  it('composes a session digest for an emptied room', () => {
    assert.match(composeSessionDigest('moor', [{ type: 'edit', name: 'Alice', room: 'moor' }]), /moor is now empty/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-curate.test.js`
Expected: FAIL — `Cannot find module '../src/moorstead/curate.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/moorstead/curate.js`:

```js
// src/moorstead/curate.js — pure classification + WhatsApp formatting.
// No I/O, no config: fully unit-testable.

const NOTABLE_TYPES = new Set(['join', 'leave', 'error', 'milestone']);

export function isNotable(evt) {
  if (NOTABLE_TYPES.has(evt.type)) return true;
  if (evt.type === 'edit' && evt.detail?.protected) return true; // repeated hits on protected fabric
  return false;
}

export function formatNotable(evt) {
  const who = evt.name || evt.pid || 'someone';
  const room = evt.room || 'the moor';
  switch (evt.type) {
    case 'join': return `*Moorstead:* ${who} joined ${room}.`;
    case 'leave': return `*Moorstead:* ${who} left ${room}.`;
    case 'milestone': return `*Moorstead:* ${who} reached "${evt.detail?.milestone || 'a milestone'}" in ${room}.`;
    case 'error': {
      const msg = evt.detail?.message || 'unknown error';
      const at = evt.detail?.lookingAt ? ` (looking at ${evt.detail.lookingAt})` : '';
      return `*Moorstead error* — ${who} in ${room}${at}\n${msg}`;
    }
    case 'edit': return `*Moorstead:* ${who} kept hitting protected ${evt.detail?.target || 'fabric'} in ${room}.`;
    default: return `*Moorstead:* ${evt.type} in ${room}.`;
  }
}

export function composeDigest(events) {
  if (!events.length) return null;
  const players = [...new Set(events.map((e) => e.name || e.pid).filter(Boolean))];
  const editsByRoom = {};
  for (const e of events) if (e.type === 'edit') editsByRoom[e.room] = (editsByRoom[e.room] || 0) + 1;
  const lines = ['*Moorstead — digest*'];
  lines.push(players.length ? `${players.length} active: ${players.join(', ')}` : 'No players today.');
  for (const [room, n] of Object.entries(editsByRoom)) lines.push(`${room}: ${n} blocks changed`);
  return lines.join('\n');
}

export function composeSessionDigest(room, events) {
  const roomEvents = events.filter((e) => e.room === room);
  const players = [...new Set(roomEvents.map((e) => e.name || e.pid).filter(Boolean))];
  const edits = roomEvents.filter((e) => e.type === 'edit').length;
  return `*Moorstead:* ${room} is now empty. ${players.length} played, ${edits} blocks changed.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-curate.test.js`
Expected: PASS — `# pass 7  # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/moorstead/curate.js test/moorstead-curate.test.js
git commit -m "feat(moorstead): notable classification + digest formatting"
```

---

### Task 3: Ingest orchestration

**Files:**
- Create: `src/moorstead/ingest.js`
- Test: `test/moorstead-ingest.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/moorstead-ingest.test.js`:

```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/moorstead/store.js';
import { ingestMoorsteadEvent, validateEvent } from '../src/moorstead/ingest.js';

describe('moorstead/ingest', () => {
  let store, sent;
  const send = (t) => { sent.push(t); };
  beforeEach(() => {
    store = createStore({ dataDir: mkdtempSync(join(tmpdir(), 'moor-ingest-')) });
    sent = [];
  });

  it('rejects an event with a bad type', () => {
    assert.match(validateEvent({ type: 'nope', room: 'moor' }), /invalid type/);
  });

  it('rejects an event with no room', () => {
    assert.match(validateEvent({ type: 'join' }), /room required/);
  });

  it('sends an immediate ping for a notable join', async () => {
    const r = await ingestMoorsteadEvent({ type: 'join', name: 'Alice', room: 'moor', ts: 1 }, { send, store });
    assert.equal(r.ok, true);
    assert.equal(r.notified, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Alice joined moor/);
  });

  it('does not ping for a routine edit', async () => {
    const r = await ingestMoorsteadEvent({ type: 'edit', name: 'Alice', room: 'moor', ts: 1 }, { send, store });
    assert.equal(r.ok, true);
    assert.equal(r.notified, false);
    assert.equal(sent.length, 0);
  });

  it('sends a session digest when a leave empties the room', async () => {
    await ingestMoorsteadEvent({ type: 'join', name: 'Alice', room: 'moor', ts: 1 }, { send, store });
    sent.length = 0;
    await ingestMoorsteadEvent({ type: 'leave', name: 'Alice', room: 'moor', ts: 2 }, { send, store });
    assert.ok(sent.some((m) => /left moor/.test(m)), 'leave ping');
    assert.ok(sent.some((m) => /moor is now empty/.test(m)), 'session digest');
  });

  it('returns an error result for invalid events without throwing', async () => {
    const r = await ingestMoorsteadEvent({ type: 'bad', room: 'moor' }, { send, store });
    assert.equal(r.ok, false);
    assert.equal(sent.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-ingest.test.js`
Expected: FAIL — `Cannot find module '../src/moorstead/ingest.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/moorstead/ingest.js`:

```js
// src/moorstead/ingest.js — orchestrate one incoming event:
// validate -> store -> (maybe) notify. `send` and `store` are injected
// so this is testable without HTTP or config.
import defaultStore from './store.js';
import { isNotable, formatNotable, composeSessionDigest } from './curate.js';

const VALID_TYPES = new Set(['join', 'leave', 'edit', 'error', 'milestone']);

export function validateEvent(evt) {
  if (!evt || typeof evt !== 'object') return 'event must be an object';
  if (!VALID_TYPES.has(evt.type)) return `invalid type: ${evt.type}`;
  if (!evt.room || typeof evt.room !== 'string') return 'room required';
  return null;
}

export async function ingestMoorsteadEvent(evt, { send, store = defaultStore } = {}) {
  const err = validateEvent(evt);
  if (err) return { ok: false, error: err };

  const wasOccupied = store.roomCount(evt.room) > 0;
  const stored = store.recordEvent(evt);
  let notified = false;

  if (isNotable(stored) && typeof send === 'function') {
    await send(formatNotable(stored));
    notified = true;
  }

  // Session-end: a leave that drops the room to empty.
  if (stored.type === 'leave' && wasOccupied && store.roomCount(evt.room) === 0 && typeof send === 'function') {
    await send(composeSessionDigest(evt.room, store.recentEvents({ room: evt.room })));
    notified = true;
  }

  return { ok: true, stored, notified };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-ingest.test.js`
Expected: PASS — `# pass 6  # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/moorstead/ingest.js test/moorstead-ingest.test.js
git commit -m "feat(moorstead): ingest orchestration (validate/store/notify)"
```

---

### Task 4: Config additions

**Files:**
- Modify: `src/config.js` (add to `ConfigSchema` after line 32 `PAIRING_PHONE_NUMBER`, and to the exported `config` object after line 161 `pairingPhoneNumber`)
- Test: `test/moorstead-config.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/moorstead-config.test.js`:

```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-key-not-real';

let config;
async function load() { config = (await import('../src/config.js')).default; }

describe('config — moorstead keys', () => {
  beforeEach(async () => { if (!config) await load(); });

  it('exposes moorsteadEnabled as a boolean (default true)', () => {
    assert.equal(typeof config.moorsteadEnabled, 'boolean');
    assert.equal(config.moorsteadEnabled, true);
  });

  it('exposes moorsteadJid as a string (default empty)', () => {
    assert.equal(typeof config.moorsteadJid, 'string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-config.test.js`
Expected: FAIL — `moorsteadEnabled` is `undefined`, assertion fails on `typeof ... === 'boolean'`.

- [ ] **Step 3: Write minimal implementation**

In `src/config.js`, add to `ConfigSchema` immediately after the `PAIRING_PHONE_NUMBER` line (line 32):

```js
  // Moorstead game integration
  MOORSTEAD_ENABLED: boolFromEnv.default('true'),
  MOORSTEAD_JID: z.string().optional().default(''),
```

And add to the exported `config` object immediately after the `pairingPhoneNumber: env.PAIRING_PHONE_NUMBER,` line (line 161):

```js
  moorsteadEnabled: env.MOORSTEAD_ENABLED,
  moorsteadJid: env.MOORSTEAD_JID,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-config.test.js`
Expected: PASS — `# pass 2  # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/moorstead-config.test.js
git commit -m "feat(moorstead): MOORSTEAD_ENABLED + MOORSTEAD_JID config"
```

---

### Task 5: HTTP route `POST /api/moorstead-event`

**Files:**
- Modify: `src/http-server.js` (add a route block after the `/api/send` block which ends at line 85; change `server.listen(...)` tail to return the server)

- [ ] **Step 1: Add the route**

In `src/http-server.js`, immediately after the `/api/send` route block (the one that ends with `return; }` around line 85), insert:

```js
    if (req.method === 'POST' && path === '/api/moorstead-event') {
      if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' });
      if (!config.moorsteadEnabled) return json(res, 200, { ok: true, disabled: true });
      try {
        const evt = JSON.parse(await readBody(req));
        const { ingestMoorsteadEvent } = await import('./moorstead/ingest.js');
        const result = await ingestMoorsteadEvent(evt, {
          send: (text) => sendProactiveMessage(config.moorsteadJid || config.ownerJid, text),
        });
        return json(res, result.ok ? 200 : 400, result);
      } catch (err) { return json(res, 500, { error: err.message }); }
    }
```

- [ ] **Step 2: Make the server testable by returning it**

In `src/http-server.js`, at the very end of `startHttpServer` — after the existing `startWidgetRefresh();` line (line 625) and before the closing `}` (line 626) — add `return server;`:

```js
  startWidgetRefresh();

  return server;
}
```
(This is the only change here; do not touch the `server.listen(...)` or `startWidgetRefresh()` lines themselves.)

- [ ] **Step 3: Typecheck + smoke verify**

This route boots the full app graph, so it is verified by a manual smoke test rather than an automated test (the logic it delegates to is already covered by `test/moorstead-ingest.test.js`).

Run typecheck: `npm run typecheck`
Expected: no errors.

Manual smoke (in one terminal, with a real `.env` so the bot connects, OR accept the 500 if WhatsApp is offline — a 400/200 still proves routing):
```bash
# Terminal A: node --env-file=.env src/index.js   (bot running, HTTP on :3000)
# Terminal B:
curl -s -X POST http://localhost:3000/api/moorstead-event \
  -H "Authorization: Bearer $DASHBOARD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"join","name":"SmokeTest","room":"moor","ts":1718000000000}'
```
Expected: `{"ok":true,"stored":{...},"notified":true}` (and a WhatsApp ping `*Moorstead:* SmokeTest joined moor.` if connected). A malformed body returns `{"ok":false,"error":"invalid type: ..."}` with HTTP 400.

- [ ] **Step 4: Commit**

```bash
git add src/http-server.js
git commit -m "feat(moorstead): POST /api/moorstead-event intake route"
```

---

### Task 6: Daily digest scheduler task

**Files:**
- Create: `src/tasks/moorstead-digest.js`
- Test: `test/moorstead-digest.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/moorstead-digest.test.js`:

```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
process.env.MOORSTEAD_ENABLED = 'true';
// Clean slate so the task's persisted lastDigestDate doesn't make this flaky
// on a same-day re-run. Runs at file load, before the dynamic import below.
rmSync(join('data', 'moorstead-digest-state.json'), { force: true });

let checkMoorsteadDigest, store;
async function load() {
  ({ checkMoorsteadDigest } = await import('../src/tasks/moorstead-digest.js'));
  store = (await import('../src/moorstead/store.js')).default;
}

describe('moorstead-digest task', () => {
  beforeEach(async () => { if (!checkMoorsteadDigest) await load(); });

  it('sends a digest after the digest hour when events exist', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const startOfDay = new Date(today + 'T00:00:00Z').getTime();
    store.recordEvent({ type: 'join', name: 'Zara', room: 'moor', ts: startOfDay + 1000 });
    store.recordEvent({ type: 'edit', name: 'Zara', room: 'moor', ts: startOfDay + 2000 });
    const sent = [];
    await checkMoorsteadDigest((t) => sent.push(t), today, 20, 0);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Moorstead — digest/);
    assert.match(sent[0], /Zara/);
  });

  it('does not send twice on the same day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const sent = [];
    await checkMoorsteadDigest((t) => sent.push(t), today, 20, 0);
    assert.equal(sent.length, 0);
  });

  it('does not send before the digest hour', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const sent = [];
    await checkMoorsteadDigest((t) => sent.push(t), tomorrow, 9, 0);
    assert.equal(sent.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-digest.test.js`
Expected: FAIL — `Cannot find module '../src/tasks/moorstead-digest.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/tasks/moorstead-digest.js`:

```js
// Task: Moorstead daily digest — routine activity rolled up once a day.
import config from '../config.js';
import logger from '../logger.js';
import store from '../moorstead/store.js';
import { composeDigest } from '../moorstead/curate.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const STATE_FILE = join('data', 'moorstead-digest-state.json');
const DIGEST_HOUR = 20; // 20:00 London

function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(s) {
  try { writeFileSync(STATE_FILE, JSON.stringify(s), 'utf8'); }
  catch (err) { logger.warn({ err: err.message }, 'moorstead digest state save failed'); }
}

let lastDigestDate = loadState().lastDigestDate || null;

/**
 * Send the Moorstead daily digest at DIGEST_HOUR (London).
 * @param {Function} sendFn - single-arg WhatsApp send (owner-bound by scheduler)
 * @param {string} todayStr - YYYY-MM-DD
 * @param {number} hours - London hour
 * @param {number} minutes - London minute
 */
export async function checkMoorsteadDigest(sendFn, todayStr, hours, minutes) {
  if (!config.moorsteadEnabled || !sendFn) return;
  if (lastDigestDate === todayStr) return;
  if (hours < DIGEST_HOUR || hours > DIGEST_HOUR + 1) return;

  lastDigestDate = todayStr;
  saveState({ lastDigestDate });

  const startOfDay = new Date(todayStr + 'T00:00:00Z').getTime();
  const digest = composeDigest(store.recentEvents({ sinceTs: startOfDay }));
  if (!digest) return;

  try { await sendFn(digest); logger.info('moorstead digest sent'); }
  catch (err) { logger.error({ err: err.message }, 'moorstead digest failed'); }
}

export function getLastMoorsteadDigestDate() { return lastDigestDate; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --test-concurrency=1 test/moorstead-digest.test.js`
Expected: PASS — `# pass 3  # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/moorstead-digest.js test/moorstead-digest.test.js
git commit -m "feat(moorstead): daily digest scheduler task"
```

---

### Task 7: Wire the digest task into the scheduler

**Files:**
- Modify: `src/scheduler.js` (add an import near the other task imports ~line 28, and a `runTask` dispatch in `runScheduler` after the daytime tasks ~line 107)

- [ ] **Step 1: Add the import**

In `src/scheduler.js`, after the line `import { checkFailureNudge } from './tasks/lqc-bot-failure-nudge.js';` (line 28), add:

```js
import { checkMoorsteadDigest } from './tasks/moorstead-digest.js';
```

- [ ] **Step 2: Add the dispatch**

In `runScheduler()`, after the `weeklyReview` dispatch line (`await runTask('weeklyReview', () => checkWeeklyReview(sendFn, todayStr, hours));`, line 107), add:

```js
  await runTask('moorsteadDigest', () => checkMoorsteadDigest(sendFn, todayStr, hours, minutes));
```

- [ ] **Step 3: Verify the whole suite still passes**

Run: `npm test`
Expected: all test files pass, including `scheduler.test.js` (the module still loads cleanly) and the four new `moorstead-*` files. `# fail 0` overall.

- [ ] **Step 4: Commit**

```bash
git add src/scheduler.js
git commit -m "feat(moorstead): dispatch daily digest from scheduler"
```

---

## Definition of done

- `npm test` passes with the four new `moorstead-*.test.js` files green and no regressions.
- `POST /api/moorstead-event` accepts the event contract, stores events, sends an immediate WhatsApp ping for notable events (join/leave/error/milestone/protected-edit) and a session-end digest when a room empties.
- The daily digest fires once per day at 20:00 London with routine activity.
- All sends route to `MOORSTEAD_JID` if set, else the owner DM.

## Next plan (not this one)

**Plan 2 — sensors:** the relay emit hook in `~/moorstead/server.py` (POST real events here, fire-and-forget), client `src/telemetry.js` (window.onerror → relay → here), and the relay `/admin/logs` endpoint that upgrades error pings into active triage (log correlation + diagnosis).
