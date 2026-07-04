// A cinematic season/location tour — hero shots across the moor for marketing footage.
// Runs from the dev/live console: `moorstead.debug.showreel()` plays a curated playlist and
// (by default) records the CANVAS ONLY to a clean .webm you can drop into any editor — no HUD,
// no crosshair, no window chrome, because captureStream reads the WebGL buffer, not the page.
// `moorstead.debug.showreelStop()` aborts. James 2026-07-04 (LinkedIn reel).
//
// Each beat: warp the (frozen, creative) player so chunks stream at the target, force the season /
// time / weather, pin a photo camera framed on the spot, let the terrain settle OFF-camera, then
// slowly orbit while recording. The recorder is PAUSED over each warp+settle so chunk-pop never
// makes the cut — the beats join as clean hard cuts you can cross-fade in an editor.

const WATER = 26;                                    // WATER_LEVEL — keep coastal cameras above the sea
export const clamp01 = t => Math.max(0, Math.min(0.999, t));

// The default hero playlist: varied locations AND seasons, to show the range. Coords are real
// village/landmark anchors (geo.villages). phase: 0..1 year (0.20 spring, 0.45 summer, 0.70 autumn,
// 0.88 winter). time: 0..1 day (0.28 dawn, 0.5 noon, 0.72 gold, 0.82 dusk). festival overrides phase.
// dist/height frame the orbit; az0->az1 (radians) is the slow sweep across the beat.
export const DEFAULT_BEATS = [
  { name: 'Summer on the high moor',   x: 1654, z: 1784, phase: 0.42, time: 0.30, weather: 'clear', dist: 24, height: 17, az0: 0.2,  az1: 0.9 },   // Danby high moor, heather
  { name: 'Whitby harbour & abbey',    x: 1790, z: 3046, phase: 0.44, time: 0.72, weather: 'clear', dist: 30, height: 22, az0: 2.3,  az1: 3.0 },   // the coast, golden hour
  { name: 'Autumn in the dale',        x: 1594, z: 2121, phase: 0.66, time: 0.40, weather: 'misty', dist: 20, height: 13, az0: -0.4, az1: 0.3 },   // Lealholm, Esk valley
  { name: 'First snow',                x: 1150, z: 2610, phase: 0.90, time: 0.46, weather: 'misty', dist: 21, height: 14, az0: 0.6,  az1: 1.3 },   // Goathland under snow
  { name: 'The moors line',            x: 1415, z: 2606, phase: 0.18, time: 0.44, weather: 'clear', dist: 18, height: 10, az0: 1.7,  az1: 2.3 },   // Grosmont, steam railway
  { name: 'Coble coast at Staithes',   x: 2319, z: 2276, phase: 0.44, time: 0.60, weather: 'clear', dist: 24, height: 16, az0: 3.4,  az1: 4.0 },   // fishing village & sea
  { name: 'Bonfire Night',             x: 1421, z: 3408, festival: 'bonfire', phase: 0.78, time: 0.83, weather: 'clear', dist: 18, height: 11, az0: 0.9, az1: 1.5 }, // Robin Hood's Bay, dusk
  { name: 'Dawn over the bay',         x: 1421, z: 3408, phase: 0.42, time: 0.28, weather: 'clear', dist: 34, height: 26, az0: 2.6,  az1: 3.4 },   // wide hero pull-back
];

const groundAt = (g, x, z) => {
  const gy = g.world.gen.geo.height(Math.round(x), Math.round(z));
  return Math.max(gy == null ? WATER : gy, WATER);   // never sit the camera under the sea
};

