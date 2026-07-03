// Headless: t' seasonal sun + accelerated moon ([SOLAR], James 2026-07-03:
// "can we have the sun follow the seasonal meridian and control the day length?
// the moon's phase should not follow the real moon, it should be accelerated to
// the same degree the season/year are.")
//
// The contract this defends:
//   (a) solarState is pure + memoised correctly (same args → same object; the
//       memo never serves stale values for fresh args);
//   (b) the BACK-COMPAT ANCHOR: at the equinoxes sunrise/sunset land at
//       0.25/0.75 EXACTLY, dayFrac is exactly 12h, and sunY is the old
//       sin((t−0.25)·2π) curve scaled by cos(54.4°) — same shape, same zeros;
//   (c) day length EMERGES: midwinter ~7.0h-equivalent, midsummer ~17.0h
//       (geometric horizon, no refraction — DELIBERATE, see (b): refraction
//       would buy winter ~+0.3h but smear the exact equinox anchor);
//   (d) noon altitudes: winter ~12.2°, summer ~59.0° (90 − 54.4 ∓ 23.44);
//   (e) azimuth: the sun rises +X (the star frame's documented chirality),
//       NE of a summer morning, SE of a winter one, arcs the −Z (sky-south) side;
//   (f) sun and star wheel share the daily period and direction;
//   (g) the moon calendar is accelerated (cycle = yearGameDays·29.53/365.25) and
//       lunarState seats the moon lagging the sun by the phase angle (full =
//       opposite/high of a winter midnight, new = down with the sun at night);
//   (h) every re-anchored consumer tracks the solar sunrise/sunset (murmuration
//       dusk band, hearth window, festival night, dew dawn band, source pins).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  solarState, solarDeclination, lunarState, moonPhase,
  YEAR_GAME_DAYS, MOON_CYCLE_DAYS, skyWheelAngle,
} from '../src/sky.js';
import { duskGate, murmurationGate } from '../src/birds.js';
import { hourOf, inEveningWindow, bedtimeHour } from '../src/hearthLayer.js';
import { nightFromSkyTime } from '../src/festivalKit.js';
import { YEAR } from '../src/season.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const mainSrc = src('../src/main.js');
const skySrc = src('../src/sky.js');
const entSrc = src('../src/entities.js');

const DEG = 180 / Math.PI;
const WINTER = 0.875, SUMMER = 0.375, EQUINOX = 0.125, AUT_EQ = 0.625;
const altDeg = (t, p) => Math.asin(solarState(t, p).sunAlt) * DEG;
const hours = p => solarState(0.5, p).dayFrac * 24;

// ---- (a) purity + memo correctness -----------------------------------------
{
  const a = solarState(0.37, WINTER);
  ok(a === solarState(0.37, WINTER), 'memo: identical args return the identical object');
  const b = solarState(0.62, SUMMER); // displace the memo…
  ok(b.sunAlt !== a.sunAlt, 'different args give a different state');
  const a2 = solarState(0.37, WINTER); // …then recompute the first
  ok(Math.abs(a2.sunAlt - a.sunAlt) < 1e-12 && a2.sunriseT === a.sunriseT && a2.dir[2] === a.dir[2],
    'memo correctness: recomputed state matches the original exactly (pure — no stale serve)');
  ok(Math.abs(Math.hypot(a.dir[0], a.dir[1], a.dir[2]) - 1) < 1e-9, 'dir is a unit vector');
  ok(a.dir[1] === a.sunAlt, 'dir[1] IS sunAlt (sin altitude) — one value, two names');
  const l = lunarState(0.1, WINTER, 7);
  ok(l === lunarState(0.1, WINTER, 7), 'lunarState memoised on (time, yearPhase, day)');
  lunarState(0.2, WINTER, 8);
  ok(Math.abs(lunarState(0.1, WINTER, 7).alt - l.alt) < 1e-12, 'lunarState memo correctness');
}

