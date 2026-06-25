# Seasonal Festivals — Design

> The moor keeps the old year's feasts. A shared festival calendar drives the villages through Eastertide, May Day, Midsummer, Harvest Home, Bonfire Night and Christmastide — each a short window keyed to the season clock, each dressing the world and (where apt) sounding it. Christmas is pulled back to the coldest fortnight only, its anachronistic Holst carol replaced by a rotation of pre-1900 carols played as real public-domain MIDI through a sampled instrument, and its tree re-sited the period-accurate way.

**Setting constraint:** Moorstead is **c.1900, Victorian/Edwardian** — everything is period-accurate, and that is the *point* of this work, not a nicety. The triggering bug was a carol whose tune did not exist until 1906 playing in autumn. Two rules follow:
1. **A custom is only in-period if its tune/form existed by 1900**, not merely its words. (Hence the carol rotation below excludes *In the Bleak Midwinter*.)
2. **The works are public domain; sound recordings are a separate copyright — but this is a non-commercial project.** So carols play as real PD MIDI arrangements through free sampled instruments (see §10), preferring fully-PD MIDI for the committed set. Period-history claims below are **flagged by confidence**; medium-confidence ones get verified before they ship.

## 1. Purpose & success criteria

- **Christmas only at the depth of winter.** The carol and all Christmas dressing appear for a **strict ~2-week Christmastide** centred on midwinter, never in autumn. (Today both fire at `frost > 0.35`, i.e. from in-world mid-October.)
- **Snow play is unaffected.** Scooping snowballs and building snowmen still work across the whole cold season; snowmen still melt only in the spring thaw. (This requires splitting one overloaded flag — see §2.)
- **A six-festival calendar.** A single pure module places every festival on the year circle deterministically, the same client-side, no-server idiom as `season.js`. Each festival is independently buildable and individually tunable.
- **Each festival dresses the world** near villages, period-accurately, fading in and out with its window. Audio where it earns it: carols as **real PD MIDI through a sampled instrument**; church bells and fire-crackle **procedural** (they synth well).
- **Real procedural flame, used everywhere.** A single shared fire system gives torches, lanterns, candles and bonfires genuinely animated, shader-driven flame (not static tiles or strobing sprites), scaled by parameter from a candle to a bonfire. It upgrades **all** existing fire in the game, not just the festivals.
- **The carol becomes a rotation** of ≥5 pre-1900 carols (7 specified), played as **real public-domain MIDI through a sampled instrument** (church organ / music box…), so it rarely repeats, is period-correct, and sounds real.
- **Performance**: reuse the windowed, rebuild-on-move overlay idiom (`floraLayer`/`festiveLayer`); one scene host updates per frame, dispatching only the active festival's builder.

**Non-goals (v1):** gift/quest mechanics tied to festivals; festival-specific NPC AI or schedules; a *general* dynamic lighting engine (warm additive-emissive still fakes most "lit" surfaces, though hero fires cast one budgeted flickering light — see §4A); computing the true paschal date for Easter (a fixed spring phase is used).

## 2. Architecture

The change rests on **splitting one flag into two** and **introducing a calendar**.

Today `festiveActive(season) = season.frost > 0.35` ([festive.js:3](../../../src/festive.js)) gates *both* the Christmas dressing *and* the snow mechanics (snowball scooping at [main.js:3305](../../../src/main.js), snowman build/melt). Narrowing it to a fortnight would break snow play. So:

- **`wintry(season)`** — broad cold season (`frost > 0.35`, unchanged behaviour). Gates snowball scooping, snowman building, and `snowmanMelted` (melt in the thaw). This is what most of today's `festiveActive` call sites become.
- **`yuletide(season)`** — narrow Christmastide window from the calendar. Gates Christmas dressing + the carol only.

By construction `yuletide ⊂ wintry` (the Christmastide window sits inside the cold season), asserted in tests so the snow-play guarantee can't silently regress.

