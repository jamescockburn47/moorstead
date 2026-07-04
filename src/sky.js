// Day/night cycle, moorland weather (clear / misty / fog / rain), rain particles.
import * as THREE from 'three';
import { CHUNK } from './defs.js';
import { currentWeather } from './weather-live.js';
import { winterPrecip, overcastGrey, snowfallIntensity } from './snow.js';
import { mulberry32, noise2 } from './noise.js';
import { YEAR } from './season.js';

const DAY_LENGTH = 1800; // seconds per full day — a proper half-hour, not a rush
// (t' shared-moor relay must agree: worldsvc/server.py DAY_LENGTH)

// weather-change toasts, shared by t' random machine an' t' live-weather feed
const WEATHER_MSG = {
  clear: "Sky's clearin' up. Grand.",
  misty: 'A mist hangs ower t’ moor.',
  rain: 'It’s silin’ it down!',
  fog: 'Fog’s rollin’ in thick. Mind tha doesn’t get lost.',
};

// ---- [4]+[CONST] t' 1900 night sky: REAL constellations ower a seeded field ----
// T' owd field rolled Math.random() per star — a live determinism-invariant breach
// (INVARIANTS rule 6): every client saw a different heavens. One fixed constant
// seed puts t' SAME stars ower every moor, every night, for every client — t'
// heavens don't vary by world seed. Pure typed-array build (no THREE objects, no
// DOM) so t' verify gate can prove determinism headlessly wi'out constructin' Sky.
//
// [CONST] James 2026-07-03: "can we have real constellations in the night sky?"
// STAR_CATALOGUE below is ~100 real bright stars (J2000 RA/Dec, apparent mag,
// colour temperature) — t' Plough, both Bears, Cassiopeia's W, Orion entire,
// t' Pleiades, t' Summer Triangle, t' Northern Cross, Leo's sickle an' more.
// They go in t' SAME buffers as t' seeded background (catalogue first, then
// background), ride t' same twinkle/magnitude machinery, an' t' whole Points
// object wheels about Polaris (skyWheelAngle below). Background count dropped
// 1100 -> 700 so t' real shapes stand proud of a quieter field.
const STAR_SEED = 1900;   // t' year, fittingly
const STAR_COUNT = 700;   // background stars ([CONST]: was 1100 — catalogue stars now carry t' bright end)
const STAR_R = 180;       // star-sphere radius (inside t' 500 dome, past fog.far)

// ---- [CONST] t' celestial frame ----
// Dome convention (Milky Way GPOLE / aurora precedent): +Z is SKY-NORTH, +Y up.
// T' north celestial pole stands ower t' north horizon at Yorkshire's latitude —
// 54.4° up: Polaris ower t' aurora, as it should be. NOTE t' minimap compass
// (north = +x, east = +z — quests.js/mining-guide.js) is a DIFFERENT convention;
// t' sky keeps t' dome's own (pre-existing: t' aurora already sits at +Z).
//
// CHIRALITY, documented deliberately: t' game's sun an' moon rise at +X an' set
// at −X (t' sunX arc, below). T' star field MUST wheel t' same way — a moon
// ploughin' BACKWARD through t' stars at ~0.5°/s would read broken inside a
// minute. Wi' t' pole pinned at +Z, riser-side +X makes celestial EAST = +X,
// which is t' MIRROR of t' true sky (real chirality wi' north +Z demands east
// = −X). So t' heavens here are east-west mirrored: every angular separation,
// every pointer relation, every season is REAL, but an astronomer would clock
// t' flip (Leo's sickle curls t' other way). T' one line that flips it back —
// if t' sun/moon path is ever reversed — is t' `sin(ra)` sign in raDecDir.
const POLE_LAT = 54.4 * Math.PI / 180;            // Goathland's latitude, near enough
export const CELESTIAL_POLE = [0, Math.sin(POLE_LAT), Math.cos(POLE_LAT)];
// RA (hours) / Dec (degrees) -> unit vector in dome space, at hour angle H = −RA
// (i.e. local sidereal time 0). Pure — t' verify gate proves t' catalogue's
// angular separations (Pointers, Orion's belt, t' Summer Triangle) through this.
export function raDecDir(raH, decDeg) {
  const ra = raH * Math.PI / 12, dec = decDeg * Math.PI / 180;
  const sp = Math.sin(POLE_LAT), cp = Math.cos(POLE_LAT);
  const x = Math.cos(dec) * Math.sin(ra);   // east axis (+X — mirrored, see above)
  const q = Math.cos(dec) * Math.cos(ra);   // toward t' equator's meridian point (sky-south, 35.6° up)
  const p = Math.sin(dec);                  // toward t' pole
  return [x, q * cp + p * sp, -q * sp + p * cp];
}

// ---- [CONST] t' catalogue: real stars, J2000 [name, RA h, Dec °, mag, warmth] ----
// warmth 0 = blue-white (Rigel, Vega, Sirius) → 1 = amber (Betelgeuse, Aldebaran,
// Arcturus) — feeds t' SAME temperature ramp as t' background field. Mistyped
// coordinates can't ship a broken shape: verify-graphics asserts t' Pointers,
// Polaris-on-pole, Orion's belt spacing, t' belt's gentle bend, Cassiopeia's W
// an' t' Summer Triangle sides as angular separations through raDecDir.
export const STAR_CATALOGUE = [
  // Ursa Major — t' Plough, all seven, plus Alcor ridin' Mizar
  ['Dubhe', 11.0622, 61.751, 1.79, 0.75], ['Merak', 11.0307, 56.383, 2.37, 0.10],
  ['Phecda', 11.8972, 53.695, 2.44, 0.10], ['Megrez', 12.2571, 57.033, 3.31, 0.10],
  ['Alioth', 12.9005, 55.960, 1.77, 0.10], ['Mizar', 13.3988, 54.925, 2.27, 0.10],
  ['Alkaid', 13.7924, 49.313, 1.86, 0.05], ['Alcor', 13.4204, 54.988, 3.99, 0.15],
  // Ursa Minor — Polaris an' t' Little Bear's arc down to t' bowl
  ['Polaris', 2.5303, 89.264, 1.98, 0.40], ['Yildun', 17.5369, 86.586, 4.36, 0.15],
  ['Epsilon UMi', 16.7661, 82.037, 4.23, 0.55], ['Zeta UMi', 15.7343, 77.795, 4.32, 0.15],
  ['Eta UMi', 16.2915, 75.755, 4.95, 0.30], ['Kochab', 14.8451, 74.156, 2.08, 0.80],
  ['Pherkad', 15.3455, 71.834, 3.05, 0.20],
  // Cassiopeia — t' W, all five
  ['Caph', 0.1530, 59.150, 2.28, 0.30], ['Schedar', 0.6751, 56.537, 2.24, 0.75],
  ['Tsih', 0.9451, 60.717, 2.47, 0.05], ['Ruchbah', 1.4303, 60.235, 2.68, 0.25],
  ['Segin', 1.9066, 63.670, 3.38, 0.10],
  // Orion — shoulders, belt, sword, feet an' head
  ['Betelgeuse', 5.9195, 7.407, 0.50, 1.00], ['Bellatrix', 5.4189, 6.350, 1.64, 0.05],
  ['Mintaka', 5.5334, -0.299, 2.23, 0.05], ['Alnilam', 5.6036, -1.202, 1.69, 0.05],
  ['Alnitak', 5.6793, -1.943, 1.77, 0.05], ['Saiph', 5.7959, -9.670, 2.09, 0.05],
  ['Rigel', 5.2423, -8.202, 0.13, 0.05], ['Meissa', 5.5860, 9.934, 3.39, 0.05],
  ['42 Ori', 5.5897, -4.838, 4.59, 0.05], ['Great Nebula', 5.5881, -5.389, 4.40, 0.05],
  ['Hatysa', 5.5905, -5.910, 2.77, 0.05],
  // Taurus — Aldebaran, t' horns' tips, t' Hyades V an' t' Pleiades knot
  ['Aldebaran', 4.5987, 16.509, 0.85, 0.90], ['Elnath', 5.4382, 28.608, 1.65, 0.05],
  ['Ain', 4.4769, 19.180, 3.53, 0.70], ['Gamma Tau', 4.3300, 15.628, 3.65, 0.70],
  ['Alcyone', 3.7914, 24.105, 2.87, 0.05], ['Atlas', 3.8194, 24.053, 3.63, 0.05],
  ['Electra', 3.7479, 24.113, 3.70, 0.05], ['Maia', 3.7634, 24.368, 3.87, 0.05],
  ['Merope', 3.7722, 23.948, 4.18, 0.05], ['Taygeta', 3.7534, 24.467, 4.30, 0.05],
  // Auriga — Capella's pentagon (Elnath, shared wi' Taurus, closes it)
  ['Capella', 5.2782, 45.998, 0.08, 0.55], ['Menkalinan', 5.9922, 44.948, 1.90, 0.15],
  ['Mahasim', 5.9953, 37.213, 2.65, 0.10], ['Hassaleh', 4.9498, 33.166, 2.69, 0.75],
  ['Almaaz', 5.0328, 43.823, 3.03, 0.40],
  // Gemini — t' twins stood on t' Milky Way's bank
  ['Castor', 7.5766, 31.888, 1.58, 0.10], ['Pollux', 7.7553, 28.026, 1.14, 0.70],
  ['Alhena', 6.6285, 16.399, 1.93, 0.10], ['Mebsuta', 6.7322, 25.131, 3.06, 0.60],
  ['Tejat', 6.3827, 22.514, 2.87, 0.90],
  // Canis Major an' Minor — Sirius, t' Dog Star, brightest of all
  ['Sirius', 6.7525, -16.716, -1.46, 0.10], ['Mirzam', 6.3783, -17.956, 1.98, 0.05],
  ['Adhara', 6.9771, -28.972, 1.50, 0.05], ['Wezen', 7.1399, -26.393, 1.83, 0.45],
  ['Procyon', 7.6550, 5.225, 0.34, 0.35],
  // Leo — Regulus an' t' sickle, Denebola at t' tail
  ['Regulus', 10.1395, 11.967, 1.35, 0.10], ['Eta Leo', 10.1222, 16.763, 3.51, 0.15],
  ['Algieba', 10.3329, 19.842, 2.08, 0.75], ['Adhafera', 10.2784, 23.417, 3.43, 0.35],
  ['Rasalas', 9.8794, 26.007, 3.88, 0.70], ['Algenubi', 9.7641, 23.774, 2.98, 0.55],
  ['Zosma', 11.2351, 20.524, 2.56, 0.15], ['Chertan', 11.2373, 15.430, 3.32, 0.10],
  ['Denebola', 11.8177, 14.572, 2.14, 0.15],
  // Boötes — Arcturus an' t' kite
  ['Arcturus', 14.2610, 19.182, -0.05, 0.80], ['Muphrid', 13.9114, 18.398, 2.68, 0.40],
  ['Izar', 14.7498, 27.074, 2.37, 0.70], ['Seginus', 14.5346, 38.308, 3.03, 0.20],
  ['Nekkar', 15.0324, 40.390, 3.50, 0.55], ['Delta Boo', 15.2583, 33.315, 3.47, 0.55],
  // Cygnus — t' Northern Cross, flyin' down t' Milky Way
  ['Deneb', 20.6905, 45.280, 1.25, 0.15], ['Sadr', 20.3705, 40.257, 2.23, 0.40],
  ['Albireo', 19.5120, 27.960, 3.05, 0.75], ['Gienah Cyg', 20.7702, 33.970, 2.48, 0.70],
  ['Fawaris', 19.7495, 45.131, 2.86, 0.10],
  // Lyra — Vega an' t' little parallelogram
  ['Vega', 18.6156, 38.784, 0.03, 0.03], ['Sheliak', 18.8347, 33.363, 3.52, 0.20],
  ['Sulafat', 18.9824, 32.690, 3.25, 0.10],
  // Aquila — Altair flanked by Tarazed an' Alshain
  ['Altair', 19.8464, 8.868, 0.76, 0.20], ['Tarazed', 19.7710, 10.613, 2.72, 0.80],
  ['Alshain', 19.9219, 6.407, 3.71, 0.55],
  // Perseus — Mirfak's arc an' Algol, t' winkin' demon
  ['Mirfak', 3.4054, 49.861, 1.79, 0.40], ['Algol', 3.1361, 40.956, 2.12, 0.10],
  ['Gamma Per', 3.0800, 53.506, 2.93, 0.60], ['Delta Per', 3.7152, 47.788, 3.01, 0.10],
  ['Epsilon Per', 3.9642, 40.010, 2.89, 0.05], ['Atik', 3.9022, 31.884, 2.85, 0.10],
  // Andromeda's arc an' t' Great Square o' Pegasus
  ['Alpheratz', 0.1398, 29.091, 2.06, 0.05], ['Delta And', 0.6555, 30.861, 3.27, 0.70],
  ['Mirach', 1.1622, 35.621, 2.05, 0.90], ['Almach', 2.0650, 42.330, 2.26, 0.75],
  ['Scheat', 23.0629, 28.083, 2.42, 0.85], ['Markab', 23.0794, 15.205, 2.49, 0.10],
  ['Algenib', 0.2206, 15.184, 2.83, 0.08], ['Enif', 21.7364, 9.875, 2.39, 0.75],
  // Odd bright anchors: spring's Spica, summer's Antares low ower t' southern moor
  ['Spica', 13.4199, -11.161, 0.97, 0.03], ['Antares', 16.4901, -26.432, 1.06, 1.00],
  ['Alphecca', 15.5781, 26.715, 2.23, 0.10], ['Rasalhague', 17.5822, 12.560, 2.08, 0.20],
  ['Hamal', 2.1196, 23.463, 2.00, 0.75],
];

