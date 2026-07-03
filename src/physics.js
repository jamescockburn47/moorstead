// Voxel AABB collision and DDA raycast.
import { isSolid, HEIGHT, B } from './defs.js';

// Does an AABB centred at (x,z) with half-width hw, feet at y, height h, overlap any solid block?
// passGate: if set, a field gate (B.GATE) stands open to this body (it's not solid to it).
export function boxCollides(world, x, y, z, hw, h, passGate = false) {
  const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw);
  const y0 = Math.floor(y), y1 = Math.floor(y + h - 0.001);
  const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw);
  for (let bx = x0; bx <= x1; bx++)
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++) {
        const id = world.getBlock(bx, by, bz);
        if (passGate && id === B.GATE) continue; // a gate stands open to this body
        if (isSolid(id)) return true;
      }
  return false;
}

// Move an entity axis by axis. ent: {pos:{x,y,z}, vel:{x,y,z}, hw, h, onGround}
export function moveEntity(world, ent, dt) {
  const p = ent.pos, v = ent.vel;
  ent.hitWall = false;
  const pg = ent.passGate;

  // Y
  let ny = p.y + v.y * dt;
  if (boxCollides(world, p.x, ny, p.z, ent.hw, ent.h, pg)) {
    if (v.y < 0) {
      ny = Math.floor(p.y + v.y * dt) + 1.0001;
      if (boxCollides(world, p.x, ny, p.z, ent.hw, ent.h, pg)) ny = p.y;
      ent.onGround = true;
    } else {
      ny = p.y;
    }
    v.y = 0;
  } else {
    ent.onGround = false;
  }
  p.y = ny;

  // X
  let nx = p.x + v.x * dt;
  if (boxCollides(world, nx, p.y, p.z, ent.hw, ent.h, pg)) {
    nx = p.x; v.x = 0; ent.hitWall = true;
  }
  p.x = nx;

  // Z
  let nz = p.z + v.z * dt;
  if (boxCollides(world, p.x, p.y, nz, ent.hw, ent.h, pg)) {
    nz = p.z; v.z = 0; ent.hitWall = true;
  }
  p.z = nz;
}

// If an entity has ended up wedged inside solid blocks, free it.
// Tries gentle upward nudges first, then sets it on t' surface. Returns true
// if the entity was stuck and has been moved.
export function unstick(world, ent) {
  if (!boxCollides(world, ent.pos.x, ent.pos.y, ent.pos.z, ent.hw, ent.h)) return false;
  for (let dy = 0.25; dy <= 3; dy += 0.25) {
    if (!boxCollides(world, ent.pos.x, ent.pos.y + dy, ent.pos.z, ent.hw, ent.h)) {
      ent.pos.y += dy;
      ent.vel.y = 0;
      return true;
    }
  }
  // proper buried: pop up to t' surface
  const bx = Math.floor(ent.pos.x), bz = Math.floor(ent.pos.z);
  for (let y = HEIGHT - 2; y > 0; y--) {
    if (isSolid(world.getBlock(bx, y, bz))) {
      ent.pos.y = y + 1.01;
      ent.vel.x = 0; ent.vel.y = 0; ent.vel.z = 0;
      return true;
    }
  }
  return true;
}

// ---- Swimming an' t' river current (James 2026-07-03: "the river doesn't seem to
// bring a player downstream. we should have a 'swim' function too.") ----
// Pure helpers: player.js integrates them; scripts/verify-swim.mjs tests them.
// This is client-local MOVEMENT physics, same class as walking an' knockback — not
// shared world state (outside INVARIANTS rule 6's scope) — though t' current itself
// is deterministic per column (a pure function of position via geo.riverFlow).