// ---- (b) the equinox back-compat anchor ------------------------------------
// James 2026-07-03: the seasonal sun must read as deviation AROUND today's
// behaviour — at the equinox it IS today's curve (scaled by cos φ), exactly.
{
  ok(Math.abs(solarDeclination(EQUINOX)) < 1e-12 && Math.abs(solarDeclination(AUT_EQ)) < 1e-12,
    'declination is 0 at both equinoxes (spring phase 0.125, autumn 0.625)');
  const s = solarState(0.5, EQUINOX);
  ok(s.sunriseT === 0.25 && s.sunsetT === 0.75, 'equinox: sunrise 0.25 / sunset 0.75 EXACTLY (the old anchor)');
  ok(s.dayFrac === 0.5, 'equinox: exactly 12h of light');
  const cosPhi = Math.cos(54.4 / DEG);
  for (const t of [0.1, 0.25, 0.33, 0.5, 0.75, 0.9]) {
    const oldSunY = Math.sin((t - 0.25) * Math.PI * 2);
    ok(Math.abs(solarState(t, EQUINOX).sunAlt - cosPhi * oldSunY) < 1e-9,
      `equinox sunY(${t}) = cos(54.4°)·sin((t−0.25)·2π) — the old curve's exact shape, scaled`);
    // and the east component matches the OLD sunX exactly at the equinox
    ok(Math.abs(solarState(t, EQUINOX).dir[0] - Math.cos((t - 0.25) * Math.PI * 2)) < 1e-9,
      `equinox dir.x(${t}) = the old cos((t−0.25)·2π) sunX exactly`);
  }
  ok(Math.abs(altDeg(0.5, EQUINOX) - (90 - 54.4)) < 0.01, 'equinox noon altitude = 90 − latitude = 35.6°');
}

// ---- (c) emergent day length ------------------------------------------------
// James 2026-07-03: geometric-horizon day lengths at 54.4°N are 7.03h / 16.97h
// (real Whitby Dec 21 is ~7.2h WITH refraction — we pin the geometric truth,
// keeping the equinox anchor exact; ±0.5h tolerance about the geometric values).
{
  const w = hours(WINTER), su = hours(SUMMER);
  ok(Math.abs(w - 7.03) < 0.5, `midwinter day ≈ 7.0h-equivalent of the 24h-scaled day (got ${w.toFixed(2)}h)`);
  ok(Math.abs(su - 16.97) < 0.5, `midsummer day ≈ 17.0h (got ${su.toFixed(2)}h)`);
  ok(Math.abs(w + su - 24) < 1e-6, 'winter day + summer day = 24h (the model is symmetric)');
  ok(Math.abs(hours(AUT_EQ) - 12) < 1e-6, 'autumn equinox: 12h too');
  // monotone through the seasons: days lengthen from midwinter to midsummer
  ok(hours(WINTER) < hours(0.0) && hours(0.0) < hours(EQUINOX) && hours(EQUINOX) < hours(0.25) && hours(0.25) < hours(SUMMER),
    'day length rises monotonically midwinter → midsummer');
  const sw = solarState(0.5, WINTER);
  ok(Math.abs(sw.sunriseT - 0.354) < 0.01 && Math.abs(sw.sunsetT - 0.646) < 0.01,
    `midwinter sunrise/sunset ≈ 0.354/0.646 (got ${sw.sunriseT.toFixed(3)}/${sw.sunsetT.toFixed(3)})`);
  const ss = solarState(0.5, SUMMER);
  ok(Math.abs(ss.sunriseT - 0.146) < 0.01 && Math.abs(ss.sunsetT - 0.854) < 0.01,
    `midsummer sunrise/sunset ≈ 0.146/0.854 (got ${ss.sunriseT.toFixed(3)}/${ss.sunsetT.toFixed(3)})`);
}

// ---- (d) noon altitudes ------------------------------------------------------
{
  ok(Math.abs(altDeg(0.5, WINTER) - 12.16) < 2, `midwinter noon sun ~12° up (got ${altDeg(0.5, WINTER).toFixed(1)}°)`);
  ok(Math.abs(altDeg(0.5, SUMMER) - 59.04) < 2, `midsummer noon sun ~59° up (got ${altDeg(0.5, SUMMER).toFixed(1)}°)`);
  ok(altDeg(0.0, SUMMER) > -13 && altDeg(0.0, SUMMER) < 0,
    'midsummer midnight: sun only ~12° under — the grey glow of a northern summer night');
}

// ---- (e) azimuth: chirality + seasonal risings -------------------------------
{
  // rises +X, sets −X — the star frame's documented (mirrored) chirality
  ok(solarState(0.3, EQUINOX).dir[0] > 0 && solarState(0.7, EQUINOX).dir[0] < 0,
    'sun keeps rising +X and setting −X (celestial east = +X, the documented mirror)');
  // sunrise z-component: NE (+Z is sky-north) in summer, SE in winter, due E at the equinox
  const zAt = p => { const s = solarState(0.5, p); return solarState(s.sunriseT + 1e-4, p).dir[2]; };
  ok(Math.abs(zAt(EQUINOX)) < 0.01, 'equinox sunrise due east (z ≈ 0)');
  ok(zAt(SUMMER) > 0.5, `summer sunrise in the NE (z ${zAt(SUMMER).toFixed(2)} toward sky-north)`);
  ok(zAt(WINTER) < -0.5, `winter sunrise in the SE (z ${zAt(WINTER).toFixed(2)})`);
  ok(solarState(0.5, EQUINOX).dir[2] < -0.7, 'noon sun stands on the −Z (sky-south) side, where the old arc lived');
}

