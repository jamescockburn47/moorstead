// verify-gfxprobe: the tier decision holds its shape — the player's hand
// always wins, software GL is a hard floor, WebGPU is the capability
// signal, and the watchdog only ever eases DOWN.
import {
  decideTier, isSoftwareGL, fpsVerdict, median,
  SETTLE_S, WINDOW_S, SLOW_FINE, SLOW_PLAIN,
} from '../src/gfxprobe.js';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  FAIL:', msg); failed++; } };

// the player's own hand outranks every signal
ok(decideTier({ stored: 'fine', rendererStr: 'SwiftShader', webgpu: false }).tier === 'fine',
  'a chosen fine survives even a software renderer');
ok(decideTier({ stored: 'plain', webgpu: true }).tier === 'plain',
  'a chosen plain survives a capable machine');
ok(decideTier({ stored: 'auto-plain' }).tier === 'plain'
  && decideTier({ stored: 'auto-plain' }).why === 'remembered-slow',
  'a remembered downgrade opens easy');

// no GPU at all is the hard floor — the laggy-old-laptop case
for (const r of ['Google SwiftShader', 'llvmpipe (LLVM 15.0.7, 256 bits)',
  'Microsoft Basic Render Driver', 'softpipe']) {
  ok(decideTier({ rendererStr: r, webgpu: true }).tier === 'plain',
    `software GL floors the tier whatever else claims (${r})`);
  ok(isSoftwareGL(r), `${r} reads as software`);
}
ok(!isSoftwareGL('NVIDIA GeForce RTX 3060/PCIe/SSE2'), 'real silicon reads as real');
ok(!isSoftwareGL('AMD Radeon 8060S Graphics'), 'the EVO reads as real');
ok(!isSoftwareGL(null) && !isSoftwareGL(''), 'no string is not evidence of software');

// the capability ladder below the floor
ok(decideTier({ deviceMemory: 2 }).tier === 'plain', '2 GB opens easy');
ok(decideTier({ cores: 2 }).tier === 'plain', 'two cores open easy');
ok(decideTier({ touchPrimary: true }).tier === 'plain', 'tablets open easy');
ok(decideTier({ webgpu: true }).tier === 'fine', 'WebGPU adapter -> fine');
ok(decideTier({ webgpu: false, rendererStr: 'Intel HD Graphics 3000' }).tier === 'plain',
  'no WebGPU in 2026 means old metal — open easy');
ok(decideTier({}).tier === 'fine' && decideTier({}).why === 'unprobed',
  'optimistic while the adapter is still answering');

// the watchdog: eases down, never up, and holds inside the envelopes
ok(fpsVerdict('fine', SLOW_FINE - 1) === 'drop-plain', 'a stuttering fine drops to plain');
ok(fpsVerdict('fine', SLOW_FINE + 5) === 'hold', 'a healthy fine holds');
ok(fpsVerdict('plain', SLOW_PLAIN - 1) === 'drop-pixels', 'a stuttering plain sheds pixels');
ok(fpsVerdict('plain', SLOW_PLAIN + 5) === 'hold', 'a healthy plain holds');
ok(fpsVerdict('plain', 200) === 'hold' && fpsVerdict('fine', 200) === 'hold',
  'the watchdog never upgrades — the player does that');
ok(fpsVerdict('fine', NaN) === 'hold', 'no data is no verdict');
ok(SETTLE_S >= 5 && WINDOW_S >= 3 && SLOW_FINE > SLOW_PLAIN,
  'the timing constants keep their design shape');

// the median is a median
ok(median([3, 1, 2]) === 2 && median([4, 1, 2, 3]) === 2.5, 'median sane');
ok(Number.isNaN(median([])), 'empty window is no verdict');

if (failed) { console.error(`verify-gfxprobe: ${failed} FAILED`); process.exit(1); }
console.log('verify-gfxprobe: OK — player wins, software GL floors, WebGPU signals, watchdog only eases down');
