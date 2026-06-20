# Winter weather & survival — design

- **Date:** 2026-06-20
- **Status:** Approved in brainstorm; pending spec review
- **Author:** James + Claude

## Problem

Winter looks static and means nothing. The just-shipped snow falls on a deterministic clock (not the real moor weather), the sky doesn't go overcast when it snows, snow whitens interior floors, and there's no survival pressure — hunger barely bites and cold doesn't exist. Winter should be a hard season you prepare for.

## Goals

**Weather/coverage (visual):**
- Winter snowfall is driven by the **live moor forecast** (Open-Meteo): when it would rain on the real moors in winter, it snows in-game. Clear forecast → no snowfall but lying snow remains.
- Sky goes **overcast only while it's actively snowing**; clear winter days are bright and sunny with snow underfoot.
- Snow covers **roofs, ground and exterior tops** but **never interior floors**, and doesn't fall inside buildings.

**Survival (gameplay):**
- A new **temperature gauge**: cold outdoors in winter, warmed by fire, shelter, a coat, and hot food.
- Cold **slows you, then freezes** (damages health) if it stays low; cold also **drains hunger faster**.
- **Hunger bites** — and **food is scarce in winter** (berries gone, fewer animals, fishing reduced), so cooking and stockpiling autumn's surplus is the intended play.

## Non-goals

- No new equipment-slot system — the coat warms by being *carried*.
- No food-spoilage system — scarcity (not rot) creates the stockpiling pressure.
- No per-block snow *depth*/voxel accumulation (coverage stays the non-destructive shader wash from Plan 3).
- Temperature is per-player and client-side — no relay/persistence.

## Backbone principles

- **Player stats stay in the existing idiom** (`player.js` fields, ticked in `update`, drawn as HUD pip-rows) — `temperature` mirrors `hunger` (0–20, full = warm).
- **Weather is shared via the existing live-feed hour-index** (all clients read the same Open-Meteo hour, like the fog/season); the deterministic `snowfallIntensity` (Plan 3) is the **offline fallback** only.
- **Coverage is deterministic from geometry** — a skylight pass bakes sky-exposure at mesh time; the snow shader gates on it. No re-mesh on weather.

---

## Part A — Winter weather & coverage

### A1. Live-weather winter snow — `src/sky.js` (+ `src/weather-live.js`)

`mapWeather` already yields `rainAmount` from Open-Meteo precipitation. Do the rain-vs-snow split in `sky.update()` (which has `season`):

```js
const wintry = season && season.warmth < 0;
const livePrecip = (this.liveRain != null) ? this.liveRain : (this.weather === 'rain' ? 1 : 0);
const snowFall = wintry ? (this.liveRain != null ? this.liveRain : snowfallIntensity(Date.now(), season)) : 0;
const targetRain = (wintry || snowFall > 0.02) ? 0 : livePrecip;
```

