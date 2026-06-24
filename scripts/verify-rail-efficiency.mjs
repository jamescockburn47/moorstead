// Headless: every train line must take an EFFICIENT path — no doubling back on itself
// (a loop/hairpin the train would have to crawl round or reverse through), and no fording
// open sea at grade (a sea crossing must ride a lifted viaduct deck). This guards hand-
// surveyed lines especially: a spline through hand-flown pegs is prone to overshoot loops.
import assert from 'node:assert';
import { MoorsGeography } from '../src/moorsgeo.js';

const g = new MoorsGeography();
const WL = 26;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// heading swing over a ~16-block window: >110° means the line reverses on itself (a loop).
// Legitimate curves — even a cardinal-squared station approach — stay well under that.
const LOOP = 110, W = 4;

for (const { name, path } of g.railPaths()) {
  const P = path.pts;
  let loops = 0, worst = 0, kinks = 0, sea = 0, forded = 0, len = 0;
  for (let i = 1; i < P.length; i++) len += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
  for (let i = W; i < P.length - W; i++) {
    const h1 = Math.atan2(P[i].z - P[i - W].z, P[i].x - P[i - W].x);
    const h2 = Math.atan2(P[i + W].z - P[i].z, P[i + W].x - P[i].x);
    let t = Math.abs(h2 - h1) * 180 / Math.PI; if (t > 180) t = 360 - t;
    if (t > worst) worst = t;
    if (t > 50) kinks++;
    if (t > LOOP) loops++;
  }
  for (const p of P) if (g.coastT(Math.round(p.x), Math.round(p.z)) > 0.5) { sea++; if (p.deck < WL + 3) forded++; }
  console.log(`  ${name.padEnd(18)} len ${String(Math.round(len)).padStart(4)}  kinks>50 ${String(kinks).padStart(3)}  loops>110 ${loops}  worst ${Math.round(worst)}°  sea ${sea} (forded ${forded})`);
  ok(loops === 0, `${name}: no doubling-back loops (found ${loops}, worst ${Math.round(worst)}°)`);
  ok(forded === 0, `${name}: any sea crossing rides a viaduct, never fords at grade (${forded} forded)`);
}

console.log(`verify-rail-efficiency: ${n} assertions OK`);
