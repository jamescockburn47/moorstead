# Festivals Slice 2 — Scene Host Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Replace the monolithic `festiveLayer.js` with a `seasonalLayer.js` host that (a) renders winter **snowmen** on their own `deepSnow` gate and (b) **dispatches one festival builder** (Christmas, for now) from `festivals/`, gated on the festival calendar — which narrows the Christmas *dressing* to the same fortnight as the carol. Plus a season-override debug lever so every festival is testable.

**Architecture:** `seasonalLayer.js` owns the windowed rebuild/teardown lifecycle + snowmen + animation loops, and calls `festivals[active].build(ctx)` for whichever festival's window we're in. `festivals/christmas.js` holds the (moved, unchanged) Christmas content. `festivalKit.js` holds shared mesh helpers. This is mostly a move-refactor; the one behavioural change is the gating split.

**Tech Stack:** three.js, vanilla ES modules. No new deps.

**Scope:** Slice 2 of the seasonal-festivals spec (`docs/superpowers/specs/2026-06-25-seasonal-festivals-design.md` §2, §3). Christmas content is MOVED verbatim (the re-site/presents/parlour-tree changes are Slice 4). Snowmen behaviour is preserved (auto on deepSnow, player-built, melt in thaw) but gated independently of the festival.

---

### Task 1: The host + module split (one atomic commit)