export function buildStarField(count = STAR_COUNT, seed = STAR_SEED) {
  const nCat = STAR_CATALOGUE.length;
  const n = nCat + count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  // catalogue first (indices 0..nCat-1): real positions via raDecDir; apparent
  // magnitude maps linearly to aMag so Sirius/Vega/Capella stand visibly proud
  // (aMag 3.3/2.8/2.8) while t' background tops out at 2.0 — first-magnitude
  // stars outshine EVERY field star, as in life.
  for (let i = 0; i < nCat; i++) {
    const [, ra, dec, m, w] = STAR_CATALOGUE[i];
    const d = raDecDir(ra, dec);
    pos[i * 3] = d[0] * STAR_R; pos[i * 3 + 1] = d[1] * STAR_R; pos[i * 3 + 2] = d[2] * STAR_R;
    const a = Math.min(3.4, Math.max(0.9, 2.4 - 0.38 * (m - 1)));
    mag[i] = a;
    const lum = Math.min(1, 0.42 + 0.30 * a);
    col[i * 3] = (0.72 + 0.28 * w) * lum;
    col[i * 3 + 1] = (0.82 - 0.02 * w) * lum;
    col[i * 3 + 2] = (1.0 - 0.42 * w) * lum;
  }
  // seeded background after — t' owd formulas for magnitude an' temperature, but
  // [CONST] positions now cover t' WHOLE celestial sphere (uniform, not t' owd
  // upper hemisphere): t' field wheels about t' pole, so below-horizon stars
  // must exist to RISE. T' horizon fade in t' star shader hides them till they do.
  const rnd = mulberry32(seed);
  for (let i = nCat; i < n; i++) {
    const a = rnd() * Math.PI * 2, y = rnd() * 2 - 1, r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * STAR_R;
    pos[i * 3 + 1] = y * STAR_R;
    pos[i * 3 + 2] = Math.sin(a) * r * STAR_R;
    // power-law magnitudes: most stars faint, ~6% bright (rnd^4 tail); aMag in [0.45, 2.0]
    const m = 0.45 + Math.pow(rnd(), 4) * 1.55;
    mag[i] = m;
    // temperature ramp cool blue-white → warm amber; luminance follows magnitude
    const w = rnd();
    const lum = 0.45 + 0.55 * ((m - 0.45) / 1.55);
    col[i * 3] = (0.72 + 0.28 * w) * lum;
    col[i * 3 + 1] = (0.82 - 0.02 * w) * lum;
    col[i * 3 + 2] = (1.0 - 0.42 * w) * lum;
  }
  return { pos, col, mag };
}

// ---- [CONST] t' sky wheels: local sidereal angle, pure in (time, yearPhase) ----
// One full wheel per game day frae sky.time, plus one slow EXTRA lap per year
// frae t' season clock — t' sidereal sky, exactly as at 54°N. Driven frae
// season.yearPhase (t' shared wall-clock season, season.js) rather than a raw
// day count: single-player day counts are arbitrary against t' visible season,
// but yearPhase IS t' season on t' ground — so snow underfoot an' Orion overhead
// always agree, on every client, wi' no epoch guesswork.
//
// Anchor (t' documented mapping): at deep-winter midnight (time 0, yearPhase
// 0.875) t' meridian holds RA 5.60h — Alnilam: ORION stands due sky-south.
//   yearPhase 0.875 (midwinter)  midnight LST  5.6h → Orion transiting
//   yearPhase 0.125 (spring)     midnight LST 11.6h → Leo up
//   yearPhase 0.375 (midsummer)  midnight LST 17.6h → t' Summer Triangle ridin' high
//   yearPhase 0.625 (autumn)     midnight LST 23.6h → t' Great Square/Andromeda
// T' Plough, Cassiopeia an' t' Little Bear sit within 36° o' t' pole — circumpolar
// at 54°N: they wheel but NEVER set. Orion (belt dec ~−1°) rises an' sets.
const WINTER_MIDNIGHT_RA = 5.603; // Alnilam's RA: Orion's belt transits at midwinter midnight
export function skyWheelAngle(time, yearPhase = 0) {
  const turns = time + yearPhase + (WINTER_MIDNIGHT_RA / 24 - 0.875);
  return (turns - Math.floor(turns)) * Math.PI * 2;
}

// [CONST] t' Milky Way rides t' wheel too: t' band is now t' REAL galactic plane
// in t' same celestial frame as t' catalogue — pole at t' true north galactic
// pole (RA 12.857h, +27.13°), mottle axes spanned frae t' galactic centre
// (RA 17.761h, −29.01°). update() rotates these three base vectors by t' star
// quaternion into t' dome's uMWPole/uMWA/uMWB each frame (three uniform writes,
// no per-star CPU) — so Cygnus an' Cassiopeia KEEP their seats on t' band as
// t' heavens turn, instead o' driftin' off t' owd fixed GPOLE arc.
const _MW_POLE0 = new THREE.Vector3().fromArray(raDecDir(12.8572, 27.128));
const _MW_A0 = new THREE.Vector3().fromArray(raDecDir(17.7611, -29.008));
const _MW_B0 = new THREE.Vector3().crossVectors(_MW_POLE0, _MW_A0).normalize();
const _POLE_AXIS = new THREE.Vector3().fromArray(CELESTIAL_POLE);

// ---- [SOLAR] t' real sun ower t' seasonal meridian ------------------------
// [SOLAR] James 2026-07-03: "can we have the sun follow the seasonal meridian
// and control the day length?" This is t' textbook solar-position model at
// Goathland's latitude (POLE_LAT, 54.4°N — t' SAME constant t' star frame
// stands on): declination frae t' season clock, hour angle frae sky.time
// (noon at 0.5), altitude an' azimuth frae t' spherical triangle. Day length
// EMERGES — t' 1800 s DAY_LENGTH is untouched, only t' light/dark split
// within it breathes wi' t' season:
//   midwinter (yearPhase 0.875): ~7.0 h-equivalent o' daylight, noon sun 12.2° up
//   equinoxes (0.125 / 0.625):   EXACTLY 12 h — sunrise 0.25, sunset 0.75,
//                                 sunY = cos(54.4°)·sin((t−0.25)·2π): t' owd
//                                 curve's exact shape, scaled — back-compat anchor
//   midsummer (0.375):           ~17.0 h, noon sun 59.0° up, sunrise in t' NE
// Geometric horizon, no refraction — deliberately, so t' equinox anchor lands
// sunrise at 0.25 EXACTLY (refraction would buy winter ~+0.3 h but smear that).
// Frame: t' dome's own celestial frame (+Z sky-north, celestial east = +X, t'
// documented E-W mirror) — dir comes frae t' SAME maths as raDecDir wi'
// ra = −H, so t' sun keeps rising +X an' shares t' star wheel's daily period
// an' direction (t' stars gain their one extra sidereal lap frae yearPhase).
const OBLIQUITY = 23.44 * Math.PI / 180;  // Earth's axial tilt
const SPRING_EQUINOX_PHASE = 0.125;       // season.js: spring spans [0,0.25) — its midpoint is t' equinox
                                          // (warmth peaks 0.375 = midsummer solstice, snowiness 0.875 = midwinter)

// Declination for a year phase — t' spec'd first-order model: δ = ε·sin(2π·(phase − spring)).
// Pure an' exported for t' verify gate.
export function solarDeclination(yearPhase) {
  return OBLIQUITY * Math.sin((yearPhase - SPRING_EQUINOX_PHASE) * Math.PI * 2);
}

// A body at declination `dec` an' hour angle H (0 at upper transit, +westward),
// in t' dome frame — identical algebra to raDecDir wi' ra = −H, so sun, moon
// an' stars share ONE frame an' one chirality (east = +X, t' documented mirror).
function bodyDir(dec, H) {
  const sp = Math.sin(POLE_LAT), cp = Math.cos(POLE_LAT);
  const x = -Math.cos(dec) * Math.sin(H);   // east axis: +X before transit — rises +X, sets −X
  const q = Math.cos(dec) * Math.cos(H);    // toward t' equator's meridian point (sky-south)
  const p = Math.sin(dec);
  return [x, q * cp + p * sp, -q * sp + p * cp];
}

// ---- [SOLAR] solarState: t' ONE sun API — every consumer re-anchors here ----
// Pure in (time, yearPhase); memoised per exact argument pair (t' hot path is
// many same-frame reads — sky.update caches its result on sky.sol, an' t'
// pure-fn consumers (hearth/birds/festival gates) hit t' memo). Returns:
//   sunAlt   — sin(altitude): t' drop-in replacement for t' owd sunY
//   dir      — [x,y,z] unit sun direction in t' dome frame (dir[1] === sunAlt);
//              sprite path, light rig an' t' water blade all derive frae this
//   dayness / nightness / golden — t' shared light factors (owd formulas, new sun)
//   sunriseT / sunsetT / dayFrac — t' emergent day: acos(−tanφ·tanδ)/π o' t' day
let _ssT = NaN, _ssP = NaN, _ssV = null;
export function solarState(time, yearPhase = SPRING_EQUINOX_PHASE) {
  if (time === _ssT && yearPhase === _ssP) return _ssV;
  const dec = solarDeclination(yearPhase);
  const H = (time - 0.5) * Math.PI * 2;     // hour angle: noon at time 0.5
  const dir = bodyDir(dec, H);
  const sunAlt = dir[1];
  const dayness = Math.max(0, Math.min(1, (sunAlt + 0.12) * 3));
  // golden runs past 1 below t' horizon exactly as t' owd formula did — t'
  // dawn-glow fog clamps its own copy (sky.update), same as afore
  const golden = Math.max(0, 1 - sunAlt * 2.6);
  const cosH0 = Math.max(-1, Math.min(1, -Math.tan(POLE_LAT) * Math.tan(dec)));
  const dayFrac = Math.acos(cosH0) / Math.PI;   // 0.5 exactly at t' equinoxes
  _ssT = time; _ssP = yearPhase;
  _ssV = {
    sunAlt, dir, dayness, nightness: 1 - dayness, golden,
    dayFrac, sunriseT: 0.5 - dayFrac / 2, sunsetT: 0.5 + dayFrac / 2,
  };
  return _ssV;
}

// ---- [SOLAR] t' accelerated moon calendar ---------------------------------
// James 2026-07-03: "the moon's phase should not follow the real moon, it
// should be accelerated to the same degree the season/year are." T' game year
// is YEAR seconds o' wall clock = YEAR/DAY_LENGTH game days (192); t' synodic
// month compresses by t' SAME 365.25-day-year ratio, so t' phase visibly steps
// night to night (~6.4%/night — new to full in ~8 game days).
export const YEAR_GAME_DAYS = YEAR / DAY_LENGTH;                       // 192 game days per game year
export const MOON_CYCLE_DAYS = YEAR_GAME_DAYS * 29.53 / 365.25;        // ≈ 15.52 game days per lunar month