So in winter, live precipitation becomes snow (and the deterministic `snowfallIntensity` only fills in when there's no live sample). Outside winter, rain behaves as today. The Plan 3 snow-particle block already consumes `snowFall`.

### A2. Overcast only while snowing — `src/sky.js`

The sky `grey`/`uClouds` currently keys off the weather state. Make it also reflect active precipitation so a *clear winter forecast* reads sunny:

```js
const weatherGrey = { clear: 0, misty: 0.13, rain: 0.52, fog: 0.68 }[this.weather] || 0;
const grey = Math.max(weatherGrey, snowFall * 0.6, this.rainAmount * 0.5);
```

When it snows → overcast grey + dimmer sun. When winter is clear (`snowFall ≈ 0`) → `grey ≈ 0` → blue sky, full sun, bright snow.

### A3. Exterior-only coverage — `src/mesher.js` + `src/snow.js` + shader

Today the snow shader whitens any up-facing face above the snow-line, including interior floors. Add a **skylight pass**:

- Per chunk, compute a per-column `skyTop` (highest opaque block y). A face is **sky-exposed** if no opaque block sits above it.
- Bake a per-vertex `aSnowExp` attribute (1 = sky-exposed, 0 = occluded) onto the opaque **and** cutout geometry.
- In `addSnow`, pass `aSnowExp` to a varying and multiply the snow factor by it: `snow *= vSnowExp;`

Result: roofs, open ground, exterior ledges and exposed flora whiten; floors under a roof and indoor flora never do. Snow particles already cut out when the player is `covered`, so it doesn't "fall indoors". (Walls are near-vertical — the existing up-face gate keeps coverage to tops/ledges, which reads correct; a faint exterior-wall rime is optional polish, not required.)

---

## Part B — Winter survival

### B1. Temperature stat + HUD — `src/player.js`, `src/ui.js`

- `player.temperature = 20` (0–20; full = warm). Persisted with the player like hunger.
- HUD: a third pip-row under hunger (thermometer/snowflake icon: full = warm amber, draining to icy blue), shown in survival mode. Mirror the existing 10-pip heart/hunger pattern.

### B2. Temperature dynamics — `src/player.js` / `src/main.js`

Each frame, ease `temperature` toward a computed `target` (faster to warm than to chill):

```
chill = max(0, -season.warmth)                  // 0 summer .. 1 deep winter
if not wintry: target = 20
else:
  base = chill * 22
  if covered:        base *= 0.35               // shelter
  if nearFire:       base = 0                    // a fire keeps you warm
  if night:          base *= 1.35
  base *= (1 + 0.4 * altitudeFactor)             // colder on the high moor tops
  base *= (1 + 0.6 * wetness)                    // wet = colder
  if carryingCoat:   base *= 0.5                 // a wool coat halves the chill
  target = clamp(20 - base, 0, 20)
temperature += (target - temperature) * (target > temperature ? 0.06 : 0.03) * dt   // warm faster than chill
```

- **Hot food:** eating a *cooked* food (cooked meats/fish, fish & chips) adds an instant `+6` warmth burst.
- `nearFire` reuses `world.nearLight(x,z,4)`; `covered` reuses the existing roof-scan; `altitudeFactor` from player Y vs valley/tops.

### B3. Cold consequences (slow → freeze) — `src/player.js`

- **temp < 12 (chilly):** hunger drains ~1.6× and health regen is blocked.
- **temp < 6 (cold):** movement slowed (~0.75×) and a frost vignette creeps in (intensity scales as temp → 0).
- **temp ≤ 0 (freezing):** freezing damage — 1 HP every 4 s (mirrors starvation), until warmed above 0.

### B4. Meaningful hunger — `src/player.js`

Hunger already starves at 0 and gates regen at ≥16. Make it *matter* by: cold accelerating the drain (B3), and winter scarcity (B5) making food a real pressure. Tune the base drain so summer is forgiving but a cold winter day genuinely runs you down. No new starvation rules needed — the pressure comes from cold + scarcity.

### B5. Warm coat + food scarcity

- **Wool coat** (`I.WOOL_COAT`, new): crafted from wool (`B.WOOL` exists) — e.g. 3 wool → 1 coat. Carrying it in the inventory sets `carryingCoat` (halves chill, B2). No worn-slot UI.
- **Food scarcity in winter:**
  - Foraged berries already off (bilberry/blackberry seasonal — keep).
  - **Fewer grazers/grouse:** strengthen the existing winter spawn down-weighting in `entities.js` (reduce sheep/cow/pig/grouse caps/weights when `season.warmth < 0`).
  - **Fishing reduced:** in deep winter, becks freeze / catch rate drops — gate `updateFishing` on `season`.
  - **Stockpiling:** the net effect (scarce fresh food + cold-accelerated hunger) makes cooking and storing autumn surplus the intended survival play. No spoilage.

---

## Determinism, multiplayer, performance

- Temperature/hunger are per-player, client-side; no relay, no persistence beyond the existing player save.
- Weather is shared via the live-feed hour-index (existing idiom); offline falls back to the deterministic snow clock.
- The skylight pass is O(chunk volume) once per chunk at mesh time (cheap); coverage is a shader gate, no re-mesh on weather.

## Testing

- **Pure unit tests (headless):** a `temperatureTarget(...)`/`stepTemperature(...)` function (verify-winter: chill rises in winter outdoors, fire/shelter/coat warm, night/wet/altitude colder, warms faster than it chills); the rain→snow split + overcast grey as a pure helper; the skylight `skyTop`/exposure computation on a fixed block array.
- **Spawn/fishing scarcity gates:** pure-ish checks that winter reduces spawn weights / fishing yield.
- **Visual (HUD gauge, frost vignette, sky overcast, exterior-only coverage):** the running-game drive + console-error checks (the established pattern), at winter `seasonOverride`.
- New checks join `npm run verify`.

## Milestones

- **M1 — Live-weather winter snow + overcast/sunny** (`sky.js`): rain→snow split, grey tied to active precip.
- **M2 — Exterior-only coverage** (`mesher.js` skylight pass + shader `aSnowExp` gate): no indoor snow.
- **M3 — Temperature gauge** (`player.js` stat + dynamics, `ui.js` HUD row): cold outdoors, warmed by fire/shelter/altitude/wet/night.
- **M4 — Cold consequences** (`player.js`): slow → frost vignette → freezing damage; cold-accelerated hunger.
- **M5 — Coat + hot food** (`defs.js` item/recipe, `player.js`): carried coat halves chill; cooked food warms.
- **M6 — Food scarcity** (`entities.js` winter spawns, `main.js` fishing gate).

## Risks / open questions

- **Balancing** (chill rates, thresholds 12/6/0, drain multipliers, spawn reductions, coat strength) is feel-tuning — expect iteration after playing a winter.
- **Skylight pass + the existing per-block flora rotation + AO**: confirm the new `aSnowExp` attribute composes with the existing vertex attributes without bloating the cutout/opaque geometry unduly.
- **`altitudeFactor`**: define against the world's valley/tops range (e.g. normalise player Y over ~26–60); confirm it reads sensibly on the real terrain.
- **Coat "carried = warm"** is a simplification; if it feels unintuitive (warm without wearing), a later worn-slot could replace it — flagged, not built.
- **Fishing freeze** — decide whether becks visibly freeze (ice tile) or just the catch is gated; spec assumes catch-gated for now (visible ice is optional polish).
