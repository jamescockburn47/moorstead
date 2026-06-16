# Atmosphere Cluster — Design Spec

**Status:** approved design, pre-plan
**Date:** 2026-06-16
**Scope owner:** James / Claude (hand-built; no M3 auto-coder in this cluster)
**Backlog context:** First slice of the Moorstead improvement backlog. Cadence chosen: split-with-M3 overall, but this cluster is built by hand (mostly locked-file engine work). Cluster chosen first because it is high feel-per-line, low-risk, and almost entirely client-side.

---

## 1. Summary

Make the moor feel like a living place through four composable environmental layers plus light wildlife behaviour:

1. **Seasons** — a long aesthetic rhythm (palette, heather bloom, snow-line) on an accelerated ~1-real-day-per-season cycle.
2. **Live weather** — the game's sun/cloud/rain/fog reflects the *actual* current weather over the real North York Moors, in real time.
3. **Soundscape** — deepen the existing procedural audio with a beck bed, a tap-room pub bed, a distant train whistle, and a season-aware call mix.
4. **Wildlife behaviours** — spring lambing, grouse drumming, barghest dawn-prints, seasonal spawn weighting.

Plus one **gameplay hook**: bilberries only bear in late summer.

**Cross-cutting guarantees:**
- **Zero relay/Python/server change.** Everything is client-side. Mobs are already client-simulated (not relayed); season and weather derive from a globally-shared source so all clients agree without coordination.
- **No secrets, no API keys.** The weather source is keyless.
- **Graceful degradation.** The one external dependency (weather API) falls back silently to the existing random weather machine; the game stays fully self-contained and works offline.
- **Seasons and weather are independent layers** (per the explicit decision to tie weather to reality "disregarding seasons"). They compose; they do not drive each other in v1.

---

## 2. Core principle — shared environment without coordination

Moorstead already has a precedent for a *shared, every-player-agrees* environmental effect that needs no server coordination: the **Great Fog** ([sky.js:185-200](../../../src/sky.js)) derives its whiteout deterministically from `Date.now()` (UTC wall-clock), with a comment noting it is "the same for every player, like the train."

Both new environmental clocks reuse this idiom:

