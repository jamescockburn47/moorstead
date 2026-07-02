// [16] The shoreline — depth-tinted water + foam fringe. Run wi': node scripts/verify-shoreline.mjs
//
// The contract this defends:
//   (a) waterDepthTint is pure: 1.0 at depth 1, 0.55 at depth 8, clamped past 8,
//       strictly monotone between, and amp 0 restores identity (the kill switch);
//   (b) a synthetic chunk wi' known water depths bakes monotonically DARKER vertex
//       colours on the liquid TOP faces — and side faces stay untinted (FACE_LIGHT only);
//   (c) foam: a sea-level WATER/SAND boundary emits flat quads into the CUTOUT builder
//       at surface + 0.01 (y = 26.89), aGlint = 1 on every foam vert (the compiled
//       cutout glint shimmers them for free), flora quads in the same geometry stay 0,
//       and the count is capped at FOAM_CAP (32) per chunk;
//   (d) no-coast water emits NO foam; river water (y != WATER_LEVEL) beside sand emits
//       none; BOG beside sand emits none — foam is the SEA meeting the strand, nowt else;
//   (e) TILE.FOAM exists, is unique, and its painter genuinely paints (fillRect calls
//       recorded inside the FOAM atlas cell during buildAtlas — headless, no pixels);
//   (f) determinism — two independent builds of the same shoreline chunk are
//       byte-identical (foam order, depth tints and all).
//
// Headless three.js builds fine (we never render); the atlas is satisfied by an
// INSTRUMENTED document stub (verify-water pattern + fillRect recording).

const paintCalls = [];
global.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const ctx2d = {
      clearRect: () => {}, drawImage: () => {}, fillStyle: '',
      fillRect: (x, y, w, h) => { paintCalls.push([x, y, w, h]); },
    };
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

import { B, CHUNK, HEIGHT, WATER_LEVEL, TILE } from '../src/defs.js';
import {
  initMaterials, getMaterials, buildChunkMeshes,
  waterDepthTint, DEPTH_TINT_AMP, FOAM_CAP,
} from '../src/mesher.js';
import { tileUV, ATLAS_TILES } from '../src/textures.js';

initMaterials();

let failed = false;
const ok  = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const IDX = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
const fakeWorld = { getBlock: () => B.AIR, gen: { geo: { coastT: () => 0 } } };
const build = (data) => buildChunkMeshes(fakeWorld, { cx: 0, cz: 0, data });
const meshOf = (meshes, mat) => meshes.find(m => m.material === getMaterials()[mat]);

console.log('\n-- [16] shoreline: depth tint + foam fringe --\n');

// --- (a) waterDepthTint: pure, bounded, monotone, killable -------------------
{
  (Math.abs(waterDepthTint(1) - 1) < 1e-12 ? ok : bad)('depth 1 -> tint 1.0 (shallows keep today’s colour exactly)');
  (Math.abs(waterDepthTint(8) - 0.55) < 1e-12 ? ok : bad)('depth 8 -> tint 0.55 (dark slate)');
  (waterDepthTint(12) === waterDepthTint(8) && waterDepthTint(40) === waterDepthTint(8)
    ? ok : bad)('clamped past depth 8');
  let mono = true;
  for (let d = 2; d <= 8; d++) if (!(waterDepthTint(d) < waterDepthTint(d - 1))) mono = false;
  (mono ? ok : bad)('strictly monotone darker frae depth 1 to 8');
  ([1, 3, 5, 8, 20].every(d => waterDepthTint(d, 0) === 1)
    ? ok : bad)('amp 0 is the kill switch — identity at every depth');
  (DEPTH_TINT_AMP === 1 ? ok : bad)(`DEPTH_TINT_AMP ships at 1 (got ${DEPTH_TINT_AMP})`);
}

