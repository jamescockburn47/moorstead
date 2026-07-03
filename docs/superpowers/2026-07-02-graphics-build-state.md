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
- [x] S2b [16] shoreline: depth tint, foam fringe, horizon sea ring (+coast side of horizon fix)
- [ ] S2c [D4] rain-rings + [D11] spate (lift capped 0.12, mask from aFlow) + [21] freeze float
- [ ] S2d [D2] sea swell (L; shore-distance BFS field) → then [D1] weirs, [D3] storm breakers
- [ ] S2e [D5] ripples/wakes module (new file; sonnet + fable review)

### S3 — terrain/flora shader family (sequential, same addSnow handler)
- [x] S3a [0] cloud shadows (fold into addSnow handler)
- [x] S3b [9/17 merged] wet ground + [D6] puddles + [D10] slow dry + mud lanes — DONE
- [x] S3c [10]+[D14] wind sway + gust fronts + [D8] dew + [14] snow polish — DONE
      (same GeoBuilder/crossGeom touch) + [14] snow polish (owns sparkle helper)

### S4 — sky/night/atmosphere (sky.js)
- [x] S4a [4] 1900 night sky (seeded stars — fixes Math.random violation, Milky Way, moon
      phases, halo) + [22-mod] dawn fog tint + scratch-Color hoist
- [x] S4b [30] rainbow + [31] aurora — DONE (both drive helpers exported pure; aurora ~10-game-day shared clock)
- [ ] S4c [1] valley mist (mesher fog injection + sky drive) + [D15] summer haze
- [ ] S4d [D12] heat shimmer (grade + dome) → [D13] fire heat-haze

### S5 — light & post (main.js + new layers)
- [x] S5a [25]+[27]+[26] living exposure/bloom/grade v2 — DONE
- [ ] S5b [2] god rays (12 taps, governor-coupled)
- [x] S5c [5] hearthlight windows (hearthLayer.js) — DONE
- [ ] S5d [6] baked lamp light (L; mesher BFS, aLamp varying, emitter caps)

### S6 — spectacle modules (parallel where files disjoint)
- [x] [34] chimney smoke — DONE (dedicated stormChurn-style gate; plumes hash-sited on real ridge formula)
- [x] [36] forked lightning — DONE (pooled meshes; NEW sky.stormChurn flag because title flyover borrows stormPrecip)
- [x] [32] murmuration (src/birds.js) — DONE (orchestrator fixed per-client clock → Date.now shared clock; update(dt, season)); [D17] swallows still queued
- [x] [33] Whitby harbour light — DONE (sited harbour mouth 1829,3045 — East Cliff is inside Dracula arena; pier-end light is period-truer anyway)
- [x] [D9] eave drips (dripLayer.js) DONE · [D16] pollen/midges (festivalKit motes)
- [x] [19] GPU wind-slanted precipitation — DONE (CPU loops deleted, ~40KB/frame uploads gone; wind+squall shared-clock; streak lean via map.rotation not object rotation; winterPrecip pooled)
- [ ] [20] seasonal colour fronts (L) · [37] cinematic title plates

## RESUME LOG (day 2)
- EVO FOLLOW-UP (server-side, pending): roster_sim can emit walk legs crossing open sea — client now hides streamed NPCs grounded on sub-sea columns (roster.js _subSea, James 2026-07-03); proper fix is keeping waypoints on land in roster_sim (clamp legs to coastline or route via road graph), then relax the client guard.
- STOPPED + DEPLOYED on James's instruction: merged a899faf to main, deployed **v1.1.19**
  (verify:live 18/18 green; pre-deploy GL probe: 72 programs, 0 broken). S2c (rain-rings/
  spate/freeze-float), D16 (midges), D17 (swallows) were killed MID-EDIT and their partial
  tree changes DISCARDED — re-run each cleanly from the audit specs; none of their work is
  in the deploy. Remaining queue otherwise unchanged: S2d/e, S4c/d, S5b/d, [20], [37].
