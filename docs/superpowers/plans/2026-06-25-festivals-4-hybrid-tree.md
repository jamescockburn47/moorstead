# Festivals Slice 4 — Hybrid Christmas Tree Implementation Plan

> REQUIRED SUB-SKILL: subagent-driven-development.

**Goal:** Make the Christmas scene period-accurate (spec §4): re-site the communal fir beside the **chapel** (not dead-centre on the green), **drop the present heap** under the public tree, add **parlour-window trees** in the better-off homes (farmhouse + a sparse few cottages), and **deck the church** in holly/ivy greenery.

**Architecture:** All changes are in `src/festivals/christmas.js` (the Christmas builder moved in Slice 2). Building-type-aware: villages have `chapel`/`pub`/`shop`/`farmhouse`/`barn`/`cottage` buildings (`v.buildings[]` with `{x0,x1,z0,z1,g,type}`). Reuse the existing `addBillboard`/`addWindowGlow` kit + tiles.

**Scope:** Slice 4. Christmas-tree candle flames stay on the cheap emissive flicker (NOT upgraded to `Fire` — YAGNI, 28 flame billboards/tree is not worth it). One file changed.

---

### Task 1: Christmas refit (`festivals/christmas.js`)

**Files:** Modify `src/festivals/christmas.js`.

Changes (read the current file + `src/moorsgeo.js` building stamps + `src/textures.js`/`defs.js` for tiles first):

1. **Re-site the fir by the chapel.** Add a placement that finds the village's `chapel` building and sites the fir on open ground just outside it (e.g. a few blocks off the chapel's south/front face, clear of the building footprint). Fall back to the existing `firPlacement` (green/cross area) if the village has no chapel in range. The fir + carollers move with it.
2. **Drop the present heap.** Remove the `buildPresents(...)` call from the fir assembly (delete the call; the function can stay unused or be removed). The candlelit tree stands alone.
3. **Parlour-window trees.** In the building loop, for the **farmhouse** (always) and a **sparse deterministic subset of cottages** (hash-gate ~1–2 per village), add a small **lit tree behind a front window**: a tiny green tree silhouette (a few green quads/cubes ≈ 1 block tall) placed just inside the front (south) window, plus the warm window-glow behind it so it reads as lit. Distinct from the generic candlelit-window glow.
4. **Deck the church.** For the `chapel` building, add holly/ivy **greenery** along the front wall + door (reuse `TILE.HOLLY_SPRIG` billboards as swags, several across the chapel face). Greenery, not a tree.

**Steps:**
- [ ] Read `festivals/christmas.js`, the building structure in `moorsgeo.js`, and available tiles.
- [ ] Implement the four changes. Keep the fir/dressFir/caroller/wreath/glow/holly/robin code otherwise intact.
- [ ] `npm run build` passes (the layer compiles). `npm run verify` exits 0.
- [ ] Commit:
```
git add src/festivals/christmas.js && git commit -m "feat(festivals): hybrid Christmas tree — fir by the chapel, no public presents, parlour-window trees, decked church

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 2: Verify (controller)
- [ ] Build + boot clean. Best-effort live scene check: at `moorstead.debug.festival('yule')` near a village with a chapel, the fir sits by the chapel, no presents under it, the farmhouse shows a window-tree, the chapel has greenery. (If the backgrounded preview can't drive a full world, rely on build + review; it deploys for live confirmation.)

## Self-review notes
- Period accuracy is the point: domestic trees (parlour windows) + church greenery are in-period; the public green tree + presents are the anachronism being corrected (re-sited to the chapel as "the parish/squire's gift", presents removed).
- Single file; the fir-placement fallback keeps villages without a chapel working.
