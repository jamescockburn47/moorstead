# Festive Winter — Design

> A Victorian Christmas comes to the moor. As winter deepens, the villages dress up: a great fir on each green with lit candles, baubles, a star and presents; snowmen on the deepest-snow days; carol-singing children and a brass band playing *In the Bleak Midwinter*; wreaths on doors, candlelit windows, robins and holly. Merlin becomes a green-robed Father Christmas. And you can build and dress your own snowmen anywhere.

**Setting constraint:** Moorstead is **Victorian** — everything here is period-accurate. Father Christmas is **green and white** (the red suit is a later invention); tree lights are **real candles**; "garlands" are **evergreen/holly swags**, never electric string lights; the carol is the public-domain *In the Bleak Midwinter* (Holst's "Cranham", 1906).

## 1. Purpose & success criteria

- **The whole winter feels like Christmas** near the villages — decorations fade in as winter sets and melt away by spring, deterministically and client-side (no world writes, no relay).
- **A large 3D fir** (≈ twice house height) stands on each village green in winter only, dressed Victorian-style and lit by candlelight.
- **Snowmen**: auto ones appear on the greens only while the snow is at its **deepest**; players can **build and customise their own** anywhere snow lies.
- **Atmosphere**: a brass-band carol near towns, carol-singing children, wreaths, candlelit windows, robins and holly — and **Merlin re-cast as a green Father Christmas**.
- **Performance**: reuse the windowed, instanced overlay idiom (`floraLayer`) so it costs little; the few 3D pieces (fir, snowmen, figures) are instanced and windowed.

Non-goals (v1): gift-giving mechanics/quests; snowball-throwing combat; a full dynamic lighting engine (we fake "lit" with a warm additive-emissive); decorating arbitrary player buildings.

## 2. Architecture

Two pieces, both winter-gated and deterministic:

1. **`festiveLayer.js` (new)** — a windowed scene layer mirroring `floraLayer`'s rebuild-on-move/season-change. Unlike `floraLayer` (flat cutout quads) it also builds small **3D instanced meshes** (the fir as a cone of leaf-cubes + trunk; snowmen and child figures as stacked cubes/spheres). It places, per window: the town fir + its ornaments + presents at each village centre; auto-snowmen on greens; carol singers by the fir; wreaths on cottage doors; robins & holly about the green. No world writes; rebuilt only on cell-move or a festive-state change.
2. **A snow-deepening pass** in `mesher.js` — strengthen the existing snow shader so deep winter lies thicker (whiter, onto roofs and capped trees).

Plus three smaller integrations:
3. **Warm "lit" glow** — the world bakes its light (no dynamic lights), so candles, the star and lit windows use a **warm additive-emissive** injected into the cutout/festive material (the same `onBeforeCompile` trick as the forage glint), with a gentle candle flicker. This is how anything "lights up", period-accurately.
4. **`festiveMusic.js` (new)** — a tiny WebAudio sequencer that synthesises a brass-band *In the Bleak Midwinter* and plays it, low and looping with rests, when the player is near a town in winter.
5. **Merlin → Father Christmas** (`entities.js`) — a winter re-robe (green + white) + name relabel, alongside the existing wizard re-robe.

### Season gating

- **Festive window = winter** for most things: `season.frost > ~0.35` (or `warmth < 0`) — the whole winter, as asked.
- **Auto-snowmen = deepest snow only**: gated on the live **accumulation**, `game.snowAccum > ~0.85`. In normal play that's the handful of days around midwinter; with the warden Winter flip (`snowAccum = 1`) it triggers at once. (This is the one thing keyed on depth, not just the season.)
- **Player snowmen** persist regardless and **melt in the spring thaw** (when `frost` drops below a threshold).

### Data flow (per festive rebuild)

```
festiveLayer.update(playerPos, season, snowAccum)
  rebuild if cell moved / festive-state changed (winter on-off, deep-snow on-off, player-snowman set changed)
  build():
    for each village centre within RADIUS, if wintry:
        fir mesh (cone of leaf-cubes + trunk, snow-dusted)
        ornaments: baubles, candles(glow), star(glow), garland swag
        presents at base
        carol-singer figures by the fir
    for cells within RADIUS, if wintry:
        wreath on each cottage door; holly sprigs; robins
    if snowAccum > 0.85:  auto-snowmen on greens
    for each player snowman in the ledger (not melted): build its customised figure
```

## 3. Components & files

| File | Responsibility | Change |
|---|---|---|
| `src/festive.js` (new) | Pure: festive tables + gating (`festiveActive(season)`, `deepSnow(accum)`, village-centre festive placement, ornament/snowman layout, melt rule). Unit-tested. | create |
| `src/festiveLayer.js` (new) | Windowed scene layer: builds fir + ornaments + presents + snowmen + figures + wreaths/robins/holly; teardown like `floraLayer`. | create |
| `src/festiveMusic.js` (new) | WebAudio brass-band *In the Bleak Midwinter*; proximity/season gated. | create |
| `src/mesher.js` | Deeper-snow shader (whiter, roofs, capped foliage); warm "lit" additive-emissive on the cutout/festive material. | modify |
| `src/snowman.js` (new) | Pure: snowman customisation model (parts/colours), the `snowmanLedger` shape, melt logic. Unit-tested. | create |
| `src/world.js` | `snowmanLedger` (player snowmen: pos → config + day built) + (de)serialize + melt sweep. | modify |
| `src/main.js` | Construct/teardown `festiveLayer` + `festiveMusic`; drive them each frame (season + snowAccum + nearest-town distance); player-snowman build + customise interaction; melt sweep on the day tick. | modify |
| `src/entities.js` | Merlin winter re-robe (green/white Father Christmas) + relabel; the snowman/figure box-builders may live here (reuse the villager box helpers). | modify |
| `src/defs.js` / `src/textures.js` | New items/tiles for snowball/snowman + present/bauble/wreath/holly/robin tiles + icons. | modify |
| `src/economy.js` | (optional) buy/sell festive bits — deferred unless trivial. | maybe |
| `scripts/verify-festive.mjs` (new) + `package.json` | Headless tests. | create/modify |

## 4. The town fir (winter-only, 3D)

- **Form:** a real 3D fir, **≈ twice house height (~10–12 blocks)**, built as a cone of instanced leaf-cubes (green, snow-dusted white on top faces) on a short `LOG` trunk — generated by `festiveLayer` (not worldgen), so it appears in winter and is gone by spring. One per village green, at/near the centre (offset from the existing stone cross so both stand on the green).
- **Ornaments (Victorian):** **candles** (small warm-glowing sprites, gentle flicker — they read as lit), **baubles** (small coloured cubes/sprites), an evergreen **garland** swag (a helix/band of greenery), and a **star** at the top (warm glow). Placement deterministic on the cone surface.
- **Presents:** a cluster of small decorated boxes (red/green with ribbon) at the base.
- **Reuse:** the canopy-adornment + ground-scatter logic from the foraging work informs ornament-on-cone and presents-on-ground placement; the warm glow reuses the glint shader-injection pattern.

## 5. Snowmen — auto + player-built

- **Auto-snowmen:** a snowman figure (two-three stacked white spheres/cubes, coal eyes, carrot nose, a scarf) placed deterministically on village greens, **only when `snowAccum > 0.85`** (deepest snow). Winter atmosphere, no interaction.
- **Player-built:** 
  - **Gather:** scoop **snowballs** from deep-lying snow (right-click snowy ground with an empty hand when `snowAccum` is high) → snowball items.
  - **Build:** place a **snowman** anywhere from snowballs (a placeable that spawns the figure at that spot), recorded in `world.snowmanLedger` (pos → config, day built).
  - **Customise:** right-click your snowman to cycle its **scarf colour, hat (none/top-hat/bobble), nose (carrot/coal), arms (sticks/none), and mouth (coal smile)** — Victorian-plausible options. Stored per-snowman.
  - **Persistence & melt:** saved per-world; **melts in the spring thaw** (removed when `frost` falls below a threshold), so they don't litter summer. (Built deep in winter, they last the season.)
- **`snowman.js`** holds the pure customisation model + melt rule; `festiveLayer` renders both auto + player snowmen from the same figure builder.

## 6. Atmosphere details

- **Brass-band carol:** `festiveMusic.js` synthesises *In the Bleak Midwinter* (Holst's PD "Cranham" melody) with a brass timbre (detuned saw/square through a low-pass + ADSR), scheduled via WebAudio, **looping with rests**, volume scaled by proximity to the nearest village and gated to winter. Stops away from towns / outside winter. No audio asset.
- **Carol singers:** a fixed little group (~4) of **child figures** gathered by the fir, facing it (static, no AI), winter-only — the visual source of the singing.
- **Wreaths on doors:** a holly **wreath** sprite on each cottage door in winter (doors found via the village building data).
- **Candlelit windows:** cottage window panes glow **warm** at dusk/night in winter (warm emissive on window tiles) — candlelight from within.
- **Robins & holly:** the odd **robin** (red-breasted) perched about the greens; **holly sprigs** dotted around — small living/seasonal touches, winter-only.
- **Merlin → Father Christmas:** in winter, Merlin is re-robed **green with white fur trim** (period-accurate; he keeps his white beard) and his floating name reads **"Father Christmas"**; reverts to the wizard outside winter.

## 7. Deeper snow

Strengthen the existing snow shader so deep winter reads thicker: a **whiter** blanket at high `snowAccum`, snow lying on **roofs** and structure tops, and **snow-capped trees/bushes** (apply the snow wash to exposed leaf/cutout tops too). Driven by the existing `snowAccum`/snow-line (now seeded to max on the warden flip). Tunable intensity.

## 8. Decomposition into plans

Four independent, individually-deployable plans:

- **Plan 1 — Deeper snow + festive scaffold + snowmen (auto + player).** The snow-deepening pass; `festive.js`/`festiveLayer.js`/`snowman.js` scaffold + the warm-glow shader; auto-snowmen (deep-snow-gated) + player-built customisable snowmen (`snowmanLedger`, build/customise/melt). Ships a visible, interactive win on its own.
- **Plan 2 — The town fir.** 3D fir per village green + candles/baubles/star/garland (warm glow) + presents.
- **Plan 3 — Atmosphere.** Wreaths, candlelit windows, carol-singer figures, robins & holly, the brass-band carol, and Merlin → Father Christmas.
- **Plan 4 — Polish & balance.** Tune densities/volume/glow, snowman options, performance pass; any trims surfaced by play.

Each plan: branch → subagent-driven TDD → spec + quality reviews → final review → `npm run verify` → build → deploy → push.

## 9. Testing

- **Headless (`verify-festive.mjs`)**, TDD'd: `festiveActive(season)` (on in winter, off in summer); `deepSnow(accum)` threshold; deterministic village-centre fir placement + ornament/snowman layout (same seed ⇒ same); snowman customisation model round-trips; `snowmanLedger` record/serialize; melt rule (melts when frost low). Carol note-sequence is data (assert it parses / right length).
- **Live drive (`window.game`)** for the visual/audio: fir + ornaments + glow render in winter and vanish in summer; auto-snowmen appear at `snowAccum>0.85`; a player snowman builds + customises + persists + melts; wreaths/windows/robins; Merlin re-robes + relabels in winter; carol audio plays near a town in winter (assert the music node is running). Screenshots can't run on the backgrounded tab — verify via eval (instance/ledger/audio-state/console-error checks).

## 10. Risks & open calls (resolve in planning)

- **3D meshes in the overlay:** `festiveLayer` builds small instanced 3D meshes (fir cone, snowmen, figures), heavier than `floraLayer`'s quads — keep counts low (≤ ~2 villages in window, a handful of snowmen/figures), instanced, windowed; teardown on reload like `floraLayer`.
- **Warm glow without lighting engine:** the additive-emissive makes things *look* lit but casts no light — acceptable v1 (matches how the forage glint works). A real night light is out of scope.
- **Brass synth quality:** a synthesised brass band is approximate; keep it low and warm so it reads as distant village music, not a chiptune. Tune in Plan 3/4.
- **Player-snowman persistence:** `snowmanLedger` mirrors `forageLedger`/`editLedger` save parity; melt-in-spring avoids summer clutter (confirm players accept the melt — it's seasonal-realistic).
- **Fir vs cross placement:** offset the fir on the green so it doesn't clash with the central stone cross; confirm each village green has room.
- **Merlin re-robe timing:** re-robe/relabel must swap cleanly when the season crosses winter's edge (rebuild Merlin's model on the change), and not fight the wizard re-robe or his glow.
- **Snow on cutout tops:** capping trees/bushes with snow may need the snow shader applied to the cutout material's up-faces — verify it doesn't whiten vertical foliage oddly.
