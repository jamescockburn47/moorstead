# Free Worlds (Slice 1: `bairns-free`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated relaxed-survival shared kids' world (`bairns-free`) on the same
moors-1900 map — builds never crumble, no deeds/licences, deep digging gated only by pick tier,
a starter pack in place of the bare-hands wipe — leaving the existing `bairns` world as the
harder version.

**Architecture:** One new pure module `src/rooms.js` holds room classification (shard-aware) and
the starter-pack manifest. A single `game.freeWorld()` predicate, derived from it, threads a
`free` flag through the two pure rules modules (`editledger.js` `isExpired` + `mayDigDeep`) and
the inventory/seed wiring in `main.js`/`player.js`. The relay needs no code change (rooms are
lazily created); only Henry's login code is repointed in data.

**Tech Stack:** Vanilla ES modules, Vite, Three.js (client). Headless Node verify scripts
(`scripts/verify-*.mjs`) gate the pure logic. Spec: `docs/superpowers/specs/2026-06-27-free-worlds-design.md`.

---

### Task 1: `src/rooms.js` — pure room classification + starter-pack manifest

**Files:**
- Create: `src/rooms.js`
- Create: `scripts/verify-free-worlds.mjs`

- [ ] **Step 1: Write the failing test** — create `scripts/verify-free-worlds.mjs`:

```js
// Free Worlds backbone check — run wi': node scripts/verify-free-worlds.mjs
import { baseRoom, isFreeRoom, isBairnsRoom, FREE_STARTER } from '../src/rooms.js';
import { B, I, TOOLS } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// --- room classification (shard-aware) ---
{
  (baseRoom('bairns-free-2') === 'bairns-free' ? ok : bad)('baseRoom strips the shard suffix');
  (baseRoom('bairns') === 'bairns' ? ok : bad)('baseRoom leaves an unsharded room be');
  (isFreeRoom('bairns-free') && isFreeRoom('bairns-free-3') ? ok : bad)('a free room and its shards read as free');
  (!isFreeRoom('bairns') && !isFreeRoom('bairns-2') && !isFreeRoom('moor') ? ok : bad)('survival rooms are not free');
  (isBairnsRoom('bairns') && isBairnsRoom('bairns-2') ? ok : bad)('bairns classification is shard-aware (fixes the bairns-2 latent bug)');
  (!isBairnsRoom('bairns-free') ? ok : bad)('the free world is NOT a bairns room (free rules supersede)');
}

// --- starter pack manifest is sane ---
{
  const ids = new Set([...Object.values(B), ...Object.values(I)]);
  (Array.isArray(FREE_STARTER) && FREE_STARTER.length > 0 ? ok : bad)('starter pack is a non-empty manifest');
  (FREE_STARTER.every(it => ids.has(it.id) && it.n > 0) ? ok : bad)('every starter item is a real id with a positive count');
  (FREE_STARTER.some(it => TOOLS[it.id]) ? ok : bad)('starter pack includes at least one tool');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-free-worlds.mjs`
Expected: FAIL — `Cannot find module '../src/rooms.js'`.

- [ ] **Step 3: Write minimal implementation** — create `src/rooms.js`:

