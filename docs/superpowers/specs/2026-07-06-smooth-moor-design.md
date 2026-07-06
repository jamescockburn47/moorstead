# The Smooth Moor — opt-in realistic world (design spec)

**Date:** 2026-07-06
**Status:** Approved design, pre-plan
**Origin:** Brainstormed in the Spire (Moot) session; applies the Spire Stage 3–5 render
programme and the LAAS v2 enforcement method to Moorstead.

## 1. Goal

One new world — "the Smooth Moor" — entered by choice, rendering the same procedural
Victorian North York Moors as continuous realistic landscape (WebGPU, TSL materials,
full post stack) instead of blocks. The existing blocky game is **not replaced and not
visually altered**: every current world keeps today's pipeline byte-identical.

## 2. Decisions taken (with alternatives rejected)

1. **Scope: full de-blockify in the new world** — smooth terrain geometry, not just
   realistic lighting on blocks. (Rejected: lighting-only "Minecraft RTX" register;
   rejected: replacing the blocky game.)
2. **Mechanics: sculpt terrain + blocky-crafted buildings.** Dig/place survive as
   voxel edit ops rendered as smooth sculpting; crafted structures stay rectilinear
   with realistic materials. (Rejected: smoothing structures — melted cottages;
   rejected: retiring editing.)
3. **Sequencing: pipeline first.** Renderer flip on blocky meshes first, smooth
   mesher lands into a working realistic pipeline. (Rejected: geometry-first — tunes
   terrain under lighting about to be replaced; rejected: big-bang — no fault
   isolation.)
4. **Delivery: opt-in world, not a tier or a cutover.** No `minClientVersion` bump
   for existing players.

## 3. Product shape

- Title screen gains a "Smooth Moor" entry alongside "Carry On" / "New Single-Player
  World" (entry plumbing near `main.js` `newWorld()` / title wiring ~`main.js:1118`).
- Single-player first; later a dedicated relay room makes it joinable in multiplayer.
  Relay/brain/dashboard need **zero changes** — it is one more room.
- Same worldgen, same seed discipline, same period register (~1900, no fantasy).

## 4. Architecture — pipeline selected at world entry

One client bundle, two render paths:

| | Classic path (all existing worlds) | Realism path (Smooth Moor only) |
|---|---|---|
| Renderer | `WebGLRenderer` + `onBeforeCompile` injections, exactly as today | `WebGPURenderer`: WebGPU backend (high tier) / `forceWebGL` backend (its Plain) |
| Materials | current mesher materials | TSL node materials (compile to WGSL and GLSL) |
| Meshing | culled-face block mesher | dual mesher (§5) |
| Post | current composer | CSM shadows, GTAO, TRAA, ToD grade (tier-gated) |

- The realism path is **dynamically imported** — fetched only on entering the Smooth
  Moor, so the blocky game's load cost is unchanged.
- **Shared, unchanged:** voxel world data, worldgen, chunk streaming, save format,
  network protocol, edit ops, entities/NPC logic, audio, gameplay systems.
- Entity/NPC meshes are `MeshLambertMaterial` primitives — auto-converted by
  `WebGPURenderer`'s node system; no port required. Entity systems with custom
  shader injections get TSL equivalents in the realism path only.
- **The one global change:** three.js `0.166 → 0.184` (pinned, matching the Spire /
  LAAS THREE-NOTES pins). The classic path must survive this with the full verify
  gate green before anything else is built (Stage 0). Known breakage surface: the
  `onBeforeCompile` shader-chunk injections in `src/mesher.js` (snow wash, glint,
  cloud shadows) — chunk names drift between 0.166 and 0.184.

## 5. Geometry — the dual mesher

**Terrain (smooth):** voxel columns → signed density field → **surface nets**
(dual-contouring family) per chunk. Cross-chunk seam stitching; distance LOD with
crack-free transitions. Digging/placing remain integer voxel edit ops (same protocol,
same save format); the re-mesh renders an edit as smooth sculpting — a dug hollow
reads as a peat cutting, not a cube hole.

**Structures (rectilinear):** crafted blocks and village buildings keep a block
mesher evolved for realism — stone/timber/pantile TSL materials, bevelled edges, trim
geometry, roof treatment. Cottages read as Victorian cottages.

**Classification:** terrain-vs-structure decided per block id (natural materials
smooth; placed/structural ids rectilinear), one table in `defs.js` register style.

**Collision:** derived from the smooth surface, deterministically from the same voxel
data — every client in the Smooth Moor agrees. Blocky worlds keep blocky collision;
no cross-world parity issue because they are different worlds. Block targeting
(raycast) in the Smooth Moor maps surface hits back to voxel coordinates.

## 6. Light, materials, atmosphere