export const SWIM = {
  SPEED_MUL: 0.55,    // stroke pace as a share o' walk/sprint (gentle — swimming, not racing)
  ACCEL: 5.5,         // how quick velocity bends to t' stroke — water drag, both ways
  V_ACCEL: 4.5,       // vertical drag: how fast rise/sink bends to t' wish…
  V_ACCEL_HARD: 8,    // …an' t' harder brake when tha's plunging in fast (watter slaps back)
  SINK_V: -0.45,      // let go o' everything: a slow sink under heavy drag, not a plummet
  RISE_V: 2.6,        // Space held: a good upward kick
  DIVE_V: 2.2,        // Shift held: swim down
  TREAD_EYE: 0.08,    // treading holds thi eyes this far ABOVE t' waterline (breathing = default)
  TIRED_SINK: -0.42,  // wearied treading sags — thi head slips under (t' open sea stays a real danger)
  TREAD_BAND: 1.6,    // how near t' surface (eye vs waterline) afore t' tread float takes
                      // hold — 1.6 reaches a swimmer stood on a 3-deep bed (rivers are ≤2
                      // deep, BED_DEPTH), so falling in an' doing NOWT still ends breathing
  TREAD_SPRING: 3.0,  // stiffness o' t' float toward t' waterline
  CURRENT_BASE: 3.2,  // mid-channel downstream drift, blocks/s (× bank — gentle at t' edges)
  CURRENT_STEER: 1.4, // edge pull back toward mid-stream, blocks/s at bank→0 (a swimmer's
                      // 2.37 b/s stroke still beats it, so grabbing t' bank stays winnable)
  POCKET_PULL: 1.1,   // slack-pocket ease back into t' stream, blocks/s (also beatable)
};

// Where does t' water sit on t' body? Samples t' player's own column at feet (+0.3),
// chest (+1.1) an' eyes. surfaceY = world-y o' t' top face o' t' water ower t' chest
// (contiguous scan up), or null when t' chest is dry. Chest-deep = swimming; nobbut
// feet wet = wading on normal legs.
export function submersion(world, x, y, z, eye = 1.62) {
  const bx = Math.floor(x), bz = Math.floor(z);
  const w = (by) => world.getBlock(bx, by, bz) === B.WATER;
  const feet = w(Math.floor(y + 0.3));
  const chest = w(Math.floor(y + 1.1));
  const head = w(Math.floor(y + eye));
  let surfaceY = null;
  if (chest) {
    let by = Math.floor(y + 1.1);
    while (by + 1 < HEIGHT && w(by + 1)) by++;
    surfaceY = by + 1;
  }
  return { feet, chest, head, surfaceY };
}

// A stroke follows t' LOOK: forward swims where tha's looking (pitch an' all — look
// down to dive, up to rise), strafe stays level. Wish-velocity {x,y,z} in blocks/s.
export function swimWish(yaw, pitch, fwd, strafe, speed) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return {
    x: (-sy * cp * fwd + cy * strafe) * speed,
    y: sp * fwd * speed,
    z: (-cy * cp * fwd - sy * strafe) * speed,
  };
}

// What vertical speed does t' swimmer WANT this frame? Pure.
//  o = { lookY    — vertical part o' t' look-direction stroke (swimWish().y)
//        space    — jump held: upward kick        shift — crouch held: dive
//        stroking — any movement key held          diving — clearly headed down-look
//        eyeY, surfaceY — for treading (surfaceY null = chest dry / no surface found)
//        tiring   — wearied: t' tread sags under t' waterline (sea danger stays real)
//        bobT     — bob clock, seconds }
export function swimVerticalWish(o) {
  const wy = o.lookY || 0;
  if (o.shift) return Math.min(-SWIM.DIVE_V, wy);
  if (o.space) return Math.max(wy, SWIM.RISE_V);
  const nearSurface = o.surfaceY != null && o.eyeY > o.surfaceY - SWIM.TREAD_BAND;
  if (nearSurface && !o.diving) {
    // tread watter: bob wi' thi eyes at t' waterline — bairns don't sink by default
    const targetEye = o.surfaceY + (o.tiring ? SWIM.TIRED_SINK : SWIM.TREAD_EYE)
                    + Math.sin((o.bobT || 0) * 2.1) * 0.05;
    const spring = Math.max(-1.2, Math.min(1.6, (targetEye - o.eyeY) * SWIM.TREAD_SPRING));
    // an up-look stroke may breach t' surface; owt else, t' float owns thee (it must
    // be able to settle thee back DOWN as well as up, so no max() wi' a level stroke)
    return wy > 0 ? Math.max(wy, spring) : spring;
  }
  if (!o.stroking) return SWIM.SINK_V; // let go o' everything: a slow sink
  return wy;                           // mid-water stroke follows t' look
}

// One drag-integration step o' swim vertical motion. Pure. A hard entry (diving in
// off a bridge) bleeds off fast — watter brakes thee — so deep plunges stay shallow.
export function swimVerticalStep(vy, wishY, dt) {
  const a = Math.abs(vy) > 4 ? SWIM.V_ACCEL_HARD : SWIM.V_ACCEL;
  return vy + (wishY - vy) * Math.min(1, a * dt);
}