```js
// rooms.js — pure room classification (no THREE/DOM). A "free world" is a relaxed-survival
// shared room: builds never crumble, no deeds/licences, deep digging gated only by pick tier,
// and a starter pack in place of the bare-hands wipe. The survival rooms are untouched.
import { B, I } from './defs.js';

// The free-world BASE room names. Shards like 'bairns-free-2' map back to these. Extend later
// with 'moor-free', etc. as more free worlds are added.
export const FREE_ROOMS = new Set(['bairns-free']);

// Strip the relay's shard suffix: 'bairns-free-2' -> 'bairns-free', 'bairns' -> 'bairns'.
export function baseRoom(room) {
  return String(room || '').toLowerCase().replace(/-\d+$/, '');
}

// Is this room (or any shard of it) a relaxed-survival free world?
export function isFreeRoom(room) {
  return FREE_ROOMS.has(baseRoom(room));
}

// Is this room (or any shard of it) the bairns' (children's) survival world?
export function isBairnsRoom(room) {
  return baseRoom(room) === 'bairns';
}

// One-time free-world starter pack: enough to dig, chop, build and light up straight away, not
// so much that gathering is pointless. player.addItem sets tool durability automatically.
export const FREE_STARTER = [
  { id: I.W_PICK, n: 1 },
  { id: I.W_AXE, n: 1 },
  { id: I.W_SHOVEL, n: 1 },
  { id: B.PLANKS, n: 32 },
  { id: B.LOG, n: 16 },
  { id: B.TORCH, n: 8 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-free-worlds.mjs`
Expected: PASS — all room + starter-pack lines `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/rooms.js scripts/verify-free-worlds.mjs
git commit -m "feat(free-worlds): pure room classification + starter-pack manifest"
```

---

### Task 2: `free` flag through `editledger.js` `isExpired` (decay off in free worlds)

**Files:**
- Modify: `src/editledger.js:42-79`
- Modify: `scripts/verify-free-worlds.mjs` (append a block)

- [ ] **Step 1: Write the failing test** — append to `scripts/verify-free-worlds.mjs`, BEFORE the final `console.log('RESULT...')` line. Also add `isExpired` to the editledger import at the top:

At the top of the file, add this import line under the existing imports:

```js
import { isExpired } from '../src/editledger.js';
```

Then insert this block before the `console.log('RESULT...')`:

```js
// --- build/dig decay OFF in a free world; harvest still regrows (gather loop stays) ---
{
  const oldBuild = { cat: 'build', day: 0, was: B.AIR };
  const oldDig = { cat: 'dig', day: 0, was: B.STONE };
  const oldHarvest = { cat: 'harvest', day: 0, was: B.LOG };
  // signature: isExpired(edit, nowDay, deeds, decayScale, x, y, z, heightFunc, free)
  (isExpired(oldBuild, 999, [], 1, 0, 0, 0, null, true) === false ? ok : bad)('free world: a build never crumbles');
  (isExpired(oldDig, 999, [], 1, 0, 0, 0, null, true) === false ? ok : bad)('free world: a dig never backfills');
  (isExpired(oldHarvest, 999, [], 1, 0, 0, 0, null, true) === true ? ok : bad)('free world: harvested resources still regrow');
  (isExpired(oldBuild, 999, [], 1, 0, 0, 0, null, false) === true ? ok : bad)('survival world: an unclaimed build still crumbles');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-free-worlds.mjs`
Expected: FAIL — the free-world build/dig lines FAIL (current `isExpired` ignores the extra
arg, so a 999-day-old build expires). The survival regression line passes.

- [ ] **Step 3: Write minimal implementation** — in `src/editledger.js`, change the `isExpired`
signature and the `build`/`dig` branches. Replace lines 42-79:

```js
export function isExpired(edit, nowDay, deeds = [], decayScale = 1, x = 0, y = 0, z = 0, heightFunc = null, free = false) {
  const life = lifespanOf(edit.cat, edit.was);

  if (edit.cat === 'harvest') {
    // Resources regrow in every world — the gather loop is the fun even in a free world.
    return (nowDay - edit.day) >= life;
  }

  if (edit.cat === 'build') {
    // Free world: builds never crumble — no claim needed to keep what you make.
    if (free) return false;

    // Protected if inside any active land claim
    if (findActiveDeed(deeds, x, z, 'claim')) return false;

    // Lapsed claim: gradual coordinator-hash-based crumbling
    const lapsed = findLapsedDeed(deeds, x, z, 'claim');
    if (lapsed) {
      const grace = 7 * decayScale;          // e.g. 7 days for adults, 14 for bairns
      const decayDuration = 14 * decayScale; // e.g. 14 days for adults, 28 for bairns
      const h = coordHash(x, y, z);
      return (nowDay - lapsed.lapsedDay) > (grace + h * decayDuration);
    }

    // Outside any claim: decays after 30 days
    return (nowDay - edit.day) >= 30;
  }

  if (edit.cat === 'dig') {
    // Free world: digs never backfill — deep workings stay open.
    if (free) return false;

    // Protected if inside an active mine and within its depth envelope
    const mine = findActiveDeed(deeds, x, z, 'mine');
    if (mine && heightFunc) {
      const grade = heightFunc(x, z);
      if (y <= grade && y >= grade - mine.depth) return false;
    }

    // Outside mines/in public quarries/lapsed mines: backfills after 24 days
    return (nowDay - edit.day) >= 24;
  }

  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-free-worlds.mjs`
