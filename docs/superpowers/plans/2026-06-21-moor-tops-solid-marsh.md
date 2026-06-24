# Moor Tops — Solid Marshy Land Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the moors world's high-moor bog **solid, walkable, marshy land** (you no longer sink through open liquid), while it keeps its boggy character — heather and moor-grass with sheep and grouse — so the tops read like the real North York Moors.

**Architecture:** `B.BOG` is a `liquid` block, and `worldgen.generateChunk` overwrites the boggiest high-moor columns (`isBogPool`) with two blocks of it — open bog you fall into, extensive on the elevation-driven moors world. Fix is two gated edits in the surface pass: in the real-Moors world, **don't lay liquid bog** (the columns stay solid `B.PEAT`), and **let the moor-grass/heather pass run on them** so they're vegetated. Fauna already spawn on `B.PEAT` (`entities.js`), so sheep/grouse roam it for free. Client-only — no `heightRaw`, no parity impact. Optional: a cotton-grass flora for the wet flushes.

**Tech Stack:** ES modules (client), procedural canvas tile textures (`textures.js`), headless + live frame-pump verification, `npx vercel deploy --prod --yes`.

**Spec:** [`2026-06-21-moors-terrain-water-design.md`](../specs/2026-06-21-moors-terrain-water-design.md) Unit A. **Branch:** continue on `feat/moors-1900-stage1a` (all Stage-1 work, uncommitted).

**Facts established (2026-06-21):**
- `defs.js`: `B.BOG` = `{kind:'liquid', hard:Infinity}` (you swim/sink, like water). `B.PEAT` = solid.
- `worldgen.js generateChunk` (`geo = this.geo`): blanket bog surface is already solid `B.PEAT` (line ~295). Only **bog pools** (`isBogPool`: `h≥33 && bogginess>0.74`) are overwritten with liquid `B.BOG` (lines ~321-325).
- The surface-veg pass (line ~332) is gated `!vcol && !pool && !onRoad && …`; the `surf === B.PEAT` branch (line ~384) already plants `B.TUSSOCK` (moor-grass) + `B.HEATHER`. Pools are excluded by `!pool`.
- `entities.js` spawn ground accepts `B.GRASS||B.PEAT||B.DIRT||B.STONE||B.SAND` (line ~1006/1046) — **peat is already valid**, so fauna roam solid bog automatically. `B.BOG` is *not* accepted (so today fauna avoid the liquid pools).

---

## Task 1: De-liquefy the moors high-moor bog + vegetate it (core)

**Files:**
- Modify: `src/worldgen.js` (`generateChunk` surface pass)

- [ ] **Step 1: Gate the liquid bog-pool fill to the stylised world only**

In `src/worldgen.js`, find:
```js
        // blanket bog pools: two deep, dark and hungry
        if (pool) {
          data[IDX(lx, h, lz)] = B.BOG;
          if (h - 1 > 0) data[IDX(lx, h - 1, lz)] = B.BOG;
          if (h - 2 > 0) data[IDX(lx, h - 2, lz)] = B.PEAT;
        }
```
Replace the condition so the real-Moors tops stay solid peat (no open liquid):
```js
        // blanket bog pools: two deep, dark and hungry — STYLISED world only.
        // The real Moors' tops are walkable peat-marsh, so no open liquid there.
        if (pool && !geo.realWorld) {
          data[IDX(lx, h, lz)] = B.BOG;
          if (h - 1 > 0) data[IDX(lx, h - 1, lz)] = B.BOG;
          if (h - 2 > 0) data[IDX(lx, h - 2, lz)] = B.PEAT;
        }
```

- [ ] **Step 2: Let the moor-grass/heather pass run on the moors marsh**