- BATCH 2 (S3c+S5a+hearth+drips): flora sway+gust fronts (shared-clock), dew/after-rain glisten (+bilberry-glint bug fixed), snow polish; living exposure/bloom/grade v2; lit cottage windows; eave drips. TWO REAL shader bugs found via preview (headless gate blind to them): (1) uGlintTime redefinition — non-idempotent onBeforeCompile double-injected on recompile; fixed w/ sentinel-marker guard that still re-binds uniforms. (2) water fresnel used vNormal (flat-strippable varying, latent since S2a) → live compile fail; fixed to normal at opaque_fragment + regression-guard assertion. Both preview-confirmed (terrain+water render, probe shows fixed code). Gate green. NOTE: preview console tool buffers stale errors across reloads — trust the render+probe, not the buffer.
- S3b wet ground (darken + puddles in hollows + slow-dry + mud lanes) + S4b rainbow/aurora COMMITTED. Gate green 231 graphics + verify-wetground. Preview-confirmed: wet darkening reads, double bow renders (PALE — brighten literal for James), aurora curtains render but SUBTLE on moonlit night (raise 1.6 gain), night sky lovely, 0 console errors. Fixed stale aurora-cadence comment.

## MORNING REPORT (overnight run ended — session token limit, resets ~01:40)

**Where it stopped:** 5 clean commits on `feat/graphics-wow`, tree clean, **full gate green
(184 graphics assertions + all ~62 scripts, exit 0)**, nothing deployed (per your standing
rule — visual quality is your eye to sign off). The last two agents (S3b wet-ground, S4b
rainbow/aurora) were killed by the token limit BEFORE writing anything, so the tree has no
half-finished edits — it's safe to resume or ship as-is.

**Shipped tonight (14 major items), in order:**
1. **Your horizon band — FIXED.** Root cause: world meshes to 96 blocks but clear-weather fog
   ran to 160, so edge terrain was only ~47% fogged against a fully-coloured dome — that
   half-dissolved silhouette was the "solid block of colour". Fix: fog knee-clamped inside the
   meshed edge (clear 160→84), dome holds the fog colour at the horizon, and later the UNFOGGED
   sea-backdrop plane (a second offender, a blue streak from the tops) was deleted for a fogged
   horizon sea ring. Confirmed gone from T' High Moor in every direction.
2. Anti-aliasing (MSAA 4x desktop / FXAA touch) — the single biggest image-quality lift.
3. Frame-time governor (sheds MSAA→FXAA→resolution under load) + CAS sharpen + the cross-monitor
   DPR bug + two texture leaks fixed.
4. Mip-mapped atlas with gutters — kills the distance shimmer/sparkle.
5. Per-block hue variation — the moor stops reading as wallpaper.
6. Living water: the Esk visibly FLOWS downstream with glitter, ripple, depth-tinted shallows.
7. Coast: foam fringe at the sand, depth-darkened deep sea, sea to the horizon.
8. 1900 night sky: seeded stars (fixed a real determinism bug), Milky Way, moon phases + halo.
9. Cloud shadows sweeping the moor, locked to the dome clouds.
10. GPU precipitation: rain/snow now lean in the real Goathland wind with squall bands — and it
    DELETED the biggest per-frame CPU cost in the game (net faster).
11. Forked lightning for the Dracula storm (pooled, seeded).
12. Starling murmuration at dusk (600 birds, autumn/winter).
13. Whitby harbour light with a sweeping beam.
14. Chimney smoke from cottages on cold mornings.
Plus: shadow-edge texel snap, dawn-glow fog, sky.update() made allocation-free.

**To SEE it:** dev server on 5173, "New Single-Player World". Best shots: a hilltop at dusk
(night sky + cloud shadows), the Esk west of Grosmont (flowing water), the Whitby strand
(coast + harbour light), and force rain anywhere for wind-slant + puddle darkening on the
ground. Toggle Fine/Plain in the pause menu to see the AA difference.