Expected: PASS — `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/editledger.js scripts/verify-free-worlds.mjs
git commit -m "feat(free-worlds): build/dig decay off when free; harvest still regrows"
```

---

### Task 3: `free` flag through `editledger.js` `mayDigDeep` (no mine/fixtures, keep pick tier)

**Files:**
- Modify: `src/editledger.js:96-119`
- Modify: `scripts/verify-free-worlds.mjs` (append a block + import)

- [ ] **Step 1: Write the failing test** — add `mayDigDeep` to the editledger import line so it
reads:

```js
import { isExpired, mayDigDeep } from '../src/editledger.js';
```

Then insert this block before the final `console.log('RESULT...')`:

```js
// --- deep digging in a free world: no mine/fixtures needed, but pick tier still gates depth ---
{
  const grade = 50;
  // signature: mayDigDeep(y, grade, mineDeed, heldPickType, allowedFixtures, free)
  (mayDigDeep(grade - 5, grade, null, 'wood', [], true).allowed === true ? ok : bad)('free world: shallow deep-dig allowed with a wood pick, no mine');
  (mayDigDeep(grade - 15, grade, null, 'wood', [], true).allowed === false ? ok : bad)('free world: too weak a pick for the depth is still refused (pick tier kept)');
  (mayDigDeep(grade - 15, grade, null, 'stone', [], true).allowed === true ? ok : bad)('free world: right pick + no fixture needed = allowed');
  (mayDigDeep(grade - 5, grade, null, 'wood', [], false).reason === 'nomine' ? ok : bad)('survival world: deep-dig with no mine is still refused');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-free-worlds.mjs`
Expected: FAIL — current `mayDigDeep` ignores the extra arg and returns `nomine` for the free
cases (so the first/third free lines FAIL).

- [ ] **Step 3: Write minimal implementation** — in `src/editledger.js`, replace `mayDigDeep`
(lines 96-119):

```js
export function mayDigDeep(y, grade, mineDeed, heldPickType, allowedFixtures = [], free = false) {
  if (y >= grade - 1) return { allowed: true }; // within 1-block surface skim

  const depth = grade - y;

  if (!free) {
    if (!mineDeed) return { allowed: false, reason: 'nomine' };
    if (depth > mineDeed.depth) return { allowed: false, reason: 'depthlimit', limit: mineDeed.depth };
  }

  const band = depthBandFor(depth);

  // Verify pick requirements — kept in the free world too, as gentle progression.
  const pickOrder = { none: 0, wood: 1, stone: 2, iron: 3 };
  const playerPickPower = pickOrder[heldPickType || 'none'] || 0;
  const reqPickPower = pickOrder[band.pick];
  if (playerPickPower < reqPickPower) {
    return { allowed: false, reason: 'pick', pickNeeded: band.pick, fixtureNeeded: band.fixture };
  }

  // Verify fixture requirements — dropped in the free world (no props/lamp/winch faff).
  if (!free && band.fixture && !allowedFixtures.includes(band.fixture)) {
    return { allowed: false, reason: 'fixture', pickNeeded: band.pick, fixtureNeeded: band.fixture };
  }

  return { allowed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-free-worlds.mjs`