// PURE: the camera pose for a beat at sweep fraction u (0..1). Orbits at `dist`/`height` around the
// target, looking at it. `ground(x,z)` supplies terrain height (injected so this is unit-testable).
export function cameraPose(beat, u, ground) {
  const az = beat.az0 + (beat.az1 - beat.az0) * Math.max(0, Math.min(1, u));
  const x = beat.x + Math.sin(az) * beat.dist;
  const z = beat.z + Math.cos(az) * beat.dist;
  const y = ground(x, z) + beat.height;
  const ty = ground(beat.x, beat.z) + (beat.lookUp != null ? beat.lookUp : 3);   // look a touch above the ground
  return { x, y, z, lookAt: { x: beat.x, y: ty, z: beat.z } };
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

// force the drawing buffer to an exact size (e.g. 1920x1080) so the capture is a true 16:9 1080p
// regardless of the window/DPR — mirrors main.applyResolution's uniform plumbing, restored on end.
function forceSize(g, w, h) {
  g.camera.aspect = w / h; g.camera.updateProjectionMatrix();
  g.renderer.setPixelRatio(1); g.renderer.setSize(w, h, false);   // false: leave CSS layout, only the buffer
  if (g.composer) { g.composer.setPixelRatio(1); g.composer.setSize(w, h); }
  if (g.fxaaPass) g.fxaaPass.material.uniforms.resolution.value.set(1 / w, 1 / h);
  if (g.gradePass) g.gradePass.uniforms.uTexel.value.set(1 / w, 1 / h);
}
function restoreSize(g) {
  g.camera.aspect = window.innerWidth / window.innerHeight; g.camera.updateProjectionMatrix();
  g.applyResolution && g.applyResolution();
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

export function stopShowreel(g) { g._showreelAbort = true; return 'stopping after this beat'; }

// Drive the whole reel. Returns a promise that resolves when done (or aborted).
export async function runShowreel(g, opts = {}) {
  if (!g.world || !g.player || !(g.world.gen && g.world.gen.geo)) return 'no world loaded — start a world first';
  if (g._showreelRunning) return 'a showreel is already running (moorstead.debug.showreelStop() to end it)';

  const beats = opts.beats || DEFAULT_BEATS;
  const beatMs = (opts.beatSec != null ? opts.beatSec : 5.5) * 1000;
  const settleMs = (opts.settleSec != null ? opts.settleSec : 3.5) * 1000;
  const fps = opts.fps != null ? opts.fps : 60;
  const record = opts.record !== false;
  const force1080 = opts.force1080 !== false;
  const ground = (x, z) => groundAt(g, x, z);

  g._showreelRunning = true; g._showreelAbort = false;

  // stash everything we touch, to put back at the end
  const saved = {
    pos: { ...g.player.pos }, vel: { ...g.player.vel }, creative: g.player.creative,
    season: g.seasonOverride, weather: g.sky.weatherOverride,
    held: g.heldSprite && g.heldSprite.visible, hl: g.highlight && g.highlight.visible, photo: g._photoCam,
  };
  g.player.creative = true;                          // nowt kills or moves the frozen player
  if (g.heldSprite) g.heldSprite.visible = false;    // no viewmodel in shot
  if (g.highlight) g.highlight.visible = false;      // no block outline in shot
  if (force1080) forceSize(g, 1920, 1080);

  let recorder = null; const chunks = [];
  if (record) {
    try {
      const stream = g.renderer.domElement.captureStream(fps);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => window.MediaRecorder.isTypeSupported(m)) || 'video/webm';
      recorder = new window.MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.bitrate || 12000000 });
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.start();
      recorder.pause();                              // resume only while a beat is held
    } catch (e) { console.warn('[showreel] recording unavailable, running preview only:', e); recorder = null; }
  }

  const orbit = (beat) => new Promise(res => {
    const start = performance.now();
    const step = () => {
      const u = Math.min(1, (performance.now() - start) / (beat.sec != null ? beat.sec * 1000 : beatMs));
      g._photoCam = cameraPose(beat, u, ground);
      if (u >= 1 || g._showreelAbort) return res();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  try {
    for (let i = 0; i < beats.length && !g._showreelAbort; i++) {
      const b = beats[i];
      // conditions: festival (falls back to phase if the id's unknown), else season phase; time; weather
      if (b.festival) { const r = g.debug.festival(b.festival); if (r && r.error && b.phase != null) g.debug.setSeason(b.phase); }
      else if (b.phase != null) g.debug.setSeason(b.phase);
      if (b.time != null) g.debug.setTime(b.time);
      g.debug.setWeather(b.weather || null);
      // warp the player so the target's chunks stream in, and frame the opening pose at once
      const gy = ground(b.x, b.z);
      g.player.pos = { x: b.x + 0.5, y: gy + 2, z: b.z + 0.5 };
      g.player.vel = { x: 0, y: 0, z: 0 };
      g._photoCam = cameraPose(b, 0, ground);
      console.log(`[showreel] beat ${i + 1}/${beats.length}: ${b.name}`);
      await sleep(settleMs);                         // let terrain build OFF-camera (recorder paused)
      if (g._showreelAbort) break;
      if (recorder) recorder.resume();
      await orbit(b);
      if (recorder) recorder.pause();
    }
  } finally {
    if (recorder && recorder.state !== 'inactive') {
      await new Promise(res => { recorder.onstop = res; recorder.stop(); });
      if (chunks.length) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        downloadBlob(new Blob(chunks, { type: chunks[0].type || 'video/webm' }), `moorstead-showreel-${stamp}.webm`);
      }
    }
    // put the world back the way we found it
    if (force1080) restoreSize(g);
    g._photoCam = saved.photo || null;
    g.sky.weatherOverride = saved.weather;
    g.debug.setSeason(saved.season);                 // also re-snaps the lying snow to the real season
    g.player.creative = saved.creative;
    g.player.pos = saved.pos; g.player.vel = saved.vel;
    if (g.heldSprite) g.heldSprite.visible = saved.held;
    if (g.highlight) g.highlight.visible = saved.hl;
    g._showreelRunning = false;
    console.log('[showreel] done — the clip should be downloading if recording was on.');
  }
  return `showreel finished (${beats.length} beats)`;
}