// ---- (f) sun + star wheel: one daily period, one direction -------------------
{
  // both advance 2π per game day (the stars gain their extra sidereal lap from
  // yearPhase, not from time) — and just after noon the sun moves −X (westward),
  // the same sense the wheel turns the stars
  const dA = skyWheelAngle(0.6, 0.2) - skyWheelAngle(0.5, 0.2);
  ok(dA > 0, 'star wheel angle advances with time');
  ok(solarState(0.55, EQUINOX).dir[0] < solarState(0.5, EQUINOX).dir[0],
    'sun heads −X (westward) after noon — same sense as the star wheel');
  const back = solarState(0.999999, EQUINOX).sunAlt, fwd = solarState(0.000001, EQUINOX).sunAlt;
  ok(Math.abs(back - fwd) < 1e-4, 'solar position is continuous across the midnight wrap');
}

// ---- (g) the accelerated moon -------------------------------------------------
{
  ok(YEAR_GAME_DAYS === YEAR / 1800, `yearGameDays = YEAR/DAY_LENGTH = ${YEAR_GAME_DAYS} game days per game year`);
  ok(Math.abs(MOON_CYCLE_DAYS - YEAR_GAME_DAYS * 29.53 / 365.25) < 1e-12,
    `moon cycle compressed by the year's own ratio: ${MOON_CYCLE_DAYS.toFixed(3)} game days per month`);
  ok(Math.abs(moonPhase(0)) < 1e-12 && Math.abs(moonPhase(MOON_CYCLE_DAYS / 2) - 0.5) < 1e-12,
    'moonPhase: new at 0, full at half the accelerated cycle');
  ok(moonPhase(-1) >= 0 && moonPhase(-1) < 1, 'moonPhase stays in [0,1) for negative days');
  // full moon at a midwinter midnight: high and opposite the (deep-set) sun
  const fullDay = MOON_CYCLE_DAYS / 2;
  const full = lunarState(0, WINTER, fullDay - 0); // midnight, phase ~0.5
  ok(Math.abs(full.phase - 0.5) < 0.01 && full.illum > 0.99, 'midnight full moon: phase 0.5, fully lit');
  ok(full.alt > 0.7, `midwinter full moon rides HIGH at midnight (sin alt ${full.alt.toFixed(2)}) — opposite the low sun`);
  ok(solarState(0, WINTER).sunAlt < -0.5, '…while the sun is deep under');
  // new moon sits near the sun: down together at midnight, up together at noon
  const newM = lunarState(0, WINTER, 0);
  ok(newM.alt < 0, 'new moon is DOWN at midnight (near the sun) — genuinely dark nights');
  const newNoon = lunarState(0.5, WINTER, 0);
  const sunNoon = solarState(0.5, WINTER);
  const dot = newNoon.dir[0] * sunNoon.dir[0] + newNoon.dir[1] * sunNoon.dir[1] + newNoon.dir[2] * sunNoon.dir[2];
  ok(dot > 0.95, 'new moon at noon stands within a few degrees of the sun');
  ok(skySrc.includes('this.moonSprite.position.set(playerPos.x + lun.dir[0] * 160'),
    'moon sprite rides the lunar direction (phase-lagged seat), not the old sun mirror');
  ok(skySrc.includes('const moonHigh = Math.max(0, Math.min(1, (lun.alt - 0.02) * 3));'),
    "Fine moonlight keys off the moon's OWN altitude");
}