// --- (b) synthetic chunk: known depths -> monotonically darker top colours ----
{
  const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  const cols = [[2, 1], [5, 2], [8, 4], [11, 8]]; // [x, depth] — all top faces at y=30
  for (const [x, d] of cols) {
    for (let i = 0; i < d; i++) data[IDX(x, 30 - i, 8)] = B.WATER;
    data[IDX(x, 30 - d, 8)] = B.STONE;
  }
  const lm = meshOf(build(data), 'liquid');
  if (!lm) bad('depth chunk builds a liquid mesh');
  else {
    ok('depth chunk builds a liquid mesh');
    const pos = lm.geometry.getAttribute('position');
    const norm = lm.geometry.getAttribute('normal');
    const col = lm.geometry.getAttribute('color');
    const topColOf = (x) => {
      for (let i = 0; i < pos.count; i++) {
        if (norm.getY(i) === 1 && pos.getX(i) >= x && pos.getX(i) <= x + 1
          && pos.getZ(i) >= 8 && pos.getZ(i) <= 9) return col.getX(i);
      }
      return null;
    };
    const got = cols.map(([x]) => topColOf(x));
    (got.every(c => c !== null) ? ok : bad)('every test column has a liquid TOP face');
    (Math.abs(got[0] - 1) < 1e-6 ? ok : bad)(`depth-1 top colour is exactly 1.0 (got ${got[0]})`);
    (Math.abs(got[3] - 0.55) < 1e-6 ? ok : bad)(`depth-8 top colour is 0.55 (got ${got[3]})`);
    (got[0] > got[1] && got[1] > got[2] && got[2] > got[3]
      ? ok : bad)(`top colours monotonically darker wi' depth (${got.map(c => c && c.toFixed(3)).join(' > ')})`);
    let sidesClean = true;
    for (let i = 0; i < pos.count; i++) {
      if (norm.getY(i) !== 0) continue; // side faces only
      const c = col.getX(i);
      if (Math.abs(c - 0.78) > 1e-6 && Math.abs(c - 0.68) > 1e-6) sidesClean = false;
    }
    (sidesClean ? ok : bad)('side faces untinted — depth tint lands on TOP faces only');
  }
}

// --- (c) foam: WATER/SAND boundary at sea level -> capped cutout quads --------
{
  const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  for (let z = 4; z < 12; z++) {
    data[IDX(6, WATER_LEVEL, z)] = B.SAND;
    data[IDX(7, WATER_LEVEL, z)] = B.WATER;   // 8 water cells abeam the strand
    data[IDX(7, WATER_LEVEL - 1, z)] = B.GRAVEL;
  }
  data[IDX(2, 28, 2)] = B.HEATHER;            // flora in the SAME cutout geometry
  const meshes = build(data);
  const cm = meshOf(meshes, 'cutout');
  if (!cm) bad('shoreline chunk builds a cutout mesh');
  else {
    ok('shoreline chunk builds a cutout mesh');
    const pos = cm.geometry.getAttribute('position');
    const gli = cm.geometry.getAttribute('aGlint');
    const uv = cm.geometry.getAttribute('uv');
    (gli && gli.itemSize === 1 && gli.count === pos.count
      ? ok : bad)('aGlint attribute baked on the chunk cutout geometry (the red-team gap: the builder never wrote it)');
    if (gli) {
      let foamV = 0, floraV = 0, yOK = true, uvOK = true;
      const [u0, v0, u1, v1] = tileUV(TILE.FOAM);
      const surfY = WATER_LEVEL + 1 - 0.12 + 0.01; // 26.89: 0.01 ABOVE the rippling surface
      for (let i = 0; i < pos.count; i++) {
        if (gli.getX(i) === 1) {
          foamV++;
          if (Math.abs(pos.getY(i) - surfY) > 1e-4) yOK = false;
          const u = uv.getX(i), v = uv.getY(i);
          if (u < u0 - 1e-6 || u > u1 + 1e-6 || v < v0 - 1e-6 || v > v1 + 1e-6) uvOK = false; // 1e-6: float32 attribute vs float64 tileUV
        } else floraV++;
      }
      (foamV === 8 * 4 ? ok : bad)(`exactly ONE foam quad per boundary water cell (${foamV / 4} quads for 8 cells)`);
      (yOK ? ok : bad)('every foam vert sits at surface + 0.01 (26.89) — ABOVE the water, depth-writing cutout');
      (uvOK ? ok : bad)('foam quads sample the TILE.FOAM payload rect');
      (floraV > 0 ? ok : bad)('flora quads share the geometry…');
      let floraZero = true;
      for (let i = 0; i < pos.count; i++) if (gli.getX(i) !== 1 && gli.getX(i) !== 0) floraZero = false;
      (floraZero ? ok : bad)('…and carry aGlint 0 (only foam shimmers)');
    }

    // (f) determinism: an independent second build is byte-identical
    const cm2 = meshOf(build(data), 'cutout');
    const lm1 = meshOf(meshes, 'liquid'), lm2 = meshOf(build(data), 'liquid');
    const same = (ga, gb, name) => {
      const a = ga.geometry.getAttribute(name), b = gb.geometry.getAttribute(name);
      if (!a || !b || a.array.length !== b.array.length) return false;
      return Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength)
        .equals(Buffer.from(b.array.buffer, b.array.byteOffset, b.array.byteLength));
    };
    (['position', 'aGlint', 'color', 'uv'].every(n => same(cm, cm2, n))
      ? ok : bad)('two independent builds: cutout (foam) buffers byte-identical');
    (['position', 'color'].every(n => same(lm1, lm2, n))
      ? ok : bad)('two independent builds: liquid (depth-tint) buffers byte-identical');
  }

  // cap: a 128-candidate checkerboard shoreline stops at FOAM_CAP exactly
  const big = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  for (let x = 0; x < CHUNK; x++) for (let z = 0; z < CHUNK; z++) {
    big[IDX(x, WATER_LEVEL, z)] = (x % 2 === 0) ? B.SAND : B.WATER;
  }
  const bm = meshOf(build(big), 'cutout');
  const bg = bm && bm.geometry.getAttribute('aGlint');
  let bFoam = 0;
  if (bg) for (let i = 0; i < bg.count; i++) if (bg.getX(i) === 1) bFoam++;
  (FOAM_CAP === 32 ? ok : bad)(`FOAM_CAP ships at 32 (got ${FOAM_CAP})`);
  (bFoam === FOAM_CAP * 4 ? ok : bad)(`128-candidate chunk capped at ${FOAM_CAP} foam quads (got ${bFoam / 4})`);
}

