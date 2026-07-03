// Moorstead — entry point and game orchestration.
// (Storage keys an' t' save DB keep their owd 'moorcraft' names on purpose:
// renaming them would orphan every player's saves an' login.)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { B, I, BLOCKS, TOOLS, FOODS, isSolid, isCutout, isPlaceable, itemName, HEIGHT, WATER_LEVEL, ADMIN_HASHES } from './defs.js';
import { strSeed } from './noise.js';
import { protectedAt } from './landmarks.js';
import { initMaterials, setSnowLevel, setFrozen, setGlintTime, setWaterTime, setRippleAmp, setFlowAmp, setGlitter, setFresnel, setCamPos, setSunAzim, setSunLow, setCloudTime, setCloudShadow, setWetness, setGroundWet, setSheen, setWetSky, setSwayAmp, setWindAmt, setGustPhase, setDew, setSparkle, getMaterials } from './mesher.js';
import { stepGroundWet } from './wetness.js';
import { stepAccumulation, accumulationTarget, isFrozen, overcastGrey } from './snow.js';
import { getIconURL, retintAtlasForSeason, getCutoutAtlas } from './textures.js';
import { World } from './world.js';
import { Player } from './player.js';
import * as npc from './npc.js';
import { Quests, wantGiants, wantWreck, wantHound } from './quests.js';
import { Economy, bestMarket, FREIGHT_ALLOWANCE, farmRegisterCheck, CHARTER_FEE, livestockPrice, droveValue, convertAt, marketTownName } from './economy.js';
import { deedFee, weeklyUpkeep, isLapsed, DEED, findActiveDeed, findLapsedDeed, inDeed, makeDeed, lapsesUnderUpkeep } from './deeds.js';
import { isFreeRoom, isBairnsRoom, baseRoom, FREE_STARTER } from './rooms.js';
import { boxKey, makeBox, normalizeBox, spillBox } from './save.js';
import { gatherContext, submitFeedback, reportQuiet } from './feedback.js';
import { miningDigGuide } from './mining-guide.js';
import { mayDigDeep, categoryOf } from './editledger.js';
import { commandFromKey } from './herding.js';
import { Milestones } from './milestones.js';
import { Net } from './multiplayer.js';
import { initTelemetry } from './telemetry.js';
import { escHtml } from './escape.js';
import { buildTrain } from './train.js';
import { Rails } from './rails.js';
import { RoadLayer } from './roads.js';
import { FloraLayer } from './floraLayer.js';
import { HearthLayer } from './hearthLayer.js';
import { DripLayer } from './dripLayer.js';
import { SeasonalLayer } from './seasonalLayer.js';
import { FireLayer } from './fireLayer.js';
import { MurmurationLayer } from './birds.js';
import { HarbourLight } from './lighthouse.js';
import { tickFires } from './fire.js';
import { Footprints } from './footprints.js';
import { seasonState, seasonStateAtPhase } from './season.js';
import { activeForageables, hostForageFor, fruitSpeciesAt, fruitTreeRipe } from './forage.js';
import { deepSnow, wintry, yuletide } from './festive.js';
import { FESTIVALS, festivalState, festivalBands } from './festivals.js';
import { DEFAULT_SNOWMAN, cycleSnowman } from './snowman.js';
import { cellInstances } from './flora-placement.js';
import { startLiveWeather } from './weather-live.js';
import { temperatureTarget, stepTemperature } from './temperature.js';
import { boardingFolk } from './trainfolk.js';
import { CarolBox } from './carolBox.js';
import { RosterClient, invalidateSurfCache } from './roster.js';
import { TouchControls, isTouchPrimary } from './touch.js';
import { startUpdateCheck } from './update-check.js';
import { installKiosk } from './kiosk.js';
import { DWELL_T, runProfile, legTime } from './railtime.js';

// Harden the page against stray browser gestures (two-finger swipe-back, long-press menu, text drag)
// an' take it fullscreen on first interaction — so a passing child can't navigate away from the game.
installKiosk();

// driving t' engine yourself (take t' regulator):
const DRIVE_MAXACC = 0.55; // tractive accel at full regulator + full boiler pressure
const DRIVE_BRAKE = 1.4;   // braking decel when tha pulls t' brake on
const DRIVE_DRAG = 0.05;   // rolling resistance (per unit speed)
const DRIVE_GRADE = 7;     // how hard t' gradients pull on her
const DRIVE_VMAX = 13;     // flat-out, a touch brisker than t' timetabled service
const DRIVE_RAKE = 11.6;   // keep t' whole rake on t' line (buffer stops)

// shortest-arc angle lerp, for turnin' t' loco round smoothly at t' termini
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
import { Entities, MOB_TYPES, buildPlayerLookMesh, validatePlayerLook } from './entities.js';
import { auditMobs } from './invariants.js';
import { PET_BENEFIT, PET_KINDS, TAME_GOAL } from './pets.js';
import { EXTRA_FOLK, moodWord } from './villagerlife.js';
import { Sky, resolveQuality, lanternFlicker, moonPhase } from './sky.js';
import { Storm } from './storm.js';
import { AudioEngine } from './audio.js';
import { UI, bearingLabel, shelterToast, stationChipHTML, stationChipUnknownHTML, composeSketch, sketchFilename, offerShapeOk, hasStacks, countsFromSlots, describeStacks, bigMapScreenToWorld } from './ui.js';
import { raycast, boxCollides } from './physics.js';

const REACH = 5.5;

// [16] The horizon sea ring (replaces t' owd UNFOGGED sea-plane backdrop, which
// poked through t' S1d fog clamp as a hard blue streak at t' fog line, visible
// even inland). One flat annulus o' sea round t' player wi' fog: true — THAT is
// t' point: it inherits t' scene fog an' dissolves at t' fog line exactly like
// t' chunk water, so t' sea still runs unbroken to t' horizon off Whitby an'
// nowt shows inland frae t' tops. SEA_RING = false is t' kill switch.
const SEA_RING = true;
const SEA_RING_COL = 0x3a5e7a;            // base water colour (TILE.WATER's speckle base)
const _seaRingCol = new THREE.Color();    // module scratch — no per-frame allocation

// [25] deterministic eye-adaptation base: t' exposure a bright clear midday settles to.
// renderFrame eases toneMappingExposure toward EXPOSURE_BASE-relative targets frae sky
// state (no luminance readback). Fine-only — Plain runs NoToneMapping, so it's inert.
const EXPOSURE_BASE = 1.25;