The calendar is a pure function of `yearPhase`, mirroring `season.js`. A single **`seasonalLayer.js`** host owns the windowed rebuild/teardown lifecycle (lifted from `festiveLayer.js`), renders **winter snowmen** on `deepSnow` (independent of any festival), and **dispatches the active festival's builder** from `festivals/`. Each festival is a focused builder module sharing a build context (scene, world, gen, and helpers: `addBillboard`, window-glow, flame, figure builders).

`festiveLayer.js` is retired: its Christmas content moves to `festivals/christmas.js`, its snowman/fir/figure helpers move to the host or a shared `festivalKit.js`.

### Data flow (per rebuild)

```
seasonalLayer.update(playerPos, season, snowAccum)
  fest = festivalState(season.yearPhase)        // {easter,mayday,...,yule, active, intensity}
  rebuild if cell moved / active-festival changed / deep-snow changed / snowman-set changed
  build():
    if deepSnow(snowAccum):  auto-snowmen on greens     // wintry, not a festival
    render player snowmen from the ledger (if wintry)
    if fest.active:  festivals[fest.active].build(ctx, fest[fest.active])   // intensity 0..1 for fades
  audio: main.js drives the carol box (yuletide) + bell/crackle beds (per active festival), proximity-faded
```

### The festival calendar (`festivals.js`)