// --- (d) foam does NOT appear off the strand ----------------------------------
{
  const noFoam = (label, place) => {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    place(data);
    const cm = meshOf(build(data), 'cutout');
    const gli = cm && cm.geometry.getAttribute('aGlint');
    let foam = 0;
    if (gli) for (let i = 0; i < gli.count; i++) if (gli.getX(i) === 1) foam++;
    (foam === 0 ? ok : bad)(label);
  };
  noFoam('no-coast chunk (water beside DIRT) emits NO foam', (d) => {
    for (let z = 4; z < 12; z++) { d[IDX(6, WATER_LEVEL, z)] = B.DIRT; d[IDX(7, WATER_LEVEL, z)] = B.WATER; }
  });
  noFoam('river water (y != WATER_LEVEL) beside sand emits NO foam', (d) => {
    for (let z = 4; z < 12; z++) { d[IDX(6, 30, z)] = B.SAND; d[IDX(7, 30, z)] = B.WATER; }
  });
  noFoam('BOG beside sand emits NO foam (sea water only)', (d) => {
    for (let z = 4; z < 12; z++) { d[IDX(6, WATER_LEVEL, z)] = B.SAND; d[IDX(7, WATER_LEVEL, z)] = B.BOG; }
  });
}

// --- (e) TILE.FOAM: real row, unique, painter genuinely paints ----------------
{
  (Number.isInteger(TILE.FOAM) && TILE.FOAM >= 0 && TILE.FOAM < ATLAS_TILES * ATLAS_TILES
    ? ok : bad)(`TILE.FOAM is a real atlas tile id (${TILE.FOAM})`);
  const vals = Object.values(TILE);
  (vals.filter(v => v === TILE.FOAM).length === 1 && new Set(vals).size === vals.length
    ? ok : bad)('TILE ids stay collision-free wi’ FOAM added');
  // the instrumented stub recorded every fillRect during initMaterials' buildAtlas:
  // some must land inside FOAM's 16px payload (24px cell, 4px gutter — S1b geometry)
  const CELL = 24, PAD = 4, T = 16;
  const px = (TILE.FOAM % 16) * CELL + PAD, py = Math.floor(TILE.FOAM / 16) * CELL + PAD;
  const hits = paintCalls.filter(([x, y, w, h]) => x < px + T && x + w > px && y < py + T && y + h > py);
  (hits.length > 8 ? ok : bad)(`FOAM painter paints a non-empty payload headlessly (${hits.length} fillRects in its cell)`);
}

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