- **Season** = a pure function of `Date.now()`. Every client (and Merlin, if ever needed) computes the identical season. The local `this.day` counter in [sky.js:20](../../../src/sky.js) is **per-client and must not be used** — it differs between players depending on when they started.
- **Live weather** = a pure function of (Open-Meteo's hourly data for a fixed point) indexed by the **current UTC hour**. Any client fetching anytime within an hour selects the same hourly sample → exact agreement, not approximate.

This keeps the shared multiplayer moor visually consistent with no new server state.

---

## 3. Scope

### In scope (v1)
- Season clock module + named seasonal scalars.
- Seasonal sky/light modulation, global vegetation atlas re-tint, height-gated snow on the tops (shader).
- Live weather fetch + mapping + graceful fallback, driving the existing weather pipeline.
- Soundscape: beck bed, tap-room pub bed, distant train whistle, season-aware call mix, coast wave bed.
- Wildlife: natural spring lambing, grouse drumming (spring dawn), barghest dawn-prints, seasonal spawn weighting.
- Bilberry seasonality (yield gated to late summer).

### Non-goals (explicitly deferred)
- **Deep husbandry / farming** (kept sheep, shearing, milk, breeding mechanics) → later Progression track.
- **Lambing as a husbandry mechanic** (raising/selling lambs). v1 lambing is ambient atmosphere only.
- **Snow as placed blocks / accumulation / movement effects.** v1 snow is a visual material tint only.
- **Seasonal daylight-length variation** (true solar declination). v1 keeps the existing `this.time`-based sun arc; seasons tint palette/light but do not change day length.
- **Weather↔season crossover** (real snow rendered as sleet in game-winter). Possible later toggle.
- **Per-player or geolocated weather.** Fixed moor location only.
- **Relay-broadcast weather.** Client-side fetch only (decided).

---

## 4. Pillar 1 — Season clock (`src/season.js`, new)

A small **pure module**, no THREE dependency, headlessly testable in the style of [noise.js](../../../src/noise.js) and [geography.js](../../../src/geography.js).

### Interface
```js
seasonState(now = Date.now()) => {
  yearPhase,      // [0,1): 0 = start of spring → .25 summer → .5 autumn → .75 winter
  season,         // 'spring' | 'summer' | 'autumn' | 'winter'
  seasonT,        // [0,1) progress within the current season
  heatherBloom,   // 0..1, Gaussian peak in LATE summer (~yearPhase .45; "August" per lore.js:84)
  snowiness,      // 0..1, peak in deep winter
  greenness,      // 0..1, spring flush high, winter low — drives grass tint
  warmth,         // -1..1, palette temperature (summer warm, winter cold)
}
```

### Parameters
- `YEAR = 4 * 86400` seconds (4 real days; 1 season ≈ 1 real day).
- `yearPhase = ((now/1000) / YEAR) % 1`, with a fixed launch offset so that "now" (mid-June) reads early-summer at first deploy, then cycles. The offset is a single constant; it does not affect determinism.
- All derived scalars are smooth (no hard pops at season boundaries) so tints crossfade.

### Consumers
Every consumer reads the **named scalars** and never recomputes the phase. Consumers: `sky.js`, `textures.js`, `audio.js` (via `main.js`), `entities.js` (via `main.js`), and the bilberry forage path in `main.js`.

### Test
`scripts/verify-season.mjs` added to `npm run verify`: asserts season boundaries, monotonic/bounded scalars, bloom peak in late summer, snow peak in deep winter, and determinism (same `now` → same output).

---

## 5. Pillar 2 — Visual seasons

### 5a. Sky & light (`src/sky.js`)
`sky.js` imports `seasonState` and, inside its existing `update()`, modulates:
- The `SKY` palette ([sky.js:9-14](../../../src/sky.js)) — summer warmer, winter steel-grey, spring soft, autumn golden dusk — blended via `warmth`/`greenness`.
- `sun`/`ambient` colour and intensity nudge by season.
- Weather odds skew by season (winter biases toward fog/rain; see also live weather, which normally overrides the random pick).

This slots into the existing colour-composition block ([sky.js:169-201](../../../src/sky.js)); the Great Fog and dread overrides remain layered on top unchanged.

### 5b. Global vegetation tint (`src/textures.js`)
The terrain atlas tiles are procedurally generated in `textures.js`. Add a **seasonal re-tint** of the vegetation tiles (heather, grass, bracken, gorse, fern):
- Heather → **purple at late-summer bloom** (`heatherBloom`), brown in winter — delivering "the whole moor goes purple at once" ([lore.js:84](../../../src/lore.js)).
- Bracken → rust in autumn; grass → fresh green in spring (`greenness`), pale in winter.

Mechanism: regenerate the affected atlas tiles when a season colour-scalar crosses a small threshold (not every frame — re-tint is event-driven, a handful of times per real day). Because tile UVs are unchanged, **no chunk re-mesh is required** — only the atlas `CanvasTexture` is updated (`needsUpdate = true`). This is why atlas-tinting is chosen over per-vertex colour (the latter would force a re-mesh of all loaded chunks on season change).

### 5c. Snow on the tops (terrain shader, height-gated)
The atlas tint is global and cannot do "tops only." Snow is therefore a **height-gated shader injection**, confirmed viable because the terrain uses *shared* materials:

- [mesher.js:11-13](../../../src/mesher.js): `opaque`/`cutout`/`liquid` are single shared `MeshLambertMaterial`s (atlas map, `vertexColors`).
- Add `material.onBeforeCompile` to the shared **opaque** material (and optionally cutout) that, in the fragment shader, mixes the lit colour toward snow-white as a function of world-space Y above a `uSnowLine` uniform, scaled by a `uSnowAmt` uniform.
- `uSnowLine` descends and `uSnowAmt` rises with `snowiness`, updated once per frame from `sky.js`/`main.js`. **No re-mesh.** Negligible GPU cost.
- World-Y reaches the fragment shader via the standard position varying; pin the exact injection point against the three.js version in use during planning.

Map view ([ui.js:829](../../../src/ui.js)) may optionally get a matching winter desaturation on the "bare top" tier (h≥33), but this is cosmetic and can follow.

---

## 6. Pillar 3 — Live moor weather (`src/weather-live.js`, new)

### Source
**Open-Meteo** — keyless, CORS-enabled (callable directly from the browser), free for non-commercial use (Moorstead is non-commercial → licence-clean; flag if it ever monetises). No secret to store.

### Location
Fixed: **Goathland** (≈ lat 54.401, lon −0.717 — pin exact at build), the heart of the moor. **Not** the player's geolocation: no permission prompt, no privacy surface, and a single shared "moor weather" for everyone. (A second coastal sample at Whitby for coast players is a possible later extension, not v1.)

### Fetch & consistency
- Fetch the **hourly** arrays (weather code, cloud cover, precipitation, visibility, wind speed).
- Index the **current UTC hour** → all clients within the same hour agree exactly.
- Cache ~15 min; one fetch per interval (~100 calls/client/day — trivial, well within free limits).

### Mapping (pure, unit-tested)
`mapWeather(sample) => { state, rainAmount, fogFar, windiness }`:
- WMO code → game `state`: rain/drizzle/showers/thunder → `rain`; fog codes / low visibility → `fog`; high cloud, no precip → `misty`; clear/low cloud → `clear`. Snow codes → `rain` in v1 (no season crossover).
- Continuous overrides blended into the existing pipeline: precipitation mm/h → `rainAmount` intensity; visibility → fog distance; wind speed → `windiness` (which already drives wind audio, [main.js:2065](../../../src/main.js)).

### Integration with the existing weather machine (`src/sky.js`)
- The existing random picker ([sky.js:137-154](../../../src/sky.js)) is **overridden** when a live sample is present: when the mapped `state` differs from the current weather, run the same transition + toast already implemented (e.g. "It's silin' it down!").
- The change cadence follows reality (re-evaluated on the ~15-min cache refresh), not the random 80–220 s timer.
- **Fallback:** if the fetch fails (offline, API down, CORS), the existing random machine runs unchanged. Live weather is a layer, never a hard dependency.
- Continuous params (`rainAmount`, fog distance, `windiness`) blend live values with the existing altitude/state-derived values tastefully (e.g. `windiness = max(altitude-based, live-wind-based)`).

### Test
`mapWeather` is pure → unit test with mocked samples (each WMO bucket, intensity edges). The fetch is mocked; no network in tests.

---

## 7. Pillar 4 — Soundscape extension (`src/audio.js` + `audio.update` call in `src/main.js`)

The procedural engine ([audio.js](../../../src/audio.js)) is already rich (wind+gusts, rain, curlew, grouse, owl, sheep, cow, bull, crow, gull, pheasant, frog, howl, two-tone steam whistle, dread heartbeat, full SFX). Extend the per-frame call's params and add continuous beds.

### New signature
```js
audio.update(dt, {
  rain, windiness, isNight, nearSheep, dread,   // existing
  season,        // from seasonState — drives the call mix
  nearWater,     // near a beck / water blocks
  onCoast,       // on the coast band
  nearInn,       // near a village inn, gated to evening
  trainDist,     // distance to the train, or null
})
```
`main.js` computes the new signals from player position + geography + the mob/train state it already tracks.

### Additions
- **Beck bed** — filtered-noise water loop (a new gain node alongside `windGain`/`rainGain`), faded by `nearWater`.
- **Tap-room pub bed** (replaces the rejected fiddle) — gated by `nearInn` + evening: a low warm murmur of talk (filtered noise with a slow formant/bandpass wobble), hearth crackle (sparse filtered pops over a low rumble), pot clinks (short bright transients), and occasional one-shots (a muffled laugh, a dog's woof, the door-latch). Authentic to a small moors pub; fully procedural; genre-neutral.
- **Distant train whistle** — today `whistle()` fires only near/boarding ([main.js:1348/1385/1405](../../../src/main.js)). Add a faint, low-passed, periodic whistle when `trainDist` is in an audible-but-far band.
- **Season-aware call mix** — the `ambientTimer` picker ([audio.js:60-72](../../../src/audio.js)) weights by `season`: spring curlew-heavy ("lamb when the curlew calls", [lore.js:25](../../../src/lore.js)) + lamb baas; summer grouse; autumn crows; winter sparse, wind-dominant.
- **Coast wave bed** — filtered-noise surf loop faded by `onCoast` (complements the existing gull call).

### Optional flourish (flagged — keep or cut at review)
- **Distant brass band** drifting from the village of an evening, *occasional* (a treat, not a loop), playing a short fragment of **"On Ilkla Moor Baht 'at"** — public-domain (melody = the 1805 hymn-tune *Cranbrook*), the definitive Yorkshire moor song, thematically perfect. Procedurally the hardest item (brass-ish timbre + melody fragment); lower confidence than the rest. Default: include as a low-frequency, low-volume layer; trivially removable.

---

## 8. Pillar 5 — Wildlife behaviours (`src/entities.js`)

Mobs are client-simulated; flocking already exists (`applyFlock`, [entities.js:1013](../../../src/entities.js)). `updateMobs` ([entities.js:793](../../../src/entities.js)) gains a `season` argument; spawn weighting reads it. All client-local; no relay.

- **Natural spring lambing.** The `lamb` model exists but only as the "Lost Lamb" quest follower (`natural:false, cap:0`, follows the *player*, [entities.js:548-555](../../../src/entities.js)). Add a **separate natural spring spawn**: ewes spawn with 1–2 trailing lambs that **follow the nearest ewe** (a follow-mother behaviour distinct from the quest lamb's follow-player). Reuses the model + baa audio; must not touch the quest lamb's semantics (drops, player-follow).
- **Grouse drumming (spring, dawn).** Seasonal + dawn-gated display in `updateMobs`: a bob/flutter animation + `grouseCall`, clustered (lekking).
- **Barghest dawn-prints.** A lightweight fading paw-print **decal trail** (small dark quads on the ground, fade over minutes) spawned near the player at dawn, occasionally. Pure folklore atmosphere tied to the existing barghest/dread lore; client-local, no relay.
- **Seasonal spawn weighting.** Curlew return in spring; density higher in summer, sparse in winter. Drive the spawn table ([entities.js:675-735](../../../src/entities.js)) by `season`.

---

## 9. Pillar 6 — Gameplay hook: bilberry seasonality

Bilberry bushes (`B.BILBERRY_BUSH → I.BILBERRIES`, [defs.js:95](../../../src/defs.js)) bear fruit **only in late summer**; out of season they are bare (no berry drop). Implemented at the forage/drop path (near [main.js:977](../../../src/main.js)) gated by `seasonState().heatherBloom`/late-summer window. The single gameplay touch in this cluster; deep husbandry stays in the Progression track.

---

## 10. Cross-cutting concerns

- **Multiplayer consistency:** season and weather are pure functions of a shared global source (wall-clock / hourly API by UTC hour) → all clients agree with no relay state. Wildlife and decals are client-local ambience (consistent with the existing model where mobs are not relayed).
- **Failure modes:** weather fetch failure → silent fallback to the random machine. No other pillar has an external dependency. Nothing in this cluster can block rendering.
- **No server, no secrets, no keys.** Confirmed for every pillar.
- **Performance:** snow shader = per-frame uniform update, no re-mesh. Atlas re-tint = event-driven canvas update, a few times per real day. Audio beds = a handful of persistent nodes. Weather = one fetch / 15 min. Wildlife = bounded decal count with fade-out reaping.
- **Persistence:** none required — season/weather are computed; sky.js `serialize/deserialize` ([sky.js:247-251](../../../src/sky.js)) is unchanged.

---

## 11. File manifest

**New:**
- `src/season.js` — pure season clock.
- `src/weather-live.js` — fetch + cache + pure `mapWeather` + fallback.
- `scripts/verify-season.mjs` — season unit checks (added to `npm run verify`).
- `scripts/verify-weather.mjs` — pure `mapWeather` checks across WMO buckets + fallback logic (added to `npm run verify`).

**Edited:**
- `src/sky.js` — consume season (palette/light) + live weather (override picker) + snow uniforms.
- `src/textures.js` — seasonal atlas re-tint.
- `src/mesher.js` — `onBeforeCompile` snow injection on the shared opaque material.
- `src/audio.js` — beck bed, tap-room pub bed, coast wave bed, distant whistle, season-aware call mix, (optional brass).
- `src/entities.js` — spring lambing, grouse drumming, barghest prints, seasonal spawn weighting; `updateMobs` gains `season`.
- `src/main.js` — compute and pass `season`, `nearWater`, `onCoast`, `nearInn`, `trainDist`; wire snow uniforms; bilberry seasonal gate.

---

## 12. Verification plan

- `scripts/verify-season.mjs` (boundaries, scalar bounds, bloom/snow peaks, determinism) + the weather-mapper unit test → both into `npm run verify` (currently 5 scripts).
- Visual checks (palette, heather bloom, snow-line, rain/fog under live weather) via the established headless frame-grab path (`moorstead.frame()` + `gl.readPixels`) where worthwhile; reserve pixels for the genuinely visual (snow shader, seasonal palette).
- Audio is verified by listening (no headless assertion); guard against errors by smoke-running `audio.update` with the new params.
- Live weather: verify the fallback path (simulate fetch failure → random machine still runs) and the pure mapper across WMO buckets.

---

## 13. Open / optional items

- **Brass band flourish** (§7) — include by default, low and occasional; cut at review if unwanted.
- **Map winter desaturation** (§5c) — cosmetic follow-on.
- **Coastal weather sample at Whitby** — possible later second point.
- **Exact Goathland coordinates, Open-Meteo endpoint/fields, and the three.js shader injection point** — pinned during planning/implementation, not design.

---

## 14. Build order (for the plan)

1. `season.js` + `verify-season.mjs` (the spine; everything else consumes it).
2. Visual seasons: atlas re-tint (textures.js) → sky/light (sky.js) → snow shader (mesher.js + uniforms).
3. Live weather: `weather-live.js` + `mapWeather` test → sky.js integration + fallback.
4. Soundscape: extend `audio.update` params in main.js → beds and mix in audio.js → (optional brass last).
5. Wildlife: `updateMobs(season)` → lambing → grouse drumming → barghest prints → spawn weighting.
6. Bilberry seasonal gate.

Each step is independently shippable and verifiable.
