# Coastal & Valley Morphology — Design

**Status:** design approved (scope + mechanism), spec for review
**Date:** 2026-06-21
**Branch:** `feat/moors-1900-stage1a` (uncommitted, per James's "commit only when asked")

## Goal

Give the real-Moors world the dramatic coast it should have. The 15m DEM has smoothed the North York Moors Heritage Coast flat: Whitby tops out ~3 blocks above the sea (no cliffs), Robin Hood's Bay is a gentle slope not a 1-in-3 ravine, Staithes is near-flat where it should be a steep beck-cut between high cliffs. This stage sculpts **sea-cliffs** and **steep gully-valleys** so that, later, the abbey can perch on Whitby's East Cliff and the fishing villages can cling to ravine sides above tight harbours.

This is **stage 1 of a re-sequenced roadmap**: landscape → main railway re-fit → branch railways → buildings. Buildings (incl. the abbey *building*) are parked; this only shapes the ground.

## Decisions (locked)

- **Scope: the whole Heritage Coast.** Hero spots (Whitby E+W cliffs, Robin Hood's Bay, Staithes) *plus* a general coast-steepening so every appropriate stretch reads as cliff, not beach (Ravenscar, Boulby, Runswick, Sandsend included).
- **Authoritative.** Sculpted in the **base height** (`moorsgeo.js heightRaw`) and **mirrored in `deploy/world/geography_moors.py`** — exactly like the existing `peak` cones. The railway re-fit, deeds and mine-depth all read the real terrain. Costs the JS↔Python parity sync (already an established pattern; `verify-geo-parity` + `test_moorsgeo.py` guard it).

## Architecture

Three additive layers on top of the DEM base, composed in `heightRaw` **after** the peak cones and **before** the existing coast sea-blend:

### 1. Cliff-headland landmarks (`kind: "cliff"`)
A flat-topped raised headland (a mesa) that falls steeply to the water.
- **Params:** `{ top, plateauR, radius }` — `top` = clifftop height (blocks above sea), `plateauR` = flat-top radius, `radius` = outer foot.
- **Sculpt:** with `d = hypot(x-lmx, z-lmz)`:
  - `d ≤ plateauR` → `h = max(h, WL + top)` (flat headland for buildings to sit on)
  - `plateauR < d < radius` → `h = max(h, WL + top − ((d−plateauR)/(radius−plateauR))^k · top)` with `k > 1` for a steep, slightly convex face
  - Seaward sides meet the existing sea-blend → a true cliff into the sea; landward sides meet the moor.
- **Why max():** never *lowers* terrain, so it composes cleanly with peaks and the DEM (same contract as peak cones).

### 2. Gully-valley landmarks (`kind: "gully"`)
A steep ravine from moor to sea for the ravine-villages.
- **Params:** `{ head:[x,z], depth, halfWidth, rim }` — landmark `x,z` is the **mouth** (sea end), `head` the inland top; `rim` = surrounding clifftop height (blocks above sea), `depth`/`halfWidth` shape the V.
- **Sculpt:** project the column onto the mouth→head axis to get along-fraction `s∈[0,1]` and perpendicular distance `p`:
  - **Raise the rims:** outside the channel (`p > halfWidth`), lift toward `WL + rim` like a low cliff landmark, so the village sits between high sides.
  - **Cut the channel:** inside (`p ≤ halfWidth`), set floor toward a line from `WL` at the mouth up to `WL + rim − depth` at the head; sides rise steeply (`(p/halfWidth)^k`) to the rim. Use `min` for the cut so it only deepens, `max` for the rims.
- Result: a narrow, steep valley plunging to a tight sea mouth — cottages will later step down the sides.

### 3. General coast-steepening (algorithmic, not per-landmark)
Make the *whole* coast cliffy where the DEM gives only a ramp.
- For **land** columns (`base ≥ WL`) near the shore, amplify the rise from the waterline: `h = WL + (h − WL) · amp(coastDist)` where `amp` is largest (≈2–2.5) right at the shore and fades to 1 inland over ~8 blocks. This lifts coastal clifftops so the shore-to-top rise is short and steep.
- **`coastDist`** (blocks to the nearest sea column) is the one new cost. Compute a **coarse coast-distance field** once from the DEM (BFS/limited ring-sample over a downsampled sea mask), cached on the geo; per-column lookup is then O(1). Both JS and Python build the same field from the same DEM, so parity holds.
- The existing sea-blend (`coastT`, `(WL−9)` floor) is **tightened**: shorten the `smoothstep((WL−base)/8)` ramp (≈/4) so the drop at the shoreline is sharper.
- Guard: amplification is capped and only applied seaward-facing, so inland dales are untouched.

## Hero & coast inventory (initial)

Coords are existing town/landmark positions (`+x = North`, `+z = East`).

| Feature | Kind | Where | Notes |
|---|---|---|---|
| Whitby **East Cliff** | cliff | ~abbey 1802,3038 | `top` ≈ 6 (≈90m drama), plateau for the abbey + St Mary's + 199 steps |
| Whitby **West Cliff** | cliff | W of the Esk mouth | flanks the harbour I already built; town/Khyber side |
| **Robin Hood's Bay** | gully | mouth 1421,3408 → head inland (SW) | the steep main-street ravine |
| **Staithes** | gully | mouth 2319,2276 → head inland (W) | steep beck to the harbour |
| **Runswick / Sandsend** | gully | 1901,2811 (Sandsend) +Runswick | smaller ravine villages |
| **Boulby** | cliff | N of Staithes | England's highest sea-cliff |
| **Ravenscar** | cliff | 1150,3597 | cliff promontory |
| open coast between | general | all `coastDist`-near land | layer 3 |

Exact params tuned during implementation against the relief assertions.

## Interactions

- **Town flatten** (`height()` averages town ground toward `v.ground` within `radius`, skipping sea columns): must give coastal towns a **buildable shelf** without erasing the cliff. Resolution: apply the flatten only to the gentle component; clamp it so it never cuts below a cliff/gully sculpt by more than a step (keep the drama, flatten the building pads). Verify per coastal town.
- **Estuary (Esk mouth at Whitby):** already meets the sea flush at WL; the two cliffs flank it. The East/West cliff feet must not dam the mouth — keep the cliff foot at/over the existing water, never raising sea columns (same rule as the village flatten).
- **Rivers:** carved client-side; cliffs are base-height. Where a beck reaches a cliffed coast it should waterfall/short-cut — acceptable for this stage; revisit if ugly.
- **Railway:** parked, but because cliffs are authoritative the later re-fit will route around/under them correctly.

## Verification (`scripts/verify-coast-moors.mjs`, new)

Relief/slope assertions (headless, deterministic `_heightRawNoFbm`):
- **Whitby East Cliff:** a flat clifftop (≥4×4 columns within 1 block of `WL+top`) within ~10 blocks of the abbey site, AND a sea column within ~12 blocks of it → a real headland over water.
- **Cliff steepness:** at each cliff, max slope sea→top ≥ 3 blocks/block over the face (vs the smoothed ~1.8 baseline).
- **Gullies (RHB, Staithes):** along the mouth→head axis, rim−floor ≥ `depth−1` and side slope ≥ 2 blocks/block (a ravine, not a slope).
- **General coast:** sampled coastal land columns are higher than the pre-change baseline near the shore (steepening applied) but inland dale heights unchanged (no spillover).
- **Parity:** `verify-geo-parity` reference still emits + sane; `test_moorsgeo.py` JS↔Python match within 1e-6 (run on relay deploy).
- **No regressions:** existing `verify` suite green (rivers, rail, moor-tops, bog).

## Slicing (Whitby hero first)

- **Slice A:** the sculpt plumbing — `cliff` + `gully` kinds in `heightRaw` + `geography_moors.py` mirror + the landmark data shape; land **Whitby East & West Cliffs**; relief assertions for Whitby; parity green. *Whitby looks right end of Slice A.*
- **Slice B:** the **gully villages** — RHB, Staithes (+ Runswick/Sandsend); gully assertions.
- **Slice C:** **general coast-steepening** (coast-distance field + amplification + tightened sea-blend) + open-coast cliffs (Boulby, Ravenscar); whole-coast assertions; coastal-town flatten reconciliation.

Each slice builds, verifies and deploys on its own.

## Risks

- **DEM too low to sharpen** at some spots (Whitby is genuinely ~3 blocks): cliffs rely on the **uplift** (`top`) not just steepening — landmark mesas carry the drama, the general layer assists.
- **Parity drift:** the coast-distance field must be computed identically JS/Python from the same DEM. Mitigation: derive it purely from `data.elevation` (shared JSON), no floats that diverge; cover with `test_moorsgeo.py`.
- **Coastal town flatten fighting the cliff** (towns perched on cliffs): explicit per-town verification in Slice C.
- **Performance:** coast-distance field is O(grid) once + cached; per-column O(1). Acceptable.