// [4]+[SOLAR] Moon phase for a game day: 0 = new, 0.5 = full, → 1 new again — on
// t' ACCELERATED MOON_CYCLE_DAYS month (was t' real 29.53: a real month outran
// t' four-real-day year). Pure an' exported so t' verify gate can check t'
// calendar headlessly.
export function moonPhase(day) {
  return (((day % MOON_CYCLE_DAYS) + MOON_CYCLE_DAYS) % MOON_CYCLE_DAYS) / MOON_CYCLE_DAYS;
}

// ---- [SOLAR] lunarState: t' moon's own seat in t' sky ----------------------
// T' moon lags t' sun by its phase angle (full = opposite, as t' owd mirror
// always was; new = near t' sun; crescents hug t' evening/morning horizons),
// an' rides t' ecliptic first-order: its declination is t' sun's formula
// evaluated a phase further round t' year circle — so a midwinter full moon
// stands HIGH (opposite t' low sun), as ower t' real moor. Pure + memoised;
// phase here reads (day + time) so t' position glides — t' drawn disc keeps
// its once-a-day redraw off moonPhase(this.day).
let _lsT = NaN, _lsP = NaN, _lsD = NaN, _lsV = null;
export function lunarState(time, yearPhase = SPRING_EQUINOX_PHASE, day = 0) {
  if (time === _lsT && yearPhase === _lsP && day === _lsD) return _lsV;
  const phase = moonPhase(day + time);
  const dec = solarDeclination(yearPhase + phase);            // ecliptic seat, a phase round frae t' sun
  const H = (time - 0.5) * Math.PI * 2 - phase * Math.PI * 2; // lags t' sun by t' phase angle
  const dir = bodyDir(dec, H);
  _lsT = time; _lsP = yearPhase; _lsD = day;
  _lsV = { dir, alt: dir[1], phase, illum: 0.5 - 0.5 * Math.cos(phase * Math.PI * 2) };
  return _lsV;
}

// ---- [19] weather wi' weight: GPU-driven, wind-slanted rain an' snow ----
// T' owd rigs walked every particle on t' CPU each frame (~3.3k position writes +
// two full attribute uploads per storm frame — t' single biggest weather cost on
// tablets). Now t' base field is a STATIC seeded buffer an' t' vertex shader owns
// t' fall: wrapped drop (mod), wind slant, per-point sway, a world-space squall
// band on alpha, an' a density threshold that collapses surplus points to
// degenerate (clipped) verts. Both tiers ride t' same path — Plain at today's
// counts wi' a gentler wind, so tablets get strictly CHEAPER weather, not more.
// Zeroed uniforms (uWindP=0, uSwayW=0, uSquall=0, Plain density) = today's look.
export const RAIN_MAX = 1800, RAIN_PLAIN = 900;    // one allocation at t' Fine max;
export const SNOW_MAX = 6000, SNOW_PLAIN = 2400;   // uDensity culls down to Plain's counts
export const RAIN_FALL = 22, SNOW_FALL = 6.5;      // blocks/s — t' CPU loops' exact speeds
export const RAIN_SPAN = 24, SNOW_SPAN = 48;       // fall-column heights (snow bottom -28)
const SWAY_WRAP = Math.PI * 2 / 0.7;   // sway freqs are all multiples o' 0.7 → exact wrap
const SQUALL_K = 0.045;                // band spatial freq: ~140-block shower bands
const SQUALL_SPEED = 9;                // blocks/s band travel — a brisk shower crossin' t' dale

// [19] Shared-clock wind gust [0,1] — t' showerOscillation idiom (snow.js:27-30):
// slow fronts (~50 s) breathin' under a quick flutter (~9 s), pure in `now`, so
// every client's rain leans t' same way at t' same moment. Never fully calm (0.35
// floor) — there's allus a breath o' wind on t' tops.
export function windGust(now = 0) {
  const t = now / 1000;
  const front = (noise2(t / 50, 0, 0x1919) + 1) * 0.5;
  const flutter = (noise2(t / 9, 0, 0x1291) + 1) * 0.5;
  return Math.min(1, 0.35 + 0.65 * front * (0.55 + 0.45 * flutter));
}

// [19] Shared-clock wind heading (radians, xz plane): a prevailin' sou'wester that
// backs an' veers ±~0.9 rad ower ~15-min value-noise cells. Pure in `now` (ms) —
// deterministic for every client, includin' ones that join mid-squall.
export function windHeading(now = 0) {
  return 0.79 + noise2(now / 900000, 0, 0x1902) * 0.9;
}

// ---- [31] aurora shared-clock window (the Great Fog idiom, longer cadence) ----
// Roughly once every ten game days a clear-night display shimmers ower t' northern
// sky, centred on midnight, easin' in an' out ower ~25s — same shared Date.now clock
// as t' Great Fog, so every client sees t' SAME aurora at t' SAME moment (no
// per-client accumulator, no Math.random). Pure in `now` (ms) so t' verify gate can
// assert t' ~10-day cadence headlessly. Returns 0..1 (the raw window envelope; the
// clear-night gate an' Plain clamp are applied by t' caller).
const AURORA_CYCLE = DAY_LENGTH * 10;   // ~ten game days between displays (18 000 s)
const AURORA_DUR = DAY_LENGTH / 3;      // ~a third of a game day lit (600 s ≈ a few game hours)
const AURORA_EASE = 25;                 // seconds of ease in/out (matches t' Great Fog)
export function auroraWindow(nowMs = 0) {
  const CYCLE = AURORA_CYCLE, DUR = AURORA_DUR, EASE = AURORA_EASE;
  // window centred on midnight: t' day rolls at (Date.now/1000) % DAY_LENGTH === 0,
  // so centre t' DUR-wide window on t' cycle's midpoint (same offset maths as the fog)
  const into = (nowMs / 1000) % CYCLE - (CYCLE - DUR);
  if (into < 0) return 0;
  return into < EASE ? into / EASE : Math.min(1, Math.max(0, (DUR - into) / EASE));
}

// [30] rainbow drive envelope — pure so t' gate can prove t' rise/decay rule. Given
// this frame's rain amount, the PREVIOUS frame's rain amount, the sun height an' the
// weather state, returns 1 when a bow SHOULD be risin' (rain decayin' frae a real
// shower toward clear/misty while t' sun's up), else 0. The caller eases the actual
// uRainbow scalar toward this over ~90s. Kept pure (no `this`) for headless assertion.
export function rainbowRising(rainAmount, prevRain, sunY, weather) {
  const decaying = rainAmount < prevRain - 1e-4;   // rain is easing off this frame
  const wasWet = prevRain > 0.3;                    // …frae a real shower, not a drizzle
  const clearing = weather === 'clear' || weather === 'misty';
  return (decaying && wasWet && clearing && sunY > 0.05) ? 1 : 0;
}

// [warden] Pure: what a warden's chosen weather-preview state should force this frame.
// Extracted so verify-admin-panel.mjs can prove it without constructing a Sky/THREE instance
// at all. Rain/Snow needs a REAL rainAmount (not just the 'rain' label): winterPrecip
// (snow.js) only falls back to a deterministic snowfall value when season.warmth is ALREADY
// < 0, so without this a summer preview of "Rain/Snow" would silently produce zero
// precipitation.
export function overrideWeatherState(state) {
  return {
    weather: state,
    liveRain: state === 'rain' ? 0.7 : null,
    liveFog: null,
    liveWind: null,
  };
}

// [19] Seeded precipitation base field — pure typed arrays (t' buildStarField idiom;
// headless-verifiable, an' Math.random is gone frae t' rigs entirely). y is uniform
// ower t' column; x/z stay 0 because t' shader re-rolls them frae hash(aSeed, cycle)
// on every fall-wrap — t' owd CPU respawn's fresh Math.random column, made static.
// aSeed is STRATIFIED by index (point i sits in [i/n, (i+1)/n)) so t' uDensity
// threshold culls to an EXACT count — an' it's decorrelated frae y, so Plain thins
// t' field evenly, never shortens t' column.
export function buildPrecipField(count, spanY, bottomY, rngSeed) {
  const rnd = mulberry32(rngSeed);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3 + 1] = bottomY + rnd() * spanY;
    seed[i] = (i + rnd() * 0.999) / count;
  }
  return { pos, seed };
}

// Vertex-stage motion, injected into PointsMaterial via onBeforeCompile (r166
// points.glsl.js carries t' exact anchors — same pattern as t' star material).
// uFall/uCycle arrive CPU-WRAPPED (double-precision mod done in update()), so no
// unbounded time ever reaches float32 — t' fall stays glass-smooth for days.
const PRECIP_VERT_DECL = `
attribute float aSeed;
uniform float uFall, uCycle, uSwayAmp, uSwayW, uSwayT, uDensity, uSquall, uSquallPh;
uniform vec2 uWindP, uSquallDir;
uniform vec3 uSpanP;
varying float vAlpha;
`;
const PRECIP_VERT_MOVE = `
vec3 transformed = vec3( position );
{
  float spanY = uSpanP.x, botY = uSpanP.y, spanXZ = uSpanP.z;
  float b = position.y - botY;                    // seeded base height in [0, spanY)
  float fy = mod(b - uFall, spanY);               // wrapped fall — t' owd recycle loop
  // a fresh column each recycle: hash(seed, completed-falls) re-rolls x/z at t'
  // wrap moment ONLY — exactly when t' CPU respawn used to re-roll Math.random
  float cyc = uCycle + step(b, uFall);
  transformed.x = (fract(sin(aSeed * 913.37 + cyc * 0.7131) * 43758.5453) - 0.5) * spanXZ;
  transformed.z = (fract(sin(aSeed * 719.71 + cyc * 0.9173) * 43758.5453) - 0.5) * spanXZ;
  transformed.y = botY + fy;
  // wind slant grows wi' distance fallen (recentred so t' field stays round t' rig);
  // t' uSwayAmp term IS today's snow drift (amp .86, freq .7) — rain ships it at 0
  float ph = aSeed * 6.2831853;
  transformed.xz += uWindP * (spanY * 0.5 - fy);
  transformed.x += uSwayAmp * sin(uSwayT * 0.7 + ph);
  transformed.xz += uSwayW * vec2(sin(uSwayT * 2.1 + ph * 3.0), sin(uSwayT * 1.4 + ph * 5.0));
  // world-space squall band translatin' wi' t' shared clock: alpha thins an' thickens
  // in ~140-block bands, so tha watches a shower sweep up t' dale afore it arrives
  vec4 wpP = modelMatrix * vec4(transformed, 1.0);
  float sqP = dot(wpP.xz, uSquallDir) * ${SQUALL_K} + uSquallPh;
  float bandP = 0.5 + 0.35 * sin(sqP) + 0.15 * sin(sqP * 3.0 + 1.3);
  vAlpha = mix(1.0, smoothstep(0.12, 0.7, bandP), uSquall);
  // density: surplus points (aSeed past t' threshold) fly 1e6 up — clipped, degenerate
  transformed.y += step(uDensity, aSeed) * 1.0e6;
}
`;
const addPrecipMotion = (mat, own, shared) => {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, own, shared); // same {value} objects — survives applyQuality recompiles
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', PRECIP_VERT_DECL + '#include <common>')
      .replace('#include <begin_vertex>', PRECIP_VERT_MOVE);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', 'varying float vAlpha;\n#include <common>')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );');
  };
  // rain an' snow share ONE compiled program — their differences are all uniforms
  mat.customProgramCacheKey = () => 'precip-fall';
};