Each festival is a **trapezoid window** on the year circle: full intensity across a core, a short linear fade (`EDGE = 1.5` days) each side. `season.js` already pins midsummer at phase 0.375 and midwinter at 0.875, so the calendar dates fall straight out. Windows (`days`) and `EDGE` are exported constants, exposed on a debug lever (the repo's live-tuning-dial pattern) so any window can be widened in-session without a rebuild.

| Festival (`id`) | Centre phase | In-world | Window | Real time / 4-day cycle |
|---|---|---|---|---|
| Eastertide (`easter`) | 0.180 | ~11 Apr | 10 days | ~2.6 h |
| May Day (`mayday`) | 0.235 | ~1 May | 7 days | ~1.8 h |
| Midsummer (`midsummer`) | 0.385 | ~25 Jun | 7 days | ~1.8 h |
| Harvest Home (`harvest`) | 0.650 | ~29 Sep | 12 days | ~3.2 h |
| Bonfire Night (`bonfire`) | 0.750 | ~5 Nov | 7 days | ~1.8 h |
| Christmastide (`yule`) | 0.882 | ~23 Dec | 14 days | ~3.7 h |

`festivalState(yearPhase)` returns each `id`'s intensity (0..1) plus `active` (highest-intensity id, or `null`) and `intensity`. Windows do not collide at these centres; the gap to each neighbour exceeds both half-widths.

## 3. Components & files

| File | Responsibility | Change |
|---|---|---|
| `src/festivals.js` | Pure calendar: `FESTIVALS` registry, `festivalState(yearPhase)`, trapezoid window fn. Unit-tested. | **create** |
| `src/festive.js` | Split `festiveActive` → `wintry(season)` + `yuletide(season)`; keep `deepSnow`; `snowmanMelted` keys off `wintry`. | **modify** |
| `src/seasonalLayer.js` | Scene host: windowed rebuild/teardown; winter snowmen on `deepSnow`; dispatch active festival builder; shared build context. | **create** |
| `src/festivalKit.js` | Shared builders/helpers reused across festivals: figure boxes, billboards, window-glow, greenery swags, glow material. | **create** |
| `src/fire.js` | **General fire system:** the animated flame `ShaderMaterial` (domain-warped fBm → blackbody ramp) + a `Fire({scale,intensity,embers,smoke,light,layers})` builder (billboard layers, ember/spark particles, smoke column, optional point light). Reused by torches/lanterns/candles and the bonfire/midsummer fires. | **create** |
| `src/fireLayer.js` | Windowed overlay: scans nearby light-emitting blocks (torch/lantern/safety-lamp/candle), instances a `Fire` over each, LOD + frustum-cull, ticks `uTime`. | **create** |
| `src/festivals/christmas.js` | Fir (re-sited by chapel, presents dropped), carollers, wreaths, candlelit windows, **parlour-window trees**, **church greenery**, holly, robins. | **create** |
| `src/festivals/harvest.js` | Corn stooks/sheaves (farm fields + green), corn dolly, chapel decked with sheaves/produce, geese by the farm. | **create** |
| `src/festivals/bonfire.js` | Green-sited bonfire (flame + glow + smoke + sparks), "guy" effigy, optional modest rockets. | **create** |
| `src/festivals/mayday.js` | Maypole with ribbons + top garland, garlands on the stone cross, May-blossom boost. | **create** |
| `src/festivals/midsummer.js` | Hilltop bonfires on the high moor (sited via `gen.height`), midsummer greenery. | **create** |
| `src/festivals/easter.js` | Decorated pace-eggs (greens / rolling on a slope), chapel decked spring-white, daffodil boost, bell peal. | **create** |
| `src/carols.js` | Pure carol registry: `{id,name,year,file}` for the 7 carols + day-seeded rotation order. Unit-tested. | **create** |
| `src/carolBox.js` | Loads one chosen sampled instrument + plays the rotation's MIDI (`@tonejs/midi` + `soundfont-player`); proximity/`yuletide`-gated; low-pass → reverb → distance fade. | **create** |
| `public/music/carols/*.mid` + vendored instrument samples | The PD carol MIDI set + the one bundled GM instrument's samples (no third-party CDN at runtime). | **add** |
| `src/audio.js` | Procedural `bells()` + `fireCrackle()` beds (gains on the existing engine). | **modify** |
| `src/festiveMusic.js` | Retire (superseded by `carolBox.js`). | **delete** |
| `src/festiveLayer.js` | Retire (content → `festivals/christmas.js` + `festivalKit.js` + host). | **delete** |
| `src/main.js` | Swap gates (`yuletide` for dressing+carol, `wintry` for snowballs); wire `seasonalLayer` for `festiveLayer`; construct `fireLayer`; drive `carolBox` + bell/crackle by active festival + proximity; tick fire `uTime` + the hero light each frame. | **modify** |
| `scripts/verify-festivals.mjs` + `package.json` | Headless tests (calendar, split, carols, fire builder/LOD). | **create/modify** |

## 4. Christmas refit — hybrid tree (`festivals/christmas.js`)

Keep the beloved village tree + carollers, but make the scene period-accurate:

- **Re-site the communal fir by the chapel.** Place the fir adjacent to the village `chapel` building (the squire's/parish gift by the lychgate) rather than dead-centre by the stone cross. Fall back to the green centre if a village has no chapel in range. Same dressing as today (candles, baubles, garland, star), warm-glow lit.
- **Drop the present heap.** A pile of wrapped presents under a *public* tree is the one clear domestic anachronism; remove `buildPresents`. The candlelit tree stands alone.
- **Parlour-window trees (the domestic half of "hybrid").** The better-off homes get a **small lit tree glowing through a front window**, distinct from the generic candle-glow: always the **farmhouse**, plus a **sparse deterministic subset of cottages** (hash-gated, ~1–2 per village) — "the few families who could afford one." Reuses the window-glow placement, with a small green tree silhouette behind the pane.
- **Deck the church.** Holly-and-ivy **greenery swags** (billboards) on the chapel walls/door — greenery, not a second tree.
- **Carollers, wreaths, holly, robins, candlelit windows:** unchanged, re-gated to `yuletide`.

*Period confidence: the domestic tree popularised by Prince Albert (1848) is **high**; that the public outdoor green tree is essentially post-1900 (first US municipal tree 1912; UK interwar; Trafalgar Square 1947) is **medium-high** — verify before ship.*

### Carol rotation

Seven pre-1900 carols, plausible for Victorian "waits" or a village band. Played as real PD MIDI through a sampled instrument (§10), rotated in a day-seeded shuffle so all clients hear the same carol (shared-world idiom), one carol then a rest then the next.

| # | Carol | Date | Note |
|---|---|---|---|
| 1 | Good King Wenceslas | 1853 | Neale's words; 1582 tune *Tempus adest floridum*. |
| 2 | While Shepherds Watched Their Flocks | 1700 / tune 1592 | Tate to "Winchester Old". The West Riding's own waits carol. |
| 3 | God Rest You Merry, Gentlemen | trad., pub. 1833 | Sandys, *Christmas Carols Ancient and Modern*. |
| 4 | The First Nowell | trad., pub. 1833 | Sandys; arr. Stainer 1871. |
| 5 | Once in Royal David's City | 1849 | Alexander / Gauntlett "Irby". |
| 6 | Hark! The Herald Angels Sing | 1739 / tune 1855 | Wesley / Mendelssohn (Cummings). |
| 7 | O Come, All Ye Faithful | c.1743 / Eng. 1841 | *Adeste Fideles*, Wade. |

**Excluded, flagged:** *In the Bleak Midwinter* (Holst tune 1906 — the original bug); *O Little Town of Bethlehem* unless on the 1868 "St Louis" tune (the familiar "Forest Green" is 1906); *The Holly and the Ivy* borderline (standard tune collected c.1909).

## 4A. General fire system (`fire.js` + `fireLayer.js`)

The bonfire is the headline, but fire should be **one shared, genuinely-animated system** used by every flame in the game — torches, lanterns, safety-lamps, candles, and the festival bonfires — so none of it is a one-off and all of it is good. Today these are static textured blocks (`B.TORCH`/`B.LANTERN`/`B.SAFETY_LAMP`, `light:true`) with a flat tile for a flame; this replaces the *visual* with a real one while leaving the block and gameplay-light logic untouched.

**Why the naive version looks cheap, and what changes.** A flickering orange billboard reads as fake instantly. Convincing flame needs *turbulent motion* and a *temperature gradient*, both of which a shader gives cheaply:

- **Flame shader (the core).** A camera-facing billboard runs a fragment shader: **domain-warped fBm noise** (noise whose lookup coords are themselves warped by another noise field — this is what makes flame *lick* rather than blob), scrolled upward over `uTime`, shaped by a tapered silhouette mask, mapped through a **blackbody colour ramp** (white-hot core → yellow → orange → deep red → transparent at the tips), soft-edged (smoothstep, no hard cutout), additively blended. Same idiom as the animated cloud dome ([sky.js:87](../../../src/sky.js)) and the mesher's `onBeforeCompile` injection.
- **Per-instance variation.** A per-flame seed/phase (instanced attribute) so a row of torches doesn't pulse in unison; a subtle horizontal sway, wind-influenced where the weather system provides it.
- **Scales by parameter, candle → bonfire.** `Fire({ scale, intensity, embers, smoke, light, layers })`: a candle is `{scale:0.12, layers:1}`, a torch `{scale:0.3, layers:1}`, a bonfire `{scale:3, layers:3, embers:true, smoke:true, light:true}`. One material, different uniforms. (Christmas candles/window-glow in §4 adopt the candle variant for consistency.)
- **Embers/sparks (hero fires).** A capped additive-particle stream rising from the base and flickering out — what really sells a bonfire. None on a torch.
- **Smoke (hero fires).** A soft grey billboard/particle column drifting on the existing wind ([weather-live.js](../../../src/weather-live.js)).
- **Cast light (hero fires, budgeted).** The bonfire/hill-fire get **one flickering `PointLight`** pulsed by the same flame noise — the world's `MeshLambert` geometry already responds to scene lights. Torches keep the cheap emissive halo (too many to light individually). A deliberate, capped carve-out from the old "no real lights" rule.

**Delivery — `fireLayer.js`.** A windowed overlay (the `floraLayer`/`seasonalLayer` idiom): scan light-emitting blocks within a radius, instance a `Fire` over each (shared material, per-instance seed), **LOD** distant fires down to a single static emissive sprite, frustum-cull, tick `uTime` once per frame. Festival bonfires call `Fire` directly at hero scale.

**Prototype-gated, like the carol.** Flame lives or dies by eye in motion, so step one is a tweakable standalone prototype (torch + bonfire presets; sliders for noise scale/speed, colour ramp, height, turbulence, intensity) — screenshotted by me to catch breakage, judged by James before any integration (§13).

## 5. Harvest Home / Michaelmas (`festivals/harvest.js`)

The autumn feast — and the celebration that fits the season the world is in *now*.

- **Corn stooks/sheaves** stood in the farm fields and a few on the green; a **corn dolly** by the cross or chapel.
- **Chapel decked for harvest festival** — sheaves, fruit and veg swags on the chapel (reuses greenery-swag billboards with a harvest tile).
- **Geese** near the farmhouse/fold (Michaelmas goose), if cheap to place from existing mob spawns; else omit.
- **Audio:** a church **bell peal** (procedural, §11) near the chapel.

*Period confidence: **high** — the church harvest festival was widespread by 1900 (revived 1843); Mell supper / Harvest Home is the Yorkshire secular feast.*

## 6. Bonfire Night (`festivals/bonfire.js`)

- **A bonfire on the green:** a stacked-wood cone topped by the **`Fire` system (§4A)** at bonfire scale — animated shader flame, rising **embers/sparks**, a **smoke** column on the wind, and a flickering **point light**.
- **A "guy" effigy** on top (small figure from the kit).
- **Optional modest rockets** bursting in the night sky (deterministic, sparse) — period commercial fireworks (Brock's) existed but keep it small for a moor village.
- **Audio:** **fire crackle** (procedural, §11) near the fire; optional distant bangs.

*Period confidence: **high** — bonfires, guys, "penny for the guy", commercial fireworks all well established by 1900.*

## 7. May Day (`festivals/mayday.js`)

- **A maypole on the green:** tall pole, spiralling coloured **ribbons**, a **garland** at the top.
- **Garlands on the stone cross** and about the green.
- **May blossom**: a hawthorn/blossom boost via the existing flora seasonal hooks if cheap.
- **Audio:** none v1 (optional folk fiddle later).

*Period confidence: **high** as a custom, but **heavily a Victorian revival** (May Queen, Ruskin 1881) — framing leans on the revival, not an unbroken ancient rite.*

## 8. Midsummer (`festivals/midsummer.js`)

- **Hilltop bonfires** on the high moor — the **`Fire` system (§4A)** at bonfire scale, sited on local **height maxima** via `gen.height`, deliberately distinct from Bonfire Night's green-sited fire (different place, different season's light/foliage).
- **Midsummer greenery/garlands** about the village.
- **Audio:** **fire crackle** near a hill-fire if the player is high on the moor.

*Period confidence: **medium** — St John's Eve hill-fires were genuinely old but **waning by 1900** in many districts; treated as a surviving northern custom, not universal. Verify framing before ship.*

## 9. Eastertide (`festivals/easter.js`)

- **Decorated pace-eggs** scattered on greens and/or **rolling down a slope** (pace-egging is strongly northern).
- **Chapel decked spring-white** (greenery swags, lighter palette); **daffodils boosted** (already a seasonal bump at phase ~0.12).
- **Audio:** an Easter **bell peal** (procedural, §11).
- Fixed at a representative spring phase (0.180); the true movable paschal date is a non-goal.

*Period confidence: **high** and regionally apt — pace-egging and pace-egg mumming plays are documented Yorkshire/Lancashire customs.*

## 10. Carol playback — real MIDI + sampled instrument (`carolBox.js` + `carols.js`)

**Approach (revised — a hand-synth voice was tried and rejected).** A from-scratch WebAudio voice (first a brass band, then an FM music-box) didn't sound good enough, and on a **non-commercial** project the sound-recording-copyright worry that originally motivated synthesis doesn't bite. So carols are **real public-domain MIDI arrangements played through real sampled instruments**: correct full tunes with harmony, a genuine instrument timbre, tiny files, full runtime control. Proven in `prototypes/carolbox.html`.

- **MIDI (the arrangement).** One small PD MIDI per carol (~2–5 KB) under `public/music/carols/`, parsed with `@tonejs/midi`. Good King Wenceslas from the Timeless Truths hymn library (PD); the rest normalised to fully-PD sources (Mutopia/CPDL) before commit.
- **Instrument (the timbre).** A single sampled GM instrument via `soundfont-player` (MusyngKite samples). Period choices, James to pick: **church organ** (default — the village church), **reed organ/harmonium**, **music box**, celesta, tubular bells. Loaded once, reused for the whole rotation.
- **Bus.** Instrument → gentle low-pass (opens with proximity) → convolution reverb (village air) → master, distance-faded by the existing `1 - dist/60` curve.
- **Rotation (`carols.js`).** A registry `{ id, name, year, file }` for the 7 carols; a **day-seeded shuffle** (shared across clients); play one, rest 4–8 s, advance. Gated to `yuletide` + village proximity.
- **Bundled, not hot-loaded.** The chosen instrument's samples + the MIDI are **vendored under `public/`** and served by the game, so the carol works offline and survives a CDN outage. (The prototype pulls samples from the gleitz CDN for speed; the build vendors them.)
- **Correctness is free.** Real arrangements are correct by construction — no hand-transcription, so no FFT pitch-check needed. The only gate left is James's ear on the instrument + mix (§13).

## 11. Procedural festival SFX (`audio.js`)

- **`bells()`** — church bells as additive oscillator partials (inharmonic ratios) with a struck decay envelope; a simple change-ringing/peal scheduler. Used by Harvest and Easter near the chapel.
- **`fireCrackle()`** — filtered noise bursts (random short grains through a band-pass) layered on a low roar; a gain bed like the existing wind/beck/surf beds. Used by both bonfires, faded by proximity to the fire.

## 12. Decomposition into plans

Bug-fix and current-season first; each plan branches → subagent-driven TDD → reviews → `npm run verify` → build → deploy → push.

1. **Calendar core + flag split + retarget Christmas.** `festivals.js`; `festive.js` split (`wintry`/`yuletide`); repoint Christmas gates (dressing + carol) to `yuletide`, snow play to `wintry`. **Fixes the live autumn-carol bug.** Tests: `verify-festivals.mjs`.
2. **Scene host.** `seasonalLayer.js` + `festivalKit.js`; migrate Christmas into `festivals/christmas.js`; move snowmen to the host (deep-snow gated); retire `festiveLayer.js`. No visible change beyond #1 — a refactor with parity tests.
3. **General fire system — prototype, gate, then integrate.** `fire.js` + `fireLayer.js`: the flame shader + `Fire` builder, retrofitting every torch/lantern/candle in the game (a standalone win), and the foundation the fire festivals build on. Prototype-gated by eye (§13). Candles in §4 adopt the candle variant.
4. **Hybrid tree.** Re-site fir by chapel, drop presents, parlour-window trees, church greenery.
5. **Carol rotation — real MIDI + sampler.** Vendor the PD MIDI set + the chosen instrument's samples under `public/`; `carols.js` + `carolBox.js` (`@tonejs/midi` + `soundfont-player`), proximity / reverb / distance fade; retire `festiveMusic.js`; wire in `main.js`. James's listen-pass picks the instrument. Prototype already proven (`prototypes/carolbox.html`).
6. **Harvest Home.** Stooks, corn dolly, decked chapel, bells. (Fits the current in-world autumn.)
7. **Bonfire Night.** Bonfire (uses §4A `Fire`), guy, sparks, crackle.
8. **May Day.** Maypole, ribbons, cross garlands.
9. **Midsummer.** Hilltop fires (uses §4A `Fire`), greenery.
10. **Eastertide.** Pace-eggs, decked chapel, bells, daffodils.
11. **Polish & balance.** Densities, volumes, glow, window-length dials; perf pass; trims surfaced by play.

## 13. Testing

- **Headless (`verify-festivals.mjs`)**, TDD'd:
  - `festivalState`: each festival intensity `= 1` at its centre, `= 0` well outside, monotone across the fade; `active` picks the right id; no two windows overlap at the registry centres.
  - **Split guarantee:** for every phase, `yuletide(season) ⇒ wintry(season)` (sample the circle); `wintry` matches today's `frost > 0.35` exactly (no snow-play regression).
  - `carols.js`: the registry is well-formed; the rotation shuffle is deterministic for a given day seed; every referenced MIDI file exists and parses (`@tonejs/midi`).
- **Carol — correctness is free; the listen-pass picks the mix.** Real MIDI arrangements are correct by construction (no transcription, so no FFT pitch-check). The remaining gate is **James's ear** on the instrument + reverb + volume, proven in `prototypes/carolbox.html` before it ships. I cannot hear it, so my judgement is not the acceptance test — his ear is.
- **Fire — look-gate + my own visual check.** Flame is judged in motion, so James's eye is the acceptance test; but unlike audio I *can* verify it myself via the preview (screenshots/snapshots across frames) — confirm it renders, animates (not a static blob, not strobing), and sits on the voxel art style, before he eyeballs it live. Iterate shader params on his feedback via the prototype.
- **Fire — perf + headless guards.** Hold target framerate with many torches in view on a mid/mobile spec (the LOD + instancing budget — the touch build matters); headless `verify` checks the `Fire` builder's object graph, LOD distance thresholds, and that a fresh world still compiles the flame material.
- **Live drive (`window.game`)** per festival: dressing renders inside its window and is gone outside; the carol box runs near a winter village and is silent in autumn (assert audio-node state, not screenshots — the preview tab is backgrounded); bells/crackle gate correctly. Each festival plan adds its own live checks.

## 14. Risks & open calls (resolve in planning)

- **Rarity.** Strict windows on a 4-day year are short (1.8–3.7 h real per cycle). Accepted by design; the window-length dials let any festival be widened live if play shows it's too easy to miss.
- **Period-history confidence.** Christmas-tree municipal dating (§4) and midsummer-fire framing (§8) are **medium-confidence**; verify before those plans ship. May Day's "revival" framing (§7) is **medium-high**. The rest are **high**.
- **Melody transcriptions.** Authored from known PD tunes but **must be checked against PD scores** before #4 ships; a wrong note is a bug, not licence.
- **Building-type confirmations.** Parlour-tree targeting assumes `farmhouse` + `cottage` types and a `chapel` present in range (confirmed in `moorsgeo.js`); the per-village hash gate for "which cottages" is tuned in #3.
- **`seasonalLayer` perf.** Only the active festival builds, but bonfire flame/sparks and the maypole are new animated meshes — keep counts low, instanced, windowed; teardown on reload like `floraLayer`.
- **Carol audio (resolved by the pivot; one new dependency).** The hand-synth voice was tried and rejected; carols now play **real PD MIDI through a sampled instrument** — correct tunes, real timbre. New risk: a runtime dependency on instrument samples + MIDI. Mitigated by **vendoring** the chosen instrument's samples and the MIDI under `public/` (no third-party CDN at play time) and keeping the committed MIDI set fully PD (Mutopia / CPDL / Timeless Truths). The prior procedural lesson still holds for **bells + fire-crackle** (§11), which do synth well.
- **Procedural flame quality + cost (the other "try hard" detail).** The naive version (a strobing orange sprite) looks cheap; the craft version (domain-warped fBm shader, blackbody ramp, soft animated silhouette, per-instance phase, embers/smoke) sells it. Risks: (a) **mobile perf** with many torches — mitigated by one shared instanced material, LOD to a static emissive at distance, frustum-culling, and capping embers/lights to hero fires; (b) **art-style match** — keep it lightly stylised to sit on blocky terrain, not photoreal; (c) **dynamic light** is a deliberate, budgeted carve-out from the old no-real-lights non-goal — hero fires only, 1–2 lights, behind a toggle. Judged by eye on a prototype before integration (§13).
