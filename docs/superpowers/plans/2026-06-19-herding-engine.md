# Herding Engine Implementation Plan (Slice 1, plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure, headless-testable herding model to a new `src/herding.js`: the scripted flock-and-dog maths (where a pressured flock heads, where a commanded dog goes, whether a flock is penned, and how arrow keys map to whistle commands).

**Architecture:** Pure module-level functions, no THREE/DOM, mirroring `economy.js`/`pets.js`/`villagerlife.js`. The flock model is **scripted** (centroid + a single drive-target nudged away from pressure) and sits behind a fixed `pressure → target` contract, so it can later be swapped for an emergent per-sheep model without touching callers. **This plan changes no live gameplay** — it only adds tested functions. Plan 2 wires them into `entities.js`/`main.js`/`ui.js`.

**Tech Stack:** Vanilla ES modules. Tests are plain Node scripts run with `node scripts/verify-herding.mjs`, mirroring `scripts/verify-economy.mjs` (no framework, no THREE/DOM).

---

## File structure

- **Create `src/herding.js`** — tuning constants + five pure functions: `flockCentroid`, `driveTarget`, `dogGoal`, `allPenned`, `commandFromKey`. One responsibility: the herding maths.
- **Create `scripts/verify-herding.mjs`** — the headless suite, same `ok`/`bad`/`near` harness as the other verify scripts.

---

## Task 1: Test harness + `flockCentroid`

**Files:**
- Create: `src/herding.js`
- Create: `scripts/verify-herding.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-herding.mjs`:

