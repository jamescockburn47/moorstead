# Festive Winter Plan 3 — Atmosphere (carol, Merlin, trimmings)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill out the Victorian Christmas: carol-singing children by the fir, a brass-band *In the Bleak Midwinter* near towns, holly wreaths on cottage doors, candlelit windows, robins & holly about the greens, and **Merlin re-cast as a green-and-white Father Christmas** (relabelled) in winter.

**Architecture:** Visual trimmings (carol singers, wreaths, robins, holly) ride the existing `festiveLayer` (winter-gated, windowed, disposed on clear). The carol is a new `festiveMusic.js` WebAudio synth, gated to near-town + winter by `main.js`. Candlelit windows use a warm emissive. Merlin's winter look is a re-robe + relabel in `entities.js`. Period-accurate (candlelight, brass band, greenery — no electric lights).

**Tech Stack:** vanilla ES modules, three.js (figure Groups), WebAudio, Node `.mjs` verify.

Plan 3 of 4 for the festive-winter spec ([2026-06-21-festive-winter-design.md](../specs/2026-06-21-festive-winter-design.md)). Builds on `festiveLayer.js` (Plans 1–2), `festive.js` (`festiveActive`), `geography` (villages), `entities.js` (villager box-figures + Merlin `wizardify`). Setting is **Victorian**.

## File structure

- `src/festiveLayer.js` — carol-singer figures by the fir; wreaths on cottage doors; robins + holly about greens.
- `src/festiveMusic.js` (new) — brass-band *In the Bleak Midwinter* synth, proximity/season gated.
- `src/main.js` — construct/drive/teardown `festiveMusic`; pass nearest-town distance + season.
- `src/entities.js` — Merlin winter re-robe (green/white Father Christmas) + relabel.
- `src/defs.js` / `src/textures.js` — wreath/holly/robin tiles + (if needed) a lit-window tile/emissive.
- `src/mesher.js` — (if windows are world blocks) warm emissive on window faces in winter; OR festiveLayer overlay on window cells.
- `scripts/verify-festive.mjs` — extend where pure (carol note-data parses; gating).

## Verification note

The carol synth, figures, wreaths, windows, robins, and Merlin's look are runtime — verified via the `window.game` drive (audio-node state, festiveLayer object counts, Merlin model/name in winter, console-error checks). Pure bits (carol data length, gating) unit-tested.

---

### Task 1: Carol-singer children by the fir

**Files:** Modify `src/festiveLayer.js`. Visual.