// ---- (h) re-anchored consumers track the solar day ----------------------------
{
  // murmuration: the dusk band peaks AT the seasonal sunset — James 2026-07-03
  // (DELIBERATE re-pin of the old 0.70–0.80 literals; equinox band identical)
  ok(duskGate(0.75) === 1 && duskGate(0.5) === 0 && duskGate(0.85) === 0,
    'duskGate default (equinox) = the old 0.70–0.80 band exactly');
  const wSet = solarState(0.5, WINTER).sunsetT;
  ok(duskGate(wSet, WINTER) === 1, `winter dusk band peaks at the WINTER sunset (${wSet.toFixed(3)})`);
  ok(duskGate(0.75, WINTER) === 0, 'the old fixed 0.75 dusk is long-dark in midwinter — band moved with the sun');
  const AUT = { autumn: 1, season: 'autumn', yearPhase: AUT_EQ };
  ok(murmurationGate(solarState(0.5, AUT_EQ).sunsetT, AUT, 0) === 1, 'murmurationGate passes the season\'s own yearPhase through');

  // hearth: window opens ~sunset−0.03, closes ~sunrise−0.03, per season
  ok(inEveningWindow(0.73) && !inEveningWindow(0.5) && hourOf(0.72) === 0,
    'hearth default (equinox) window = the old 0.72→0.22 exactly, hour 0 at open');
  ok(inEveningWindow(0.63, WINTER), 'midwinter window is already lit at 0.63 (early dark)');
  ok(!inEveningWindow(0.63, SUMMER), 'midsummer 0.63 is still broad daylight — no panes');
  ok(inEveningWindow(0.83, SUMMER), 'midsummer window opens by 0.83 (late dusk)');
  ok(hourOf(solarState(0.5, WINTER).sunsetT - 0.03, WINTER) === 0, 'winter hour 0 at the WINTER window open');
  const bw = bedtimeHour(3, 9, 0xBEEF, WINTER), bs = bedtimeHour(3, 9, 0xBEEF, SUMMER);
  ok(bw / bs > 1.5, `bedtimes spread over the LONGER winter window (winter ${bw.toFixed(1)}h vs summer ${bs.toFixed(1)}h span-scaled)`);
  ok(bedtimeHour(3, 9, 0xBEEF, WINTER) === bw, 'bedtime hash stays deterministic per (building, seed, season)');

  // festival night: dark falls at the seasonal sunset
  ok(nightFromSkyTime(0.5) === 0 && nightFromSkyTime(0.0) === 1, 'festival night factor: 0 at noon, 1 at midnight (unchanged)');
  ok(nightFromSkyTime(0.70, WINTER) > 0.5, 'bonfire-season (winter phase) 0.70 is already properly dark');
  ok(nightFromSkyTime(0.78, SUMMER) < 0.35, 'midsummer eve 0.78 is still light — fireworks hold off');

  // main.js source pins: every re-anchor reads the ONE API (James 2026-07-03 comments in-line)
  ok(mainSrc.includes('Math.abs(this.sky.time - this.sky.sol.sunriseT) / 0.07'), 'dew dawn band anchored to sky.sol.sunriseT (was the fixed 0.25)');
  ok(mainSrc.includes('this.sky.time >= _sol.sunsetT - 0.01 || this.sky.time < _sol.sunriseT - 0.05'), 'giants dusk window anchored to the solar sunset/sunrise');
  ok(mainSrc.includes('this.sky.time = this.sky.sol ? this.sky.sol.sunriseT : 0.25;'), 'sleep wakes at the SEASONAL sunrise');
  ok(mainSrc.includes('this.sky.sol.sunsetT - 0.15'), 'inn-evening ambience anchored to the solar sunset');
  ok(!mainSrc.includes('Math.sin((this.sky.time - 0.25) * Math.PI * 2)') && !mainSrc.includes('Math.sin((sky.time - 0.25) * Math.PI * 2)'),
    'NO replica of the old sun formula survives in main.js — one API, one sun');
  ok(!mainSrc.includes('Math.cos((this.sky.time - 0.25) * Math.PI * 2)'), '…nor the old sunX replica (the blade reads sol.dir/lun.dir)');

  // sky.js internals: isNight/timeName/dusk toast ride the solar day
  ok(skySrc.includes('return this.time < s.sunriseT - 0.07 || this.time > s.sunsetT + 0.07;'),
    'isNight = fixed twilight offsets about the SOLAR horizon crossings (equinox = the old 0.18/0.82)');
  ok(skySrc.includes('const duskT = sol.sunsetT - 0.01;'), 'the dusk toast fires at the solar sunset (equinox = the old 0.74)');

  // entities gates (equinox-identical fallbacks for headless stubs — verify-eveninglife's contract)
  ok(entSrc.includes("_sol ? _sol.sunsetT + 0.01 : 0.76") && entSrc.includes('_sol ? _sol.sunsetT + 0.13 : 0.88') && entSrc.includes('_sol ? _sol.sunriseT - 0.09 : 0.16'),
    'NPC evening schedule anchored to the solar sunset/sunrise, old literals kept as the stub fallback');
  ok(entSrc.includes('this.game.sky.sol.sunriseT - 0.07 : 0.18'), "Dracula's grey-of-dawn kill gate rides the seasonal night's end");
  ok(entSrc.includes('tm > _sr - 0.07 && tm < _sr + 0.08'), 'grouse lek anchored to the seasonal dawn');
  ok(entSrc.includes('sky.time > _sr2 - 0.08 && sky.time < _sr2 - 0.01'), 'barghest dawn-prints anchored to the seasonal first light');
}

console.log(`verify-solar: ${n} checks passed — seasonal sun + accelerated moon hold.`);
