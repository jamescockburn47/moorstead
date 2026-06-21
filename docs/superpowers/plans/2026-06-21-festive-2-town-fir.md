# Festive Winter Plan 2 — The town fir

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A large 3D fir (~twice house height) stands on each village green in winter only — snow-dusted, dressed Victorian-style with **lit candles**, baubles, an evergreen **garland** and a **star** on top, with **present boxes** at its base. Gone by spring.

**Architecture:** The fir + ornaments + presents are built by the existing `festiveLayer` (winter-gated, windowed, deterministic, no world writes). The fir is a blocky stacked-tier conifer of instanced leaf-cubes + a trunk. "Lit" candles/star use **unlit `MeshBasicMaterial`** (warm, always-bright — reads as candlelight without a lighting engine), gently flickering. One fir per village green, offset from the central stone cross. Period-accurate (candles, greenery — no electric lights).

**Tech Stack:** vanilla ES modules, three.js (instanced cubes + Group meshes), Node `.mjs` verify.

Plan 2 of 4 for the festive-winter spec ([2026-06-21-festive-winter-design.md](../specs/2026-06-21-festive-winter-design.md)). Builds on Plan 1's `festiveLayer.js` (lifecycle, `addSnowman`/`buildSnowman`, the per-village loop, `clear()` with geometry+material dispose), `festive.js` (`festiveActive`), and `geography` (villages + `villageColumn`). Setting is **Victorian**.

## File structure

- `src/festiveLayer.js` — add `buildFir(seed)`, `firPlacement(village)`, ornament + present builders; render one fir per village in winter; flicker in `update`.
- `src/festive.js` — (optional) a pure `firCellFor(village)` helper if it keeps placement testable.
- `scripts/verify-festive.mjs` — extend with deterministic fir-placement assertions if a pure helper is added.

## Verification note

The fir/ornaments/presents are visual — verified via the `window.game` drive (build the layer at a village in winter, count/inspect objects, confirm gone in summer, no console errors). Any pure placement helper is unit-tested.

---

### Task 1: The fir — blocky 3D conifer, winter-only, per village green

**Files:** Modify `src/festiveLayer.js`. Visual.

- [ ] **Step 1: Fir builder** — add `buildFir()` returning a `THREE.Group`: a short trunk (a 1×~2×1 stack of brown `LOG`-coloured cubes, `MeshLambertMaterial({color:0x5a4326})`) and a **blocky stacked-tier conifer** of green leaf-cubes (`MeshLambertMaterial({color:0x2f5d3a})`) — e.g. 4–5 square tiers of decreasing half-width (base ~3 → tip 0) stacked up to a total height of **~11 blocks** (≈ twice a 5-block cottage). Build the tiers from instanced cubes or a modest set of boxes (keep it a few dozen meshes max). **Snow-dust** the upper faces (a lighter `0xdfeaf2` tint on the top tier / top faces) so it reads snowy. Feet at the group origin (y=0).
- [ ] **Step 2: Placement** — add `firPlacement(v)` → a deterministic green cell near the centre, **offset from the cross** at `(v.x, v.z)` (e.g. a few blocks along the green where `villageColumn(x,z).kind === 'green'|'closes'` and the surface is clear); return `{x, z}` or null if no clear green cell. Keep it stable per seed.
- [ ] **Step 3: Render in `build()`** — in `festiveLayer.build()`, when `festiveActive(season)`, for each village within `RADIUS`, compute `firPlacement(v)`, build the fir, set its position to that cell's surface (`gen.height(x,z)+1`), add to the scene + `this.objects`. (No deep-snow gate — the fir is the whole-winter centrepiece.)
- [ ] **Step 4: Build + live check** — `npm run build` (exit 0). Drive the game: teleport to `villages[0]`, `game.seasonOverride=0.875`, `game.festiveLayer.build(cx,cz,game.season,game.snowAccum)` → a fir Group exists near the centre (inspect `festiveLayer.objects` for a tall green group; check its bounding height ≈ 11); `game.seasonOverride=0.375` + rebuild → no fir (summer). No console errors. Report what you found.
- [ ] **Step 5: Commit** — `git add src/festiveLayer.js && git commit -m "feat(festive): winter-only 3D town fir on each village green"` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 2: Ornaments — lit candles, baubles, garland, star

**Files:** Modify `src/festiveLayer.js`. Visual.

- [ ] **Step 1: Lit material** — candles + star use **`MeshBasicMaterial`** (unlit → always bright, reads as glowing): warm candle `0xffdf8a`, star `0xfff2b0`. Baubles use `MeshLambertMaterial` in a few festive colours (`0xb23b3b` red, `0x2f6e4f` green, `0xc9a13b` gold). Garland is `MeshLambertMaterial({color:0x244d2e})` (dark evergreen).
- [ ] **Step 2: Dress the fir** — in `buildFir()` (or a `dressFir(group)` it calls), add as children, deterministically placed on the cone surface:
  - **Candles:** ~8–12 small warm cones/cylinders (MeshBasicMaterial) dotted over the tiers — these are the "lit" Victorian candles.
  - **Baubles:** ~8–12 small coloured spheres among the branches.
  - **Garland:** an evergreen swag — a descending helix/band of small dark-green cubes or a torus tilted around the cone.
  - **Star:** a warm-glowing star at the very top (a small star/octahedron in star-material).
  Keep ornament counts modest; tag the candle + star meshes (e.g. `mesh.userData.flicker = true`) so Task 4 can flicker them.
