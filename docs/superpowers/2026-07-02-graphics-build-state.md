# Graphics build state — overnight run started 2026-07-02

James approved ALL waves + the D-addendum ("lets make all these changes", full yolo,
Claude decides) plus one new item: **the horizon band** (solid colour wall where the
generated world ends below the sky dome). Branch: `feat/graphics-wow`. NO deploy — visual
quality needs James's eye (INVARIANTS rule 1); morning report + screenshots instead.

Specs: grep `### [n]` / `### [Dn]` in 2026-07-02-graphics-wow-audit.md. Codebase facts:
2026-07-02-graphics-stack-map.md. Both anchored to 422971e.

## Standing build rules (every slice)
- Plain stays byte-identical: every new effect behind a uniform defaulting 0 / Fine gate.
- ONE onBeforeCompile handler per shared material — extend addSnow/addIce handlers +
  customProgramCacheKey; never add a sibling handler.
- Determinism: world seed / shared clock (Date.now idiom); NEVER Math.random at build time,
  NEVER per-client accumulators for shared-world visuals.
- Headless-safe: verify gate imports modules under Node — no GL construction at import.
- Agents do NOT edit verify-*.mjs / package.json / commit — they return proposed verify
  assertions; orchestrator applies them serially, runs the full gate, commits per slice.
- Verify assertions are updated deliberately, never weakened to pass.

## Slice plan and status

### S1 — image floor (Wave 1) — parallel, disjoint files
- [x] S1a main.js: [28] frame-time governor + CAS + DPR-resize fix + [23] AA (FXAA default,
      MSAA headroom) + held-item texture leak fix. Agent: fable.
- [x] S1b textures.js: [12] gutter-padded mip atlas + split no-mip cutout texture. fable.
- [x] S1c mesher.js: [11] per-block hue variation + top-face UV rotation. fable.
- [x] S1d sky.js: shadow-camera texel snap (survey item) + HORIZON FIX (fog.far clamp to
      streamed chunk radius, dome bottom blends to live fog colour at horizon, fog-coloured
      skirt ring inside sky.js so the world edge dissolves). fable.

### S2 — water system (sequential: mesher.js liquid + moorsgeo + worldgen)
- [x] S2a [15]+[D0] living water + aFlow flowing becks (foundation attribute)
- [ ] S2b [16] shoreline: depth tint, foam fringe, horizon sea ring (+coast side of horizon fix)
- [ ] S2c [D4] rain-rings + [D11] spate (lift capped 0.12, mask from aFlow) + [21] freeze float
- [ ] S2d [D2] sea swell (L; shore-distance BFS field) → then [D1] weirs, [D3] storm breakers
- [ ] S2e [D5] ripples/wakes module (new file; sonnet + fable review)

### S3 — terrain/flora shader family (sequential, same addSnow handler)
- [ ] S3a [0] cloud shadows (fold into addSnow handler)
- [ ] S3b [9/17 merged] wet ground + [D6] puddles (aWet bake) + [D10] slow dry
- [ ] S3c [10]+[D14] wind sway + travelling gust fronts (shared-clock phase!) + [D8] dew
      (same GeoBuilder/crossGeom touch) + [14] snow polish (owns sparkle helper)

### S4 — sky/night/atmosphere (sky.js)
- [ ] S4a [4] 1900 night sky (seeded stars — fixes Math.random violation, Milky Way, moon
      phases, halo) + [22-mod] dawn fog tint + scratch-Color hoist
- [ ] S4b [30] rainbow + [31] aurora (dome shader)
- [ ] S4c [1] valley mist (mesher fog injection + sky drive) + [D15] summer haze
- [ ] S4d [D12] heat shimmer (grade + dome) → [D13] fire heat-haze

### S5 — light & post (main.js + new layers)
- [ ] S5a [25]+[27]+[26] living exposure/bloom/grade v2
- [ ] S5b [2] god rays (12 taps, governor-coupled)
- [ ] S5c [5] hearthlight windows (new hearthLayer.js)
- [ ] S5d [6] baked lamp light (L; mesher BFS, aLamp varying, emitter caps)

### S6 — spectacle modules (parallel where files disjoint)
- [x] [34] chimney smoke — DONE (dedicated stormChurn-style gate; plumes hash-sited on real ridge formula)
- [x] [36] forked lightning — DONE (pooled meshes; NEW sky.stormChurn flag because title flyover borrows stormPrecip)
- [x] [32] murmuration (src/birds.js) — DONE (orchestrator fixed per-client clock → Date.now shared clock; update(dt, season)); [D17] swallows still queued
- [x] [33] Whitby harbour light — DONE (sited harbour mouth 1829,3045 — East Cliff is inside Dracula arena; pier-end light is period-truer anyway)
- [ ] [D9] eave drips (new dripLayer.js) · [D16] pollen/midges (festivalKit motes)
- [ ] [19] GPU wind-slanted precipitation (sky.js; deletes CPU fall loops)
- [ ] [20] seasonal colour fronts (L) · [37] cinematic title plates

## Log
- S2a + S6 batch COMPLETE, full gate green (verify-graphics 135; verify-water 40; verify-storm 300; new verify-birds/lighthouse/chimneys). Esk visibly flows w/ downstream glitter shear (preview-confirmed, 0 console errors). Murmuration 600pts + harbour light live in-game. NOTE: cottages have NO stamped chimney block (only stations/terraces/furnace) — plume-vs-chimney alignment is a future worldgen call (world-baseline change, James decides). Next: S2b (shoreline + retire unfogged sea backdrop) ∥ S4a (night sky).
- S1 COMPLETE + full gate green (97 verify-graphics assertions; new verify-governor + verify-topvary). Horizon band root cause: meshed edge 96 blocks vs fog.far 160 — fixed w/ fog knee-clamp (clear 160→84), dome uFogBand, shadow texel snap. AA: desktop Fine=MSAA 4x, touch=FXAA, governor sheds MSAA→FXAA→res steps; DPR-resize + bloom-RT + held-item leaks fixed. Atlas mipped w/ 4px gutters + no-mip cutout twin. Per-block hue variation live. KNOWN RESIDUAL for S2b: the UNFOGGED sea backdrop plane (main.js:3436) shows as a blue streak at the fog line inland — replace with [16] fogged horizon ring. FXAA bias-100 ANGLE compile warning = stock three shader, harmless.
- 2026-07-02 late: docs committed on main (7accafb); branch created; baseline verify running.