- Post stack transplanted from the Spire with its 0.184 pin traps pre-solved: PCSS
  blocker search must use sampler-free `textureLoad` (compare-function depth textures
  return a constant from sampled reads); the post stack boots **without MSAA** (TRAA
  supersedes it; multisampled depth cannot copy-resolve).
- GTAO re-scaled for moorland vista range (the Spire's 12-sample/0.9 m interior
  tuning does not transfer; start from LAAS's terrain-range constants and delta-loop).
- Terrain TSL splat materials: heather, peat, moor grass, limestone, bracken —
  procedural, no texture assets.
- `src/veg` vendored **verbatim** from the Spire (renderer-agnostic, all procedural)
  for heather/gorse/grass/trees, replacing cutout billboard crosses in the Smooth
  Moor. Keep LAAS roughness 0.8/spec 0.3 (the silver-frond trap).
- Becks and sea: TSL water (transmission exposes geometry shortcuts — fix geometry,
  not optics).
- Sky ports to TSL as the Spire's did; stars/rain/snow become instanced sprites
  (WebGPU renders `THREE.Points` at a fixed 1 px).
- All content remains procedural — **no asset files** (INVARIANTS holds).

## 7. Enforcement — LAAS v2 method, Moorstead register

- **References:** committed photographic set — North York Moors, Whitby, Goathland,
  ~1900-plausible landscape register. Live at `docs/reference/smooth-moor/`.
- **Harness:** dev-only screenshot sink (the Spire `/__shot` POST pattern) before any
  visual tuning. Never tune blind.
- **Delta loop:** every visual stage closes via side-by-side vs references →
  `DELTA.md` top-ten differences → fix top three → re-shoot.
- **Bar doc:** `docs/superpowers/specs/2026-07-06-smooth-moor-visual-bar.md` (written
  at Stage 0) — pillars, numeric floors (under-rendering = failure), banned outcomes
  (e.g. plastic heather, silver fronds, cube-hole edits, LOD cracks, fantasy
  elements).
- **Verify scripts:** headless guards in the existing `scripts/verify-*.mjs` culture —
  mesh manifoldness, chunk-seam continuity, collision-mesh determinism (same seed →
  identical mesh hash), realism-path boot on both backends, classic-path
  byte-identity where testable.

## 8. Staging

| Stage | Delivers | Gate |
|---|---|---|
| 0 | Branch; three 0.184 pin; classic path green; screenshot harness; reference set; visual bar doc | full verify gate |
| 1 | Smooth Moor entry plumbing; realism path renders existing **blocky** meshes via WebGPURenderer/TSL; both backends | world enterable on both backends |
| 2 | Post stack (CSM, GTAO, TRAA, ToD grade), tier-gated | delta round 1 |
| 3 | Surface-nets terrain + LOD + collision + sculpt edits; rectilinear structure mesher | mesh verify scripts + delta round |
| 4 | Terrain splats, LAAS veg, TSL water, TSL sky | delta rounds |
| 5 | Delta-loop rounds to the bar; open the world (title entry live) | self-score vs references |

Each stage is independently shippable to main behind the entry flag (the Smooth Moor
button can stay hidden until Stage 5).

## 9. Risks

1. **The 0.184 upgrade under the classic path** is the only step that can hurt
   production. It is first, isolated, and gated on the full verify suite plus manual
   Fine/Plain screenshots.
2. **Surface-nets LOD seams and determinism** are the hardest new engineering —
   nothing in the Spire covers chunk-streamed smooth terrain. Genuinely new work.
3. **Performance:** smooth terrain triangle counts exceed greedy-meshed blocks;
   budget via LOD and the tier system. Numeric floor: 60 fps at 1080p on the dev
   machine's WebGPU tier at default view distance, else the stage does not close.
4. **Bundle weight:** two pipelines; mitigated by dynamic import (realism path is
   not in the entry chunk — verify script checks the entry-chunk size).
5. **Sculpt-edit ↔ voxel-op fidelity:** an integer voxel edit must produce a
   locally-intuitive smooth change; if surface nets alone read poorly at edit sites,
   allow a per-edit density bias — still deterministic, still protocol-compatible.

## 10. Invariants compliance

- Additive protocol: unchanged (edits remain voxel ops; the Smooth Moor is a room).
- Append-only content, forward-refuse saves: save format untouched.
- Plain fallback: inside the Smooth Moor, the `forceWebGL` backend is its Plain;
  the blocky game's Plain is untouched.
- Determinism: mesh + collision derive deterministically from voxel data (hash-gated).
- Resource hygiene: realism path disposes fully on world exit.
- Procedural-only identity: all new materials/veg are code, no asset files.

## 11. Out of scope

- Replacing or restyling the blocky game.
- Multiplayer opening of the Smooth Moor (plumbing designed for it, but launch is
  single-player; the relay room is a follow-on).
- NPC brain, relay, dashboard changes.
- Smoothing crafted structures.
