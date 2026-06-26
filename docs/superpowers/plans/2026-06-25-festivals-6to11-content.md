# Festivals Slices 6–11 — Festival Content Implementation Plan

> REQUIRED SUB-SKILL: subagent-driven-development. Design source: spec §5–§9, §11, §4A.

**Goal:** Build the five remaining festivals (Harvest, Bonfire, May Day, Midsummer, Easter) + their shared infrastructure (procedural bells + fire-crackle audio; the `Fire` hero features embers/smoke/light), then a polish pass. Each festival is a `festivals/<name>.js` builder registered in `seasonalLayer.js`'s `FESTIVAL_BUILDERS`, dispatched only inside its calendar window.

**Architecture:** Builders follow `festivals/christmas.js`'s shape — `build(ctx)` iterating `gen.geo.villages`, placing themed meshes via the kit + `Fire`. Audio (bells/crackle) lives in `audio.js`, triggered from `main.js` by the active festival + proximity.

## Execution batches (each = one implementer + review)
1. **Infra** — `audio.js`: `bells()` (additive church-bell partials, a peal) + `fireCrackle()` (filtered-noise bed); `fire.js`: implement the `embers`/`smoke`/`light` hooks on `Fire` (capped additive-particle embers, a soft smoke billboard column on the wind, one flickering `PointLight`); `main.js`: trigger bells when active festival ∈ {harvest, easter} near a village, fire-crackle when ∈ {bonfire, midsummer} near a village. (Spec §11, §4A.)
2. **Harvest + Bonfire** — `festivals/harvest.js` (corn stooks/sheaves on fields + green, corn dolly, chapel decked with sheaves, optional geese; spec §5) + `festivals/bonfire.js` (green-sited `Fire` at hero scale with embers/smoke/light, a "guy" effigy, optional sparse rockets; spec §6). Register both.
3. **May Day + Midsummer + Easter** — `festivals/mayday.js` (maypole + spiralling ribbons + a garland top, garlands on the stone cross; spec §7) + `festivals/midsummer.js` (hilltop `Fire` hero fires sited via `gen.height` maxima; spec §8) + `festivals/easter.js` (decorated pace-eggs on greens, chapel decked spring-white, daffodil boost; spec §9). Register all.
4. **Polish (Slice 11)** — densities/volumes/glow, window-length dials, perf pass, any trims; final review; deploy.

## Gates (every batch)
- `npm run build` passes (layers/shaders compile). `npm run verify` exits 0 (add headless structural tests where natural — e.g. a builder produces meshes for a mock village; the festival registry has all 6). Commit per batch. Builders gated by the calendar via `seasonalLayer` dispatch (already wired). Verify live via the `moorstead.debug.festival(id)` lever after deploy.

## Period accuracy (the bar)
Harvest Home/Michaelmas, Bonfire Night (guys, bonfires), May Day (Victorian-revival maypole), Midsummer (St John's hill-fires — surviving northern custom), pace-egging Easter — all in-period for c.1900 NYM. Keep props period-plausible (no plastic, no electric).