Expected: PASS — `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/editledger.js scripts/verify-free-worlds.mjs
git commit -m "feat(free-worlds): deep digging needs no mine/fixtures when free, pick tier kept"
```

---

### Task 4: `player.js` — persist the `freeStarter` flag

**Files:**
- Modify: `src/player.js:46` (field), `:363` (serialize), `:387` (deserialize)

- [ ] **Step 1: Add the field** — in `src/player.js`, after line 46
(`this.bairnFresh = false; ...`), add:

```js
    this.freeStarter = false; // free-world one-time starter pack already granted
```

- [ ] **Step 2: Persist in serialize** — in `serialize()`, change line 363 from:

```js
      bairnFresh: this.bairnFresh,
```

to:

```js
      bairnFresh: this.bairnFresh, freeStarter: this.freeStarter,
```

- [ ] **Step 3: Restore in deserialize** — in `deserialize(d)`, after line 387
(`this.bairnFresh = !!d.bairnFresh;`), add:

```js
    this.freeStarter = !!d.freeStarter;
```

- [ ] **Step 4: Verify it parses** — the build is the headless check here (player.js pulls in
THREE-bound modules, so it isn't unit-imported):

Run: `npm run build`
Expected: build succeeds, no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add src/player.js
git commit -m "feat(free-worlds): persist the freeStarter flag on the player"
```

---

### Task 5: `main.js` — `freeWorld()` predicate, shard-aware `bairnLocked()`, seed mapping

**Files:**
- Modify: `src/main.js` — import (top), `bairnLocked()`/new `freeWorld()` (~811), seed mapping (~1760)

- [ ] **Step 1: Add the import** — near the other `./` imports at the top of `src/main.js` (e.g.
just after the `./deeds.js` import on line 16), add:

```js
import { isFreeRoom, isBairnsRoom, baseRoom, FREE_STARTER } from './rooms.js';
```

- [ ] **Step 2: Make `bairnLocked()` shard-aware and add `freeWorld()`** — replace the
`bairnLocked()` method (lines 811-813):

```js
  bairnLocked() {
    return this.netActive && isBairnsRoom(this.netRoom) && !this.isAdmin();
  }

  // A relaxed-survival free world (e.g. the bairns-free kids' world): builds never crumble,
  // no deeds/licences, deep digging gated only by pick tier, a starter pack on entry.
  freeWorld() {
    return this.netActive && isFreeRoom(this.netRoom);
  }
```

- [ ] **Step 3: Route the seed mapping through `baseRoom`** — replace lines 1760-1761:

```js
    // the shared moor, the bairns' world AND the free kids' world all play the real c.1900 NYM
    // world. baseRoom() means shards (bairns-2, bairns-free-2) share their world's terrain too.
    const rb = baseRoom(room);
    const seedStr = (rb === 'moor' || rb === 'bairns' || rb === 'bairns-free' || rb === 'moors1900') ? 't-moors-1900'
      : 't-shared-moor:' + rb;
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(free-worlds): freeWorld() predicate, shard-aware bairnLocked, free-world seed"
```

---

### Task 6: `main.js` — thread `free` into the decay pass and deep-dig gate

**Files:**
- Modify: `src/main.js:3103` (mayDigDeep call), `:3974` (expireEdits call)
- Modify: `src/world.js:138,143` (expireEdits passes `free` to `isExpired`)

- [ ] **Step 1: Thread `free` through `world.expireEdits`** — in `src/world.js`, change line 138:

```js
  expireEdits(nowDay, decayScale = 1, free = false) {
```

and change line 143 (add the trailing `free` arg):

```js
      if (!isExpired(e, nowDay, this.deeds, decayScale, x, y, z, heightFunc, free)) continue;
```

- [ ] **Step 2: Pass `freeWorld()` at the decay call site** — in `src/main.js`, change line 3974:

```js
        this.world.expireEdits(this.sky.day, decayScale, this.freeWorld());
```

- [ ] **Step 3: Pass `freeWorld()` to the deep-dig gate** — in `src/main.js`, change line 3103:

```js
          const check = mayDigDeep(hit.y, grade, mine, pickType, allowedFixtures, this.freeWorld());
```

- [ ] **Step 4: Verify build + full suite**

Run: `npm run build && node scripts/verify-free-worlds.mjs`
Expected: build succeeds; `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/world.js
git commit -m "feat(free-worlds): decay pass and deep-dig gate honour freeWorld()"
```

---

### Task 7: `main.js` — starter pack on free-world entry (no bare-hands wipe)

**Files:**
- Modify: `src/main.js` — `enforceBairnRules()` (~825-845)

**Context:** On a free world, `creativeLocked()` is still true (no creative cupboard for
non-wardens — relaxed, not creative), and `bairnLocked()` is false (so the existing pocket wipe
at line 836 does NOT run). We only need to ADD a one-time starter-pack grant.

- [ ] **Step 1: Add the starter-pack grant** — in `enforceBairnRules()`, immediately AFTER the
existing `bairnLocked()` wipe block (after its closing `}` on line 843) and BEFORE
`this.ui.setCreativeButtonVisible(!survival);` (line 844), insert:

```js
    // Free world: relaxed survival. No bare-hands wipe (that's bairns-only above); instead a
    // one-time starter pack so a young player isn't stuck. Fills empty slots only (addItem),
    // so anything earned is kept. Persisted via player.freeStarter, like bairnFresh.
    if (this.freeWorld() && this.player && !this.player.freeStarter) {
      this.player.freeStarter = true;
      for (const it of FREE_STARTER) this.player.addItem(it.id, it.n);
      this.ui.invDirty = true;
      if (this.saveNow) this.saveNow(false);
      this.ui.toast('Welcome to t’ <b>Free Moor</b> — build what tha likes, nowt crumbles, no licences needed. Here’s a kit to start thee off!', 8000);
    }
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat(free-worlds): grant a one-time starter pack on free-world entry"
```

---

### Task 8: Help / copy reflects the free-world rules

**Files:**
- Modify: `src/game-facts.js:60-61`
- Modify: `src/ui.js:388`

- [ ] **Step 1: Update the deeds game-fact** — in `src/game-facts.js`, replace the deeds entry
(lines 60-61). Add the free-world note and the `free` keyword:

```js
  { topic: 'deeds', keywords: ['decay', 'lapse', 'lapsed', 'crumble', 'reclaim', 'bairn', 'bairns', 'free'],
    text: 'If a claim lapses, its builds crumble gradually over time. In the bairns world, claims and builds decay twice as slow. On the Free Moor, builds never crumble at all and you need no claim or licence.' },
```

- [ ] **Step 2: Update the mode-scaling help line** — in `src/ui.js`, replace line 388:

```js
<li><b>Mode Scaling:</b> In the children's world, claims and builds decay twice as slow. On the <b>Free Moor</b>, builds never crumble, no claim or licence is needed, and deep digging needs only the right pick.</li>
```

- [ ] **Step 3: Verify build + facts suite**

Run: `npm run build && node scripts/verify-facts.mjs`
Expected: build succeeds; facts verify passes.

- [ ] **Step 4: Commit**

```bash
git add src/game-facts.js src/ui.js
git commit -m "docs(free-worlds): in-game help + facts describe the Free Moor rules"
```

---

### Task 9: Register the verify script and run the full gate + build

**Files:**
- Modify: `package.json` (the `verify` script chain + a `verify:freeworlds` alias)

- [ ] **Step 1: Add to the verify chain** — in `package.json`, in the `"verify"` script, append
to the end of the `&&` chain (before the closing quote), after
`node scripts/verify-invariants.mjs`:

```
 && node scripts/verify-free-worlds.mjs
```

- [ ] **Step 2: Add the individual alias** — in `package.json`, insert this line immediately
BEFORE the existing last alias `"verify:invariants": "node scripts/verify-invariants.mjs"` (so
`verify:invariants` stays the comma-less last entry and JSON stays valid):

```json
    "verify:freeworlds": "node scripts/verify-free-worlds.mjs",
```

- [ ] **Step 3: Run the full verify gate**

Run: `npm run verify`
Expected: every check green, including `verify-free-worlds`. Must be PASS end-to-end.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(free-worlds): wire verify-free-worlds into the verify gate"
```

---

### Task 10: Server data — repoint Henry's code to `bairns-free` (EVO, manual)

**No client code.** The relay creates the room lazily; only Henry's login code needs repointing.
Do this read-only-first, back up before editing, per project rules.

- [ ] **Step 1: Read the setroom endpoint contract**

Run:
```bash
ssh evo-tailscale 'sed -n "255,300p" ~/moorstead/dash/app.py'
```
Expected: shows `POST /api/setroom` body shape (code/account → room) and any LAN-only guard.

- [ ] **Step 2: Identify Henry's code** — find which `bai***` code is Henry's (cross-check with
the handout / players file):

Run:
```bash
ssh evo-tailscale 'cat ~/moorstead/dash/handout.txt 2>/dev/null; echo ---; python3 -c "import json;d=json.load(open(\"/home/james/moorstead/dash/players.json\"));print(json.dumps(d,indent=0)[:1500])"'
```
Expected: enough to map Henry → his access code. (If ambiguous, ask James which code is Henry's.)

- [ ] **Step 3: Back up codes.json**

Run:
```bash
ssh evo-tailscale 'cp ~/moorstead/dash/codes.json ~/moorstead/dash/codes.json.bak-20260627-freeworld && ls -la ~/moorstead/dash/codes.json.bak-20260627-freeworld'
```
Expected: backup file listed.

- [ ] **Step 4: Repoint the code** — prefer the LAN-only endpoint (per its contract from Step 1),
falling back to a guarded in-place JSON edit. Example via endpoint (adjust to the real body):

```bash
ssh evo-tailscale 'curl -s -X POST http://127.0.0.1:PORT/api/setroom -H "Content-Type: application/json" -d "{\"code\":\"HENRYS_CODE\",\"room\":\"bairns-free\"}"'
```
Expected: success response; re-reading the code shows `{"room":"bairns-free"}`.

- [ ] **Step 5: Confirm**

Run:
```bash
ssh evo-tailscale 'python3 -c "import json;d=json.load(open(\"/home/james/moorstead/dash/codes.json\"));print(d.get(\"HENRYS_CODE\"))"'
```
Expected: `{'room': 'bairns-free'}`. No relay restart needed — auth reads codes.json live; the
room is created when Henry first joins.

---

### Task 11: Deploy (James's call)

- [ ] **Step 1: Confirm clean + on-branch**, then merge `feat/free-worlds` to `main` per the
project's normal flow (PR or fast-forward — James decides).

- [ ] **Step 2: Ship the client** — `npm run deploy` (gates on clean/on-main/pushed, runs
verify + build, patch-bumps version, commits, pushes, ships to Vercel). Do NOT bump
`minClientVersion` — this slice changes no multiplayer protocol or save format (the new
`freeStarter` field is additive and back-compatible).

- [ ] **Step 3: Smoke test** — log in on Henry's code, confirm: lands on the moors-1900 map,
gets the starter pack once, can build freely with no decay warnings, can dig deep with the
right pick and no mine licence. Confirm an existing `bairns` code is unaffected.

---

## Notes / scope boundary (NOT this slice)

- Kid-facing free/hard **world picker** for non-wardens.
- Free variants of the **adult** worlds (`moor-free`, …).
- Free **individual** (single-player) world.
- Resource-regrowth tuning for free worlds.

Each is a separate spec → plan → implementation cycle.
