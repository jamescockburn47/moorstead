// T' graphics probe — pure decision logic, no THREE, no DOM.
// verify-gfxprobe.mjs guards it; main.js feeds it t' machine's signals.
//
// T' Spire's tier method (t' Smooth Moor spec, Moot session): WebGPU is t'
// honest capability signal — a machine whose browser stands up a WebGPU
// adapter in 2026 has a real GPU an' current drivers; one that can't is owd
// metal, a blocklisted driver, or SOFTWARE GL pretendin' — exactly t' kit
// that lags under Fine. T' probe decides t' openin' tier; t' FPS WATCHDOG
// (fpsVerdict) keeps it honest at runtime an' only ever eases DOWN — a
// machine mun never stutter while t' game insists it shouldn't.
//
// T' player's own hand allus wins: an explicit stored 'fine'/'plain' (t'
// Graphics button) outranks every signal. T' watchdog's own downgrades
// arrive as stored 'auto-plain' so t' next boot opens easy WI'OUT lockin'
// t' player out o' choosin' Fine again.

// ---- t' openin' tier ----
// signals: {
//   stored:      'fine' | 'plain' | 'auto-plain' | null
//   touchPrimary: bool        (touch is t' primary input)
//   webgpu:      true | false | null   (adapter probe; null = not yet known)
//   rendererStr: string|null  (WEBGL_debug_renderer_info UNMASKED_RENDERER)
//   deviceMemory: number|null (navigator.deviceMemory, GB)
//   cores:       number|null  (navigator.hardwareConcurrency)
// }
// Returns { tier: 'fine'|'plain', why } — why feeds t' log an' telemetry.
export function decideTier(sig = {}) {
  if (sig.stored === 'fine' || sig.stored === 'plain') {
    return { tier: sig.stored, why: 'chosen' };       // t' player said so
  }
  if (sig.stored === 'auto-plain') {
    return { tier: 'plain', why: 'remembered-slow' }; // this kit lagged afore
  }
  if (isSoftwareGL(sig.rendererStr)) {
    return { tier: 'plain', why: 'software-gl' };     // no GPU at all — t' hard floor
  }
  if (Number.isFinite(sig.deviceMemory) && sig.deviceMemory <= 2) {
    return { tier: 'plain', why: 'low-memory' };
  }
  if (Number.isFinite(sig.cores) && sig.cores <= 2) {
    return { tier: 'plain', why: 'few-cores' };
  }
  if (sig.touchPrimary) {
    return { tier: 'plain', why: 'touch' };           // tablets open easy
  }
  if (sig.webgpu === true) return { tier: 'fine', why: 'webgpu' };
  if (sig.webgpu === false) return { tier: 'plain', why: 'no-webgpu' };
  return { tier: 'fine', why: 'unprobed' }; // optimistic till t' adapter answers
}

// t' software renderers that mean "no GPU": SwiftShader (Chrome's CPU
// fallback), llvmpipe/softpipe (Mesa's), an' Windows' Basic Render Driver
export function isSoftwareGL(rendererStr) {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererStr || '');
}

// ---- t' watchdog ----
// Sampled median fps over a settled window (t' openin' seconds are ignored —
// chunk streamin' an' shader warm-up lie about steady state).
export const SETTLE_S = 10;   // ignore t' openin' seconds
export const WINDOW_S = 6;    // judge on windows this long
export const SLOW_FINE = 27;  // Fine below this is a stutter, not a style
export const SLOW_PLAIN = 22; // Plain below this needs fewer pixels

// verdict for one settled window: 'hold' | 'drop-plain' | 'drop-pixels'
export function fpsVerdict(tier, medianFps) {
  if (!Number.isFinite(medianFps)) return 'hold';
  if (tier === 'fine' && medianFps < SLOW_FINE) return 'drop-plain';
  if (tier === 'plain' && medianFps < SLOW_PLAIN) return 'drop-pixels';
  return 'hold';
}

export function median(xs) {
  if (!xs || !xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