// Downstream drift for a river column. flow = geo.riverFlow(x,z) result ({tx,tz,s,bank})
// or null. Returns {x,z} blocks/s, or null off-river (sea an' tarns have no flow by
// construction). Linear in bank: full carry mid-channel, gentle at t' banks so tha
// can grab out at t' edge.
export function riverCurrent(flow, base = SWIM.CURRENT_BASE) {
  if (!flow || !(flow.bank > 0)) return null;
  const k = base * flow.bank;
  return { x: flow.tx * k, z: flow.tz * k };
}

// Steered current: t' plain tangent carry PLUS a gentle pull back toward mid-stream at
// t' edges. Round a bend, t' raw tangent shoves a rider at t' outer bank an' clean out
// o' t' flow field (live-observed in t' Esk at Grosmont, 2026-07-03: drift died after
// 2 blocks in a slack pocket); t' steer keeps a rider riding t' beck all t' way down.
// Pure: flowFn(x,z) → riverFlow shape ({tx,tz,s,bank}) or null.
export function steeredCurrent(flowFn, x, z, base = SWIM.CURRENT_BASE) {
  const f = flowFn(x, z);
  if (f && f.bank > 0) {
    const nx = -f.tz, nz = f.tx; // channel normal (left o' t' flow)
    const L = flowFn(x + nx, z + nz), R = flowFn(x - nx, z - nz);
    const lean = (L ? L.bank : 0) - (R ? R.bank : 0); // + = mid-channel lies to t' left
    const steer = Math.sign(lean) * (1 - f.bank) * SWIM.CURRENT_STEER;
    return {
      x: f.tx * base * f.bank + nx * steer,
      z: f.tz * base * f.bank + nz * steer,
    };
  }
  // slack pocket: watter just OFF t' flow field — t' carve is wider than t' flow index
  // at bends, an' t' field edge mustn't be a cliff where t' ride dies (live-observed at
  // Grosmont 2026-07-03: rider dumped after 2 blocks). Probe a small ring for t' stream
  // an' ease t' rider back into it (weaker than a stroke — tha can still mek t' bank).
  let best = null;
  for (const r of [1.5, 3]) {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      const g = flowFn(x + ox, z + oz);
      if (g && g.bank > 0 && (!best || g.bank > best.f.bank)) best = { f: g, ox, oz };
    }
    if (best) break;
  }
  if (!best) return null; // sea, tarns, dry pockets: genuinely no current
  const d = Math.hypot(best.ox, best.oz) || 1;
  const k = base * best.f.bank * 0.5; // half carry while tha's off t' main stream
  return {
    x: best.f.tx * k + (best.ox / d) * SWIM.POCKET_PULL,
    z: best.f.tz * k + (best.oz / d) * SWIM.POCKET_PULL,
  };
}

// Current at a column, guarded for t' stylised world (its Geography has no riverFlow —
// same typeof idiom as mesher.js's aFlow bake). geo may be null/undefined.
// T' SEA has no current: riverFlow's polyline tail runs past t' river mouth wi' no
// coastT check o' its own (live-observed off Whitby strand, 2026-07-03: t' "sea" near
// t' Esk mouth still pulled) — so t' current dies where brackish watter begins, t'
// same coastT ≤ 0.15 boundary snow.js uses for river-vs-sea freezing.
export function currentAt(geo, x, z, base) {
  if (!geo || typeof geo.riverFlow !== 'function') return null;
  if (typeof geo.coastT === 'function' && geo.coastT(x, z) > 0.15) return null;
  return steeredCurrent((xx, zz) => geo.riverFlow(xx, zz), x, z, base);
}

// DDA voxel raycast. Returns { x,y,z, face:[nx,ny,nz], dist } or null.
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, hitTest) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? (x + 1 - ox) : (ox - x)) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? (y + 1 - oy) : (oy - y)) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? (z + 1 - oz) : (oz - z)) * tDeltaZ : Infinity;
  let face = [0, 0, 0];
  let t = 0;

  for (let i = 0; i < 256; i++) {
    if (t > maxDist) return null;
    const id = world.getBlock(x, y, z);
    if (hitTest(id)) return { x, y, z, face, dist: t, id };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
  }
  return null;
}
