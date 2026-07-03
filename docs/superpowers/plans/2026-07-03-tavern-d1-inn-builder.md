# Workstream D1 — Inn Builder, Pocket Interior, Threshold, Protection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the flagship Station Tavern at Grosmont: a deterministic `innPlan()`
builder, a real-voxel exterior shell + underground parlour carved by worldgen, a
working threshold (door interact → fade → teleport → fade in, both directions),
and edit protection so neither shell can be broken or built into.

**Architecture:** `innPlan(geo, villageName, seed)` in a new `src/innplan.js` is a
pure function — no THREE, no World, no chunk access — that picks a clear site near
the village (site-scan modelled on `festivalKit.greenPlacement`) and returns a
deterministic plan object (exterior footprint, protected box, parlour interior
layout, door positions, hearth/table spots, name). `worldgen.js`'s `Gen` class
builds one inn per configured village at construction time (`this.inns`, keyed by
name) and a new `stampInns(data, cx, cz)` — same `put`/`at`-closure pattern as
`stampStations` — carves both shells into chunk data whenever a chunk overlaps an
inn's protected box, for any chunk, any time it's (re)generated. `world.js` and
`multiplayer.js` gain one shared `isProtected(x, z)` gate. `main.js` gains a
threshold interact branch reusing the existing raycast-hit dispatch, the existing
fade-opacity mechanism from the title-reveal system, and the existing
`warnKnock`/`hearthCrackle` SFX. The painted name sign belongs to D2 (handoff
§5.3 slices "name signs" there, not D1) — deliberately out of scope here.

**Tech Stack:** Vanilla JS (ES modules), Three.js (r-whatever this repo pins),
Node for verify scripts (no test framework — the house `ok`/`bad`/`RESULT:
PASS|FAIL` verify-script pattern is the test layer).

---

## Ground truth this plan depends on (do not re-derive — verified 2026-07-03)

- `HEIGHT = 64`, `WATER_LEVEL = 26`, `CHUNK = 16` — `src/defs.js:3-5`. There is
  **no room for a literal "40 blocks under the village" interior** stacked below a
  village's own map column (ground sits ~26-45, bedrock is y=0) — that framing in
  the handoff brief is corrected by this plan: the parlour is carved in-place,
  directly beneath the tavern's own footprint, at shallow y (y=2..9), with normal
  terrain/cave/ore generation suppressed for that column range only. This is
  "under the pub" in the real sense the site scan already gives it its own patch
  of ground — not a remote pocket dimension.
- `World.setBlock(x, y, z, id)` — `src/world.js:100-132`. Early-returns at
  `y<0||y>=HEIGHT` (101) and missing chunk (104). World coords, not chunk-local.
- `World.editLedger` — `src/world.js:20` — unrelated to this plan (harvest/dig
  decay), do not touch.
- `net.handle()` edit branch — `src/multiplayer.js:237-243`. `saneCoord` guards
  NaN/absurd coords (232-235) before `g.world.setBlock(m.x, m.y, m.z, m.id)` (243).
- `MoorsGeography` — `src/moorsgeo.js`. `this.villages` (45-49): `{x, z, name,
  tier, radius, style, buildings: [], ground}`. `buildings` starts empty and is
  populated by `HearthLayer` (client decoration, not world voxels) — **normal
  village houses in this game are NOT world blocks**, they are `HearthLayer`
  meshes keyed off `villageColumn` classification. The tavern is a deliberate
  exception: real voxels specifically because it needs a walkable, protected,
  physically enterable interior. Do not confuse the two systems.
- Seeded RNG: `mulberry32(seed)` and `strSeed(str)` — `src/noise.js:3-19`.
  Established per-village seeding idiom (`worldgen.js:47`, paraphrased):
  `mulberry32((worldSeed ^ Math.imul(v.x|0, 73856093) ^ Math.imul(v.z|0,
  19349663)) | 0)`.
- Site-scan exemplar: `greenPlacement(world, v, salt, opts)` —
  `src/festivalKit.js:38-68`. Radial scan (`r` from 2..maxR, 16 angles per ring),
  rejects cells inside `v.buildings` + margin and too close to rail. **This plan's
  site-scan is a from-scratch adaptation, not a call to `greenPlacement`**,
  because `greenPlacement` needs a live `World` (`world.getBlock`) for its
  "clear sky above surface" check, and `innPlan()` must be pure (callable from a
  Node verify script with only a `MoorsGeography` instance, no chunks). The
  adaptation substitutes "clear sky" with "flat enough + not on road/river" using
  only `geo.height`, `geo.onRoad`, `geo.riverColumn` — all pure `(x,z)` queries.
- Procedural chunk-local stamping idiom (the one to copy): `stampStations(data,
  cx, cz)` — `src/worldgen.js:610-718`. `put(wx,wy,wz,id)`/`at(wx,wy,wz)` closures
  bound to `(data, cx, cz)`, bounds-checked against the current chunk only; called
  once per chunk from `generateChunk` (`worldgen.js:519`, `this.stampStations(data,
  cx, cz);`). `stampInns` in this plan follows the identical shape.
- `generateChunk(cx, cz)` — `src/worldgen.js:282-`. Per-column terrain loop runs
  first (288-341ish, computes `data[IDX(lx,y,lz)]` for `y=0..h` then water above);
  `stampStations` and friends run afterward on the finished `data` buffer. `stampInns`
  must ALSO run after the terrain loop (so it can overwrite terrain-filled cells)
  but the terrain loop itself must skip normal cave/ore carving for reserved inn
  columns — see Task 3.
- Block ids: `B` enum ends at `STRONGBOX: 61` (`src/defs.js:59`); `62` and `63`
  are free (item ids start at 64, `I.STICK: 64`). `D[id] = {name, kind:
  'solid'|'cutout', tex, hard, tool, drop}` — `isSolid()` checks `kind ===
  'solid'` (`defs.js:197`). Exemplar non-block-drop solid interactable: `D[B.GATE]`
  (`defs.js:185`, `kind:'solid'`).
