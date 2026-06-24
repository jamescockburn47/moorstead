# Moorstead 1900 — moor tops + rivers, done right (terrain & water)

**Status:** design, awaiting review · **Date:** 2026-06-21 · **Type:** stage spec (moors-1900 program)
**Supersedes:** the river approach in [`2026-06-21-moors-1900-stage1-landscape-design.md`](2026-06-21-moors-1900-stage1-landscape-design.md) §6 Unit D (the held-level narrow carve — it perched the water and canyoned the source). **Memory:** `moors-1900-world`.

## 0. Why this exists

Stage 1b shipped rivers, but live exploration exposed that the approach was wrong, not just buggy:
- **Perched water** — a flat held water level + a thin slot, on the coarse/sloped DEM, leaves the water *above* the land beside it.
- **Canyon at the source** — holding the level and carving down through the steep moor-top digs a slot where a beck should tumble.
- **Stepped, not smooth** — the descent reads as clustered drops, not a gradient.
- **Fights the railway / structures, doesn't reach the estuary.**
- Separately: **the high moor is open liquid bog you sink into** (`B.BOG` is a `liquid` block), with no solid top — the real moor tops are walkable heather-and-peat.

This spec redesigns both, validated against James's steers: becks **follow the valley floor**, descend on a **rail-style smoothed gradient** (waterfalls only where genuinely steep), the **railway adapts** (bridge big rivers / culvert becks — it was built after the river), structures keep clear, the Esk reaches tidewater, and the moor tops become **solid marshy land**.

## 1. Goal

The moors world's water and high ground read and behave like the real North York Moors: walkable heather-and-peat tops with marshy flushes; becks that sit in the dale floors and run smoothly downhill to the sea, crossed cleanly by the railway. Nothing perches, nothing canyons, nothing floods the track, and you never sink through the ground.

## 2. Unit A — Moor tops: solid marshy land (client-only, moors-gated, ship first)

**Cause:** `B.BOG` is `kind:'liquid'` (`defs.js`), and `worldgen.generateChunk` overwrites bog-pool columns (`isBogPool`: `h≥33 && bogginess>0.74`) with two blocks of liquid `B.BOG`. On the moors world the bog is elevation-driven, so big stretches of the high tops (block ~48+) become open liquid you fall into.