// ---- world-edge fog budget ----
// world.js streams an' meshes chunks to renderDist = 7 round t' player (src/world.js,
// an instance field, not exported — keep this mirror in step wi' it). 7 × CHUNK = 112
// blocks is t' GUARANTEED meshed distance in every direction (worst case, player stood
// on a chunk seam). Past that edge there's no terrain at all — only t' bare dome — so
// fog must finish its WHOLE job (full occlusion) inside it, else half-fogged terrain
// ends in a hard silhouette against flat dome colour: t' off-puttin' horizon band.
// Re-tuned 2026-07-03 (deliberate): renderDist 6→7 bought 16 more meshed blocks, so
// clear weather now breathes to ~98 (frae 84 — James found t' owd line too close in);
// misty lands ~82, rain ~72. T' knee structure below is UNTOUCHED.
const STREAM_RADIUS = 7 * CHUNK;                       // blocks — mirrors world.renderDist × CHUNK
const FOG_FAR_MAX = Math.floor(STREAM_RADIUS * 0.88);  // 98: full occlusion afore t' meshed edge
const FOG_KNEE = 60;  // open-weather targets (rain 90 / misty 120 / clear 160) compress into KNEE..MAX

// ---- Fine shadow rig: whole-texel snap ----
// World units per shadow-map texel: t' ±70-block ortho frustum ower a 2048px map
// (see applyQuality in main.js) — 140/2048 ≈ 0.068 blocks. T' frustum rides playerPos
// continuously, so wi'out snappin' every step slides t' depth map a fraction of a texel
// an' shadow edges shimmer an' crawl. Quantisin' t' light position AND target together
// along t' shadow camera's right/up axes moves t' frustum in whole-texel steps only,
// while leavin' t' light DIRECTION exact (t' sun still sweeps smoothly wi' time o' day).
const SHADOW_TEXEL = 140 / 2048;
const _SNAP_UP = new THREE.Vector3(0, 1, 0);
const _snapZ = new THREE.Vector3(), _snapX = new THREE.Vector3(), _snapY = new THREE.Vector3();
// T' texel snap below freezes TRANSLATION, but t' lamp's DIRECTION sweeps continuously
// wi' time o' day — every frame t' depth grid rotates a fraction of a texel an' every
// shadow edge boils/flickers (James 2026-07-03). Quantisin' t' light-offset components
// to a coarse grid steps t' direction ~0.4° at a time: diffuse lighting can't show a
// step that small, an' between steps t' shadow edges stand rock still. Fine-rig only —
// Plain has no shadow map an' keeps its byte-identical smooth lamp.
const SHADOW_DIR_STEP = 0.5; // blocks on t' ~70-block offset arm ≈ 0.007 rad
const _dirQ = v => Math.round(v / SHADOW_DIR_STEP) * SHADOW_DIR_STEP;

// ---- graphics quality (pure helpers — headless-testable, no DOM, no GL) ----
// Two rigs: 'fine' (ACES tone mapping, sun/moon shadows, bloom + grade post stack)
// and 'plain' (today's pipeline untouched — t' safety net for tablets an' owd kit).
// An explicit stored choice allus wins; else default Fine on a computer, Plain
// where t' touch adapter is t' primary input.
export function resolveQuality(stored, touchPrimary) {
  if (stored === 'fine' || stored === 'plain') return stored;
  return touchPrimary ? 'plain' : 'fine';
}

// T' held storm lantern's flame: a gentle organic flicker — two summed slow sines
// plus a tiny fast shimmer, NOT random jitter, so it breathes like a real wick.
// Deterministic in t (seconds) and bounded well within [0.9, 1.1].
export function lanternFlicker(t) {
  const slow = Math.sin(t * 7.3) * 0.5 + Math.sin(t * 12.7 + 1.7) * 0.35;
  const shimmer = Math.sin(t * 41.0) * Math.sin(t * 27.3 + 0.6) * 0.5;
  return 1 + 0.08 * slow + 0.02 * shimmer;
}

const SKY = {
  night: new THREE.Color(0x070a14),
  dawn: new THREE.Color(0x9a6a52),
  day: new THREE.Color(0x9fb6c8),   // pale, slightly grey Yorkshire sky
  dusk: new THREE.Color(0x7a5560),
};

// t' boss storm's cloud deck: near-black, hoisted so t' churn allocates nowt per frame
const STORM_CLOUD = new THREE.Color(0.06, 0.06, 0.08);

// ---- [22] per-frame colour scratch ----
// sky.update() used to allocate ~10 THREE.Color (new/clone) EVERY frame — a steady
// GC drip that hitches tablets. All hoisted here: t' upper-case names are fixed
// palette stops, t' _scratch colours are overwritten each frame afore they're read.
// update() itself now allocates nowt.
const OVERCAST_BASE = new THREE.Color(0x8a949c);   // overcast grey (pre-dayness scale)
const DREAD_BRUISE = new THREE.Color(0x1a1020);    // Dracula: t' sky bruises…
const DREAD_BLOOD = new THREE.Color(0x301018);     // …wi' a red undertone
const GREATFOG_WHITE = new THREE.Color(0xc6cbd1);  // t' Great Fog's whiteout
const NIGHT_LIFT = new THREE.Color(0x18233a);      // Fine's moonlit night floor
const ZENITH_DEEP = new THREE.Color(0x21426a);     // daytime zenith deepenin'
const CLOUD_LIT = new THREE.Color(0.91, 0.93, 0.95); // daylit cloud colour
const _sky = new THREE.Color();    // t' frame's computed sky tint
const _tmpC = new THREE.Color();   // short-lived mixin' pot (overcast base, season tint)
const _fogC = new THREE.Color();   // t' frame's FINAL fog colour ([22]: single owner site)
// offline fog-far targets by weather state — hoisted so t' offline path allocates nowt either
const FOG_BASE = { clear: 160, misty: 120, rain: 90, fog: 22 };