- Interact-on-raycast-hit dispatch: `src/main.js:4438-4442` — `if (hit.id ===
  B.SIGNPOST) { this.readSignpost(); return; }` inside the interact handler.
  Matching hint-text block: `main.js:5475-5477`.
- Fade mechanism (reuse, don't reinvent): `this.renderer.domElement.style.opacity`
  driven by a `_titleRevealT`-style gate — `src/main.js:4791-5055`. This plan's
  threshold fade copies that opacity-drive shape at a much shorter duration.
- Teleport idiom: `warp()` debug helper — `src/main.js:638-652` — sets
  `G.player.pos = {x,y,z}; G.player.vel = {x:0,y:0,z:0}` directly. Confirmed no
  special interior coordinate space is needed — physics/save/relay all operate on
  plain world (x,y,z) (`src/player.js:431-490` `serialize()`/`deserialize()`).
- SFX to reuse, both already parameterised, no new authoring needed:
  `this.audio.warnKnock(vol)` (`src/audio.js:619-634`, two struck wooden knocks —
  the latch), `this.audio.hearthCrackle(vol)` (`src/audio.js:699-706`, banded
  noise bursts — under the fade for atmosphere). `potClink`/`pubLaugh` also exist
  in the same "tap-room & travel" audio section (`audio.js:684-706`) for later
  slices, not needed in D1.
- Sign lettering technique for D2 to adapt (out of scope here — noted so D2
  doesn't have to re-derive it): `makeNameplate(text, sub)` —
  `src/entities.js:886-924`. Builds a `CanvasTexture` from 2D canvas text,
  mounts it on a `THREE.Sprite` (always faces camera) — not reusable verbatim
  for a wall sign, which must NOT billboard. D2 should mount a
  `THREE.PlaneGeometry`/`MeshBasicMaterial` variant instead, oriented flush
  against the door wall.
- Verify script house style: `ok`/`bad` accumulator, grouped `{ ... }` blocks per
  invariant, `console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  process.exit(failed ? 1 : 0);` — `scripts/verify-_template.mjs`. Headless Node
  only: no DOM, no WebGL, no unseeded `Math.random`. Real example construction:
  `new MoorsGeography()` with no args — `scripts/verify-moorsgeo.mjs:10`.
- `package.json` verify chain is a hand-maintained `&&`-chain plus individual
  `"verify:<name>"` entries (`package.json:13-89`) — both must be added or the
  new scripts silently never run.
- `docs/ARCHITECTURE.md` row format: `| Subsystem | File | Owns | Constructed |
  Guard |` (`docs/ARCHITECTURE.md:22-57`).

## Known limitation this plan accepts (flag, don't silently hide)

`HearthLayer` populates `v.buildings` (decorative house footprints) at runtime,
client-side, from `villageColumn` classification — this plan's site-scan cannot
consult that list at world-generation time (chunk generation is asset-free, no
`HearthLayer` instance exists yet) or from a Node verify script. The site-scan
instead picks a site far enough from the village centre (`INN_MIN_R`/`INN_MAX_R`
below) that overlap with the dense decorative core is unlikely, and Task 7's
in-browser proof pass is the actual check. If Grosmont's flagship tavern visually
collides with a `HearthLayer` house, the fix is widening `INN_MIN_R`/`INN_MAX_R`
in `innplan.js` (Task 1) and re-verifying — not hand-placing coordinates.

---

## Task 1: `innPlan()` — pure deterministic plan generator

**Files:**
- Create: `src/innplan.js`
- Test: `scripts/verify-inn-interior.mjs`

- [ ] **Step 1: Write the failing verify script (determinism + shape)**

```js
// scripts/verify-inn-interior.mjs
// innPlan() determinism + shape — run wi': node scripts/verify-inn-interior.mjs
import { MoorsGeography } from '../src/moorsgeo.js';
import { innPlan, PARLOUR_W, PARLOUR_L, PARLOUR_H } from '../src/innplan.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

const geo = new MoorsGeography();

// --- determinism: same village + seed -> byte-identical plan ---
{
  const a = innPlan(geo, 'Grosmont', 12345);
  const b = innPlan(geo, 'Grosmont', 12345);
  (a !== null ? ok : bad)('Grosmont produces a plan');
  (a && JSON.stringify(a) === JSON.stringify(b) ? ok : bad)('deterministic — same village+seed, same plan');
}

// --- different seed -> can differ (not a hard requirement of sameness) ---
{
  const a = innPlan(geo, 'Grosmont', 1);
  const c = innPlan(geo, 'Grosmont', 2);
  (a && c ? ok : bad)('two different seeds both produce a plan');
}

// --- shape: every field the rest of the program depends on is present and sane ---
{
  const p = innPlan(geo, 'Grosmont', 12345);
  (typeof p.name === 'string' && p.name.length > 0 ? ok : bad)('plan has a non-empty name');
  (p.name === 'Station Tavern' ? ok : bad)('Grosmont is named "Station Tavern" (flagship, handoff §3)');
  (Number.isInteger(p.origin.x) && Number.isInteger(p.origin.z) ? ok : bad)('origin is an integer (x,z)');
  (p.protectedBox.x1 > p.protectedBox.x0 && p.protectedBox.z1 > p.protectedBox.z0 ? ok : bad)('protectedBox is non-degenerate');
  (p.footprint.x0 >= p.protectedBox.x0 && p.footprint.x1 <= p.protectedBox.x1 ? ok : bad)('exterior footprint sits inside the protected box (x)');
  (p.footprint.z0 >= p.protectedBox.z0 && p.footprint.z1 <= p.protectedBox.z1 ? ok : bad)('exterior footprint sits inside the protected box (z)');
  (p.parlour.w === PARLOUR_W && p.parlour.l === PARLOUR_L && p.parlour.h === PARLOUR_H ? ok : bad)('parlour dims match the exported constants');
  (p.parlour.floorY >= 2 && p.parlour.floorY + PARLOUR_H < 20 ? ok : bad)('parlour sits at a shallow, in-bounds y (well clear of bedrock and normal terrain)');
  (p.doorSide === 'n' || p.doorSide === 's' || p.doorSide === 'e' || p.doorSide === 'w' ? ok : bad)('doorSide is one of n/s/e/w');
  (Array.isArray(p.parlour.tables) && p.parlour.tables.length === 4 ? ok : bad)('parlour has all 4 first-cut game tables (handoff §3 "Games, first cut")');
  const games = p.parlour.tables.map(t => t.game).sort();
  (JSON.stringify(games) === JSON.stringify(['dominoes', 'draughts', 'merrils', 'shoveha']) ? ok : bad)('the 4 tables are exactly merrils/draughts/dominoes/shoveha, no dupes');
  (p.parlour.hearth.x >= 1 && p.parlour.hearth.x < PARLOUR_W - 1 ? ok : bad)('hearth sits inside the parlour, not against the outer wall corner');
}

// --- a village with no configured inn returns null, not a throw ---
{
  let threw = false, r = undefined;
  try { r = innPlan(geo, 'Nowhere Village', 1); } catch (e) { threw = true; }
  (!threw ? ok : bad)('unconfigured village does not throw');
  (r === null ? ok : bad)('unconfigured village returns null');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it, confirm it fails on missing module**

Run: `node scripts/verify-inn-interior.mjs`
Expected: `Error [ERR_MODULE_NOT_FOUND]` for `../src/innplan.js` (module doesn't exist yet).

- [ ] **Step 3: Write `src/innplan.js`**

```js
// src/innplan.js — deterministic inn/tavern plan builder. Pure: no THREE, no
// World, no chunk access — callable from worldgen (has `geo`) and from a Node
// verify script (constructs `geo` directly). Given the same (geo, villageName,
// seed) it must always return the same plan (INVARIANTS.md rule 6, determinism).
import { mulberry32, strSeed } from './noise.js';

export const PARLOUR_W = 11;   // parlour interior width (x), blocks
export const PARLOUR_L = 9;    // parlour interior length (z), blocks
export const PARLOUR_H = 4;    // parlour interior clear height, blocks
const PARLOUR_FLOOR_Y = 3;     // world y the parlour floor sits at (well clear of bedrock y=0)
const WALL_THICK = 1;          // shell wall thickness, both exterior and pocket

const EXT_W = 9;               // exterior building footprint width (x), blocks
const EXT_L = 7;                // exterior building footprint length (z), blocks
const EXT_MARGIN = 2;          // no-edit buffer beyond the exterior footprint, blocks

const INN_MIN_R = 14;          // site-scan: nearest ring to try (blocks from village centre)
const INN_MAX_R = 28;          // site-scan: furthest ring to try before giving up

// Flagship + confirmed candidates (handoff §3). Villages not listed here have no inn.
const INN_NAMES = {
  Grosmont: 'Station Tavern',
  Lealholm: 'Board Inn',
  Danby: 'Duke of Wellington',
  'Beck Hole': 'Birch Hall Inn',
  Pickering: 'White Swan',
  Egton: 'Postgate',
};
const GENERIC_NAMES = ['The Black Bull', 'The Plough', 'The Fleece', 'The Ship', 'The Anchor', 'The Crown'];
const GAMES = ['merrils', 'draughts', 'dominoes', 'shoveha'];
const DOOR_SIDES = ['n', 's', 'e', 'w'];

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

// Deterministic clear-site scan near the village centre. Pure (x,z) queries only —
// see "Known limitation" note at the top of the plan for why this can't consult
// HearthLayer's decorative v.buildings list.
function scanSite(geo, v, rng) {
  const saltAngle = rng() * Math.PI * 2;
  for (let r = INN_MIN_R; r <= INN_MAX_R; r += 2) {
    for (let ai = 0; ai < 12; ai++) {
      const angle = (ai / 12) * Math.PI * 2 + saltAngle;
      const x = v.x + Math.round(r * Math.cos(angle));
      const z = v.z + Math.round(r * Math.sin(angle));
      if (typeof geo.onRoad === 'function' && geo.onRoad(x, z)) continue;
      if (typeof geo.riverColumn === 'function' && geo.riverColumn(x, z)) continue;
      const h = geo.height(x, z);
      // flat enough: every corner of the exterior box within 1 block of centre height
      let flat = true;
      for (const [dx, dz] of [[-EXT_W / 2, -EXT_L / 2], [EXT_W / 2, -EXT_L / 2], [-EXT_W / 2, EXT_L / 2], [EXT_W / 2, EXT_L / 2]]) {
        if (Math.abs(geo.height(Math.round(x + dx), Math.round(z + dz)) - h) > 1) { flat = false; break; }
      }
      if (!flat) continue;
      return { x, z, groundY: h };
    }
  }
  return null;
}

export function innPlan(geo, villageName, seed) {
  const name = INN_NAMES[villageName];
  if (!name) return null;
  const v = geo.villages.find(vv => vv.name === villageName);
  if (!v) return null;

  const rng = mulberry32((strSeed(villageName) ^ (seed | 0)) | 0);
  const site = scanSite(geo, v, rng);
  if (!site) return null;

  const label = name === undefined ? pick(rng, GENERIC_NAMES) : name;
  const doorSide = pick(rng, DOOR_SIDES);

  const ex0x = site.x - Math.floor(EXT_W / 2), ex1x = ex0x + EXT_W - 1;
  const ex0z = site.z - Math.floor(EXT_L / 2), ex1z = ex0z + EXT_L - 1;
  const footprint = { x0: ex0x, z0: ex0z, x1: ex1x, z1: ex1z };
  const protectedBox = {
    x0: ex0x - EXT_MARGIN, z0: ex0z - EXT_MARGIN,
    x1: ex1x + EXT_MARGIN, z1: ex1z + EXT_MARGIN,
  };

  // parlour tables: 4 fixed slots around the room, deterministic order shuffled by rng
  const slots = [
    { x: 2, z: 2 }, { x: PARLOUR_W - 3, z: 2 },
    { x: 2, z: PARLOUR_L - 3 }, { x: PARLOUR_W - 3, z: PARLOUR_L - 3 },
  ];
  const games = [...GAMES];
  const tables = slots.map(s => ({ ...s, game: games.splice(Math.floor(rng() * games.length), 1)[0] }));

  return {
    village: villageName,
    name: label,
    origin: { x: site.x, z: site.z },
    groundY: site.groundY,
    doorSide,
    footprint,
    protectedBox,
    parlour: {
      w: PARLOUR_W, l: PARLOUR_L, h: PARLOUR_H,
      floorY: PARLOUR_FLOOR_Y,
      wallThick: WALL_THICK,
      hearth: { x: Math.floor(PARLOUR_W / 2), z: 1 },
      tables,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-inn-interior.mjs`
Expected: every line `ok`, then `RESULT: PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/innplan.js scripts/verify-inn-interior.mjs
git commit -m "feat(tavern): deterministic innPlan() builder for D1"
```

---

## Task 2: Reserve the `INN_DOOR` block id

**Files:**
- Modify: `src/defs.js:59` (append after `STRONGBOX: 61`), and the `D[]` block
  definitions section near `defs.js:185` (next to `D[B.GATE]`).

- [ ] **Step 1: Add the block id**

In `src/defs.js`, immediately after line 59 (`STRONGBOX: 61,`):

```js
  INN_DOOR: 62,    // an inn's threshold — right-click to cross; never breaks (protected region)
```

- [ ] **Step 2: Add the block definition**

In `src/defs.js`, immediately after the `D[B.GATE]` line (defs.js:185):

```js
D[B.INN_DOOR] = { name: 'Tavern Door', kind: 'solid', tex: { t: TILE.LOG_TOP, s: TILE.PLANKS, b: TILE.LOG_TOP }, hard: 999, tool: null, drop: null };
```

(`hard: 999` and `drop: null` are belt-and-braces — the region-protection check in
Task 4 is the real guard, this just means an INN_DOOR block can never be selected
by the normal mining-progress UI even if the protection check were ever bypassed.)

- [ ] **Step 3: Verify no collision / defs.js still loads**

Run: `node -e "import('./src/defs.js').then(m => console.log(m.B.INN_DOOR, m.D[m.B.INN_DOOR].name))"`
Expected: `62 Tavern Door`

- [ ] **Step 4: Commit**

```bash
git add src/defs.js
git commit -m "feat(tavern): reserve B.INN_DOOR block id"
```

---

## Task 3: Carve the shells into worldgen

**Files:**
- Modify: `src/worldgen.js` — `Gen` constructor, `generateChunk()`, add
  `stampInns()`.
- Test: extend `scripts/verify-inn-interior.mjs`.

- [ ] **Step 1: Extend the verify script with a chunk-carve assertion (failing first)**

Append to `scripts/verify-inn-interior.mjs`, before the final `console.log`:

```js
// --- worldgen actually carves the plan into chunk data ---
{
  const { Gen } = await import('../src/worldgen.js');
  const { B, CHUNK, HEIGHT } = await import('../src/defs.js');
  const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
  const gen = new Gen(12345);
  const plan = gen.inns.get('Grosmont');
  (plan ? ok : bad)('Gen builds a Grosmont inn plan at construction time');
  if (plan) {
    const cx = Math.floor(plan.origin.x / CHUNK), cz = Math.floor(plan.origin.z / CHUNK);
    const data = gen.generateChunk(cx, cz);
    const lx = plan.origin.x - cx * CHUNK, lz = plan.origin.z - cz * CHUNK;
    const doorY = plan.groundY + 1;
    (data[IDX(lx, doorY, lz + Math.floor(EXT_L_TEST / 2))] !== undefined ? ok : bad)('chunk data generated at the inn site');
    // the parlour floor cell under the site should be a walkable AIR cell at parlour height
    const pfx = Math.floor(PARLOUR_W_TEST / 2), pfz = 1;
    (data[IDX(pfx, plan.parlour.floorY + 1, pfz)] === B.AIR ? ok : bad)('parlour interior is hollowed out (AIR) at floor+1');
    (data[IDX(pfx, plan.parlour.floorY, pfz)] !== B.AIR ? ok : bad)('parlour floor is solid, not AIR');
  }
}
```

(Note: this step intentionally references `EXT_L_TEST`/`PARLOUR_W_TEST`, which
don't exist yet — Step 1's job is only to prove the script fails for the right
reason. Step 3 below replaces this block with the corrected version that imports
the real constants instead of inventing test-local ones.)

- [ ] **Step 2: Run it, confirm it fails (`Gen.inns` doesn't exist / ReferenceError)**

Run: `node scripts/verify-inn-interior.mjs`
Expected: `TypeError: Cannot read properties of undefined (reading 'get')` or a
`ReferenceError` for the undefined test-local constants — either way, a clean
failure, not a pass.

- [ ] **Step 3: Fix the test to import real constants, then implement**

Replace the block added in Step 1 with:

```js
// --- worldgen actually carves the plan into chunk data ---
{
  const { Gen } = await import('../src/worldgen.js');
  const { B, CHUNK } = await import('../src/defs.js');
  const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
  const gen = new Gen(12345);
  const plan = gen.inns.get('Grosmont');
  (plan ? ok : bad)('Gen builds a Grosmont inn plan at construction time');
  if (plan) {
    const cx = Math.floor(plan.origin.x / CHUNK), cz = Math.floor(plan.origin.z / CHUNK);
    const data = gen.generateChunk(cx, cz);
    const lx = ((plan.origin.x % CHUNK) + CHUNK) % CHUNK;
    const lz = ((plan.origin.z % CHUNK) + CHUNK) % CHUNK;
    // the parlour interior directly under the origin should be hollow at floor+1
    (data[IDX(lx, plan.parlour.floorY + 1, lz)] === B.AIR ? ok : bad)('parlour interior is hollowed out (AIR) at floor+1 under the origin');
    (data[IDX(lx, plan.parlour.floorY, lz)] !== B.AIR ? ok : bad)('parlour floor is solid, not AIR');
    // the ceiling one above the interior clear height should be solid too (a sealed room, not a shaft to the void)
    (data[IDX(lx, plan.parlour.floorY + plan.parlour.h + 1, lz)] !== B.AIR ? ok : bad)('parlour ceiling is solid, not AIR');
  }
}
```

Then, in `src/worldgen.js`:

**3a. Import + constructor.** Near the top imports (worldgen.js has `import {
... } from './defs.js';` already — extend it) add:

```js
import { innPlan } from './innplan.js';
```

In the `Gen` constructor (the class holding `generateChunk`, `stampStations`,
etc. — confirmed at `worldgen.js:282` for `generateChunk`; the constructor sits
above it in the same class), add after `this.geo = ...` is assigned (existing
line, exact text depends on constructor — locate `this.geo` assignment and add
immediately after it):

```js
    // One inn per configured village (innplan.js INN_NAMES), built once at
    // construction time — deterministic, so every client/relay Gen instance
    // with the same seed produces byte-identical inns (INVARIANTS.md rule 6).
    this.inns = new Map();
    for (const v of this.geo.villages) {
      const plan = innPlan(this.geo, v.name, this.seed);
      if (plan) this.inns.set(v.name, plan);
    }
```

**3b. Suppress normal terrain in the parlour's underground column range.** In the
per-column loop inside `generateChunk` (`worldgen.js:288-341`), the loop already
computes `x`, `z`, `h` per column (`worldgen.js:290-291`). Add, immediately after
`const h = geo.height(x, z);` (line 291):

```js
        const inn = this.innAt(x, z);
```

And add this new method on the `Gen` class, near `stampStations` (before it, so
it's defined by the time `generateChunk` calls it — place directly above the
`stampStations(data, cx, cz) {` line at `worldgen.js:610`):

```js
  // Is (x,z) inside any inn's protected box? O(inns) — inns.size is tiny (a
  // handful of villages), called once per column per chunk generation.
  innAt(x, z) {
    for (const p of this.inns.values()) {
      if (x >= p.protectedBox.x0 && x <= p.protectedBox.x1 && z >= p.protectedBox.z0 && z <= p.protectedBox.z1) return p;
    }
    return null;
  }
```

Then, still inside the per-column loop, change the cave/ore carve line
(`worldgen.js:310`, `id = this.caveAt(x, y, z, h) ? B.AIR : this.oreAt(x, y, z);`)
so it does not carve natural caves through a reserved inn column — a natural cave
opening into the parlour or its surrounding stone would break the "indestructible
shell" guarantee from outside. Replace:

```js
            id = this.caveAt(x, y, z, h) ? B.AIR : this.oreAt(x, y, z);
```

with:

```js
            id = (inn ? false : this.caveAt(x, y, z, h)) ? B.AIR : this.oreAt(x, y, z);
```

**3c. Stamp the two shells after the terrain loop.** In `generateChunk`, find
the call site `this.stampStations(data, cx, cz);` (`worldgen.js:519`) and add
immediately before it:

```js
    this.stampInns(data, cx, cz);
```

**3d. Write `stampInns`.** Add this method directly above `stampStations`
(`worldgen.js:610`), following its exact `put`/`at` closure shape:

```js
  // One inn's exterior shell + underground parlour, stamped into whichever
  // chunk(s) its protectedBox overlaps. Same idiom as stampStations: local
  // put()/at() closures bounds-checked against the current chunk only, so a
  // structure straddling a chunk boundary gets finished by its OTHER chunk's
  // own call — every chunk only ever writes its own CHUNK x CHUNK x HEIGHT slab.
  stampInns(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const put = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && wy >= 0 && wy < HEIGHT) data[IDX(lx, wy, lz)] = id;
    };
    for (const p of this.inns.values()) {
      if (p.protectedBox.x1 < x0 || p.protectedBox.x0 >= x0 + CHUNK || p.protectedBox.z1 < z0 || p.protectedBox.z0 >= z0 + CHUNK) continue;

      // --- exterior shell: a modest stone building, slate roof, one door ---
      const { x0: fx0, z0: fz0, x1: fx1, z1: fz1 } = p.footprint;
      const wallH = 3, g = p.groundY;
      for (let wx = fx0; wx <= fx1; wx++) for (let wz = fz0; wz <= fz1; wz++) {
        const perim = (wx === fx0 || wx === fx1 || wz === fz0 || wz === fz1);
        put(wx, g, wz, B.PLANKS); // floor
        for (let y = g + 1; y <= g + wallH; y++) put(wx, y, wz, perim ? B.STONEBRICK : B.AIR);
        put(wx, g + wallH + 1, wz, B.SLATE); // flat slate roof — a genuine gable is a D2 decor pass
      }
      // door: centred on doorSide, ground+1 and ground+2 clear except the door block itself at ground+1
      const midX = Math.round((fx0 + fx1) / 2), midZ = Math.round((fz0 + fz1) / 2);
      const doorPos = p.doorSide === 'n' ? [midX, fz0] : p.doorSide === 's' ? [midX, fz1]
        : p.doorSide === 'e' ? [fx1, midZ] : [fx0, midZ];
      put(doorPos[0], g + 1, doorPos[1], B.INN_DOOR);
      put(doorPos[0], g + 2, doorPos[1], B.AIR);

      // --- underground parlour: hollow room + solid stone shell, directly below the site ---
      const { floorY, w: pw, l: pl, h: ph, wallThick: wt } = p.parlour;
      const px0 = p.origin.x - Math.floor(pw / 2) - wt, px1 = px0 + pw + 2 * wt - 1;
      const pz0 = p.origin.z - Math.floor(pl / 2) - wt, pz1 = pz0 + pl + 2 * wt - 1;
      for (let wx = px0; wx <= px1; wx++) for (let wz = pz0; wz <= pz1; wz++) {
        const inShell = (wx === px0 || wx === px1 || wz === pz0 || wz === pz1);
        put(wx, floorY - 1, wz, B.STONEBRICK); // footing
        for (let y = floorY; y <= floorY + ph; y++) put(wx, y, wz, inShell ? B.STONEBRICK : B.AIR);
        put(wx, floorY + ph + 1, wz, B.STONEBRICK); // ceiling
      }
      // interior exit door, in the wall nearest the surface door's horizontal direction
      const ix0 = p.origin.x - Math.floor(pw / 2), iz0 = p.origin.z - Math.floor(pl / 2);
      const exitPos = p.doorSide === 'n' ? [p.origin.x, pz0] : p.doorSide === 's' ? [p.origin.x, pz1]
        : p.doorSide === 'e' ? [px1, p.origin.z] : [px0, p.origin.z];
      put(exitPos[0], floorY + 1, exitPos[1], B.INN_DOOR);

      // hearth: a torch-lit stone hearth cell (fire.js/hearthLayer picks this up in D2/D3 —
      // D1 only needs the physical block so the location exists and is walkable-adjacent)
      const hx = ix0 + p.parlour.hearth.x, hz = iz0 + p.parlour.hearth.z;
      put(hx, floorY, hz, B.STONEBRICK);
      put(hx, floorY + 1, hz, B.TORCH);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-inn-interior.mjs`
Expected: all `ok`, `RESULT: PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/worldgen.js scripts/verify-inn-interior.mjs
git commit -m "feat(tavern): carve Station Tavern shell + parlour into worldgen"
```

---

## Task 4: Edit protection — local `setBlock`

**Files:**
- Modify: `src/world.js:100-104`
- Test: create `scripts/verify-inn-protection.mjs`

- [ ] **Step 1: Write the failing verify script**

```js
// scripts/verify-inn-protection.mjs
// Inn shells refuse player edits, locally and via relay — run wi':
// node scripts/verify-inn-protection.mjs
import { World } from '../src/world.js';
import { B } from '../src/defs.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

// minimal fake scene (World only touches scene when meshing, which we never trigger here)
const scene = { add() {}, remove() {} };
const world = new World(scene, 12345, new Map());
const plan = world.gen.inns.get('Grosmont');
(plan ? ok : bad)('Grosmont inn plan exists on the World’s Gen instance');

if (plan) {
  const { x0, z0, x1, z1 } = plan.protectedBox;
  const cx = Math.floor(x0 / 16), cz = Math.floor(z0 / 16);
  world.ensureChunk(cx, cz); // load the chunk so setBlock doesn't early-return on "no chunk"

  // --- a block INSIDE the protected box cannot be placed or broken ---
  const before = world.getBlock(x0, plan.groundY, z0);
  world.setBlock(x0, plan.groundY, z0, B.AIR); // attempted "break"
  (world.getBlock(x0, plan.groundY, z0) === before ? ok : bad)('cannot break a block inside the inn’s protected box');
  world.setBlock(x0, plan.groundY + 5, z0, B.STONE); // attempted "place" into open air above the roof
  (world.getBlock(x0, plan.groundY + 5, z0) !== B.STONE || before === B.STONE ? ok : bad)('cannot place a block inside the inn’s protected box');

  // --- a block just OUTSIDE the box is unaffected (protection isn't over-wide) ---
  const ox = x0 - 3, oz = z0;
  const ocx = Math.floor(ox / 16), ocz = Math.floor(oz / 16);
  world.ensureChunk(ocx, ocz);
  world.setBlock(ox, plan.groundY, oz, B.STONE);
  (world.getBlock(ox, plan.groundY, oz) === B.STONE ? ok : bad)('editing 3 blocks outside the protected box still works normally');
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node scripts/verify-inn-protection.mjs`
Expected: the "cannot break"/"cannot place" assertions `FAIL` (protection doesn't
exist yet — `setBlock` currently allows both).

- [ ] **Step 3: Implement the guard in `src/world.js`**

In `src/world.js`, add this method to the `World` class, near `setBlock`
(directly above it, so it reads top-to-bottom as "the rule, then the thing it
guards"):

```js
  // True if (x,z) sits inside any inn's protected box (handoff §3,
  // "Indestructible, both shells") — checked for EVERY setBlock call, place or
  // break, regardless of y, so the exterior walls/roof and the whole underground
  // parlour+shell are covered by one rule.
  isProtected(x, z) {
    for (const p of this.gen.inns.values()) {
      if (x >= p.protectedBox.x0 && x <= p.protectedBox.x1 && z >= p.protectedBox.z0 && z <= p.protectedBox.z1) return true;
    }
    return false;
  }
```

Then change `setBlock` (`world.js:100-104`) from:

```js
  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return;
```

to:

```js
  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return;
    if (this.isProtected(x, z)) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return;
```

(This also protects `stampInns` itself: `stampInns` never calls `setBlock` — it
writes `data[]` directly during `generateChunk`, before the chunk is registered —
so worldgen's own carve is unaffected by this guard, only post-generation edits
are.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-inn-protection.mjs`
Expected: all `ok`, `RESULT: PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/world.js scripts/verify-inn-protection.mjs
git commit -m "feat(tavern): protect inn shells from player edits (local setBlock)"
```

---

## Task 5: Edit protection — relay edits

**Files:**
- Modify: `src/multiplayer.js:237-243`
- Test: extend `scripts/verify-inn-protection.mjs`

- [ ] **Step 1: Extend the verify script (failing first)**

Append to `scripts/verify-inn-protection.mjs`, before the final `console.log`:

```js
// --- incoming relay 'edit' messages targeting the protected box are ignored ---
{
  const { NetClient } = await import('../src/multiplayer.js');
  const fakeGame = { world, ui: { toast() {} }, state: 'playing' };
  const net = new NetClient(fakeGame, { send() {} });
  net.remotes = new Map(); net.leaving = new Map(); net.diag = {};
  const { x0, z0 } = plan.protectedBox;
  const before2 = world.getBlock(x0, plan.groundY, z0);
  net.handle({ type: 'edit', x: x0, y: plan.groundY, z: z0, id: 0 });
  (world.getBlock(x0, plan.groundY, z0) === before2 ? ok : bad)('incoming relay edit inside the protected box is ignored');
}
```

- [ ] **Step 2: Run it, confirm the new assertion fails**

Run: `node scripts/verify-inn-protection.mjs`
Expected: the "incoming relay edit" line `FAIL`s — `world.setBlock` inside
`isProtected` already blocks the write, actually, since Task 4 already guards
`setBlock` itself... **check first**: if Task 4's `setBlock` guard alone already
makes this assertion pass, that is fine and expected — the relay path calls
`g.world.setBlock(...)` (`multiplayer.js:243`), which now refuses the write at
the source. In that case this step's "expected failure" doesn't occur; skip
straight to Step 3's explicit early-return for defence-in-depth (avoiding the
`netEdits` bookkeeping at `multiplayer.js:241-242` running for a rejected edit)
rather than relying solely on `setBlock`'s internal guard.

- [ ] **Step 3: Add the explicit guard in `src/multiplayer.js`**

Change (`multiplayer.js:239-243`) from:

```js
    if (m.type === 'edit') {
      if (!this.saneCoord(m.x, m.y, m.z) || !Number.isInteger(m.id) || m.id < 0 || m.id > 4095) return;
      g.world.netEdits = g.world.netEdits || new Map();
      g.world.netEdits.set(`${m.x},${m.y},${m.z}`, m.id);
      g.world.setBlock(m.x, m.y, m.z, m.id);
```

to:

```js
    if (m.type === 'edit') {
      if (!this.saneCoord(m.x, m.y, m.z) || !Number.isInteger(m.id) || m.id < 0 || m.id > 4095) return;
      if (g.world.isProtected(m.x, m.z)) return; // an inn's shell — never mutable, ours or another player's
      g.world.netEdits = g.world.netEdits || new Map();
      g.world.netEdits.set(`${m.x},${m.y},${m.z}`, m.id);
      g.world.setBlock(m.x, m.y, m.z, m.id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-inn-protection.mjs`
Expected: all `ok`, `RESULT: PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer.js scripts/verify-inn-protection.mjs
git commit -m "feat(tavern): protect inn shells from relay-borne edits"
```

---

## Task 6: Threshold interaction — enter and exit

**Files:**
- Modify: `src/main.js` (interact dispatch ~4438-4442, hint text ~5475-5477)

This task is behaviour that needs a running browser to see, so it has no
verify-script step of its own — Task 7's in-browser proof pass covers it. Write
it carefully against the exact cited anchors.

- [ ] **Step 1: Add the fade+teleport+audio flow**

Add this method to the `Game` class in `src/main.js`, near `warp()`
(`main.js:638-652`, so related teleport logic stays together):

```js
  // Threshold crossing: fade to black, teleport, fade back in. `toPlan` is the
  // inn plan (src/innplan.js); `entering` picks parlour-vs-exterior destination.
  // Mirrors the opacity-drive shape of the title-reveal fade (main.js ~4791-5055)
  // at a much shorter duration — no need for the chunk-streaming gate that fade
  // uses, since both destinations are already-generated ground (the inn's own
  // chunk, which by definition is generated because the player is standing on it).
  crossThreshold(plan, entering) {
    if (this._thresholdBusy) return;
    this._thresholdBusy = true;
    this.audio.warnKnock(0.3); // the latch
    const dest = entering
      ? { x: plan.origin.x, y: plan.parlour.floorY + 1, z: plan.origin.z }
      : { x: plan.footprint.x0 - 1, y: plan.groundY + 1, z: Math.round((plan.footprint.z0 + plan.footprint.z1) / 2) };
    const el = this.renderer.domElement;
    const FADE_MS = 260;
    el.style.opacity = '0';
    setTimeout(() => {
      this.player.pos.x = dest.x; this.player.pos.y = dest.y; this.player.pos.z = dest.z;
      this.player.vel = { x: 0, y: 0, z: 0 };
      if (entering) this.audio.hearthCrackle(0.25);
      el.style.opacity = '1';
      this._thresholdBusy = false;
    }, FADE_MS);
  }
```

- [ ] **Step 2: Wire the interact dispatch**

In `src/main.js`, at the interact handler (`main.js:4438-4442`), change:

```js
      if (hit.id === B.SIGNPOST) { this.readSignpost(); return; }
```

to add a preceding branch (keep the signpost line unchanged immediately after):

```js
      if (hit.id === B.INN_DOOR) {
        let matched = null, entering = true;
        for (const p of this.world.gen.inns.values()) {
          const { x0, z0, x1, z1 } = p.protectedBox;
          const inExterior = hit.x >= x0 && hit.x <= x1 && hit.z >= z0 && hit.z <= z1 && hit.y < p.parlour.floorY;
          if (inExterior) { matched = p; entering = true; break; }
          if (hit.x >= x0 && hit.x <= x1 && hit.z >= z0 && hit.z <= z1) { matched = p; entering = false; break; }
        }
        if (matched) this.crossThreshold(matched, entering);
        return;
      }
      if (hit.id === B.SIGNPOST) { this.readSignpost(); return; }
```

(The `hit.y < p.parlour.floorY` split works because the exterior door sits at
`groundY+1`, always well above `parlour.floorY` which is a fixed shallow y=3 —
the two doors never overlap in y for any village.)

- [ ] **Step 3: Add the interact hint text**

At `main.js:5475-5477`:

```js
        } else if (hit.id === B.SIGNPOST) hint = 'Right-click: read t’ waymark';
```

add immediately before it:

```js
        } else if (hit.id === B.INN_DOOR) hint = 'Right-click: cross the threshold';
```

- [ ] **Step 4: Manual check (documented, not automated — no headless DOM)**

In-browser, via preview tools: `moorstead.debug.warp('Grosmont')`, walk to the
Station Tavern door, right-click. Expect: latch-knock SFX, brief fade to black,
reappear inside a warm-lit stone parlour with a hearth and four tables,
hearth-crackle SFX, fade back in. Right-click the parlour's own door: reverse
the whole sequence, reappear just outside the tavern's exterior door. This is
folded into Task 7's proof pass, not repeated here.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(tavern): threshold interaction — fade, teleport, fade back, both ways"
```

---

## Task 7: Docs, verify-chain wiring, in-browser proof pass

**Files:**
- Modify: `package.json` (verify chain)
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Wire both new scripts into the verify chain**

In `package.json`, add two entries alongside the existing `"verify:strongbox"`
etc. block (`package.json:65` area):

```json
    "verify:inninterior": "node scripts/verify-inn-interior.mjs",
    "verify:innprotection": "node scripts/verify-inn-protection.mjs",
```

And append both to the long `"verify"` chain (`package.json:13`, the
hand-maintained `&&`-chain) — add `&& node scripts/verify-inn-interior.mjs &&
node scripts/verify-inn-protection.mjs` at the end of that line.

- [ ] **Step 2: Run the full gate**

Run: `npm run verify`
Expected: every script in the chain prints `RESULT: PASS`, command exits 0. If
any PRE-EXISTING script fails, stop — that is not this plan's job to fix; report
it rather than papering over it.

- [ ] **Step 3: Add ARCHITECTURE.md rows**

In `docs/ARCHITECTURE.md`, in the module-map table (row format confirmed at
`ARCHITECTURE.md:22-57`), add:

```
| Inn plan / tavern builder | `src/innplan.js` | `innPlan(geo, villageName, seed)` — deterministic site scan, footprint, protected box, parlour layout | `worldgen.js` `Gen` constructor | `verify-inn-interior` |
| Inn worldgen carve | `src/worldgen.js` `stampInns()` | exterior shell + underground parlour voxels, cave/ore suppression for reserved columns | `generateChunk()` | `verify-inn-interior` |
| Inn edit protection | `src/world.js` `isProtected()`, `src/multiplayer.js` `handle()` | refuses place/break inside any inn's protected box, local + relay | `World.setBlock`, `NetClient.handle` | `verify-inn-protection` |
| Inn threshold | `src/main.js` `crossThreshold()` | door interact → fade → teleport → fade in, both directions | interact dispatch | manual (Task 6 Step 4) |
```

- [ ] **Step 4: In-browser proof pass**

Start the dev server via the preview tools (`moorcraft-dev`, per CLAUDE.md).
`window.moorstead.debug.warp('Grosmont')`. Confirm, in order: (a) the Station
Tavern is visible, doesn't overlap a `HearthLayer` decorative house (if it does,
see "Known limitation" above — bump `INN_SITE_SALT`... actually the salt is
seed-derived, not a named constant in this plan — the fix is re-running
`innPlan` with a different `seed` argument passed to `new Gen(seed)`, which is
the existing world seed, not independently tunable per-inn; if a collision is
found, the correct fix is widening `INN_MIN_R`/`INN_MAX_R` in `innplan.js`
slightly and re-verifying, not hand-placing coordinates); (b) the door is
right-clickable and shows the "cross the threshold" hint; (c) crossing it fades,
plays the latch knock, and lands inside a warm stone parlour with a hearth and
four table footprints; (d) crossing the interior door reverses the whole
sequence and lands just outside the exterior door; (e) attempting to mine any
wall of either shell, or place a block into either shell, silently fails (no
break animation completes, no block appears); (f) the same mining/placing
attempt fails for a second connected client (if `npm run verify:live` env is
available) issuing the equivalent relay `edit` message.

- [ ] **Step 5: Commit**

```bash
git add package.json docs/ARCHITECTURE.md
git commit -m "chore(tavern): wire D1 verify scripts into the gate, update ARCHITECTURE.md"
```

---

## Definition of done for D1

`npm run verify` green including both new scripts; Grosmont's Station Tavern
visible (unnamed — the sign is D2's job) and sited without a visual collision on
the live village; threshold works both directions with correct SFX and fade
timing; exterior shell (footprint + margin) and the entire underground
parlour+surrounding-stone are un-editable, verified both via direct `setBlock`
and via a simulated relay `edit` message; `docs/ARCHITECTURE.md` has the four new
rows; nothing outside `src/innplan.js`, `src/defs.js`, `src/worldgen.js`,
`src/world.js`, `src/multiplayer.js`, `src/main.js`, `package.json`,
`docs/ARCHITECTURE.md`, and the
two new `scripts/verify-inn-*.mjs` files was touched. D2 (decor + template
variation + tavern strongbox from the pressure/incentive addendum) starts from
here.