// Final full-screen pass o' t' 'Fine' post stack (after tone mapping/OutputPass, so it
// works in display sRGB): a gentle vignette, a period colour grade — slightly lifted
// blacks, warm highlights / cool shadows, t' watercolour-plate feel, kept SUBTLE —
// an' a one-LSB dither to kill t' banding in t' sky gradient.
const GradeShader = {
  name: 'MoorGradeShader',
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 },
    uSharp: { value: 0 },                                      // CAS strength — ~0 at full res, rises as t' governor steps t' resolution down
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },  // 1 / render-target pixel; kept honest by applyResolution()
    // [26] GradeShader v2 (Fine-only — Plain has no composer/grade). All default 0 so a
    // fresh compile is today's plate exactly; driven per frame frae sky state in renderFrame.
    uDread: { value: 0 },                                      // [26] Dracula dread: desaturate toward luma + tighten t' vignette
    uGrain: { value: 0.015 },                                  // [26] period photographic-plate grain, luminance-scaled (stronger in shadow)
    uWarmth: { value: 0 },                                     // [26] golden-hour warmth: leans t' split-tone toward amber (0..1)
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSharp;
    uniform vec2 uTexel;
    uniform float uDread;   // [26]
    uniform float uGrain;   // [26]
    uniform float uWarmth;  // [26]
    varying vec2 vUv;
    float hash12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // AMD-CAS-shaped sharpen: puts crispness back when t' frame-time governor drops
      // t' render resolution. 4 cross-taps, local min/max, contrast-adaptive weight.
      vec3 nN = texture2D(tDiffuse, vUv + vec2(0.0, -uTexel.y)).rgb;
      vec3 nS = texture2D(tDiffuse, vUv + vec2(0.0,  uTexel.y)).rgb;
      vec3 nW = texture2D(tDiffuse, vUv + vec2(-uTexel.x, 0.0)).rgb;
      vec3 nE = texture2D(tDiffuse, vUv + vec2( uTexel.x, 0.0)).rgb;
      vec3 mn = min(c, min(min(nN, nS), min(nW, nE)));
      vec3 mx = max(c, max(max(nN, nS), max(nW, nE)));
      vec3 w = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0)) * uSharp;
      c = max(vec3(0.0), c * (1.0 + 4.0 * w) - (nN + nS + nW + nE) * w); // kernel weights sum to 1
      // [26] corner fringe — a whisper o' chromatic aberration only at t' extreme corners,
      // as if shot through a period lens: 2 extra taps re-sample red/blue pushed radially
      // out by q·dot(q,q)·0.0015 (nil in t' centre where dot(q,q)→0). Centre is untouched.
      vec2 qf = vUv - 0.5;
      vec2 fr = qf * dot(qf, qf) * 0.0015;
      c.r = texture2D(tDiffuse, vUv + fr).r;
      c.b = texture2D(tDiffuse, vUv - fr).b;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      // cool shadows, warm highlights — a Victorian hand-tinted plate, not teal-an'-orange.
      // [26] uWarmth leans t' warm-highlight vector further amber at golden hour (killed [3]'s
      // warmth lands here as t' single owner): 1.045,1.005,0.955 -> ~1.07,1.01,0.92.
      vec3 hiTone = mix(vec3(1.045, 1.005, 0.955), vec3(1.07, 1.01, 0.92), uWarmth);
      c = mix(c, c * vec3(0.965, 0.99, 1.055), (1.0 - smoothstep(0.0, 0.45, lum)) * 0.5);
      c = mix(c, c * hiTone, smoothstep(0.55, 1.0, lum) * 0.5);
      // [26] dread desaturate — t' Dracula window bleeds t' colour toward luma (uDread·0.35)
      c = mix(c, vec3(lum), uDread * 0.35);
      // gently lifted blacks
      c = c * 0.965 + 0.014;
      // vignette — soft, drawn in at t' corners only. [26] dread TIGHTENS it (0.42 -> +uDread·0.2)
      // so t' storm-window closes in on thee, not merely dims t' lights.
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * (0.42 + uDread * 0.2);
      // [26] film grain — a monochrome plate grain, stronger in t' shadows (1 - lum·0.7), like a
      // period photographic emulsion. Reuses hash12 + uTime (viewer-local cosmetic, deterministic).
      c += (hash12(vUv * 913.7 + fract(uTime) * 61.0) - 0.5) * uGrain * (1.0 - lum * 0.7);
      // ordered-ish temporal dither (±0.5 LSB) — kills sky banding
      c += (hash12(vUv * vec2(3141.59, 2718.28) + fract(uTime) * 17.0) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// ---- frame-time resolution governor: PURE decision logic -----------------------
// GOV-PURE-BEGIN (self-contained: no THREE, no window, no closures over module state.
// main.js can't be imported under Node — it boots t' game at module scope — so a verify
// script slices this block out o' t' source text, strips t' `export `s, an' evals it.)
export const GOV_SCALES = [1.5, 1.25, 1.0]; // pixel-ratio ladder, full res first
export const GOV_SLOW_MS = 26;   // EMA'd frame ms above this…
export const GOV_SLOW_HOLD = 3;  // …sustained this many seconds -> step DOWN a rung
export const GOV_FAST_MS = 18;   // EMA'd frame ms below this…
export const GOV_FAST_HOLD = 20; // …sustained this many seconds -> step back UP
// One rung per decision. Going down: 4x MSAA -> FXAA first (t' cheap AA), THEN pixel
// ratio down GOV_SCALES. Recovery climbs t' pixel ratio back one step at a time but
// never re-arms MSAA — a machine that buckled under it once would only oscillate.
// state = { level, aa: 'msaa'|'fxaa', badSince, goodSince }; dtEmaMs = smoothed frame
// time in ms; nowSec = a monotonic seconds clock. Returns t' NEXT state (never mutates
// t' input) plus { scale, changed } — t' caller applies scale/aa when changed is true.
export function stepGovernor(state, dtEmaMs, nowSec) {
  let { level, aa, badSince, goodSince } = state;
  badSince = dtEmaMs > GOV_SLOW_MS ? (badSince == null ? nowSec : badSince) : null;
  goodSince = dtEmaMs < GOV_FAST_MS ? (goodSince == null ? nowSec : goodSince) : null;
  let changed = false;
  if (badSince != null && nowSec - badSince >= GOV_SLOW_HOLD) {
    if (aa === 'msaa') { aa = 'fxaa'; changed = true; }                       // rung 1: drop MSAA for FXAA
    else if (level < GOV_SCALES.length - 1) { level += 1; changed = true; }   // then: resolution down
    if (changed) { badSince = null; goodSince = null; }
    else badSince = nowSec;  // floor o' t' ladder — nowt left to shed, keep watching quietly
  } else if (goodSince != null && nowSec - goodSince >= GOV_FAST_HOLD) {
    if (level > 0) { level -= 1; changed = true; }                            // one step back up
    badSince = null; goodSince = null;  // restart t' clock (or stop it, if fully restored)
  }
  return { level, aa, badSince, goodSince, scale: GOV_SCALES[level], changed };
}
// GOV-PURE-END

class Game {
  constructor() {
    this.state = 'title';
    this.keys = {};
    this.mouseDown = [false, false, false];
    this.placeRepeat = 0;
    this.holdToPlace = false; // one block per click; true = deliberate hold lays a line
    this.breakTarget = null;
    this.breakProgress = 0;
    this.autosaveTimer = 30;
    this.heldIconId = -1;
    this.seasonOverride = null; // dev: set 0..1 to force a year phase (moorstead.debug.setSeason)
    this.season = null;         // cached per-frame season, read by sky/audio/foraging
    this.snowAccum = 0;         // lagged snow accumulation [0,1]; eases in/out with season
    this.groundWet = 0;         // [D6]/[D10] lagged ground wetness [0,1]; soaks fast in rain, dries slow
    this._seasonBucket = -1;    // throttles the atlas re-tint to ~40 steps a year
    this.trainFolk = [];        // local folk ridin' t' carriage right now
    this.lastDwellStation = -1; // which platform she's stood at (for boarding)
    this.mount = null;          // the moorland pony tha's ridin', or null
    this.boat = null;           // the coble tha's sailin', or null

    // frame-time resolution governor (Fine only — see stepGovernor above)
    this._resScale = 1.5;   // pixel-ratio cap: t' real DPR is min(devicePixelRatio, this)
    this._dtEma = 1 / 60;   // EMA'd frame dt (seconds) — t' governor's ear to t' ground
    this._govT = 0;         // decision cadence: t' pure step runs twice a second, not per frame
    this._govState = null;  // { level, aa, badSince, goodSince } — made on first Fine
    this._texLoader = null; // shared TextureLoader for t' held-item viewmodel icon

    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this._resScale));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.domElement.className = 'game';
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 600);
    this.camera.rotation.order = 'YXZ';

    this.atlas = initMaterials();
    // cutout foliage casts leaf-shaped shadows, not quad-shaped ones: t' shadow-map
    // depth pass needs its own alpha-tested depth material (shared, one instance)
    this._cutoutDepth = new THREE.MeshDepthMaterial({
      // t' NO-MIP twin o' t' atlas: t' main atlas is mipped now, an' alphaTest 0.5
      // through shrinking mip alpha would fizzle t' leaf-shaped shadows at range
      depthPacking: THREE.RGBADepthPacking, map: getCutoutAtlas(), alphaTest: 0.5,
    });

    this.audio = new AudioEngine();
    this.ui = new UI(this);

    // block highlight
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    // lantern light pool
    this.lanternLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffb84a, 0, 13, 1.6);
      this.scene.add(l);
      this.lanternLights.push(l);
    }
    // held-torch light follows t' player
    this.torchLight = new THREE.PointLight(0xffa040, 0, 11, 1.5);
    this.scene.add(this.torchLight);
    // t' storm lantern in thi fist: warm paraffin flame behind glass — wider an'
    // steadier than a torch, wi' a gentle wick-flicker (see lanternFlicker in sky.js).
    // Casts NO shadow (point shadows are too dear) but blooms naturally under 'Fine'.
    this.stormLight = new THREE.PointLight(0xffb46b, 0, 18, 1.2); // ~18-block throw, soft falloff (tuned by eye at neet)
    this.scene.add(this.stormLight);
    this._stormHeld = false; // read by t' world.nearLight wrap (ward + spawn gating)

    // held item sprite (viewmodel)
    this.heldSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    this.heldSprite.scale.set(0.55, 0.55, 0.55);
    this.heldSprite.position.set(0.62, -0.55, -1.1);
    this.heldSprite.renderOrder = 999;
    this.heldSprite.visible = false;
    this.camera.add(this.heldSprite);
    this.scene.add(this.camera);

    this.bindEvents();
    // graphics quality: 'fine' (ACES + shadows + post stack) or 'plain' (today's pipeline).
    // Explicit choice persists in localStorage; else Fine on a computer, Plain on touch.
    try { this.gfxStored = localStorage.getItem('moorcraft-gfx'); } catch { this.gfxStored = null; }
    this.applyQuality(resolveQuality(this.gfxStored, !!(this.touch && this.touch.active)));
    try { this.auth = JSON.parse(localStorage.getItem('moorcraft-auth') || 'null'); }
    catch (e) { this.auth = null; reportQuiet('auth-parse', e); /* storage blocked (Safari private mode / cookies off) — don't abort boot; worth counting, it silently logs an invited player out */ }
    this.refreshAdmin();
    this.ui.setLoggedIn(this.auth);
    this.recordVisit('landing');
    this.ui.show('titleScreen');

    this.clock = new THREE.Clock();
    this.setupDebug();
    startLiveWeather(); // poll the real moor weather (Open-Meteo); harmless at the title, degrades to random
    // Bug-capture telemetry: forward uncaught errors to the relay bot over the
    // existing multiplayer WS. Closures read this.net / this.debug at report
    // time so they work whether or not the net is connected yet.
    initTelemetry(
      () => this.net   || null,
      () => this.debug || null,
    );
    // Shared-moor connection diagnostics — type `netDiag()` in the console any time
    // the thread drops to see WHY (close-reason taxonomy, drop counts, RTT, recent log).
    if (typeof window !== 'undefined') window.netDiag = () => this.netDiag();
    this.renderer.setAnimationLoop(() => this.frame());
    // Watch for a newer deploy: silent unless the dev bumped package.json "version"
    // (Notify toast) or raised "minClientVersion" (Force auto-reload). See update-check.js.
    startUpdateCheck(this);
  }

  // ---------------- graphics quality (Fine / Plain) ----------------
  // 'Fine': ACES filmic tone mapping, a single player-tracking sun/moon shadow rig,
  // an' a post stack (bloom + period grade + dither). 'Plain': today's pipeline,
  // renderer left exactly as it allus was — t' safety net for tablets an' owd kit.
  applyQuality(q) {
    this.gfxQuality = q;
    const fine = q === 'fine';
    // [15]/[D0] living water: effect amps stamped per tier. Plain = all 0, so t' liquid
    // shader terms multiply out to nowt an' t' output stays byte-identical flat water
    // (t' aTop/aFlow attributes are inert data). uGlitter is re-driven every frame under
    // Fine (dayness × clear sky); parked at 0 here so Plain never sparkles.
    setRippleAmp(fine ? 0.05 : 0);
    setFlowAmp(fine ? 0.05 : 0);
    setGlitter(0);
    setFresnel(fine ? 0.35 : 0);
    // [0] cloud shadows parked at 0: on Plain t' shader branch never executes an'
    // terrain stays byte-identical; Fine re-drives it every frame (frame loop).
    setCloudShadow(0);
    // [9/17]+[D6]+[D10] wet ground: t' diffuse darkening + puddle mask are TIER-FLAT
    // (uWetness/uGroundWet re-driven every frame both tiers — weather readin' on t'
    // ground helps tablets most). Only t' Fine-only sheen + t' sky-colour puddle tint
    // are parked here: uSheen=0 kills t' grazing term, uWetSky=BLACK so a puddle on
    // Plain darkens but takes no sky colour (darkenin' stays, tint is Fine-only).
    setSheen(fine ? 0.5 : 0);
    setWetSky(0, 0, 0);
    // [10]+[D14] flora sway: Plain runs a gentler 0.04 amp (vertex-only, tablet-safe) so
    // t' moor still breathes; [14] frost sparkle + [D8] dew are Fine-only (bloom-flattered).
    setSwayAmp(fine ? 0.06 : 0.04);
    setSparkle(fine ? 0.4 : 0);
    setDew(0);
    const r = this.renderer;
    if (fine) {
      r.toneMapping = THREE.ACESFilmicToneMapping;
      // [25] deterministic eye adaptation: base exposure EXPOSURE_BASE = 1.25 (tuned by eye on
      // t' summer moor — 1.15 ran a touch murky at dawn); renderFrame eases it toward a
      // per-frame target frae dayness/roof/lantern state (bright midday ~1.15 -> neet ~1.32,
      // +0.15 under cover, +0.05 wi' a flame lit). Inert on Plain (NoToneMapping ignores it).
      r.toneMappingExposure = EXPOSURE_BASE;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      // AA opening stance under Fine: FXAA for touch-primary/mobile (MSAA bandwidth is
      // dear on tile GPUs), 4x MSAA for t' desktop. Learned governor state (rungs already
      // shed this session) survives a Plain round-trip on purpose — t' machine hasn't changed.
      if (!this._govState) {
        const mobile = isTouchPrimary(q => window.matchMedia(q), navigator)
          || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
        this._govState = { level: 0, aa: mobile ? 'fxaa' : 'msaa', badSince: null, goodSince: null };
      }
      this._resScale = GOV_SCALES[this._govState.level];
      this.setupComposer();
    } else {
      // Plain path: leave t' renderer untouched (library defaults, no composer, no shadows)
      r.toneMapping = THREE.NoToneMapping;
      r.toneMappingExposure = 1;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.shadowMap.enabled = false;
      this.teardownComposer();
      this._resScale = 1.5;    // Plain always runs t' full min(dpr, 1.5) — as it allus did
      this.applyResolution();
    }
    if (this.sky) {
      this.sky.gfx = q; // sky swaps in its ACES-retuned day/dusk/night curves under Fine
      const sun = this.sky.sun;
      sun.castShadow = fine;
      if (fine) {
        // one tight, cascaded-feeling orthographic frustum following t' camera (~70 m):
        // 2048px PCFSoft; generous normalBias — voxel faces acne easily, an' t' baked
        // per-vertex AO already owns contact darkening, so bias costs us nowt visible
        const s = sun.shadow;
        s.mapSize.set(2048, 2048);
        s.camera.left = -70; s.camera.right = 70; s.camera.top = 70; s.camera.bottom = -70;
        s.camera.near = 0.5; s.camera.far = 400;
        s.bias = -0.0004; s.normalBias = 0.8;
        s.camera.updateProjectionMatrix();
        if (s.map) { s.map.dispose(); s.map = null; } // re-allocate at t' new size
      }
      this.sky.stars.material.size = fine ? 1.9 : 1.4; // brighter stars read at neet under Fine
    }
    // shadow/tone-mapping defines live in t' compiled programs — force a recompile
    this.scene.traverse(o => {
      const m = o.material;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
    this.applyShadowFlags(fine);
    this._shadowFlagT = 0;
    if (this.ui && this.ui.btnGfx) this.ui.btnGfx.innerHTML = 'Graphics: ' + (fine ? 'Fine' : 'Plain');
  }

  setupComposer() {
    if (this.composer) return;
    // Scene target is explicit so it can carry MSAA (r166 is WebGL2-only): half-float,
    // 4 samples on t' desktop rung. T' composer clones it for ping-pong an' t' GL layer
    // resolves t' multisample buffer afore bloom ever samples it. FXAA rung (an' t'
    // touch/mobile opening stance) runs samples:0 wi' t' FXAA pass enabled instead.
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: this._govState && this._govState.aa === 'msaa' ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // subtle threshold — only genuine lights bloom: lantern flames, lit windows at
    // dusk, t' sun itsen, an' a whisper on t' bright horizon at golden hour
    this.bloomPass = new UnrealBloomPass(size, 0.32, 0.5, 0.85);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass()); // tone mapping + sRGB out
    // FXAA sits AFTER OutputPass (it wants display-space sRGB luma) an' BEFORE t' grade
    // (so t' temporal dither stays crisp, laid on top o' t' antialiased image)
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.enabled = !!this._govState && this._govState.aa === 'fxaa';
    this.composer.addPass(this.fxaaPass);
    this.gradePass = new ShaderPass(GradeShader); // vignette + period grade + dither (display space)
    this.composer.addPass(this.gradePass);
    this.applyResolution(); // normalise composer size/pixel-ratio + feed FXAA/CAS their texel sizes
  }

  teardownComposer() {
    if (!this.composer) return;
    // passes hold their own GPU targets/materials — t' composer doesn't dispose 'em
    if (this.bloomPass) this.bloomPass.dispose();
    if (this.gradePass) this.gradePass.dispose();
    if (this.fxaaPass) this.fxaaPass.dispose();
    this.composer.dispose(); this.composer = null; this.gradePass = null; this.bloomPass = null; this.fxaaPass = null;
  }

  // Governor rung 1 (desktop): swap t' 4x MSAA scene target for FXAA — t' sample count
  // is baked into t' render targets, so t' whole stack comes down an' goes back up.
  rebuildComposer() {
    if (!this.composer) return;
    this.teardownComposer();
    this.setupComposer(); // reads this._govState.aa for samples/FXAA-enable
  }

  // T' one place t' real canvas resolution is resolved: min(devicePixelRatio, governor
  // scale). Called at composer build, on resize (re-reads DPR — dragging t' window to
  // another monitor used to be ignored), an' whenever t' governor steps a rung.
  applyResolution() {
    const pr = Math.min(window.devicePixelRatio || 1, this._resScale);
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    if (this.fxaaPass) this.fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (this.gradePass) {
      this.gradePass.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
      // CAS strength rides t' GOVERNOR step, not raw DPR — a 1x monitor at full
      // quality gets no sharpen; only a stepped-down rung does
      this.gradePass.uniforms.uSharp.value = Math.max(0, (1.5 - this._resScale) * 0.5);
    }
  }

  // Chunk meshes are built off-thread o' this file (world.js/mesher.js), so shadow
  // flags are stamped by traversal: voxel opaque/cutout cast an' receive, liquid does
  // neither (transparent), an' owt else Lambert-solid (villagers, t' train, station
  // fabric) casts an' all. Sky dome, sprites, points an' fire glow are left be.
  applyShadowFlags(on = this.gfxQuality === 'fine') {
    const mats = getMaterials() || {};
    const dome = this.sky && this.sky.dome;
    this.scene.traverse(o => {
      if (!o.isMesh || o === dome) return;
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      if (m === mats.liquid) { o.castShadow = false; o.receiveShadow = false; return; }
      if (m === mats.cutout) {
        o.castShadow = on; o.receiveShadow = on;
        o.customDepthMaterial = on ? this._cutoutDepth : undefined;
        return;
      }
      if (m === mats.opaque) { o.castShadow = on; o.receiveShadow = on; return; }
      if (m.isMeshLambertMaterial && !m.transparent) { o.castShadow = on; o.receiveShadow = on; }
    });
  }

  // T' one render call: through t' post stack under 'Fine', straight through under 'Plain'.
  renderFrame(dt) {
    if (this.composer && this.gfxQuality === 'fine') {
      if (this.gradePass) this.gradePass.uniforms.uTime.value = (this.gradePass.uniforms.uTime.value + dt) % 64;
      // [25]/[26]/[27] living exposure/bloom/grade — three coordinated, DETERMINISTIC drives
      // frae sky state already in hand (no luminance readback, no per-frame alloc). All Fine-
      // only (guarded by this branch); Plain never reaches here, so it stays byte-identical.
      if (this.sky) {
        const sky = this.sky;
        // [SOLAR] sunY/dayness read frae t' ONE solar API (sky.sol, cached by
        // sky.update each frame) — t' owd sin((time−0.25)·2π) replica is retired;
        // nightness its complement; golden = a low-sun factor that peaks at t' horizon
        // hours an' self-zeroes by full daylight OR deep neet (sun below −0.05 kills it) —
        // NOTE a low winter noon now keeps a touch o' golden all day, as it should.
        const sunY = sky.sol.sunAlt;
        const dayness = sky.sol.dayness;
        const nightness = 1 - dayness;
        const golden = sunY > -0.05 ? Math.max(0, 1 - Math.abs(sunY) / 0.30) : 0;

        // A) [25] deterministic eye adaptation — ease toneMappingExposure toward a target frae
        // dayness (bright midday ~1.15 -> neet ~1.32), +0.15 under a roof so lantern-lit interiors
        // read, +0.05 while a flame's lit. Slow lag (dt·0.4) sells step-in/step-out.
        const r = this.renderer;
        let expTarget = EXPOSURE_BASE - 0.10 + nightness * 0.17; // 1.15 clear midday -> 1.32 outdoors neet
        if (this._covered) expTarget += 0.15;
        if (this._stormHeld || (this.torchLight && this.torchLight.intensity > 0)) expTarget += 0.05;
        r.toneMappingExposure += (expTarget - r.toneMappingExposure) * Math.min(1, dt * 0.4);

        // B) [27] living bloom — swells frae a daytime whisper to a proper amber halo at neet,
        // wi' a golden-hour horizon flare. Constructor literals (0.32/0.5/0.85) stand; these are
        // plain property writes UnrealBloomPass re-reads each render (r166) — no rebuild.
        if (this.bloomPass) {
          this.bloomPass.strength = 0.32 + nightness * 0.14 + golden * 0.1;
          this.bloomPass.threshold = 0.85 - nightness * 0.06;
        }

        // C) [26] GradeShader v2 uniforms — dread frae t' live storm level (Dracula window
        // desaturates + tightens t' vignette), warmth frae t' golden factor (amber split-tone),
        // grain constant. Deterministic pure functions of sky state.
        if (this.gradePass) {
          const gu = this.gradePass.uniforms;
          gu.uDread.value = sky.dread || 0;
          gu.uWarmth.value = golden;
        }
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // Pretty-print the shared-moor connection report to the console an' return it.
  netDiag() {
    if (!this.net) { console.log('%cMoorstead net: not on the shared moor.', 'color:#c93'); return null; }
    const r = this.net.report();
    console.log(`%cMoorstead net — ${r.state}`, 'font-weight:bold;color:#6a9',
      `· up ${r.uptimeSec}s · connects ${r.connects} · drops ${r.drops} · RTT ${r.lastRttMs ?? '—'}ms · msg-age ${r.lastMsgAgeSec ?? '—'}s`);
    if (r.drops) console.log('drops by cause:', r.dropsByKind, '| last:', r.lastDrop);
    if (console.table) console.table(r.recent);
    console.log(r);
    return r;
  }

  // ---------------- dev introspection ----------------
  // Render state as data, not pixels: query the live scene graph over the
  // console (or via preview_eval) instead of taking slow screenshots.
  // e.g.  moorstead.debug.viewProbe()  — what the camera sees in each direction
  //       moorstead.debug.lookingAt()  — first mesh down the camera ray
  //       moorstead.debug.warp('Whitby')
  setupDebug() {
    const G = this;
    const V = THREE.Vector3;
    const r2 = n => Math.round(n * 100) / 100;
    const fmt = v => ({ x: r2(v.x), y: r2(v.y), z: r2(v.z) });
    const describe = h => {
      if (!h) return null;
      const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
      const transparent = !!(m && m.transparent && m.opacity < 0.5);
      return {
        dist: r2(h.distance),
        opaque: !transparent,            // a clear pane is NOT a blocker
        name: h.object.name || h.object.geometry?.type || h.object.type || 'mesh',
        color: m && m.color ? '#' + m.color.getHexString() : null,
        point: fmt(h.point),
      };
    };
    // cast a ray frae the camera (or a given origin) and report the first mesh.
    // We gather solid meshes only — Sprites (the held-item viewmodel, sun/moon)
    // can't be raycast safely, and we skip the block highlight.
    const cast = (dir, maxDist = 96, origin) => {
      const o = origin ? new V(origin.x, origin.y, origin.z) : G.camera.position.clone();
      const d = (dir ? new V(dir.x, dir.y, dir.z) : G.camera.getWorldDirection(new V())).normalize();
      const meshes = [];
      G.scene.traverse(m => { if (m.isMesh && m.visible && m !== G.highlight) meshes.push(m); });
      const rc = new THREE.Raycaster(o, d, 0.01, maxDist);
      return describe(rc.intersectObjects(meshes, false)[0]);
    };
    this.debug = {
      cast,
      camera() {
        const dir = G.camera.getWorldDirection(new V());
        return {
          pos: fmt(G.camera.position), dir: fmt(dir),
          fov: r2(G.camera.fov), near: G.camera.near, far: G.camera.far,
          state: G.state, riding: !!G.ride,
        };
      },
      lookingAt(maxDist = 96) { return cast(null, maxDist); },
      // What does the camera see left / right / forward / back / up? Each entry
      // is the first mesh in that direction with whether it's an opaque blocker.
      // The fast regression check for "can't see out the window".
      viewProbe(maxDist = 8) {
        const q = G.camera.quaternion;
        const axes = { fwd: [0, 0, -1], back: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0] };
        const out = {};
        for (const [k, a] of Object.entries(axes)) out[k] = cast(new V(...a).applyQuaternion(q), maxDist);
        return out;
      },
      train() {
        if (!G.train) return null;
        const cg = G.train.carriage.group;
        return { trainState: G.trainState ? { ...G.trainState } : null, carriagePos: fmt(cg.position), riding: !!G.ride };
      },
      // dev: scan the LIVE world for gameplay-invariant violations — e.g. a tame
      // beast standing on a river (the thing tha can SEE but the old verify suite
      // couldn't). Same catalogue runs headlessly in scripts/verify-invariants.mjs.
      //   moorstead.debug.audit()
      audit() {
        if (!G.world || !G.entities) return 'no world loaded';
        const violations = auditMobs(G.world, G.entities.mobs);
        if (violations.length) console.warn(`[audit] ${violations.length} violation(s)`, violations);
        else console.log('[audit] clean — no invariant violations');
        return { count: violations.length, violations };
      },
      warp(target) {
        const geo = G.world && G.world.gen && G.world.gen.geo;
        if (!geo || !G.player) return 'no world loaded';
        const st = geo.railway().find(s => s.name.toLowerCase() === String(target).toLowerCase());
        if (st) {
          G.player.pos = { x: st.x + 0.5, y: geo.height(Math.floor(st.x), Math.floor(st.z)) + 2, z: st.z + 0.5 };
          G.player.vel = { x: 0, y: 0, z: 0 };
          return `warped to ${st.name} (${st.x}, ${st.z})`;
        }
        if (target === 'train' && G.trainState) {
          G.player.pos = { x: G.trainState.x, y: 60, z: G.trainState.z };
          return 'warped above the train';
        }
        return `unknown target "${target}" — try a station name or "train"`;
      },
      // dev: force a season by year phase 0..1 (0.45 = late summer, 0.875 = deep
      // winter), or null to resume real wall-clock time.
      setSeason(p) {
        G.seasonOverride = (p == null ? null : Math.max(0, Math.min(0.999, p)));
        // snap the lying snow to the new season so a flip shows snow at once
        G.snowAccum = accumulationTarget(G.seasonOverride != null ? seasonStateAtPhase(G.seasonOverride) : seasonState());
        return G.seasonOverride;
      },
      // dev/warden: force a weather state ('clear'|'misty'|'rain'|'fog'), or null/'live' to
      // resume the real forecast. Overrides win over BOTH the live feed and the random
      // offline machine (see sky.js's weatherOverride handling). 'rain' also forces a real
      // rainAmount so precipitation actually falls regardless of season — see
      // overrideWeatherState() in sky.js.
      //   moorstead.debug.setWeather('rain')   moorstead.debug.setWeather(null) // back to live
      setWeather(state) {
        const known = ['clear', 'misty', 'rain', 'fog'];
        if (state == null || state === 'live') { G.sky.weatherOverride = null; return 'live'; }
        if (!known.includes(state)) return { error: 'unknown weather', known };
        G.sky.weatherOverride = state;
        return state;
      },
      // dev/warden: jump to any time of day (0..1 day-fraction), or leave unset to keep
      // advancing normally. One-shot set — mirrors setSeason's clamp; time keeps ticking
      // forward from wherever this leaves it (same behaviour the title-flyover's hardcoded
      // sky.time assignment already has).
      //   moorstead.debug.setTime(0.75)   // dusk
      setTime(t) {
        G.sky.time = Math.max(0, Math.min(0.999, t));
        return G.sky.time;
      },
      // dev: jump to any year phase (0..1) or null to resume wall-clock time.
      // Returns { phase, season, festival } so caller can see what was selected.
      // When clearing, season/festival reflect the live wall-clock state.
      phase(p) {
        G.seasonOverride = (p == null ? null : Math.max(0, Math.min(0.999, p)));
        G.snowAccum = accumulationTarget(G.seasonOverride != null ? seasonStateAtPhase(G.seasonOverride) : seasonState());
        const effective = G.seasonOverride != null ? G.seasonOverride : null;
        const sState = effective != null ? seasonStateAtPhase(effective) : seasonState();
        const fState = festivalState(effective != null ? effective : sState.yearPhase);
        return { phase: effective, season: sState.season, festival: fState.active };
      },
      // dev: render one frame through t' live pipeline (post stack an' all) an'
      // return t' canvas as a PNG data-URL — for saving proof shots headlessly.
      snap() {
        G.renderFrame(0);
        return G.renderer.domElement.toDataURL('image/png');
      },
      // dev: pin t' camera at a FIXED POINT for visual checks — t' player never
      // moves (so nowt falls, drowns or dies while framing a shot). yaw/pitch in
      // radians. photo(null) releases back to t' player camera.
      //   moorstead.debug.photo(1417, 40, 2578, Math.PI/2, -0.3)
      photo(x, y, z, yaw = 0, pitch = 0) {
        if (x == null) { G._photoCam = null; return 'photo cam released'; }
        G._photoCam = { x, y, z, yaw, pitch };
        return `photo cam pinned at ${x},${y},${z} (yaw ${yaw.toFixed(2)}, pitch ${pitch.toFixed(2)})`;
      },
      // dev: t' GL ground truth in one call — force-compile every scene program
      // an' count link failures. T' headless gate can't see GLSL an' t' console
      // buffer holds stale errors across reloads; THIS is t' reliable check.
      glHealth() {
        const gl = G.renderer.getContext();
        G.renderer.compile(G.scene, G.camera);
        const progs = G.renderer.info.programs || [];
        let broken = 0; const fails = [];
        for (const p of progs) {
          try {
            if (p.program && !gl.getProgramParameter(p.program, gl.LINK_STATUS)) {
              broken++; fails.push(p.name || p.cacheKey || 'unnamed');
            }
          } catch (e) { /* skip un-queryable */ }
        }
        return { programs: progs.length, broken, fails, glError: gl.getError() };
      },
      // dev: jump to a named festival (its .centre phase), or null to resume.
      // e.g. moorstead.debug.festival('yule')
      festival(id) {
        if (id == null) return this.phase(null);
        const f = FESTIVALS.find(f => f.id === id);
        if (!f) return { error: 'unknown festival', known: FESTIVALS.map(f => f.id) };
        return this.phase(f.centre);
      },
    };
  }

  // ---------------- world lifecycle ----------------
  async newWorld(seedStr) {
    if (this.net) { this.net.disconnect(); this.net = null; }
    this.netActive = false;
    const { clearSave } = await import('./save.js');
    await clearSave();
    // v2: the real-Moors 1900 world is the main world. A blank "New World" starts it
    // (persistent, saved); a typed seed still makes a custom stylised world to explore.
    const seed = seedStr ? strSeed(seedStr) : strSeed('t-moors-1900');
    this.startWorld(seed, null, new Map());
    this.ensureDaemon();   // thi daemon walks every world wi' thee, solo or shared
  }

  // The real-Moors world (c.1900), solo. Reachable via window.game.startMoorsWorld()
  // for now; a title-screen entry comes with the slice-1 build-out.
  async startMoorsWorld() {
    if (this.net) { this.net.disconnect(); this.net = null; }
    this.netActive = false;
    this.startWorld(strSeed('t-moors-1900'), null, new Map());
    this.moorsPreview = true; // a transient explore world: never persisted, never clobbers the solo save
    this.ensureDaemon();
  }

  // The original stylised Moorstead, kept as a legacy option (any NON-moors seed; blank →
  // a fixed classic seed). Shares the single solo save slot, so it starts fresh like New World.
  async startLegacyWorld(seedStr) {
    return this.newWorld((seedStr && seedStr.trim()) ? seedStr.trim() : 'moorstead-classic');
  }

  async continueGame() {
    const { loadGame, migrateSave } = await import('./save.js');
    const saved = await loadGame();
    if (!saved) { this.ui.toast('No saved world found, love.'); return; }
    // step the save up to the current format; REFUSE a save from a newer build outright —
    // loading it anyway could quietly corrupt what a newer Moorstead wrote
    const mig = migrateSave(saved);
    if (!mig.ok) {
      this.ui.toast(mig.reason === 'future'
        ? 'This save’s from a <b>newer Moorstead</b> — refresh t’ page to update afore tha carries on.'
        : 'This save’s in a shape t’ game can’t read — best start a fresh world, love.', 9000);
      this.state = 'title';           // back to the title/new-world flow, save untouched
      this.ui.show('titleScreen');
      this.refreshContinue();
      return;
    }
    const { meta, chunks } = mig.saved;
    if (meta.migratedFrom != null) {
      this.ui.toast('That world&rsquo;s from afore t&rsquo; moors moved &mdash; expect odd seams. A fresh world&rsquo;s best.', 7000);
    }
    this.startWorld(meta.seed, meta, chunks);
    this.ensureDaemon();   // thi daemon (first pet) is at thi heel in solo worlds an' all
  }

  startWorld(seed, meta, chunks) {
    if (this.world) this.teardownWorld();
    this.titlePreview = false; // a real world supersedes the title backdrop
    this.renderer.domElement.style.opacity = '1'; // clear any mid-flight title cross-fade
    this.ride = null; // drop any title ride-camera state
    this.moorsPreview = false; // cleared for normal worlds; set by startMoorsWorld()
    this.seed = seed;
    this.world = new World(this.scene, seed, chunks);
    // T' held storm lantern counts as a BURNING light to owt that reads world.nearLight
    // (entities.js: lightWarded + spawn gating) — so in thi fist it wards boggarts AND
    // t' barghest, a step better than a torch, an' nowt dark rises close by its flame.
    // (entities.js/world.js are steady ground — this wrap keeps t' rule in one place.)
    {
      const rawNearLight = this.world.nearLight.bind(this.world);
      this.world.nearLight = (x, z, r) => {
        if (this._stormHeld && this.player && !this.player.dead) {
          const dx = x - this.player.pos.x, dz = z - this.player.pos.z;
          if (dx * dx + dz * dz <= (r + 3) * (r + 3)) return true;
        }
        return rawNearLight(x, z, r);
      };
    }
    this.player = new Player(this.world);
    this.entities = new Entities(this.scene, this.world);
    if (this.world.gen.geo.realWorld) {
      this.rosterClient = new RosterClient(this);   // distinct from this.roster (the personas list)
      this.rosterClient.start();
    }
    // Whenever a block changes, invalidate the roster surface-height cache for that column
    // so NPC standing heights update within a frame or two of a platform rebuild.
    this.world.onBlockSet = (x, _y, z) => invalidateSurfCache(x, z);
    this.sky = new Sky(this.scene, this.camera);
    this.applyQuality(this.gfxQuality || 'plain'); // fresh sky each world: re-rig shadows + light curves
    this.storm = new Storm(this); // the Dracula boss-battle storm (scoped to the fight)
    this.spawn = this.world.gen.findSpawn();
    this.player.pos = { ...this.spawn };
    this.villagersSpawned = false;
    this.standing = null;
    this.standingData = null;
    this.quests = new Quests(this);
    this.economy = new Economy(this);
    this.milestones = new Milestones(this);
    if (this.rails) this.rails.dispose();
    this.rails = new Rails(this.scene, this.world.gen.geo); // t' permanent way, drawn proper
    if (this.roads) this.roads.dispose();
    this.roads = new RoadLayer(this.scene, this.world, this.world.gen.geo); // t' parish lanes — needs the chunk world for surfaceHeight
    if (this.floraLayer) this.floraLayer.clear();
    this.floraLayer = new FloraLayer(this.scene, this.world);
    if (this.seasonalLayer) this.seasonalLayer.clear();
    this.seasonalLayer = new SeasonalLayer(this.scene, this.world);
    if (this.fireLayer) this.fireLayer.dispose();
    this.fireLayer = new FireLayer(this.scene, this.world);
    if (this.hearthLayer) this.hearthLayer.clear();
    this.hearthLayer = new HearthLayer(this.scene, this.world);
    if (this.dripLayer) this.dripLayer.dispose();
    this.dripLayer = new DripLayer(this.scene, this.world, { plain: this.gfxQuality !== 'fine' });
    if (this.footprints) this.footprints.clear();
    this.footprints = new Footprints(this.scene, this.world);
    if (this.murmuration) this.murmuration.dispose();
    this.murmuration = new MurmurationLayer({
      scene: this.scene, world: this.world, sky: this.sky,
      isFine: this.gfxQuality === 'fine',
    });
    if (this.harbourLight) { this.harbourLight.dispose(); this.harbourLight = null; }
    if (this.world.gen.geo && typeof this.world.gen.geo.whitbyHarbour === 'function') {
      this.harbourLight = new HarbourLight(this.scene, this.world.gen.geo, { plain: this.gfxQuality !== 'fine' });
    }
    // seed snow cover + season so a world loaded in winter is snowy at once and
    // Merlin spawns as Father Christmas straight off (no one-frame wizard flash)
    this.season = (this.seasonOverride != null) ? seasonStateAtPhase(this.seasonOverride) : seasonState();
    this.snowAccum = accumulationTarget(this.season);
    this.entities.game = this;
    this.entities.onKill = mob => { this.quests.onMobKilled(mob); this.milestones.onKill(mob.type); };
    window.moorstead = window.moorcraft = this; // a handle for t' dev console
    this.lastQuestDay = 1;
    // oak strongboxes: contents keyed by block coordinate (boxKey). Rides meta.strongboxes
    // in solo; the shared moor loads its own room-keyed copy in joinShared (local-only v1).
    this.world.strongboxes = new Map();

    if (meta) {
      this.player.deserialize(meta.player);
      this.entities.restorePets(this.player.pets, this.player); // thi kept beasts come back to heel
      this.sky.deserialize(meta.sky);
      this.quests.deserialize(meta.quests);
      this.world.editLedger    = new Map(meta.editLedger    || []); // regrowth picks up where it left off
      this.world.forageLedger  = new Map(meta.forageLedger  || []); // picked forage cells awaiting regrowth
      this.world.snowmanLedger = new Map(meta.snowmanLedger || []); // player-built snowmen awaiting the thaw
      this.world.treeRegrowth = new Map(meta.treeRegrowth || []); this.world.saplings = new Map(meta.saplings || []);
      this.world.fruitStumps = new Set(meta.fruitStumps || []); // which stumps regrow as fruit trees
      this.world.deeds = meta.deeds || [];
      // strongbox contents (additive — old saves just have none)
      this.world.strongboxes = new Map((meta.strongboxes || []).map(([k, b]) => [k, normalizeBox(b)]));
      if (!this.world.deeds.some(d => d.by === 'parish' && d.kind === 'quarry')) {
        this.world.deeds.push(
          { id: 'quarry_moorstead', kind: 'quarry', by: 'parish', cx: 40, cz: 60, radius: 10, paidUntilDay: Infinity, lapsedDay: null },
          { id: 'quarry_goathland', kind: 'quarry', by: 'parish', cx: 280, cz: -80, radius: 10, paidUntilDay: Infinity, lapsedDay: null },
          { id: 'quarry_pickering', kind: 'quarry', by: 'parish', cx: 480, cz: 820, radius: 12, paidUntilDay: Infinity, lapsedDay: null }
        );
      }
    } else if (this.auth && this.auth.name) {
      this.player.name = this.auth.name; // t' villagers already know thi name
    } else {
      // starter kit: nowt. Tha starts wi' thi bare hands, as is proper.
    }
    this.ui.invDirty = true;
    this.state = 'loading';
    this.ui.show('loadingScreen');
    // already backgrounded when t' world starts? visibilitychange won't fire — kick
    // t' fallback loop off directly, so t' load finishes behind t' player's back
    if (document.hidden) this.startBgLoading();
  }

  teardownWorld() {
    if (this.rosterClient) { this.rosterClient.stop(); this.rosterClient = null; }
    if (this.rails) { this.rails.dispose(); this.rails = null; }
    if (this.roads) { this.roads.dispose(); this.roads = null; }
    if (this.floraLayer) { this.floraLayer.clear(); this.floraLayer = null; }
    if (this.seasonalLayer) { this.seasonalLayer.clear(); this.seasonalLayer = null; }
    if (this.fireLayer) { this.fireLayer.dispose(); this.fireLayer = null; }
    if (this.hearthLayer) { this.hearthLayer.clear(); this.hearthLayer = null; }
    if (this.dripLayer) { this.dripLayer.dispose(); this.dripLayer = null; }
    if (this.footprints) { this.footprints.clear(); this.footprints = null; }
    if (this.murmuration) { this.murmuration.dispose(); this.murmuration = null; }
    if (this.harbourLight) { this.harbourLight.dispose(); this.harbourLight = null; }
    if (this.carolBox) { this.carolBox.dispose(); this.carolBox = null; }
    if (this.seaRing) { this.scene.remove(this.seaRing); this.seaRing.geometry.dispose(); this.seaRing.material.dispose(); this.seaRing = null; }
    this.entities.clear();
    for (const c of this.world.chunks.values()) {
      if (c.meshes) for (const m of c.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    }
    // remove sky objects
    for (const o of [this.sky.sun, this.sky.sun.target, this.sky.ambient, this.sky.stars,
      this.sky.clouds, this.sky.rain, this.sky.sunSprite, this.sky.moonSprite, this.sky.snow]) {
      this.scene.remove(o);
    }
    if (this.sky.snow) { this.sky.snow.geometry.dispose(); this.sky.snow.material.map?.dispose(); this.sky.snow.material.dispose(); }
    this.scene.fog = null;
  }

  // The title backdrop is the REAL voxel world, not a mock-up: load the shared
  // moor on a snowy winter sunrise; the title render branch then flies a slow
  // orbit following the steam train across the moors. Falls back to the plain
  // gradient if it can't load.
  startTitlePreview() {
    if (this.world || this.titlePreview || this.titlePreviewFailed) return;
    try {
      this.startWorld(strSeed('t-moors-1900'), null, new Map()); // the real moors world as the backdrop
      this.state = 'title';        // keep the title up (startWorld switched to 'loading')
      this.ui.show('titleScreen'); // and its UI (startWorld showed the loading panel)
      this.titlePreview = true;
      this.titleT = 0;
      // the backdrop flips between line+season vignettes, alternating an aerial ORBIT with a
      // FRONT-of-the-train view, so every line is shown both ways across the loop (driven in frame()).
      const winter = { phase: 0.875, snow: 1.0, precip: 1, snowing: true,  skyTime: 0.40 };
      const summer = { phase: 0.375, snow: 0.0, precip: 0, snowing: false, skyTime: 0.50 };
      const autumn = { phase: 0.625, snow: 0.0, precip: 0, snowing: false, skyTime: 0.46 };
      this._titleScenes = [
        { line: 'Esk Valley', ...winter, cam: 'orbit'  }, // Eskdale, deep winter, from above
        { line: 'Coast Line', ...summer, cam: 'front'  }, // up the line on the summer coast
        { line: null,         ...autumn, cam: 'window' }, // out the window over the autumn moor (main line)
        { line: 'Esk Valley', ...winter, cam: 'front'  }, // up the line down wintry Eskdale
        { line: 'Coast Line', ...summer, cam: 'window' }, // out the window along the summer coast
        { line: null,         ...autumn, cam: 'orbit'  }, // the moors line in autumn, from above
      ];
      this._titleSceneIdx = 0;
      this._titleSceneT = 0;
      this._titleRevealT = null;   // when the current scene finished streaming (gates the fade-in)
      this._titleRideYaw = null;   // smoothed, low-passed heading for the driver/passenger ride camera
      this.titleCamY = null;       // re-anchor the orbit height cleanly on (re)start
      this.sky.time = 0.40;        // a low, flat winter daylight
      this.sky.forceClear = false; // let the snow fall (don't force a clear sky)
      const geo = this.world.gen.geo;
      // open down Eskdale (the Esk valley) — Grosmont, where the line drops into the dale
      const v = (geo.villages && (geo.villages.find(x => x.name === 'Grosmont') || geo.villages.find(x => x.name === 'Glaisdale'))) || geo.village || geo.railway()[0];
      this.player.pos = { x: v.x + 0.5, y: this.world.gen.height(Math.floor(v.x), Math.floor(v.z)) + 2, z: v.z + 0.5 };
    } catch (e) {
      this.titlePreview = false; this.titlePreviewFailed = true;
      reportQuiet('title-preview', e); // the whole title backdrop just silently degraded to the flat gradient
    }
  }

  // Title backdrop only: keep the WATCHED train lively. Live rail traffic is spread thin across the
  // three lines and ~100 folk, so any one train carries 1-2 — too sparse for a showcase. When the
  // watched train dwells at a station, send a few of THAT station's own folk aboard for a hop to the
  // next stop (they alight there, then drift home off-camera), so boarding + alighting is on show.
  _titlePopulateTrain(br) {
    const rc = this.rosterClient; if (!rc || !this.titlePreview || !this.world) return;
    const geo = this.world.gen.geo;
    const lineName = br ? br.name : (geo.railPaths().find(l => l.path === geo.railPath()) || {}).name;
    const vt = rc._visibleTrain(lineName); if (!vt || !vt.dwelling || !vt.station) return;
    const stations = br ? br.stations : geo.railway();
    const i = stations.findIndex(s => s.name === vt.station); if (i < 0) return;
    const dir = vt.dir === 0 ? 1 : -1;
    let ni = i + dir; if (ni < 0 || ni >= stations.length) ni = i - dir;   // bounce off a terminus
    const dest = stations[ni] && stations[ni].name; if (!dest || dest === vt.station) return;
    let riding = 0; for (const [, e] of rc.npcs) if (e.ride && e.ride.titleForced && e.ride.line === lineName) riding++;
    for (const [, e] of rc.npcs) {
      if (riding >= 6) break;
      if (e.ride || !e.data.state || e.data.state.kind !== 'at' || e.data.home !== vt.station || !e.mob) continue;
      e.ride = { line: lineName, from: vt.station, to: dest, phase: 'wait', t: 0, titleForced: true };
      riding++;
    }
  }

  async saveNow(toast = true) {
    if (!this.world) return;
    if (this.epochWiping) return; // a warden reset is reloading us — never re-seed the wiped relay
    if (this.moorsPreview) return; // the real-Moors preview is transient — don't persist/clobber the solo save
    if (this.netActive) {
      // shared moor: pockets an' ventures live on t' server, keyed to thi account
      if (this.net && this.net.connected) {
        this.net.sendSave({
          player: this.player.serialize(),
          quests: this.quests.serialize(),
        });
        if (toast) this.ui.toast('Thi things are lodged wi\u2019 t\u2019 parish. Champion.');
      }
      // strongbox contents are LOCAL-ONLY on t' shared moor (v1): the relay knows nothing
      // of 'em, so they keep in this browser, keyed by room \u2014 same as thi solo save would.
      this.persistNetStrongboxes();
      return;
    }
    // storage nigh full? Say so ONCE a session, before the write, so a kid knows why their
    // builds might stop sticking. Fully guarded — headless Node an' owd browsers have no
    // navigator.storage.estimate, an' the warning must never block the save itself.
    try {
      if (!this._quotaWarned && typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(est => {
          if (est && est.quota > 0 && est.usage / est.quota > 0.85 && !this._quotaWarned) {
            this._quotaWarned = true;
            this.ui.toast('Thi browser’s storage is <b>nigh full</b> — builds may stop saving. Clear a bit o’ room, love.', 9000);
          }
        }).catch(() => { /* estimate refused — no matter */ });
      }
    } catch { /* estimate unavailable — no matter */ }
    const { saveGame, SAVE_VERSION } = await import('./save.js');
    const meta = {
      version: SAVE_VERSION,
      seed: this.seed,
      player: this.player.serialize(),
      sky: this.sky.serialize(),
      quests: this.quests.serialize(),
      editLedger:    [...this.world.editLedger],    // harvest edits awaiting regrowth — so the moor heals across reloads
      forageLedger:  [...this.world.forageLedger],  // picked forage cells awaiting regrowth
      snowmanLedger: [...this.world.snowmanLedger], // player-built snowmen awaiting the thaw
      treeRegrowth: [...this.world.treeRegrowth], saplings: [...this.world.saplings], // tree regrowth in progress
      fruitStumps: [...this.world.fruitStumps], // stumps that regrow as fruit trees, not oaks
      deeds: this.world.deeds, // staked deeds (claims + mine licences)
      strongboxes: [...(this.world.strongboxes || new Map())], // oak strongbox contents, keyed by block coord
      savedAt: Date.now(),
    };
    await saveGame(meta, this.world.collectModified());
    if (toast) this.ui.toast('World saved. Champion.');
  }

  async quitToTitle() {
    await this.saveNow(false);
    if (this.net) { this.net.disconnect(); this.net = null; }
    this.netActive = false;
    this.state = 'title';
    document.exitPointerLock?.();
    this.ui.show('titleScreen');
    this.refreshContinue();
  }

  async refreshContinue() {
    const { hasSave } = await import('./save.js');
    this.ui.btnContinue.disabled = !(await hasSave());
  }

  // ---------------- input ----------------
  bindEvents() {
    const ui = this.ui;
    ui.btnLogin.addEventListener('click', () => this.login());
    ui.loginName.addEventListener('keydown', e => { if (e.code === 'Enter') this.login(); e.stopPropagation(); });
    ui.loginCode.addEventListener('keydown', e => e.stopPropagation());
    ui.loginGuest.addEventListener('click', () => this.loginGuest());
    ui.btnWarden.addEventListener('click', () => this.loginWarden());
    ui.btnAdminLink.addEventListener('click', () => {
      ui.adminLoginBox.classList.toggle('hidden');
      if (!ui.adminLoginBox.classList.contains('hidden')) ui.adminLoginKey.focus();
    });
    ui.btnAdminGo.addEventListener('click', () => this.loginWardenAndPlay());
    ui.adminLoginKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.loginWardenAndPlay(); });
    ui.requestToggle.addEventListener('click', () => {
      ui.requestBox.classList.toggle('hidden');
      ui.requestOk.classList.add('hidden');
      ui.requestErr.textContent = '';
    });
    ui.btnRequest.addEventListener('click', () => this.requestInvite());
    ui.requestEmail.addEventListener('keydown', e => { if (e.code === 'Enter') this.requestInvite(); e.stopPropagation(); });
    ui.requestName.addEventListener('keydown', e => { if (e.code === 'Enter') this.requestInvite(); e.stopPropagation(); });
    ui.requestNote.addEventListener('keydown', e => { if (e.code === 'Enter') this.requestInvite(); e.stopPropagation(); });
    ui.feedbackBtn.addEventListener('click', () => this.openFeedback('title'));
    ui.btnFeedbackClose.addEventListener('click', () => ui.show(this.feedbackReturn || 'titleScreen'));
    ui.btnFeedbackSend.addEventListener('click', () => this.sendFeedback());
    ui.btnNew.addEventListener('click', () => { this.audio.init(); this.newWorld(''); }); // blank → the real moors (v2, the main game)
    ui.btnShared.addEventListener('click', () => { this.audio.init(); this.joinShared(); });
    ui.netChatInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const text = ui.netChatInput.value.trim();
        if (text && this.net) {
          this.net.sendChat(text);
          ui.toast(`<b>Thee:</b> ${escHtml(text)}`, 5000);
        }
        this.closeNetChat();
      } else if (e.code === 'Escape') this.closeNetChat();
    });
    ui.btnContinue.addEventListener('click', () => { this.audio.init(); this.continueGame(); });
    ui.btnLegacy.addEventListener('click', () => { this.audio.init(); this.startLegacyWorld(ui.seedInput.value.trim()); });
    ui.btnHow.addEventListener('click', () => { this.howReturn = 'titleScreen'; ui.show('howScreen'); });
    ui.btnHow2.addEventListener('click', () => { this.howReturn = 'pauseScreen'; ui.show('howScreen'); });
    ui.btnHowClose.addEventListener('click', () => ui.show(this.howReturn || 'titleScreen'));
    ui.btnResume.addEventListener('click', () => this.resume());
    ui.btnSave.addEventListener('click', () => this.saveNow());
    // "Dress thissen" — the wardrobe. Preview re-dresses a mini avatar; Done saves +
    // tells peers. Returns to the pause menu it was opened from (or the title).
    ui.btnWardrobe.addEventListener('click', () => { this.wardrobeReturn = 'pauseScreen'; this.openWardrobe(); });
    ui.onWardrobePreview = (look) => this.previewPlayerLook(look);
    ui.onWardrobeApply = (look) => this.applyPlayerLook(look);
    ui.btnTouch.addEventListener('click', () => {
      const mode = this.touch.cycleMode();
      ui.btnTouch.innerHTML = 'Touch controls: ' + mode.charAt(0).toUpperCase() + mode.slice(1);
    });
    ui.btnGfx.addEventListener('click', () => {
      const next = this.gfxQuality === 'fine' ? 'plain' : 'fine';
      try { localStorage.setItem('moorcraft-gfx', next); } catch { /* storage blocked — this session only */ }
      this.gfxStored = next;
      this.applyQuality(next);
      ui.btnGfx.innerHTML = 'Graphics: ' + (next === 'fine' ? 'Fine' : 'Plain');
      ui.toast(next === 'fine'
        ? 'Fine graphics: long shadows, moonlit neets, lamplight glow — t&rsquo; full picture.'
        : 'Plain graphics: fast an&rsquo; simple, easy on owd kit.', 3500);
    });
    ui.btnCreative.addEventListener('click', () => {
      if (this.creativeLocked()) { ui.toast('Tha’s on t’ shared moor — it’s survival here. Tha has to earn thi blocks an’ tools!', 4000); return; }
      this.player.creative = !this.player.creative;
      if (!this.player.creative) this.player.flying = false;
      ui.toast(this.player.creative ? 'Creative mode: tha can fly an&rsquo; all (double-tap Space).' : 'Survival mode: watch thissen.');
      ui.invDirty = true;
    });
    ui.btnQuit.addEventListener('click', () => this.quitToTitle());
    ui.btnRespawn.addEventListener('click', () => {
      const atHome = !!(this.player.home);
      this.player.respawn(this.homeSpawn());
      ui.toast(atHome ? 'Tha wakes at thi base. Welcome home.' : 'Tha wakes somewhere fresh on t&rsquo; moor.', 5000);
      this.state = 'playing';
      ui.show(null);
      this.lockPointer();
    });
    ui.btnDeathQuit.addEventListener('click', () => this.quitToTitle());

    // villager chat wiring
    ui.btnChatClose.addEventListener('click', () => this.closeChat());
    ui.btnChatSend.addEventListener('click', () => this.sendChat());
    ui.chatInput.addEventListener('keydown', e => {
      if (e.code === 'Enter') this.sendChat();
      e.stopPropagation();
    });
    ui.btnSetName.addEventListener('click', () => this.setPlayerName());
    ui.chatNameInput.addEventListener('keydown', e => {
      if (e.code === 'Enter') this.setPlayerName();
      e.stopPropagation();
    });
    ui.btnChatGive.addEventListener('click', () => this.giveGift());

    this.refreshContinue();

    document.addEventListener('keydown', e => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'Space') this.input.jumpTapped = true;

      if (this.state === 'playing') {
        if (e.code === 'KeyF' && this.boat) { this.leaveBoat(); return; }
        if (e.code === 'KeyF' && this.mount) { this.dismountPony(); return; }
        if (e.code === 'KeyE') this.openInventory();
        if (e.code === 'KeyQ') {
          if (!this.player.dead) {
            const held = this.player.heldItem();
            if (held) {
              this.dropAtPlayer(held.id, held.n);
              this.player.slots[this.player.hotbar] = null;
              this.ui.invDirty = true;
              return;
            }
          }
          this.openBoard(false);
        }
        if (e.code === 'KeyT') {
          e.preventDefault();
          const vv = this.villagerInView();
          if (vv) { this.openChat(vv); return; }
          if (this.netActive) { this.openNetChat(); return; }
          return;
        }
        if (e.code === 'KeyN') this.trySleep();
        if (e.code === 'KeyL') this.findShelter();
        if (e.code === 'KeyM') { this.audio.setMuted(!this.audio.muted); this.ui.toast(this.audio.muted ? 'Sound off.' : 'Sound on.'); }
        if (e.code === 'KeyG') { this.musterFlock(); return; }
        // --- rail SURVEY tool (creative): peg out a line by flying it, then export the pegs ---
        if (this.player.creative && (e.code === 'KeyP' || e.code === 'KeyO' || e.code === 'KeyU')) {
          this.survey = this.survey || [];
          const gx = Math.round(this.player.pos.x), gz = Math.round(this.player.pos.z);
          if (e.code === 'KeyP') {
            this.survey.push([gx, gz]);
            const gy = this.world.gen.geo.height(gx, gz);          // a glowing stake on the ground, so the route shows
            for (let y = gy + 1; y <= gy + 4 && y < HEIGHT; y++) this.world.setBlock(gx, y, gz, B.LANTERN);
            this.ui.toast(`\u{1F4CD} Peg ${this.survey.length}: ${gx}, ${gz}`, 1400);
          } else if (e.code === 'KeyU' && this.survey.length) {
            this.survey.pop();
            this.ui.toast(`Peg pulled — ${this.survey.length} left.`, 1400);
          } else if (e.code === 'KeyO') {
            const json = JSON.stringify(this.survey);
            console.log('SURVEY PEGS:', json);
            if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
            this.ui.toast(`${this.survey.length} pegs copied — paste them to Claude.`, 5000);
          }
          return;
        }
        // T' Rambler's Sketchbook — frame whatever tha's looking at an' save it.
        // (In creative, P is the rail-survey peg above — the sketchbook yields to t' dev tool.)
        if (e.code === 'KeyP') { this.takeSketch(); return; }
        // sheepdog whistles (arrow keys) — work a flock wi' thi dog; H brings her to heel
        const whistle = commandFromKey(e.code);
        if (whistle || e.code === 'KeyH') {
          e.preventDefault();
          this.herdCmd = whistle || 'heel';
          if (this.entities && this.entities.mobs.some(m => m && m.owner && m.type === 'dog')) {
            const lbl = { 'come-bye': 'Come bye!', 'away': 'Away!', 'walk-on': 'Walk on.', 'lie-down': 'Lie down.', 'heel': 'Heel!' }[this.herdCmd];
            this.ui.toast(`\u{1F415} <b>${lbl}</b>`, 1200);
          }
          return;
        }
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) { this.player.hotbar = num - 1; this.ui.invDirty = true; }
      } else if (this.state === 'inv' || this.state === 'range' || this.state === 'box') {
        if (e.code === 'KeyE' || e.code === 'Escape') this.closeScreens();
      } else if (this.state === 'board' || this.state === 'museum') {
        if (e.code === 'KeyQ' || e.code === 'Escape') this.closeScreens();
      } else if (this.state === 'chat') {
        if (e.code === 'Escape') this.closeChat();
      } else if (this.state === 'sleeping') {
        if (e.code === 'KeyN' || e.code === 'Escape') this.cancelSleep('Up an’ about again, then.');
      } else if (this.state === 'riding') {
        if (e.code === 'Escape' && this.ride) this.wardenLeaveTrain();   // any rider can step off, not just a warden
        else if (e.code === 'Digit1') this.setRideView('seat');
        else if (e.code === 'Digit2') this.setRideView('driver');
        else if (e.code === 'Digit3') this.setRideView('overhead');
      } else if (this.state === 'driving') {
        if (e.code === 'KeyE' || e.code === 'Escape') this.leaveDrive();
        else if (e.code === 'KeyR' && this.drive) { this.drive.reverser *= -1; this.ui.toast(this.drive.reverser > 0 ? 'Reverser set forrard.' : 'Reverser set back.', 1500); }
        else if (e.code === 'KeyF') this.shovelCoal();
      }
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    // Clear in place — never replace the object: player input holds a
    // reference to it, and swapping it out left WASD dead after any focus
    // loss (which always happens at least once on t' web).
    window.addEventListener('blur', () => this.clearKeys());
    // world generation mustn't stall in a backgrounded tab (rAF stops there) —
    // hand t' loading steps to t' setTimeout fallback while hidden (see startBgLoading)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'loading') this.startBgLoading();
    });

    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', e => {
      if (this.state !== 'playing') return;
      if (document.pointerLockElement !== canvas) { if (!this.touch?.active) this.lockPointer(); return; }
      this.mouseDown[e.button] = true;
      if (e.button === 2) { this.placeRepeat = 0.4; this.useItem(); }
      if (e.button === 0) { this.breakProgress = 0; this.attackOrMine(true); }
    });
    document.addEventListener('mouseup', e => { this.mouseDown[e.button] = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('mousemove', e => {
      if ((this.state !== 'playing' && this.state !== 'riding' && this.state !== 'driving') || document.pointerLockElement !== canvas) return;
      const sens = 0.0023;
      this.player.yaw -= e.movementX * sens;
      this.player.pitch -= e.movementY * sens;
      this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.player.pitch));
    });

    document.addEventListener('wheel', e => {
      if (this.state !== 'playing') return;
      this.player.hotbar = ((this.player.hotbar + (e.deltaY > 0 ? 1 : -1)) % 9 + 9) % 9;
      this.ui.invDirty = true;
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.state === 'playing' && !this.touch?.active) {
        this.pause();
      }
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      // re-reads devicePixelRatio an' all — a drag onto another monitor never used to land
      this.applyResolution();
    });

    window.addEventListener('beforeunload', () => {
      if (this.world && this.state !== 'title') this.saveNow(false);
    });

    this.input = { keys: this.keys, jumpTapped: false };
    this.touch = new TouchControls(this);
    this.touch.sync();
    // a computer is auto-detect only — hide the manual touch toggle so it can't be forced on
    if (this.ui.btnTouch) this.ui.btnTouch.classList.toggle('hidden', !this.touch.manualToggleAllowed());
    window.addEventListener('resize', () => this.touch.sync());
  }

  clearKeys() {
    for (const k of Object.keys(this.keys)) delete this.keys[k];
  }

  lockPointer() {
    try {
      const p = this.renderer.domElement.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.renderer.domElement.requestPointerLock());
    } catch {
      this.renderer.domElement.requestPointerLock?.();
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    this.renderAdminPanel();
    this.ui.show('pauseScreen');
  }

  // ---------------- parish warden (admin) ----------------
  // T' warden check hashes t' account id (it doubles as a login code, so
  // plaintext stays out o' t' source). Needs a secure context for
  // crypto.subtle — https or localhost; a raw-IP LAN page won't have it.
  async refreshAdmin() {
    this.adminOk = false;
    if (this.auth && this.auth.warden) { this.adminOk = true; return; }
    if (!this.auth || !this.auth.acct || !(window.crypto && crypto.subtle)) return;
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.auth.acct));
      const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      this.adminOk = ADMIN_HASHES.includes(hex);
    } catch (e) { reportQuiet('warden-crypto', e); /* no subtle crypto — no warden powers, no matter (but count it: crypto.subtle EXISTED an' still failed) */ }
  }

  isAdmin() {
    return !!this.adminOk;
  }

  // T' bairns' world is survival-only: no creative cupboard, no flying, so t'
  // kids have to earn their blocks an' tools. Wardens (James) keep full run o'
  // t' place on every world.
  bairnLocked() {
    return this.netActive && isBairnsRoom(this.netRoom) && !this.isAdmin();
  }

  // A relaxed-survival free world (e.g. the bairns-free kids' world): builds never crumble,
  // no deeds/licences, deep digging gated only by pick tier, a starter pack on entry. Deliberately
  // admin-agnostic — the world's rules (decay-off etc.) hold no matter who's stood on it; the
  // warden-specific exemptions live at the individual call sites (e.g. the starter pack below).
  freeWorld() {
    return this.netActive && isFreeRoom(this.netRoom);
  }

  // Survival is enforced for EVERYONE on the shared world (any room) — only wardens
  // (James) keep the creative cupboard. The bare-hands pocket-wipe below stays
  // bairns-only; the adult shared rooms keep whatever folk have earned.
  creativeLocked() {
    return this.netActive && !this.isAdmin();
  }

  // Force survival an' hide t' Creative toggle when t' lock's on. Called on world
  // entry AND after t' relay restores pockets — an owd save could carry a
  // creative flag frae afore t' lock existed, so we re-assert it.
  enforceBairnRules() {
    const survival = this.creativeLocked();   // no creative on any shared world (non-warden)
    if (survival && this.player) {
      this.player.creative = false;
      this.player.flying = false;
      this.player.god = false;   // god mode is a warden power — never on a survival (non-warden) player
    }
    // One-time pocket wipe so t' BAIRNS genuinely start bare-handed. Runs once
    // per account (t' flag persists), so owt they EARN after this stays put.
    // Survives t' "client re-saved its owd inventory" race: it clears in
    // memory on load, afore t' next save, every load until t' flag sticks.
    if (this.bairnLocked() && this.player && !this.player.bairnFresh) {
      this.player.bairnFresh = true;
      this.player.slots = new Array(36).fill(null);
      this.player.hotbar = 0;
      this.ui.invDirty = true;
      if (this.saveNow) this.saveNow(false);
      this.ui.toast('A fresh start on t’ bairns’ world — bare hands, like everyone. Time to earn thi keep!', 6000);
    }
    // Free world: relaxed survival. No bare-hands wipe (that's bairns-only above); instead a
    // one-time starter pack so a young player isn't stuck. Fills empty slots only (addItem),
    // so anything earned is kept. Persisted via player.freeStarter, like bairnFresh.
    if (this.freeWorld() && !this.isAdmin() && this.player && !this.player.freeStarter) {
      this.player.freeStarter = true;
      for (const it of FREE_STARTER) this.player.addItem(it.id, it.n);
      this.ui.invDirty = true;
      if (this.saveNow) this.saveNow(false);
      this.ui.toast('Welcome to t’ <b>Free Moor</b> — build what tha likes, nowt crumbles, no licences needed. Here’s a kit to start thee off!', 8000);
    }
    this.ui.setCreativeButtonVisible(!survival);
  }

  renderAdminPanel() {
    const panel = this.ui.adminPanel;
    if (!panel) return;
    if (!this.isAdmin() || !this.world) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    panel.innerHTML = '';
    const ui = this.ui;
    const geo = this.world.gen.geo;
    ui.el('div', 'inv-title', panel, 'Parish Warden');

    // ---- map + scene sliders (map-led split) ----
    const scene = ui.el('div', 'admin-scene', panel);
    scene.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;';

    // the map: reuses buildBigMap()'s cached world-overview image (villages/stations/
    // landmarks/rails), redrawn into a dedicated canvas so it can sit inside this panel
    // permanently (not just the "hold Tab" peek). Click anywhere to drop in AT WHATEVER
    // THE SLIDERS BELOW CURRENTLY SAY — no confirm step, matches adminTeleport()'s existing
    // instant-arrival feel.
    const mapCol = ui.el('div', '', scene); mapCol.style.cssText = 'flex:1.3;min-width:220px;';
    if (ui.mapBaseKey !== this.world.gen.seed) ui.buildBigMap(this.player, this.world);
    const mapCanvas = ui.el('canvas', 'admin-map', mapCol);
    mapCanvas.width = ui.mapBase.width; mapCanvas.height = ui.mapBase.height;
    mapCanvas.style.cssText = 'width:100%;max-width:320px;border-radius:4px;cursor:crosshair;';
    mapCanvas.getContext('2d').drawImage(ui.mapBase, 0, 0);
    ui.el('div', 'r-needs', mapCol, 'Click the map to drop in — uses the settings below.');
    mapCanvas.addEventListener('click', (e) => {
      const rect = mapCanvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
      const sy = (e.clientY - rect.top) * (mapCanvas.height / rect.height);
      const { x, z } = bigMapScreenToWorld(ui._mapXf, sx, sy);
      this.adminTeleport(x, z, `${x}, ${z}`);
    });

    const sliderCol = ui.el('div', '', scene); sliderCol.style.cssText = 'flex:1;min-width:220px;display:flex;flex-direction:column;gap:12px;';

    // -- year slider, with all six festival windows shown true-to-width + click-to-snap --
    {
      const wrap = ui.el('div', '', sliderCol);
      ui.el('div', 'r-needs', wrap, 'Year (click a festival to land in it clean):');
      const chipRow = ui.el('div', '', wrap);
      chipRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;';
      const bands = festivalBands();
      const slider = ui.el('input', '', wrap);
      for (const b of bands) {
        const chip = ui.el('button', 'mc', chipRow, b.name);
        chip.style.cssText = 'display:inline-block;width:auto;min-height:0;font-size:10px;padding:2px 6px;margin:0;';
        chip.addEventListener('click', () => { slider.value = String(b.centre); slider.dispatchEvent(new Event('input')); });
      }
      slider.type = 'range'; slider.min = '0'; slider.max = '0.999'; slider.step = '0.001';
      slider.style.width = '100%';
      const cur = this.seasonOverride != null ? this.seasonOverride : (this.season?.yearPhase ?? 0.5);
      slider.value = String(cur);
      const label = ui.el('div', 'label', wrap, '');
      const paintLabel = (phase) => {
        const s = seasonStateAtPhase(phase);
        label.textContent = `Day ${Math.round(phase * 365)} — ${s.season}`;
      };
      paintLabel(cur);
      slider.addEventListener('input', () => {
        const phase = parseFloat(slider.value);
        this.debug.setSeason(phase);
        paintLabel(phase);
      });
      const real = ui.el('button', 'mc', wrap, 'Real time');
      real.style.cssText = 'display:inline-block;width:auto;min-height:0;font-size:10px;padding:2px 8px;margin-top:4px;';
      real.addEventListener('click', () => { this.debug.setSeason(null); this.renderAdminPanel(); });
    }

    // -- weather: buttons, not a slider (the states aren't a continuum) --
    {
      const wrap = ui.el('div', '', sliderCol);
      ui.el('div', 'r-needs', wrap, 'Weather:');
      const row2 = ui.el('div', '', wrap);
      row2.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
      const current = this.sky.weatherOverride ?? null;
      for (const [val, label] of [[null, 'Live'], ['clear', 'Clear'], ['misty', 'Misty'], ['rain', 'Rain/Snow'], ['fog', 'Fog']]) {
        const b = ui.el('button', 'mc', row2, label);
        b.style.cssText = `display:inline-block;width:auto;min-height:0;font-size:11px;padding:4px 8px;margin:0;${current === val ? 'outline:2px solid #e8b04a;' : ''}`;
        b.addEventListener('click', () => { this.debug.setWeather(val); this.renderAdminPanel(); });
      }
    }

    // -- time o' day --
    {
      const wrap = ui.el('div', '', sliderCol);
      ui.el('div', 'r-needs', wrap, "Time o' day:");
      const slider = ui.el('input', '', wrap);
      slider.type = 'range'; slider.min = '0'; slider.max = '0.999'; slider.step = '0.001';
      slider.style.width = '100%';
      slider.value = String(this.sky.time);
      const label = ui.el('div', 'label', wrap, '');
      const fmtTime = (t) => { const h = Math.floor(t * 24), m = Math.floor((t * 24 - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
      label.textContent = fmtTime(this.sky.time);
      slider.addEventListener('input', () => {
        const t = parseFloat(slider.value);
        this.debug.setTime(t);
        label.textContent = fmtTime(t);
      });
    }

    // ---- Parish Ledger (players online, recent activity, system status) ----
    this.renderParishLedger(panel);

    // ---- travel & actions (separate from the scene-setting cluster above) ----
    ui.el('div', 'r-needs', panel, 'Travel & actions:');
    const row = ui.el('div', 'admin-btns', panel);
    const god = ui.el('button', 'mc', row, this.player.god ? 'Mortal Again' : 'Hard As T’ Wainstones (God)');
    god.addEventListener('click', () => {
      this.player.god = !this.player.god;
      ui.toast(this.player.god ? 'Nowt can touch thee now.' : 'Tha’s mortal again — mind t’ bogs.');
      this.renderAdminPanel();
    });
    const kit = ui.el('button', 'mc', row, 'Full Kit (iron tools an’ all)');
    kit.addEventListener('click', () => {
      const p = this.player;
      [[I.I_PICK, 1], [I.I_AXE, 1], [I.I_SHOVEL, 1], [I.I_SWORD, 1], [I.STORM_LANTERN, 1],
       [I.COAL_LUMP, 64], [B.TORCH, 64], [B.LANTERN, 8], [B.PLANKS, 64],
       [B.STONEBRICK, 64], [I.COOKED_MUTTON, 16]].forEach(([id, n]) => p.addItem(id, n));
      ui.invDirty = true;
      ui.toast('Kitted out proper.');
    });
    const tLines = (geo.realWorld && geo.railPaths) ? geo.railPaths() : [];
    if (tLines.length > 1) {
      for (const l of tLines) { const b = ui.el('button', 'mc', row, `🚂 ${l.name}`); b.addEventListener('click', () => this.wardenBoardTrain(l.name)); }
    } else {
      const train = ui.el('button', 'mc', row, 'Board t’ Train (ride owt, Esc to step off)');
      train.addEventListener('click', () => this.wardenBoardTrain());
    }
    const pony = ui.el('button', 'mc', row, 'Find a Pony (drop by t’ nearest)');
    pony.addEventListener('click', () => this.wardenToPony());

    // drop in on a player (shared moor only — t' relay answers wardens wi' t' map)
    if (this.netActive && this.net && this.net.connected) {
      ui.el('div', 'r-needs', panel, 'Drop in on a player:');
      const pl = ui.el('div', 'admin-tp', panel);
      ui.el('div', 'r-needs', pl, 'asking t’ relay...');
      this.net.requestWhere(players => {
        if (this.state !== 'paused') return; // panel's closed — let it be
        pl.innerHTML = '';
        const mePid = (this.auth && this.auth.acct ? 'a' + this.auth.acct : this.devicePid()).slice(0, 40);
        const others = players.filter(q => q.pid !== mePid);
        if (!others.length) { ui.el('div', 'r-needs', pl, 'nob’dy else out just now'); return; }
        for (const q of others) {
          const d = Math.round(Math.hypot(q.x - this.player.pos.x, q.z - this.player.pos.z));
          const b = ui.el('button', 'mc chat-btn', pl, `${q.name} (${d}m)`);
          b.addEventListener('click', () => this.adminTeleport(Math.floor(q.x), Math.floor(q.z), q.name));
        }
      });
    }

    // or owt else: straight to coordinates
    ui.el('div', 'r-needs', panel, 'Or drop at coordinates:');
    const coordRow = ui.el('div', 'admin-btns', panel);
    const ix = ui.el('input', 'chat-input admin-coord', coordRow); ix.placeholder = 'x';
    const iz = ui.el('input', 'chat-input admin-coord', coordRow); iz.placeholder = 'z';
    const go = ui.el('button', 'mc chat-btn', coordRow, 'Drop');
    go.addEventListener('click', () => {
      const x = parseInt(ix.value, 10), z = parseInt(iz.value, 10);
      if (Number.isFinite(x) && Number.isFinite(z)) this.adminTeleport(x, z, `${x}, ${z}`);
    });

    // ---- shared-moor connection health (so the dropped-thread gremlin is visible) ----
    if (this.netActive && this.net) {
      ui.el('div', 'r-needs', panel, 'Shared Moor — connection:');
      const diagBox = ui.el('pre', '', panel);
      diagBox.style.cssText = 'font:10px/1.4 monospace;white-space:pre-wrap;color:#d2d8cc;background:rgba(0,0,0,0.28);padding:6px 8px;margin:4px 0;max-height:190px;overflow:auto;border-radius:4px;';
      const paint = () => {
        if (!this.net || this.ui.adminPanel.classList.contains('hidden')) return;
        const r = this.net.report(), ld = r.lastDrop;
        const kinds = Object.entries(r.dropsByKind).map(([k, n]) => `${k}×${n}`).join(', ') || 'none';
        diagBox.textContent =
          `state     ${r.state}\n` +
          `uptime    ${r.uptimeSec}s   (session ${r.sessionAgeSec}s)\n` +
          `connects  ${r.connects}    drops ${r.drops}    downtime ${r.totalDowntimeSec}s\n` +
          `last msg  ${r.lastMsgAgeSec ?? '—'}s ago    RTT ${r.lastRttMs ?? '—'}ms    others ${r.remotes}\n` +
          `causes    ${kinds}\n` +
          (ld ? `last drop ${ld.kind} (code ${ld.code}${ld.wasClean ? ', clean' : ''}${ld.hidden ? ', tab hidden' : ''}, lasted ${Math.round((ld.upMs || 0) / 1000)}s)\n` : '') +
          `\nrecent:\n` + r.recent.slice(-8).map(e => `  ${e.ago.padStart(5)}  ${e.kind}${e.detail && typeof e.detail === 'object' ? ' ' + (e.detail.kind || JSON.stringify(e.detail)) : (e.detail ? ' ' + e.detail : '')}`).join('\n');
      };
      paint();
      clearInterval(this._diagPaint);
      this._diagPaint = setInterval(paint, 1000);
      ui.el('div', 'r-needs', panel, 'Full log: type netDiag() in the browser console.');
    }
  }

  // Parish Ledger: live players (incl. solo worlds), recent activity, brain/relay status —
  // fetched from the EVO's new /dash/api/admin-summary. Fail-soft: a dead/unreachable EVO
  // must never block the rest of the panel from rendering (map/sliders/travel still work).
  renderParishLedger(panel) {
    const ui = this.ui;
    ui.el('div', 'r-needs', panel, 'Parish Ledger:');
    const box = ui.el('pre', '', panel);
    box.style.cssText = 'font:11px/1.5 monospace;white-space:pre-wrap;color:#d2d8cc;background:rgba(0,0,0,0.28);padding:6px 8px;margin:4px 0;max-height:160px;overflow:auto;border-radius:4px;';
    box.textContent = 'loading...';
    const key = (this.ui.adminLoginKey && this.ui.adminLoginKey.value) || 'warden1981';
    fetch(`/dash/api/admin-summary?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then(d => {
        if (this.ui.adminPanel.classList.contains('hidden')) return; // panel closed meanwhile
        if (d.error) { box.textContent = `Ledger: ${d.error}`; return; }
        const recent = (d.recent || []).slice(-6).map(e => `  ${e.name || '?'} — ${e.loc || '?'}`).join('\n');
        box.textContent =
          `online   ${d.online ?? '—'}   (live ${d.live ?? '—'})\n` +
          `brain    ${d.brain ?? '—'}    relay ${d.relay ?? '—'}\n` +
          (recent ? `recent activity:\n${recent}` : 'recent activity: none');
      })
      .catch(() => { box.textContent = 'Ledger unreachable.'; });
  }

  // Warden travel: tha doesn't walk, tha ARRIVES — dropped frae t' sky,
  // landing wi' a thump as t' parish will notice.
  adminTeleport(x, z, label) {
    const p = this.player;
    const g = this.world.gen.height(Math.floor(x), Math.floor(z));
    p.pos.x = x + 0.5; p.pos.z = z + 0.5;
    p.pos.y = Math.min(HEIGHT - 2, g + 38);
    if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; }
    p.fallStart = null;
    p.flying = false; // creative hover would spoil t' entrance
    this.wardenDrop = { label, t: 0 };
    this.resume();
    this.ui.toast(`Dropping in ower <b>${label}</b>...`, 2500);
  }

  // Warden shortcut: drop by t' nearest grazin' pony so tha can climb straight on;
  // if there's none about, set down on t' open moor where they roam an' they'll spawn near.
  wardenToPony() {
    const live = this.entities.mobs.filter(m => m.type === 'pony' && !m.dead && !m.rosterMount);
    if (live.length) {
      let best = live[0], bd = Infinity;
      for (const m of live) {
        const d = Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z);
        if (d < bd) { bd = d; best = m; }
      }
      this.adminTeleport(Math.floor(best.pos.x), Math.floor(best.pos.z), 'a grazin’ pony');
    } else {
      const moor = this.findOpenMoor(this.player.pos.x, this.player.pos.z) || { x: -380, z: -620 };
      this.ui.toast('No ponies in sight — droppin’ on t’ open moor an’ whistlin’ a few up.', 4500);
      this.adminTeleport(moor.x, moor.z, 'the open moor');
      this.dropPonies = { x: moor.x, z: moor.z }; // conjure a band once we land (chunk's loaded)
    }
  }

  // Find an open-moor tile near (cx,cz): high, dry, no dale, no coast, away frae t' villages.
  findOpenMoor(cx, cz) {
    const gen = this.world.gen, geo = gen.geo;
    for (let r = 40; r <= 520; r += 40) {
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2;
        const x = Math.round(cx + Math.cos(ang) * r), z = Math.round(cz + Math.sin(ang) * r);
        const h = gen.height(x, z);
        if (h >= 30 && h <= 42 && geo.bogginess(x, z) < 0.3 && geo.daleness(x, z) < 0.45 &&
            geo.coastT(x, z) === 0 && !geo.inVillage(x, z, 14)) {
          return { x, z };
        }
      }
    }
    return null;
  }

  // Warden boards t' moving train wherever she is on t' line — no booking, no
  // platform. We land on her chainage first so t' chunk loads an' t' carriage
  // shows, then t' ride machinery seats us. An open-ended ride (no destIdx), so
  // she runs forever till t' warden steps off.
  wardenBoardTrain(lineName) {
    if (!this.isAdmin()) return;
    const geo = this.world.gen.geo, p = this.player;
    const mainName = geo.railPaths ? (geo.railPaths().find(l => l.path === geo.railPath()) || {}).name : null;
    let bt = null, x, z;
    if (lineName && lineName !== mainName) {
      this._ensureBranchTrains();
      bt = (this.branchTrains || []).find(b => b.name === lineName);
      if (!bt) { this.ui.toast('No train on that line just now.'); return; }
      const s = this.trainScheduleFor(bt.path, bt.stations);
      const sp = geo.samplePosOn(bt.path, s.s);
      bt.state = { x: sp.x, z: sp.z, s };  // seed so the ride has the train at once
      x = sp.x; z = sp.z;
    } else {
      if (!this.trainState) { this.ui.toast('T’ train’s not running just now.'); return; }
      x = this.trainState.x; z = this.trainState.z;
    }
    const gy = this.world.gen.height(Math.floor(x), Math.floor(z));
    p.pos = { x, y: Math.min(HEIGHT - 2, gy + 3), z }; // so the train-world loads + shows her
    if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; }
    p.fallStart = null;
    p.flying = false;
    this.seatOffset = [0.55, -0.7];   // a window seat in t' middle bay
    this.ride = { warden: true, bt };  // bt = the branch train (null = the main); no destIdx → never auto-disembarks
    this.startRideView();
    this.state = 'riding';
    this.ui.show(null);
    this.lockPointer();
    this.ui.toast(`Aboard t’ ${lineName || mainName || 'train'}. Press <b>Esc</b> to step off.`, 4500);
  }

  // Warden steps off mid-line — set down beside t' rails where t' train is.
  wardenLeaveTrain() {
    const bt = this.ride && this.ride.bt;
    const ts = bt ? bt.state : this.trainState, p = this.player;
    this.ride = null;
    this.rideYawSet = false;
    this.ui.hideRideViewMenu();
    if (ts) {
      const gy = this.world.gen.height(Math.floor(ts.x + 1.5), Math.floor(ts.z + 1.5));
      p.pos = { x: ts.x + 1.5, y: gy + 2, z: ts.z + 1.5 };
    }
    if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; }
    p.fallStart = null;
    this.state = 'playing';
    this.ui.show(null);
    this.lockPointer();
    this.ui.toast('Off t’ train, then.', 2500);
  }

  // a warden hits t' ground like a dropped anvil: dust ring an' a thump
  landImpact(x, y, z, mine) {
    const e = this.entities;
    if (e) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        e.burst(x + Math.cos(a) * 1.6, y + 0.3, z + Math.sin(a) * 1.6, [122, 106, 82], 4);
      }
      e.burst(x, y + 0.6, z, [186, 178, 156], 12);
    }
    if (this.audio && this.audio.noiseBurst && this.audio.ctx) {
      const dNow = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
      const gain = Math.max(0.06, 0.5 - dNow / 200);
      this.audio.noiseBurst(this.audio.ctx.currentTime, 0.28, gain, 90, 'lowpass');
      this.audio.noiseBurst(this.audio.ctx.currentTime + 0.05, 0.12, gain * 0.6, 240, 'lowpass');
    }
    if (mine && this.netActive && this.net) this.net.sendFx('land', x, y, z);
  }

  // a warden's flourish happening near us (relayed by t' moor)
  remoteFx(m) {
    if (m.kind === 'land') this.landImpact(m.x, m.y, m.z, false);
  }

  resume() {
    this.state = 'playing';
    this.ui.show(null);
    this.lockPointer();
  }

  openInventory() {
    this.state = 'inv';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    document.exitPointerLock?.();
    this.ui.openInventory(this.player, this.nearBench());
  }

  closeScreens() {
    const wasBox = this.state === 'box';
    this.ui.closeInventory(this.player);
    this.state = 'playing';
    this.ui.show(null);
    this.lockPointer();
    if (wasBox) this.saveNow(false); // a stash is only worth owt if it keeps — persist on close
  }

  // ---------------- oak strongbox ----------------
  // Right-click a placed strongbox: open its chest panel (27 slots + a brass well).
  // Contents are keyed by block coordinate; no locks in v1 — on t' shared moor kids
  // share bases, so anyone may open or break a box.
  openStrongbox(x, y, z) {
    const store = this.world.strongboxes || (this.world.strongboxes = new Map());
    const key = boxKey(x, y, z);
    let box = store.get(key);
    if (!box) { box = makeBox(); store.set(key, box); }
    this.state = 'box';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    document.exitPointerLock?.();
    this.ui.openStrongbox(this.player, box);
  }

  // Shared-moor strongbox persistence (v1, LOCAL-ONLY): the relay knows nothing — a box's
  // contents are thine own browser's memory, kept in localStorage keyed by room. (Storage
  // keys keep t' owd 'moorcraft' prefix, same as the rest.) Solo worlds ride meta.strongboxes
  // through saveGame/loadGame instead.
  netBoxStorageKey() { return 'moorcraft.strongboxes.' + (this.netRoom || 'moor'); }

  persistNetStrongboxes() {
    if (!this.netActive || !this.world || !this.world.strongboxes) return;
    try { localStorage.setItem(this.netBoxStorageKey(), JSON.stringify([...this.world.strongboxes])); }
    catch { /* storage full or blocked — t' boxes keep in memory for t' session */ }
  }

  loadNetStrongboxes() {
    if (!this.world) return;
    try {
      const raw = localStorage.getItem(this.netBoxStorageKey());
      if (raw) this.world.strongboxes = new Map(JSON.parse(raw).map(([k, b]) => [k, normalizeBox(b)]));
    } catch { /* corrupt or blocked — start wi' empty boxes rather than crash t' join */ }
  }

  // ---------------- villagers & chat ----------------
  async spawnVillagers() {
    if (this.villagersSpawned) return;
    this.villagersSpawned = true;
    if (this.world.gen.geo.realWorld) return;   // real-Moors preview: no folk yet — population is a later slice (reset then)
    let roster = await npc.fetchRoster();
    const online = !!roster && roster.length > 0;
    if (!online) roster = npc.FALLBACK_ROSTER;
    this.roster = roster; // kept so train folk can be drawn frae t' same personas
    const geo = this.world.gen.geo;
    const nameHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
    const workSpot = (v, name) => { const hh = nameHash(name), a = (hh % 628) / 100, d = 8 + hh % 11; return { x: v.x + Math.cos(a) * d, z: v.z + Math.sin(a) * d }; };
    // each body gets their OWN spot about the green (scattered, not stacked on the centre)
    // so a midday gathering fills the green rather than piling on one tile.
    const socialSpot = (v, name) => { const hh = nameHash(name + '~green'), a = (hh % 628) / 100, d = 2 + hh % 8; return { x: v.x + Math.cos(a) * d, z: v.z + Math.sin(a) * d }; };
    const placeFolk = (id, name, village, role, roam) => {
      let x, z, green = null, work = null;
      if (village) {
        const sp = geo.npcSpot(name, village); x = sp[0]; z = sp[1];
        green = socialSpot(village, name); work = workSpot(village, name);
      } else { // a free moor-wanderer — starts out on the country near Moorstead
        const base = geo.village, hh = nameHash(name), a = (hh % 628) / 100, d = 40 + hh % 60;
        x = base.x + Math.cos(a) * d; z = base.z + Math.sin(a) * d;
        green = socialSpot(base, name);
      }
      const h = this.world.gen.height(Math.floor(x), Math.floor(z));
      this.entities.spawnVillager(id, name, x + 0.5, h + 1.1, z + 0.5, {
        village: village ? village.name : null,
        house: village ? geo.npcHome(name, village) : null,
        role, roam, green, work,
      });
    };
    for (const c of roster) {
      // folk live all ower t' moors now — t' roster says which settlement
      const village = (c.village && geo.villages.find(v => v.name.toLowerCase() === c.village.toLowerCase())) || geo.village;
      placeFolk(c.id, c.name, village, null, false);
    }
    // fill the parish out — extra folk (generic AI "passer-by" voice, no stored memory/trust), some that roam beyond the village
    for (const f of EXTRA_FOLK) {
      const village = f.village ? (geo.villages.find(v => v.name.toLowerCase() === f.village.toLowerCase()) || geo.village) : null;
      placeFolk(null, f.name, village, f.role, !!f.roam);
    }
    this.brainUp = online; // tracks whether the village brain is actually answering
    this.ui.toast(online
      ? '<b>Right-click</b> t&rsquo; folk o&rsquo; t&rsquo; moors for a natter &mdash; every settlement&rsquo;s got its own. After dark, knock on their doors.'
      : 'T&rsquo; villages stand quiet &mdash; t&rsquo; brain in&rsquo;t answering (yet).', 8000, online ? null : 'warn');
    if (online) this.refreshStanding(false);
    else this.scheduleRosterRetry(3);
    if (!this.player.villagerMarkerHinted) {
      this.player.villagerMarkerHinted = true;
      setTimeout(() => this.ui.toast('Villagers wi’ a ❓ above their head have summat to say — press <b>T</b> or right-click to talk.', 7000), 5000);
    }
  }

  // T' brain can be slow to wake (cold tunnel, model loading): keep trying
  // quietly and breathe life into t' villagers when it answers.
  scheduleRosterRetry(attemptsLeft) {
    if (attemptsLeft <= 0) return;
    setTimeout(async () => {
      if (!this.world || this.villagersBound) return;
      const roster = await npc.fetchRoster();
      if (roster && roster.length) {
        this.villagersBound = true;
        for (const m of this.entities.mobs) {
          if (m.type !== 'villager' || m.charId) continue;
          const hit = roster.find(c => c.name.toLowerCase() === m.t.name.toLowerCase())
            || roster.find(c => c.name.toLowerCase().includes(m.t.name.toLowerCase().split(' ').pop()));
          if (hit) m.charId = hit.id;
        }
        this.brainUp = true;
        this.ui.toast('T&rsquo; village brain&rsquo;s woken up &mdash; t&rsquo; folk have found their tongues!', 6000);
        this.refreshStanding(false);
      } else {
        this.scheduleRosterRetry(attemptsLeft - 1);
      }
    }, 10000);
  }

  // Identity. Invited players: account-based (follows them across devices).
  // Ramblers: per-browser UUID. Both scoped per world seed for NPC memory.
  devicePid() {
    try {
      let pid = localStorage.getItem('moorcraft-pid');
      if (!pid) {
        pid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
        localStorage.setItem('moorcraft-pid', pid);
      }
      return pid;
    } catch (e) {
      // storage blocked — keep a stable id for this session so multiplayer/memory still work.
      // Counted: an ephemeral pid means NPC memory an' pets silently reset every visit.
      if (!this._ephemeralPid) reportQuiet('pid-storage', e);
      return (this._ephemeralPid ||= (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)));
    }
  }

  // Once-per-session landing ping so the parish ledger can count site visits.
  recordVisit(event = 'landing') {
    const key = `moorstead-visit-${event}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* private browsing */ }
    fetch('/dash/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: this.devicePid(),
        name: (this.auth && this.auth.name) || '',
        event,
      }),
    }).catch(() => {});
  }

  playerId() {
    if (this.auth && this.auth.acct) {
      return `a${this.auth.acct}-s${this.seed}`.toLowerCase().slice(0, 64);
    }
    return `${this.devicePid()}-s${this.seed}`.toLowerCase().slice(0, 64);
  }

  // Tell a brain-backed vendor about a completed trade so they remember the deal.
  // Fire-and-forget; passers-by (no charId) keep no memory, so skip them.
  recordTrade(villager, itemId, direction) {
    if (!villager || !villager.charId) return;
    try {
      const item = itemName(itemId).toLowerCase().replace(/^(raw|roast)\s+/, '');
      npc.trade(villager.charId, item, 1, direction, this.playerId());
    } catch (e) { reportQuiet('trade-memory', e); /* never let trade-memory break a trade — but a vendor quietly forgetting every deal is worth knowing */ }
  }

  async login() {
    const code = this.ui.loginCode.value.trim().toLowerCase();
    const name = this.ui.loginName.value.trim();
    if (!code || !name) {
      this.ui.loginErr.textContent = 'Code an\u2019 name both, love.';
      return;
    }
    this.ui.loginErr.textContent = 'Asking t\u2019 parish clerk...';
    try {
      const res = await fetch('/dash/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, pid: this.devicePid() }),
      });
      const d = await res.json();
      if (!d.ok) {
        this.ui.loginErr.textContent = d.err || 'That didn\u2019t work.';
        return;
      }
      this.auth = { code, name: d.name, acct: d.acct, room: d.room || 'moor', token: d.token || '', daemon: d.daemon || null };
      localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
      this.saveAccount(this.auth);
      this.refreshAdmin();
      this.ui.loginErr.textContent = '';
      this.ui.setLoggedIn(this.auth);
    } catch {
      this.ui.loginErr.textContent = 'Can\u2019t reach t\u2019 parish clerk \u2014 try again in a minute, or come in as a rambler.';
    }
  }

  async requestInvite() {
    const email = this.ui.requestEmail.value.trim().toLowerCase();
    const name = this.ui.requestName.value.trim();
    const note = this.ui.requestNote.value.trim();
    if (!email || !email.includes('@')) {
      this.ui.requestErr.textContent = 'A proper email address, love.';
      return;
    }
    this.ui.requestErr.textContent = 'Sending to t\u2019 parish clerk...';
    this.ui.requestOk.classList.add('hidden');
    try {
      const res = await fetch('/dash/request-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, note, pid: this.devicePid() }),
      });
      const d = await res.json();
      if (!d.ok) {
        this.ui.requestErr.textContent = d.err || 'That didn\u2019t work.';
        return;
      }
      this.ui.requestErr.textContent = '';
      this.ui.requestBox.classList.add('hidden');
      this.ui.requestOk.classList.remove('hidden');
      this.ui.requestOk.textContent = d.msg || 'Thanks \u2014 I\u2019ll be in touch if there\u2019s a spot.';
    } catch {
      this.ui.requestErr.textContent = 'Can\u2019t reach t\u2019 parish clerk \u2014 try again later.';
    }
  }

  openFeedback(page = 'title') {
    this.feedbackReturn = this.ui.titleScreen.classList.contains('hidden') ? null : 'titleScreen';
    this.ui.feedbackErr.textContent = '';
    this.ui.feedbackOk.classList.add('hidden');
    this.ui.feedbackMessage.value = '';
    this.ui.feedbackPage = page;
    this.ui.show('feedbackScreen');
    this.ui.feedbackMessage.focus();
  }

  async sendFeedback() {
    const message = this.ui.feedbackMessage.value.trim();
    const email = this.ui.feedbackEmail.value.trim().toLowerCase();
    const kind = this.ui.feedbackScreen.querySelector('input[name="fb-kind"]:checked')?.value || 'feedback';
    if (message.length < 8) {
      this.ui.feedbackErr.textContent = 'A bit more detail, love — at least a sentence.';
      return;
    }
    this.ui.feedbackErr.textContent = 'Sending...';
    this.ui.feedbackOk.classList.add('hidden');
    const page = this.ui.feedbackPage || (this.world ? 'in-game' : 'title');
    const name = (this.auth && this.auth.name) || this.player?.name || '';
    try {
      const d = await submitFeedback({
        kind,
        message,
        email,
        name,
        context: gatherContext(this, page),
        pid: this.devicePid(),
      });
      if (!d.ok) {
        this.ui.feedbackErr.textContent = d.err || 'That didn\u2019t work.';
        return;
      }
      this.ui.feedbackErr.textContent = '';
      this.ui.feedbackOk.classList.remove('hidden');
      this.ui.feedbackOk.textContent = d.msg || 'Thanks — noted on t\u2019 parish ledger.';
      this.ui.feedbackMessage.value = '';
    } catch {
      this.ui.feedbackErr.textContent = 'Can\u2019t reach t\u2019 parish ledger — try again later.';
    }
  }

  // Quiet re-claim wi' t' stored code: picks up room moves an' name changes
  // made on t' ledger since last visit. Best-effort — offline, carry on.
  async refreshAuth() {
    if (!this.auth || !this.auth.code) return;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('/dash/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: this.auth.code, name: this.auth.name || '', pid: this.devicePid() }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const d = await res.json();
      if (d && d.ok) {
        this.auth = { code: this.auth.code, name: d.name, acct: d.acct, room: d.room || 'moor', token: d.token || this.auth.token || '', daemon: d.daemon || (this.auth && this.auth.daemon) || null };
        localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
        this.saveAccount(this.auth);
        this.refreshAdmin();
        this.ui.setLoggedIn(this.auth);
      } else if (d && /No such invite/i.test(d.err || '')) {
        // t' token's been retired in a reset — don't limp on wi' a dead identity
        this.logout();
        this.ui.toast('Thi owd invite’s been retired — ask t’ warden for a fresh un.', 8000);
      }
    } catch { /* parish clerk's having his tea */ }
  }

  loginGuest() {
    this.auth = { guest: true, name: '' };
    localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
    this.ui.setLoggedIn(this.auth);
  }

  async loginWarden() {
    const key = (this.ui.wardenKey.value || '').trim();
    if (!key) { this.ui.loginErr.textContent = 'Key needed.'; return; }
    let hex = '';
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { this.ui.loginErr.textContent = "Couldn't check that key."; return; }
    if (!ADMIN_HASHES.includes(hex)) { this.ui.loginErr.textContent = "That's not a warden key."; return; }
    this.auth = { warden: true, name: 'Warden' };
    localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
    this.adminOk = true;
    this.ui.loginErr.textContent = '';
    this.ui.setLoggedIn(this.auth);
  }

  // Front-page Admin shortcut: same hash-check as loginWarden(), but on success skips the
  // invite-code flow entirely and drops straight into a fresh solo creative world — the
  // fastest route in for the one person who's ever going to type this key.
  async loginWardenAndPlay() {
    const key = (this.ui.adminLoginKey.value || '').trim();
    if (!key) { this.ui.adminLoginErr.textContent = 'Key needed.'; return; }
    let hex = '';
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { this.ui.adminLoginErr.textContent = "Couldn't check that key."; return; }
    if (!ADMIN_HASHES.includes(hex)) { this.ui.adminLoginErr.textContent = "That's not a warden key."; return; }
    this.auth = { warden: true, name: 'Warden' };
    localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
    this.adminOk = true;
    this.ui.adminLoginErr.textContent = '';
    this.audio.init();
    this.newWorld('');
  }

  logout() {
    this.auth = null;
    localStorage.removeItem('moorcraft-auth');
    this.ui.setLoggedIn(null);
  }

  // ---- saved logins: switch between folk who share this browser ----
  // A roster o' real accounts (not ramblers), so t' family can hop between
  // their own pockets an' ventures wi'out keyin' t' invite code each time.
  loadAccounts() {
    try { return JSON.parse(localStorage.getItem('moorcraft-accounts') || '[]'); }
    catch (e) { reportQuiet('accounts-parse', e); return []; } // the family's saved-login roster silently vanished
  }

  saveAccount(auth) {
    if (!auth || !auth.code || auth.guest) return; // ramblers leave no trace
    const roster = this.loadAccounts().filter(a => a.acct !== auth.acct);
    roster.unshift({ code: auth.code, name: auth.name, acct: auth.acct, room: auth.room || 'moor' });
    localStorage.setItem('moorcraft-accounts', JSON.stringify(roster.slice(0, 8)));
  }

  switchAccount(acct) {
    const a = this.loadAccounts().find(x => x.acct === acct);
    if (!a) return;
    this.auth = { code: a.code, name: a.name, acct: a.acct, room: a.room || 'moor' };
    localStorage.setItem('moorcraft-auth', JSON.stringify(this.auth));
    this.refreshAdmin();
    this.ui.setLoggedIn(this.auth);
    this.ui.toast(`Now playing as <b>${escHtml(a.name)}</b>.`, 3000);
    this.refreshAuth(); // quiet re-claim picks up owt t' ledger's changed
  }

  forgetAccount(acct) {
    localStorage.setItem('moorcraft-accounts', JSON.stringify(this.loadAccounts().filter(a => a.acct !== acct)));
    this.ui.setLoggedIn(this.auth);
  }

  // ---- friendship has its rewards ----
  // Tier ladder matches t' brain's memory.TRUST_TIERS.
  static TIER_ORDER = ['Stranger', 'Acquaintance', 'Friendly', 'Friend', 'Close friend'];
  static TIER_REWARDS = {
    1: { items: [[I.BILBERRIES, 4]], note: 'a handful o\u2019 bilberries' },
    2: { items: [[I.COOKED_MUTTON, 3]], note: 'some roast mutton, still warm' },
    3: { items: [[I.IRON_INGOT, 2]], note: 'two good iron ingots' },
    4: { items: [[I.JET_GEM, 1]], note: 'a polished piece o\u2019 Whitby jet \u2014 a family treasure' },
  };

  maybeReward(villager, tier) {
    const idx = Game.TIER_ORDER.indexOf(tier);
    if (idx < 0 || !villager.charId) return;
    const had = this.player.npcRewards[villager.charId] ?? 0;
    if (idx <= had) return;
    this.player.npcRewards[villager.charId] = idx;
    for (let t = had + 1; t <= idx; t++) {
      const rw = Game.TIER_REWARDS[t];
      if (!rw) continue;
      for (const [id, n] of rw.items) {
        const left = this.player.addItem(id, n);
        if (left > 0) this.dropAtPlayer(id, left);
      }
      villager.chatLog.push({
        who: 'sys',
        text: `${villager.displayName} reckons thee a${t >= 3 ? ' true' : 'n'} ${Game.TIER_ORDER[t].toLowerCase()} now \u2014 and presses ${rw.note} into thi hands.`,
      });
      this.audio.pickup();
    }
    this.ui.invDirty = true;
    this.ui.renderChatLog();
    this.refreshStanding(true);
    this.saveNow(false);
  }

  async refreshStanding(announce) {
    try {
      const prevTrust = this.standingData ? this.standingData.total_trust : null;
      const s = await npc.standing(this.playerId());
      this.standingData = s;
      const label = this.quests ? this.quests.standingLabel() : s.standing;
      if (announce && this.standing && label !== this.standing) {
        this.ui.toast(`Word\u2019s gone round Moorstead \u2014 tha\u2019s <b>${label}</b> in t\u2019 village now.`, 6000);
      } else if (announce && prevTrust != null && s.total_trust > prevTrust) {
        // standing rose but t' tier didn't turn over \u2014 still say so, or the whole
        // reputation system reads as a black box
        this.ui.toast('Word o\u2019 thi good turn\u2019s gone round \u2014 <b>thi standing\u2019s grown</b>.', 4000);
      }
      this.standing = label;
      this.quests.refreshOffers();
    } catch { /* brain offline — standing stays unknown */ }
  }

  // the villager tha's looking at, within talking reach (for the T-to-talk hint + key)
  villagerInView() {
    if (!this.world || !this.entities || this.state !== 'playing') return null;
    const eye = this.player.eyePos();
    const d = this.lookDir();
    const hit = this.entities.raycastMobs(eye.x, eye.y, eye.z, d.x, d.y, d.z, 5);
    if (hit && hit.mob.type === 'villager' && !hit.mob.isRemotePlayer) return hit.mob;
    return null;
  }

  // The nearest un-owned tameable beast tha's roughly facing — a forgiving cone, not a
  // pin-sharp ray, so feeding an' the "feed her" prompt work even wi' a bairn's loose aim.
  aimedTameable() {
    if (!this.world || !this.entities || this.state !== 'playing') return null;
    const eye = this.player.eyePos(), d = this.lookDir();
    let best = null, bestDist = Infinity;
    for (const m of this.entities.mobs) {
      if (!m || m.dead || m.owner || !m.t || !m.t.tameable || !m.t.tameFood) continue;
      const vx = m.pos.x - eye.x, vy = (m.pos.y + (m.t.h || 1) * 0.5) - eye.y, vz = m.pos.z - eye.z;
      const dist = Math.hypot(vx, vy, vz);
      if (dist < 0.01 || dist > 5) continue;
      if ((vx * d.x + vy * d.y + vz * d.z) / dist < 0.9) continue; // ~25° cone ahead
      if (dist < bestDist) { bestDist = dist; best = m; }
    }
    return best;
  }

  openChat(villager) {
    this.state = 'chat';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    villager.chatting = true;
    this.chatOpen = true;               // etiquette: no ambient approaches mid-conversation
    // a passenger's parcel becomes an errand: see it to their stop for coal
    if (villager.onTrain && villager.trainParcel && this.pendingGoods == null && !(this.drive && this.drive.goods)) {
      const stns = this.world.gen.geo.railway();
      this.pendingGoods = { dest: villager.parcelDest, reward: 3 + ((Math.random() * 3) | 0), from: -1, parcel: villager.trainParcel };
      villager.trainParcel = null;
      villager.chatLog.push({ who: 'sys', text: `Tha takes ${this.pendingGoods.parcel} into thi care for <b>${stns[villager.parcelDest].name}</b>. Drive (or ride) her there an’ it’s delivered.` });
    }
    document.exitPointerLock?.();
    this.ui.chatWaiting = false;
    this.ui.openChat(villager, !!this.player.name);
  }

  closeChat() {
    if (this.ui.chatVillager) this.ui.chatVillager.chatting = false;
    this.chatOpen = false;
    this.state = 'playing';
    this.ui.show(null);
    this.lockPointer();
  }

  // ---------------- Dress Thissen (player customisation) ----------------
  // Open the wardrobe seeded from the player's current look. Pauses input like the
  // other menus. The panel edits a working copy; previewPlayerLook re-dresses a
  // mini avatar as they pick; applyPlayerLook commits on Done.
  openWardrobe() {
    this.state = 'paused';
    this.clearKeys();
    try { document.exitPointerLock?.(); } catch { /* not locked */ }
    this.ui.openWardrobe(this.player.look);
  }

  // Live preview: build a mini avatar frae the look into a small offscreen scene
  // an' render it to the panel's canvas. Guarded — if GL's unavailable (or headless)
  // it simply no-ops an' the player dresses-an'-sees on Done. Uses the SAME shared
  // makeVillager builder, so the preview is exactly what peers will see.
  previewPlayerLook(look) {
    try {
      if (!this.ui.wardrobePreviewCanvas || typeof WebGLRenderingContext === 'undefined') return;
      if (!this._wardrobePrev) {
        const cv = this.ui.wardrobePreviewCanvas;
        const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
        r.setSize(cv.width, cv.height, false);
        const scene = new THREE.Scene();
        const cam = new THREE.PerspectiveCamera(35, cv.width / cv.height, 0.1, 50);
        cam.position.set(0, 1.1, 4.2); cam.lookAt(0, 0.95, 0);
        scene.add(new THREE.AmbientLight(0xffffff, 0.75));
        const dir = new THREE.DirectionalLight(0xfff2d8, 0.9); dir.position.set(2, 4, 3); scene.add(dir);
        this._wardrobePrev = { r, scene, cam, mesh: null };
      }
      const P = this._wardrobePrev;
      if (P.mesh) { P.scene.remove(P.mesh); }
      P.mesh = buildPlayerLookMesh(look);
      P.mesh.rotation.y = Math.PI; // face the camera
      P.scene.add(P.mesh);
      P.r.render(P.scene, P.cam);
    } catch (e) { /* GL unavailable — dress-an'-see on Done still works */ }
  }

  // Commit a chosen look: store on the player, persist (rides serialize), tell peers
  // (additive relay message), an' close back to where the wardrobe was opened from.
  applyPlayerLook(look) {
    this.player.look = validatePlayerLook(look);
    try { this.net && this.net.sendLook && this.net.sendLook(); } catch { /* not connected — sent on next connect */ }
    this.saveNow(false);
    this.ui.show(this.wardrobeReturn || 'pauseScreen');
    this.ui.toast('Tha&rsquo;s dressed. Other folk&rsquo;ll see thi new get-up.', 3500);
  }

  setPlayerName() {
    const name = this.ui.chatNameInput.value.trim();
    if (!name) return;
    this.player.name = name;
    this.ui.chatNameRow.classList.add('hidden');
    this.ui.chatInputRow.classList.remove('hidden');
    this.ui.chatInput.focus();
    this.saveNow(false);
  }

  async sendChat() {
    const v = this.ui.chatVillager;
    const text = this.ui.chatInput.value.trim();
    if (!v || !text || this.ui.chatWaiting) return;
    this.ui.chatInput.value = '';
    v.chatLog.push({ who: 'you', text });
    // Procedural roster folk (ids like "pop-whitby-0") aren't registered chat personas — they would
    // 404 on /api/talk — so route them, like unregistered villagers, through the brain's generic
    // passer-by voice. Curated/persona NPCs (other ids) keep the registered path with memory + trust.
    const usePersona = v.charId && !(typeof v.charId === 'string' && v.charId.startsWith('pop-'));
    if (!usePersona) {
      if (v.onTrain && v.cannedReplies && v.cannedReplies.length) {
        v.chatLog.push({ who: 'them', text: v.cannedReplies[(Math.random() * v.cannedReplies.length) | 0] });
        this.ui.renderChatLog();
        return;
      }
      // an unregistered villager: talk to them through the brain's generic
      // passer-by voice \u2014 proper AI dialogue, just no stored memory or trust
      this.ui.chatWaiting = true;
      this.ui.renderChatLog();
      try {
        const persona = { name: v.displayName || v.t.name, role: v.role, village: v.village, mood: moodWord(v.mood == null ? 0.5 : v.mood) };
        let ctx = this.quests.chatContext(v);
        if (this.entities.lastBuild && performance.now() - this.entities.lastBuild.t < 120000) {
          ctx += '\nThe visitor has been building something on the land near here.';
        }
        const res = await npc.talkGeneric(persona, text, this.player.name, ctx);
        this.brainUp = true;
        v.chatLog.push({ who: 'them', text: res.reply });
        if (v.memory) { v.memory.push(text.slice(0, 60)); if (v.memory.length > 4) v.memory.shift(); }
        // She's told thee t' times — the chip carries them now (learned by asking).
        if (v.village && this.player && !this.player.knownTimes[v.village] && this.depsForStation(v.village, 1)) {
          this.player.knownTimes[v.village] = true;
          this.ui.toast(`Tha knows t' ${v.village} train times now — t' station chip'll show 'em.`, 5000);
        }
      } catch {
        this.brainUp = false;
        v.chatLog.push({ who: 'sys', text: `${v.displayName} says nowt \u2014 t\u2019 village brain didn\u2019t answer. Try again in a moment.` });
      }
      this.ui.chatWaiting = false;
      this.ui.renderChatLog();
      return;
    }
    this.ui.chatWaiting = true;
    this.ui.renderChatLog();
    try {
      const res = await npc.talk(v.charId, text, this.player.name, this.playerId(), this.quests.chatContext(v));
      this.brainUp = true;
      v.chatLog.push({ who: 'them', text: res.reply });
      v.tier = res.tier;
      this.ui.setChatTier(res.tier);
      this.maybeReward(v, res.tier);
      // She's told thee t' times — the chip carries them now (learned by asking).
      if (v.village && this.player && !this.player.knownTimes[v.village] && this.depsForStation(v.village, 1)) {
        this.player.knownTimes[v.village] = true;
        this.ui.toast(`Tha knows t' ${v.village} train times now — t' station chip'll show 'em.`, 5000);
      }
    } catch {
      this.brainUp = false;
      v.chatLog.push({ who: 'sys', text: 'T\u2019 village brain didn\u2019t answer \u2014 try again in a moment.' });
    }
    this.ui.chatWaiting = false;
    this.ui.renderChatLog();
  }

  async giveGift() {
    const v = this.ui.chatVillager;
    const held = this.player.heldItem();
    if (!v || this.ui.chatWaiting) return;
    if (!held) { this.ui.toast('Tha&rsquo;s got nowt in hand to give.'); return; }
    if (!v.charId) {
      this.ui.toast('No use &mdash; t&rsquo; brain&rsquo;s asleep.');
      return;
    }
    const giftName = itemName(held.id).toLowerCase().replace(/^(raw|roast)\s+/, '')
      .replace(/\s*\(.*\)$/, '').replace('bilberries', 'bilberry').replace(/\s+bush$/, '');
    this.player.consumeHeld();
    this.ui.invDirty = true;
    v.chatLog.push({ who: 'sys', text: `Tha gives ${v.displayName} thi ${itemName(held.id)}.` });
    this.ui.renderChatLog();
    try {
      const res = await npc.gift(v.charId, giftName, this.playerId());
      v.tier = res.tier;
      this.ui.setChatTier(res.tier);
      v.chatLog.push({ who: 'sys', text: `${v.displayName} seems right chuffed. (${res.tier})` });
      this.maybeReward(v, res.tier);
    } catch {
      v.chatLog.push({ who: 'sys', text: 'T\u2019 gift went unmarked \u2014 brain trouble.' });
    }
    this.ui.renderChatLog();
  }

  giveToRemote(mob, held) {
    if (!this.net || !this.net.connected) {
      this.ui.toast('Not connected to t’ shared moor — can’t send a gift right now.'); return;
    }
    let targetPid = null;
    for (const [pid, r] of this.net.remotes.entries()) {
      if (r.mob === mob) { targetPid = pid; break; }
    }
    if (!targetPid) { this.ui.toast('Can’t find that soul on t’ relay.'); return; }
    const sent = this.net.send({ type: 'gift', to: targetPid, goods: [[held.id, 1]] });
    if (!sent) { this.ui.toast('Couldn’t send — try again.'); return; }
    const slot = this.player.slots[this.player.hotbar];
    if (slot) { slot.n -= 1; if (slot.n <= 0) this.player.slots[this.player.hotbar] = null; }
    this.ui.invDirty = true;
    const more = slot && slot.n > 0 ? ' Right-click again to give more.' : '';
    this.ui.toast(`Gave a <b>${itemName(held.id)}</b> to <b>${mob.displayName}</b>.${more}`, 4000);
  }

  receiveGift(fromName, goods) {
    if (!Array.isArray(goods) || goods.length === 0) return;
    const items = goods.filter(g => Array.isArray(g) && g.length === 2 && Number.isFinite(g[0]) && Number.isFinite(g[1]) && g[1] > 0 && g[1] <= 999);
    if (!items.length) return;
    for (const [id, n] of items) {
      const left = this.player.addItem(id, n);
      if (left > 0) this.dropAtPlayer(id, left);
    }
    this.ui.invDirty = true;
    const desc = items.map(([id, n]) => `${n}× ${itemName(id)}`).join(', ');
    // fromName is relay-borne (another player's name) — escape it, same as chat toasts
    this.ui.toast(`<b>${escHtml(fromName)}</b> gave thee <b>${escHtml(desc)}</b>!`, 6000);
  }

  // ---- T' Tradin' Post (market stalls v1) ----
  // Offer board over t' relay (relay-authoritative; see ui.buildStallSection).
  // Posting escrows t' give-goods OUT o' thi pockets at once, so they can't be
  // spent twice; t' relay holds 'em in t' offer an' echoes 'em back on a refused
  // post (stallerr.give), a withdraw (stallreturn), or to t' taker (stalldone).
  // A taker pays t' want-goods over the EXISTING gift mechanism — no new trust
  // surface. T' relay only lets an accept through while t' poster's connected
  // (gifts don't queue for offline folk), so t' payment always has a home.

  stallPost(give, want) {
    if (!(this.netActive && this.net && this.net.connected)) {
      this.ui.toast('T&rsquo; Tradin&rsquo; Post only works on t&rsquo; shared moor.'); return false;
    }
    if (!offerShapeOk({ give, want })) { this.ui.toast('That swap doesn&rsquo;t look right, love.'); return false; }
    if (!hasStacks(countsFromSlots(this.player.slots), give)) {
      this.ui.toast('Tha hasn&rsquo;t got them goods to give.'); return false;
    }
    if (!this.net.sendStallPost(give, want)) { this.ui.toast('Couldn&rsquo;t reach t&rsquo; relay &mdash; try again.'); return false; }
    for (const [id, n] of give) this.player.removeItem(id, n);   // escrow, immediately
    this.ui.invDirty = true;
    this.ui.toast('Thi swap&rsquo;s pinned to t&rsquo; Tradin&rsquo; Post &mdash; thi goods sit in escrow till it&rsquo;s took or pulled back.', 5000);
    return true;
  }

  stallWithdraw(id) {
    if (this.net && this.net.connected) this.net.sendStallWithdraw(id);
  }

  // t' relay's confirmed an offer o' thine is off t' board — its escrow comes home
  stallReturned(offer) {
    if (!offer || !Array.isArray(offer.give)) return;
    for (const [id, n] of offer.give) {
      if (!Number.isFinite(id) || !Number.isFinite(n) || n <= 0) continue;
      const left = this.player.addItem(id, n);
      if (left > 0) this.dropAtPlayer(id, left);
    }
    this.ui.invDirty = true;
    this.ui.toast(`Back in thi pockets: <b>${escHtml(describeStacks(offer.give))}</b>.`, 5000);
  }

  stallAccept(offer) {
    // belt to t' UI's braces: hold t' want-goods NOW, afore owt goes on t' wire
    if (!offer || !this.net || !this.net.connected) return;
    if (!hasStacks(countsFromSlots(this.player.slots), offer.want)) {
      this.ui.toast(`Tha needs <b>${escHtml(describeStacks(offer.want))}</b> in thi pockets first.`); return;
    }
    this.net.sendStallAccept(offer.id);
  }

  // t' relay says a swap's completed (first accept won; t' offer's gone frae t' board).
  // If WE took it: pay t' want-goods to t' poster as a normal gift, an' pocket t'
  // escrowed give-goods (they ride in on m.offer — they left t' poster at post time).
  stallDone(m) {
    const my = this.net && this.net.diag.pid;
    if (!my) return;
    if (m.takerPid === my && m.offer && Array.isArray(m.offer.give)) {
      const offer = m.offer;
      // re-check at receipt: pay exactly what we still hold (t' accept was gated on
      // holding it all; owt spent in t' race window just pays short, never negative)
      const pay = [];
      for (const [id, n] of (Array.isArray(offer.want) ? offer.want : [])) {
        if (!Number.isFinite(id) || !Number.isFinite(n) || n <= 0) continue;
        const have = Math.min(this.player.countItem(id), n);
        if (have > 0) { this.player.removeItem(id, have); pay.push([id, have]); }
      }
      if (pay.length) this.net.send({ type: 'gift', to: offer.pid, goods: pay });
      for (const [id, n] of offer.give) {
        if (!Number.isFinite(id) || !Number.isFinite(n) || n <= 0) continue;
        const left = this.player.addItem(id, n);
        if (left > 0) this.dropAtPlayer(id, left);
      }
      this.ui.invDirty = true;
      this.ui.toast(`Swap done! <b>${escHtml(describeStacks(offer.give))}</b> for thee &mdash; thi <b>${escHtml(describeStacks(pay))}</b>&rsquo;s gone to <b>${escHtml(String(offer.name || 'them'))}</b>.`, 6000);
    } else if (m.posterPid === my) {
      this.ui.toast(`<b>${escHtml(String(m.takerName || 'Somebody'))}</b> took thi swap off t&rsquo; Tradin&rsquo; Post &mdash; their goods are on t&rsquo; way.`, 6000);
    }
  }

  // Threshold crossing: fade to black, teleport, fade back in. `plan` is the
  // inn plan (src/innplan.js); `entering` picks parlour-vs-exterior destination.
  // Drives the same canvas-opacity the title reveal uses, at a much shorter
  // duration — no chunk-streaming gate needed: both destinations are inside the
  // inn's own chunk(s), already generated because the player is stood at a door.
  crossThreshold(plan, entering) {
    if (this.state !== 'playing' || this._thresholdBusy) return;
    this._thresholdBusy = true;
    if (this.audio && this.audio.warnKnock) this.audio.warnKnock(0.3); // the latch
    const dest = entering
      ? { x: plan.origin.x + 0.5, y: plan.parlour.floorY + 1, z: plan.origin.z + 0.5 }
      : this._innExteriorLanding(plan);
    const el = this.renderer.domElement;
    const FADE_MS = 260;
    el.style.transition = `opacity ${FADE_MS}ms`;
    el.style.opacity = '0';
    setTimeout(() => {
      this.player.pos = { x: dest.x, y: dest.y, z: dest.z };
      this.player.vel = { x: 0, y: 0, z: 0 };
      if (entering && this.audio && this.audio.hearthCrackle) this.audio.hearthCrackle(0.25);
      el.style.opacity = '1';
      setTimeout(() => { el.style.transition = ''; this._thresholdBusy = false; }, FADE_MS);
    }, FADE_MS);
  }

  // Landing spot just outside the exterior door, one block out from the door
  // cell on the doorSide, stood on the ground.
  _innExteriorLanding(plan) {
    const { x0, z0, x1, z1 } = plan.footprint;
    const midX = Math.round((x0 + x1) / 2), midZ = Math.round((z0 + z1) / 2);
    const out = plan.doorSide === 'n' ? { x: midX, z: z0 - 1 }
      : plan.doorSide === 's' ? { x: midX, z: z1 + 1 }
      : plan.doorSide === 'e' ? { x: x1 + 1, z: midZ }
      : { x: x0 - 1, z: midZ };
    return { x: out.x + 0.5, y: plan.groundY + 1, z: out.z + 0.5 };
  }

  readSignpost() {
    const geo = this.world.gen.geo;
    const p = this.player.pos;
    // bearingLabel matches t' minimap (north +x, east +z) \u2014 t' owd inline maths here
    // read a quarter-turn off it
    const dirTo = (x, z) => bearingLabel(p.x, p.z, x, z);
    const v = geo.village;
    let msg = `<b>MOORSTEAD</b> \u2014 ${dirTo(v.x, v.z)}`;
    const sh = geo.nearestShelter(p.x, p.z);
    if (sh && sh.dist > 10) msg += `<br><b>MOOR SHELTER</b> \u2014 ${dirTo(sh.x, sh.z)}`;
    else if (sh) msg = `<b>MOOR SHELTER</b> \u2014 tha\u2019s stood at it<br>` + msg;
    this.ui.toast(msg, 8000);
  }

  // "Find shelter" (L, or t' touch More menu): t' waymark-signpost bearings wi'out
  // needing a signpost \u2014 free, works of a neet an' in ordinary murk. Only t' Great
  // Fog takes it away, same rule as t' minimap blackout: bearings are part o' t' map.
  findShelter() {
    if (!this.world || this.state !== 'playing') return;
    const fog = !!(this.sky && this.sky.moorFog > 0.6);
    const geo = this.world.gen.geo;
    const p = this.player.pos;
    let shelter = null, village = null;
    if (!fog) {
      const sh = geo.nearestShelter(p.x, p.z);
      if (sh) shelter = { at: sh.dist <= 10, label: bearingLabel(p.x, p.z, sh.x, sh.z) };
      else {
        // this world has no stone shelters marked (t' Moors) \u2014 t' nearest village is
        // t' nearest roof instead
        let best = null, bestD = Infinity;
        for (const v of geo.villages || []) {
          const d = Math.hypot(v.x - p.x, v.z - p.z);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best && best !== geo.village) village = { name: best.name, label: bearingLabel(p.x, p.z, best.x, best.z) };
      }
    }
    const moorstead = fog ? null : { label: bearingLabel(p.x, p.z, geo.village.x, geo.village.z) };
    this.ui.toast(shelterToast({ fog, shelter, village, moorstead }), 8000);
  }

  // ---------------- t' rambler's sketchbook (P) ----------------
  // Frame t' view an' save it: the WebGL canvas is the scene alone (the HUD is
  // separate DOM, so it never appears). preserveDrawingBuffer stays OFF (it costs
  // perf every frame) — instead we render one fresh frame synchronously an' read
  // the buffer before the browser clears it, the standard Three.js capture trick.
  takeSketch() {
    if (!this.world || !this.player || this.state !== 'playing') return;
    try {
      this.renderer.render(this.scene, this.camera);
      const p = this.player.pos;
      const place = this.world.gen.geo.locationName(p.x, p.z) || '';
      const day = this.sky ? this.sky.day : 1;
      const a = document.createElement('a');
      a.href = composeSketch(this.renderer.domElement, place, day);
      a.download = sketchFilename(place, day);
      a.click();
      this.ui.toast('\u{1F4F8} Tha’s sketched t’ view — saved to thi downloads.', 5000);
    } catch (e) {
      reportQuiet('sketch', e);
      this.ui.toast('T’ sketchbook page tore — try again in a breath.', 4000);
    }
  }

  // ---------------- sleeping ----------------
  // Neet passes if tha can find shelter: a roof ower thi head an' a flame
  // near — any house, t' pub, a moor shelter, or a cottage tha's built thissen.
  canSleepHere() {
    if (!this.world || !this.sky.isNight()) return 'not night';
    const p = this.player.pos;
    const px = Math.floor(p.x), py = Math.floor(p.y + (this.player.eye || 1.6)), pz = Math.floor(p.z);
    let roofed = false;
    for (let y = py + 1; y <= Math.min(HEIGHT - 1, py + 14); y++) {
      if (isSolid(this.world.getBlock(px, y, pz))) { roofed = true; break; }
    }
    if (!roofed) return 'no roof';
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -6; dz <= 6; dz++) {
          const id = this.world.getBlock(px + dx, py + dy, pz + dz);
          if (id === B.TORCH || id === B.LANTERN) return 'ok';
        }
      }
    }
    return 'no light';
  }

  trySleep() {
    if (this.state !== 'playing') return;
    if (!this.sky.isNight()) { this.ui.toast('Tha can only sleep of a neet.'); return; }
    const why = this.canSleepHere();
    if (why !== 'ok') {
      this.ui.toast(why === 'no roof'
        ? 'Nowhere to kip here — find a roof: a house, t’ pub, or a moor shelter.'
        : 'Too dark an’ cold to settle — get thissen near a torch or lantern first.', 5000);
      return;
    }
    this.state = 'sleeping';
    this.clearKeys();
    this.mouseDown = [false, false, false];
    this.sleepT = 0;
    this.ui.sleepScreen.classList.remove('hidden');
    if (this.netActive && this.net && this.net.connected) {
      this.ui.sleepText.textContent = 'waiting for t’ others to kip down...';
      this.net.sendSleep(true);
    } else {
      this.ui.sleepText.textContent = '';
    }
  }

  cancelSleep(msg) {
    if (this.state !== 'sleeping') return;
    this.state = 'playing';
    this.ui.sleepScreen.classList.add('hidden');
    if (this.netActive && this.net && this.net.connected) this.net.sendSleep(false);
    if (msg) this.ui.toast(msg, 4000);
  }

  finishWake() {
    this.state = 'playing';
    this.ui.sleepScreen.classList.add('hidden');
    const p = this.player;
    p.health = 20;
    p.hunger = Math.max(0, p.hunger - 3);
    p.air = 10;
    this.ui.toast('Tha wakes wi’ t’ dawn, right as rain — an’ a bit peckish.', 5000);
  }

  // relay says t' neet has passed for t' whole room (time lands separately)
  onWake() {
    if (this.state === 'sleeping') this.finishWake();
  }

  onSleepers(n, total) {
    if (this.state === 'sleeping') {
      this.ui.sleepText.textContent = `waiting for t’ others to kip down... (${n}/${total} abed)`;
    } else if (n > 0 && this.sky.isNight() && this.state === 'playing') {
      const now = performance.now() / 1000;
      if (!this._sleepNag || now - this._sleepNag > 60) {
        this._sleepNag = now;
        this.ui.toast(`${n} o’ ${total} are abed — find a roof an’ a light, press <b>N</b>, an’ t’ neet will pass for all.`, 8000);
      }
    }
  }

  // ---------------- t' shared moor ----------------
  async joinShared() {
    const { strSeed: ss, hash2i } = await import('./noise.js');
    this.netActive = true;
    // each group gets its own moor: t' room comes frae thi account
    // ('moor' = t' original world; owt else gets its own seed an' all)
    await this.refreshAuth();
    let room = ((this.auth && this.auth.room) || 'moor').toLowerCase();
    // t' warden may walk onto any world — bairns or adults, not just their own
    if (this.isAdmin()) room = (await this.ui.pickWorld(room)) || room;
    this.netRoom = room;
    // the shared moor, the bairns' world AND the free kids' world all play the real c.1900 NYM
    // world. baseRoom() means shards (bairns-2, bairns-free-2) share their world's terrain too.
    const rb = baseRoom(room);
    // moor, the bairns world, and every free world share the real c.1900 NYM seed; tying this to
    // rooms.js (isBairnsRoom/isFreeRoom) means a future free room can't desync from its terrain.
    const seedStr = (rb === 'moor' || isBairnsRoom(rb) || isFreeRoom(rb) || rb === 'moors1900') ? 't-moors-1900'
      : 't-shared-moor:' + rb;
    this.startWorld(ss(seedStr), null, new Map());
    // folk wake spread across t' villages, same one each visit
    const who = (this.auth && this.auth.acct) || this.devicePid();
    const idx = Math.floor(hash2i(ss(who), 7, 99) * this.world.gen.geo.villages.length);
    this.spawn = this.world.gen.findSpawnAt(idx);
    this.player.pos = { ...this.spawn };
    this.loadNetStrongboxes(); // thi stashes on this moor, frae this browser's memory (local-only v1)
    this.ui.toast(`Walking up onto <b>T\u2019 Shared Moor</b> \u2014 tha wakes in <b>${this.spawn.village}</b>. Builds, pockets an\u2019 ventures all keep. <b>T</b> to talk (speech carries ~60m).`, 10000);
    this.enforceBairnRules();
  }

  async connectNet() {
    this.net = new Net(this);
    try {
      await this.net.connect(
        this.netRoom || 'moor',
        (this.auth && this.auth.acct ? 'a' + this.auth.acct : this.devicePid()).slice(0, 40),
        this.player.name || (this.auth && this.auth.name) || 'rambler',
        this.auth && this.auth.token ? this.auth.token : undefined,
      );
      // pick up where tha left off: pockets, ventures, an' thi spot on t' map
      const sv = this.net.savedState;
      if (sv && sv.player) {
        this.player.deserialize(sv.player);
        this.entities.restorePets(this.player.pets, this.player); // thi kept beasts come back to heel
        this.quests.deserialize(sv.quests);
        this.ui.invDirty = true;
        this.ui.toast('Welcome back to t\u2019 shared moor \u2014 thi things are as tha left \u2019em.', 6000);
      } else {
        this.ui.toast('Tha\u2019s on t\u2019 shared moor. Whoever else is out here, tha\u2019ll see \u2019em.', 6000);
      }
      this.ensureDaemon();      // thi lifelong first-pet companion is always at thi heel, any moor, any epoch
      this.enforceBairnRules(); // re-assert after t' relay restores pockets
    } catch {
      this.ui.toast('Couldn\u2019t reach t\u2019 shared moor \u2014 playing it alone for now.', 6000);
    }
  }

  // The daemon \u2014 thi first-ever companion \u2014 is bound to thi token and walks every moor with thee,
  // come epoch reset or no. The relay sends her on connect regardless of thi pocket's state; make
  // sure she's at thi heel even if the rest of the save was withheld or wiped.
  ensureDaemon() {
    // Prefer the relay's authoritative daemon (shared moor); fall back to the one carried on the
    // login token, so Bess is at thi heel in single-player ("Carry On"/"New") worlds too — any moor.
    const d = (this.net && this.net.daemon) || (this.auth && this.auth.daemon);
    if (!d || !d.kind || !d.name) return;
    this.player.pets = this.player.pets || [];
    if (this.player.pets.some(p => p && p.name === d.name && p.kind === d.kind)) return; // already restored from the save
    const rec = { kind: d.kind, name: d.name, stay: false, daemon: true };
    this.player.pets.unshift(rec);
    this.entities.restorePets([rec], this.player); // spawn just the daemon, at thi heel
    this.ui.toast(`<b>${d.name}</b> pads up to thi side. Thi <b>daemon</b> walks every moor with thee.`, 6000);
  }

  openNetChat() {
    this.state = 'netchat';
    this.clearKeys();
    this.ui.netChatRow.classList.remove('hidden');
    setTimeout(() => this.ui.netChatInput.focus(), 30);
  }

  closeNetChat() {
    this.ui.netChatInput.value = '';
    this.ui.netChatRow.classList.add('hidden');
    this.state = 'playing';
    this.renderer.domElement.focus?.();
  }

  // ---------------- t' Moors Railway ----------------
  // ONE train, running t' line forever on t' shared clock — same for every
  // player, so tha can watch her steam past frae out on t' moor.
  // per-leg running times frae t' real alignment: trapezoid speed profile
  // ower t' spline's chainage — long legs genuinely take longer
  railLegs() {
    const geo = this.world.gen.geo;
    if (this._legGeo === geo) return this._legs;
    const path = geo.railPath();
    const legs = [];
    for (let i = 0; i < path.stationS.length - 1; i++) {
      const len = path.stationS[i + 1] - path.stationS[i];
      legs.push({ len, t: legTime(len), s0: path.stationS[i], s1: path.stationS[i + 1] });
    }
    this._legGeo = geo;
    this._legs = legs;
    return legs;
  }

  trainSchedule(nowSec) {
    const geo = this.world.gen.geo;
    const st = geo.railway();
    const legs = this.railLegs();
    const n = st.length;
    const oneway = legs.reduce((a, l) => a + l.t, 0) + n * DWELL_T;
    const now = nowSec !== undefined ? nowSec : Date.now() / 1000;
    const dir = Math.floor(now / oneway) % 2;
    const idx = k => (dir === 0 ? k : n - 1 - k);
    const leg = k => legs[dir === 0 ? k : n - 2 - k]; // t' leg run after t' k-th call
    let tt = now % oneway;
    for (let k = 0; k < n; k++) {
      if (tt < DWELL_T) {
        const sAt = geo.railPath().stationS[idx(k)];
        const sp = geo.samplePos(sAt);
        return { mode: 'dwell', i: idx(k), dwellLeft: DWELL_T - tt, dir, s: sAt, x: sp.x, z: sp.z };
      }
      tt -= DWELL_T;
      if (k < n - 1) {
        const L = leg(k);
        if (tt < L.t) {
          const run = runProfile(L.len, tt);
          // dir 0 runs up t' chainage, dir 1 back down it
          const s = dir === 0 ? L.s0 + run.dist : L.s1 - run.dist;
          const sp = geo.samplePos(s);
          return { mode: 'run', from: idx(k), to: idx(k + 1), frac: run.dist / L.len, dir,
                   s, x: sp.x, z: sp.z, speed: run.v + 0.05 };
        }
        tt -= L.t;
      }
    }
    return { mode: 'dwell', i: idx(n - 1), dwellLeft: 1, dir, s: geo.railPath().stationS[idx(n - 1)] };
  }

  // legs for ANY line's spline (the main line uses the cached railLegs above)
  railLegsFor(path) {
    const legs = [];
    for (let i = 0; i < path.stationS.length - 1; i++) {
      const len = path.stationS[i + 1] - path.stationS[i];
      legs.push({ len, t: legTime(len), s0: path.stationS[i], s1: path.stationS[i + 1] });
    }
    return legs;
  }

  // the schedule for ANY line (path + its station stops) — same trapezoid profile + shared clock,
  // so every branch train runs forever in step too. (The main line keeps trainSchedule above.)
  trainScheduleFor(path, stations, nowSec) {
    const geo = this.world.gen.geo;
    const legs = this.railLegsFor(path);
    const n = stations.length;
    if (n < 2 || !legs.length) return { mode: 'dwell', i: 0, dwellLeft: 1, dir: 0, s: path.stationS[0] || 0 };
    const oneway = legs.reduce((a, l) => a + l.t, 0) + n * DWELL_T;
    const now = nowSec !== undefined ? nowSec : Date.now() / 1000;
    const dir = Math.floor(now / oneway) % 2;
    const idx = k => (dir === 0 ? k : n - 1 - k);
    const leg = k => legs[dir === 0 ? k : n - 2 - k];
    let tt = now % oneway;
    for (let k = 0; k < n; k++) {
      if (tt < DWELL_T) {
        const sAt = path.stationS[idx(k)]; const sp = geo.samplePosOn(path, sAt);
        return { mode: 'dwell', i: idx(k), dwellLeft: DWELL_T - tt, dir, s: sAt, x: sp.x, z: sp.z };
      }
      tt -= DWELL_T;
      if (k < n - 1) {
        const L = leg(k);
        if (tt < L.t) {
          const run = runProfile(L.len, tt);
          const s = dir === 0 ? L.s0 + run.dist : L.s1 - run.dist;
          const sp = geo.samplePosOn(path, s);
          return { mode: 'run', from: idx(k), to: idx(k + 1), frac: run.dist / L.len, dir, s, x: sp.x, z: sp.z, speed: run.v + 0.05 };
        }
        tt -= L.t;
      }
    }
    return { mode: 'dwell', i: idx(n - 1), dwellLeft: 1, dir, s: path.stationS[idx(n - 1)] };
  }

  // seconds till t' train next calls at station i (Infinity if not found in t' next 30 min)
  nextCallAt(i) {
    const now = Date.now() / 1000;
    for (let dt = 0; dt < 1800; dt += 2) {
      const s = this.trainSchedule(now + dt);
      if (s.mode === 'dwell' && s.i === i) return dt;
    }
    return Infinity;
  }

  fmtMins(s) {
    if (!isFinite(s)) return 'no train due';
    return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
  }

  // The next `want` timetabled calls at stops[idx]: [{ dest, eta, dist }], soonest first.
  // eta in seconds (0 = she's stood in now); dest = the terminus she departs TOWARD (at the
  // end of a run she turns about, so the flip's folded in); dist = honest chainage to it.
  // Scans a full pingpong cycle like roster._nextTrainCall — a terminus is only called at
  // once per round trip, so a half-hour window would miss it there.
  nextDeparturesAt(schedFn, stops, stationS, idx, want = 2) {
    const now = Date.now() / 1000, n = stops.length, out = [];
    let inDwell = false;
    for (let t = 0; t < 1900 && out.length < want; t += 2) {
      const s = schedFn(now + t);
      const here = s.mode === 'dwell' && s.i === idx;
      if (here && !inDwell) {
        const depDir = (s.dir === 0 && idx === n - 1) ? 1 : (s.dir === 1 && idx === 0) ? 0 : s.dir;
        const di = depDir === 0 ? n - 1 : 0;
        out.push({ dest: stops[di].name, eta: t, dist: Math.abs(stationS[di] - stationS[idx]) | 0 });
      }
      inDwell = here;
    }
    return out;
  }

  // Next departures for a station by NAME, on whichever line carries it (main or
  // branch) — the one lookup chat intel and the chip both use. Null = no line calls
  // there (harmless: the caller shows nowt rather than inventing a time).
  depsForStation(name, want = 2) {
    const geo = this.world && this.world.gen && this.world.gen.geo;
    if (!geo) return null;
    const main = geo.railway();
    const idx = main.findIndex(s => s.name === name);
    if (idx >= 0) return this.nextDeparturesAt(t => this.trainSchedule(t), main, geo.railPath().stationS, idx, want);
    if (geo.realWorld) {
      this._ensureBranchTrains();
      for (const bt of (this.branchTrains || [])) {
        const bi = bt.stations.findIndex(s => s.name === name);
        if (bi >= 0 && bt.stations.length >= 2 && bt.path.stationS.length === bt.stations.length) {
          return this.nextDeparturesAt(t => this.trainScheduleFor(bt.path, bt.stations, t), bt.stations, bt.path.stationS, bi, want);
        }
      }
    }
    return null;
  }

  // ---- the station departure chip (HUD) ----
  // Stood on/near a platform, the player sees WHAT's due, WHERE she's bound an' the fare —
  // not just a countdown once she's close. ~1Hz, main line AND branch lines; rendered by
  // ui.updateTracker in the quest-chip idiom (an' hidden by it off the 'playing' state).
  updateStationChip(dt) {
    this._stnChipT = (this._stnChipT ?? 0) - dt;
    if (this._stnChipT > 0) return;
    this._stnChipT = 1;
    const ui = this.ui;
    if (this.state !== 'playing' || !this.world || this.player.dead || this.peekingMap) { ui.stationChipHTML = ''; return; }
    const geo = this.world.gen.geo;
    const st = geo.nearStation(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z), 16);
    if (!st) { ui.stationChipHTML = ''; return; }
    // Info economy: times are learned from a local, not read off thin air.
    if (!this.player.creative && !this.freeWorld() && !this.player.knownTimes[st.name]) {
      this.ui.stationChipHTML = stationChipUnknownHTML(st.name); return;
    }
    // whose timetable calls here: the main line, else the branch this station serves
    const deps = this.depsForStation(st.name, 2);
    if (!deps) { ui.stationChipHTML = ''; return; }
    // the fare to the first departure's destination — the SAME sum openStation charges
    const fare = deps.length
      ? (this.player.creative ? 0 : Math.max(1, Math.min(4, Math.ceil(deps[0].dist / 400))))
      : null;
    ui.stationChipHTML = stationChipHTML(st.name, deps, fare);
  }

  // A works (calcining kiln / blast furnace): convert held raw up the chain for a toll, then ship
  // the processed good down the line to the market that pays best (Teesside for calcined ore).
  openWorks(w) {
    this.state = 'board';
    this.clearKeys();
    this.mouseDown = [false, false, false];
    document.exitPointerLock?.();
    const ui = this.ui, p = this.player, eco = this.economy;
    ui.boardPanel.innerHTML = '';
    ui.el('div', 'inv-title', ui.boardPanel, w.name);
    const verb = { kiln: 'Calcine', furnace: 'Smelt', jetshop: 'Carve' }[w.kind] || 'Work';
    ui.el('div', 'r-needs', ui.boardPanel, {
      kiln: 'Roast raw ironstone in t’ kilns — she draws off lighter an’ worth more, ready for t’ furnace or t’ Teesside train.',
      furnace: 'Smelt calcined ore in t’ blast furnace — she runs out as pig iron for t’ market towns.',
      jetshop: 'Carve raw Whitby jet at t’ bench into mournin’ jewellery — worth a deal more than t’ rough stone.',
    }[w.kind] || '');
    const list = ui.el('div', 'recipes board-list', ui.boardPanel);
    const r = convertAt(w, p.countItem(w.in), eco.balance);
    const crow = ui.el('div', 'recipe quest-row', list);
    if (r.ok) {
      crow.innerHTML = `<div class="r-name"><b>${verb} ${r.used}× ${itemName(w.in)} → ${r.made}× ${itemName(w.out)}</b><br><span class="r-needs">toll <b>${eco.format(r.toll)}</b></span></div>`;
      const cb = ui.el('button', 'mc chat-btn trade-btn', crow, verb);
      cb.addEventListener('click', () => {
        if (!eco.spend(r.toll)) { ui.toast('Tha’s not the brass for t’ toll.'); return; }
        p.removeItem(w.in, r.used); p.addItem(w.out, r.made);
        ui.invDirty = true;
        ui.toast(`${verb}d <b>${r.made}× ${itemName(w.out)}</b>.`, 4000);
        this.openWorks(w);
      });
    } else {
      crow.innerHTML = `<div class="r-name"><span class="r-needs">${r.reason === 'short' ? `Tha needs at least ${w.ratio[0]}× ${itemName(w.in)}.` : r.reason === 'poor' ? `T’ toll’s ${eco.format(w.toll)} — tha’s short.` : 'Nowt to work just now.'}</span></div>`;
    }
    const haveOut = p.countItem(w.out);
    if (haveOut > 0) {
      const names = this.world.gen.geo.villages.map(v => v.name);
      const best = bestMarket(w.out, w.town, names, eco.standing());
      if (best) {
        const shipN = Math.min(haveOut, FREIGHT_ALLOWANCE);
        const srow = ui.el('div', 'recipe quest-row', list);
        srow.innerHTML = `<div class="r-name"><b>Ship ${shipN}× ${itemName(w.out)} → ${best.village}</b><br><span class="r-needs">fetches <b>${eco.format(best.perUnit * shipN)}</b> when she lands</span></div>`;
        const sb = ui.el('button', 'mc chat-btn trade-btn', srow, 'Send it');
        sb.addEventListener('click', () => {
          const res = eco.bookShipment([[w.out, shipN]], best.village, w.town, this.sky.day + this.sky.time);
          if (res.ok) { ui.invDirty = true; ui.toast(`<b>${shipN}× ${itemName(w.out)}</b> away to ${best.village} — <b>${eco.format(res.brass)}</b> when she lands.`, 5000); this.openWorks(w); }
          else ui.toast(`Couldn’t book that consignment (${res.why}).`);
        });
      }
    }
    const close = ui.el('button', 'mc', ui.boardPanel, 'Leave the works');
    close.addEventListener('click', () => this.closeScreens());
    ui.show('boardScreen');
  }

  openStation(st, which = 'departures') {
    this.state = 'board';
    this.clearKeys();
    this.mouseDown = [false, false, false];
    document.exitPointerLock?.();
    const ui = this.ui;
    ui.boardPanel.innerHTML = '';
    const stations = this.world.gen.geo.railway();
    const stIdx = stations.indexOf(st);

    // Two SEPARATE boards — pick one. (Was one muddled screen; now clearly split + labelled.)
    const tabs = ui.el('div', 'admin-btns', ui.boardPanel);
    tabs.style.marginBottom = '10px';
    const mkTab = (k, label) => {
      const b = ui.el('button', 'mc chat-btn' + (which === k ? ' done-btn' : ''), tabs, label);
      if (which !== k) b.addEventListener('click', () => this.openStation(st, k));
    };
    mkTab('departures', '🚂 Departures');
    mkTab('market', '💰 Sell Goods Here');

        if (!this.player.stationSellHinted) {
      this.player.stationSellHinted = true;
      const hint = ui.el('div', 'r-needs', ui.boardPanel);
      hint.style.cssText = 'background:rgba(216,185,90,0.12);border:1px solid rgba(216,185,90,0.4);border-radius:4px;padding:7px 10px;margin-bottom:8px;';
      hint.innerHTML = '💡 <b>Every station on t’ line buys goods</b> — open <b>Sell Goods Here</b> to ship thi harvest, stone, or ore to wherever pays best.';
    }

    if (which === 'market') {
      ui.el('div', 'inv-title', ui.boardPanel, `${st.name} — Sell Goods Here`);
      const shippableHint = this.economy.tradeableHeld();
      const bestNote = shippableHint.length > 0
        ? 'Best prices shown — t’ brass lands when t’ train delivers.'
        : 'Ship goods down t’ line to t’ market that pays best — t’ brass lands when t’ train brings ’em in.';
      ui.el('div', 'r-needs', ui.boardPanel, `<b>Sell at this station.</b> ${bestNote}`);
      const shippable = this.economy.tradeableHeld();
      const inTransit = this.player.shipments;
      if (inTransit.length) {
        ui.el('div', 'r-needs', ui.boardPanel, 'On t’ way: ' + inTransit.map(sh => `${sh.dest} — <b>${this.economy.format(sh.brass)}</b>`).join('; '));
      }
      if (!shippable.length) {
        ui.el('div', 'r-needs', ui.boardPanel, 'Tha’s nowt to ship just now — bring summat tha’s mined, grown or gathered.');
      } else {
        const shipList = ui.el('div', 'recipes board-list', ui.boardPanel);
        const villageNames = stations.map(s => s.name);
        const s = this.economy.standing();
        for (const { id, n } of shippable) {
          const best = bestMarket(id, st.name, villageNames, s);
          if (!best) continue;
          const shipN = Math.min(n, FREIGHT_ALLOWANCE);
          const total = best.perUnit * shipN;
          const row = ui.el('div', 'recipe quest-row', shipList);
          const capNote = n > FREIGHT_ALLOWANCE ? ` (t’ wagon holds ${FREIGHT_ALLOWANCE} at once)` : '';
          row.innerHTML = `<div class="r-name"><b>${shipN}× ${itemName(id)} → ${best.village}</b><br><span class="r-needs">fetches <b>${this.economy.format(total)}</b> there${capNote}</span></div>`;
          const sb = ui.el('button', 'mc chat-btn trade-btn', row, 'Send it');
          sb.addEventListener('click', () => {
            const r = this.economy.bookShipment([[id, shipN]], best.village, st.name, this.sky.day + this.sky.time);
            if (r.ok) {
              this.ui.invDirty = true;
              this.ui.toast(`<b>${shipN}× ${itemName(id)}</b> away to ${best.village} — <b>${this.economy.format(r.brass)}</b> when she lands.`, 5000);
              this.openStation(st, 'market');
            } else {
              this.ui.toast(`Couldn’t book that consignment (${r.why}).`);
            }
          });
        }
      }
      const closeM = ui.el('button', 'mc', ui.boardPanel, 'Not today, ta');
      closeM.addEventListener('click', () => this.closeScreens());
      ui.show('boardScreen');
      return;
    }

    const sched = this.trainSchedule();
    const hereNow = sched.mode === 'dwell' && sched.i === stIdx;
    ui.el('div', 'inv-title', ui.boardPanel, `${st.name} Station \u2014 T\u2019 Moors Railway`);
    const eta = this.nextCallAt(stIdx);
    ui.el('div', 'r-needs', ui.boardPanel, hereNow
      ? `<b style="color:#9ec27a">She\u2019s stood at t\u2019 platform now</b> \u2014 ${Math.round(sched.dwellLeft)}s afore she\u2019s away. Book on an\u2019 tha\u2019s straight aboard.`
      : !isFinite(eta)
        ? `No train due on this line in t\u2019 next half-hour.`
        : `Next train calls in <b style="color:#d8b95a">${this.fmtMins(eta)}</b>. Book on, then be stood on t\u2019 platform when she comes in.`);
    const list = ui.el('div', 'recipes board-list', ui.boardPanel);
    // honest distances: chainage along t' actual alignment, curves an' all
    const stS = this.world.gen.geo.railPath().stationS;
    const lineDist = (a, b) => Math.abs(stS[stations.indexOf(b)] - stS[stations.indexOf(a)]);
    const myCoal = this.player.countItem(I.COAL_LUMP);
    for (const dest of stations) {
      if (dest === st) continue;
      const row = ui.el('div', 'recipe quest-row', list);
      const d = lineDist(st, dest) | 0;
      const fare = this.player.creative ? 0 : Math.max(1, Math.min(4, Math.ceil(d / 400)));
      row.innerHTML = `<div class="r-name"><b>${dest.name}</b><br><span class="r-needs">${d}m down t\u2019 line \u2014 fare: ${fare ? fare + '\u00d7 coal' : 'free (creative)'} (tha\u2019s got ${myCoal})</span></div>`;
      const b = ui.el('button', 'mc chat-btn', row, 'All aboard');
      b.addEventListener('click', () => {
        if (fare > 0 && this.player.countItem(I.COAL_LUMP) < fare) {
          this.ui.toast(`T\u2019 engine eats coal, love \u2014 fare\u2019s ${fare} lump${fare > 1 ? 's' : ''} an\u2019 tha\u2019s got ${this.player.countItem(I.COAL_LUMP)}.`);
          return;
        }
        if (fare > 0) { this.player.removeItem(I.COAL_LUMP, fare); this.ui.invDirty = true; }
        this.pendingRide = { stIdx, destIdx: stations.indexOf(dest), fare, warned: {} };
        this.closeScreens();
        const sNow = this.trainSchedule();
        if (sNow.mode === 'dwell' && sNow.i === stIdx) {
          this.ui.toast(`Booked for <b>${dest.name}</b> \u2014 straight aboard wi\u2019 thee!`, 4000);
        } else {
          this.ui.toast(`Booked for <b>${dest.name}</b>. T\u2019 train calls in <b>${this.fmtMins(this.nextCallAt(stIdx))}</b> \u2014 be on t\u2019 platform.`, 6000);
        }
      });
    }
    // (Goods shipping now lives on its own Market board — see the which === 'market' branch above.)
    // a goods consignment waiting to be shifted — haul it by driving the engine
    {
      const dests = stations.filter(d => d !== st);
      const gdest = dests[(stIdx * 7 + 3) % dests.length];
      const gdi = stations.indexOf(gdest);
      const gd = lineDist(st, gdest) | 0;
      const reward = Math.max(2, Math.ceil(gd / 300) + 1);
      const grow = ui.el('div', 'recipe quest-row', list);
      grow.innerHTML = `<div class="r-name"><b>\u{1F4E6} Goods for ${gdest.name}</b><br><span class="r-needs">${gd}m down t’ line — take the regulator an’ haul her there for <b>${reward}× coal</b></span></div>`;
      const laden = this.pendingGoods || (this.drive && this.drive.goods);
      const gb = ui.el('button', 'mc chat-btn', grow, laden ? 'Already laden' : 'Load the wagon');
      if (!laden) gb.addEventListener('click', () => {
        this.pendingGoods = { dest: gdi, reward, from: stIdx };
        this.closeScreens();
        this.ui.toast(`<b>Consignment loaded for ${gdest.name}.</b> Take the regulator an’ haul her down t’ line.`, 5000);
      });
    }
    if (hereNow) {
      const drv = ui.el('button', 'mc chat-btn', ui.boardPanel, '🚂 Take the regulator — drive her yourself');
      drv.style.marginTop = '8px';
      drv.addEventListener('click', () => this.enterDrive(stIdx));
    }
    const close = ui.el('button', 'mc', ui.boardPanel, 'Not today, ta');
    close.addEventListener('click', () => this.closeScreens());
    ui.show('boardScreen');
  }

  // ---- Slice 2: registered farm status ----
  // Head of penned stock the player keeps (sheep for now; Slice 4 widens the kinds).
  farmHeadCount() {
    return (this.player.pets || []).filter(p => {
      if (!p) return false;
      const t = MOB_TYPES[p.kind];
      return t && t.droveable;
    }).length;
  }

  // Is the player stood at the market town (Moorstead in v1, Pickering in the real moors)?
  atMarketTown() {
    const geo = this.world.gen.geo;
    const name = marketTownName(geo.realWorld);
    const m = geo.villages.find(v => v.name.toLowerCase() === name.toLowerCase());
    if (!m) return false;
    const p = this.player.pos;
    return Math.hypot(m.x - p.x, m.z - p.z) <= 70;
  }

  // Register the farm: a deliberate, paid choice at the market town board. Returns true on success.
  registerFarm() {
    const mt = marketTownName(this.world.gen.geo.realWorld);
    const r = farmRegisterCheck({
      head: this.farmHeadCount(),
      registered: this.player.farmStatus.registered,
      brass: this.economy.balance,
      atMarket: this.atMarketTown(),
    });
    if (!r.ok) {
      const msg = r.reason === 'already' ? 'Tha&rsquo;s already a registered farmer.'
        : r.reason === 'short' ? `Tha needs <b>${r.need}</b> head penned to register &mdash; tha&rsquo;s ${r.have}.`
        : r.reason === 'away' ? `Tha registers a farm at <b>${mt}</b>&rsquo;s notice board.`
        : `T&rsquo; charter&rsquo;s <b>${this.economy.format(r.fee)}</b> &mdash; tha&rsquo;s not got it just yet.`;
      this.ui.toast(msg, 5000);
      return false;
    }
    this.economy.spend(CHARTER_FEE);
    this.player.farmStatus.registered = true;
    this.ui.toast(`🌾 <b>Tha&rsquo;s a registered farmer o&rsquo; ${mt} parish now!</b>`, 7000);
    if (this.milestones) this.milestones.fire('farm_registered');
    if (this.saveNow) this.saveNow(false);
    return true;
  }

  // ---- Slice 3: the drove ----
  // Muster the penned stock near thee into a mobile, driveable herd (KeyG). Registered farmers only;
  // needs a working dog to actually drive them. Flips only the LIVE mobs — the saved pets records keep
  // stay+home, so a reload reverts an in-progress drove to penned (safest).
  musterFlock() {
    const mt = marketTownName(this.world.gen.geo.realWorld);
    if (!this.player.farmStatus.registered) {
      this.ui.toast(`Tha registers a farm at <b>${mt}</b> first, then tha can drove thi flock.`, 5000);
      return;
    }
    const dog = this.entities.mobs.find(m => m && !m.dead && m.owner && m.type === 'dog');
    if (!dog) { this.ui.toast('Tha needs a <b>working dog</b> to drove a flock.', 4000); return; }
    const p = this.player.pos;
    let n = 0;
    for (const m of this.entities.mobs) {
      if (!m || m.dead || !m.owner || !MOB_TYPES[m.type]?.droveable || !m.stay) continue;
      if (Math.hypot(m.pos.x - p.x, m.pos.z - p.z) > 20) continue;
      m.stay = false; m.droving = true; m.herding = false; n++;
    }
    if (!n) { this.ui.toast('No penned stock close by to muster. Stand by thi fold.', 4000); return; }
    this.ui.toast(`🌱 <b>Mustered ${n} head o’ stock.</b> Drove ‘em to <b>${mt}’s mart</b> wi’ thi dog, and keep ‘em bunched.`, 6000);
  }

  // Droving sheep within the mart yard (near thee). Used by the board to offer the sale.
  droveHeadNear() {
    const p = this.player.pos;
    return this.entities.mobs.filter(m => m && !m.dead && m.droving && MOB_TYPES[m.type]?.droveable &&
      Math.hypot(m.pos.x - p.x, m.pos.z - p.z) <= 25);
  }

  // Sell every droved head in the yard: pays per head, leads them off, drops them from thi stock.
  sellDrove() {
    const mt = marketTownName(this.world.gen.geo.realWorld);
    if (!this.atMarketTown()) { this.ui.toast(`Tha sells a droved flock at <b>${mt}’s mart</b>.`, 4000); return false; }
    const herd = this.droveHeadNear();
    if (!herd.length) { this.ui.toast('Tha’s no flock in t’ yard to sell. Drove ’em in first.', 4000); return false; }
    const pay = droveValue(herd, this.economy.standing());
    for (const m of herd) {
      if (this.player.pets) this.player.pets = this.player.pets.filter(p => p.name !== m.petName);
      m.dead = true; this.entities.scene.remove(m.model.group);
    }
    this.economy.earn(pay);
    this.ui.toast(`💷 <b>Sold ${herd.length} head at ${mt} mart for ${this.economy.format(pay)}.</b>`, 7000);
    if (this.milestones) this.milestones.fire('first_drove');
    if (this.saveNow) this.saveNow(false);
    return true;
  }

  // Sell a Saddleback Pig individually (sty stock)
  sellPig(name) {
    const mt = marketTownName(this.world.gen.geo.realWorld);
    if (!this.atMarketTown()) { this.ui.toast(`Tha sells a pig at <b>${mt}</b>.`, 4000); return false; }
    const rec = (this.player.pets || []).find(p => p.name === name && p.kind === 'pig');
    if (!rec) { this.ui.toast('Tha’s no pig o’ that name to sell.', 4000); return false; }
    const mob = this.entities.mobs.find(m => m && !m.dead && m.petName === name && m.type === 'pig');
    if (mob) {
      mob.dead = true;
      this.entities.scene.remove(mob.model.group);
    }
    this.player.pets = this.player.pets.filter(p => p.name !== name);
    const pay = this.economy.livestockPrice('pig', this.economy.standing());
    this.economy.earn(pay);
    this.ui.toast(`💷 <b>Sold Saddleback Pig ${name} for ${this.economy.format(pay)}.</b>`, 7000);
    if (this.saveNow) this.saveNow(false);
    return true;
  }

  // ---- Living Moor Slice 2: deeds — stake a plot, keep it with upkeep (effects land in Slices 3-4) ----
  stakeClaim(radius = 8, free = false) {
    // necessity spine: t' parish registers no deed for a stranger — a friend's
    // word (vouches) or Respected standing first. Free worlds stay relaxed.
    if (!this.freeWorld() && !this.player.creative && !(this.player.vouches || []).length && this.quests.standingIndex() < 3) {
      this.ui.toast('T&rsquo; parish won&rsquo;t register a deed for a stranger &mdash; ask a friend to vouch for thee first.', 6000);
      return false;
    }
    const fee = deedFee('claim', radius);
    if (!free && !this.economy.canAfford(fee)) { this.ui.toast(`A claim here is <b>${this.economy.format(fee)}</b> &mdash; tha&rsquo;s not the brass.`, 5000); return false; }
    const p = this.player.pos, cx = Math.round(p.x), cz = Math.round(p.z);
    if (this.world.deeds.some(d => !d.lapsedDay && Math.hypot(d.cx - cx, d.cz - cz) < d.radius + radius)) {
      this.ui.toast('That overlaps a claim already staked here.', 4000); return false;
    }
    if (!free) this.economy.spend(fee);
    this.world.deeds.push(makeDeed('claim', this.player.name || '', cx, cz, this.sky.day, { radius, seq: this.world.deeds.length }));
    if (this.net) this.net.sendDeeds(this.world.deeds);
    this.ui.toast(`🪧 <b>Claim staked</b>${free ? ' wi&rsquo; thi starting token' : ''} &mdash; ${radius}m round, paid up a week. Mind t&rsquo; upkeep or it lapses.`, 6000);
    if (this.saveNow) this.saveNow(false);
    return true;
  }

  stakeMine(cx, cz, depth = 10, free = false) {
    // necessity spine: same vouch gate as stakeClaim — no licence for a stranger
    if (!this.freeWorld() && !this.player.creative && !(this.player.vouches || []).length && this.quests.standingIndex() < 3) {
      this.ui.toast('T&rsquo; parish won&rsquo;t register a deed for a stranger &mdash; ask a friend to vouch for thee first.', 6000);
      return false;
    }
    const fee = deedFee('mine', 5, depth);
    if (!free && !this.economy.canAfford(fee)) { this.ui.toast(`A mine license here is <b>${this.economy.format(fee)}</b> &mdash; tha&rsquo;s not the brass.`, 5000); return false; }
    if (this.world.deeds.some(d => d.kind === 'mine' && !d.lapsedDay && Math.hypot(d.cx - cx, d.cz - cz) < d.radius + 5)) {
      this.ui.toast('Too close to another active mine.', 4000); return false;
    }
    if (!free) this.economy.spend(fee);
    this.world.deeds.push(makeDeed('mine', this.player.name || '', cx, cz, this.sky.day, { depth, seq: this.world.deeds.length }));
    if (this.net) this.net.sendDeeds(this.world.deeds);
    this.ui.toast(`🪧 <b>Mining licence registered</b>${free ? ' wi&rsquo; thi starting token' : ''} &mdash; 5m radius, depth ${depth}m. Deep digging cleared.`, 6000);
    if (this.saveNow) this.saveNow(false);
    return true;
  }

  upgradeMine(id) {
    const d = this.world.deeds.find(x => x.id === id);
    if (!d || d.kind !== 'mine') return false;
    if (d.depth >= 60) { this.ui.toast("Mine is already at max depth (60m).", 4000); return false; }
    const nextDepth = d.depth + 10;
    const upgradeCost = deedFee('mine', 5, nextDepth) - deedFee('mine', 5, d.depth);
    if (!this.economy.canAfford(upgradeCost)) { this.ui.toast(`An upgrade is <b>${this.economy.format(upgradeCost)}</b> &mdash; tha&rsquo;s not the brass.`, 5000); return false; }
    this.economy.spend(upgradeCost);
    d.depth = nextDepth;
    if (this.net) this.net.sendDeeds(this.world.deeds);
    this.ui.toast(`🪧 <b>Mine depth upgraded</b> to ${nextDepth}m.`, 6000);
    if (this.saveNow) this.saveNow(false);
    return true;
  }

  settleUp(id) {
    const d = this.world.deeds.find(x => x.id === id);
    if (!d) return false;
    const up = weeklyUpkeep(d.kind, d.radius, d.depth);
    if (!this.economy.spend(up)) { this.ui.toast(`Upkeep&rsquo;s <b>${this.economy.format(up)}</b> &mdash; tha&rsquo;s short.`, 4000); return false; }
    d.paidUntilDay = Math.max(d.paidUntilDay, this.sky.day) + DEED.week;
    d.lapsedDay = null; // settling revives a deed that lapsed but hasn't reclaimed yet
    if (this.net) this.net.sendDeeds(this.world.deeds);
    this.ui.toast(`Upkeep paid (${this.economy.format(up)}) &mdash; good for another week.`, 4000);
    if (this.saveNow) this.saveNow(false);
    return true;
  }

  // On death: keep pets (they live on player.pets) and tools; lose half of every material stack
  // and half your brass. Relaxed worlds (free) lose nothing. The kids' agreed rule.
  applyDeathPenalty() {
    if (this.freeWorld()) return;            // free world is relaxed — no loss
    const p = this.player;
    p.brass = Math.floor((p.brass || 0) / 2);
    for (let i = 0; i < p.slots.length; i++) {
      const s = p.slots[i];
      if (!s || TOOLS[s.id]) continue;       // keep tools
      const keep = Math.floor(s.n / 2);
      if (keep <= 0) p.slots[i] = null; else s.n = keep;
    }
    this.ui.invDirty = true;
    this.ui.toast('Tha kept thi tools an’ beasts — but half thi materials an’ brass are gone.', 6000, 'warn');
  }

  // Respawn somewhere fresh, not where tha fell.
  pickRespawn() {
    const gen = this.world.gen;
    if (this.netActive && gen.geo.villages && gen.geo.villages.length > 1) {
      const base = this.spawn && this.spawn.village
        ? gen.geo.villages.findIndex(v => v.name === this.spawn.village) : 0;
      const next = gen.findSpawnAt((base < 0 ? 0 : base) + 1 + Math.floor(Math.random() * (gen.geo.villages.length - 1)));
      return next;
    }
    // solo: offset from the home spawn so you don't drop on the same tile
    const s = this.spawn || gen.findSpawn();
    return { ...s, x: s.x + (Math.random() * 24 - 12), z: s.z + (Math.random() * 24 - 12) };
  }

  // Plant a base flag → this becomes thi home; tha respawns here if tha falls.
  setHomeBase(x, y, z) {
    this.player.home = { x, y, z };
    this.ui.toast('🚩 <b>Base flagged!</b> If tha falls, tha&rsquo;ll wake right here at thi base.', 6000);
    if (this.saveNow) this.saveNow(false);
  }

  // Where to wake after death: thi flagged base if tha has one, else somewhere fresh.
  homeSpawn() {
    const h = this.player.home;
    if (h && Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.z)) {
      return { x: h.x + 0.5, y: h.y + 1, z: h.z + 0.5 };
    }
    return this.pickRespawn();
  }

  deedTick() {
    const bairns = this.bairnLocked();
    const decayScale = bairns ? 2 : 1;
    let revived = false;
    for (const d of this.world.deeds) {
      // a child's land claim never lapses (no weekly upkeep to manage); revive any that
      // lapsed under the old rules so the kids get their homestead back
      if (bairns && d.kind === 'claim') {
        if (d.lapsedDay) { d.lapsedDay = null; d.paidUntilDay = this.sky.day + DEED.week; revived = true; }
      } else if (!d.lapsedDay && lapsesUnderUpkeep(d, bairns) && isLapsed(d, this.sky.day, DEED.grace * decayScale)) {
        d.lapsedDay = this.sky.day;
        if (d.by && d.by === this.player.name) {
          this.ui.toast(`Thi ${d.kind === 'mine' ? 'mine licence' : 'land claim'} has <b>lapsed</b> — its builds’ll crumble ower t’ next fortnight unless tha renews it at t’ notice board.`, 9000, 'warn');
        }
      }

      // upkeep owing but not yet lapsed: warn t' owner ONCE a session while t' grace
      // runs — a claim that rots wi' no word ever said is a rage-quit, not a mechanic
      if (!d.lapsedDay && lapsesUnderUpkeep(d, bairns) && d.by && d.by === this.player.name
          && this.sky.day > d.paidUntilDay) {
        if (!this._deedWarned) this._deedWarned = new Set();
        if (!this._deedWarned.has(d.id)) {
          this._deedWarned.add(d.id);
          const left = Math.max(0, Math.ceil(d.paidUntilDay + DEED.grace * decayScale - this.sky.day));
          this.ui.toast(`Upkeep’s owing on thi ${d.kind === 'mine' ? 'mine' : 'claim'} — <b>${left} day${left === 1 ? '' : 's'} o’ grace left</b>. Pay at t’ notice board.`, 8000, 'warn');
        }
      }

      // Kept-stock breeding (Slice 5)
      if (d.kind === 'claim' && !d.lapsedDay && d.by !== 'parish') {
        const mobsInDeed = this.entities.mobs.filter(m => m && !m.dead && m.owner &&
          (m.pos.x - d.cx) ** 2 + (m.pos.z - d.cz) ** 2 <= d.radius * d.radius
        );
        const cap = Math.max(3, Math.floor(d.radius * d.radius / 12));
        if (mobsInDeed.length < cap) {
          const speciesList = ['sheep', 'cow', 'llama', 'pony'];
          for (const species of speciesList) {
            const count = mobsInDeed.filter(m => {
              if (species === 'sheep') return m.type === 'sheep' || m.type === 'lamb';
              return m.type === species;
            }).length;
            if (count >= 2 && Math.random() < 0.05) {
              const babyType = (species === 'sheep') ? 'lamb' : species;
              const spawnY = this.world.gen.height(d.cx, d.cz) + 1.05;
              const baby = this.entities.spawnMob(babyType, d.cx + (Math.random() * 2 - 1), spawnY, d.cz + (Math.random() * 2 - 1));
              if (baby) {
                baby.owner = true;
                baby.stay = true;
                baby.home = { x: baby.pos.x, y: baby.pos.y, z: baby.pos.z };
                baby.petKind = babyType;

                const names = ['Barnaby', 'Bramble', 'Clover', 'Daisy', 'Fern', 'Gorse', 'Heather', 'Ivy', 'Moss', 'Pip', 'Rowan', 'Thistle'];
                const name = names[Math.floor(Math.random() * names.length)] + ' ' + (Math.floor(Math.random() * 90) + 10);

                const rec = { kind: species, name, stay: true, home: { ...baby.home } };
                (this.player.pets || (this.player.pets = [])).push(rec);

                this.ui.toast(`🎉 A new <b>${babyType === 'lamb' ? 'lamb' : species}</b> was born at thi claim!`, 5000);
                break; // spawn only one baby per claim per day
              }
            }
          }
        }
      }
    }
    if (revived && this.net) this.net.sendDeeds(this.world.deeds);  // persist revived kids' claims to the shared moor
  }

  // ---- moorland ponies: a rideable mount 'twixt shanks's pony an' t' railway ----
  mountPony(pony) {
    if (this.mount || !pony || pony.dead || pony.rosterMount) return;   // an NPC's mount isn't thine to take
    this.mount = pony;
    pony.ridden = true;
    this.player.mounted = true;
    this.player.flying = false;
    this._savedEye = this.player.eye; this.player.eye = 2.35; // sit up on her back, see ower t' moor
    this.player.pos = { x: pony.pos.x, y: pony.pos.y + 0.2, z: pony.pos.z };
    this.audio.thud && this.audio.thud();
    this.ui.toast('<b>Up tha gets!</b> Ride on wi’ <b>WASD</b> — she fair shifts ower t’ moor an’ leaps a wall. <b>F</b> to get down.', 7000);
  }

  dismountPony() {
    const p = this.mount; if (!p) return;
    p.ridden = false;
    p.pos = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z };
    p.home = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    if (p.model) p.model.group.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.mount = null;
    this.player.mounted = false;
    this.player.eye = this._savedEye || 1.62;
    if (p.owner) {
      // a kept pony bides where tha gets off — that's her pen
      p.stay = true;
      const rec = (this.player.pets || []).find(q => q.name === p.petName);
      if (rec) { rec.stay = true; rec.home = { ...p.home }; }
      this.saveNow(false);
      this.ui.toast('Tha’s down. She’ll bide here an’ graze — fence her in, or sneak + right-click to bring her to heel.', 5500);
    } else {
      this.ui.toast('Tha’s down. She’ll graze where tha left her — feed her <b>bilberries</b> to tame her an’ keep her for good.', 5500);
    }
  }

  updateMount() {
    const p = this.mount; if (!p) return;
    if (p.dead) { this.mount = null; this.player.mounted = false; return; }
    // the pony carries thee: it sits under thi feet, facing where tha looks
    p.pos.x = this.player.pos.x; p.pos.y = this.player.pos.y; p.pos.z = this.player.pos.z;
    const g = p.model.group;
    g.position.set(this.player.pos.x, this.player.pos.y - 0.15, this.player.pos.z);
    g.rotation.y = this.player.yaw + Math.PI;
    const moving = Math.hypot(this.player.vel.x, this.player.vel.z) > 0.6;
    p.walkPhase = (p.walkPhase || 0) + (moving ? 0.22 : 0);
    if (p.model.legs) p.model.legs.forEach((l, i) => { l.rotation.x = moving ? Math.sin(p.walkPhase + i * Math.PI / 2) * 0.5 : 0; });
  }

  // ---- cobles: board a moored boat, sail her, step ashore ----
  enterBoat(coble) {
    if (this.boat || this.mount || !coble || coble.dead) return;
    this.boat = coble;
    coble.ridden = true;
    this.boatV = 0;
    this.player.flying = false;
    this.player.vel = { x: 0, y: 0, z: 0 };
    this.player.pos = { x: coble.pos.x, y: WATER_LEVEL + 1.1, z: coble.pos.z };
    if (coble.yaw !== undefined) this.player.yaw = coble.yaw;
    this.audio.place && this.audio.place();
    this.ui.toast('<b>Tha&rsquo;s aboard t&rsquo; coble.</b> <b>W</b> to row on, <b>S</b> to back her, <b>look</b> to steer. <b>F</b> to step ashore. Cast a line out at sea for t&rsquo; best fish.', 8000);
  }

  leaveBoat() {
    const c = this.boat; if (!c) return;
    const spot = this.nearestShore(this.player.pos.x, this.player.pos.z);
    c.ridden = false;
    c.yaw = this.player.yaw;
    c.pos = { x: this.player.pos.x, y: WATER_LEVEL + 0.4, z: this.player.pos.z };
    if (c.model) c.model.group.position.set(c.pos.x, c.pos.y, c.pos.z);
    this.boat = null;
    if (spot) {
      this.player.pos = { x: spot.x + 0.5, y: spot.y + 1, z: spot.z + 0.5 };
      this.player.vel = { x: 0, y: 0, z: 0 };
      this.ui.toast('Tha&rsquo;s pulled in an&rsquo; stepped ashore. T&rsquo; coble&rsquo;s moored where tha left her.', 4000);
    } else {
      this.ui.toast('Nowt to step onto &mdash; tha&rsquo;s in t&rsquo; watter! Swim for shore.', 4000);
    }
  }

  // sail the coble: W rows on, S backs her, the helm follows where tha look
  updateBoat(dt) {
    const c = this.boat; if (!c) return;
    if (c.dead) { this.boat = null; return; }
    const k = this.keys;
    const fwd = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    const ACC = 7, MAXV = 7.5, DRAG = 1.4;
    this.boatV += fwd * ACC * dt;
    this.boatV -= this.boatV * DRAG * dt;
    this.boatV = Math.max(-MAXV * 0.5, Math.min(MAXV, this.boatV));
    const yaw = this.player.yaw;
    const dirx = -Math.sin(yaw), dirz = -Math.cos(yaw);
    const nav = (x, z) => this.world.getBlock(Math.floor(x), WATER_LEVEL, Math.floor(z)) === B.WATER;
    let nx = c.pos.x + dirx * this.boatV * dt;
    let nz = c.pos.z + dirz * this.boatV * dt;
    if (!nav(nx, c.pos.z)) { nx = c.pos.x; this.boatV *= 0.4; }
    if (!nav(c.pos.x, nz)) { nz = c.pos.z; this.boatV *= 0.4; }
    c.pos.x = nx; c.pos.z = nz; c.pos.y = WATER_LEVEL + 0.4;
    c.bob = (c.bob || 0) + dt;
    const bob = Math.sin(c.bob * 1.6) * 0.05;
    const g = c.model.group;
    g.position.set(c.pos.x, c.pos.y + bob, c.pos.z);
    g.rotation.y = yaw + Math.PI;
    g.rotation.z = Math.sin(c.bob * 1.1) * 0.04;
    this.player.pos = { x: c.pos.x, y: WATER_LEVEL + 1.1 + bob, z: c.pos.z };
    this.player.vel = { x: 0, y: 0, z: 0 };
    this.player.onGround = true;
  }

  // nearest dry land beside thee, to step out onto
  nearestShore(px, pz) {
    for (let r = 1; r <= 5; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2;
        const x = Math.floor(px + Math.cos(ang) * r), z = Math.floor(pz + Math.sin(ang) * r);
        for (let y = WATER_LEVEL + 4; y >= WATER_LEVEL; y--) {
          const b = this.world.getBlock(x, y, z);
          if (b !== B.AIR && b !== B.WATER && isSolid(b) && this.world.getBlock(x, y + 1, z) === B.AIR) return { x, y, z };
        }
      }
    }
    return null;
  }

  // ---- local folk ridin' t' carriage: board, sit, natter, alight ----
  trainSeatWorld(seatIdx) {
    const cg = this.train.carriage.group;
    const off = [[0.55, -0.7], [-0.55, -0.7], [0.55, 1.0], [-0.55, 1.0]][seatIdx % 4];
    const sl = this.train.seat.clone();
    sl.x = off[0]; sl.z += off[1] + 0.7;
    const w = sl.applyQuaternion(cg.quaternion).add(cg.position);
    return { x: w.x, y: cg.position.y + 1.15, z: w.z, yaw: cg.rotation.y };
  }

  seatTrainFolk() {
    if (!this.train || !this.train.carriage.group.parent) return;
    for (const f of this.trainFolk) {
      const m = f.mob; if (!m || m.dead) continue;
      const sw = this.trainSeatWorld(f.seatIdx);
      m.pos.x = sw.x; m.pos.y = sw.y; m.pos.z = sw.z; m.yaw = sw.yaw;
    }
  }

  boardTrainFolk(stIdx) {
    if (!this.train || this.trainFolk.length >= 2 || Math.random() < 0.45) return;
    const st = this.world.gen.geo.railway();
    const dests = st.map((s, i) => i).filter(i => i !== stIdx);
    if (!dests.length) return;
    const destIdx = dests[(Math.random() * dests.length) | 0];
    const folk = boardingFolk((Date.now() ^ (stIdx * 2654435761)) >>> 0, this.roster || npc.FALLBACK_ROSTER, st[destIdx].name);
    const taken = new Set(this.trainFolk.map(f => f.seatIdx));
    if (this.state === 'riding') taken.add(0);
    let seatIdx = 1; for (let i = 0; i < 4; i++) { if (!taken.has(i)) { seatIdx = i; break; } }
    const sw = this.trainSeatWorld(seatIdx);
    const mob = this.entities.spawnVillager(folk.charId, folk.name, sw.x, sw.y, sw.z);
    if (!mob) return;
    mob.onTrain = true; mob.yaw = sw.yaw;
    mob.trainParcel = folk.parcel; mob.parcelDest = destIdx;
    mob.cannedReplies = folk.canned;
    mob.chatLog.push({ who: 'them', text: folk.greet });
    mob.chatLog.push({ who: 'them', text: folk.tip });
    if (folk.parcel) mob.chatLog.push({ who: 'them', text: `Here — would tha do us a turn? I've ${folk.parcel} for <b>${st[destIdx].name}</b> an’ me knees is gone. See it there an’ there's a bit o’ coal in it for thee.` });
    this.trainFolk.push({ mob, seatIdx, destStation: destIdx });
  }

  alightTrainFolk(stIdx) {
    this.trainFolk = this.trainFolk.filter(f => {
      if (f.destStation !== stIdx) return true;
      if (f.mob && !f.mob.dead) {
        this.scene.remove(f.mob.model.group); f.mob.dead = true;
        const i = this.entities.mobs.indexOf(f.mob); if (i >= 0) this.entities.mobs.splice(i, 1);
      }
      return false;
    });
  }

  clearTrainFolk() {
    for (const f of this.trainFolk) {
      if (f.mob && !f.mob.dead) {
        this.scene.remove(f.mob.model.group); f.mob.dead = true;
        const i = this.entities.mobs.indexOf(f.mob); if (i >= 0) this.entities.mobs.splice(i, 1);
      }
    }
    this.trainFolk = [];
  }

  deliverPendingParcel() {
    const g = this.pendingGoods; if (!g) return;
    const st = this.world.gen.geo.railway();
    this.player.addItem(I.COAL_LUMP, g.reward); this.ui.invDirty = true;
    this.pendingGoods = null;
    this.ui.toast(`<b>${g.parcel ? 'Parcel' : 'Goods'} delivered to ${st[g.dest].name}!</b> ${g.reward}× coal for thi trouble.`, 6000);
    this.audio.pickup && this.audio.pickup();
  }

  // ---- driving t' engine yourself: take t' regulator, fire t' boiler ----
  // Whilst tha drives, t' train follows THY chainage (this.drive.s) instead o'
  // t' timetable — local to thee, so t' shared service is unaffected.
  enterDrive(stIdx) {
    const sched = this.trainSchedule();
    if (!(sched.mode === 'dwell' && sched.i === stIdx)) {
      this.ui.toast('She’s not at t’ platform yet — wait while she’s stood in.'); return;
    }
    this.closeScreens();
    this.state = 'driving';
    this.clearKeys();
    this.drive = {
      s: sched.s, v: 0, reverser: 1, regulator: 0, pressure: 0.7,
      goods: this.pendingGoods || null,
    };
    this.pendingGoods = null;
    this.driveYawSet = false;
    this.player.flying = false;
    if (!this.train) this.train = buildTrain();
    this.lockPointer();
    this.ui.toast('<b>Tha’s on t’ footplate.</b> <b>W</b> regulator &middot; <b>S</b>/space brake &middot; <b>R</b> reverser &middot; <b>F</b> shovel coal &middot; <b>E</b> step down.', 8000);
  }

  leaveDrive() {
    if (!this.drive) { this.state = 'playing'; return; }
    const geo = this.world.gen.geo;
    const st = geo.railway();
    const stS = geo.railPath().stationS;
    let best = 0, bd = 1e9;
    for (let i = 0; i < st.length; i++) { const d = Math.abs(stS[i] - this.drive.s); if (d < bd) { bd = d; best = i; } }
    if (this.drive.goods && bd < 24 && Math.abs(this.drive.v) < 0.4) this.deliverGoods(best);
    const here = st[best];
    const gy = this.world.gen.height(Math.floor(here.x), Math.floor(here.z + 2));
    this.player.pos = { x: here.x + 0.5, y: gy + 2.2, z: here.z + 2.5 };
    this.player.vel = { x: 0, y: 0, z: 0 };
    this.drive = null;
    this.state = 'playing';
    if (this._driveHud) this._driveHud.style.display = 'none';
    this.ui.toast(`Tha’s brought her to a stand an’ stepped down at <b>${here.name}</b>.`, 4000);
  }

  shovelCoal() {
    const d = this.drive; if (!d) return;
    if (!this.player.creative) {
      if (this.player.countItem(I.COAL_LUMP) <= 0) { this.ui.toast('No coal left for t’ firebox!'); return; }
      this.player.removeItem(I.COAL_LUMP, 1); this.ui.invDirty = true;
    }
    d.pressure = Math.min(1, d.pressure + 0.12);
    this.audio.smelt && this.audio.smelt();
  }

  // physics tick — advance t' engine frae t' controls (runs afore updateTrainWorld)
  driveTick(dt) {
    const d = this.drive; if (!d) return;
    const geo = this.world.gen.geo;
    const len = geo.railPath().length;
    const k = this.keys;
    const throttle = k['KeyW'] || k['ArrowUp'];
    const braking = k['KeyS'] || k['ArrowDown'] || k['Space'];
    d.regulator += ((throttle ? 1 : 0) - d.regulator) * Math.min(1, dt * 1.6);
    const sp = geo.samplePos(Math.max(0, Math.min(len, d.s)));
    const grade = sp.grade || 0;
    const effort = d.regulator * d.pressure * DRIVE_MAXACC * d.reverser;
    d.v += (effort - DRIVE_DRAG * d.v - grade * DRIVE_GRADE) * dt;
    if (braking) { const dv = DRIVE_BRAKE * dt; d.v = Math.abs(d.v) <= dv ? 0 : d.v - Math.sign(d.v) * dv; }
    d.v = Math.max(-DRIVE_VMAX, Math.min(DRIVE_VMAX, d.v));
    d.s += d.v * dt;
    if (d.s < DRIVE_RAKE) { d.s = DRIVE_RAKE; d.v = 0; }
    if (d.s > len - DRIVE_RAKE) { d.s = len - DRIVE_RAKE; d.v = 0; }
    d.pressure = Math.max(0, Math.min(1, d.pressure - (d.regulator * 0.045 + 0.005) * dt));
    if (d.pressure < 0.12 && !d._lowWarned) { d._lowWarned = true; this.ui.toast('Steam’s low — shovel some coal on (<b>F</b>)!', 3000); }
    if (d.pressure > 0.32) d._lowWarned = false;
  }

  // lock t' camera to t' footplate an' draw t' cab gauges (runs after the rake's posed)
  driveCam() {
    const d = this.drive; if (!d) return;
    const loco = this.train && this.train.loco.group;
    if (!loco || !loco.parent) return;
    // sit at the driver's side spectacle, leaning out a touch so tha sees up the
    // line past the boiler (a centred footplate eye just stares at the black firebox)
    const cab = new THREE.Vector3(0.7, 3.25, -1.5).applyQuaternion(loco.quaternion).add(loco.position);
    this.player.pos = { x: cab.x, y: cab.y - this.player.eye, z: cab.z };
    this.player.vel = { x: 0, y: 0, z: 0 };
    const locoYaw = loco.rotation.y || 0;
    if (!this.driveYawSet) { this.player.yaw = locoYaw + Math.PI - 0.06; this.player.pitch = -0.12; this.driveBaseYaw = locoYaw; this.driveYawSet = true; }
    else { let dY = locoYaw - this.driveBaseYaw; while (dY > Math.PI) dY -= Math.PI * 2; while (dY < -Math.PI) dY += Math.PI * 2; if (Math.abs(dY) > 1e-4) { this.player.yaw += dY; this.driveBaseYaw = locoYaw; } }
    let h = this._driveHud;
    if (!h) {
      h = document.createElement('div'); h.id = 'driveHud';
      h.style.cssText = 'position:fixed;left:50%;bottom:78px;transform:translateX(-50%);font-family:ui-monospace,monospace;font-size:13px;color:#ffe9b0;background:rgba(20,16,12,0.74);border:1px solid #6a5430;border-radius:8px;padding:7px 14px;text-align:center;pointer-events:none;z-index:40;line-height:1.6;letter-spacing:0.5px';
      document.body.appendChild(h); this._driveHud = h;
    }
    h.style.display = 'block';
    const mph = Math.round(Math.abs(d.v) * 2.4);
    const bar = (frac, col) => { const n = Math.max(0, Math.min(14, Math.round(frac * 14))); return `<span style="color:${col}">${'█'.repeat(n)}</span><span style="opacity:0.25">${'█'.repeat(14 - n)}</span>`; };
    const goods = d.goods ? `<br><span style="color:#9ec27a">Goods for ${this.world.gen.geo.railway()[d.goods.dest].name}</span>` : '';
    h.innerHTML = `<b>${mph} mph</b>${d.v < -0.1 ? ' ◄ reverse' : d.reverser < 0 ? ' (reverser set back)' : ''}<br>`
      + `Regulator ${bar(d.regulator, '#9ec27a')}<br>`
      + `Steam ${bar(d.pressure, d.pressure < 0.15 ? '#e0662e' : '#d8b95a')}${goods}`;
  }

  deliverGoods(stIdx) {
    const g = this.drive && this.drive.goods; if (!g || g.dest !== stIdx) return;
    const st = this.world.gen.geo.railway();
    this.player.addItem(I.COAL_LUMP, g.reward); this.ui.invDirty = true;
    this.drive.goods = null;
    this.ui.toast(`<b>Consignment delivered to ${st[stIdx].name}!</b> ${g.reward}× coal for thi trouble — word gets round tha’s a steady hand.`, 6000);
    this.audio.pickup && this.audio.pickup();
  }

  // T' one true train: rendered out on t' moor for all to see, boarded at
  // platforms, ridden frae a window seat.
  updateTrainWorld(dt) {
    if (!this.world || this.state === 'loading' || (this.state === 'title' && !this.titlePreview)) return;
    const geo = this.world.gen.geo;
    const st = geo.railway();
    const driving = this.state === 'driving' && this.drive;
    const s = driving
      ? { s: this.drive.s, mode: Math.abs(this.drive.v) > 0.08 ? 'run' : 'dwell', dir: 0, speed: Math.abs(this.drive.v) }
      : this.trainSchedule();
    const fwd = driving ? 1 : (s.dir === 0 ? 1 : -1);
    // T' loco leads smokebox-first BOTH ways. At a terminus she FLIPS in place at the
    // platform during the dwell — turns clean about an' sets off the other way — rather
    // than sweeping a 180° arc through the station buildings. cc = lead chainage.
    const nSt = st.length;
    // Turn about ONCE at the terminus this journey ENDS at (dir 0 ends at n-1, dir 1 ends at 0),
    // facing the return. Do NOT flip at the journey's START station — she already faces the way
    // she'll run. (Flipping at BOTH terminus stations made her spin about twice at the buffers.)
    const endStation = fwd === 1 ? nSt - 1 : 0;
    const atEnd = !driving && s.mode === 'dwell' && s.i === endStation;
    const poseFwd = atEnd ? -fwd : fwd; // at the end she's turned about, facing the way she'll depart
    const RAKE = 11.2, len = geo.railPath().length;
    const cc = Math.max(RAKE, Math.min(len - RAKE, s.s - RAKE * poseFwd));
    const csp = geo.samplePos(cc);
    const x = csp.x, z = csp.z;
    let rotY = this.trainRot || 0, moving = false, speed = 0;
    if (Math.hypot(csp.tx, csp.tz) > 0.01) rotY = Math.atan2(csp.tx * poseFwd, csp.tz * poseFwd);
    if (s.mode === 'run') { moving = true; speed = s.speed; }
    this.trainRot = rotY;
    this.trainState = { x, z, rotY, s };

    const p = this.player.pos;
    const near = Math.hypot(x - p.x, z - p.z) < 260;
    const show = (driving || near || this.state === 'riding') && this.world.isLoaded(Math.floor(x), Math.floor(z));
    if (!this.train) this.train = buildTrain();
    // the smoothed heading (windowed tangent) for the RIDE CAMERA — kept apart from the bodies'
    // square local heading above, so the camera rides continuous while the carriages sit straight
    this.train.camYaw = (Math.hypot(csp.stx, csp.stz) > 0.01) ? Math.atan2(csp.stx * poseFwd, csp.stz * poseFwd) : this.trainRot;
    const parts = this.train.parts;
    if (show) {
      for (const part of parts) {
        const pg = part.group;
        if (!pg.parent) { this.scene.add(pg); pg.rotation.order = 'YXZ'; }
        // each body takes its own spot on t' spline (loco leads, rake trails) so she
        // bends honestly through t' curves an' noses into t' gradients; poseFwd flips
        // her about in place at a terminus so she's smokebox-first whichever way she runs.
        const distC = part.offset + RAKE;            // carriage 0, tender 5.9, loco 11.2
        const psp = geo.samplePos(cc + distC * poseFwd);
        pg.position.x = psp.x;
        pg.position.z = psp.z;
        const deck = psp.deck + 1;
        pg.position.y = pg.position.y ? pg.position.y + (deck - pg.position.y) * Math.min(1, dt * 6) : deck;
        if (Math.hypot(psp.tx, psp.tz) > 0.01) pg.rotation.y = Math.atan2(psp.tx * poseFwd, psp.tz * poseFwd); // local — bodies sit square
        const ppitch = -Math.atan(psp.grade * poseFwd);
        pg.rotation.x += (ppitch - pg.rotation.x) * Math.min(1, dt * 4);
        if (moving && part.wheels) {
          // the loco leads its travel direction both ways, so the wheels always roll
          // FORWARD on the schedule; only a player-driven loco reverses.
          const roll = driving ? (Math.sign(this.drive.v) || 1) : 1;
          for (const w of part.wheels) w.rotateZ(roll * speed * dt / (w.userData.r || 0.62));
        }
      }
      // coupling rods ride t' crank pins, quartered like t' real thing
      if (moving && this.train.loco.rods) {
        const roll = driving ? (Math.sign(this.drive.v) || 1) : 1;
        this.train.rodPhase = (this.train.rodPhase || 0) + roll * speed * dt / 0.62;
        this.train.loco.rods.forEach((rod, i) => {
          const th = this.train.rodPhase + i * Math.PI / 2;
          rod.position.y = 0.62 + Math.sin(th) * 0.32;
          rod.position.z = 0.2 + Math.cos(th) * 0.32;
        });
      }
      if (moving) {
        // t' chuff on t' beat (sound only)
        this.trainChuff = (this.trainChuff || 0) - dt;
        if (this.trainChuff <= 0) {
          this.trainChuff = Math.max(0.16, 8 / Math.max(speed, 3));
          const dNow = Math.hypot(x - p.x, z - p.z);
          if (dNow < 150 || this.state === 'riding') {
            this.audio.noiseBurst && this.audio.noiseBurst(this.audio.ctx ? this.audio.ctx.currentTime : 0, 0.09, Math.max(0.03, 0.14 - dNow / 1500), 600, 'bandpass');
          }
        }
        // steam: a steady stream o' soft puffs frae t' funnel — they billow an' trail
        // back ower t' rake, leaving a line o' little clouds (not a spat pellet)
        this.steamTimer = (this.steamTimer || 0) - dt;
        if (this.steamTimer <= 0) {
          this.steamTimer = 0.11;
          if (Math.hypot(x - p.x, z - p.z) < 220 || driving || this.state === 'riding') {
            const lg = this.train.loco.group;
            const fn = this.train.funnel.clone().applyQuaternion(lg.quaternion).add(lg.position);
            this.entities.steamPuff(fn.x, fn.y, fn.z, Math.sin(rotY), Math.cos(rotY));
          }
        }
      }
      // whistle when she arrives or departs near thee
      const key = s.mode + (s.mode === 'dwell' ? s.i : s.from);
      if (key !== this.lastTrainKey) {
        this.lastTrainKey = key;
        if (near && this.state !== 'riding' && !driving) {
          this.audio.whistle && this.audio.whistle(0.35);
          if (s.mode === 'dwell') this.ui.toast(`T\u2019 train\u2019s come in at <b>${st[s.i].name}</b> \u2014 ${Math.round(s.dwellLeft)}s at t\u2019 platform.`, 5000);
        }
      }
    } else if (parts[0].group.parent) {
      for (const part of parts) this.scene.remove(part.group);
    }
    // local folk ridin' t' carriage: board/alight at platforms, seated as she rolls
    if (show && !driving && this.train.carriage.group.parent) {
      if (s.mode === 'dwell' && this.lastDwellStation !== s.i) {
        this.lastDwellStation = s.i;
        this.alightTrainFolk(s.i);
        this.boardTrainFolk(s.i);
      } else if (s.mode === 'run') { this.lastDwellStation = -1; }
      this.seatTrainFolk();
    } else if (!show && this.trainFolk.length) {
      this.clearTrainFolk();
    }
  }

  // lazily set up one branch train per non-main line (shared by the update + the warden boarder)
  _ensureBranchTrains() {
    if (this.branchTrains) return;
    const geo = this.world.gen.geo;
    if (!geo.realWorld || !geo.railPaths) { this.branchTrains = []; return; }
    const main = geo.railPath();
    this.branchTrains = geo.railPaths().filter(l => l.path !== main).map(l => ({
      name: l.name, path: l.path,
      stations: (geo.railLines().find(x => x.name === l.name) || {}).stops || [],
      train: null, rodPhase: 0, state: null,
    }));
  }

  // [16] The horizon sea ring — see the SEA_RING constant up top for the why.
  // Ring inner 90 sits inside the meshed radius (112 worst-case, fog fully
  // occluded by 98), outer 500 reaches the dome; near-field sea is real chunk
  // water drawn over it (the ring writes no depth). Shown when the camera's high
  // OR the player's over coastal ground (coastT > 0); hidden inland at ground
  // level, so no streak from T' High Moor. Built ONCE, disposed in teardownWorld.
  // Moors only — stylised world untouched (same gate as the old backdrop).
  _updateSeaRing(dt) {
    const geo = this.world.gen.geo;
    if (!SEA_RING || !geo.realWorld) { if (this.seaRing) this.seaRing.visible = false; return; }
    if (!this.seaRing) {
      // RingGeometry is XY-plane — rotate -PI/2 about X to lie flat (red-team catch)
      const mat = new THREE.MeshBasicMaterial({ color: SEA_RING_COL, fog: true, depthWrite: false });
      this.seaRing = new THREE.Mesh(new THREE.RingGeometry(90, 500, 48), mat);
      this.seaRing.rotation.x = -Math.PI / 2;
      this.seaRing.renderOrder = -0.5;     // after the sky dome (-1), before the chunks (0)
      this.seaRing.frustumCulled = false;
      this.scene.add(this.seaRing);
    }
    const p = this.player.pos;
    const camY = this.camera ? this.camera.position.y : p.y;
    this.seaRing.visible = camY > 60 || geo.coastT(Math.round(p.x), Math.round(p.z)) > 0;
    if (!this.seaRing.visible) return;
    this.seaRing.position.set(p.x, WATER_LEVEL - 0.12, p.z); // 25.88: one block under the rippling surface plane
    // colour eases toward the water colour, dimmed with the daylight (a Basic
    // material is unlit — a constant colour would glow at night); module-scratch
    // Color, nowt allocated per frame. [SOLAR] dayness read frae the one solar API.
    const dayness = this.sky.sol.dayness;
    _seaRingCol.set(SEA_RING_COL).multiplyScalar(0.18 + 0.82 * dayness);
    this.seaRing.material.color.lerp(_seaRingCol, Math.min(1, dt * 2));
  }

  // The BRANCH trains: a steam train on every OTHER line (Esk Valley, Coast Line), running its
  // own spline forever on the shared clock — additive to the main-line train above, so the whole
  // network's alive. Visual (rake bends + rods + steam); rendered only when near the player.
  updateBranchTrains(dt) {
    if (!this.world || this.state === 'loading' || (this.state === 'title' && !this.titlePreview)) return;
    const geo = this.world.gen.geo;
    if (!geo.realWorld || !geo.railPaths) return;
    this._ensureBranchTrains();
    const pp = this.player.pos, RAKE = 11.2;
    for (const bt of this.branchTrains) {
      if (bt.stations.length < 2 || bt.path.stationS.length < 2) continue;
      const s = this.trainScheduleFor(bt.path, bt.stations);
      const fwd = s.dir === 0 ? 1 : -1;
      const nSt = bt.path.stationS.length;
      const endStation = fwd === 1 ? nSt - 1 : 0;   // turn about once, at the journey's END station only
      const atEnd = s.mode === 'dwell' && s.i === endStation;
      const poseFwd = atEnd ? -fwd : fwd;
      const len = bt.path.length;
      const cc = Math.max(RAKE, Math.min(len - RAKE, s.s - RAKE * poseFwd));
      const csp = geo.samplePosOn(bt.path, cc);
      bt.state = { x: csp.x, z: csp.z, s }; // kept current so the warden can ride this line
      bt.camYaw = (Math.hypot(csp.stx, csp.stz) > 0.01) ? Math.atan2(csp.stx * poseFwd, csp.stz * poseFwd) : (bt.camYaw || 0); // smoothed heading for the ride camera
      const show = Math.hypot(csp.x - pp.x, csp.z - pp.z) < 260 && this.world.isLoaded(Math.floor(csp.x), Math.floor(csp.z));
      if (!show) { if (bt.train) for (const part of bt.train.parts) if (part.group.parent) this.scene.remove(part.group); continue; }
      if (!bt.train) bt.train = buildTrain();
      const moving = s.mode === 'run', speed = moving ? s.speed : 0;
      for (const part of bt.train.parts) {
        const pg = part.group;
        if (!pg.parent) { this.scene.add(pg); pg.rotation.order = 'YXZ'; }
        const psp = geo.samplePosOn(bt.path, cc + (part.offset + RAKE) * poseFwd);
        pg.position.x = psp.x; pg.position.z = psp.z;
        const deck = psp.deck + 1;
        pg.position.y = pg.position.y ? pg.position.y + (deck - pg.position.y) * Math.min(1, dt * 6) : deck;
        if (Math.hypot(psp.tx, psp.tz) > 0.01) pg.rotation.y = Math.atan2(psp.tx * poseFwd, psp.tz * poseFwd); // local — bodies sit square
        pg.rotation.x += (-Math.atan(psp.grade * poseFwd) - pg.rotation.x) * Math.min(1, dt * 4);
        if (moving && part.wheels) for (const w of part.wheels) w.rotateZ(speed * dt / (w.userData.r || 0.62));
      }
      if (moving && bt.train.loco.rods) {
        bt.rodPhase += speed * dt / 0.62;
        bt.train.loco.rods.forEach((rod, i) => { const th = bt.rodPhase + i * Math.PI / 2; rod.position.y = 0.62 + Math.sin(th) * 0.32; rod.position.z = 0.2 + Math.cos(th) * 0.32; });
      }
      if (moving && Math.hypot(csp.x - pp.x, csp.z - pp.z) < 200) {
        bt.steamTimer = (bt.steamTimer || 0) - dt;
        if (bt.steamTimer <= 0) {
          bt.steamTimer = 0.12;
          const lg = bt.train.loco.group, rotY = Math.atan2(csp.tx * poseFwd, csp.tz * poseFwd);
          const fn = bt.train.funnel.clone().applyQuaternion(lg.quaternion).add(lg.position);
          this.entities.steamPuff(fn.x, fn.y, fn.z, Math.sin(rotY), Math.cos(rotY));
        }
      }
    }
  }

  // switch the ride camera (1 on board · 2 driver · 3 overhead); re-faces forrard cleanly
  setRideView(v) {
    if (this.state !== 'riding' || this.rideView === v) return;
    this.rideView = v;
    this.rideYawSet = false;
    this.ui.setRideViewMenu(v);
  }

  // a ride begins (warden teleport, or a booked passenger boarding): default to the seat view
  startRideView() {
    this.rideView = 'seat';
    this.rideYawSet = false;
    this.rideSmoothYaw = undefined;   // re-seed the heading filter for this train
    this.ui.showRideViewMenu('seat');
  }

  // riding: the POV rides the train. Pick the view wi' 1/2/3 (on board · driver · overhead).
  // The carriage heading is low-passed first, so the spline-tangent corners — worst on the
  // pegged coast line — don't jerk the camera every time her bearing twitches.
  updateRide(dt) {
    const bt = this.ride && this.ride.bt;          // a branch train, or null for the main line
    const ts = bt ? bt.state : this.trainState;
    const train = bt ? bt.train : this.train;
    const cg = train && train.carriage.group;
    if (!ts || !cg || !cg.parent) return;
    const lg = train.loco && train.loco.group;
    // a seat o' thi own, so a full carriage o' players sits apart
    if (this.seatOffset === undefined) {
      const hash = [...this.devicePid()].reduce((a, c) => a + c.charCodeAt(0), 0);
      this.seatOffset = [[0.55, -0.7], [-0.55, -0.7], [0.55, 1.0], [-0.55, 1.0]][hash % 4];
    }
    // the camera follows the SMOOTHED heading (the windowed-tangent camYaw, low-passed so the
    // terminus about-turn swings rather than snaps), DECOUPLED from the bodies' square local
    // heading — so the ride runs continuous while the carriages still sit straight on the rail
    const target = (bt ? bt.camYaw : this.train.camYaw);
    if (target == null) return;
    if (this.rideSmoothYaw === undefined) this.rideSmoothYaw = target;
    let toY = target - this.rideSmoothYaw; while (toY > Math.PI) toY -= Math.PI * 2; while (toY < -Math.PI) toY += Math.PI * 2;
    this.rideSmoothYaw += toY * Math.min(1, (dt || 0.016) * 5);
    const sy = this.rideSmoothYaw, fwd = { x: Math.sin(sy), z: Math.cos(sy) };
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sy, 0, 'YXZ'));
    const view = this.rideView || 'seat';

    if (view === 'overhead') {
      // a chase cam, up an' behind, pointing forrard an' down over the train
      this.player.pos = { x: cg.position.x - fwd.x * 21, y: cg.position.y + 15, z: cg.position.z - fwd.z * 21 };
      this.player.yaw = sy + Math.PI;     // face the way o' travel
      this.player.pitch = -0.52;          // ...an' down at her
    } else {
      // on board / driver: first-person, mouse looks about, the POV swung by the SMOOTHED heading
      // so they allus face the way o' travel (through a curve, or a reversal at the terminus)
      if (!this.rideYawSet) {
        this.player.yaw = sy + Math.PI;
        this.player.pitch = view === 'driver' ? -0.1 : 0;
        this.rideBaseYaw = sy;
        this.rideYawSet = true;
      } else {
        let dY = sy - this.rideBaseYaw;
        while (dY > Math.PI) dY -= Math.PI * 2;
        while (dY < -Math.PI) dY += Math.PI * 2;
        if (Math.abs(dY) > 1e-5) { this.player.yaw += dY; this.rideBaseYaw = sy; }
      }
      let p;
      if (view === 'driver' && lg) {
        p = new THREE.Vector3(0, 2.2, 5.0).applyQuaternion(q).add(lg.position); // just off the very front, looking forrard
      } else {
        const seatLocal = train.seat.clone();
        seatLocal.x = this.seatOffset[0];
        seatLocal.z += this.seatOffset[1] + 0.7;
        p = seatLocal.applyQuaternion(q).add(cg.position);
      }
      this.player.pos = { x: p.x, y: p.y - this.player.eye, z: p.z };
    }
    this.player.vel = { x: 0, y: 0, z: 0 };

    // arrived? (booked passenger rides only — a warden ride has no destIdx)
    if (ts.s.mode === 'dwell' && ts.s.i === this.ride.destIdx) {
      this.ui.hideRideViewMenu();
      const end = this.world.gen.geo.railway()[this.ride.destIdx];
      if (this.pendingGoods && this.pendingGoods.dest === this.ride.destIdx) this.deliverPendingParcel();
      const g = this.world.gen.height(Math.floor(end.x), Math.floor(end.z + 2));
      this.player.pos = { x: end.x + 0.5, y: g + 2.2, z: end.z + 2.5 };
      this.ride = null;
      this.state = 'playing';
      this.audio.whistle && this.audio.whistle(0.5);
      this.ui.toast(`<b>${end.name}!</b> All change. Mind t\u2019 gap.`, 5000);
    }
  }

  // booked passengers board when she's stood at their platform
  updatePendingRide() {
    const p = this.pendingRide;
    if (!p || !this.trainState) return;
    const st = this.world.gen.geo.railway();
    const s = this.trainState.s;
    if (s.mode === 'dwell' && s.i === p.stIdx && this.state === 'playing') {
      // measured to t' TRAIN herself, not t' station post — easier to board
      const d = Math.hypot(this.player.pos.x - this.trainState.x, this.player.pos.z - this.trainState.z);
      if (d < 18) {
        this.pendingRide = null;
        this.ride = { destIdx: p.destIdx };
        this.state = 'riding';
        this.startRideView();
        this.player.flying = false;
        this.audio.whistle && this.audio.whistle();
        this.ui.toast(`<b>All aboard for ${st[p.destIdx].name}!</b> Tek thi seat \u2014 mouse to look about as t\u2019 moors roll by.`, 6000);
        return;
      }
    }
    // missed it? she's pulled away frae thi station
    if (s.mode === 'run' && s.from === p.stIdx && !p.boarded) {
      this.pendingRide = null;
      this.player.addItem(I.COAL_LUMP, p.fare);
      this.ui.invDirty = true;
      this.ui.toast('Tha missed t\u2019 train, love. Fare\u2019s refunded \u2014 she\u2019ll be back along.', 6000);
    }
  }

  openBoard(fromBoard) {
    this.state = 'board';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    document.exitPointerLock?.();
    this.ui.openBoard(fromBoard);
  }

  openMuseum() {
    this.state = 'museum';
    this.mouseDown = [false, false, false];
    this.clearKeys();
    document.exitPointerLock?.();
    this.ui.openMuseum();
  }

  nearBench() {
    const p = this.player.pos;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) {
      if (this.world.getBlock(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz) === B.BENCH) return true;
    }
    return false;
  }

  dropAtPlayer(item, n) {
    const p = this.player.pos;
    this.entities.spawnDrop(p.x, p.y + 1, p.z, item, n);
  }

  // ---------------- interaction ----------------
  lookDir() {
    const { yaw, pitch } = this.player;
    return {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
  }

  targetBlock() {
    const eye = this.player.eyePos();
    const d = this.lookDir();
    return raycast(this.world, eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH,
      id => isSolid(id) || isCutout(id));
  }

  attackOrMine(firstClick) {
    const eye = this.player.eyePos();
    const d = this.lookDir();
    // mobs first
    const blockHit = this.targetBlock();
    const mobHit = this.entities.raycastMobs(eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH);
    if (mobHit && (!blockHit || mobHit.dist < blockHit.dist)) {
      if (mobHit.mob.type === 'villager') {
        if (firstClick) this.ui.toast('Nay! Tha doesn&rsquo;t clout t&rsquo; neighbours.');
        this.breakTarget = null;
        this.breakProgress = 0;
        return;
      }
      if (firstClick) {
        const held = this.player.heldItem();
        const dmg = held && TOOLS[held.id] ? TOOLS[held.id].dmg : 1;
        const len = Math.hypot(d.x, d.z) || 1;
        this.entities.hurtMob(mobHit.mob, dmg, d.x / len, d.z / len, this.audio, this.player);
        if (this.player.wearTool()) { this.audio.toolSnap(); this.ui.toast('Thi tool&rsquo;s snapped!'); }
        this.ui.invDirty = true;
      }
      this.breakTarget = null;
      this.breakProgress = 0;
    }
  }

  updateMining(dt) {
    if (this.state !== 'playing' || !this.mouseDown[0] || this.player.dead) {
      this.breakTarget = null;
      this.breakProgress = 0;
      this.ui.drawBreakProgress(0);
      return;
    }
    const hit = this.targetBlock();
    // a mob in t' way?
    const eye = this.player.eyePos();
    const d = this.lookDir();
    const mobHit = this.entities.raycastMobs(eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH);
    if (mobHit && (!hit || mobHit.dist < hit.dist)) {
      this.ui.drawBreakProgress(0);
      return;
    }
    if (!hit) {
      this.breakTarget = null;
      this.breakProgress = 0;
      this.ui.drawBreakProgress(0);
      return;
    }
    const key = hit.x + ',' + hit.y + ',' + hit.z;
    if (this.breakTarget !== key) {
      this.breakTarget = key;
      this.breakProgress = 0;
    }
    const def = BLOCKS[hit.id];
    if (def.hard === Infinity) { this.ui.drawBreakProgress(0); return; }

    // protected landmarks: built fabric at/above ground can't be broken — but
    // tha can allus dig underneath. Wardens are exempt so they can repair owt.
    if (!this.isAdmin() && protectedAt(this.world.gen.geo, this.world, hit.x, hit.y, hit.z, hit.id)) {
      this.breakProgress = 0;
      this.ui.drawBreakProgress(0);
      const now = performance.now() / 1000;
      if (!this._lmToast || now - this._lmToast > 4) {
        this._lmToast = now;
        this.ui.toast('That’s a <b>protected landmark</b>, love — tha can dig under it, but tha can’t break it.', 4000);
      }
      return;
    }

    // Living Moor Slice 4: The 1-block-deep dig rule
    const NATURAL_BLOCKS = new Set([
      B.STONE, B.DIRT, B.GRASS, B.GRAVEL, B.SAND, B.PEAT,
      B.COAL_ORE, B.IRON_ORE, B.JET_ORE, B.ALUM_SHALE, B.POLYHALITE, B.ROCK_SALT
    ]);
    const editKey = `${hit.x},${hit.y},${hit.z}`;
    const ledgerEdit = this.world.editLedger.get(editKey);
    const isPlayerBuild = ledgerEdit && ledgerEdit.cat === 'build';

    if (!this.isAdmin() && !this.player.creative && NATURAL_BLOCKS.has(hit.id) && !isPlayerBuild) {
      const grade = this.world.gen.height(hit.x, hit.z);
      if (hit.y < grade - 1) {
        // Deep digging: parish quarries, old workings (caves + scattered pits), or licensed mines
        const inQuarry = inDeed(this.world.deeds, hit.x, hit.z, 'quarry');
        const inOldWorkings = !inQuarry && this.world.gen.inOldWorkingsVolume(hit.x, hit.y, hit.z);
        if (!inQuarry && !inOldWorkings) {
          const mine = findActiveDeed(this.world.deeds, hit.x, hit.z, 'mine');
          const allowedFixtures = [];
          if (mine) {
            for (const [k, e] of this.world.editLedger) {
              if (e.cat === 'build') {
                const [fx, fy, fz] = k.split(',').map(Number);
                if ((fx - mine.cx) ** 2 + (fz - mine.cz) ** 2 <= mine.radius * mine.radius) {
                  const fid = this.world.getBlock(fx, fy, fz);
                  if ([B.PIT_PROPS, B.SAFETY_LAMP, B.WINCH].includes(fid)) {
                    allowedFixtures.push(fid);
                  }
                }
              }
            }
          }
          const held = this.player.heldItem();
          let pickType = 'none';
          if (held && TOOLS[held.id] && TOOLS[held.id].type === 'pick') {
            if (held.id === I.W_PICK) pickType = 'wood';
            else if (held.id === I.S_PICK) pickType = 'stone';
            else if (held.id === I.I_PICK) pickType = 'iron';
          }

          const check = mayDigDeep(hit.y, grade, mine, pickType, allowedFixtures, this.freeWorld());
          if (!check.allowed) {
            this.breakProgress = 0;
            this.ui.drawBreakProgress(0);
            const now = performance.now() / 1000;
            if (!this._lmToast || now - this._lmToast > 4) {
              this._lmToast = now;
              const guide = miningDigGuide(check.reason, this.player, this.world, check);
              if (guide.message) {
                this.ui.guideMiningBlocked(this.player, this.world, check.reason, guide.message, guide.highlights);
              }
            }
            return;
          }
        }
      }
    }

    if (this.player.creative) {
      this.creativeBreakCd = (this.creativeBreakCd || 0) - dt;
      if (this.creativeBreakCd <= 0) {
        this.creativeBreakCd = 0.18;
        this.finishBreak(hit, true);
      }
      this.breakProgress = 0;
      return;
    }

    const held = this.player.heldItem();
    const tool = held ? TOOLS[held.id] : null;
    let speed = 1;
    if (tool && def.tool && tool.type === def.tool) speed = tool.speed;
    if (def.needsPick && (!tool || tool.type !== 'pick')) speed = 0.3;

    this.breakProgress += (dt * speed) / Math.max(0.05, def.hard);
    this.digSoundTimer = (this.digSoundTimer || 0) - dt;
    if (this.digSoundTimer <= 0) { this.audio.dig(def.hard); this.digSoundTimer = 0.25; }
    this.ui.drawBreakProgress(Math.min(1, this.breakProgress));

    if (this.breakProgress >= 1) {
      const noDrop = def.needsPick && (!tool || tool.type !== 'pick');
      this.finishBreak(hit, noDrop);
      this.breakProgress = 0;
      this.breakTarget = null;
      if (this.player.wearTool()) { this.audio.toolSnap(); this.ui.toast('Thi tool&rsquo;s snapped!'); }
      this.player.exhaustion += 0.03;
      this.ui.invDirty = true;
    }
  }

  // ---- Living Moor: a chopped tree falls whole, then regrows from a sapling ----
  // Fell the whole connected tree from the chopped block (no floating canopy); mark the stump so
  // a sapling sprouts there in time (world.growTrees does the gradual regrowth).
  fellTree(hit, noDrop) {
    const w = this.world, isWood = id => id === B.LOG || id === B.LEAVES || id === B.MONKEY_LEAVES || id === B.ORCHARD_LEAVES;
    const seen = new Set(), stack = [[hit.x, hit.y, hit.z]], cells = [];
    while (stack.length && cells.length < 80) {
      const [x, y, z] = stack.pop(), k = x + ',' + y + ',' + z;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!isWood(w.getBlock(x, y, z))) continue;
      cells.push([x, y, z, w.getBlock(x, y, z)]);
      stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
    }
    let bx = hit.x, by = hit.y, bz = hit.z;
    let hadOrchard = false;
    for (const [x, y, z, id] of cells) {
      if (id === B.LOG && y < by) { bx = x; by = y; bz = z; } // the lowest trunk block is the stump
      if (id === B.ORCHARD_LEAVES) hadOrchard = true;
      w.setBlock(x, y, z, B.AIR);
      if (this.net) this.net.sendEdit(x, y, z, 0, id, 'harvest', this.sky.day, this.player.name || '');
      if (!this.player.creative && !noDrop && id === B.LOG) this.entities.spawnDrop(x + 0.5, y + 0.4, z + 0.5, B.LOG, 1);
    }
    this.entities.blockBurst(hit.x, hit.y, hit.z, B.LOG);
    this.audio.breakBlock();
    const stumpKey = bx + ',' + by + ',' + bz;
    w.treeRegrowth.set(stumpKey, this.sky.day); // a sapling sprouts here in time
    if (hadOrchard) w.fruitStumps.add(stumpKey); // regrow as a fruit tree, not an oak
    this.milestones.onBreak(B.LOG);
  }

  finishBreak(hit, noDrop) {
    if (hit.id === B.LOG) { this.fellTree(hit, noDrop); this.quests.onBlockBroken(hit.x, hit.y, hit.z, hit.id); return; }
    const def = BLOCKS[hit.id];
    this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
    // breaking thi own base flag un-sets thi home (tha can plant a fresh un elsewhere)
    if (hit.id === B.HOME_FLAG && this.player.home &&
        this.player.home.x === hit.x && this.player.home.y === hit.y && this.player.home.z === hit.z) {
      this.player.home = null;
      this.ui.toast('Thi base flag&rsquo;s down &mdash; plant a new un to set thi home.', 5000);
      if (this.saveNow) this.saveNow(false);
    }
    // breaking a strongbox spills its contents as drops — never vaporises 'em.
    // No locks in v1: on t' shared moor kids share bases, so anyone may break a box
    // (its brass goes to whoever breaks it, same as the spilled goods).
    if (hit.id === B.STRONGBOX && this.world.strongboxes) {
      const bk = boxKey(hit.x, hit.y, hit.z);
      const box = this.world.strongboxes.get(bk);
      if (box) {
        const { drops, brass } = spillBox(box);
        for (const [id, n] of drops) this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5, id, n);
        if (brass > 0) {
          this.player.brass = (this.player.brass || 0) + brass;
          this.ui.toast(`T&rsquo; box&rsquo;s brass &mdash; <b>${this.economy ? this.economy.format(brass) : brass}</b> &mdash; goes in thi purse.`, 5000);
        }
        this.world.strongboxes.delete(bk);
        this.ui.invDirty = true;
        this.saveNow(false);
      }
    }
    this.entities.blockBurst(hit.x, hit.y, hit.z, hit.id);
    this.audio.breakBlock();
    if (!this.player.creative && !noDrop && def.drop !== null && def.drop !== undefined) {
      // Prospecting skill gate check
      let dropId = def.drop;
      const xp = this.player.miningSkill || 0;
      const level = Math.floor(Math.sqrt(xp / 10));
      let tooGreen = false;

      if (hit.id === B.JET_ORE && level < 3) {
        dropId = B.COBBLE;
        tooGreen = true;
        this.ui.toast("Tha’s too green to read t’ seam — got bare stone (requires Prospecting level 3).", 4000);
      } else if (hit.id === B.POLYHALITE && level < 6) {
        dropId = B.COBBLE;
        tooGreen = true;
        this.ui.toast("Tha’s too green to read t’ seam — got bare stone (requires Prospecting level 6).", 4000);
      }

      this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5, dropId, 1);

      // Award XP
      let xpGained = 0;
      if (hit.id === B.COAL_ORE) xpGained = 1;
      else if (hit.id === B.IRON_ORE || hit.id === B.ALUM_SHALE) xpGained = 2;
      else if (hit.id === B.ROCK_SALT) xpGained = 3;
      else if (hit.id === B.JET_ORE && !tooGreen) xpGained = 5;
      else if (hit.id === B.POLYHALITE && !tooGreen) xpGained = 10;

      if (xpGained > 0) {
        this.player.miningSkill = (this.player.miningSkill || 0) + xpGained;
        const newLvl = Math.floor(Math.sqrt(this.player.miningSkill / 10));
        if (newLvl > level) {
          this.ui.toast("🎉 <b>Prospecting level up!</b> Tha’s now level " + newLvl + ".", 5000);
        }
      }
    }
    this.quests.onBlockBroken(hit.x, hit.y, hit.z, hit.id);
    this.milestones.onBreak(hit.id);
    const eph = this.beachEphemeral(hit.x, hit.y, hit.z);
    if (this.net) this.net.sendEdit(hit.x, hit.y, hit.z, 0, hit.id, categoryOf(hit.id, 0), this.sky.day, this.player.name || '');
    if (eph) this.queueBeachRevert(hit.x, hit.y, hit.z, hit.id, 0);
    this.world.recordEdit(hit.x, hit.y, hit.z, hit.id, 0, this.sky.day, this.player.name || ''); // harvest edits regrow

    // fossil hunting: t' bay sands give up their dead, like Whitby an' Bay Town
    if ((hit.id === B.SAND || hit.id === B.GRAVEL) && !this.player.creative) {
      const geo = this.world.gen.geo;
      const ct = geo.coastT(hit.x, hit.z);
      if (ct > 0.1) {
        const inBay = hit.z > 220 && hit.z < 460;
        const r = Math.random();
        const mult = inBay ? 2 : 1; // Robin Hood's Bay is t' spot
        if (r < 0.008 * mult) {
          this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, I.JET_GEM, 1, { big: true });
          this.ui.toast('Summat black an\u2019 glossy in t\u2019 sand \u2014 <b>Whitby jet</b>, washed frae t\u2019 cliffs!', 5000);
        } else if (r < 0.035 * mult) {
          this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, I.AMMONITE, 1, { big: true });
          this.ui.toast('An <b>ammonite</b>! A snakestone, curled up these two hundred million years.', 5000);
        } else if (r < 0.055 * mult) {
          this.entities.spawnDrop(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, I.GRYPHAEA, 1, { big: true });
          this.ui.toast('A <b>Devil\u2019s Toenail</b> \u2014 an owd oyster turned to stone. Grand.', 5000);
        }
      }
    }
  }

  useItem() {
    if (this.player.dead) return;

    // Starting 'tokens': stake a claim / register a mining licence wherever tha
    // stands. Free, one-use — consumed only on a successful stake.
    const held0 = this.player.heldItem();
    if (held0 && held0.id === I.CLAIM_TOKEN) {
      const staked = this.stakeClaim(8, true);
      if (staked && !this.freeWorld()) this.player.consumeHeld();
      if (staked && this.freeWorld()) this.ui.toast("Homestead claimed — keep thi stock here an’ breed t’ animals. Token keeps for t’ next plot.", 5000);
      return;
    }
    if (held0 && held0.id === I.MINE_LICENCE) {
      const p = this.player.pos;
      if (this.stakeMine(Math.round(p.x), Math.round(p.z), 20, true)) this.player.consumeHeld();
      return;
    }

    const hit = this.targetBlock();

    // a villager to natter wi'?
    {
      const eye = this.player.eyePos();
      const d = this.lookDir();
      const mobHit = this.entities.raycastMobs(eye.x, eye.y, eye.z, d.x, d.y, d.z, 4.5);
      if (mobHit && (!hit || mobHit.dist < hit.dist)) {
        const m = mobHit.mob;
        const fh = this.player.heldItem();
        // sneak + right-click thi OWN beast: keep her here (start a pen) or bring her to heel
        if (m.owner && this.keys['ShiftLeft']) { this.petKeep(m); return; }
        if (m.type === 'coble' && !this.boat && !this.mount) { this.enterBoat(m); return; }
        // feed a tameable beast its favourite scran to win her over (a pony an' all)
        if (!m.owner && m.t && m.t.tameable && fh && m.t.tameFood && m.t.tameFood.includes(fh.id)) { this.feedTame(m, fh); return; }
        if (m.type === 'pony' && !this.mount) { this.mountPony(m); return; }
        if (m.type === 'villager') {
          if (m.isRemotePlayer) {
            const held = this.player.heldItem();
            if (held) {
              this.giveToRemote(m, held);
            } else {
              this.ui.toast(`That's <b>${escHtml(m.displayName)}</b> — another living soul. Hold summat in hand an' right-click to give it, or press <b>T</b> to chat.`, 5000);
            }
            return;
          }
          this.openChat(m); return;
        }
        if (m.owner) { this.petInteract(m); return; }
      }
    }

    // interactable blocks
    if (hit && !this.keys['ShiftLeft']) {
      const wgeo = this.world.gen.geo;
      if (wgeo.worksAt) { const w = wgeo.worksAt(hit.x, hit.z); if (w) { this.openWorks(w); return; } }
      if (hit.id === B.BENCH) { this.openInventory(); return; }
      if (hit.id === B.STRONGBOX) { this.openStrongbox(hit.x, hit.y, hit.z); return; }
      if (hit.id === B.BOARD) {
        const geo = this.world.gen.geo;
        if (geo.isMuseumBoard(hit.x, hit.z)) { this.openMuseum(); return; }
        const st = geo.nearStation(hit.x, hit.z, 8);
        if (st) { this.openStation(st); return; }
        this.openBoard(true); return;
      }
      if (hit.id === B.INN_DOOR) {
        for (const p of this.world.gen.inns.values()) {
          const { x0, z0, x1, z1 } = p.protectedBox;
          if (hit.x >= x0 && hit.x <= x1 && hit.z >= z0 && hit.z <= z1) {
            // below-ground door = the parlour's exit; surface door = the way in.
            this.crossThreshold(p, hit.y >= p.groundY);
            break;
          }
        }
        return;
      }
      if (hit.id === B.SIGNPOST) { this.readSignpost(); return; }
      if (hit.id === B.RANGE) {
        this.state = 'range';
        this.clearKeys();
        this.mouseDown = [false, false, false];
        document.exitPointerLock?.();
        this.ui.openRange(this.player);
        return;
      }
    }

    // Forage pick: right-click on a grass surface to gather in-season scatter forage
    // Gate: skip when the player is holding a placeable block (let the block-place path run instead)
    const _fh = this.player.heldItem();
    if (hit && hit.face[1] === 1 && this.season && (!_fh || !isPlaceable(_fh.id))) {
      const cx = hit.x, cz = hit.z, spriteY = hit.y + 1;
      const onForageGround =
        this.world.getBlock(cx, hit.y, cz) === B.GRASS &&
        this.world.getBlock(cx, spriteY, cz) === B.AIR &&
        !this.world.gen.geo.inVillage(cx, cz, 1);
      const seed = this.world.gen.seed >>> 0;
      const active = activeForageables(this.season);
      for (const { tile, item } of active) {
        if (onForageGround &&
            cellInstances(seed, cx, cz, 'forage', tile).length &&
            !this.world.isForaged(cx, spriteY, cz)) {
          this.world.recordForage(cx, spriteY, cz, this.sky.day);
          this.player.addItem(item, 1);
          this.ui.invDirty = true;
          if (this.floraLayer) this.floraLayer.center = null; // force visual rebuild
          this.ui.toast(`Picked up ${itemName(item)}.`);
          return;
        }
      }
    }

    // Host-bush forage: right-click a berried bush to pick the fruit; the bush stays.
    if (hit && this.season && (!_fh || !isPlaceable(_fh.id))) {
      const h = hostForageFor(hit.id, this.season);
      if (h && !this.world.isForaged(hit.x, hit.y, hit.z)) {
        this.world.recordForage(hit.x, hit.y, hit.z, this.sky.day);
        this.player.addItem(h.item, 1);
        this.ui.invDirty = true;
        if (this.floraLayer) this.floraLayer.center = null;
        this.ui.toast(`Picked ${itemName(h.item)}.`);
        return;
      }
    }

    // Orchard fruit: right-click an orchard canopy to pick the fruit; the tree stays.
    if (hit && hit.id === B.ORCHARD_LEAVES && fruitTreeRipe(this.season) && (!_fh || !isPlaceable(_fh.id))) {
      const surfY = this.world.gen.height(hit.x, hit.z);
      let fy = null;
      for (let dy = 2; dy <= 8; dy++) {
        if (this.world.getBlock(hit.x, surfY + dy, hit.z) === B.ORCHARD_LEAVES) { fy = surfY + dy; break; }
      }
      if (fy != null && !this.world.isForaged(hit.x, fy, hit.z)) {
        const sp = fruitSpeciesAt(this.world.gen.seed >>> 0, hit.x, hit.z);
        this.world.recordForage(hit.x, fy, hit.z, this.sky.day);
        this.player.addItem(sp.item, 1);
        this.ui.invDirty = true;
        if (this.floraLayer) this.floraLayer.center = null;
        this.ui.toast(`Picked ${itemName(sp.item)}.`);
        return;
      }
    }

    // Snowman: customise / scoop snowball / build — all gated on festive season
    if (hit && this.season) {
      const sx = hit.x, sz = hit.z, sy = this.world.gen.height(sx, sz) + 1;
      const sm = this.world.getSnowman(sx, sy, sz);

      // (a) Customise: right-click a player snowman with bare or non-placeable hand
      if (sm && (!_fh || !isPlaceable(_fh.id))) {
        const parts = ['scarf', 'hat', 'nose', 'arms', 'smile'];
        this._smPart = ((this._smPart || 0) + 1) % parts.length;
        this.world.recordSnowman(sx, sy, sz, cycleSnowman(sm.cfg, parts[this._smPart]), sm.day);
        if (this.seasonalLayer) this.seasonalLayer.center = null;
        this.ui.toast('Dressed t’ snowman.'); return;
      }

      // (b) Scoop a snowball: bare/non-placeable hand, deep snow, top cell is AIR
      if (!sm && (!_fh || !isPlaceable(_fh.id)) && deepSnow(this.snowAccum) && wintry(this.season)) {
        const top = this.world.getBlock(sx, sy, sz);
        if (top === B.AIR) {
          this.player.addItem(I.SNOWBALL, 1); this.ui.invDirty = true;
          this.ui.toast('Scooped a snowball.'); return;
        }
      }
    }

    // (c) Build a snowman: holding ≥3 snowballs, right-click ground, top cell AIR, no snowman there yet
    if (_fh && _fh.id === I.SNOWBALL && hit && this.season) {
      const sx = hit.x, sz = hit.z, sy = this.world.gen.height(sx, sz) + 1;
      if (this.player.countItem(I.SNOWBALL) >= 3 &&
          !this.world.getSnowman(sx, sy, sz) &&
          this.world.getBlock(sx, sy, sz) === B.AIR) {
        this.player.removeItem(I.SNOWBALL, 3);
        this.world.recordSnowman(sx, sy, sz, { ...DEFAULT_SNOWMAN }, this.sky.day);
        if (this.seasonalLayer) this.seasonalLayer.center = null;
        this.ui.toast('Built a snowman — right-click to dress it.'); return;
      }
    }

    const held = this.player.heldItem();
    if (!held) return;

    // a fishing rod? cast toward t' watter, or reel in
    if (held.id === I.FISHING_ROD) { this.useRod(); return; }

    // scran — but if tha's holding a beast's favourite an' facing her, feed her instead o' scrannin' it
    if (FOODS[held.id]) {
      const tame = this.aimedTameable();
      if (tame && tame.t.tameFood && tame.t.tameFood.includes(held.id)) { this.feedTame(tame, held); return; }
      if (this.player.eat(this.player.hotbar, this.audio)) this.ui.invDirty = true;
      else if (this.player.hunger >= 20) this.ui.toast('Tha&rsquo;s full to bustin&rsquo;.');
      return;
    }

    // place a block
    if (!isPlaceable(held.id) || !hit) return;
    let px, py, pz;
    if (isCutout(this.world.getBlock(hit.x, hit.y, hit.z))) {
      px = hit.x; py = hit.y; pz = hit.z; // replace plants
    } else {
      px = hit.x + hit.face[0]; py = hit.y + hit.face[1]; pz = hit.z + hit.face[2];
    }
    if (py < 1 || py >= HEIGHT) return;
    const cur = this.world.getBlock(px, py, pz);
    if (isSolid(cur)) return;
    // would it squash t' player?
    if (BLOCKS[held.id].kind === 'solid') {
      const p = this.player.pos;
      const overlap =
        px + 1 > p.x - this.player.hw && px < p.x + this.player.hw &&
        pz + 1 > p.z - this.player.hw && pz < p.z + this.player.hw &&
        py + 1 > p.y && py < p.y + this.player.h;
      if (overlap) return;
    }
    // plants need summat solid underneath
    if (BLOCKS[held.id].kind === 'cutout' && !isSolid(this.world.getBlock(px, py - 1, pz))) return;

    this.world.setBlock(px, py, pz, held.id);
    if (held.id === B.HOME_FLAG) this.setHomeBase(px, py, pz); // planting a flag marks thi home
    // a fresh strongbox starts empty: clear any stale contents left keyed at this coord
    // (e.g. the block was broken by another player on t' shared moor — edits sync, local
    // box data doesn't, an' a new box mustn't inherit a ghost stash)
    // placing a strongbox where a stash already lives ADOPTS it rather than wiping it —
    // on t' shared moor thi contents are thine own browser's memory, so if another soul
    // broke thi box, re-placing one on t' same spot gets thi goods back (no dupe: the
    // stash only ever exists in one browser's store, an' breaking thi own box spills it)
    this.entities.lastBuild = { x: px + 0.5, z: pz + 0.5, t: performance.now() }; // so nosy folk can come have a look
    if (!this.player.creative) this.player.consumeHeld();
    this.audio.place();
    this.ui.invDirty = true;
    this.quests.onBlockPlaced(px, py, pz, held.id);
    this.milestones.onPlace(held.id);
    const eph = this.beachEphemeral(px, py, pz);
    if (this.net) this.net.sendEdit(px, py, pz, held.id, cur, 'build', this.sky.day, this.player.name || '');
    if (eph) this.queueBeachRevert(px, py, pz, cur, held.id);
    this.world.recordEdit(px, py, pz, cur, held.id, this.sky.day, this.player.name || ''); // a build supersedes pending regrowth
  }

  // ---------------- taming & companions ----------------
  // Feed a tameable beast its favourite scran; enough goes an' she's thine.
  feedTame(m, held) {
    const r = this.entities.tameStep(m, held.id, this.player);
    if (r === 'wrongfood') { this.ui.toast('She’ll not take to that, love.'); return; }
    this.player.consumeHeld();
    this.ui.invDirty = true;
    if (this.audio && this.audio.place) this.audio.place();
    if (r.tamed) {
      const farm = !PET_KINDS.includes(m.petKind); // dog/cat/pig/rat follow; horses, cattle, sheep are farm stock
      const rec = { kind: m.petKind, name: r.name, stay: farm };
      if (farm) { m.stay = true; m.home = { x: m.pos.x, y: m.pos.y, z: m.pos.z }; rec.home = { ...m.home }; }
      (this.player.pets || (this.player.pets = [])).push(rec);
      // The first companion a player ever tames becomes their daemon — bound to their token,
      // present on every moor, immune to world resets. First-wins (the relay keeps it for good).
      if (this.net && !this.net.daemon && this.player.pets.length === 1) {
        rec.daemon = true;
        this.net.registerDaemon(rec);
        this.ui.toast(`✨ <b>${r.name}</b> is thi <b>daemon</b> now — thi lifelong companion. She’ll find thee in any moor, always, come what may.`, 9000);
      }
      if (farm) {
        this.ui.toast(`<b>${r.name}</b> is thine now — she’ll bide here an’ graze. <b>Fence her in</b> for a proper pen; sneak + right-click her to lead her elsewhere.`, 8000);
      } else {
        const benefit = PET_BENEFIT[m.petKind];
        this.ui.toast(`<b>${r.name}</b> has taken to thee — she’ll follow tha about.` + (benefit ? ` She ${benefit}.` : '') + ` (Sneak + right-click to leave her grazing.)`, 8000);
      }
      this.saveNow(false);
    } else {
      const pct = Math.round(r.progress * 100);
      this.ui.toast(`She takes it frae thi hand… (${pct}%${pct >= 60 ? ', warmin’ to thee' : ''})`, 2500);
    }
  }

  // Right-click a kept beast to set her to her work.
  petInteract(m) {
    const k = m.petKind;
    if (k === 'cat') {
      if (this.entities.catScout(m)) this.ui.toast(`<b>${m.petName}</b> slinks off to scout t’ ground… she’ll bring summat back.`, 4500);
      else this.ui.toast(`<b>${m.petName}</b>’s already off scoutin’.`, 2500);
    } else if (k === 'pig') {
      if (this.entities.pigSnuffle(m, this.player) === 'tired') this.ui.toast(`<b>${m.petName}</b>’s snuffled herself out — give her a minute.`, 2500);
    } else if (k === 'dog') {
      this.ui.toast(`<b>${m.petName}</b> looks up at thee, tail going — she keeps t’ neet-things off thee.`, 3500);
    } else {
      this.ui.toast(`<b>${m.petName}</b>’s at thi heel.`, 2500);
    }
  }

  // Sneak + right-click thi own beast: leave her grazing here (start/extend a pen) or fetch her to heel.
  petKeep(m) {
    m.stay = !m.stay;
    const rec = (this.player.pets || []).find(p => p.name === m.petName);
    if (m.stay) {
      m.home = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
      if (rec) { rec.stay = true; rec.home = { ...m.home }; }
      this.ui.toast(`<b>${m.petName}</b> will bide here an’ graze. Fence her in for thi farm.`, 5000);
    } else {
      m.home = null;
      if (rec) { rec.stay = false; rec.home = null; }
      this.ui.toast(`<b>${m.petName}</b> falls in at thi heel — lead her where tha wants her.`, 4000);
    }
    if (this.audio && this.audio.place) this.audio.place();
    this.saveNow(false);
  }

  // ---------------- fishing: cast an' wait ----------------
  useRod() {
    const f = this.fishing;
    if (f && f.active) { // already out — reel in
      if (f.state === 'biting') this.landFish();
      else this.endFishing('Tha reeled in early — nowt bit.');
      return;
    }
    // recast cooldown on non-free worlds: let the line settle (2 s)
    if (!this.freeWorld() && this._lastCast) {
      const now = performance.now() / 1000;
      if (now - this._lastCast < 2) {
        if (!this._castCooldownToast || now - this._castCooldownToast > 3) {
          this._castCooldownToast = now;
          this.ui.toast('Let t’ line settle first.', 1800);
        }
        return;
      }
    }
    if (this.season && this.season.warmth < -0.4) {
      this.ui.toast('T’ beck’s froze over — nowt’s biting while it’s this cold.', 2500);
      return;
    }
    const eye = this.player.eyePos();
    const d = this.lookDir();
    const w = raycast(this.world, eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH + 2, id => id === B.WATER);
    if (!w) { this.ui.toast('Cast toward t’ watter, love — a beck, tarn or t’ sea.'); return; }
    // float rides t' top o' t' water column
    let sy = w.y;
    while (sy < HEIGHT - 1 && this.world.getBlock(w.x, sy + 1, w.z) === B.WATER) sy++;
    const ct = this.world.gen.geo.coastT(w.x, w.z);
    const coast = ct > 0.1;
    const deep = ct > 0.5 || !!this.boat; // out in t' deep (or fishing frae a coble) gives the best of it
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xd83a2a }));
    bob.position.set(w.x + 0.5, sy + 1.02, w.z + 0.5);
    this.scene.add(bob);
    this.fishing = { active: true, state: 'waiting', bob, x: w.x, y: sy + 1, z: w.z, coast, deep,
      t: 0, biteAt: 2.5 + Math.random() * (coast ? 4 : 6), biteWindow: 0, baseY: sy + 1.02 };
    this._lastCast = performance.now() / 1000;
    this.audio.place && this.audio.place();
    this.ui.toast('Line’s in t’ watter — wait for a bite…', 2500);
  }

  updateFishing(dt) {
    const f = this.fishing;
    if (!f || !f.active) return;
    const held = this.player.heldItem();
    if (!held || held.id !== I.FISHING_ROD || this.player.dead || this.state !== 'playing') { this.endFishing(); return; }
    if (Math.hypot(this.player.pos.x - (f.x + 0.5), this.player.pos.z - (f.z + 0.5)) > 9) { this.endFishing('Tha wandered off — t’ line went slack.'); return; }
    f.t += dt;
    if (f.state === 'waiting') {
      f.bob.position.y = f.baseY + Math.sin(f.t * 2) * 0.03; // gentle bob
      if (f.t >= f.biteAt) {
        f.state = 'biting'; f.biteWindow = 1.3; f.t = 0;
        this.ui.toast('<b>A bite!</b> Right-click sharp to reel her in!', 1400);
        this.audio.pickup && this.audio.pickup();
      }
    } else if (f.state === 'biting') {
      f.bob.position.y = f.baseY - 0.16 + Math.sin(f.t * 34) * 0.05; // t' float jerks under
      f.biteWindow -= dt;
      if (f.biteWindow <= 0) this.endFishing('She got away — too slow on t’ reel.');
    }
  }

  landFish() {
    const f = this.fishing;
    if (f.deep && Math.random() < 0.09) {
      // the deep gives up odd treasures — sea-washed jet, a snakestone, a lump o' sea-coal
      const finds = [[I.JET_GEM, 'sea-washed jet'], [I.AMMONITE, 'a snakestone off t’ sea bed'], [I.COAL_LUMP, 'a lump o’ sea-coal']];
      const [it, nm] = finds[(Math.random() * finds.length) | 0];
      this.player.addItem(it, 1);
      this.ui.toast(`Summat snagged on thi hook out in t’ deep — <b>${nm}</b>!`, 4500);
    } else {
      const fish = f.coast ? (Math.random() < 0.8 ? I.SEA_FISH : I.RAW_TROUT)   // mackerel an' cod off t' coast
                           : (Math.random() < 0.85 ? I.RAW_TROUT : I.SEA_FISH); // trout in t' becks an' tarns
      const dbl = this.freeWorld() ? 0.4 : 0.2; // free world keeps the generous haul; survival nerfs it
      const n = (f.deep && Math.random() < dbl) ? 2 : 1; // a fuller net out at sea
      this.player.addItem(fish, n);
      this.ui.toast(`Tha’s landed <b>${n > 1 ? 'a fine haul o’ sea fish' : (fish === I.SEA_FISH ? 'a fine sea fish' : 'a bonny brown trout')}</b>!`, 3000);
    }
    this.ui.invDirty = true;
    this._lastCast = performance.now() / 1000;
    this.audio.pickup && this.audio.pickup();
    this.endFishing();
  }

  endFishing(msg) {
    const f = this.fishing;
    if (f && f.bob) this.scene.remove(f.bob);
    this.fishing = null;
    if (msg) this.ui.toast(msg, 3000);
  }

  // ---------------- t' healing sands ----------------
  // Beach edits aren't forever: t' tide smooths t' sands back ower a few
  // minutes, so t' fossil grounds aren't ruined for t' next comer. T' relay
  // does t' same server-side for t' shared moor.
  beachEphemeral(x, y, z) {
    if (!this.world) return false;
    return this.world.gen.geo.coastT(x, z) > 0.25 && y <= WATER_LEVEL + 4;
  }

  queueBeachRevert(x, y, z, oldId, newId) {
    this.beachReverts = this.beachReverts || [];
    this.beachReverts.push({ x, y, z, oldId, newId, at: performance.now() / 1000 + 180 + Math.random() * 120 });
  }

  processBeachReverts() {
    if (!this.beachReverts || !this.beachReverts.length || !this.world) return;
    const now = performance.now() / 1000;
    for (let i = this.beachReverts.length - 1; i >= 0; i--) {
      const r = this.beachReverts[i];
      if (now < r.at) continue;
      this.beachReverts.splice(i, 1);
      if (!this.world.isLoaded(r.x, r.z)) continue; // chunk's gone — t' relay covers t' shared moor
      if (this.world.getBlock(r.x, r.y, r.z) !== r.newId) continue; // summat else changed it since
      this.world.setBlock(r.x, r.y, r.z, r.oldId);
      if (this.world.netEdits) this.world.netEdits.delete(`${r.x},${r.y},${r.z}`);
    }
  }

  // ---------------- folklore manifestations ----------------
  // The visible giants (Wade & Bell): while the player is on the Wade quest, near
  // Wade's Causeway, at dusk/night, two colossal figures stride the far skyline and
  // fade by day / off-quest / away. Moors-only (early return otherwise — the stylised
  // world is untouched and pays nothing beyond this guard). The giants are a special
  // mob (entities.giant) that skips all mob AI; they are spawned, posed and despawned
  // here, exactly as a coble is driven by the game. The spawn predicate is the pure
  // wantGiants() (tested in verify-quests.mjs).
  updateQuestFx(dt) {
    const geo = this.world.gen.geo;
    if (!geo.realWorld) return;                                  // moors only
    const q = this.quests.activeManifestation && this.quests.activeManifestation('giants');
    const lm = q && this.quests.resolveLandmark(q);             // {x,z} of Wade's Causeway
    // dusk/night/midnight window: from dusk onset, through the night, into pre-dawn
    // ([SOLAR]: anchored to the seasonal sunset/sunrise — equinox = the old 0.74/0.2 exactly)
    const _sol = this.sky && this.sky.sol;
    const dusk = !!(this.sky && (this.sky.isNight() || this.sky.time >= _sol.sunsetT - 0.01 || this.sky.time < _sol.sunriseT - 0.05));
    const near = !!(lm && Math.hypot(this.player.pos.x - lm.x, this.player.pos.z - lm.z) < 220);
    // any giant we spawned that's since been cleared (world reset) — forget them
    if (this._giants && this._giants.some(g => g.dead)) this._giants = null;
    const want = wantGiants({ realWorld: geo.realWorld, questActive: !!q, dusk, near });

    if (want && !this._giants) {
      // spawn Wade + Bell on the moor-top skyline, offset so they read as distant figures
      const seat = (x, z) => geo.height(Math.round(x), Math.round(z)) + 1.0; // feet on the deck
      const a = this.entities.spawnMob('giant', lm.x + 80, 0, lm.z + 40);
      const b = this.entities.spawnMob('giant', lm.x + 120, 0, lm.z - 30);
      a.pos.y = seat(a.pos.x, a.pos.z);
      b.pos.y = seat(b.pos.x, b.pos.z);
      // a slow stride path each walks, back and forth along the skyline (yaw follows it)
      a.stride = { ox: a.pos.x, oz: a.pos.z, t: 0, dir: 0.7 };
      b.stride = { ox: b.pos.x, oz: b.pos.z, t: Math.PI, dir: -0.5 };
      this._giants = [a, b];
    } else if (!want && this._giants) {
      for (const g of this._giants) { this.entities.scene.remove(g.model.group); g.dead = true; }
      this._giants = null;
    }

    if (this._giants) {
      for (const g of this._giants) {
        // a slow, ponderous stride: drift along the skyline and bob the legs
        const s = g.stride;
        s.t += dt * 0.18;                                        // very slow
        const along = Math.sin(s.t) * 22;                       // sway ±22 m along the ridge
        g.pos.x = s.ox + Math.cos(s.dir) * along;
        g.pos.z = s.oz + Math.sin(s.dir) * along;
        g.pos.y = geo.height(Math.round(g.pos.x), Math.round(g.pos.z)) + 1.0; // stay seated on terrain
        g.yaw = s.dir + (Math.cos(s.t) < 0 ? Math.PI : 0);     // face the way it's striding
        g.walkPhase = (g.walkPhase || 0) + dt * 1.4;            // slow leg swing
        const swing = Math.sin(g.walkPhase * Math.PI) * 0.45;
        g.model.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? swing : -swing); });
        g.model.group.position.set(g.pos.x, g.pos.y, g.pos.z);
        g.model.group.rotation.y = g.yaw;
      }
    }

    // ---- Slice 3: the Demeter wreck + the black hound (Dracula opening chapters) ----
    // Both are quest-gated spectacle, moors-only (we already returned if !realWorld).
    // `onOpening` = the player is on drac1/drac2 (the Whitby opening). The wreck sits aground
    // on the strand throughout the opening; the hound only bounds up the 199 steps at night.
    const onOpening = !!(this.quests.draculaOnOpening && this.quests.draculaOnOpening());
    const night = !!(this.sky && this.sky.isNight());
    const harbour = geo.whitbyHarbour ? geo.whitbyHarbour() : null;
    const abbeyLm = geo._abbeyLandmark ? geo._abbeyLandmark() : null;

    // forget a wreck/hound the world reset out from under us
    if (this._demeter && this._demeter.dead) this._demeter = null;
    if (this._hound && this._hound.dead) this._hound = null;

    // -- the Demeter wreck: a static, listing prop seated on the strand --
    const wantWk = wantWreck({ realWorld: geo.realWorld, onOpening }) && !!harbour;
    if (wantWk && !this._demeter) {
      // seat her just off the waterline, bow toward the shore, heeled over to port
      const wx = harbour.x - 6, wz = harbour.z + 2;
      const wy = geo.height(Math.round(wx), Math.round(wz)) + 0.2;
      const w = this.entities.spawnMob('wreck', wx, wy, wz);
      w.yaw = 1.1;                        // lying askew across the strand
      w.model.group.rotation.set(0.18, w.yaw, 0.32);   // pitched + listing to port
      w.model.group.position.set(w.pos.x, w.pos.y, w.pos.z);
      this._demeter = w;
    } else if (!wantWk && this._demeter) {
      this.entities.scene.remove(this._demeter.model.group); this._demeter.dead = true; this._demeter = null;
    }
    // investigate her (within a few blocks) -> the captain's log, granted exactly once
    if (this._demeter) {
      const d = Math.hypot(this.player.pos.x - this._demeter.pos.x, this.player.pos.z - this._demeter.pos.z);
      if (d < 6) this.quests.grantDraculaLog();
    }

    // -- the black hound: bounds from the harbour up the East-Cliff line to the abbey, at neet --
    const wantHd = wantHound({ realWorld: geo.realWorld, onOpening, night }) && !!harbour && !!abbeyLm;
    if (wantHd && !this._hound) {
      // a run from the strand (t=0) up toward the abbey on the East Cliff (t=1)
      const from = { x: harbour.x, z: harbour.z };
      const to = { x: abbeyLm.x, z: abbeyLm.z };
      const h = this.entities.spawnMob('houndspectre', from.x, geo.height(Math.round(from.x), Math.round(from.z)) + 1.0, from.z);
      h.run = { from, to, t: 0 };
      this._hound = h;
    } else if (!wantHd && this._hound) {
      this.entities.scene.remove(this._hound.model.group); this._hound.dead = true; this._hound = null;
    }
    if (this._hound) {
      const r = this._hound.run;
      r.t += dt * 0.12;                                  // a steady bound up the cliff (~8 s a run)
      const k = r.t % 1;                                 // loop the ascent, fading near the top
      const x = r.from.x + (r.to.x - r.from.x) * k;
      const z = r.from.z + (r.to.z - r.from.z) * k;
      const y = geo.height(Math.round(x), Math.round(z)) + 1.0;
      this._hound.pos.x = x; this._hound.pos.z = z; this._hound.pos.y = y;
      this._hound.yaw = Math.atan2(r.to.z - r.from.z, r.to.x - r.from.x);
      // a loping stride + a low spring in the bound
      this._hound.walkPhase = (this._hound.walkPhase || 0) + dt * 7;
      const swing = Math.sin(this._hound.walkPhase * Math.PI) * 0.6;
      this._hound.model.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? swing : -swing); });
      const bound = Math.abs(Math.sin(this._hound.walkPhase * Math.PI)) * 0.35;
      // fade out as it nears the top (k>0.7) or the player closes on it — spectral, never reached
      const distP = Math.hypot(this.player.pos.x - x, this.player.pos.z - z);
      const fade = Math.max(0, Math.min(1, (1 - Math.max(0, (k - 0.7) / 0.3)) * Math.min(1, (distP - 6) / 10)));
      this._hound.model.group.traverse(o => { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = 0.35 + fade * 0.45; } });
      this._hound.model.group.position.set(x, y + bound, z);
      this._hound.model.group.rotation.y = this._hound.yaw;
    }
  }

  // ---------------- loading ----------------
  // One stride o' world generation while t' loading screen's up. Driven from frame()
  // (rAF) when t' tab's visible, an' from t' setTimeout fallback below when it's hidden —
  // t' browser parks requestAnimationFrame in a background tab, so wi'out this a kid who
  // starts a world an' flicks to another tab comes back to a loading screen stood still.
  stepLoading() {
    if (this.state !== 'loading') return;
    this.world.update(this.player.pos.x, this.player.pos.z);
    // mesh aggressively while loading
    for (let i = 0; i < 6; i++) this.world.update(this.player.pos.x, this.player.pos.z);
    if (this.world.readyAround(this.player.pos.x, this.player.pos.z, 2)) {
      this.state = 'playing';
      this.ui.show(null);
      this.ui.toast('Tha wakes on Moorstead green. Click to grab t&rsquo; mouse.', 6000);
      this.ui.toast('Punch a tree for wood, or dig owt wi&rsquo; thi hands.', 6000);
      this.spawnVillagers();
      if (this.netActive) this.connectNet();
      if (!this.player.onboarded) {
        this.player.onboarded = true;
        if (this.saveNow) this.saveNow(false);
        setTimeout(() => {
          this.ui.toast('👋 <b>Welcome to Moorstead!</b> Punch a tree for wood — then press <b>E</b> to open thi pack.', 8000);
        }, 2500);
        setTimeout(() => {
          this.ui.toast('📋 Find a <b>notice board</b> for jobs, or walk up to a villager an’ press <b>T</b> to talk.', 8500);
        }, 7000);
        // NB: do NOT auto-open the handbook here — it pauses the game while the pointer is still
        // locked to the canvas, so the player can't click to close it (it traps gameplay). The
        // welcome toasts above guide newcomers; the handbook stays one click away on "Ow Ter Play".
        setTimeout(() => {
          this.ui.toast('👉 New here? <b>Ow Ter Play</b> on the pause menu (<b>Esc</b>) has the full guide.', 8000);
        }, 11500);
      }
    }
  }

  // T' hidden-tab fallback: a modest 50ms tick that only steps while t' document's
  // hidden AND we're still loading — t' moment t' tab's visible again (or loading's
  // done) it stands down, so it can never double-step alongside t' rAF path.
  startBgLoading() {
    if (this._bgLoadTimer != null) return;   // one loop at a time
    const tick = () => {
      this._bgLoadTimer = null;
      if (!document.hidden || this.state !== 'loading') return;
      this.stepLoading();
      if (this.state === 'loading') this._bgLoadTimer = setTimeout(tick, 50);
    };
    this._bgLoadTimer = setTimeout(tick, 50);
  }

  // ---------------- per-frame ----------------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());

    if (this.state === 'title') {
      if (!this.world && !this.titlePreviewFailed) this.startTitlePreview();
      if (this.titlePreview && this.world) {
        this.titleT += dt;
        this._titleSceneT += dt;
        this.updateTrainWorld(dt);   // keep the main-line train running on its schedule
        this.updateBranchTrains(dt); // …and a train on every branch — the whole network's alive
        const SCENE_DUR = 30, FADE = 0.7;
        // flip to the next vignette when this one's had its turn (it's faded out by now — see below)
        if (this._titleSceneT >= SCENE_DUR) {
          this._titleSceneIdx = (this._titleSceneIdx + 1) % this._titleScenes.length;
          this._titleSceneT = 0;
          this._titleRevealT = null;  // the new region must stream before we fade it back in
          this.titleCamY = null;      // re-anchor the orbit height onto the new line's train
          this._titleRideYaw = null;  // re-anchor the ride-view heading onto the new line
          this.rideSmoothYaw = undefined; this.rideYawSet = false; // re-seed the in-game ride camera for the new line
          const ns = this._titleScenes[this._titleSceneIdx];
          this.sky.snowAmount = ns.snowing ? 1 : 0;  // SNAP the falling snow so winter doesn't bleed into a summer scene
        }
        const scene = this._titleScenes[this._titleSceneIdx];
        // follow THIS scene's train: a named branch (Esk Valley / Coast Line), else the main line (the moors)
        const br = scene.line ? (this.branchTrains || []).find(b => b.name === scene.line && b.state) : null;
        const ts = br ? br.state : this.trainState;
        const ax = ts ? ts.x : this.player.pos.x, az = ts ? ts.z : this.player.pos.z;
        // Follow the SMOOTH rail deck under the train (not the stepped raw terrain), then damp it —
        // so the orbit glides over cuttings an' embankments instead of jolting at every gradient.
        const cs = ts && ts.s && typeof ts.s.s === 'number' ? ts.s.s : null;
        const anchorY = cs != null ? (br ? this.world.gen.geo.samplePosOn(br.path, cs).deck : this.world.gen.geo.samplePos(cs).deck)
                                   : this.world.gen.height(Math.floor(ax), Math.floor(az));
        this.titleCamY = this.titleCamY == null ? anchorY : this.titleCamY + (anchorY - this.titleCamY) * Math.min(1, dt * 3);
        const gy = this.titleCamY;
        this.player.pos.x = ax; this.player.pos.y = gy + 2; this.player.pos.z = az; // centre everything on the train
        const ready = this.world.readyAround(ax, az, 1);
        for (let i = 0; i < (ready ? 2 : 6); i++) this.world.update(ax, az);
        if (ready && this._titleRevealT == null) this._titleRevealT = this.titleT; // moment this scene finished streaming
        // force THIS scene's season: light of day, snow cover, and precipitation
        this.sky.time = scene.skyTime;
        const lightSeason = seasonStateAtPhase(scene.phase);
        setSnowLevel(scene.snow);
        this.sky.stormPrecip = scene.precip; this.sky.stormIsSnow = scene.snowing;
        if (this._seasonBucket !== 90 + this._titleSceneIdx) { this._seasonBucket = 90 + this._titleSceneIdx; retintAtlasForSeason(lightSeason); }
        this.sky.update(dt, this.player.pos, lightSeason, false);
        if (this.rails) this.rails.update(dt, { x: ax, z: az });
        if (this.roads) this.roads.update(dt, { x: ax, z: az }, this.groundWet);
        if (this.rosterClient) { this.rosterClient.update(dt); this._titlePopulateTrain(br); } // drive the roster + keep the watched train busy with boarders
        this.entities.update(dt, this.player, false, this.audio, () => {});
        const orbitCam = () => {
          // a slow aerial orbit, following the steam train across the scene
          const a = this.titleT * 0.13;
          this.camera.position.set(ax + Math.cos(a) * 34, gy + 19, az + Math.sin(a) * 34);
          this.camera.lookAt(ax, gy + 4, az);
          this.camera.rotation.z += Math.sin(a) * 0.04;
        };
        const tm = br ? br.train : this.train;
        const carr = tm && tm.carriage && tm.carriage.group;
        const meshReady = carr && carr.parent;
        if (scene.cam === 'front' && meshReady) {
          // THE in-game driver camera (the one players choose riding a train) — it follows the loco
          // properly. updateRide sets player.pos/yaw/pitch; we then drive the camera off the player
          // exactly as the playing/riding states do.
          this.ride = { bt: br || null };
          this.rideView = 'driver';
          this.updateRide(dt);
          this.camera.position.set(this.player.pos.x, this.player.pos.y + this.player.eye, this.player.pos.z);
          this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
        } else if (scene.cam === 'window' && meshReady) {
          // look SQUARE out of the side at the passing country, riding the carriage. Smoothed heading.
          const target = br ? br.camYaw : (this.train ? this.train.camYaw : null);
          if (target != null) {
            if (this._titleRideYaw == null) this._titleRideYaw = target;
            else { let dY = target - this._titleRideYaw; while (dY > Math.PI) dY -= Math.PI * 2; while (dY < -Math.PI) dY += Math.PI * 2; this._titleRideYaw += dY * Math.min(1, dt * 4); }
            const sy = this._titleRideYaw, fx = Math.sin(sy), fz = Math.cos(sy), sx = -fz, sz = fx;
            const P = carr.position;
            this.camera.position.set(P.x + sx * 3.0, P.y + 1.9, P.z + sz * 3.0);
            this.camera.lookAt(P.x + sx * 50, P.y + 1.2, P.z + sz * 50);
            this.camera.rotation.z = 0;
          } else { orbitCam(); }
        } else {
          orbitCam(); // 'orbit', or the train mesh hasn't streamed in yet right after a flip
        }
        // cross-fade at each flip: fade the backdrop out over the last FADE secs of a scene, then
        // back in over FADE secs once the NEW region has streamed (gated on _titleRevealT — no pop-in).
        let op;
        if (this._titleSceneT > SCENE_DUR - FADE) op = Math.max(0, (SCENE_DUR - this._titleSceneT) / FADE);
        else if (this._titleRevealT == null) op = 0;
        else op = Math.min(1, (this.titleT - this._titleRevealT) / FADE);
        this.renderer.domElement.style.opacity = String(op);
        if (ready) document.getElementById('title-screen')?.classList.add('world-shown'); // reveal it behind the UI
      }
      // Fine: stamp shadow flags onto freshly-streamed title chunks an' all
      if (this.gfxQuality === 'fine' && this.world) {
        this._shadowFlagT = (this._shadowFlagT || 0) - dt;
        if (this._shadowFlagT <= 0) { this._shadowFlagT = 0.6; this.applyShadowFlags(true); }
      }
      this.renderFrame(dt);
      return;
    }

    if (this.state === 'loading') {
      this.stepLoading();
      return;
    }

    const playing = this.state === 'playing';
    const paused = this.state === 'paused';

    if (!paused) {
      if (this.state === 'driving') this.driveTick(dt); // advance the engine afore she's posed
      // t' one true train: always running, visible to all
      this.updateTrainWorld(dt);
      this.updateBranchTrains(dt); // …an' a train on every other line — the whole network's alive
      if (this.rails) this.rails.update(dt, this.player.pos);
      if (this.roads) this.roads.update(dt, this.player.pos, this.groundWet);
      if (this.state === 'riding' && this.ride) {
        this.updateRide(dt);
      } else if (this.state === 'driving') {
        this.driveCam();
      }
      // season needed by player (ice) before the main sky block later in frame
      const _season = (this.seasonOverride != null)
        ? seasonStateAtPhase(this.seasonOverride)
        : seasonState();
      this.season = _season;
      // player
      if (playing && !this.player.dead) {
        if (this.boat) this.updateBoat(dt);
        else this.player.update(dt, this.input, this.audio, _season);
      } else if (!playing && this.state !== 'riding') {
        // UI open: physics still ticks but wi' no input
        this.player.update(dt, { keys: {}, jumpTapped: false }, this.audio, _season);
      }
      if (this.mount) this.updateMount(); // carry the pony along under the rider

      // streaming
      this.world.update(this.player.pos.x, this.player.pos.z);
      this._updateSeaRing(dt); // keep the open sea reaching the horizon, fogged honestly (Moors only)

      // entities
      this.entities.day = this.sky.day;
      if (this.rosterClient) this.rosterClient.update(dt);
      this.entities.update(dt, this.player, this.sky.isNight(), this.audio, (item, n) => {
        this.ui.invDirty = true;
        this.ui.toast(`+${n} ${itemName(item)}`, 1600);
      });

      // sleeping: solo skips t' neet after a moment; owt hurting thee wakes thee
      if (this.state === 'sleeping') {
        this.sleepT += dt;
        if (this.player.hurtFlash > 0.3) {
          this.cancelSleep('Summat’s at thee! No sleeping through that.');
        } else if (!(this.netActive && this.net && this.net.connected) && this.sleepT > 2.2) {
          if (this.sky.time > 0.5) this.sky.day++;
          // [SOLAR] wake at t' SEASONAL sunrise (equinox = t' owd 0.25): a winter
          // kip runs long, a summer one's ower afore tha knows it
          this.sky.time = this.sky.sol ? this.sky.sol.sunriseT : 0.25;
          this.sky.weather = 'misty';
          this.finishWake();
        }
      }
      // of a neet, one nudge when tha's stood somewhere tha COULD kip
      this.sleepHintTimer = (this.sleepHintTimer || 0) - dt;
      if (this.sleepHintTimer <= 0 && this.state === 'playing' && this.sky.isNight()) {
        this.sleepHintTimer = 2;
        if (this.sleepHintDay !== this.sky.day && this.canSleepHere() === 'ok') {
          this.sleepHintDay = this.sky.day;
          this.ui.toast('Snug enough here — press <b>N</b> to sleep till morn.', 6000);
        }
      }

      // warden drop: no harm frae t' fall, an' a proper thump on arrival
      if (this.wardenDrop) {
        const wp = this.player;
        wp.fallStart = null; // t' drop doesn't count as a fall
        this.wardenDrop.t += dt;
        if ((wp.onGround && this.wardenDrop.t > 0.3) || this.wardenDrop.t > 12) {
          const d = this.wardenDrop; this.wardenDrop = null;
          this.landImpact(wp.pos.x, wp.pos.y, wp.pos.z, true);
          this.ui.toast(`<b>${d.label}</b>. T' ground remembers thee.`, 3500);
          if (this.dropPonies) { // warden "find a pony" — make sure there's a band to climb on
            const dp = this.dropPonies; this.dropPonies = null;
            const n = this.entities.forceSpawnGroup('pony', dp.x, dp.z, 3);
            if (n) this.ui.toast(`<b>${n} moorland ${n > 1 ? 'ponies' : 'pony'}</b> graze nearby — right-click to climb up.`, 5000);
          }
        }
      }

      // T' Great Fog gate: tops only — never t' coast, never in/near a village
      this.fogGateTimer = (this.fogGateTimer || 0) - dt;
      if (this.fogGateTimer <= 0) {
        this.fogGateTimer = 0.5;
        const geo = this.world.gen.geo, pp = this.player.pos;
        let gate = 0;
        if (geo.coastT(pp.x, pp.z) === 0) {
          const hh = geo.heightRaw(pp.x, pp.z);
          const elevT = Math.max(0, Math.min(1, (hh - 31.5) / 2.5));
          let villF = 1;
          for (const v of geo.villages) {
            const d = Math.hypot(pp.x - v.x, pp.z - v.z);
            villF = Math.min(villF, Math.max(0, Math.min(1, (d - (v.radius + 14)) / 34)));
          }
          gate = elevT * villF;
        }
        this.sky.moorGate = gate;
        const mf = this.sky.moorFog;
        if (mf > 0.25 && !this.greatFogOn) {
          this.greatFogOn = true;
          this.ui.toast('T’ <b>Great Fog</b> is down on t’ tops — tha can’t see thi hand afore thi face, an’ t’ map’s no use. Get off t’ high moor or hunker down till it lifts.', 10000);
        } else if (mf < 0.1 && this.greatFogOn) {
          this.greatFogOn = false;
          this.ui.toast('T’ fog’s lifting off t’ moor. Tha can breathe again.', 5000);
        }
      }
      // beach edits heal: t' tide smooths t' sands back ower
      this.processBeachReverts();
      // the moor heals: revert expired harvest edits once a game-day (cheap, day-scale regrowth)
      const regenDay = Math.floor(this.sky.day);
      if (regenDay !== this._lastExpireDay) {
        this._lastExpireDay = regenDay;
        const decayScale = this.bairnLocked() ? 2 : 1;
        this.world.expireEdits(this.sky.day, decayScale, this.freeWorld());
        this.world.expireForage(this.sky.day);
        this.world.growTrees(this.sky.day);
        this.deedTick();
        const beforeMelt = this.world.snowmanLedger.size;
        this.world.meltSnowmen(this.season);
        if (this.world.snowmanLedger.size < beforeMelt && this.seasonalLayer) this.seasonalLayer.center = null;
      }

      // sky & weather (season already computed + cached above for player ice physics)
      const season = this.season;
      if (this.floraLayer) this.floraLayer.update(dt, this.player.pos, season);
      if (this.seasonalLayer) this.seasonalLayer.update(dt, this.player.pos, season, this.snowAccum);
      if (this.fireLayer) this.fireLayer.update(dt, this.player.pos, this.camera);
      if (this.murmuration) this.murmuration.update(dt, season);
      if (this.harbourLight) this.harbourLight.update(dt, this.camera, this.sky);
      if (this.hearthLayer) this.hearthLayer.update(dt, this.player.pos, this.sky);
      // ONE global flame tick: drives the shared flame material's uTime, every
      // hero fire's embers/smoke, an' the pulsing bonfire light — so torches
      // (FireLayer) AND the festival bonfire (SeasonalLayer) animate off one clock.
      this._fireT = (this._fireT || 0) + dt; tickFires(this._fireT);
      if (this.footprints && this.snowAccum > 0.1) {
        const fpNow = performance.now() / 1000;
        const walkers = [{ x: this.player.pos.x, z: this.player.pos.z }];
        if (this.net) for (const r of this.net.remotes.values()) { const t = r.target; if (t) walkers.push({ x: t.x, z: t.z }); }
        if (this.entities && this.entities.mobs) for (const mob of this.entities.mobs) {
          // fliers (crows, gulls, owls, bats) and boats tread no snow — no prints
          if (mob.dead || (mob.t && (mob.t.fly || mob.t.vehicle))) continue;
          walkers.push({ x: mob.pos.x, z: mob.pos.z });
        }
        this.footprints.update(dt, fpNow, walkers, this.snowAccum);
      } else if (this.footprints) this.footprints.clear();
      this.snowAccum = stepAccumulation(this.snowAccum, season, dt);
      this.player.snowAccum = this.snowAccum; // drift slowdown reads this (player.js driftDepth)
      setSnowLevel(this.snowAccum); // height-gated snow on the tops (cheap uniform)
      const _frozen = isFrozen(season);
      setFrozen(_frozen);
      this._glintT = (this._glintT || 0) + dt; setGlintTime(this._glintT); // drive forage glint animation
      setWaterTime(this._glintT); // [15]/[D0] water ripples + becks ride t' same clock — no new tick
      // [D14] gust fronts ride the SHARED wall-clock (NOT the per-client _glintT accumulator)
      // so every player watches the same wave cross the same hillside (invariant 6).
      setGustPhase((Date.now() / 1000) % 4096);
      setWindAmt(this.sky.liveWind != null ? this.sky.liveWind : 0.35); // real Goathland windiness, tier-flat
      // [SOLAR] sunY/dayness frae t' one solar API (sky.sol carries LAST frame's
      // state here — sky.update runs below — one frame o' lag, invisible). Hoisted
      // out o' t' Fine block so t' TIER-FLAT wetness dry-rate can read it too
      // (overnight rain lingers to morning; short winter days dry slower an' all).
      const _sunY = this.sky.sol.sunAlt;
      const dayness = this.sky.sol.dayness;
      // [9/17]+[D6]+[D10] wet ground: soaks fast while it's rainin', dries slow after,
      // t' dry rate scaled by warmth × daylight (pure stepGroundWet, snow.js idiom).
      // rainAmount is t' shared live-feed sample, warmth t' shared season clock, dayness
      // t' shared sun curve — deterministic. uWetness/uGroundWet are TIER-FLAT (both tiers
      // read t' weather on t' ground); uWetness == groundWet raw, uGroundWet is t' shaped
      // drive (t' shader pow-shapes it for [D10] an' slides t' [D6] puddle threshold).
      this.groundWet = stepGroundWet(this.groundWet, this.sky.rainAmount, season.warmth, dayness, dt);
      setWetness(this.groundWet);
      setGroundWet(this.groundWet);
      // [D9] eaves drip for minutes after t' rain stops: only in t' just-stopped window,
      // fadin' as t' ground dries (reads groundWet + live rain + frozen).
      if (this.dripLayer) this.dripLayer.update(dt, this.player.pos, { groundWet: this.groundWet, rainAmount: this.sky.rainAmount, frozen: _frozen });
      // [15] sun-sparkle on t' water: full glitter at clear noon, nowt at neet or under
      // cloud. overcast mirrors sky.js's overcastGrey call (eased snowAmount stands in for
      // t' instantaneous snowfall). Fine only — applyQuality parks uGlitter at 0 an' Plain
      // never touches it again.
      if (this.gfxQuality === 'fine') {
        const overcast = overcastGrey(this.sky.weather, this.sky.snowAmount || 0, this.sky.rainAmount);
        // [moonglint] t' shimmer dies wi' t' sun (dayness, as ever) — an' a MOON drive
        // fades in ower t' same −0.02 threshold t' sky.js light rig swaps at (moonVis
        // easing), scaled by t' phase illumination fraction: a full-moon blade reads
        // clear but calmer than day (×0.45), a crescent's barely there. [SOLAR] a
        // second factor tracks t' moon's OWN altitude (sky.lun — phase-lagged seat),
        // so a new moon down wi' t' sun leaves t' water dark. Both terms are
        // near-zero through t' dusk handover, so max() picks t' dominant lamp wi'out
        // a visible switch (no double-drive — one azimuth, one strength).
        const _lun = this.sky.lun;
        const moonVis = Math.max(0, Math.min(1, (-_sunY - 0.02) * 6)) * Math.max(0, Math.min(1, (_lun.alt + 0.05) * 8));
        const illum = 0.5 - 0.5 * Math.cos(moonPhase(this.sky.day) * Math.PI * 2);
        const sunGlit = dayness * (1 - overcast);
        const moonGlit = moonVis * illum * (1 - overcast) * 0.45;
        setGlitter(Math.max(sunGlit, moonGlit));
        // [sword] glint corridor drive: camera world pos + t' TRUE on-screen azimuth o'
        // whichever lamp owns t' blade. [SOLAR] sky.js parks BOTH sprites at player +
        // dir·160 frae t' real solar/lunar direction vectors (sky.sol.dir / sky.lun.dir)
        // — t' blade re-derives its azimuth frae t' SAME vectors, so it points at t'
        // disc tha actually SEES through every season an' phase. uSunLow: 0 at zenith
        // (broad pool, k 6) → 1 at t' horizon (narrow blazin' blade, k 24), read frae
        // t' drivin' lamp's true elevation (sin alt). Scalar setters only — nowt
        // allocated per frame.
        const _cp = this.camera.position;
        setCamPos(_cp.x, _cp.y, _cp.z);
        const _sd = this.sky.sol.dir, _md = _lun.dir;
        const moonDrive = moonGlit > sunGlit;
        const _ax = (moonDrive ? _md[0] : _sd[0]) * 160, _az = (moonDrive ? _md[2] : _sd[2]) * 160, _al = Math.hypot(_ax, _az) || 1;
        setSunAzim(_ax / _al, _az / _al);
        const _elev = moonDrive ? _lun.alt : _sunY;
        setSunLow(Math.max(0, Math.min(1, 1 - Math.max(0, _elev) * 1.1)));
        // [9] wet sheen tint: puddles/wet tops pick up t' LIVE sky colour at grazing
        // angles (Fine only — uSheen stamped 0.5 in applyQuality). scene.fog.color IS t'
        // live horizon/sky colour sky.js writes every frame (dawn-glow tint an' all), so
        // t' street glistens amber at dusk. Scratch-free: setWetSky copies into t' module
        // Color's channels, no per-frame alloc ([22] hoist lesson).
        const fc = this.sky.scene.fog.color;
        setWetSky(fc.r, fc.g, fc.b);
        // [0] cloud shadows sweep t' moor: t' clock is sky.cloudT — t' SAME
        // accumulator t' dome scrolls its clouds by (churn speed-up an' all) —
        // so ground patches track t' dome exactly. Strength = cover × dayness ×
        // clear-sky: uClouds (t' dome's eased cover) rises toward overcastGrey,
        // so cover × (1 − overcast) peaks ~0.25 at half-cover an' self-zeroes
        // both stone-clear an' full-overcast; dayness kills it at neet. ×1.4
        // lands t' peak dimmin' at ~0.35, an' t' min() clamps t' odd frame where
        // cover an' grey diverge (boss-storm churn drives cover, not grey).
        setCloudTime(this.sky.cloudT || 0);
        const cover = this.sky.domeMat.uniforms.uClouds.value;
        setCloudShadow(Math.min(0.35, 1.4 * cover * dayness * (1 - overcast)));
        // [D8] dew / after-rain glisten: droplets sparkle on flora AFTER a shower clears
        // (groundWet high, rain stopped, some light), and again at a clear summer dawn.
        const glisten = this.groundWet * (1 - this.sky.rainAmount) * dayness;
        // [SOLAR] t' dawn band tracks t' SEASONAL sunrise (sky.sol.sunriseT), not t' owd fixed 0.25
        const dawnDew = Math.max(0, 1 - Math.abs(this.sky.time - this.sky.sol.sunriseT) / 0.07) * (1 - overcast) * Math.max(0, season.warmth) * (this.sky.rainAmount < 0.05 ? 1 : 0);
        setDew(Math.max(glisten, dawnDew));
      }
      const sbk = Math.floor(season.yearPhase * 40);
      if (sbk !== this._seasonBucket) { this._seasonBucket = sbk; retintAtlasForSeason(season); } // heather purple, bracken rust…
      // is there a roof overhead? (stops rain fallin' through ceilings + drives wetness)
      const _pp = this.player.pos, _px = Math.floor(_pp.x), _pz = Math.floor(_pp.z), _ph = Math.floor(_pp.y + this.player.eye);
      let covered = false;
      for (let yy = _ph + 1; yy <= _ph + 6; yy++) {
        const ab = this.world.getBlock(_px, yy, _pz);
        if (ab !== B.AIR && ab !== B.WATER && !isCutout(ab)) { covered = true; break; }
      }
      this._covered = covered; // [25] eye-adaptation reads t' roof flag in renderFrame (+0.15 exposure under cover)
      const msg = this.sky.update(dt, this.player.pos, season, covered);

      // economy on the game clock: deliver any due shipments and refill vendor drop-in purses.
      // `now` is GAME-DAYS (sky.day + sky.time) — the time contract the trade engine expects.
      const tradeNow = this.sky.day + this.sky.time;
      this.economy.refillPurses(tradeNow);
      this.economy.tickShipments(tradeNow);

      // wetness: tha gets soaked out in t' rain (or t' beck) an' dries under cover or by a fire.
      // soaked through, tha can't rest up (no regen) an' tha burns scran keepin' warm.
      if (!this.player.creative) {
        const pl = this.player;
        const inRain = this.sky.rainAmount > 0.25 && !covered;
        const inBeck = pl.feetBlock() === B.WATER || pl.headBlock() === B.WATER;
        const byFire = this.world.nearLight(_pp.x, _pp.z, 4);
        if (inRain || inBeck) pl.wetness = Math.min(1, pl.wetness + dt * 0.05);
        else pl.wetness = Math.max(0, pl.wetness - dt * (byFire ? 0.16 : covered ? 0.09 : 0.03));
        if (pl.wetness > 0.5) pl.exhaustion += dt * (pl.wetness - 0.5) * 0.4;
        if (pl.wetness > 0.7 && !pl._soaked) { pl._soaked = true; this.ui.toast('Tha&rsquo;s wringin&rsquo; wet through &mdash; get under cover or by a fire afore tha catches thi deeath.', 4500); }
        else if (pl.wetness < 0.25 && pl._soaked) { pl._soaked = false; this.ui.toast('Tha&rsquo;s dried off. Grand.', 2500); }
      } else { this.player.wetness = 0; }
      // temperature: drives cold stat from season + environment each frame
      {
        const pl = this.player, pp = pl.pos;
        const altitude01 = Math.max(0, Math.min(1, (pp.y - 26) / 34));
        const nearFire = this.world.nearLight(pp.x, pp.z, 4);
        const coat = pl.slots.some(s => s && s.id === I.WOOL_COAT);
        const target = temperatureTarget(this.season, { covered, nearFire, night: this.sky.isNight(), altitude01, wetness: pl.wetness, coat });
        pl.temperature = stepTemperature(pl.temperature, target, dt);
      }
      if (msg) {
        if (msg.type === 'night') {
          const dracHunt = this.quests.draculaHuntActive() && !this.quests.draculaDone();
          this.ui.toast(dracHunt
            ? 'Neet&rsquo;s fallen. Summat <b>cold an&rsquo; foreign</b> walks t&rsquo; moor when tha&rsquo;s ready wi&rsquo; thi stake...'
            : 'Neet&rsquo;s fallen. Summat&rsquo;s movin&rsquo; out on t&rsquo; moor...', 5000);
        }
        else if (msg.type === 'dusk' && !this.player.creative) {
          const early = (this.sky.day || 1) <= 3;
          // stood far from any village at dusk? point at t' find-shelter key
          let vd = 1e9;
          for (const v of this.world.gen.geo.villages || []) {
            vd = Math.min(vd, Math.hypot(v.x - this.player.pos.x, v.z - this.player.pos.z));
          }
          const hint = vd > 80 ? ' Press <b>L</b> to find shelter.' : '';
          this.ui.toast((early
            ? 'Gloamin&rsquo;s drawin&rsquo; in. Mek for t&rsquo; village, or <b>keep a torch lit</b> &mdash; owt dark keeps its distance from the light.'
            : 'Gloamin&rsquo;s drawin&rsquo; in. Mek for t&rsquo; village &mdash; <b>nowt dark sets foot on Moorstead ground</b>.') + hint, 7000, 'warn');
        }
        else if (msg.text) this.ui.toast(msg.text, 4000);
      }

      // t' shared moor: relay positions, edits an' chat
      if (this.net) this.net.update(dt);

      // ventures: progress checks, fresh offers each new day
      this.quests.update(dt);
      // folklore manifestations (the giants): quest/time/place-gated, moors only
      if (this.quests) this.updateQuestFx(dt);
      if (this.sky.day !== this.lastQuestDay) {
        this.lastQuestDay = this.sky.day;
        this.quests.refreshOffers();
        this.refreshStanding(false);
        if (!this.player.dead) this.milestones.nightSurvived();
      }

      // mining / repeat placing / fishing
      if (this.touch) this.touch.tick();
      // Playing but pointer-lock didn't take — closing a board/menu can hit the browser's re-lock
      // cooldown (it blocks requestPointerLock for ~1s after an exit), leaving the crosshair dead
      // with no obvious way back. Show a click-to-resume hint; a canvas click re-locks (mousedown).
      const _locked = document.pointerLockElement === this.renderer.domElement;
      if (this.state === 'playing' && !this.touch?.active && !_locked) this._unlockT = (this._unlockT || 0) + dt;
      else this._unlockT = 0;
      if (this.ui.lockHint) this.ui.lockHint.classList.toggle('show', this._unlockT > 0.5);
      this.updateMining(dt);
      this.updateFishing(dt);
      const repHeld = this.player.heldItem();
      if (this.holdToPlace && this.mouseDown[2] && playing && !(repHeld && repHeld.id === I.FISHING_ROD)) {
        this.placeRepeat -= dt;
        if (this.placeRepeat <= 0) { this.placeRepeat = 0.22; this.useItem(); }
      }

      // death
      if (this.player.dead && this.state !== 'dead') {
        this.state = 'dead';
        this.chatOpen = false;          // dying mid-chat must not permanently silence the parish
        this.mouseDown = [false, false, false];
        document.exitPointerLock?.();
        this.audio.hurt();
        this.applyDeathPenalty();
        const lossNote = this.freeWorld() ? '' : 'Tha lost half thi materials an’ half thi brass — but thi tools an’ thi animals are safe.';
        this.ui.showDeath(this.player.deathCause, lossNote);
      }
    }

    // camera follows player — unless a debug photo pose is pinned (visual checks
    // frae a FIXED POINT: t' player stays put wherever they safely stand, nowt
    // falls off owt or drowns while a screenshot's taken — James's call 2026-07-03)
    if (this._photoCam) {
      const p = this._photoCam;
      this.camera.position.set(p.x, p.y, p.z);
      this.camera.rotation.set(p.pitch, p.yaw, 0);
    } else {
      this.camera.position.set(this.player.pos.x, this.player.pos.y + this.player.eye, this.player.pos.z);
      this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    }
    const targetFov = this.player.sprinting ? 82 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.5) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }

    // booked train + platform announcements
    this.updatePendingRide();
    this.stationCheck = (this.stationCheck ?? 0) - dt;
    if (playing && this.stationCheck <= 0) {
      this.stationCheck = 2;
      const st = this.world.gen.geo.nearStation(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z), 16);
      if (st && st !== this.lastStationNear) {
        this.lastStationNear = st;
        const i = this.world.gen.geo.railway().indexOf(st);
        this.ui.toast(`<b>${st.name} station.</b> Next train calls in <b>${this.fmtMins(this.nextCallAt(i))}</b> \u2014 right-click t\u2019 board to book on.`, 6000);
      } else if (!st) {
        this.lastStationNear = null;
      }
    }

    // block highlight + interact hint
    if (playing && !this.player.dead) {
      const vv = this.villagerInView();
      const tame = vv ? null : this.aimedTameable();
      const hit = this.targetBlock();
      if (vv) {
        // a villager under the crosshair — talk to them wi' T (shown on screen, not in-world)
        this.highlight.visible = false;
        this.ui.interactHint.textContent = `Press T to talk to ${vv.displayName || vv.t.name}`;
      } else if (tame) {
        // a tameable beast tha's facing — tell t' player they can feed her, an' wi' what
        this.highlight.visible = false;
        const held = this.player.heldItem();
        const food = tame.t.tameFood || [];
        if (held && food.includes(held.id)) {
          const prog = Math.min(TAME_GOAL, Math.round(tame.tameProg || 0));
          this.ui.interactHint.textContent = `Right-click: feed her (${prog}/${TAME_GOAL} — keep feedin’ her to tame her)`;
        } else {
          this.ui.interactHint.textContent = `Hold ${food.length ? itemName(food[0]) : 'her favourite'} an’ right-click to tame her`;
        }
      } else if (hit) {
        this.highlight.visible = true;
        this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
        let hint = '';
        if (hit.id === B.BOARD) {
          const geo = this.world.gen.geo;
          if (geo.isMuseumBoard(hit.x, hit.z)) hint = 'Right-click: Dracula Museum';
          else hint = geo.nearStation(hit.x, hit.z, 8)
            ? 'Right-click: departures board' : 'Right-click: parish notices an\u2019 jobs';
        } else if (hit.id === B.INN_DOOR) hint = 'Right-click: cross t\u2019 threshold';
        else if (hit.id === B.SIGNPOST) hint = 'Right-click: read t\u2019 waymark';
        else if (hit.id === B.BENCH) hint = 'Right-click: joiner\u2019s bench (craftin\u2019)';
        else if (hit.id === B.RANGE) hint = 'Right-click: t\u2019 range (cookin\u2019 an\u2019 smeltin\u2019)';
        else if (hit.id === B.STRONGBOX) hint = 'Right-click: oak strongbox (stash thi goods an\u2019 brass)';
        this.ui.interactHint.textContent = hint;
      } else if (this.entities && this.entities.mobs.some(m => m && !m.dead && m.droving && m.type === 'sheep')) {
        // mid-drove — keep 'em bunched; the whistles still drive 'em
        this.highlight.visible = false;
        this.ui.interactHint.textContent = `🐑 Drove thi flock to ${marketTownName(this.world.gen.geo.realWorld)}’s mart — keep ‘em bunched  (← → ↑ ↓ whistle)`;
      } else if (this.entities &&
        this.entities.mobs.some(m => m && m.owner && m.type === 'dog') &&
        this.entities.mobs.some(m => m && !m.owner && m.type === 'sheep' && Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z) < 20)) {
        // a working dog an' sheep about — show the whistle commands (legibility)
        this.highlight.visible = false;
        this.ui.interactHint.textContent = '🐕 Whistle: ← come-bye  → away  ↑ walk on  ↓ lie down  (H: heel)';
      } else if (this.player.farmStatus && this.player.farmStatus.registered && this.entities &&
        this.entities.mobs.some(m => m && m.owner && m.type === 'dog') &&
        this.entities.mobs.some(m => m && m.owner && m.stay && m.type === 'sheep' && Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z) < 20)) {
        // registered farmer stood by penned stock wi' a dog — offer to muster for market
        this.highlight.visible = false;
        this.ui.interactHint.textContent = '🐑 Press G to muster thi flock for market';
      } else {
        this.highlight.visible = false;
        this.ui.interactHint.textContent = '';
      }
    } else {
      this.highlight.visible = false;
      this.ui.interactHint.textContent = '';
    }

    // lantern lights
    this.updateLanterns();

    // held torch lights thi way
    const heldNow = this.player.heldItem();
    const holdingTorch = heldNow && heldNow.id === B.TORCH;
    this.torchLight.intensity = holdingTorch ? 9 : 0;
    if (holdingTorch) {
      this.torchLight.position.set(this.player.pos.x, this.player.pos.y + 1.5, this.player.pos.z);
    }

    // held item viewmodel
    const held = this.player.heldItem();
    const heldId = held ? held.id : -1;
    if (heldId !== this.heldIconId) {
      this.heldIconId = heldId;
      if (held) {
        // one shared loader, an' t' outgoing icon texture DISPOSED — every swap used to
        // leak a GPU texture (they're not GC'd), a slow bleed over a long session
        const old = this.heldSprite.material.map;
        const tex = (this._texLoader || (this._texLoader = new THREE.TextureLoader())).load(getIconURL(held.id));
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        this.heldSprite.material.map = tex;
        this.heldSprite.material.needsUpdate = true;
        this.heldSprite.visible = true;
        if (old) old.dispose();
      } else {
        this.heldSprite.visible = false;
      }
    }
    // gentle bob
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    this.bobPhase = (this.bobPhase || 0) + dt * speed * 1.6;
    this.heldSprite.position.y = -0.55 + Math.sin(this.bobPhase * Math.PI) * 0.02 * Math.min(1, speed / 3);

    // t' storm lantern in thi fist: a warm point light held just ahead an' beside t'
    // eye, breathing wi' a deterministic wick-flicker an' swaying wi' thi stride
    const holdingStorm = !!(heldNow && heldNow.id === I.STORM_LANTERN) && playing && !this.player.dead;
    this._stormHeld = holdingStorm;
    if (holdingStorm) {
      const t = this.clock.elapsedTime;
      this.stormLight.intensity = 12 * lanternFlicker(t); // 14 blew out t' near ground
      const yaw = this.player.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // forward on t' ground plane
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // right hand
      const sway = Math.sin(this.bobPhase * Math.PI) * 0.06 * Math.min(1, speed / 3);
      this.stormLight.position.set(
        this.player.pos.x + fx * 0.7 + rx * 0.35,
        this.player.pos.y + 1.35 + sway,
        this.player.pos.z + fz * 0.7 + rz * 0.35
      );
    } else {
      this.stormLight.intensity = 0;
    }

    // villagers hail thee as tha passes (one brain call at a time, well spaced;
    // they pipe down entirely when t' brain's under load)
    // Only suppress passing hails after a slow *hail* — player-initiated chat (T) must not
    // silence the whole parish for ten minutes.
    const hailBusy = (this.lastHailMs || 0) > 15000 && performance.now() - (this.lastHailAt || 0) < 120000;
    if (playing && !this.player.dead && !this.hailInFlight && !hailBusy) {
      for (const m of this.entities.mobs) {
        if (m.type !== 'villager' || !m.charId || m.chatting) continue;
        if ((m.hailCd || 0) > 0) continue;
        const d = Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z);
        if (d > 8) continue;
        m.hailCd = 240 + Math.random() * 120;
        this.hailInFlight = true;
        const t0 = performance.now();
        // short prompt on purpose \u2014 a hail's ambience, so t' brain must answer fast
        const hailMsg = '(The visitor walks past within earshot. Call out ONE short greeting or remark to them \u2014 a single sentence, in your own voice. If there is something between you \u2014 a job afoot, news, owt they did \u2014 that is the thing to mention.)';
        // same split as sendChat: curated personas keep t' registered path (memory +
        // trust apply, so named folk don't greet thee like a stranger); procedural
        // roster ids ("pop-\u2026") aren't registered \u2014 /api/talk would 404 \u2014 so they hail
        // through t' brain's generic passer-by voice instead.
        const personaHail = m.charId && !(typeof m.charId === 'string' && m.charId.startsWith('pop-'));
        const call = personaHail
          ? npc.talk(m.charId, hailMsg, this.player.name, this.playerId(), this.quests.chatContext(m))
          : npc.talkGeneric(
              { name: m.displayName || m.t.name, role: m.role, village: m.village, mood: moodWord(m.mood == null ? 0.5 : m.mood) },
              hailMsg, this.player.name, this.quests.chatContext(m)
            );
        call.then(res => {
          this.hailInFlight = false;
          this.lastHailMs = performance.now() - t0;
          this.lastHailAt = performance.now();
          const dNow = Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z);
          if (dNow < 26 && res.reply) {
            this.entities.speak(m, res.reply, 18);
            m.chatLog.push({ who: 'them', text: res.reply });
            if (personaHail) m.tier = res.tier;
          }
        }).catch(() => { this.hailInFlight = false; }); // a failed hail passes in silence \u2014 no toast
        break;
      }
    }

    // village carol: real public-domain MIDI through a sampled church organ.
    // Lazy-init once AudioEngine has a ctx (a user gesture has occurred), so it
    // shares the same gesture-gated context as the rest of the audio.
    if (this.audio.ctx && !this.carolBox) {
      this.carolBox = new CarolBox(this.audio.ctx);
    }
    if (this.carolBox && this.world) {
      const geo = this.world.gen && this.world.gen.geo;
      let nearestVillageDist = 1e9;
      if (geo) {
        const pp = this.player.pos;
        for (const v of geo.villages) {
          const d = Math.hypot(v.x - pp.x, v.z - pp.z);
          if (d < nearestVillageDist) nearestVillageDist = d;
        }
      }
      // audible only in Christmastide and near a village; the carol fades up as
      // you approach, full within ~village, silent beyond ~60 blocks. The day-seed
      // (the in-game day) makes the rotation order shared across clients + daily.
      const audible = yuletide(this.season) && nearestVillageDist < 60;
      this.carolBox.setActive(audible, nearestVillageDist, this.sky.day);
    }

    // festival audio: a bonfire crackle bed (Bonfire Night / Midsummer) and church-
    // bell peals (Harvest Home / Eastertide), both gated on the active festival +
    // nearness to a village. Cheap: a village-distance scan, a couple o' compares,
    // and one peal timer. Drives audio.js's setCrackle bed + bells() peal.
    this._fireCrackle = 0;
    if (this.world && this.season) {
      const active = festivalState(this.season.yearPhase).active;
      const geo = this.world.gen && this.world.gen.geo;
      let villDist = 1e9;
      if (geo) {
        const pp = this.player.pos;
        for (const v of geo.villages) { const d = Math.hypot(v.x - pp.x, v.z - pp.z); if (d < villDist) villDist = d; }
      }
      const nearVillage = villDist < 60;
      // bonfire roar: fades up as you near the green, full within ~village, gone by 40 blocks
      if (nearVillage && (active === 'bonfire' || active === 'midsummer')) {
        this._fireCrackle = Math.max(0, 1 - villDist / 40) * 0.5;
      }
      // bells: a peal every ~45-70 s while in the window near a village; first peal soon
      // after you arrive. Reset the timer outside the window so re-entry rings promptly.
      if (nearVillage && (active === 'harvest' || active === 'easter')) {
        if (this._bellTimer == null) this._bellTimer = 4 + Math.random() * 4; // first peal ~4-8 s in
        this._bellTimer -= dt;
        if (this._bellTimer <= 0) {
          this._bellTimer = 45 + Math.random() * 25;
          this.audio.bells({ gain: Math.max(0.05, 0.2 * (1 - villDist / 60)) });
        }
      } else {
        this._bellTimer = null;
      }
    }

    // audio ambience
    let nearSheep = false;
    for (const m of this.entities.mobs) {
      if (m.type === 'sheep' && Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z) < 30) { nearSheep = true; break; }
    }
    const dread = this.entities.draculaDread(this.player);
    this.sky.setDread(dread);
    this.ui.setDread(dread);

    // the Dracula boss-battle storm: thunder, lightning, rain (or snow in winter)
    // while the Count's fight is live; restores the prior weather when he falls or
    // the player leaves. Self-guarding + scoped to the fight (see storm.js).
    if (this.storm) this.storm.update(dt);

    // place-based ambience signals (beck / coast / inn), refreshed ~3x a second
    this._ambTimer = (this._ambTimer || 0) - dt;
    if (this._ambTimer <= 0) {
      this._ambTimer = 0.33;
      const geo = this.world && this.world.gen && this.world.gen.geo;
      const p = this.player.pos, px = Math.floor(p.x), pz = Math.floor(p.z), py = Math.floor(p.y);
      if (geo) {
        this._onCoast = geo.coastT(px, pz) > 0 ? 1 : 0;
        let vd = 1e9;
        for (const v of geo.villages) { const d = Math.hypot(v.x - p.x, v.z - p.z); if (d < vd) vd = d; }
        const evening = this.sky.time > this.sky.sol.sunsetT - 0.15 || this.sky.time < 0.05; // [SOLAR] dusk through t' small hours (equinox = t' owd 0.6)
        this._nearInn = (evening && vd < 16) ? 1 : 0;
        let water = 0;
        for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [4, 4], [-4, 4], [4, -4], [-4, -4]]) {
          if (this.world.getBlock(px + dx, py - 1, pz + dz) === B.WATER || this.world.getBlock(px + dx, py, pz + dz) === B.WATER) { water = 1; break; }
        }
        this._nearWater = water || this._onCoast;
      }
    }
    const trainDist = this.trainState ? Math.hypot(this.trainState.x - this.player.pos.x, this.trainState.z - this.player.pos.z) : null;

    this.audio.update(dt, {
      rain: this.sky.rainAmount,
      windiness: Math.min(1, Math.max(0, (this.player.pos.y - 26) / 20)),
      isNight: this.sky.isNight(),
      nearSheep,
      dread,
      season: this.season,
      nearWater: this._nearWater || 0,
      onCoast: this._onCoast || 0,
      nearInn: this._nearInn || 0,
      trainDist,
      fireCrackle: this._fireCrackle || 0,
    });

    // HUD
    this.ui.updateHUD(this.player, this.sky);
    this.updateStationChip(dt);   // stood at a platform? keep the departures chip current
    this.ui.updateTracker();
    this.ui.minimapTimer -= dt;
    if (this.ui.minimapTimer <= 0) {
      this.ui.minimapTimer = 0.6;
      this.ui.drawMinimap(this.player, this.world);
    }

    // hunger warning
    if (!this.player.creative && this.player.hunger <= 4 && !this.hungerWarned) {
      this.hungerWarned = true;
      this.ui.toast('Tha&rsquo;s fair clammed &mdash; get some scran down thee!');
    }
    if (this.player.hunger > 6) this.hungerWarned = false;

    // autosave
    if (playing) {
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = 30;
        this.saveNow(false);
      }
    }

    // heartbeat to t' parish ledger (fire-an'-forget, ~1/min)
    if (this.state !== 'title') {
      this.pingTimer = (this.pingTimer ?? 5) - dt;
      if (this.pingTimer <= 0) {
        this.pingTimer = 60;
        const p = Math.floor(this.player.pos.x);
        const z = Math.floor(this.player.pos.z);
        fetch('/dash/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pid: (localStorage.getItem('moorcraft-pid') || 'unknown').slice(0, 40),
            name: this.player.name || '',
            seed: '' + this.seed,
            day: this.sky.day,
            standing: this.quests.standingLabel(),
            croft: this.quests.croftStage,
            quests: this.quests.completed.length,
            loc: this.world.gen.geo.locationName(p, z),
            room: this.netActive ? (this.netRoom || 'shared') : '', // '' = solo world
          }),
        }).catch(() => { /* ledger's closed — no matter */ });
      }
    }

    // hold Tab to peek at t' whole-moor map (only while actually playing)
    const wantMap = this.state === 'playing' && (!!this.keys['Tab'] || this.touchMapOpen);
    if (wantMap && !this.peekingMap) { this.peekingMap = true; this.ui.showBigMap(this.player, this.world); }
    else if (!wantMap && this.peekingMap) { this.peekingMap = false; this.ui.hideBigMap(); }
    else if (this.peekingMap) this.ui.drawBigMapDots(this.player, this.net);

    // Fine: newly-streamed chunk meshes an' fresh-spawned mobs need their shadow
    // flags stamping (t' mesher doesn't know about quality) — a cheap sweep, ~0.6 s
    if (this.gfxQuality === 'fine') {
      this._shadowFlagT = (this._shadowFlagT || 0) - dt;
      if (this._shadowFlagT <= 0) { this._shadowFlagT = 0.6; this.applyShadowFlags(true); }
    }
    // Frame-time governor (Fine, in-world only — t' title's streaming bursts would mis-train
    // it): EMA t' dt every frame (scalar, no allocation), take t' pure decision twice a
    // second. Laboured >26 ms for 3 s -> shed a rung (MSAA->FXAA first, then pixel ratio);
    // 20 s o' clear air under 18 ms -> climb one back.
    this._dtEma = this._dtEma * 0.95 + dt * 0.05;
    if (this.gfxQuality === 'fine' && this.composer) {
      this._govT -= dt;
      if (this._govT <= 0) {
        this._govT = 0.5;
        const g = stepGovernor(this._govState, this._dtEma * 1000, this.clock.elapsedTime);
        const swapAA = g.aa !== this._govState.aa;
        this._govState = g;
        if (g.changed) {
          this._resScale = g.scale;
          if (swapAA) this.rebuildComposer(); // sample count is baked into t' targets
          else this.applyResolution();
        }
      }
    }
    this.renderFrame(dt);
  }

  updateLanterns() {
    const p = this.player.pos;
    const near = [];
    // reuse world's cached parsed-lantern array instead of re-splitting every key each frame
    for (const a of this.world.lightsArr()) {
      const x = a[0], y = a[1], z = a[2];
      const d = (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2;
      if (d < 50 * 50) near.push([d, x, y, z]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.lanternLights.length; i++) {
      const l = this.lanternLights[i];
      if (i < near.length) {
        l.position.set(near[i][1] + 0.5, near[i][2] + 0.6, near[i][3] + 0.5);
        l.intensity = 14;
      } else {
        l.intensity = 0;
      }
    }
  }
}

window.game = new Game();
