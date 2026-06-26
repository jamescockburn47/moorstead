# Festivals Slice 3 — General Fire System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development.

**Goal:** Give every torch / lantern / safety-lamp in the game a real animated flame (the proven prototype shader), via a reusable `Fire` component + a `fireLayer` overlay. This upgrades all existing fire and is the foundation the bonfire/midsummer fires build on.

**Architecture:** `src/fire.js` exports a shared flame `ShaderMaterial` (camera-billboarded quad running the domain-warped-fBm → blackbody-ramp multi-tongue shader from `prototypes/fire.html`) and a `Fire(opts)` builder returning a three.js Group of flame quads. `src/fireLayer.js` is a windowed overlay (the `floraLayer`/`seasonalLayer` idiom) that finds light-emitting blocks near the player, drops a `Fire` over each, LODs distant ones, and ticks `uTime` each frame. `main.js` constructs and updates it.

**Tech Stack:** three.js `ShaderMaterial` (same idiom as `sky.js` domeMat), vanilla ES modules. No new deps.

**Scope:** Slice 3 of the spec (§4A). Implement the **flame** fully (torches/lanterns). The `Fire` opts interface accepts `{embers, smoke, light}` for hero fires but those are implemented in Slice 7 (Bonfire) when first used — YAGNI; build the flame + the interface now. Christmas-tree candle flames are Slice 4.

---

### Task 1: `fire.js` + `fireLayer.js` + main wiring (one cohesive feature)

**Files:**
- Create: `src/fire.js`, `src/fireLayer.js`, `scripts/verify-fire.mjs`
- Modify: `src/main.js` (construct + update fireLayer), `package.json` (verify:fire + chain)

**`fire.js`:**
- `makeFlameMaterial()` → a `THREE.ShaderMaterial` with `uniforms: { uTime: {value:0} }`, `transparent:true`, `depthWrite:false`, `blending:THREE.AdditiveBlending`. Vertex shader billboards the quad toward the camera (offset the instance centre in view space by the quad corner, scaled) and passes `vUv` (0..1) + a per-quad `aSeed` attribute. Fragment shader = the multi-tongue flame from `prototypes/fire.html` (domain-warped fBm, tapering bed with per-column tongue heights, blackbody ramp white→red, additive), with `uSeed`/`aSeed` offsetting the noise so each fire differs. Reuse ONE material across all fires (the per-quad seed lives in geometry, so no material cloning).
- `Fire(opts)` where `opts = { scale=0.3, layers=1, seed=0, embers=false, smoke=false, light=false }` → a `THREE.Group` of `layers` billboard quads (PlaneGeometry with an `aSeed` attribute) using the shared flame material, sized by `scale`, positioned at the group origin (the caller places the group at the fire's world position). For `embers`/`smoke`/`light`: leave clearly-marked hooks (a comment + a no-op) — Slice 7 fills them. Group has a `dispose()` that frees its geometries (material is shared, do not dispose).
- Export `makeFlameMaterial`, `Fire`, and a `tickFlame(material, t)` helper (sets `uTime`).

**`fireLayer.js`:** `class FireLayer { constructor(scene, world); update(dt, playerPos, camera); clear(); }`
- Owns the shared flame material (one per layer instance). Each `update`: tick `uTime` (`dt` accum) EVERY frame (cheap); throttle the REBUILD (place fires) to ~every 0.3s and on player-move > a few blocks (like floraLayer).
- Rebuild = find light-emitting blocks (`B.TORCH`, `B.LANTERN`, `B.SAFETY_LAMP` — check `defs.js` for the ids + the `light:true` flag) within a radius (~32) of the player by scanning the loaded chunks/world (investigate `world.getBlock`/chunk iteration; throttle + radius keep it cheap; if the world already tracks light positions, use that). For each, place a `Fire({scale, seed: hash(x,z)})` Group at the block's top (`x+0.5, y+~0.7, z+0.5`). Torch flame small (`scale~0.3`), lantern/safety-lamp slightly different if desired.
- **LOD:** beyond ~half the radius, either skip or use a single cheap quad. **Frustum-cull** via the camera if practical. Cap the number of live fires (e.g. ≤ ~40) and `log`/note if exceeded.
- `clear()` disposes all fire groups.
- Billboarding is in the vertex shader, so no per-frame CPU rotation needed — but the material may need the camera; if the vertex billboard uses `modelViewMatrix` it's automatic.

**`main.js`:** construct `this.fireLayer = new FireLayer(this.scene, this.world)` where the other layers are built on world-load (near `floraLayer`/`seasonalLayer`); dispose it alongside them; call `this.fireLayer.update(dt, this.player.pos, this.camera)` each frame in the same place the other layers update.

**`verify-fire.mjs`** (headless — three.js scene-graph works under Node, no GL needed):
- `import * as THREE from 'three'; import { Fire, makeFlameMaterial } from '../src/fire.js';`
- Assert `makeFlameMaterial()` returns a `THREE.ShaderMaterial` with a `uTime` uniform, additive blending, `depthWrite===false`.
- Assert `Fire({scale:0.3, layers:1})` returns a `THREE.Group` (an `Object3D`) with ≥1 child mesh whose material is the shared flame material; `Fire({scale:3, layers:3})` has 3 flame quads.
- Assert each flame quad's geometry has an `aSeed` attribute.
- Assert `Fire(...).dispose` exists and runs without throwing.
- (Do NOT attempt to render — no GL context in Node. The material compiling is checked by `npm run build` + the live boot.)

**Steps:**
- [ ] Read `prototypes/fire.html` (the working shader), `src/sky.js` (the `ShaderMaterial`+uTime idiom + per-frame uniform update), `src/defs.js` (torch/lantern/safety-lamp ids + light flag), and how `floraLayer.js`/`seasonalLayer.js` are constructed + updated + disposed in `main.js`. Investigate how to enumerate placed light blocks near the player.
- [ ] Write `verify-fire.mjs` (failing), run it (fails — no fire.js).
- [ ] Implement `fire.js` to pass the headless test.
- [ ] Implement `fireLayer.js` + wire `main.js`.
- [ ] `npm run build` succeeds (the shader compiles in the real bundle). `npm run verify` (incl. new fire test) all PASS. Wire `package.json` (`verify:fire` + chain after `verify-festivals`).
- [ ] Commit:
```
git add src/fire.js src/fireLayer.js scripts/verify-fire.mjs src/main.js package.json && git commit -m "feat(fire): animated flame shader + Fire component + fireLayer over all torches/lanterns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 2: Live verify (controller)
- [ ] Build + boot clean. Place/approach a torch (or warp to a lit village/station) and confirm an animated flame renders (screenshot if the preview cooperates; else confirm via scene-graph eval that fireLayer has fire groups near a torch). Confirm perf is acceptable (no frame-time spike with several torches).

## Self-review notes
- The flame is the proven prototype shader — risk is in the port (billboard vertex shader + three.js ShaderMaterial) and the light-block enumeration/perf, not the look.
- `Fire` opts interface is forward-compatible with the bonfire (Slice 7) which sets `embers/smoke/light` + a bigger `scale/layers`.
- One shared material (per-quad seed in geometry) keeps draw setup cheap; LOD + a fire cap protect mobile.