**Design (gated to `geo.realWorld` — the existing stylised world's bog hazard is untouched):**
- **No liquid on the tops.** In the moors world, bog-pool columns stay **solid `B.PEAT`** (walkable) instead of liquid `B.BOG`. (Gate the `if (pool) { …B.BOG… }` block to `!geo.realWorld`.)
- **Marshy character, not dry peat:** scatter **cotton-grass** tufts (white nodding heads — a new `cutout` flora, or the nearest existing pale-tuft flora if one fits) across the wettest (former-pool / high-bogginess) ground, with heather over the drier tops (already elevation-driven). Real tops = Calluna heather + blanket peat + cotton-grass in the flushes + the odd peat hag.
- **Optional boggy feel:** a slightly slow/sticky tread on peat-marsh columns (no sinking) — a small physics touch; include only if cheap, else omit (YAGNI).
- **Flora + fauna live there:** ensure heather/cotton-grass place on the marsh and sheep/grouse are not excluded from it (today trees/flora bail out above `bogginess>0.42`).
- **Occasional real pool:** keep at most a *rare, small, fully-bounded* peat pool as a feature — but only if it can be walled so you can't wander into an unbounded sheet. Default to none; this is a nice-to-have.

**Scope:** `worldgen.js` surface + flora placement, a possible new flora tile in `textures.js`/`defs.js`, maybe a physics tweak. **No `heightRaw` change → no parity impact.** This is the quick half; ship it first.

## 3. Unit B — Rivers v2: valley-floor becks on a smoothed gradient

Replaces the held-level carve. The river is described by a **water profile** (height vs. chainage) computed per river, then the channel is carved to it. Everything is **integer-valued**, computed identically in `moorsgeo.js` (JS) and `geography_moors.py` (Python), so client/relay parity stays exact.

### 3.0 River polylines — proper chaining (build script; fixes the multi-channel artifact)
OS Open Rivers delivers a river as **several `LineString` segments**; the current `build_rivers` dumps all their points and `sort`s by easting, which **interleaves the segments into parallel/zig-zag channels** — confirmed live near Hutton-le-Hole, where **River Dove has 17 inter-point jumps >40 blocks (max 344)**. Fix in `build-moors-data.py`: build each river's polyline by **chaining** — start at the segment end nearest the source and walk nearest-neighbour through the points (or concatenate the gpkg `LineString`s in connection order) — so the polyline is a single, ordered, non-self-crossing course. This one fix removes the parallel channels (Dove/Hutton-le-Hole) **and** lets the Esk run unbroken to the mouth (§3.6). Verify: no inter-point jump exceeds a small bound (e.g. 25 blocks) on any river.

### 3.1 The water profile (the heart — fixes perch, canyon, and stepping)
Per river, once (cached), from the **chained** polyline (§3.0):
1. **Resample** the polyline at an even chainage step (Δ≈4 blocks) → evenly-spaced points (so the profile isn't hostage to irregular OS vertex spacing). Orient source (highest) → mouth (lowest).
2. **Valley-floor anchor:** `floor[i]` = the **minimum** base-terrain height in a perpendicular band (±`SNAP`≈5 blocks) at point i. Anchoring to the local low is what stops perching — the water is defined relative to the lowest nearby ground, never the centreline.
3. **Smooth:** `sfloor[i]` = a moving average of `floor` over ±`WIN`, then **clamped down** to the real floor (`min(sfloor[i], floor[i])`) so smoothing can never lift the water above the land.
4. **Descend (monotonic, never uphill):** `wl[i] = min(wl[i-1], sfloor[i] - FREEBOARD)`.
   - On **gentle** ground `sfloor` changes slowly → `wl` steps down in small, even increments → **reads as a smooth gradient, like the railway**.
   - Where the valley drops **faster than the profile can follow gently**, `wl` drops with it in one place → a **waterfall** (a concentrated drop), e.g. at the source. Smooth reaches + falls at the steep bits, like a real beck.
5. **Honest limit:** voxel water sits at whole-block Y, so "smooth" = small, even, frequent 1-block steps (exactly as the railway is stepped at block level yet reads smooth). It cannot be sub-block-sloped without a water-render overhaul (out of scope).

### 3.2 The carve (shallow — no canyon)
For a query `(x,z)` within `HALF` of the channel centreline: `wl` = interpolated profile at that chainage (integer, floored); `bed = wl - BED` (BED≈1–2, shallow). The cut is **hard-capped** so it can never gouge a canyon even if the profile sits well below a local high: `bed = max(wl - BED, base - MAXCUT)` with `MAXCUT`≈4. `heightRaw` is then `min(base, bed)` within the channel, banks left to rise naturally. Because `wl ≤ floor - FREEBOARD` (below the local valley floor) **and** the cut is capped at `MAXCUT`, there is **no deep slot** — just a beck bed in the dale floor; where the profile would have demanded more, the water shallows/steps there instead of carving down.

**Source taper — no deep channels on the tops (James, explicit):** the carve depth ramps from **0 at the source** to full over the first ~`TAPER` chainage (e.g. 60 blocks). So the beck *emerges* as a shallow surface rill on the moor top and only deepens into a cut channel lower down — the source is a trickle/waterfall, never a slot. (With the `MAXCUT` cap, the tops carry no deep channel by construction.)

**No channel through open water — lakes / the sea (James, explicit):** where a river column already sits in **connected open water** — `coastT>0` (the sea/estuary), or a flat ponded expanse whose base terrain is at/below the water level across a wide window (a tarn) — the **carve is suppressed entirely**: the river simply merges into the open water, no trench gouged through the lake/sea bed. The channel exists only on the land between source and the water body.

### 3.3 River size → width + rail crossing
Each river carries a `size`: **major** (Esk, Rye, Derwent, Leven, Dove, Seven) or **beck** (Murk Esk, Seph, Riccal; Tees if kept). Major → wider/deeper channel; beck → narrow. Drives both the channel `HALF`/`BED` and the crossing type (§3.4).

### 3.4 Rail crossings — bridge big, culvert small (the rail adapts)
The railway was built after the river, so the **rail** gives way; the **water always passes underneath**. Where a line and a river coincide (`railInfo.d` within the gauge **and** a river channel present):
- **Major river → bridge:** keep the channel open under the rail deck (an arched masonry opening / piers, reusing the existing `stampBridges` dressed-stone idiom); the deck spans the water.
- **Beck → culvert:** the rail crosses on solid embankment; a small (1–2 block) covered channel carries the beck under it.
- Either way the **track is never flooded and the river is never cut**. (This needs the rail deck/embankment stamping understood — flagged as a plan risk.)

### 3.5 Structures keep clear
Stations, the moor crosses and Wade's Causeway are placed river-aware (`moorsgeo.nearRiver`). Where a station must sit in a dale (Grosmont, Esk valley), the **station footprint wins** and the beck passes it by bridge/culvert (§3.4), not through the platform. Trees/boulders already excluded (Stage-1b fix) — retained.

### 3.6 The Esk reaches the sea
Extend the Esk to **real tidewater**: in the build script (which holds the sea mask), march from the Esk's mapped mouth to the **nearest sea cell** (`coastT>0`) and append those points — landing in the *sea*, not the station spot (the previous "append the town centre" was what put the channel into Whitby station). The full harbour estuary that bisects the town stays **Stage-2 Whitby** (needs the hero-terrain); this just gets the river to the sea.

### 3.7 Parity
The profile (resample, perpendicular-min, moving-average, monotonic) and the carve are **integer-valued and identical** in JS and `geography_moors.py`. `verify-geo-parity` (with the Stage-1b on-river samples) must stay at 0 mismatches. Tune the model in the client first; mirror to Python and re-green parity before deploying.

## 4. Testing (the checks that would have caught the live defects)

Headless (`scripts/verify-*.mjs`, into `npm run verify`) + live frame-pump:
- **No perched water (the big one):** for sampled columns along every river, the **rendered top water block ≤ the lowest adjacent ground within a few blocks** (water never above its banks). This is the check the last attempt lacked.
- **No canyon:** carve depth `base - bed` is bounded (≤ a few blocks) everywhere on the high moor; the source has a waterfall, not a slot.
- **No deep channel on the tops:** within ~`TAPER` of each river's source the carve depth is ≈0 (a surface rill).
- **No trench through open water:** where a river meets the sea / a pond (`coastT>0` or flat water at the water level), no separate channel is carved through the bed.
- **Smooth gradient:** along gentle reaches, consecutive water-surface steps are ≤1 block and spread (no clustered multi-block drops except at flagged waterfalls).
- **Polyline ordering:** no river has an inter-point jump beyond ~25 blocks (catches the scrambled/parallel-channel artifact — the Dove currently has jumps up to 344).
- **Continuity:** every channel column carries water (no dry gaps); no trees/boulders in the channel.
- **Rail crossings:** at every rail∩river, the track deck is dry and the water is present on both sides (bridged/culverted), never flooding the gauge.
- **Esk → sea:** the Esk's mouth reaches a `coastT>0` cell.
- **Moor tops:** in the moors world, high-moor bog columns are **solid** (no `B.BOG` liquid); cotton-grass/heather present; a probe "drop" on the tops lands on solid ground (no sink).
- **Parity:** `verify-geo-parity` + `test_moorsgeo.py` = 0 mismatches.

## 5. Sequencing (two deploys)
1. **Moor tops (Unit A)** — client-only, no parity; quick, high-value, ship first.
2. **Rivers v2 (Unit B)** — profile + carve (parity), then water fill, structures, rail crossings, estuary; tune in client → mirror Python → parity green → deploy.

## 6. Risks / unknowns for the plan
1. **Rail deck/embankment stamping** — confirm how the rail fills below the deck before building bridges/culverts (does it dam the beck?).
2. **Cotton-grass flora** — confirm the flora/texture system can take a new `cutout` tuft; else reuse the closest existing flora.
3. **"Smooth" expectation** — voxel water is block-level; set the expectation that gentle reaches read smooth (small even steps) and steep bits are waterfalls. Verify steps are small/even (§4) and show James before calling it done.
4. **Profile cost** — the perpendicular-min + moving-average per river, cached; `heightRaw` stays hot, so keep the per-call path a cheap interpolation with bbox reject (as Stage-1b).
5. **Estuary march** — ensure the sea-march lands in open sea and doesn't run along the rail into the station.