**Eyeball checklist (things I tuned by numbers, not your taste):** cloud-shadow patch size
(subtle from ground, best from the tops), Milky Way strength, moon terminator orientation,
foam texture density, deep-sea darkness at dusk, glitter not blooming hot at noon. All have
single-literal dials noted in each commit.

**Known non-issues:** cottages have no stamped chimney block (smoke is hash-placed on the roof
ridge — a future worldgen-baseline call, yours); FXAA emits one harmless ANGLE shader warning.

**To resume (queue in order):** S3b wet-ground/puddles, S3c sway+gust+dew, S4b rainbow+aurora,
S4c/d mist+heat-shimmer, S5 living-light/god-rays/hearthlight/baked-lamp-light, S6 stragglers
(drips, midges, swallows, seasonal fronts, title plates). Each spec: grep `### [n]`/`### [Dn]`
in the audit doc. Standing build rules at the top of this file. NOT deployed — `npm run deploy`
is your call after you've looked.

## Log
- OVERNIGHT END: tree clean at 3e807c8, gate green, 5 commits. S3b+S4b agents killed by token
  limit pre-edit (no partial state). Waves 3b-onward remain; see MORNING REPORT above.
- BATCH COMMIT (S2b+S4a+[19]+S3a): shoreline+horizon sea ring (unfogged seaPlane DELETED), 1900 night sky (stars seeded — determinism regained; Milky Way; moon phases+halo; dawn fog tint; sky.update allocation-free), GPU precipitation (net-negative cost, wind-slanted, squall bands), cloud shadows (dome-locked drift, cross-file coupling asserted). verify-graphics 184; verify-precip 29 new; verify-shoreline 29 new. Full gate green.
- S2b DONE (uncommitted): depth tint (pure waterDepthTint, no shader change), foam fringe TILE.FOAM=87 +0.01 above surface cap 32, GeoBuilder aGlint array (baked only when nonzero — parity), fogged horizon sea ring replaces the UNFOGGED seaPlane (DELETED — blue streak confirmed gone from High Moor in preview). verify-shoreline.mjs 29 asserts; graphics 135→150. S4a DONE (uncommitted, assertions PENDING assembly): buildStarField seeded (determinism fixed), Milky Way GPOLE band, moon phases+halo (owns halo), dawn fog tint via single _fogC owner, sky.update() now ALLOCATION-FREE. S4a proposed asserts are in its task output — assemble with [19]s when it lands, then commit batch.
- S2a + S6 batch COMPLETE, full gate green (verify-graphics 135; verify-water 40; verify-storm 300; new verify-birds/lighthouse/chimneys). Esk visibly flows w/ downstream glitter shear (preview-confirmed, 0 console errors). Murmuration 600pts + harbour light live in-game. NOTE: cottages have NO stamped chimney block (only stations/terraces/furnace) — plume-vs-chimney alignment is a future worldgen call (world-baseline change, James decides). Next: S2b (shoreline + retire unfogged sea backdrop) ∥ S4a (night sky).
- S1 COMPLETE + full gate green (97 verify-graphics assertions; new verify-governor + verify-topvary). Horizon band root cause: meshed edge 96 blocks vs fog.far 160 — fixed w/ fog knee-clamp (clear 160→84), dome uFogBand, shadow texel snap. AA: desktop Fine=MSAA 4x, touch=FXAA, governor sheds MSAA→FXAA→res steps; DPR-resize + bloom-RT + held-item leaks fixed. Atlas mipped w/ 4px gutters + no-mip cutout twin. Per-block hue variation live. KNOWN RESIDUAL for S2b: the UNFOGGED sea backdrop plane (main.js:3436) shows as a blue streak at the fog line inland — replace with [16] fogged horizon ring. FXAA bias-100 ANGLE compile warning = stock three shader, harmless.
- 2026-07-02 late: docs committed on main (7accafb); branch created; baseline verify running.