This MUST land atomically (a half-moved `festiveLayer` doesn't build).

**Files:**
- Create: `src/festivalKit.js` — shared helpers
- Create: `src/festivals/christmas.js` — the Christmas builder (moved)
- Create: `src/seasonalLayer.js` — the host (lifecycle + snowmen + dispatch)
- Delete: `src/festiveLayer.js`
- Modify: `src/main.js` — swap `FestiveLayer` → `SeasonalLayer` at every site

**Target structure:**

- **`festivalKit.js`** exports the generic, festival-agnostic mesh helpers currently private to `festiveLayer.js`: `addBillboard(objects, scene, tile, x, y, z, yaw)` (the crossed-quad cutout), `addWindowGlow(objects, scene, x, y, z, yaw)` (the warm pane quad), and any shared glow-material factory. Signature: take the `objects` array + `scene` to push into (so callers own teardown). Pure three.js, no game state.

- **`festivals/christmas.js`** exports `buildChristmas(ctx)` where `ctx = { scene, world, gen, cx, cz, season, snowAccum, objects, lit, robins, kit }`. It contains the **moved, unchanged** Christmas content from `festiveLayer.build()`: the per-village fir (`buildFir`/`dressFir`/`buildPresents`), carol-singer figures (`buildCaroller`), door wreaths, candlelit window-glow, holly sprigs, robins (`buildRobin`), and the `firPlacement` helper. It pushes meshes to `ctx.objects`, flicker meshes to `ctx.lit`, and robin groups to `ctx.robins`. It does NOT handle snowmen. No gating inside — the host only calls it inside the festival window.

- **`seasonalLayer.js`** exports `class SeasonalLayer` with the SAME public interface `main.js` uses today (`constructor(scene, world)`, `update(dt, playerPos, season, snowAccum)`, `clear()`, and the mutable `center` field that callers null to force a rebuild). It owns:
  - The lifecycle from `festiveLayer`: `update()`'s flicker loop (animate `this._lit`), robin-hop loop (animate `this._robins`), the timer + rebuild-on-move/key-change gate, and `clear()`.
  - The **rebuild key** must change when any of these change: active festival id, `deepSnow(snowAccum)`, and `world.snowmanLedger.size` (so it rebuilds when a player makes/dresses/melts a snowman, as today).
  - Snowmen (MOVED from festiveLayer): `buildSnowman`, `addSnowman`, the auto-snowmen-on-greens placement (gated `deepSnow(snowAccum)`), and player-snowmen-from-ledger rendering. These run whenever `wintry(season)` (NOT tied to any festival).
  - Dispatch: `const fest = festivalState(season.yearPhase); if (fest.active) festivals[fest.active].build(ctx);` with a registry `const festivals = { yule: { build: buildChristmas } }` (more added in later slices). Build `ctx` with the shared kit + the `objects`/`lit`/`robins` arrays it animates and tears down.
  - `build(cx, cz, season, snowAccum)`: clear; if `wintry(season)` render snowmen (auto if deepSnow + ledger); then dispatch the active festival builder. Reset `this._lit`/`this._robins` from the ctx arrays each build.

- **`main.js`**: replace the `FestiveLayer` import with `SeasonalLayer`; rename the field `this.festiveLayer` → `this.seasonalLayer` everywhere (construction on world-load, the per-frame `update(...)` call, `dispose`, and the several `this.festiveLayer.center = null` snowman-interaction resets). Keep the exact `update(dt, this.player.pos, season, this.snowAccum)` call and argument order.

- [ ] **Step 1:** Read `src/festiveLayer.js` and the `festiveLayer`/`FestiveLayer` references in `src/main.js` in full. Plan the move so behaviour is preserved.
- [ ] **Step 2:** Create `festivalKit.js`, `festivals/christmas.js`, `seasonalLayer.js` per the structure above; delete `festiveLayer.js`; rewire `main.js`.
- [ ] **Step 3:** `grep -rn "festiveLayer\|FestiveLayer" src/` → only expected results (none, or a comment). `npm run build` must succeed.
- [ ] **Step 4:** `npm run verify` → all PASS (no logic regressed; the festive/festivals/season tests still pass).
- [ ] **Step 5:** Commit (atomic):
```
git add src/festivalKit.js src/festivals/christmas.js src/seasonalLayer.js src/main.js && git rm src/festiveLayer.js && git commit -m "refactor(festivals): seasonalLayer host + festivals/christmas + kit; snowmen on their own gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Season-override debug lever

A way to force the world's season to any phase/festival, so every festival (this slice's Christmas and all later ones) can be eyeballed without waiting for the real clock.

**Files:** Modify: `src/main.js` (the `setupDebug()` block that builds `moorstead.debug`), and wherever `this.season` is computed each frame.

- [ ] **Step 1:** Find where the game sets `this.season` each frame (it calls `seasonState(...)`/`seasonStateAtPhase(...)`). Add an optional override: if `this._seasonPhaseOverride != null`, use `seasonStateAtPhase(this._seasonPhaseOverride)` instead.
- [ ] **Step 2:** In `setupDebug()`, add to the `moorstead.debug` object:
  - `phase(p)` — set `G._seasonPhaseOverride = p` (or `null` to clear); returns the resulting `season.season`+active festival.
  - `festival(id)` — look up the festival's `centre` from `FESTIVALS` and call `phase(centre)`; `festival(null)` clears the override.
- [ ] **Step 3:** `npm run build` succeeds. Commit:
```
git add src/main.js && git commit -m "feat(festivals): moorstead.debug.phase/festival season-override lever for testing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Verify (controller does this, not a subagent)

- [ ] Build green, boot clean (no console errors).
- [ ] Via `preview_eval`: `moorstead.debug.festival('yule')` near a village → festive objects present in the scene; `moorstead.debug.phase(0.70)` (autumn) → Christmas dressing gone but snowmen logic intact; clear the override afterwards.
- [ ] Confirm snowman build/dress still nulls `seasonalLayer.center` (rebuild) by reading the repointed call sites.

## Self-review notes
- Public interface of `SeasonalLayer` matches what `main.js` calls on `festiveLayer` today (`update` args, `center`, `clear`, constructor) → main.js change is a rename + import swap, low risk.
- Behaviour change is intentional and isolated: dressing now gated by the festival window (host dispatch), snowmen by `deepSnow`/`wintry`. Everything else is a verbatim move.
- The debug lever is also the test harness for Slices 4–10.