- [ ] **Step 2b:** ensure `clear()` still disposes these (Plan 1's `clear()` traverses + disposes geometry + material — confirm new ornament meshes are children of the fir group so they're caught).
- [ ] **Step 3: Build + live check** — `npm run build`. Dev server in winter at a village: the fir shows candles (bright/warm), baubles, a garland, and a star on top. Eval: the fir group has child meshes incl. some with `userData.flicker`. No console errors.
- [ ] **Step 4: Commit** — `git add src/festiveLayer.js && git commit -m "feat(festive): Victorian fir ornaments — lit candles, baubles, garland, star"` + trailer.

---

### Task 3: Presents at the base

**Files:** Modify `src/festiveLayer.js`. Visual.

- [ ] **Step 1: Present boxes** — add a `buildPresents()` (or extend the fir group): a small cluster (~4–6) of little decorated boxes at the fir base — `BoxGeometry` cubes in festive colours (`MeshLambertMaterial`) with a contrasting **ribbon** (a thin crossing band — two thin boxes or a tinted stripe), sizes ~0.4–0.6, scattered + lightly rotated deterministically around the trunk on the ground.
- [ ] **Step 2: Build + live check** — `npm run build`. Winter at a village: present boxes sit at the foot of the fir. Eval: the fir/festive objects include the present meshes. No console errors.
- [ ] **Step 3: Commit** — `git add src/festiveLayer.js && git commit -m "feat(festive): present boxes beneath the town fir"` + trailer.

---

### Task 4: Candle flicker + verify

**Files:** Modify `src/festiveLayer.js`; (maybe) `src/festive.js`, `scripts/verify-festive.mjs`, `package.json`.

- [ ] **Step 1: Flicker** — in `festiveLayer.update(dt, ...)` (which runs each frame, before the early-out), gently flicker the candle/star meshes: keep a `this._lit = []` list (populated in `build()` from meshes with `userData.flicker`) and each frame nudge their material colour/`emissiveIntensity` or scale by a small time-based wobble (e.g. `0.85 + 0.15*sin(t*6 + i)`), so candlelight breathes. Use a frame-time accumulator (`this._t = (this._t||0)+dt`); don't rely on `Date.now`. Keep it cheap; skip when no lit meshes.
- [ ] **Step 2: (Optional) pure placement test** — if `firPlacement`/a `firCellFor` helper is pure, add a determinism assertion to `scripts/verify-festive.mjs` (same village ⇒ same fir cell). If placement is entirely inside `festiveLayer` (three.js), skip and note it's covered by the live check.
- [ ] **Step 3: Build + verify** — `npm run build` (exit 0); `npm run verify` (green). Dev server: the candles + star visibly flicker/breathe in winter; everything still tears down on reload (no leak/errors).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(festive): candlelight flicker on the town fir"` + trailer.

---

## Self-Review

**Spec coverage (Plan 2 slice):** winter-only 3D fir per village green ✓ T1; lit candles + baubles + garland + star ✓ T2; presents ✓ T3; candle flicker ✓ T4. Snowmen were Plan 1; atmosphere/carol/Merlin are Plan 3.

**Placeholder scan:** the fir/ornaments/presents are inherently visual — tasks give concrete structure (tier counts, colours, materials, placement) + explicit live checks; the "lit via MeshBasicMaterial" approach is fully specified (no shader needed). Any pure helper is tested; otherwise the live drive is the gate.

**Type/name consistency:** `buildFir`/`firPlacement`/ornament + present builders all live in `festiveLayer.js` and are called from its `build()`; flicker reads `userData.flicker` meshes collected in `build()` and animated in `update()`. Reuses Plan 1's `festiveActive`, the per-village loop, and `clear()` (now disposes materials too).

**Open risks (validate during execution):**
- **Mesh budget:** a blocky fir + ornaments per village × up to ~2 villages in window — keep the fir to a few dozen meshes (instance the leaf-cubes if needed); confirm no frame hitch on rebuild. Plan 4 can instance/optimise if heavy.
- **Lit look:** `MeshBasicMaterial` is unlit so candles/star read bright day + night (period-accurate candlelight) — confirm it doesn't look odd in daylight; tune the warmth if so.
- **Fir vs cross/buildings:** `firPlacement` must land on an open green cell clear of the cross + buildings; confirm each of the 7 villages gets a clear spot (fall back to the nearest clear green if the first offset is blocked).
- **Teardown:** ornaments/presents are children of the fir group so Plan 1's `clear()` disposes them — confirm; the flicker list must be rebuilt on each `build()` and not retain stale meshes after `clear()`.
- **Snow dust vs deeper-snow shader:** the fir is a festiveLayer mesh (not chunk geometry), so the mesher snow shader doesn't touch it — its snow-dust is baked into the fir materials/top tier. Confirm it reads snowy without the shader.