```js
// Herding model check — run wi': node scripts/verify-herding.mjs
import { flockCentroid } from '../src/herding.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const near = (got, want, m, eps = 1e-6) => (Math.abs(got - want) < eps ? ok : bad)(`${m} (got ${got})`);

// --- Task 1: flock centroid ---
{
  const c = flockCentroid([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 3 }]);
  near(c.x, 1, 'centroid x is the mean');
  near(c.z, 1, 'centroid z is the mean');
  (flockCentroid([]) === null ? ok : bad)('centroid of an empty flock is null');
}

console.log('RESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-herding.mjs`
Expected: FAIL — `Cannot find module '../src/herding.js'` (or `flockCentroid is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `src/herding.js`:

```js
// herding.js — the pure herding maths (no THREE, no DOM), unit-tested headless via
// scripts/verify-herding.mjs. The flock model is SCRIPTED for v1 (a centroid + a single
// drive-target nudged away from pressure) and lives behind the pressure -> target contract
// (driveTarget), so it can be swapped for an emergent per-sheep model later without
// touching the dog commands, the pen check, or any caller.

export const DRIVE_DISTANCE = 4; // blocks the flock heads, away from the net pressure
export const FLANK_RADIUS = 6;   // radius the dog works at, circling the flock
export const FLANK_STEP = 0.9;   // radians the dog advances around the flock per flank command

// The mean position of the flock. positions: [{x,z}, ...]. null for an empty flock.
export function flockCentroid(positions) {
  if (!positions.length) return null;
  let x = 0, z = 0;
  for (const p of positions) { x += p.x; z += p.z; }
  return { x: x / positions.length, z: z / positions.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-herding.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/herding.js scripts/verify-herding.mjs
git commit -m "feat(herding): flock centroid + test harness (Slice 1 engine)"
```

---

## Task 2: `driveTarget` — where a pressured flock heads

**Files:**
- Modify: `src/herding.js`
- Test: `scripts/verify-herding.mjs`

- [ ] **Step 1: Write the failing test**

Add `driveTarget` to the import, and add before the `console.log('RESULT...` line:

```js
// --- Task 2: drive target (flock flees the net pressure) ---
{
  // one pressure to the -x side: the flock heads +x, DRIVE_DISTANCE away
  const t = driveTarget({ x: 0, z: 0 }, [{ x: -5, z: 0, strength: 1 }]);
  near(t.x, 4, 'flock heads away from a single pressure (+x)');
  near(t.z, 0, 'no sideways drift for an on-axis pressure');
  // symmetric pressures cancel: the flock grazes in place
  const s = driveTarget({ x: 0, z: 0 }, [{ x: -5, z: 0, strength: 1 }, { x: 5, z: 0, strength: 1 }]);
  near(s.x, 0, 'balanced pressure leaves the flock put (x)');
  near(s.z, 0, 'balanced pressure leaves the flock put (z)');
  // no pressure: graze in place
  const n = driveTarget({ x: 3, z: 7 }, []);
  (n.x === 3 && n.z === 7 ? ok : bad)('no pressure: target is the centroid');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-herding.mjs`
Expected: FAIL — `driveTarget is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/herding.js`, after `flockCentroid`, add:

```js
// Where a flock heads under pressure: directly away from the net of all pressure sources,
// DRIVE_DISTANCE blocks from the centroid. pressures: [{x,z,strength}]. Closer pressures
// push harder (weight = strength / distance). No pressure -> the centroid (graze in place).
// This IS the scripted pressure -> target contract; an emergent model would replace only this.
export function driveTarget(centroid, pressures, drive = DRIVE_DISTANCE) {
  let dx = 0, dz = 0;
  for (const p of pressures) {
    const ax = centroid.x - p.x, az = centroid.z - p.z;
    const d = Math.hypot(ax, az) || 1;
    const w = (p.strength || 1) / d;
    dx += (ax / d) * w; dz += (az / d) * w;
  }
  const m = Math.hypot(dx, dz);
  if (m < 1e-6) return { x: centroid.x, z: centroid.z };
  return { x: centroid.x + (dx / m) * drive, z: centroid.z + (dz / m) * drive };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-herding.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/herding.js scripts/verify-herding.mjs
git commit -m "feat(herding): driveTarget — a flock flees the net pressure (Slice 1 engine)"
```

---

## Task 3: `dogGoal` — where a commanded dog goes

**Files:**
- Modify: `src/herding.js`
- Test: `scripts/verify-herding.mjs`

- [ ] **Step 1: Write the failing test**

Add `dogGoal, FLANK_RADIUS` to the import, and add before the `console.log('RESULT...` line:

```js
// --- Task 3: dog goal from a whistle command ---
{
  const centroid = { x: 0, z: 0 };
  const dog = { x: 0, z: -FLANK_RADIUS }; // dog due south of the flock
  // lie-down: stay put
  const lie = dogGoal('lie-down', centroid, dog);
  (lie.x === dog.x && lie.z === dog.z ? ok : bad)('lie-down holds the dog where she is');
  // walk-on: head straight to the flock centre
  const walk = dogGoal('walk-on', centroid, dog);
  (walk.x === centroid.x && walk.z === centroid.z ? ok : bad)('walk-on sends her in to the flock');
  // come-bye and away flank in OPPOSITE directions, both staying on the flank circle
  const cb = dogGoal('come-bye', centroid, dog);
  const aw = dogGoal('away', centroid, dog);
  near(Math.hypot(cb.x - centroid.x, cb.z - centroid.z), FLANK_RADIUS, 'come-bye stays on the flank circle');
  near(Math.hypot(aw.x - centroid.x, aw.z - centroid.z), FLANK_RADIUS, 'away stays on the flank circle');
  (Math.sign(cb.x) !== Math.sign(aw.x) || (cb.x !== aw.x) ? ok : bad)('come-bye and away flank opposite ways');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-herding.mjs`
Expected: FAIL — `dogGoal is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/herding.js`, after `driveTarget`, add:

```js
// Where the dog should move for a whistle command, given the flock centroid and her own
// position. walk-on presses straight in; lie-down holds; come-bye / away flank the flock
// in opposite directions around a circle of FLANK_RADIUS (come-bye anticlockwise, away
// clockwise — the sign is a tuning choice, the point is they're opposite).
export function dogGoal(command, centroid, dogPos, flankRadius = FLANK_RADIUS) {
  if (command === 'lie-down') return { x: dogPos.x, z: dogPos.z };
  if (command === 'walk-on') return { x: centroid.x, z: centroid.z };
  const ang = Math.atan2(dogPos.z - centroid.z, dogPos.x - centroid.x);
  const step = command === 'come-bye' ? FLANK_STEP : -FLANK_STEP;
  const a = ang + step;
  return { x: centroid.x + Math.cos(a) * flankRadius, z: centroid.z + Math.sin(a) * flankRadius };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-herding.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/herding.js scripts/verify-herding.mjs
git commit -m "feat(herding): dogGoal — flank/walk-on/lie-down from a whistle (Slice 1 engine)"
```

---

## Task 4: `allPenned` — is the whole flock inside the fold?

**Files:**
- Modify: `src/herding.js`
- Test: `scripts/verify-herding.mjs`

- [ ] **Step 1: Write the failing test**

Add `allPenned` to the import, and add before the `console.log('RESULT...` line:

```js
// --- Task 4: pen check (every head inside the fold footprint) ---
{
  const fold = { x0: 0, z0: 0, x1: 10, z1: 10 };
  (allPenned([{ x: 2, z: 2 }, { x: 8, z: 9 }], fold) === true ? ok : bad)('all inside the fold = penned');
  (allPenned([{ x: 2, z: 2 }, { x: 11, z: 9 }], fold) === false ? ok : bad)('one head outside = not penned');
  (allPenned([], fold) === false ? ok : bad)('an empty flock is not "penned"');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-herding.mjs`
Expected: FAIL — `allPenned is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/herding.js`, after `dogGoal`, add:

```js
// True when every head is inside the fold footprint. fold: {x0,z0,x1,z1} (a rectangle in
// world coords). Zone-based on purpose — simpler and more robust than true geometric
// containment, while the fence blocks still physically hold the flock. Empty flock = false.
export function allPenned(positions, fold) {
  if (!positions.length) return false;
  return positions.every(p => p.x >= fold.x0 && p.x <= fold.x1 && p.z >= fold.z0 && p.z <= fold.z1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-herding.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/herding.js scripts/verify-herding.mjs
git commit -m "feat(herding): allPenned — zone-based fold check (Slice 1 engine)"
```

---

## Task 5: `commandFromKey` — arrow keys to whistle commands

**Files:**
- Modify: `src/herding.js`
- Test: `scripts/verify-herding.mjs`

- [ ] **Step 1: Write the failing test**

Add `commandFromKey` to the import, and add before the `console.log('RESULT...` line:

```js
// --- Task 5: arrow-key -> whistle command mapping ---
{
  (commandFromKey('ArrowLeft') === 'come-bye' ? ok : bad)('left = come-bye');
  (commandFromKey('ArrowRight') === 'away' ? ok : bad)('right = away');
  (commandFromKey('ArrowUp') === 'walk-on' ? ok : bad)('up = walk-on');
  (commandFromKey('ArrowDown') === 'lie-down' ? ok : bad)('down = lie-down');
  (commandFromKey('KeyW') === null ? ok : bad)('a non-arrow key is no command');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-herding.mjs`
Expected: FAIL — `commandFromKey is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/herding.js`, after `allPenned`, add:

```js
// Map an arrow-key code to a whistle command (the player's own WASD movement is untouched).
export function commandFromKey(code) {
  switch (code) {
    case 'ArrowLeft': return 'come-bye';
    case 'ArrowRight': return 'away';
    case 'ArrowUp': return 'walk-on';
    case 'ArrowDown': return 'lie-down';
    default: return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-herding.mjs`
Expected: all `ok`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/herding.js scripts/verify-herding.mjs
git commit -m "feat(herding): commandFromKey — arrow keys to whistles (Slice 1 engine)"
```

---

## Done when

- `node scripts/verify-herding.mjs` passes with all assertions (`RESULT: PASS`).
- `src/herding.js` exports `flockCentroid`, `driveTarget`, `dogGoal`, `allPenned`, `commandFromKey` plus the tuning constants, all pure and headless.
- No live gameplay has changed (nothing imports `herding.js` yet).

## Plan 2 (the wiring, a separate plan)

- `entities.js`: each frame, gather the player's loose flock (sheep within range of a working dog), move the dog toward `dogGoal(command, …)`, treat the dog + the mounted/​on-foot player as pressures, and steer each flock sheep toward `driveTarget(centroid, pressures)` with separation.
- **New blocks** (`defs.js`/`textures.js`/`physics.js`): `B.FENCE` (a `barrier`-flag block — collides like a solid, draws thin) and `B.GATE` (one-way auto-gate — opens for an animal from outside, shut from inside, always open to the player, counts as a fold boundary), with bench recipes. The gate's conditional collision is a physics special case. (Design: spec §3.6.)
- Fold detection (resolved — was the open call): `foldAt(seedFromFlock, isFence, …)` with `isFence` true for `B.FENCE` + `B.GATE`; penned = `allPennedCells(flock, fold.cells)`.
- On penned: settle the flock as stay-at-home stock (`owner`+`stay`+`home`) anchored to the fold; toast; milestone.
- `main.js`: arrow keys → `commandFromKey` → set the working dog's current command; heel key (H); the gather→pen completion hook.
- `ui.js`: crosshair command hints ("← come-bye / → away, ↑ walk on, ↓ lie down"), a command reference when a working dog is at heel.
- Verified in the browser preview (drive a scattered flock through a gate into a fold).