- [ ] **Step 1: Child-figure builder** — add `buildCaroller(i)` returning a small `THREE.Group`: a child-sized figure (smaller than a villager) — a coat-coloured body box, a head (skin), a winter hat, and (optional) a tiny songbook box held up. Vary coat colour by `i` (a few festive wools). Reuse the `entities.js` `box(...)` helper if convenient, or build directly with Box/Sphere + MeshLambertMaterial. Feet at group origin.
- [ ] **Step 2: Place a group by the fir** — in `festiveLayer.build()`, for each village that got a fir (reuse `firPlacement(v)`), place a fixed cluster of ~4 carollers a couple of blocks from the fir on open ground, arranged in a rough semicircle **facing the fir** (set each Group's `rotation.y` toward the fir), deterministic positions. Winter-only (already gated by `festiveActive`). Add to `this.objects` (so `clear()` disposes them).
- [ ] **Step 3: Build + live check** — `npm run build` (exit 0). Drive the game at a village in winter: festive objects now include ~4 caroller groups near the fir, facing it; gone in summer. No console errors. Report counts.
- [ ] **Step 4: Commit** — `git add src/festiveLayer.js && git commit -m "feat(festive): carol-singing children gathered by the fir"` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 2: Brass-band *In the Bleak Midwinter* near towns

**Files:** Create `src/festiveMusic.js`; Modify `src/main.js`. Audio.

- [ ] **Step 1: The synth** — create `src/festiveMusic.js`: a small WebAudio engine that plays *In the Bleak Midwinter* (Holst's public-domain "Cranham" melody) with a **brass-band timbre**, looping with a rest between verses, at low volume. Design:
  - A `FestiveMusic` class taking the game's `AudioContext` (reuse the existing audio context from `this.audio` — find it; do NOT create a second context).
  - A **brass voice**: per note, a couple of detuned `sawtooth`/`square` oscillators through a `lowpass` `BiquadFilter` (cutoff ~1.2–2 kHz) + a gentle ADSR `GainNode` (soft attack, mild sustain) → a master gain (low, ~0.12) → destination. This reads as a mellow brass band, not a chiptune.
  - A **melody** array of `[midi, beats]` — the Cranham tune (verse). Use this as a starting encoding (transpose/tune to taste — it's data James can refine); tempo ~66 bpm (a slow carol). APPROX Cranham phrase 1–2 (key of C), label it clearly as tunable:
    ```js
    // In the Bleak Midwinter (Holst, Cranham) — APPROX verse melody, tune to taste.
    // midi 60=C4. [midiOrNull, beats]; null = rest.
    export const CRANHAM = [
      [67,1],[67,1],[69,1],[67,1],  [72,2],[71,2],
      [67,1],[67,1],[69,1],[67,1],  [74,2],[72,2],
      [67,1],[67,1],[76,1],[74,1],  [72,2],[71,2],
      [69,1],[69,1],[71,1],[69,1],  [67,3],[null,1],
    ];
    ```
  - A scheduler: when "playing", schedule notes ahead on the audio clock (lookahead loop, e.g. via `setTimeout` polling or scheduled `start/stop`), loop with a ~2-beat rest, and ramp the master gain by a `setVolume(v)` (0 = silent) so `main.js` can fade by proximity.
  - `start()`, `stop()`, `setVolume(v)`. Idempotent start.
- [ ] **Step 2: Drive from `main.js`** — each frame (only while playing), compute the nearest village distance to the player and a target volume = winter? a soft curve (full within the village, fading to 0 by ~60 blocks out, 0 outside winter): `const v = festiveActive(this.season) ? clamp(1 - dist/60) * 0.12 : 0; this.festiveMusic.setVolume(v);`. Construct `this.festiveMusic` once (lazily on first user gesture / when audio is enabled — match how `this.audio` is gated by a user gesture, since browsers block audio before interaction). Stop/teardown on world exit.
- [ ] **Step 3: Build + live check** — `npm run build` (exit 0). Drive the game (audio needs a user gesture — in the eval, resume the context): near a village in winter, `festiveMusic` is started and its master gain > 0; move far / set summer → volume 0. Confirm the audio graph is running (a node exists, gain follows distance) and NO second AudioContext was created. No console errors. (You can't "hear" it in the harness — assert the graph/gain state.)
- [ ] **Step 4: Commit** — `git add src/festiveMusic.js src/main.js && git commit -m "feat(festive): brass-band In the Bleak Midwinter near towns in winter"` + trailer.

---

### Task 3: Merlin → green-and-white Father Christmas

**Files:** Modify `src/entities.js`. Visual.

- [ ] **Step 1: Father Christmas re-robe** — read the Merlin `wizardify`/re-robe (`entities.js` ~541–564) + where it's applied (`isMerlin` ~792). Add a **winter** variant: when the villager is Merlin AND it's winter (`festiveActive(season)` — thread the season in, or read the game's current season), re-robe him as a **period-accurate Father Christmas**: a **green** robe with **white** fur trim (recolour body/arms/legs green `0x2f6e4f`, add white trim at hem/cuffs/collar), keep his white **beard** (he already has one), a green hood or wide hat with white trim. Reuse the existing re-robe scaffolding (it already recolours the body + adds a beard/robe/hat — swap the indigo wizard palette for green/white and the pointed hat for a hood/Father-Christmas hat). Outside winter he stays the indigo wizard.
- [ ] **Step 2: Relabel** — Merlin's floating name reads **"Father Christmas"** in winter, reverting to "Merlin" otherwise. Find where the NPC name label is set/drawn and override it for Merlin when `festiveActive(season)`.
- [ ] **Step 3: Re-robe on season change** — ensure the look + label swap when the season crosses winter's edge (rebuild/recolour Merlin's model on the change, or recompute each spawn). Don't fight his existing wizard glow (keep a gentle glow or drop it for the FC look — your call, period-appropriate).
- [ ] **Step 4: Build + live check** — `npm run build` (exit 0). Drive the game: in winter, the Merlin NPC shows green/white robes + his name reads "Father Christmas"; in summer he's the indigo wizard named "Merlin". (Spawn/find Merlin or inspect his model's materials + the label string.) No console errors. Report what you confirmed.
- [ ] **Step 5: Commit** — `git add src/entities.js && git commit -m "feat(festive): Merlin becomes a green Father Christmas in winter"` + trailer.

---

### Task 4: Wreaths on doors, robins & holly

**Files:** Modify `src/festiveLayer.js`, `src/defs.js`, `src/textures.js`. Visual.

- [ ] **Step 1: Tiles** — add tiles (next-free `TILE` ids) for a **holly wreath** (a green ring with red berries), a **robin** (small brown bird, red breast), and a **holly sprig** (green leaves + red berries). Add painters in `textures.js`. (These render as cutout-style billboards via the festive layer; no new world blocks needed.)
- [ ] **Step 2: Wreaths on cottage doors** — in `festiveLayer.build()`, for cottages in range, find each door and place a wreath billboard on it (winter-only). Read how buildings/doors are located (village building data / a door block id); place a small wreath quad on the door face. If exact door detection is hard, place a wreath on each cottage's front face deterministically.
- [ ] **Step 3: Robins & holly** — scatter a few **holly sprigs** and the odd **robin** billboard about the village greens (deterministic, sparse, winter-only), reusing the snowman/figure placement approach (green/closes cells). Render as small cutout quads (reuse a cross-quad helper, or `floraLayer`'s `crossGeom` style) added to `this.objects`.
- [ ] **Step 4: Build + live check** — `npm run build` (exit 0). Winter at a village: wreaths on cottage doors, the odd robin + holly on the green; gone in summer. No console errors. Report counts.
- [ ] **Step 5: Commit** — `git add src/festiveLayer.js src/defs.js src/textures.js && git commit -m "feat(festive): door wreaths, robins and holly about the greens"` + trailer.

---

### Task 5: Candlelit windows

**Files:** Modify `src/festiveLayer.js` (or `src/mesher.js`), `src/textures.js`/`src/defs.js`. Visual.

- [ ] **Step 1: Approach** — make cottage **windows glow warm** in winter (candlelight from within). Simplest robust route: a small **warm billboard** (unlit `MeshBasicMaterial`-style cutout, warm `0xffdf8a`) placed over each window cell by the festive layer in winter (like the wreaths) — reads as a lit pane without a lighting engine. (Alternative: a warm emissive on the window block's tile via the snow/glint shader pattern in `mesher.js` — only if window blocks are easily identified; the overlay billboard is simpler.) Choose the overlay-billboard route unless windows are trivially shader-able.
- [ ] **Step 2: Place on windows** — find window cells/blocks on cottages (a `B.WINDOW`/glass block id, or the building data) and place a warm glow billboard on each in winter. Deterministic; winter-only; added to `this.objects`.
- [ ] **Step 3: Build + live check** — `npm run build` (exit 0). Winter at a village (especially at dusk/night): cottage windows glow warm; gone in summer. No console errors. Report counts.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(festive): candlelit cottage windows in winter"` + trailer.

---

### Task 6: Verify

- [ ] **Step 1:** `npm run verify` → all `RESULT: PASS`, exit 0. Add any pure assertions (carol data parses + non-empty; gating) to `verify-festive.mjs` if not already covered, and ensure it's still wired.
- [ ] **Step 2:** Fix anything red; commit only if a fix was made.

---

## Self-Review

**Spec coverage (Plan 3 slice):** carol singers ✓ T1; brass-band carol ✓ T2; Merlin → Father Christmas + relabel ✓ T3; wreaths + robins + holly ✓ T4; candlelit windows ✓ T5; verify ✓ T6. Snowmen/fir were Plans 1–2; polish is Plan 4.

**Placeholder scan:** the carol melody is provided as concrete (tunable) data; figures/wreaths/windows are visual with explicit structure + live checks; Merlin re-robe references the real `wizardify` scaffolding to adapt. "Find the door/window/label code" are necessary lookups, not placeholders.

**Type/name consistency:** `festiveMusic` (T2) constructed/driven in `main.js`, gated by `festiveActive` + nearest-village distance. Carol `CRANHAM` data consumed by the synth. Figures/wreaths/robins/holly/windows all added to `festiveLayer.objects` so `clear()` disposes them (geometry+material, per Plan 1's fix). Merlin re-robe reuses the existing villager re-robe path. `festiveActive` season-state object passed (from `this.season`).

**Open risks (validate during execution):**
- **Carol tune accuracy:** the `CRANHAM` array is an approximation James can correct by ear — the engineering (brass synth + near-town/winter gating + no second AudioContext) is the deliverable; flag the tune as tunable.
- **AudioContext + user-gesture:** browsers block audio before interaction — construct/resume `festiveMusic` on the same gesture that enables `this.audio`; never create a second context. Confirm.
- **Merlin re-robe timing + glow:** the look+label must swap cleanly at winter's edge (rebuild his model on change); don't break the wizard path or leave a stale glow. He's `clint-body`/name 'merlin'.
- **Door/window detection:** if exact door/window cells are hard to find, fall back to deterministic per-cottage placement (front face) — note the approach used.
- **Billboard glow at night:** warm window/`MeshBasicMaterial` billboards read bright day+night (candlelight) — confirm they don't look odd in daylight; tune warmth.
- **Teardown:** all new festive objects must be in `this.objects` and disposed by `clear()`; `festiveMusic` stopped on world exit; carol volume 0 outside winter/away from towns.