export class Sky {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;  // anchor precipitation to the viewer so snow fills the frame in any view (incl. the aerial title orbit)
    this.time = 0.3; // start mid-morning
    this.day = 1;
    // [SOLAR] cached solar/lunar state — refreshed at t' top of every update()
    // wi' t' live yearPhase; seeded at t' equinox here so isNight()/timeName()
    // an' early readers (title screen, HUD) never see undefined.
    this.yearPhase = 0.125;
    this.sol = solarState(this.time, this.yearPhase);
    this.lun = lunarState(this.time, this.yearPhase, this.day);
    this.weather = 'misty';
    this.weatherTimer = 60 + Math.random() * 60;
    this.weatherOverride = null; // [warden] debug.setWeather() override; null = 'Live' (today's behaviour)
    this.fogFar = 90; this.fogTargetFar = 90;
    this.rainAmount = 0;
    this._snapPrecip = false; // [showreel] one-frame flag: complete the precip lerp instantly on a scene cut
    this.dread = 0;
    this.dreadTarget = 0;
    this.flash = 0;       // transient lightning-flash term (0..1), spiked by the storm controller, decays each frame
    this.stormPrecip = undefined; // when set (~1) the storm overrides precip to a downpour; cleared restores normal weather
    this.stormIsSnow = undefined; // storm precip falls as snow (winter) vs rain
    this.stormChurn = undefined;  // boss-storm sky: cloud deck driven full, near-black, ~3x scroll.
                                  // Set ONLY by the storm controller (the title flyover borrows
                                  // stormPrecip for its winter plates, so precip alone can't key this)
    this._stormS = 0;             // eased 0..1 churn state, so the deck rolls in and out — no snap
    this._rainbowS = 0;   // [30] eased rainbow strength (rises on a clearin' shower, ~90s decay)
    this._auroraS = 0;    // [31] eased aurora strength (shared-clock window × clear-night gate)
    this._prevRain = 0;   // [30] last frame's rainAmount — the bow rises when rain's DECAYIN'
    this.moorFog = 0;    // T' Great Fog intensity at t' player, 0..1
    this.moorGate = 0;   // set by t' game: 1 on t' high moor, 0 in villages/coast
    this._gateS = 0;
    this.fogDebug = false; // dev: force t' Great Fog on
    this.gfx = 'plain';  // 'fine' | 'plain' — set by t' game (applyQuality); 'fine' swaps
                         // in ACES-retuned light curves an' a moonlit night below

    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.0);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xbfcfdd, 0.55);
    scene.add(this.ambient);

    scene.fog = new THREE.Fog(SKY.day.clone(), 10, 90);
    this._bg = new THREE.Color(); // persistent background Color — update() copies into it ([22]: no per-frame clone)

    // sun & moon discs
    const mkDisc = (color, size) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = color; x.beginPath(); x.arc(32, 32, 26, 0, 7); x.fill();
      const tex = new THREE.CanvasTexture(c);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, transparent: true, depthWrite: false }));
      s.scale.set(size, size, 1);
      scene.add(s);
      return s;
    };
    this.sunSprite = mkDisc('#ffe9b0', 18);

    // moon — [4] phase-aware: t' 64px canvas is redrawn once per game day
    // (_drawMoonPhase), waxin' an' wanin' on t' real 29.53-day synodic month wi'
    // seeded maria. Canvas work stays inside t' constructor/methods, never at
    // module scope — t' same headless guard t' rest o' this file relies on (t'
    // verify gate imports t' module but never constructs Sky).
    this._moonCanvas = document.createElement('canvas');
    this._moonCanvas.width = this._moonCanvas.height = 64;
    this._moonTex = new THREE.CanvasTexture(this._moonCanvas);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._moonTex, fog: false, transparent: true, depthWrite: false }));
    this.moonSprite.scale.set(12, 12, 1);
    scene.add(this.moonSprite);
    this._moonDay = -1;      // forces t' first draw; update() redraws when this.day moves (incl. after deserialize)
    this._drawMoonPhase();

    // [4] moon burr — 'a ring round t' moon means rain soon', an' in this game it
    // genuinely does: misty precedes rain in t' live weather feed. A defined ring at
    // sprite scale read as a silly bright donut (James 2026-07-03) — a REAL 22° halo
    // is huge an' whisper-faint. What tha actually sees most damp nights is t' moon's
    // BURR: a soft aureole hugging t' disc, brightest just off t' limb, fading long
    // an' smooth — no band, no ring edge. Parented to t' moon, opacity in update().
    const hc = document.createElement('canvas'); hc.width = hc.height = 64;
    const hx = hc.getContext('2d');
    const hg = hx.createRadialGradient(32, 32, 0, 32, 32, 32);
    hg.addColorStop(0.00, 'rgba(220,226,236,0.16)'); // brightest at t' disc — mist scatters
    hg.addColorStop(0.30, 'rgba(218,225,235,0.12)'); // in FRONT o' t' moon too, no hole
    hg.addColorStop(0.60, 'rgba(216,224,234,0.05)'); // fading long…
    hg.addColorStop(1.00, 'rgba(216,224,234,0)');    // …to nowt: a burr, not a ring
    hx.fillStyle = hg; hx.fillRect(0, 0, 64, 64);
    this.moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(hc), fog: false, transparent: true, depthWrite: false, opacity: 0,
    }));
    this.moonHalo.scale.set(3.4, 3.4, 1);
    this.moonSprite.add(this.moonHalo);
    this._mistS = 0; // eased misty-weather scalar: drives t' halo [4] an' t' dawn-glow fog [22]

    // stars — [4] t' seeded 1900 sky (buildStarField above): per-star magnitude
    // aMag scales gl_PointSize via onBeforeCompile (r166 points.glsl.js carries t'
    // exact 'gl_PointSize = size;' line), vertex colours ride a temperature ramp,
    // an' under Fine a gentle per-star twinkle breathes them (uTwinkle=1). Plain
    // leaves uTwinkle at 0 so t' twinkle term mixes to a constant 1.0 — same
    // compiled program on both tiers, no define fork, static field on Plain.
    // [CONST] t' field is now t' FULL celestial sphere (catalogue + background)
    // an' update() wheels this one Points object about t' polar axis — so a
    // vFade horizon term dims stars as they set (world y +26 → −14) instead o'
    // lettin' them hang bright below t' fog band. Both tiers: it's correctness
    // for a rotatin' sphere, not decoration.
    const field = buildStarField();
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(field.pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(field.col, 3));
    starGeo.setAttribute('aMag', new THREE.BufferAttribute(field.mag, 1));
    this._starU = { uStarTime: { value: 0 }, uTwinkle: { value: 0 } };
    const starU = this._starU; // closure ref survives t' applyQuality recompile traversal
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.4, transparent: true, opacity: 0, fog: false,
      sizeAttenuation: false, vertexColors: true,
    });
    starMat.onBeforeCompile = (sh) => {
      sh.uniforms.uStarTime = starU.uStarTime;
      sh.uniforms.uTwinkle = starU.uTwinkle;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', 'attribute float aMag;\nuniform float uStarTime;\nuniform float uTwinkle;\nvarying float vFade;\n#include <common>')
        .replace('gl_PointSize = size;',
          // [CONST] horizon fade: LOCAL height o' t' ROTATED star — mat3(modelMatrix)
          // applies t' wheel quaternion wi'out t' viewer-centred translation, so this
          // is true altitude × radius whatever t' player's height. Full by +26
          // (alt ~8°), gone by −14: settin' stars dim into t' horizon haze an'
          // below-horizon stars never pierce t' fog band.
          'vFade = smoothstep(-14.0, 26.0, (mat3(modelMatrix) * position).y);\n' +
          '\tfloat twH = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);\n' +
          '\tfloat twinkle = mix(1.0, 0.78 + 0.44 * (0.5 + 0.5 * sin(uStarTime * (1.5 + twH * 2.5) + twH * 6.2831)), uTwinkle);\n' +
          '\tgl_PointSize = size * aMag * twinkle;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', 'varying float vFade;\n#include <common>')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( diffuse, opacity * vFade );');
    };
    this.stars = new THREE.Points(starGeo, starMat);
    this.scene.add(this.stars);

    // (clouds are rendered inside the sky dome shader below — no flat plane lid)

    // sky dome — a gradient frae horizon to zenith, so t' sky has depth an'
    // wraps round to t' horizon all about, not a flat lid overhead. Horizon
    // colour is fed t' live sky tint each frame, so it keeps day/night,
    // weather, dread an' t' seasonal cast.
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f5074) },
        bottomColor: { value: new THREE.Color(0x9fb6c8) },
        cloudCol: { value: new THREE.Color(0xe8edf2) },
        exponent: { value: 0.7 },
        uTime: { value: 0 },
        uClouds: { value: 0.3 },
        uFogBand: { value: 0.19 }, // horizon band height (dir.y) where t' dome holds t' fog colour
        uFlash: { value: 0 },      // lightning blink: whitens t' cloud term (defaults 0 — Plain untouched)
        uStarAmt: { value: 0 },    // [4] Milky Way strength: starA × (1 − grey), t' same night term as t' stars
        // [CONST] t' Milky Way's frame rides t' star wheel: real galactic pole +
        // in-band mottle axes, rotated by t' star quaternion each frame in update()
        uMWPole: { value: _MW_POLE0.clone() },
        uMWA: { value: _MW_A0.clone() },
        uMWB: { value: _MW_B0.clone() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, // [30] sun direction in dome 'dir' space (frae t' sun ANGLE, not t' sprite)
        uRainbow: { value: 0 },    // [30] rainbow strength (defaults 0 — no bow, today's sky)
        uAurora: { value: 0 },     // [31] aurora strength (defaults 0 — no curtains, today's night)
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor, bottomColor, cloudCol;
        uniform float exponent, uTime, uClouds, uFogBand, uFlash, uStarAmt;
        uniform vec3 uSunDir;                 // [30] sun direction (dome dir space)
        uniform float uRainbow, uAurora;      // [30] rainbow / [31] aurora strengths
        varying vec3 vDir;
        // [4]+[CONST] Milky Way frame: uMWPole is t' REAL north galactic pole in
        // t' catalogue's celestial frame, an' update() rotates it (wi' t' uMWA/uMWB
        // mottle axes) by t' star-wheel quaternion each frame — so t' band turns
        // WITH t' stars: Cygnus an' Cassiopeia keep their seats on it all night,
        // as they do ower t' real moor. T' owd fixed GPOLE arc is retired
        // (James 2026-07-03: real constellations need t' band they sit in).
        uniform vec3 uMWPole, uMWA, uMWB;
        float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; } return v; }
        void main() {
          vec3 dir = normalize(vDir);
          float t = pow(clamp(dir.y, 0.0, 1.0), exponent);
          vec3 col = mix(bottomColor, topColor, t);
          // [4] t' Milky Way: a faint great-circle band, mottled by t' same fbm t'
          // clouds already compile, faded at t' horizon; uStarAmt kills it by day,
          // under overcast an' at full it stays a whisper. Clouds mix OVER it below.
          float mw = exp(-pow(dot(dir, uMWPole), 2.0) * 30.0)
                   * (0.25 + 0.75 * fbm(vec2(dot(dir, uMWA), dot(dir, uMWB)) * 5.0 + 3.7))
                   * smoothstep(0.02, 0.18, dir.y);
          col += vec3(0.52, 0.58, 0.70) * (mw * uStarAmt * 0.07);
          float up = clamp(dir.y, 0.0, 1.0);
          if (up > 0.02) {
            vec2 uv = dir.xz / max(dir.y, 0.06) * 0.55 + uTime * vec2(0.012, 0.007);
            float n = fbm(uv);
            float cover = 0.62 - uClouds * 0.42;
            float cloud = smoothstep(cover, cover + 0.2, n) * smoothstep(0.05, 0.4, up);
            col = mix(col, cloudCol, cloud * 0.85);
            // lightning blink: t' deck itself flashes white where there's cloud to catch it
            col = mix(col, vec3(1.0), uFlash * 0.6 * cloud);
          }
          // [30] rainbow after t' rain: a physically-placed double bow opposite t' sun.
          // ca = cos o' t' angle between t' view ray an' t' ANTISOLAR point (−uSunDir):
          // primary at 42° (ca 0.743), secondary at 51° (ca 0.629). A narrow smoothstep
          // band lights each arc; hue runs a 6-stop spectral ramp across t' band width
          // (red on t' OUTER edge → violet on t' inner, as in a real bow). Alexander's
          // dark band (t' sky is dimmer BETWEEN t' bows) falls out for free. T' whole
          // term is gated by uRainbow (t' CPU folds in dayness × clear-sky × sun-up), so
          // uRainbow=0 is byte-identical to today. Faded in near t' horizon by dir.y.
          if (uRainbow > 0.001) {
            float ca = dot(dir, -uSunDir);
            // 6-stop spectral ramp (red→orange→yellow→green→blue→violet), h in [0,1]
            // across t' band; sampled by t' fractional position through each arc.
            // primary bow: band centred on cos(42°)=0.743, ~0.008 wide either side
            float bw = 0.008;
            float hP = clamp((ca - (0.743 - bw)) / (2.0 * bw), 0.0, 1.0);      // 0 outer(red) → 1 inner(violet)
            float mP = smoothstep(0.0, bw, bw - abs(ca - 0.743));               // narrow arc mask
            // secondary bow: cos(51°)=0.629, REVERSED ramp, dimmer
            float hS = clamp(1.0 - (ca - (0.629 - bw)) / (2.0 * bw), 0.0, 1.0);
            float mS = smoothstep(0.0, bw, bw - abs(ca - 0.629)) * 0.4;
            // spectral colour frae a hue position: red(0)→violet(1)
            vec3 spec = clamp(vec3(
              1.5 - abs(4.0 * hP - 3.0),
              1.5 - abs(4.0 * hP - 2.0),
              1.5 - abs(4.0 * hP - 1.0)), 0.0, 1.0);
            vec3 specS = clamp(vec3(
              1.5 - abs(4.0 * hS - 3.0),
              1.5 - abs(4.0 * hS - 2.0),
              1.5 - abs(4.0 * hS - 1.0)), 0.0, 1.0);
            // Alexander's band: ~5% darker sky between t' bows (0.629 < ca < 0.743)
            float alex = smoothstep(0.629, 0.66, ca) * (1.0 - smoothstep(0.71, 0.743, ca));
            float horiz = smoothstep(0.0, 0.15, dir.y);
            col *= 1.0 - 0.05 * alex * uRainbow * horiz;
            col += (spec * mP + specS * mS) * uRainbow * horiz * 0.9;
          }
          // [31] t' Northern Lights: shimmerin' green curtains ower t' NORTHERN sky on a
          // rare clear night (schedule + gate on t' CPU). North axis = +Z in t' dome's
          // 'dir' space (northDot = dir.z); mask fades t' curtains out t' southern sky an'
          // down to t' horizon. Curtains: t' dome's OWN compiled fbm sampled at
          // (azimuth·6, uTime·0.15) gives driftin' vertical ray streaks; pow(1−altFrac,2)
          // falls t' curtain off wi' height; colour mixes green at t' base → dim magenta
          // at t' top. Gated by uAurora (t' CPU folds in nightness × clear via uStarAmt's
          // own term), so uAurora=0 is byte-identical to today. Plain clamp: force uAurora
          // 0 under sky.gfx==='plain' in update() (one line, noted there).
          if (uAurora > 0.001) {
            float northDot = dir.z;                                            // +Z is north (dome dir space)
            float m = smoothstep(0.0, 0.5, northDot) * smoothstep(0.02, 0.30, dir.y);
            float az = atan(dir.x, dir.z);                                     // azimuth about t' zenith
            float streak = fbm(vec2(az * 6.0, uTime * 0.15));
            float altFrac = clamp(dir.y / 0.6, 0.0, 1.0);                      // 0 base → 1 up t' curtain
            float curtain = m * streak * pow(1.0 - altFrac, 2.0);
            vec3 auroraCol = mix(vec3(0.345, 0.816, 0.553), vec3(0.55, 0.10, 0.28), altFrac); // 0x58d68d → dim magenta
            col += auroraCol * curtain * uAurora * 1.6;
          }
          // horizon fog band: near t' horizon (an' all t' way below it) t' dome holds
          // t' fog colour EXACTLY — bottomColor IS scene.fog.color, both copy t' live
          // sky tint each frame — so terrain dissolvin' into fog an' t' sky it meets
          // are one colour, an' t' world-edge band melts away. Applied AFTER clouds so
          // distant cloud hazes into t' band too. Height breathes wi' fog thickness.
          float hf = 1.0 - smoothstep(0.0, uFogBand, dir.y);
          col = mix(col, bottomColor, hf);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), this.domeMat);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // ---- [19] precipitation rigs: GPU-driven fall, one static allocation each ----
    // Seeded base fields (mulberry32 — nowt frae Math.random in t' rigs any more),
    // allocated ONCE at t' Fine maxima; uDensity culls Plain back to today's exact
    // counts (stratified aSeed → exact-count threshold). All motion lives in t'
    // vertex shader (PRECIP_VERT_MOVE); update() writes a handful o' uniforms.
    // Shared squall/sway/gust uniforms: ONE {value} object drives both materials.
    this._precipShared = {
      uSwayT: { value: 0 },
      uSquall: { value: 0 },                       // 0 = uniform precip = today's look
      uSquallDir: { value: new THREE.Vector2(1, 0) },
      uSquallPh: { value: 0 },
    };
    const precipU = (spanY, botY, spanXZ, swayAmp, density) => ({
      uFall: { value: 0 },
      uCycle: { value: 0 },
      uWindP: { value: new THREE.Vector2(0, 0) },  // 0 = plumb-vertical fall = today
      uSwayAmp: { value: swayAmp },
      uSwayW: { value: 0 },
      uDensity: { value: density },
      uSpanP: { value: new THREE.Vector3(spanY, botY, spanXZ) },
    });

    // rain
    this.rainCount = RAIN_MAX;
    const rainField = buildPrecipField(RAIN_MAX, RAIN_SPAN, 0, 0x5261);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rainField.pos, 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(rainField.seed, 1));
    const rainC = document.createElement('canvas'); rainC.width = 4; rainC.height = 16;
    const rcx = rainC.getContext('2d');
    const grad = rcx.createLinearGradient(0, 0, 0, 16);
    grad.addColorStop(0, 'rgba(190,205,220,0)');
    grad.addColorStop(1, 'rgba(190,205,220,0.8)');
    rcx.fillStyle = grad; rcx.fillRect(1, 0, 2, 16);
    const rainTex = new THREE.CanvasTexture(rainC);
    rainTex.center.set(0.5, 0.5); // [19] map.rotation leans t' streak sprite into t' wind
    this._rainU = precipU(RAIN_SPAN, 0, 40, 0, RAIN_PLAIN / RAIN_MAX); // rain has no calm-air sway (today's look)
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({
      map: rainTex, size: 0.45, transparent: true,
      opacity: 0, depthWrite: false, sizeAttenuation: true,
    }));
    addPrecipMotion(this.rain.material, this._rainU, this._precipShared);
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // snow (winter) — softer, slower, drifting; mirrors the rain rig
    // (-28..+20: a tall column centred on the viewer, so flakes fall through the
    // WHOLE frame — sky → ground — incl. the aerial title orbit)
    this.snowCount = SNOW_MAX;
    this.snowAmount = 0;
    const snowField = buildPrecipField(SNOW_MAX, SNOW_SPAN, -28, 0x534E);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(snowField.pos, 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(snowField.seed, 1));
    const snowC = document.createElement('canvas'); snowC.width = snowC.height = 8;
    const scx = snowC.getContext('2d');
    const sgr = scx.createRadialGradient(4, 4, 0, 4, 4, 4);
    sgr.addColorStop(0, 'rgba(255,255,255,0.95)'); sgr.addColorStop(1, 'rgba(255,255,255,0)');
    scx.fillStyle = sgr; scx.fillRect(0, 0, 8, 8);
    // uSwayAmp 0.86 = t' owd CPU drift integrated: x += sin((t+i)*0.7)*dt*0.6 → amp 0.6/0.7
    this._snowU = precipU(SNOW_SPAN, -28, 80, 0.86, SNOW_PLAIN / SNOW_MAX);
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(snowC), size: 0.5, transparent: true,
      opacity: 0, depthWrite: false, sizeAttenuation: true,
    }));
    addPrecipMotion(this.snow.material, this._snowU, this._precipShared);
    this.snow.frustumCulled = false;
    scene.add(this.snow);
  }

  // [SOLAR] night now ends/starts a fixed ~0.07 twilight past t' SOLAR horizon
  // crossings (equinox: 0.18/0.82 \u2014 byte-identical to t' owd literals; winter
  // nights run ~0.284..0.717, midsummer keeps a short true night ~0.924..0.076).
  isNight() { const s = this.sol; return this.time < s.sunriseT - 0.07 || this.time > s.sunsetT + 0.07; }

  timeName() {
    const t = this.time, s = this.sol;   // [SOLAR] HUD names track t' seasonal sun (equinox = owd 0.18/0.3/0.55/0.75/0.82 exactly)
    if (t < s.sunriseT - 0.07) return 'Neet';
    if (t < s.sunriseT + 0.05) return 'Morn';
    if (t < 0.55) return 'Noontide';
    if (t < s.sunsetT) return "Evenin'";
    if (t < s.sunsetT + 0.07) return 'Gloamin\u2019';
    return 'Neet';
  }

  // returns a weather-change message when t' weather turns, else null
  update(dt, playerPos, season = null, covered = false) {
    let msg = null;
    const prevNight = this.isNight();
    const prevT = this.time;
    this.time += dt / DAY_LENGTH;
    if (this.time >= 1) { this.time -= 1; this.day++; }
    // [4] moon phase: one canvas redraw + CanvasTexture upload per game DAY, never
    // per frame (also catches deserialize() movin' this.day under us)
    if (this._moonDay !== this.day) this._drawMoonPhase();
    // [SOLAR] t' one solar/lunar computation site: everything below (an' t'
    // cached this.sol/this.lun main.js an' t' layers read) hangs off these.
    const yp = this.yearPhase = season ? season.yearPhase : 0.125;
    const sol = this.sol = solarState(this.time, yp);
    const lun = this.lun = lunarState(this.time, yp, this.day);
    if (!prevNight && this.isNight()) msg = { type: 'night' };
    else {
      // [SOLAR] dusk toast rides t' SOLAR sunset (equinox: t' owd 0.74 exactly)
      const duskT = sol.sunsetT - 0.01;
      if (prevT < duskT && this.time >= duskT) msg = { type: 'dusk' };
    }

    // live moor weather frae Open-Meteo when we have a sample: it drives t'
    // weather state directly an' parks t' random timer. Falls back to t' random
    // machine below on any fetch fault (currentWeather() returns null).
    if (this.forceClear) { this.weather = 'clear'; this.weatherTimer = 1e9; } // title backdrop: always a clear morning
    // [warden] scene-preview override (debug.setWeather) wins over BOTH the live forecast and
    // the offline random machine below — checked before the live fetch so a real live sample
    // can't stomp the chosen state a frame later. Never toasts (it's a preview action, not a
    // narrative weather change).
    else if (this.weatherOverride) {
      const o = overrideWeatherState(this.weatherOverride);
      this.weather = o.weather; this.liveRain = o.liveRain; this.liveFog = o.liveFog; this.liveWind = o.liveWind;
      this.weatherTimer = 1e9;
    }
    const live = (this.forceClear || this.weatherOverride) ? null : currentWeather();
    if (live) {
      this.liveRain = live.rainAmount;
      this.liveFog = live.fogFar;
      this.liveWind = live.windiness; // [19] real Goathland wind — finally consumed (drives t' precip slant)
      if (live.state !== this.weather) {
        this.weather = live.state;
        msg = msg || { type: 'weather', text: WEATHER_MSG[live.state] };
      }
      this.weatherTimer = 1e9; // park t' random machine while live weather rules
    } else if (!this.forceClear && !this.weatherOverride) {
      this.liveRain = null;
      this.liveFog = null;
      this.liveWind = null;
    }

    // weather state machine — t' moors are rarely kind
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      const r = Math.random();
      // mostly fair: clear skies the rule, real fog a rare thing (offline fallback only)
      const next = r < 0.58 ? 'clear' : r < 0.82 ? 'misty' : r < 0.95 ? 'rain' : 'fog';
      if (next !== this.weather) {
        this.weather = next;
        msg = msg || {
          type: 'weather',
          text: {
            clear: "Sky's clearin' up. Grand.",
            misty: 'A mist hangs ower t\u2019 moor.',
            rain: 'It\u2019s silin\u2019 it down!',
            fog: 'Fog\u2019s rollin\u2019 in thick. Mind tha doesn\u2019t get lost.',
          }[next],
        };
      }
      this.weatherTimer = 80 + Math.random() * 140;
    }

    // sun position — [SOLAR] frae t' real model: sunY is sin(altitude), sunX t'
    // east component o' t' true sun direction (rises +X — t' star frame's
    // documented chirality; at t' equinox sunX equals t' owd cos((t−0.25)·2π)
    // exactly an' sunY is t' owd sine scaled by cos(54.4°)).
    const sunY = sol.sunAlt, sunX = sol.dir[0];
    const dayness = sol.dayness;
    // golden-hour factor: 1 at t' horizon → 0 by mid-morning (a long golden hour).
    // Hoisted out o' t' Fine day branch ([22]) so Plain reads it too for t'
    // dawn-glow fog tint below. (Same formula, off t' new sun, so it runs past 1
    // below t' horizon exactly as afore — t' fog tint clamps its own copy.)
    const golden = sol.golden;
    // lightning flash: decays fast (~200 ms from a full spike) and briefly floods
    // the scene lighting — spiked by the storm controller (sky.flash = 1).
    this.flash = Math.max(0, this.flash - dt / 0.22);
    const flashLift = this.flash * this.flash * 2.4; // eased, a sharp blue-white burst
    // [4] moon illumination fraction (0 new … 1 full) — hoisted afore t' light rig so
    // t' Fine moonlight scales wi' t' phase (James 2026-07-03: "moon needs to be
    // brighter and actually illuminate"). T' Milky-Way wash further down reads t'
    // SAME const — one computation site, no drift.
    const mwIllum = 0.5 - 0.5 * Math.cos(moonPhase(this.day) * Math.PI * 2);
    const fine = this.gfx === 'fine';
    if (fine) {
      // 'Fine' rig: ACES filmic tone mapping darkens t' mids, so t' curves run hotter —
      // an' ONE directional plays sun by day an' moon by night, so t' single shadow
      // rig follows whichever lamp's up. Positions ride relative to t' player's height
      // so a low sun stays a LOW sun (long dawn/dusk shadows reet across t' moor).
      const moonUp = sunY < -0.02;
      // [SOLAR] moonHigh reads t' moon's OWN altitude now (lun.alt), not t' sun's
      // mirror: a new moon sits near t' sun (down all night — genuinely dark
      // nights), a full moon opposite it as afore. T' phase term (mwIllum) already
      // kills t' light at new moon, so t' two agree.
      const moonHigh = Math.max(0, Math.min(1, (lun.alt - 0.02) * 3));
      // clear-night gate for t' moonlit lift below: instantaneous overcast estimate —
      // eased snowAmount stands in for snowFall (computed further down), t' same
      // stand-in main.js's glitter drive uses. Overcast nights stay properly dark.
      const greyNow = overcastGrey(this.weather, this.snowAmount, this.rainAmount);
      if (moonUp) {
        // [SOLAR] t' lamp stands where t' moon actually is (phase-lagged, ecliptic
        // declination) — t' y clamp keeps a sane rig through moon-down dark nights
        this.sun.position.set(playerPos.x + _dirQ(lun.dir[0] * 70), playerPos.y + _dirQ(Math.max(8, lun.alt * 85)), playerPos.z + _dirQ(lun.dir[2] * 70));
        // phase-scaled moonlight (James 2026-07-03): a full moon genuinely lights t'
        // moor (~2.9x t' owd flat curve, soft shadows read), a thin crescent stays
        // near t' owd faint glow. Same shadow rig follows — position/target swap an'
        // texel snap are shared wi' t' sun path below.
        this.sun.intensity = (0.07 + 0.38 * moonHigh) * (1 + 1.9 * mwIllum) * (1 - this.dread * 0.35) + flashLift;
        this.sun.color.set(0x9cbcf0); // cool blue moonlight
      } else {
        // [SOLAR] real azimuth: t' day sun arcs on t' −Z (sky-south) side, low
        // an' southerly in winter, high wi' NE/NW risings in summer
        this.sun.position.set(playerPos.x + _dirQ(sol.dir[0] * 70), playerPos.y + _dirQ(Math.max(5, sunY * 85)), playerPos.z + _dirQ(sol.dir[2] * 70));
        this.sun.intensity = (0.34 + dayness * 1.72) * (1 - this.dread * 0.35) + flashLift; // golden hoisted above ([22])
        this.sun.color.setHSL(0.07 + 0.045 * (1 - golden), 0.45 + golden * 0.45, 0.74 + (1 - golden) * 0.12);
      }
      // raised ambient floor: tha can navigate by moonlight, but tha'll still want a
      // lamp for warmth, colour an' detail. On a CLEAR moonlit night t' floor lifts
      // wi' t' phase (× (1 − greyNow) so overcast stays dark) — high ambient-to-
      // directional ratio keeps t' full-moon shadows FAINT an' soft, never black-hard.
      this.ambient.intensity = (0.34 + dayness * 0.62 + moonHigh * (0.10 + 0.20 * mwIllum * (1 - greyNow))) * (1 - this.dread * 0.25) + flashLift * 0.7;
    } else {
      // 'Plain': today's light CURVES untouched (pinned below) — only t' lamp's
      // bearing follows t' real sun now ([SOLAR]: seasonal day length is
      // tier-flat; Plain shares t' same sun as Fine, an' at t' equinox this
      // bearing matches t' owd path's shape exactly)
      this.sun.position.set(playerPos.x + sol.dir[0] * 60, sunY * 80, playerPos.z + sol.dir[2] * 60);
      this.sun.intensity = (0.25 + dayness * 1.0) * (1 - this.dread * 0.35) + flashLift;
      this.ambient.intensity = (0.16 + dayness * 0.5) * (1 - this.dread * 0.25) + flashLift * 0.7;
      this.sun.color.setHSL(0.1, dayness < 0.4 ? 0.6 : 0.25, 0.85);
    }
    this.sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    if (fine) this._snapShadowCamera(); // whole-texel frustum steps — rock-steady shadow edges when walkin' (Plain has no shadow map)

    // [SOLAR] sprites ride t' real directions: t' sun's disc rises NE o' a summer
    // morn, SE o' a winter one, an' crawls t' low southern meridian in midwinter;
    // t' moon lags it by t' phase angle (full opposite — t' owd mirror — new near
    // t' sun, crescents on t' twilight horizons). Same 160/150 sprite ellipse an'
    // player-height parallax nicety as afore. T' water blade (main.js) derives its
    // azimuth frae these SAME dir vectors, so blade an' disc stay one body.
    this.sunSprite.position.set(playerPos.x + sol.dir[0] * 160, sol.dir[1] * 150 + playerPos.y * 0.3, playerPos.z + sol.dir[2] * 160);
    this.moonSprite.position.set(playerPos.x + lun.dir[0] * 160, lun.dir[1] * 150 + playerPos.y * 0.3, playerPos.z + lun.dir[2] * 160);

    // sky colour — mixed in-place in t' module scratch _sky ([22] hoist): update()
    // allocates no Colors, every blend below writes ower t' scratch.
    if (sunY > 0.25) _sky.copy(SKY.day);
    else if (sunY > 0) _sky.copy(sunX > 0 ? SKY.dawn : SKY.dusk).lerp(SKY.day, sunY / 0.25);
    else if (sunY > -0.2) _sky.copy(sunX > 0 ? SKY.dawn : SKY.dusk).lerp(SKY.night, -sunY / 0.2);
    else _sky.copy(SKY.night);
    // precipitation: split into snow (wintry) vs rain, using live feed or deterministic clock
    let { snow: snowFall, rain: rainTarget } = winterPrecip(season, this.liveRain != null ? this.liveRain : null, season ? snowfallIntensity(Date.now(), season) : 0);
    // the Dracula storm (sky.stormPrecip, set by the storm controller only while
    // the Count's fight is live) overrides precip to a downpour — snow in winter,
    // else rain. Scoped to the fight: clearing the override restores normal weather.
    if (this.stormPrecip) {
      if (this.stormIsSnow) { snowFall = 1; rainTarget = 0; }
      else { rainTarget = 1; snowFall = 0; }
    }
    const targetRain = rainTarget;

    // weather greys t' sky
    const grey = overcastGrey(this.weather, snowFall, this.rainAmount);
    _sky.lerp(_tmpC.copy(OVERCAST_BASE).multiplyScalar(0.2 + dayness * 0.8), grey);
    // eased misty-weather scalar — drives t' moon halo [4] an' t' dawn-glow fog [22]
    this._mistS += ((this.weather === 'misty' ? 1 : 0) - this._mistS) * Math.min(1, dt * 0.5);
    // Count Dracula's presence: sky bruises, fog thickens — dread afore horror
    this.dread += (this.dreadTarget - this.dread) * Math.min(1, dt * 1.8);
    if (this.dread > 0.02) {
      _sky.lerp(DREAD_BRUISE, this.dread * 0.42);
      _sky.lerp(DREAD_BLOOD, this.dread * 0.12);
    }

    // T' Great Fog: a shared-clock whiteout on t' high moor — same for every
    // player, like t' train. Every three game days, about six game hours
    // comes down thick, eased in an' out ower ~25s.
    // T' game sets moorGate frae geography: tops only, never coast nor village.
    {
      const CYCLE = DAY_LENGTH * 3, DUR = DAY_LENGTH / 4, EASE = 25;
      const into = (Date.now() / 1000) % CYCLE - (CYCLE - DUR);
      let ev = 0;
      if (into >= 0) ev = into < EASE ? into / EASE : Math.min(1, Math.max(0, (DUR - into) / EASE));
      if (this.fogDebug) ev = 1;
      this._gateS += (this.moorGate - this._gateS) * Math.min(1, dt * 1.2);
      this.moorFog = ev * this._gateS;
      if (this.moorFog > 0.01) {
        _sky.lerp(GREATFOG_WHITE, this.moorFog * (0.3 + dayness * 0.55));
      }
    }
    // seasonal cast — summer warms the daylight, winter cools and greys it.
    // Scaled by `dayness` so it only tints the lit sky, not the night.
    if (season) {
      const w = season.warmth; // -1 (deep winter) .. +1 (high summer)
      _sky.lerp(_tmpC.setHSL(w >= 0 ? 0.09 : 0.58, 0.4, 0.5), 0.07 * Math.abs(w) * dayness);
      this.ambient.intensity *= (1 + w * 0.05);
      this.sun.intensity *= (1 + w * 0.04);
    }
    if (fine) {
      // moonlit lift: raise t' night sky off pitch black so silhouettes an' t'
      // horizon read — t' grade pass's lifted blacks finish t' job
      const nightness = Math.max(0, Math.min(1, -sunY * 2.5));
      _sky.lerp(NIGHT_LIFT, nightness * 0.45);
    }
    this.scene.background = this._bg.copy(_sky);

    // sky dome follows t' player; t' zenith deepens by day so there's a proper
    // gradient down to t' horizon.
    this.dome.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.domeMat.uniforms.topColor.value.copy(_sky).lerp(ZENITH_DEEP, 0.5 * dayness);

    // [22] dawn-glow fog — t' SINGLE owner site for t' final fog colour. At low
    // sun, mist takes t' sun's own colour: misty morns glow amber on t' sunward
    // side, dusk haze warms as t' light dies. golden is clamped an' faded out
    // once t' sun sinks ~0.08 below t' horizon, so night mist never borrows t'
    // Fine rig's blue moonlight sun colour at strength. _fogC feeds BOTH
    // scene.fog.color AND t' dome's bottomColor — which uFogBand blends t' dome
    // to at t' horizon (S1d) — so terrain dissolvin' into fog an' t' sky it
    // meets stay ONE colour, tint or no tint.
    const dawnAmt = Math.min(1, golden) * Math.max(0, Math.min(1, 1 + sunY * 12))
      * (1 - grey) * this._mistS * 0.35;
    _fogC.copy(_sky);
    if (dawnAmt > 0.001) _fogC.lerp(this.sun.color, dawnAmt);
    this.scene.fog.color.copy(_fogC);
    this.domeMat.uniforms.bottomColor.value.copy(_fogC);

    // fog distance
    let baseFog = (this.liveFog != null) ? this.liveFog : FOG_BASE[this.weather];
    // a 'misty' moor is a soft far haze tha sees through; only 'fog' walls thee in
    if (this.weather === 'misty') baseFog = Math.max(baseFog, 78);
    else if (this.weather === 'fog') baseFog = Math.min(baseFog, 28);
    if (this.dread > 0.05) baseFog = Math.min(baseFog, 55 - this.dread * 22);
    if (this.moorFog > 0.01) baseFog = Math.min(baseFog, 150 - this.moorFog * 143); // ~7 at full: hand-afore-face stuff
    // T' meshed world ends STREAM_RADIUS (112) blocks out — three o' t' four open-weather
    // targets above (rain 90 / misty 120 / clear 160) put full occlusion AT or PAST that
    // edge, so t' last chunks showed half-fogged against bare dome: t' horizon band.
    // A bare min() would flatten all three into one look, so a soft knee compresses
    // KNEE..160 into KNEE..FOG_FAR_MAX instead — clear stays hazier-than-misty stays
    // hazier-than-rain, but every one lands full occlusion INSIDE t' edge. Owt already
    // under t' knee (thick fog, dread, t' Great Fog) passes through untouched.
    this.fogTargetFar = baseFog <= FOG_KNEE
      ? baseFog
      : FOG_KNEE + (baseFog - FOG_KNEE) * ((FOG_FAR_MAX - FOG_KNEE) / (160 - FOG_KNEE));
    this.fogFar += (this.fogTargetFar - this.fogFar) * Math.min(1, dt * 0.5);
    this.scene.fog.far = this.fogFar;
    // Fog is a BAND at t' edge, not a wash ower t' whole view (James 2026-07-03:
    // "it just needs to smooth over the horizon band"). Open weather: air stays
    // CRISP to ~70 blocks, then dissolves steeply ower t' last ~28 — t' mesh edge
    // vanishes wi'out t' mid-field swimmin' in milk. Mist/rain/dread keep t'
    // fogFar*0.3 near floor (their atmospheric mid-field haze is t' point).
    // T' GREAT FOG is t' same band CLOSING IN (James again, same day): as its
    // wall advances, t' band tightens (gf blend) an' t' floor rises, so t' moor
    // stays crisp right up to t' whiteout — trees are either sharp or swallowed,
    // never half-fogged white ghosts on t' horizon. At full: a crisp ~6-block
    // bubble an' a wall at 7 — still hand-afore-face, wi'out t' ghost zone.
    const gf = this.moorFog;
    const fogBand = (10 + this.fogFar * 0.18) * (1 - gf) + Math.max(2.5, this.fogFar * 0.15) * gf;
    this.scene.fog.near = Math.max(this.fogFar * (0.3 + 0.5 * gf), this.fogFar - fogBand);

    const starA = Math.max(0, -sunY * 2) * (1 - grey * 0.8);
    this.stars.material.opacity = fine ? Math.min(1, starA * 1.6) : starA; // brighter stars ower a moonlit moor
    // [CONST] t' sphere is fully VIEWER-CENTRED now (y follows t' player an' all —
    // was y=0): a celestial sphere sits at infinity, so Polaris must stand 54.4°
    // up frae Whitby sands AND frae Urra Moor top. T' owd y=0 centre compressed
    // star altitudes wi' player height (Polaris read ~38° frae a 66-block hill —
    // caught live, James 2026-07-03). T' horizon fade reads LOCAL rotated height
    // (mat3(modelMatrix)·position), so it measures true altitude regardless.
    this.stars.position.set(playerPos.x, playerPos.y, playerPos.z);
    // [CONST] t' heavens wheel about Polaris: ONE quaternion write turns t' whole
    // Points object (catalogue + background) about t' polar axis — no per-star
    // CPU. Pure in (sky.time, season.yearPhase), both shared clocks, so every
    // client sees t' same sky at t' same moment (skyWheelAngle docs t' mapping:
    // winter midnights carry Orion, summer t' Summer Triangle). Tier-flat, like
    // t' moon calendar — t' heavens aren't a graphics setting.
    this.stars.quaternion.setFromAxisAngle(_POLE_AXIS, skyWheelAngle(this.time, season ? season.yearPhase : 0));
    // [4] twinkle clock — Fine only (Plain's uTwinkle stays 0, so t' term mixes to
    // a constant 1.0). Unbounded accumulator: same precedent as cloudT/uTime below.
    this._starU.uStarTime.value += dt;
    this._starU.uTwinkle.value = fine ? 1 : 0;
    // [4] moon burr: mistiness² × moon-up × clear-of-overcast — t' shepherd's
    // rain-sign, only in properly damp air (squared mist kills t' faint cases).
    // Night eases in ower t' same -0.02 threshold t' Fine light rig swaps at —
    // an' [SOLAR] a second factor fades wi' t' moon's OWN altitude now, so a
    // new moon (down wi' t' sun) casts no halo an' no Milky-Way wash.
    const moonVis = Math.max(0, Math.min(1, (-sunY - 0.02) * 6)) * Math.max(0, Math.min(1, (lun.alt + 0.05) * 8));
    this.moonHalo.material.opacity = this._mistS * this._mistS * moonVis * (1 - grey) * 0.8;

    // drift t' dome clouds on t' wind; coverage frae t' weather, lit by day.
    // While t' boss storm rages (sky.stormChurn, storm controller only) t' deck
    // churns: coverage driven toward full, scroll ~3x, colour pulled near-black —
    // all through t' eased _stormS so t' sky rolls in an' out, never snaps.
    this._stormS += ((this.stormChurn ? 1 : 0) - this._stormS) * Math.min(1, dt * 0.7);
    const churn = this._stormS;
    this.cloudT = (this.cloudT || 0) + dt * (1 + churn * 2);
    const cu = this.domeMat.uniforms;
    cu.uTime.value = this.cloudT;
    cu.uClouds.value += ((grey + (1 - grey) * churn) - cu.uClouds.value) * Math.min(1, dt * 0.5);
    cu.cloudCol.value.setRGB(0.16, 0.18, 0.22).lerp(CLOUD_LIT, dayness); // lit colour hoisted ([22])
    if (churn > 0.001) cu.cloudCol.value.lerp(STORM_CLOUD, churn * 0.9);
    // [4] t' Milky Way rides t' same night term as t' stars, doused by overcast —
    // an' WASHED OUT by a bright moon (as in life: a full moon drowns t' band).
    // James's call 2026-07-03: t' band read as a bright central smear — narrowed
    // (16→30), dimmed (0.16→0.07), mottle deepened, moon-wash added.
    // (mwIllum hoisted above t' light rig — t' phase-scaled moonlight reads it too.)
    cu.uStarAmt.value = starA * (1 - grey) * (1 - 0.55 * moonVis * mwIllum);
    // [CONST] rotate t' Milky Way's frame by t' same wheel as t' stars — copy +
    // applyQuaternion mutate in place, nowt allocated ([22] rule holds)
    cu.uMWPole.value.copy(_MW_POLE0).applyQuaternion(this.stars.quaternion);
    cu.uMWA.value.copy(_MW_A0).applyQuaternion(this.stars.quaternion);
    cu.uMWB.value.copy(_MW_B0).applyQuaternion(this.stars.quaternion);
    // t' cloud deck blinks white wi' each strike (squared, same easin' as flashLift)
    cu.uFlash.value = this.flash * this.flash;
    // horizon-band height follows fog thickness: open weather a low haze line (~0.19),
    // thick fog / dread / t' Great Fog swallow most o' t' sky. Derived frae t' EASED
    // fogFar so t' dome glides through weather transitions in step wi' t' fog itself.
    cu.uFogBand.value = Math.min(0.55, Math.max(0.08, 16 / Math.max(1, this.fogFar)));

    // [30] rainbow after t' rain — driven, gated, eased (all allocation-free scalars).
    // uSunDir is t' TRUE unit sun direction ([SOLAR] — t' full 3-vector now, so
    // t' antisolar bow sits opposite t' real seasonal sun), not t' player-relative
    // sprite position (which is wrong away frae t' origin).
    cu.uSunDir.value.set(sol.dir[0], sol.dir[1], sol.dir[2]).normalize();
    // rise when rain's DECAYIN' frae a real shower toward clear/misty wi' t' sun up;
    // rise briskly (~a few s), decay ower ~90s once t' condition lifts.
    const wantBow = rainbowRising(this.rainAmount, this._prevRain, sunY, this.weather);
    const bowRate = wantBow ? Math.min(1, dt * 0.5) : Math.min(1, dt / 90);
    this._rainbowS += (wantBow - this._rainbowS) * bowRate;
    this._prevRain = this.rainAmount; // this frame's rain becomes next frame's baseline — the ease below moves it, so next frame sees the decay
    // fold day/clear into t' uniform so t' shader stays lean (no redundant dome uniforms):
    // dayness raises it by day, (1−grey) douses it under overcast — a bow needs sun on rain.
    cu.uRainbow.value = this._rainbowS * dayness * (1 - grey);

    // [31] aurora — shared-clock window × clear-night gate, eased in/out. auroraWindow
    // is pure in Date.now (asserted headlessly); clearness gates it (no aurora through
    // cloud), an' the Plain clamp forces it fully off on the tablet tier.
    // ONE-LINE PLAIN CLAMP: change `1` below to `(fine ? 1 : 0)` to keep Plain nights
    // byte-identical (cost is trivial, so it ships on both tiers by default).
    const auroraClear = (1 - grey) * Math.max(0, Math.min(1, -sunY * 3)); // clear × night depth
    const wantAurora = auroraWindow(Date.now()) * auroraClear * 1;        // ← Plain clamp site
    this._auroraS += (wantAurora - this._auroraS) * Math.min(1, dt * 0.4); // ~2.5s ease toward target
    cu.uAurora.value = this._auroraS;

    // ---- [19] precipitation: t' fall itself lives on t' GPU now ----
    // T' owd CPU loops here wrote ~3.3k positions an' uploaded two whole attribute
    // buffers every storm frame. What remains: eased amounts, a handful o' uniform
    // writes (all wrapped in DOUBLE precision CPU-side — no float32 drift ever
    // reaches t' shader), an' one rig-follows-camera position write per rig.
    // Wind = live Goathland windiness (cached above; offline a 0.35 breeze) ×
    // shared-clock gust, hardened by t' boss-storm churn — every client leans as one.
    // [showreel] a ONE-FRAME snap: when the warden's showreel jumps to a new scene it forces the
    // precipitation straight to its target for that scene, so last shot's rain/snow doesn't fade
    // slowly into a clear summer one (and winter starts snowing at once). Off-camera during settle.
    const snap = this._snapPrecip; this._snapPrecip = false;
    this.rainAmount += (targetRain - this.rainAmount) * (snap ? 1 : Math.min(1, dt * 0.8));
    this.rain.material.opacity = covered ? 0 : this.rainAmount * 0.5; // no rain through a roof
    this.snowAmount += ((covered ? 0 : snowFall) - this.snowAmount) * (snap ? 1 : Math.min(1, dt * 0.5));
    this.snow.material.opacity = this.snowAmount * 0.85;
    const rainOn = !covered && this.rainAmount > 0.02;
    const snowOn = this.snowAmount > 0.02;
    if (rainOn || snowOn) {
      const nowMs = Date.now(), nowS = nowMs / 1000;
      const w01 = Math.min(1, (this.liveWind != null ? this.liveWind : 0.35) * windGust(nowMs) + churn * 0.5);
      const wAng = windHeading(nowMs);
      const wSpd = w01 * 12 * (fine ? 1 : 0.4);  // blocks/s — Plain rides t' same path, gentler
      const sh = this._precipShared;
      sh.uSwayT.value = nowS % SWAY_WRAP;
      sh.uSquall.value = w01 * (fine ? 0.65 : 0.4); // calm rain = uniform curtain = today
      sh.uSquallDir.value.set(Math.cos(wAng), Math.sin(wAng));
      sh.uSquallPh.value = (nowS * SQUALL_SPEED * SQUALL_K) % (Math.PI * 2);
      const va = this.camera ? this.camera.position : playerPos;
      if (rainOn) {
        const u = this._rainU, fall = nowS * RAIN_FALL;
        u.uFall.value = fall % RAIN_SPAN;
        u.uCycle.value = Math.floor(fall / RAIN_SPAN) % 1024; // wrapped: keeps t' respawn hash's sin() args small
        u.uWindP.value.set(Math.cos(wAng) * wSpd / RAIN_FALL, Math.sin(wAng) * wSpd / RAIN_FALL);
        u.uSwayW.value = w01 * 0.35;               // turbulence rides t' wind — 0 when calm (today)
        u.uDensity.value = fine ? 1 : RAIN_PLAIN / RAIN_MAX;
        this.rain.position.set(va.x, va.y - 8, va.z);
        // lean t' streak SPRITE into t' wind: point sprites are screen-aligned, so
        // rotatin' t' Points object does nowt to them — t' texture matrix (uvTransform)
        // is what actually slants t' streak. Angle = wind projected on t' camera's
        // right axis vs fall speed; one CPU write, three.js uploads map.matrix itself.
        const e = this.camera ? this.camera.matrixWorld.elements : null;
        this.rain.material.map.rotation = e
          ? Math.atan2(Math.cos(wAng) * wSpd * e[0] + Math.sin(wAng) * wSpd * e[2], RAIN_FALL) : 0;
      }
      if (snowOn) {
        const u = this._snowU, fall = nowS * SNOW_FALL;
        const sSpd = Math.min(wSpd, 7);            // snow streams, but keep t' slope sane (≤ ~1.1)
        u.uFall.value = fall % SNOW_SPAN;
        u.uCycle.value = Math.floor(fall / SNOW_SPAN) % 1024;
        u.uWindP.value.set(Math.cos(wAng) * sSpd / SNOW_FALL, Math.sin(wAng) * sSpd / SNOW_FALL);
        u.uSwayW.value = w01 * 0.9;                // flakes eddy far more than drops
        u.uDensity.value = fine ? 1 : SNOW_PLAIN / SNOW_MAX;
        this.snow.position.set(va.x, va.y, va.z);
      }
    }

    return msg;
  }

  // Quantise t' sun/moon shadow frustum to whole shadow-map texels (Fine only — Plain
  // has no shadow map, an' its light curves stay byte-identical). T' SAME delta lands
  // on position an' target, so t' light direction is untouched; only t' frustum's
  // world anchor snaps, an' t' sampled depth grid stays put under t' walkin' player.
  // Module-scratch vectors — nowt allocated per frame.
  _snapShadowCamera() {
    const pos = this.sun.position, tgt = this.sun.target.position;
    // mirror THREE's LightShadow lookAt basis: z frae target up to t' light,
    // x = up × z (camera right), y = z × x (camera up). z is never parallel to up —
    // sun/moon positions allus carry a ±20/24-block z offset frae t' target.
    _snapZ.subVectors(pos, tgt).normalize();
    _snapX.crossVectors(_SNAP_UP, _snapZ).normalize();
    _snapY.crossVectors(_snapZ, _snapX);
    const ox = pos.dot(_snapX), oy = pos.dot(_snapY);
    const dx = Math.round(ox / SHADOW_TEXEL) * SHADOW_TEXEL - ox;
    const dy = Math.round(oy / SHADOW_TEXEL) * SHADOW_TEXEL - oy;
    pos.addScaledVector(_snapX, dx).addScaledVector(_snapY, dy);
    tgt.addScaledVector(_snapX, dx).addScaledVector(_snapY, dy);
  }

  // [4] Redraw t' 64px moon disc for t' current game day — once per day (an' after
  // deserialize), never per frame. Classic two-arc terminator: t' lit limb is a
  // semicircle on t' lit side, closed by a half-ellipse whose x-radius runs
  // r·|cos(phase·2π)| — crescent through gibbous as t' cosine flips sign. Maria
  // are seeded (mulberry32, INVARIANTS rule 6) so they sit FIXED on t' disc every
  // redraw, on every client. Canvas work stays in-method — headless-safe by t'
  // same rule as t' constructor (t' verify gate never constructs Sky).
  _drawMoonPhase() {
    this._moonDay = this.day;
    const x = this._moonCanvas.getContext('2d');
    x.clearRect(0, 0, 64, 64);
    const p = moonPhase(this.day);
    const k = Math.cos(p * Math.PI * 2); // +1 new … −1 full: terminator x-scale an' bulge side
    const waxing = p < 0.5;
    // a whisper o' earthshine, so t' new moon reads as a dark presence, not a hole
    x.fillStyle = 'rgba(150,160,175,0.10)';
    x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2); x.fill();
    // t' lit shape: outer limb semicircle + terminator half-ellipse
    x.beginPath();
    if (waxing) {
      x.arc(32, 32, 26, -Math.PI / 2, Math.PI / 2, false);                          // lit limb: right
      x.ellipse(32, 32, 26 * Math.abs(k), 26, 0, Math.PI / 2, -Math.PI / 2, k > 0); // k>0 bulges right (crescent), k<0 left (gibbous)
    } else {
      x.arc(32, 32, 26, Math.PI / 2, -Math.PI / 2, false);                          // lit limb: left
      x.ellipse(32, 32, 26 * Math.abs(k), 26, 0, -Math.PI / 2, Math.PI / 2, k > 0);
    }
    x.closePath();
    x.save(); x.clip();
    x.fillStyle = '#d8e0ea'; x.fillRect(0, 0, 64, 64);
    // 4 seeded grey maria, clipped to t' lit shape — they wax an' wane wi' it.
    // Kept well INBOARD o' t' limb (d+r ≤ 13.5 vs disc 26) an' soft: a mare at
    // t' edge read as a black bite out o' t' moon (James 2026-07-03).
    const rnd = mulberry32(STAR_SEED + 7);
    x.fillStyle = 'rgba(146,156,176,0.32)';
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 8, r = 3.5 + rnd() * 4;
      x.beginPath(); x.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, r, 0, Math.PI * 2); x.fill();
    }
    x.restore();
    this._moonTex.needsUpdate = true;
  }

  setDread(v) { this.dreadTarget = Math.max(0, Math.min(1, v)); }

  serialize() { return { time: this.time, day: this.day, weather: this.weather }; }
  deserialize(d) {
    if (!d) return;
    this.time = d.time; this.day = d.day; this.weather = d.weather || 'misty';
  }
}
