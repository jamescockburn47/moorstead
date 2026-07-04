// Showreel: the cinematic marketing tour (src/showreel.js). The recording/DOM/WebGL parts are
// browser-only, but the CAMERA MATH and the PLAYLIST are pure — guard them here so a bad beat or a
// broken orbit is caught before it wastes a take. run: node scripts/verify-showreel.mjs

import { DEFAULT_BEATS, cameraPose, clamp01 } from '../src/showreel.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };

const flat = () => 0;                                 // ground at y=0 everywhere, for pose maths
const KNOWN_FESTIVALS = ['easter', 'mayday', 'midsummer', 'harvest', 'bonfire', 'yule'];

// 1. the playlist is well-formed — every beat frames a real spot with a season or festival
{
  let good = DEFAULT_BEATS.length >= 4;
  for (const b of DEFAULT_BEATS) {
    const okBeat = typeof b.name === 'string' && Number.isFinite(b.x) && Number.isFinite(b.z) &&
      b.dist > 0 && b.height > 0 && Number.isFinite(b.az0) && Number.isFinite(b.az1) &&
      ((b.phase != null && b.phase >= 0 && b.phase < 1) || (b.festival && KNOWN_FESTIVALS.includes(b.festival)));
    if (!okBeat) { good = false; console.log('       bad beat:', JSON.stringify(b)); }
  }
  (good ? ok : bad)(`all ${DEFAULT_BEATS.length} beats are well-formed (coords + dist/height + season|festival)`);
}

// 2. the playlist actually VARIES season and location (that's the whole point of the reel)
{
  const phases = new Set(DEFAULT_BEATS.map(b => b.festival ? 'f:' + b.festival : Math.round((b.phase || 0) * 20)));
  const spots = new Set(DEFAULT_BEATS.map(b => b.x + ',' + b.z));
  (phases.size >= 4 ? ok : bad)(`the reel spans a range of seasons/festivals (${phases.size} distinct)`);
  (spots.size >= 5 ? ok : bad)(`the reel visits a range of locations (${spots.size} distinct spots)`);
}

// 3. cameraPose orbits at the right radius, at the right height, looking AT the target
{
  const b = { x: 100, z: 200, dist: 24, height: 17, az0: 0.2, az1: 0.9 };
  const p = cameraPose(b, 0.5, flat);
  const r = Math.hypot(p.x - b.x, p.z - b.z);
  (Math.abs(r - b.dist) < 1e-6 ? ok : bad)(`camera sits at the framed distance from the target (r=${r.toFixed(2)}, want ${b.dist})`);
  (Math.abs(p.y - b.height) < 1e-6 ? ok : bad)(`camera height = ground + framing height (y=${p.y}, want ${b.height})`);
  (p.lookAt && p.lookAt.x === b.x && p.lookAt.z === b.z ? ok : bad)(`camera looks AT the target spot (lookAt ${p.lookAt.x},${p.lookAt.z})`);
  (p.lookAt && p.lookAt.y > 0 ? ok : bad)(`the look point sits a touch above the ground (y=${p.lookAt.y})`);
}

// 3g. FIXED altitude: over VARIED terrain the camera Y must NOT step as it sweeps (it holds a
// constant height off the target's ground, like the title flyover — not the moving camera's ground)
{
  const bumpy = (x) => Math.floor(x / 3) % 5;         // ground jumps around as x changes
  const b = { x: 50, z: 50, dist: 20, height: 15, az0: 0, az1: 3 };
  const y0 = cameraPose(b, 0, bumpy).y, ymid = cameraPose(b, 0.5, bumpy).y, y1 = cameraPose(b, 1, bumpy).y;
  (y0 === ymid && y0 === y1 ? ok : bad)(`the orbit holds a FIXED altitude over varied terrain — no stepping (y=${y0})`);
}

// 4. the orbit sweeps — start and end poses differ (a moving camera, not a freeze-frame)
{
  const b = { x: 0, z: 0, dist: 20, height: 12, az0: 0.2, az1: 0.9 };
  const a = cameraPose(b, 0, flat), c = cameraPose(b, 1, flat);
  ((a.x - c.x) ** 2 + (a.z - c.z) ** 2 > 1 ? ok : bad)(`the camera sweeps across the beat (start != end)`);
}

// 5. clamp01 keeps overrides inside the engine's 0..0.999 band (no wrap to midnight / new year)
{
  (clamp01(-1) === 0 && clamp01(2) === 0.999 && Math.abs(clamp01(0.5) - 0.5) < 1e-9 ? ok : bad)(`clamp01 keeps phase/time inside [0, 0.999]`);
}

// 6. the orbit fraction is clamped inside cameraPose too (u past the ends doesn't fling the camera)
{
  const b = { x: 0, z: 0, dist: 20, height: 12, az0: 0.2, az1: 0.9 };
  const end = cameraPose(b, 1, flat), over = cameraPose(b, 5, flat);
  (Math.abs(end.x - over.x) < 1e-9 && Math.abs(end.z - over.z) < 1e-9 ? ok : bad)(`sweep fraction is clamped (u>1 holds the final pose)`);
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