In the same function, find the surface-veg gate:
```js
        if (!vcol && !pool && !onRoad && h >= WATER_LEVEL && h <= HEIGHT - 3) {
```
Allow it on the moors world's (now-solid) former-pool columns:
```js
        if (!vcol && (!pool || geo.realWorld) && !onRoad && h >= WATER_LEVEL && h <= HEIGHT - 3) {
```
(The columns are `B.PEAT`, so they hit the existing `surf === B.PEAT` branch → tussock + heather. No other change needed.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Live-verify — the tops are solid (no sinking), peat, and vegetated**

Start/reload the preview, enter the moors world (small evals to dodge the frame-load timeout), then probe the boggiest high ground and drop a non-flying player onto it:
```js
(async () => {
  const { B } = await import('/src/defs.js');
  const geo = game.world.gen.geo;
  // find a high-moor bog-pool column (bogginess > 0.74, high ground)
  let spot = null;
  for (let bx = 600; bx < 2400 && !spot; bx += 23)
    for (let bz = 300; bz < 2200; bz += 23) {
      if (geo.bogginess(bx, bz) > 0.74 && geo.height(bx, bz) >= 40) { spot = [bx, bz]; break; }
    }
  const [x, z] = spot; const gy = geo.height(x, z);
  game.player.pos.x = x; game.player.pos.z = z; game.player.pos.y = gy + 18;
  Object.assign(game.player, { flying: false, creative: true });
  for (let i = 0; i < 200; i++) game.frame(); // let physics settle
  const surf = game.world.getBlock(x, gy, z);
  const head = game.world.getBlock(x, gy + 1, z);
  return {
    bogSpot: [x, z], groundY: gy,
    surfaceBlock: surf, surfaceIsBOG: surf === B.BOG, surfaceIsPEAT: surf === B.PEAT,
    floraAbove: head, // expect a cutout (TUSSOCK 22 / HEATHER 11) or AIR
    playerY: +game.player.pos.y.toFixed(1), landedSolid: game.player.pos.y > gy, // settled on top, not sunk
  };
})()
```
Expected: `surfaceIsBOG: false`, `surfaceIsPEAT: true`, `landedSolid: true` (player rests above the surface, hasn't sunk through), and `floraAbove` is often tussock/heather. Then `preview_console_logs` (errors) → none.

- [ ] **Step 5: Commit** (held — James commits on request; this records the step only)

```bash
git add src/worldgen.js
git commit -m "fix(moors): high-moor bog is solid walkable peat-marsh, not liquid you sink into"
```
(Per James's standing rule, hold commits until he asks; skip this if running the no-commit loop.)

---

## Task 2 (optional — authenticity): cotton-grass in the wet flushes

White cotton-grass tufts are the signature of a wet moor flush. Add a flora and scatter it on the wettest moors peat. Skippable — Task 1 already gives a solid, tussock-and-heather marsh.

**Files:**
- Modify: `src/defs.js` (new `TILE.COTTONGRASS`, `B.COTTONGRASS`, block def)
- Modify: `src/textures.js` (procedural tile)
- Modify: `src/worldgen.js` (placement)

- [ ] **Step 1: Add the tile + block ids**

In `src/defs.js`, add `COTTONGRASS` to the `TILE` enum at the next free index (after `HOLLY_SPRIG: 82`):
```js
  WREATH: 80, ROBIN: 81, HOLLY_SPRIG: 82, COTTONGRASS: 83,
```
Add `COTTONGRASS` to the `B` enum at the next free block id (read the end of the `B` block and use the next integer; e.g. if the last is `N`, use `N+1`):
```js
  COTTONGRASS: <next-free-B-id>,
```

- [ ] **Step 2: Block definition**

In `src/defs.js`, beside the other cutout flora (e.g. after `B.TUSSOCK`'s def):
```js
D[B.COTTONGRASS] = { name: 'Cotton-grass', kind: 'cutout', tex: { t: TILE.COTTONGRASS, s: TILE.COTTONGRASS, b: TILE.COTTONGRASS }, hard: 0.05, tool: null, drop: null };
```

- [ ] **Step 3: Procedural texture (white nodding tufts on slender stalks)**

In `src/textures.js`, beside `[TILE.TUSSOCK]`, add:
```js
  [TILE.COTTONGRASS](p) {
    p.clear();
    for (let i = 0; i < 6; i++) {
      const x = 2 + ((p.rng() * 12) | 0);
      const h = 7 + ((p.rng() * 7) | 0);
      for (let y = 0; y < h; y++) p.px(x, T - 1 - y, shade(0x6b6b40, 0.7 + p.rng() * 0.3)); // green stalk
      // white cotton head
      for (let dy = 0; dy < 3; dy++) for (let dx = -1; dx <= 1; dx++) p.px(x + dx, T - 1 - h - dy, shade(0xf4f1ea, 0.85 + p.rng() * 0.3));
    }
  },
```

- [ ] **Step 4: Place it on the wettest moors peat**

In `src/worldgen.js`, in the `surf === B.PEAT` branch (the `else if (surf === B.PEAT) { … }`), make the wettest moors ground carry cotton-grass:
```js
          } else if (surf === B.PEAT) {
            if (geo.realWorld && geo.bogginess(x, z) > 0.6 && r < 0.16) data[IDX(lx, h + 1, lz)] = B.COTTONGRASS;
            else if (r < 0.14) data[IDX(lx, h + 1, lz)] = B.TUSSOCK;
            else if (r < 0.2) data[IDX(lx, h + 1, lz)] = B.HEATHER;
          } else if (surf === B.STONE && r < 0.04) {
```

- [ ] **Step 5: Build + live-verify**

`npm run build` (exit 0). Then `preview_eval` the same bog spot from Task 1 and confirm `B.COTTONGRASS` tufts appear on the wettest peat (and render — `preview_console_logs` shows no texture/mesher errors).

- [ ] **Step 6: Commit** (held — see Task 1 Step 5)

```bash
git add src/defs.js src/textures.js src/worldgen.js
git commit -m "feat(moors): cotton-grass in the wet moor flushes"
```

---

## Wrap-up: verify, build, deploy

- [ ] **Step 1:** `npm run verify` — all green (this change touches no verify-covered logic, but confirm nothing regressed). `npm run build` — exit 0.
- [ ] **Step 2:** `npx vercel deploy --prod --yes`; confirm the new bundle hash live via PowerShell `Invoke-WebRequest` (curl.exe is broken on this box).
- [ ] **Step 3:** Hand to James — walk the high moor and confirm you can cross it without sinking, and it reads as marshy heather-and-grass moorland with sheep/grouse.

---

## Self-Review (completed during planning)

**Spec coverage (Unit A):** "no liquid on the tops" → Task 1 Step 1. "marshy character (tussock/heather, cotton-grass)" → Task 1 Step 2 (tussock/heather via the existing PEAT branch) + Task 2 (cotton-grass). "flora + fauna live there" → fauna already spawn on peat (`entities.js`, established above — no change needed); flora via Steps 2 + Task 2. "moors-gated, existing world untouched" → both edits gate on `geo.realWorld`. "occasional bounded pool" + "slow tread" → deliberately omitted (YAGNI; the spec marked them nice-to-have). **No `heightRaw`/parity impact** — correct, this is surface + flora only.

**Placeholder scan:** one deliberate runtime value — the next-free `B.COTTONGRASS` id (Task 2 Step 1), resolved by reading the `B` enum's end before use (block ids are sequential). Everything else is concrete.

**Type/name consistency:** `geo.realWorld` (boolean, set in `MoorsGeography`) gates both Task-1 edits and the Task-2 placement; `B.COTTONGRASS`/`TILE.COTTONGRASS` defined in Task 2 Step 1 and used consistently in Steps 2-4; the PEAT-branch edit (Task 2 Step 4) preserves the existing tussock/heather fallbacks.
