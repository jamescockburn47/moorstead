// Headless: the Fine/Plain graphics rig + t' storm lantern.
// Pure checks (quality resolution, wick-flicker determinism, item/recipe validity)
// run against real imports; renderer config (tone mapping, shadow rig, post stack)
// is source-level — headless Node has no GL, so we assert the flags are wired in
// the Fine path and that the Plain path leaves the renderer exactly as it was.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { B, I, CHUNK, RECIPES, CREATIVE_ITEMS, itemName, maxStack } from '../src/defs.js';
import { resolveQuality, lanternFlicker, buildStarField, moonPhase, auroraWindow, rainbowRising } from '../src/sky.js';
import { tileUV, ATLAS_TILES } from '../src/textures.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const mainSrc = src('../src/main.js');
const skySrc = src('../src/sky.js');
const uiSrc = src('../src/ui.js');
const texSrc = src('../src/textures.js');
const playerSrc = src('../src/player.js');
const mesherSrc = src('../src/mesher.js');
const stormSrc = src('../src/storm.js');
const floraLayerSrc = src('../src/floraLayer.js');

// ---- quality setting: persistence/resolution logic (pure) ----
ok(resolveQuality('fine', true) === 'fine', 'stored fine wins, even on touch');
ok(resolveQuality('plain', false) === 'plain', 'stored plain wins, even on a computer');
ok(resolveQuality(null, false) === 'fine', 'no choice + desktop -> Fine by default');
ok(resolveQuality(null, true) === 'plain', 'no choice + touch adapter -> Plain by default');
ok(resolveQuality(undefined, false) === 'fine', 'undefined stored -> desktop default Fine');
ok(resolveQuality('garbage', true) === 'plain', 'junk stored value falls back to device default');
ok(mainSrc.includes("localStorage.getItem('moorcraft-gfx')"), 'quality read from localStorage moorcraft-gfx');
ok(mainSrc.includes("localStorage.setItem('moorcraft-gfx'"), 'quality toggle persists to localStorage');
ok(uiSrc.includes('btnGfx'), 'pause menu has the Graphics settings row');
ok(mainSrc.includes('ui.btnGfx.addEventListener'), 'Graphics row is wired in main.bindEvents');

// ---- t' wick flicker: deterministic, organic, bounded ----
ok(lanternFlicker(3.7) === lanternFlicker(3.7), 'flicker is deterministic in t (no random jitter)');
let mn = Infinity, mx = -Infinity, allFinite = true;
for (let t = 0; t < 120; t += 0.013) {
  const f = lanternFlicker(t);
  if (!Number.isFinite(f)) allFinite = false;
  if (f < mn) mn = f;
  if (f > mx) mx = f;
}
ok(allFinite, 'flicker stays finite across a two-minute sweep');
ok(mn >= 0.9 && mx <= 1.1, `flicker bounded well within [0.9, 1.1] (got ${mn.toFixed(3)}..${mx.toFixed(3)})`);
ok(mx - mn > 0.05, 'flicker actually breathes (not a constant)');
ok(Math.abs(lanternFlicker(0) - 1) < 0.1, 'flicker centred on 1');

// ---- t' storm lantern: item, recipe, icon ----
ok(Number.isInteger(I.STORM_LANTERN) && I.STORM_LANTERN >= 64, 'STORM_LANTERN is a pure item id (>= 64)');
{
  const vals = Object.values(I);
  ok(vals.filter(v => v === I.STORM_LANTERN).length === 1, 'STORM_LANTERN id is unique among items');
}
ok(itemName(I.STORM_LANTERN) === 'Storm Lantern', 'item has its display name');
ok(maxStack(I.STORM_LANTERN) === 1, 'a lantern is carried, not stacked (maxStack 1)');
ok(CREATIVE_ITEMS.includes(I.STORM_LANTERN), 'storm lantern in the creative cupboard');
{
  const r = RECIPES.find(r => r.out === I.STORM_LANTERN);
  ok(!!r, 'a crafting recipe exists for the storm lantern');
  ok(r.bench === true, 'crafted at the joiner’s bench (tinsmith work, not pocket-craft)');
  ok(r.n === 1, 'one lantern per craft');
  ok(r.needs.length >= 2, 'recipe takes more than one ingredient');
  for (const [id, cnt] of r.needs) {
    ok(itemName(id) !== '?', `recipe ingredient ${id} is a real, named item/block`);
    ok(Number.isInteger(cnt) && cnt > 0, `recipe ingredient ${id} count is sane`);
  }
  // period-faithful: iron body + coal-oil framing (no glass item exists in defs)
  ok(r.needs.some(([id]) => id === I.IRON_INGOT), 'recipe uses iron ingot (tin body an’ bail)');
}
ok(texSrc.includes('[I.STORM_LANTERN](ctx)'), 'procedural icon painter registered in textures.js');
ok(uiSrc.includes('stormLanternHinted'), 'first-craft toast wired in ui.js');
ok(playerSrc.includes('stormLanternHinted: this.stormLanternHinted') && playerSrc.includes('!!d.stormLanternHinted'),
  'first-craft flag rides player.serialize/deserialize');
ok(uiSrc.includes('storm lantern') || uiSrc.includes('The storm lantern'), 'handbook line present');

// ---- held-lantern wiring: light + monster-fear ward ----
ok(mainSrc.includes('lanternFlicker'), 'held light breathes with the pure flicker function');
ok(mainSrc.includes('this._stormHeld'), 'held-lantern state tracked for the ward');
ok(mainSrc.includes('this.world.nearLight = (x, z, r)'), 'held lantern counts as a burning light (nearLight wrap)');
ok(mainSrc.includes('stormLight = new THREE.PointLight'), 'dedicated warm point light for the hand lamp');
ok(/stormLight = new THREE\.PointLight\(0xffb46b/.test(mainSrc), 'lantern light is warm (#ffb46b)');
ok(!/stormLight\.castShadow\s*=\s*true/.test(mainSrc), 'hand lamp casts NO shadow (point shadows are too dear)');

// ---- Fine path: tone mapping, shadow rig, post stack ----
ok(mainSrc.includes('THREE.ACESFilmicToneMapping'), 'Fine: ACES filmic tone mapping');
ok(mainSrc.includes('THREE.SRGBColorSpace'), 'sRGB output colour space set explicitly');
ok(mainSrc.includes('THREE.PCFSoftShadowMap'), 'Fine: PCFSoft shadow filtering');
ok(mainSrc.includes('r.shadowMap.enabled = true'), 'Fine: shadow maps on');
ok(mainSrc.includes('s.mapSize.set(2048, 2048)'), 'Fine: 2048px shadow map');
ok(/s\.camera\.left = -70; s\.camera\.right = 70/.test(mainSrc), 'Fine: tight ~70m orthographic shadow frustum');
ok(mainSrc.includes('s.normalBias'), 'Fine: shadow bias tuned (voxel acne)');
ok(mainSrc.includes('new EffectComposer(') && mainSrc.includes('new RenderPass('), 'Fine: composer + render pass');
ok(/new UnrealBloomPass\([^)]*0\.85\)/.test(mainSrc), 'Fine: bloom threshold 0.85 (only genuine lights bloom)');
ok(mainSrc.includes('new OutputPass()'), 'Fine: OutputPass (tone map + sRGB) before the grade');
ok(mainSrc.includes('GradeShader'), 'Fine: final grade pass (vignette + period grade + dither)');
ok(mainSrc.includes('vignette') && mainSrc.includes('dither'), 'grade shader does vignette + dither');
ok(mainSrc.includes('customDepthMaterial'), 'cutout foliage gets an alpha-tested shadow depth material');
ok(skySrc.includes("this.gfx === 'fine'"), 'sky: Fine-gated light curves');
ok(skySrc.includes('0x9cbcf0'), 'sky: cool blue moonlight when the moon is up');
ok(skySrc.includes('moonHigh'), 'sky: moonlit night floor raised under Fine');

// ---- S5a [25]+[27]+[26]: living exposure / bloom / grade drives (Fine-only, deterministic) ----
// [25] deterministic eye adaptation: the exposure constant is now a BASE + a per-frame eased
// target frae dayness/roof/lantern state (no luminance readback). We deliberately re-pin the
// base value (1.25) on the new named constant AND assert the adaptation drive is present.
ok(mainSrc.includes('const EXPOSURE_BASE = 1.25'), '[25] exposure base constant pinned at 1.25 (was the inline literal — now the eye-adaptation base)');
ok(mainSrc.includes('r.toneMappingExposure = EXPOSURE_BASE'), '[25] applyQuality seeds exposure frae EXPOSURE_BASE (not a bare literal)');
ok(mainSrc.includes('r.toneMappingExposure += (expTarget - r.toneMappingExposure) * Math.min(1, dt * 0.4)'),
  '[25] exposure eased toward the per-frame target at dt·0.4 (slow eye-adaptation lag)');
ok(mainSrc.includes('let expTarget = EXPOSURE_BASE - 0.10 + nightness * 0.17;'),
  '[25] exposure target: ~1.15 clear midday -> ~1.32 outdoors night (EXPOSURE_BASE-relative, dayness-driven)');
ok(mainSrc.includes('if (this._covered) expTarget += 0.15;'), '[25] +0.15 exposure under a roof (reads the persisted covered/roof flag)');
ok(mainSrc.includes('if (this._stormHeld || (this.torchLight && this.torchLight.intensity > 0)) expTarget += 0.05;'),
  '[25] +0.05 exposure while a torch / storm-lantern is lit');
ok(mainSrc.includes('this._covered = covered;'), '[25] roof/covered flag persisted on `this` for the renderFrame drive');
// [27] living bloom drive: constructor literals (0.32/0.5/0.85) STAND — driven as properties at runtime.
ok(/new UnrealBloomPass\(size, 0\.32, 0\.5, 0\.85\)/.test(mainSrc), '[27] UnrealBloomPass constructor literals unchanged (0.32/0.5/0.85) — driven at runtime, not in the ctor');
ok(mainSrc.includes('this.bloomPass.strength = 0.32 + nightness * 0.14 + golden * 0.1;'),
  '[27] bloom strength drive: 0.32 + nightness·0.14 + golden·0.1 (swells at dusk/night)');
ok(mainSrc.includes('this.bloomPass.threshold = 0.85 - nightness * 0.06;'),
  '[27] bloom threshold drive: 0.85 - nightness·0.06 (more of the scene blooms at night)');
// nightness/golden derived frae sky.time the same way the S2a glitter / S3a cloud drives read dayness
ok(mainSrc.includes('const sunY = Math.sin((sky.time - 0.25) * Math.PI * 2);') && mainSrc.includes('const nightness = 1 - dayness;'),
  '[27] nightness = 1 - dayness, dayness frae the shared sky.time sun curve (same math as the glitter/cloud drives)');
ok(mainSrc.includes('const golden = sunY > -0.05 ? Math.max(0, 1 - Math.abs(sunY) / 0.30) : 0;'),
  '[27] golden = low-sun factor, peaks at the horizon hours, self-zeroes by full day OR deep night');
// [26] GradeShader v2: uDread/uGrain/uWarmth uniforms + their GLSL, corner fringe, warmth split-tone
ok(mainSrc.includes('uDread: { value: 0 }') && mainSrc.includes('uWarmth: { value: 0 }'),
  '[26] uDread + uWarmth uniforms default 0 (fresh compile = today\'s plate)');
ok(mainSrc.includes('uGrain: { value: 0.015 }'), '[26] uGrain uniform ~0.015 (period photographic-plate grain)');
ok(mainSrc.includes('uniform float uDread;') && mainSrc.includes('uniform float uGrain;') && mainSrc.includes('uniform float uWarmth;'),
  '[26] uDread/uGrain/uWarmth declared in the grade fragment shader');
ok(mainSrc.includes('(hash12(vUv * 913.7 + fract(uTime) * 61.0) - 0.5) * uGrain * (1.0 - lum * 0.7)'),
  '[26] film grain: hash12(uv,time)-based, luminance-scaled (stronger in shadow, like a period plate) — reuses the existing hash12/uTime');
ok(mainSrc.includes('c = mix(c, vec3(lum), uDread * 0.35);'), '[26] dread desaturates toward luminance by uDread·0.35');
ok(mainSrc.includes('c *= 1.0 - dot(q, q) * (0.42 + uDread * 0.2);'),
  '[26] dread TIGHTENS the existing vignette (0.42 -> 0.42 + uDread·0.2) — the storm window closes in, not just dims');
ok(mainSrc.includes('vec3 hiTone = mix(vec3(1.045, 1.005, 0.955), vec3(1.07, 1.01, 0.92), uWarmth);'),
  '[26] warmth (killed-[3]\'s single owner): highlight split-tone leans amber ~1.07/1.01/0.92 as golden rises');
ok(mainSrc.includes('c.r = texture2D(tDiffuse, vUv + fr).r;') && mainSrc.includes('c.b = texture2D(tDiffuse, vUv - fr).b;')
  && mainSrc.includes('vec2 fr = qf * dot(qf, qf) * 0.0015;'),
  '[26] corner fringe: 2 extra taps re-sample .r/.b pushed radially by q·dot(q,q)·0.0015 (nil except at extreme corners)');
// per-frame grade uniform writes (Fine-only, deterministic frae sky state)
ok(mainSrc.includes('gu.uDread.value = sky.dread || 0;'), '[26] uDread driven frae the live sky.dread storm level (read-only — no sky.js edit)');
ok(mainSrc.includes('gu.uWarmth.value = golden;'), '[26] uWarmth driven frae the golden factor');
// Plain byte-identical: the whole drive block is inside the composer/Fine branch of renderFrame.
// Slice renderFrame's body and prove (a) the branch opens with the composer/Fine guard, (b) the
// exposure/bloom/grade drives all sit before this.composer.render(), and (c) the else-arm is the
// untouched direct render — so Plain never executes any drive (byte-identical to today).
{
  const rfStart = mainSrc.indexOf('renderFrame(dt) {');
  const rfEnd = mainSrc.indexOf('netDiag()', rfStart);
  ok(rfStart > 0 && rfEnd > rfStart, 'renderFrame body sliceable (anchors present)');
  const rf = mainSrc.slice(rfStart, rfEnd);
  const guardIdx = rf.indexOf("if (this.composer && this.gfxQuality === 'fine') {");
  const renderIdx = rf.indexOf('this.composer.render();');
  const elseIdx = rf.indexOf('this.renderer.render(this.scene, this.camera)');
  ok(guardIdx >= 0 && renderIdx > guardIdx, 'S5a: composer/Fine guard opens renderFrame before the composer render call');
  // every drive write sits inside the guard, before the composer render (i.e. Fine-only)
  for (const drive of ['let expTarget = EXPOSURE_BASE', 'this.bloomPass.strength = 0.32', 'gu.uDread.value = sky.dread', 'gu.uWarmth.value = golden']) {
    const di = rf.indexOf(drive);
    ok(di > guardIdx && di < renderIdx, `S5a: drive "${drive}…" is inside the Fine branch, before composer.render() — Plain never runs it`);
  }
  ok(elseIdx > renderIdx, 'S5a: Plain else-arm (direct renderer.render) sits AFTER the Fine branch — untouched by the drives');
}
ok(mainSrc.includes('const EXPOSURE_BASE = 1.25') && !/toneMappingExposure = 1\.25/.test(mainSrc),
  'S5a: the bare inline exposure literal 1.25 is gone — replaced by EXPOSURE_BASE + the adaptation');

// ---- Plain path: today's pipeline, renderer untouched ----
ok(mainSrc.includes('r.toneMapping = THREE.NoToneMapping'), 'Plain: no tone mapping (library default)');
ok(mainSrc.includes('r.shadowMap.enabled = false'), 'Plain: shadows off');
ok(/this\.composer\.dispose\(\); this\.composer = null/.test(mainSrc), 'Plain: composer torn down');
ok(mainSrc.includes('this.renderer.render(this.scene, this.camera)'), 'Plain: direct render path intact');
// sky Plain curves byte-identical to the shipped ones
ok(skySrc.includes('(0.25 + dayness * 1.0) * (1 - this.dread * 0.35) + flashLift'), 'Plain: original sun curve intact');
ok(skySrc.includes('(0.16 + dayness * 0.5) * (1 - this.dread * 0.25) + flashLift * 0.7'), 'Plain: original ambient curve intact');
ok(skySrc.includes("dayness < 0.4 ? 0.6 : 0.25"), 'Plain: original sun colour curve intact');

// ---- S1a: post stack — explicit MSAA scene target, FXAA rung ----
ok(mainSrc.includes("from 'three/addons/shaders/FXAAShader.js'"), 'FXAA shader imported');
ok(mainSrc.includes("samples: this._govState && this._govState.aa === 'msaa' ? 4 : 0"), 'explicit MSAA scene target, samples keyed to the governor rung');
ok(mainSrc.includes('new EffectComposer(this.renderer, rt)'), 'composer built over the explicit half-float target');
ok(mainSrc.includes('type: THREE.HalfFloatType'), 'scene target stays HDR half-float');
ok(/this\.composer\.addPass\(new OutputPass\(\)\);[\s\S]{0,400}this\.fxaaPass = new ShaderPass\(FXAAShader\);[\s\S]{0,300}this\.composer\.addPass\(this\.fxaaPass\);[\s\S]{0,300}this\.gradePass = new ShaderPass\(GradeShader\)/.test(mainSrc),
  'FXAA sits between OutputPass and the grade');
ok(mainSrc.includes("aa: mobile ? 'fxaa' : 'msaa'"), 'touch/mobile opens FXAA, desktop opens 4x MSAA');

// ---- S1a: frame-time resolution governor (wiring; decision logic in verify-governor.mjs) ----
ok(/\/\/ GOV-PURE-BEGIN[^\n]*\n[\s\S]*?\/\/ GOV-PURE-END/.test(mainSrc), 'pure governor block sliceable');
ok(mainSrc.includes('export const GOV_SCALES = [1.5, 1.25, 1.0]'), 'resolution ladder');
ok(mainSrc.includes('this._dtEma = this._dtEma * 0.95 + dt * 0.05'), 'frame-dt EMA');
ok(mainSrc.includes('stepGovernor(this._govState, this._dtEma * 1000, this.clock.elapsedTime)'), 'pure step drives the live governor');
ok(mainSrc.includes('if (swapAA) this.rebuildComposer()'), 'AA swap rebuilds the composer');
ok(mainSrc.includes('Math.min(window.devicePixelRatio || 1, this._resScale)'), 'one resolver: min(DPR, governor scale)');
ok(/window\.addEventListener\('resize', \(\) => \{[\s\S]{0,400}?this\.applyResolution\(\);/.test(mainSrc),
  'resize handler routes through applyResolution (re-reads DPR)');
ok(mainSrc.includes('this.composer.setPixelRatio(pr); this.composer.setSize(w, h)'), 'composer kept in step with renderer DPR');
ok(mainSrc.includes('this.fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr))'), 'FXAA fed true RT texel size');

// ---- S1a: CAS sharpen (in the grade pass) ----
ok(mainSrc.includes('sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0)) * uSharp'), 'AMD CAS weight');
ok(mainSrc.includes('(1.5 - this._resScale) * 0.5'), 'CAS strength rides the governor rung, ~0 at full quality');
ok((mainSrc.match(/texture2D\(tDiffuse, vUv \+ vec2\(/g) || []).length === 4, 'CAS takes exactly 4 cross-taps');

// ---- S1a: resource hygiene ----
ok(mainSrc.includes('const old = this.heldSprite.material.map'), 'held-item swap keeps the old texture in hand…');
ok(mainSrc.includes('if (old) old.dispose();'), '…and disposes it once the new one is on');
ok(mainSrc.includes('if (this.bloomPass) this.bloomPass.dispose()'), 'teardown disposes bloom internals');
ok(mainSrc.includes('map: getCutoutAtlas(), alphaTest: 0.5'), 'leaf-shadow depth pass uses the no-mip atlas twin');

// ---- S1b: atlas mip gutters; cutouts stay mip-free ----
ok(texSrc.includes('const PAD = 4'), 'atlas cells carry a 4px edge-replicated mip gutter');
ok(texSrc.includes('minFilter = THREE.NearestMipmapLinearFilter'), 'terrain atlas mips on');
ok(texSrc.includes('cutoutAtlasTexture.generateMipmaps = false'), 'no-mip twin for alphaTest cutouts');
ok(texSrc.includes('replicateGutters(bctx, baseCanvas'), 'gutters replicated after every painter has run');
ok(mesherSrc.includes('map: getCutoutAtlas()'), 'cutout material samples the no-mip twin');
{
  const [u0, , u1] = tileUV(17);
  ok(Math.abs((u1 - u0) * ATLAS_TILES - 16 / 24) < 1e-9, 'tileUV spans exactly the 16px payload of a 24px cell');
}

// ---- S1d: sky — shadow texel snap + world-edge fog budget ----
ok(skySrc.includes('SHADOW_TEXEL = 140 / 2048'), 'shadow frustum snapped to whole texels');
ok(skySrc.includes('_snapShadowCamera() {') && skySrc.includes('if (fine) this._snapShadowCamera()'),
  'texel snap exists and is Fine-gated (Plain has no shadow map)');
// Re-tuned 2026-07-03 (DELIBERATE, not a weakening): world.renderDist raised 6→7 so the
// fog line could move out — James found clear-weather 84 too close in. The budget maths
// below is the SAME contract at the new radius: full occlusion inside the meshed edge.
ok(skySrc.includes('STREAM_RADIUS = 7 * CHUNK'), 'fog budget mirrors world.renderDist (7 since the 2026-07-03 re-tune)');
ok(skySrc.includes('const fogBand = (10 + this.fogFar * 0.18) * (1 - gf) + Math.max(2.5, this.fogFar * 0.15) * gf;'), 'fog is a BAND at the edge — and the Great Fog is that band CLOSING IN (gf blend, James 2026-07-03)');
ok(skySrc.includes('Math.max(this.fogFar * (0.3 + 0.5 * gf), this.fogFar - fogBand)'), 'mist/rain/dread keep the near floor; Great Fog floor rises with gf — crisp bubble, no ghost zone');
ok(src('../src/world.js').includes('this.renderDist = 7'), 'world.js renderDist is actually 7 — the sky.js mirror cannot drift');
ok(skySrc.includes('uFogBand'), 'dome holds the fog colour at the horizon band');
{
  // numeric mirror of the sky.js fogTargetFar knee — constants parsed from the REAL
  // source so this can't drift silently if someone retunes the budget
  const mR = skySrc.match(/const STREAM_RADIUS = (\d+) \* CHUNK/);
  const mM = skySrc.match(/const FOG_FAR_MAX = Math\.floor\(STREAM_RADIUS \* ([\d.]+)\)/);
  const mK = skySrc.match(/const FOG_KNEE = (\d+)/);
  ok(mR && mM && mK, 'fog-budget constants parseable from sky.js');
  ok(skySrc.includes('FOG_KNEE + (baseFog - FOG_KNEE) * ((FOG_FAR_MAX - FOG_KNEE) / (160 - FOG_KNEE))'),
    'soft knee compresses open weather into the budget, not a flat min()');
  const R = Number(mR[1]) * CHUNK;                 // guaranteed meshed radius (112 since the re-tune)
  const MAX = Math.floor(R * Number(mM[1]));
  const KNEE = Number(mK[1]);
  const baseFog = 160;                             // clearest open-weather target
  const far = baseFog <= KNEE ? baseFog : KNEE + (baseFog - KNEE) * ((MAX - KNEE) / (160 - KNEE));
  ok(far <= 0.9 * R, `clear-weather fog (far ${far}) fully occludes inside the ${R}-block meshed radius`);
  // pin the re-tune itself: clear weather must actually REACH ~98 (the point of the change) —
  // a silent renderDist revert would fail here, not just quietly shrink the view again
  ok(far >= 96, `clear-weather fog (far ${far}) reaches ~98 (the 2026-07-03 push-out, from 84)`);
}

// ---- S2a: living water ([15]) + flowing becks ([D0]) — behavioural checks in verify-water.mjs ----
const moorsgeoSrc = src('../src/moorsgeo.js');
for (const u of ['uWaterTime', 'uRippleAmp', 'uFlowAmp', 'uGlitter', 'uFresnel', 'uSunLow'])
  ok(mesherSrc.includes(`${u}: { value: 0 }`), `${u} module uniform exists, defaults 0 (Plain = today's flat water)`);
// key extended '-sword' 2026-07-03 (deliberate): corridor uniforms/GLSL fork a fresh program
ok(mesherSrc.includes("customProgramCacheKey = () => 'liquid-ice-water-sword'"), 'liquid stays ONE compiled program — ice + water + sword share the addWater handler/key');
ok((mesherSrc.match(/customProgramCacheKey/g) || []).length === 2, 'no sibling onBeforeCompile handlers snuck in (exactly addSnow + addWater set keys)');
ok(mesherSrc.includes('transformed.y += aTop'), 'water displacement gated by aTop — bed walls never move');
ok(mesherSrc.includes('(1.0 - aFreeze * uFrozen)'), 'ripples freeze solid wi’ the winter ice (uFrozen semantics untouched — binary until S2c)');
ok(mesherSrc.includes('vec4 wWaterPos = modelMatrix * vec4(transformed, 1.0)'), 'ripple/glitter phase in WORLD space via modelMatrix (addSnow idiom, no per-chunk repeat)');
ok(mesherSrc.includes('normalize(vViewPosition)'), 'grazing-angle fresnel reads Lambert’s vViewPosition (Fine-only via uFresnel)');
ok(mesherSrc.includes("setAttribute('aTop'") && mesherSrc.includes("setAttribute('aFlow'"), 'aTop/aFlow baked as buffer attributes (liquid pass only)');
ok(mesherSrc.includes("typeof geo.riverFlow === 'function'"), 'stylised world guarded wi’ the worldgen typeof idiom — aFlow zero-fills there');
ok(mesherSrc.includes('const FLOW_WRAP = Math.PI * 50'), 'chainage wrap constant documented + exported (50π: every vFlowS sinusoid completes whole cycles)');
ok(mesherSrc.includes('rf.s % FLOW_WRAP'), 'baked chainage actually wrapped (float32-safe on the long Esk)');
ok(moorsgeoSrc.includes('riverFlow(x, z)'), 'geo.riverFlow exists (downstream tangent + chainage + bank)');
ok(moorsgeoSrc.includes('_flowIndex()'), '8-block segment cell index present (perf ruling: brute force cost +37% mesh time)');
// Plain byte-identical: applyQuality stamps every amp to 0; glitter re-driven Fine-only
ok(mainSrc.includes('setRippleAmp(fine ? 0.05 : 0)'), 'applyQuality: ripple amp 0.05 Fine / 0 Plain');
ok(mainSrc.includes('setFlowAmp(fine ? 0.05 : 0)'), 'applyQuality: flow amp 0.05 Fine / 0 Plain');
ok(mainSrc.includes('setFresnel(fine ? 0.35 : 0)'), 'applyQuality: fresnel 0.35 Fine / 0 Plain');
ok(/setRippleAmp\(fine \? 0\.05 : 0\);\s*\n\s*setFlowAmp\(fine \? 0\.05 : 0\);\s*\n\s*setGlitter\(0\);/.test(mainSrc), 'applyQuality parks uGlitter at 0 (Plain never sparkles)');
ok(/if \(this\.gfxQuality === 'fine'\) \{[\s\S]{0,500}?setGlitter\(dayness \* \(1 - overcast\)\);/.test(mainSrc), 'glitter driven per frame frae dayness × clear-sky, Fine only');
ok(mainSrc.includes('setWaterTime(this._glintT)'), 'water clock rides the existing glint tick — no new per-client accumulator');
ok(mainSrc.includes('overcastGrey(this.sky.weather'), 'overcast term mirrors sky.js’s own overcastGrey call');

// ---- [sword] the sword of the sun (2026-07-03) — corridor glint replaces the lattice ----
// James binned the old doubly-periodic sin×sin glitter (a uniform blob grid tiling the
// whole sea). The lattice-literal assertions that used to live in the shader are gone
// DELIBERATELY — replaced by the corridor contract below.
ok(mesherSrc.includes('uCamPos: { value: new THREE.Vector3() }'), 'uCamPos module uniform exists, defaults origin');
ok(mesherSrc.includes('uSunAzim: { value: new THREE.Vector2() }'), 'uSunAzim module uniform exists, defaults (0,0) → corridor 0 (off-state sane)');
ok(mesherSrc.includes('shader.uniforms.uCamPos = waterUniforms.uCamPos'), 'uCamPos re-bound in the ALWAYS-RUN block (idempotency guard preserved)');
ok(mesherSrc.includes('shader.uniforms.uSunAzim = waterUniforms.uSunAzim'), 'uSunAzim re-bound in the always-run block');
ok(mesherSrc.includes('shader.uniforms.uSunLow = waterUniforms.uSunLow'), 'uSunLow re-bound in the always-run block');
ok(mesherSrc.includes('max(0.0, dot(wView / wVL, uSunAzim))'), 'behind-the-sun zeroing: max(0,dot) kills the corridor when facing away');
ok(mesherSrc.includes('pow(wAlign, mix(6.0, 24.0, uSunLow))'), 'corridor term present — k blends 6 (noon pool) → 24 (horizon blade) via uSunLow');
ok(mesherSrc.includes('float wHash(vec2 p)'), 'water handler carries its own tiny hash (separate injection from addSnow — no borrowed csHash)');
ok(mesherSrc.includes('wHash(floor(wGp * 3.5))'), 'glints are CELLULAR (hashed sub-block cells, per-cell phase + brightness), not a lattice');
ok(!mesherSrc.includes('sin(wGp.x * 2.3'), 'the old doubly-periodic lattice glitter is GONE from the shader');
ok(mesherSrc.includes('wG * wCorr * wDist * uGlitter * (1.0 - ice)'), 'final glint = cell sparkle × corridor × near-fade × uGlitter × (1−ice) — uGlitter keeps its dayness×clear drive');
// [sword-2] the pulse fix (James 2026-07-03): the blade used to THROB as a whole — one shared
// twinkle frequency (2.4 rad/s), phase drawn from the SAME hash the density gate selects on
// (so the visible high-wH slice blinked near-in-phase), and max(0,sin)'s 50% duty cycle
// strobing that synchronized population fully dark. Contract now: per-cell speed AND phase
// both come from a SECOND independent hash, and the twinkle is floored — dims, never vanishes.
ok(mesherSrc.includes('wHash(floor(wGp * 3.5) + 19.19)'), '[sword-2] second independent hash (wH2) — twinkle decorrelated from the density-gate hash');
ok(mesherSrc.includes('0.55 + 0.45 * sin(uWaterTime * (1.5 + wH2 * 2.5) + wH2 * 6.2831)'), '[sword-2] per-cell speed (1.5–4.0 rad/s) AND phase hash-derived; twinkle floored — a cell dims, never strobes off');
ok(!mesherSrc.includes('max(0.0, sin(uWaterTime'), '[sword-2] the shared-frequency 50%-duty strobe (max(0,sin(uWaterTime·2.4…))) is GONE — no whole-blade throb');
for (const s of ['setCamPos', 'setSunAzim', 'setSunLow'])
  ok(mesherSrc.includes(`export function ${s}(`), `${s} setter exported from mesher.js`);
ok(/if \(this\.gfxQuality === 'fine'\) \{[\s\S]{0,1200}?setSunAzim\(_ax \/ _al, _az \/ _al\);/.test(mainSrc),
  'sun azimuth driven per frame in the Fine block (Plain: uGlitter stays 0, sword inert)');
ok(mainSrc.includes('setCamPos(_cp.x, _cp.y, _cp.z)'), 'camera world pos driven scalar-wise (no per-frame alloc)');
ok(mainSrc.includes('const _ax = _sunX * 160, _az = -60'), 'azimuth derived from the TRUE sunSprite offset (sunX·160, −60) — not the idealised z=0 sun');

// ---- S2b [16]: the shoreline — depth tint + foam (behaviour in verify-shoreline.mjs) + horizon sea ring ----
ok(mesherSrc.includes('export const DEPTH_TINT_AMP = 1'), 'depth-tint kill switch exists, ships on');
ok(mesherSrc.includes('export const FOAM_CAP = 32'), 'foam capped at 32 quads per chunk (0 = kill switch)');
ok(mesherSrc.includes("setAttribute('aGlint'"), 'GeoBuilder bakes aGlint when foam rides a chunk (the red-team gap closed)');
ok(mesherSrc.includes('waterDepthTint(d)'), 'liquid pass scales vertex colour through the pure waterDepthTint helper');
ok((mesherSrc.match(/customProgramCacheKey/g) || []).length === 2,
  'S2b added NO shader code: still exactly the addSnow + addWater handlers/keys');
ok(texSrc.includes('TILE_PAINTERS[TILE.FOAM]'), 'FOAM painted procedurally through the one atlas pipeline (no-asset invariant)');
// the horizon sea ring — fogged, flat, follows the player; the OLD unfogged backdrop is GONE
ok(mainSrc.includes('new THREE.RingGeometry(90, 500, 48)'), 'sea ring: RingGeometry inner 90 / outer 500 / 48 segments');
ok(mainSrc.includes('this.seaRing.rotation.x = -Math.PI / 2'), 'sea ring rotated -PI/2 about X to lie flat (RingGeometry is XY-plane)');
ok(/seaRing = new THREE\.Mesh\(new THREE\.RingGeometry/.test(mainSrc)
  && mainSrc.includes('fog: true, depthWrite: false'), 'sea ring material is FOGGED (fog: true) — dissolves at the fog line');
ok(mainSrc.includes('const SEA_RING = true'), 'sea-ring kill switch exists, ships on');
ok(mainSrc.includes('_seaRingCol.set(SEA_RING_COL)') && mainSrc.includes('this.seaRing.material.color.lerp(_seaRingCol'),
  'ring colour lerped toward the water colour each frame via a module-scratch Color (no allocation)');
ok(mainSrc.includes('camY > 60') && mainSrc.includes('geo.coastT(Math.round(p.x), Math.round(p.z)) > 0'),
  'ring shown when the camera is high OR the player is over coastal ground; hidden inland');
ok(mainSrc.includes('this.seaRing.geometry.dispose(); this.seaRing.material.dispose()'),
  'ring geometry/material built once, disposed on world teardown (invariant 7)');
ok(!mainSrc.includes('this.seaPlane'), 'the OLD solid sea-plane backdrop is fully retired (no consumer left)');
ok(!mainSrc.includes('fog: false'), 'no unfogged material construction left in main.js — nowt can poke through the fog line');

// ---- S3a [0]: cloud shadows sweeping the moor — folded into the addSnow handler ----
// module uniforms exist, default 0 — a fresh compile is today's terrain exactly
ok(mesherSrc.includes('uCloudTime: { value: 0 }'), 'uCloudTime module uniform exists, defaults 0');
ok(mesherSrc.includes('uCloudShadowAmt: { value: 0 }'), 'uCloudShadowAmt module uniform exists, defaults 0');
ok(mesherSrc.includes('shader.uniforms.uCloudTime = cloudUniforms.uCloudTime')
  && mesherSrc.includes('shader.uniforms.uCloudShadowAmt = cloudUniforms.uCloudShadowAmt'),
  'cloud uniforms registered inside the EXISTING addSnow handler (one handler slot — no sibling)');
// injection point + what it touches
ok(mesherSrc.includes(".replace('#include <lights_fragment_end>'")
  && mesherSrc.includes("'#include <lights_fragment_end>\\n'"),
  'cloud term injected AFTER lights_fragment_end (include itself preserved)');
ok(mesherSrc.includes('reflectedLight.directDiffuse *= 1.0 - csCloud * uCloudShadowAmt'),
  'cloud blocks DIRECT sun only — reflectedLight.directDiffuse multiplied');
ok((mesherSrc.match(/reflectedLight\./g) || []).length === 1 && !mesherSrc.includes('indirectDiffuse'),
  'ambient untouched: exactly ONE reflectedLight write, indirectDiffuse never touched (shade stays readable)');
ok(mesherSrc.includes('if (uCloudShadowAmt > 0.001) {'),
  'whole term wrapped in the >0.001 uniform branch — a zero uniform skips the ALU (Plain hard requirement)');
// the dome's noise idiom, hard-capped at 2 octaves on terrain (perf ruling)
ok(mesherSrc.includes('float csFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 2; i++){ v += a * csNoise(p); p *= 2.0; a *= 0.5; } return v; }'),
  'terrain fbm is EXACTLY 2 octaves — the literal loop, the perf ruling made assertable');
ok(mesherSrc.includes('fract(p * vec2(123.34, 345.45))') && skySrc.includes('fract(p * vec2(123.34, 345.45))'),
  'hash is the dome\'s own idiom (same constants in sky.js and mesher.js)');
ok(mesherSrc.includes('vec2(vSnowWX, vSnowWZ) * 0.012'),
  'sampled at world XZ ~0.012/block through the EXISTING snow varyings (no new attribute)');
ok(mesherSrc.includes('uCloudTime * vec2(0.012, 0.007)') && skySrc.includes('uTime * vec2(0.012, 0.007)'),
  'ground drift rides the dome\'s wind vector — sky clouds and moor shadows move together');
// cache keys forked, program count unchanged
ok(mesherSrc.includes("customProgramCacheKey = () => key + '-cloud-wet'"),
  "BOTH snow cache keys extended ('-cloud-wet') so the cloud + wet-ground uniforms/GLSL fork fresh programs");
ok(/'snow-opaque'\)/.test(mesherSrc) && /'snow-cutout-glint', true\)/.test(mesherSrc),
  'still exactly the two addSnow materials (opaque + cutout-glint) — same program COUNT');
// drive: Plain stamped 0 in applyQuality; Fine per-frame off the live sky (no sky.js edit)
ok(/setFresnel\(fine \? 0\.35 : 0\);[\s\S]{0,250}?setCloudShadow\(0\);/.test(mainSrc),
  'applyQuality parks uCloudShadowAmt at 0 — Plain\'s branch never executes, terrain byte-identical');
ok(mainSrc.includes('setCloudTime(this.sky.cloudT || 0)'),
  'cloud clock fed frae sky.cloudT — the SAME accumulator the dome scrolls by (churn speed-up an\' all)');
// window 1600→2800 (2026-07-03, deliberate): the [sword] glint drive now sits between the
// Fine gate and this call (beside setGlitter, its natural home) — same semantic contract
// (cloud shadow driven INSIDE the Fine gate), just more code in between.
ok(/if \(this\.gfxQuality === 'fine'\) \{[\s\S]{0,2800}?setCloudShadow\(Math\.min\(0\.35, 1\.4 \* cover \* dayness \* \(1 - overcast\)\)\);/.test(mainSrc),
  'Fine drive: cover × dayness × clear-sky, clamped at 0.35 — self-zeroes at night and in full overcast');
ok(mainSrc.includes('this.sky.domeMat.uniforms.uClouds.value'),
  'cover read off the live dome uniform (uClouds) — no sky.js edit needed');

// ---- S3b [9/17 merged]+[D6]+[D10]: wet ground — one coherent system in the addSnow handler ----
const roadsSrc = src('../src/roads.js');
// module uniforms exist, default 0 — a fresh compile is today's terrain byte-identical
ok(mesherSrc.includes('uWetness: { value: 0 }'), 'uWetness module uniform exists, defaults 0 (Plain = today\'s dry ground)');
ok(mesherSrc.includes('uGroundWet: { value: 0 }'), 'uGroundWet module uniform exists, defaults 0 (the shaped drive input)');
ok(mesherSrc.includes('uSheen: { value: 0 }'), 'uSheen module uniform exists, defaults 0 (Fine-only sheen gate)');
ok(mesherSrc.includes('uWetSky: { value: new THREE.Color(0, 0, 0) }'), 'uWetSky module uniform is a Color defaulting BLACK (no tint on a fresh/Plain compile)');
// registered inside the EXISTING addSnow handler — no sibling onBeforeCompile
ok(mesherSrc.includes('shader.uniforms.uWetness = wetUniforms.uWetness')
  && mesherSrc.includes('shader.uniforms.uGroundWet = wetUniforms.uGroundWet')
  && mesherSrc.includes('shader.uniforms.uSheen = wetUniforms.uSheen')
  && mesherSrc.includes('shader.uniforms.uWetSky = wetUniforms.uWetSky'),
  'wet uniforms registered inside the EXISTING addSnow handler (one handler slot — no sibling)');
ok((mesherSrc.match(/customProgramCacheKey/g) || []).length === 2,
  'still exactly addSnow + addWater set cache keys — no sibling handler snuck in for the wet term');
// [D6] the aWet attribute: baked in the vertex stream, defaults 0 (the aGlint idiom)
ok(mesherSrc.includes('attribute float aWet') && mesherSrc.includes('varying float vWet'),
  'aWet attribute + vWet varying declared in the addSnow vertex stage');
ok(mesherSrc.includes('vWet = aWet;'), 'aWet passed through to the fragment (vWet)');
ok(mesherSrc.includes("g.setAttribute('aWet'") && mesherSrc.includes('if (this.hasWet)'),
  'aWet baked ONLY when a quad carries a non-zero value (missing-attr-defaults-0 idiom, like aGlint)');
ok(mesherSrc.includes('export function soakBias(tile)') && mesherSrc.includes('[TILE.SAND, 0.1]') && mesherSrc.includes('[TILE.GRAVEL, 0.85]'),
  'soakBias table keyed by top-tile family (gravel/dirt/peat high, sand low)');
ok(mesherSrc.includes('if (occludes(lx + 1, y + 1, lz)) hol++;'),
  '[D6] hollowness counts the 4 horizontal neighbours with an opaque block one course UP');
ok(mesherSrc.includes('aWet = hol + soakBias(faceTile(def, 3, swx, swz));'),
  'aWet packs hollowCount (int) + soakBias (fraction) — only on solid top faces (f===3)');
// [9/17] wet darkening: cool-damp shift after the snow mix, gated by uWetness × shaped wetEff
ok(mesherSrc.includes('float wet = uWetness * wetEff * vSnowExp * smoothstep(0.4, 0.9, vSnowUp) * (0.7 + 0.3 * sin(vSnowWX * 0.11) * cos(vSnowWZ * 0.13));'),
  'wet term: uWetness × [D10] wetEff × sky-exposure × up-gate × drift-sine (the merged 9/17 formula)');
ok(mesherSrc.includes('diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62) * vec3(0.92, 0.96, 1.04), wet);'),
  'wet darkening is a cool-damp shift (blue-lean 0.92,0.96,1.04) — tier-flat, no sky tint');
// [D10] shelter shaping — spatially-varying dry times from ONE scalar, no new attributes
ok(mesherSrc.includes('float shel = clamp((1.0 - vSnowExp * 0.6) + (1.0 - dot(vColor.rgb, vec3(0.33))) * 0.9, 0.0, 1.0);'),
  '[D10] shelter signal from vSnowExp + vColor AO luminance (no new attributes)');
ok(mesherSrc.includes('float wetEff = pow(uGroundWet, mix(1.7, 0.45, shel));'),
  '[D10] wetEff shapes uGroundWet: exposed (exp 1.7) dries first, AO corners (0.45) last');
// [D6] puddle mask: threshold slides with uGroundWet, mirror-dark mix, rides wetEff
ok(mesherSrc.includes('float pud = smoothstep(1.0 - uGroundWet * 1.4, 1.08 - uGroundWet * 1.4, bias * 0.5 + hol * 0.25 + csHash(vec2(floor(vSnowWX), floor(vSnowWZ))) * 0.3) * vSnowExp * step(0.9, vSnowUp) * wetEff;'),
  '[D6] puddle formula: threshold slides with uGroundWet, hash-irregular edges, rides wetEff (hollows dry last)');
ok(mesherSrc.includes('diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35 + uWetSky * 0.25, pud);'),
  '[D6] mirror-dark puddle mix — uWetSky BLACK on Plain gives darkening only, tint is Fine-only');
// [9] Fine sheen: the RED-TEAM-VERIFIED-CORRECT fresnel (normal·view), injected before opaque_fragment
ok(mesherSrc.includes('float fres = pow(1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0), 3.0);'),
  '[9] correct fresnel literal (normal·view, NOT [17]\'s wrong view-space-y term)');
ok(mesherSrc.includes('outgoingLight += uSheen * wet * fres * uWetSky;')
  && mesherSrc.includes(".replace('#include <opaque_fragment>'"),
  'sheen added to outgoingLight, injected BEFORE opaque_fragment (shared main() scope in r166 Lambert)');
// DRIVE: pure module (DOM-free), tier-flat darkening + Fine sky tint
ok(src('../src/wetness.js').includes('export function stepGroundWet(w, rainAmount, warmth, dayness, dt)'),
  'stepGroundWet is a pure DOM-free drive in src/wetness.js (snow.js idiom)');
ok(mainSrc.includes('this.groundWet = stepGroundWet(this.groundWet, this.sky.rainAmount, season.warmth, dayness, dt);'),
  'groundWet integrated each frame frae the shared weather sample (deterministic)');
ok(mainSrc.includes('setWetness(this.groundWet)') && mainSrc.includes('setGroundWet(this.groundWet)'),
  'uWetness + uGroundWet driven every frame (TIER-FLAT — weather reads on the ground both tiers)');
// Plain byte-parity: uSheen stamped 0, uWetSky stamped BLACK in applyQuality
ok(/setSheen\(fine \? 0\.5 : 0\);[\s\S]{0,120}?setWetSky\(0, 0, 0\);/.test(mainSrc),
  'applyQuality stamps uSheen 0 + uWetSky BLACK — Plain gets darkening only, no sky tint (byte-parity via zero)');
ok(mainSrc.includes('const fc = this.sky.scene.fog.color;') && mainSrc.includes('setWetSky(fc.r, fc.g, fc.b);'),
  'Fine feeds uWetSky the LIVE sky/fog colour (dawn-glow tint an\' all) — no per-frame alloc');
// [D6] mud lanes: earthMat colour lerps toward mud by groundWet
ok(roadsSrc.includes('const LANE_DRY = new THREE.Color(0x6e5a3e)') && roadsSrc.includes('const LANE_WET = new THREE.Color(0x4a3a26)'),
  '[D6] mud-lane endpoints: dry 0x6e5a3e -> wet mud 0x4a3a26 (module scratch Colors, no alloc)');
ok(roadsSrc.includes('this.earthMat.color.copy(LANE_DRY).lerp(LANE_WET,'),
  '[D6] lane material darkens toward mud by groundWet — one CPU lerp per frame, no shader work');
ok(mainSrc.includes('this.roads.update(dt, this.player.pos, this.groundWet)'),
  'RoadLayer.update fed the live groundWet so the lanes muddy in the rain');

// ---- S4a [4]: t' 1900 night sky — seeded stars, moon calendar, Milky Way, dawn-glow fog ----
// functional determinism: the star field is pure, seeded, byte-identical on every client
{
  const realRandom = Math.random;
  Math.random = () => { throw new Error('buildStarField must not consult Math.random (invariant 6)'); };
  let A, B;
  try { A = buildStarField(); B = buildStarField(); }
  finally { Math.random = realRandom; }
  ok(A.mag.length === 1100 && A.pos.length === 3300 && A.col.length === 3300, 'star field: 1100 seeded stars with pos/col/mag');
  ok(Buffer.from(A.pos.buffer).equals(Buffer.from(B.pos.buffer))
    && Buffer.from(A.col.buffer).equals(Buffer.from(B.col.buffer))
    && Buffer.from(A.mag.buffer).equals(Buffer.from(B.mag.buffer)),
    'star field byte-identical across calls — t\' SAME heavens ower every moor');
  let bright = 0;
  for (let i = 0; i < A.mag.length; i++) if (A.mag[i] > 1.65) bright++;
  const frac = bright / A.mag.length;
  ok(frac > 0.03 && frac < 0.10, `power-law magnitudes: a bright minority (mag > 1.65 is ${(frac * 100).toFixed(1)}%, want 3..10%)`);
  ok(Math.abs(moonPhase(29.53 / 2) - 0.5) < 1e-9 && Math.abs(moonPhase(29.53)) < 1e-9,
    'moon calendar: full at 14.765, new wraps at 29.53');
}
// source wiring: stars, twinkle, Milky Way, moon phase + halo, dawn-glow fog
ok(skySrc.includes('const field = buildStarField()'), 'stars built frae the seeded field (no per-star Math.random)');
ok(skySrc.includes('gl_PointSize = size * aMag * twinkle;'), 'per-star magnitude + twinkle scale gl_PointSize in the injected vertex stage');
ok(skySrc.includes("this._starU.uTwinkle.value = fine ? 1 : 0"), 'twinkle is Fine-gated (Plain leaves uTwinkle 0 — static field, same program)');
ok(skySrc.includes('uStarAmt: { value: 0 }'), 'dome uStarAmt uniform exists, defaults 0 (fresh compile = today, no Milky Way)');
ok(skySrc.includes('exp(-pow(dot(dir, GPOLE), 2.0) * 30.0)'), 'Milky Way: great-circle band about GPOLE (narrowed 16->30, James 2026-07-03)');
ok(skySrc.includes('cu.uStarAmt.value = starA * (1 - grey) * (1 - 0.55 * moonVis * mwIllum)'), 'Milky Way: night term, doused by overcast AND washed out by a bright moon (James 2026-07-03)');
ok(skySrc.includes('if (this._moonDay !== this.day) this._drawMoonPhase()'), 'moon disc redrawn once per game DAY, never per frame');
ok(skySrc.includes('this.moonSprite.add(this.moonHalo)'), 'halo parented to the moon sprite — rides it for free');
ok(skySrc.includes('this.moonHalo.material.opacity = this._mistS * moonVis * (1 - grey)'),
  'halo = mistiness × moon-up × clear-of-overcast — t\' shepherd\'s rain-sign');
ok(skySrc.includes('_fogC.lerp(this.sun.color, dawnAmt)'), 'dawn-glow fog: mist borrows the low sun\'s own colour');
ok(skySrc.includes('this.scene.fog.color.copy(_fogC)') && skySrc.includes('this.domeMat.uniforms.bottomColor.value.copy(_fogC)'),
  '_fogC feeds BOTH scene fog and dome horizon — one colour at the fog line, tint or no tint');
{
  // [22] allocation-free hot path: no Color allocation inside update() itself
  const uStart = skySrc.indexOf('update(dt, playerPos');
  const uEnd = skySrc.indexOf('_snapShadowCamera() {');
  ok(uStart > 0 && uEnd > uStart, 'sky.update() body sliceable (anchors present)');
  const body = skySrc.slice(uStart, uEnd);
  ok(!body.includes('new THREE.Color(') && !body.includes('.clone()'),
    'sky.update() allocates no Colors — no new THREE.Color / .clone() in the per-frame path');
}

// ---- item 36: the visible lightning bolt + storm sky (shape checks in verify-storm.mjs) ----
// bolt shape seeded frae (strike index, world seed) — no Math.random, identical every client
ok(stormSrc.includes('mulberry32((Math.imul(index | 0, 2654435761) ^ (worldSeed | 0)) | 0)'),
  'bolt RNG is mulberry32 over strike-index ^ world-seed (invariant 6)');
ok(stormSrc.includes('if (this._boltLine) return true'), 'bolt meshes are pooled — built once, reused every strike');
ok(stormSrc.includes('new Float32Array(BOLT_MAX_SEGS * 2 * 3)') && stormSrc.includes('new Float32Array(BOLT_MAX_POINTS * 2 * 3)'),
  'line + glow buffers preallocated at the polyline maxima (zero allocation per strike)');
ok(stormSrc.includes("this._glowOn = !!(sky && sky.gfx === 'fine')"), 'the wide glow ribbon is Fine-gated (Plain keeps the thin line)');
ok(stormSrc.includes('blending: THREE.AdditiveBlending, depthWrite: false, fog: false'),
  'bolt materials are additive, no depth-write, unfogged');
ok(stormSrc.includes('const f = sky.flash * sky.flash'), 'bolt opacity rides the sky flash decay, squared for a sharp gutter');
ok(stormSrc.includes('sky.stormChurn = 1') && stormSrc.includes('stormChurn: sky.stormChurn'),
  'storm asserts stormChurn each frame and caches/restores the prior value');
// sky side: the uFlash cloud whiten + the churned storm deck
ok(skySrc.includes('uFlash: { value: 0 }'), 'sky dome has the uFlash uniform, defaults 0 (Plain untouched)');
ok(skySrc.includes('col = mix(col, vec3(1.0), uFlash * 0.6 * cloud);'), 'flash whitens the cloud term in-shader');
ok(skySrc.includes('cu.uFlash.value = this.flash * this.flash'), 'uFlash driven frae the squared flash decay');
ok(skySrc.includes("this._stormS += ((this.stormChurn ? 1 : 0) - this._stormS)"), 'churn eases in/out (no snap)');
ok(skySrc.includes('dt * (1 + churn * 2)'), 'storm deck scrolls ~3x under full churn');
ok(skySrc.includes('(grey + (1 - grey) * churn)'), 'churn drives cloud coverage toward full');
ok(skySrc.includes('STORM_CLOUD = new THREE.Color(0.06, 0.06, 0.08)'), 'near-black storm deck colour hoisted (no per-frame alloc)');

// ---- S4b [30] rainbow + [31] aurora — antisolar bow + shared-clock northern lights ----
// dome shader: uSunDir/uRainbow/uAurora uniforms + the two GLSL arcs, all gated so a
// zero uniform is byte-identical to today's sky. Drive lives in update(); the two
// scheduling helpers are pure (no `this`, no DOM) so the gate proves the cadence.
ok(skySrc.includes('uRainbow: { value: 0 }'), 'dome uRainbow uniform exists, defaults 0 (no bow — today\'s sky)');
ok(skySrc.includes('uSunDir: { value: new THREE.Vector3'), 'dome uSunDir uniform is a Vector3 (sun direction in dome dir space)');
ok(skySrc.includes('float ca = dot(dir, -uSunDir);'), 'rainbow ca = cos angle to the ANTISOLAR point (−uSunDir)');
ok(skySrc.includes('cu.uSunDir.value.set(sunX, sunY, 0).normalize()'), 'uSunDir fed frae the sun ANGLE (sunX/sunY, z=0), normalised — not the player-relative sprite');
ok(skySrc.includes('0.743') && skySrc.includes('0.629'), 'both bow radii present: primary cos(42°)=0.743, secondary cos(51°)=0.629');
ok(skySrc.includes('cu.uRainbow.value = this._rainbowS * dayness * (1 - grey)'), 'uRainbow folds eased strength × dayness × clear-sky (a bow needs sun on rain)');
ok(skySrc.includes('uAurora: { value: 0 }'), 'dome uAurora uniform exists, defaults 0 (no curtains — today\'s night)');
ok(skySrc.includes('float northDot = dir.z;'), 'aurora masked to the NORTHERN sky (+Z is north in dome dir space)');
ok(skySrc.includes('fbm(vec2(az * 6.0, uTime * 0.15))'), 'aurora curtains = the dome\'s OWN fbm sampled at (azimuth·6, uTime·0.15) — driftin\' vertical streaks');
ok(skySrc.includes('const AURORA_CYCLE = DAY_LENGTH * 10'), 'aurora cadence ~ten game days (AURORA_CYCLE = DAY_LENGTH × 10)');
// [31] auroraWindow — pure shared-clock envelope: one lit window per ~ten game days,
// centred on midnight, easin' in/out ower ~25s (the Great Fog idiom, longer cadence).
{
  const DAY_LENGTH = 1800;               // sky.js:8 — asserted below to stay honest
  const CYCLE = DAY_LENGTH * 10;         // AURORA_CYCLE — matches sky.js literal
  const DUR = DAY_LENGTH / 3;            // AURORA_DUR — a third of a game day lit
  // sample the whole envelope across three cycles: the lit fraction must be DUR/CYCLE
  // (one window per ten game days) — proves the cadence, not just a single sample
  let litSteps = 0, total = 0;
  const STEP = 5; // seconds
  for (let s = 0; s < 3 * CYCLE; s += STEP) { total++; if (auroraWindow(s * 1000) > 0) litSteps++; }
  ok(Math.abs(litSteps / total - DUR / CYCLE) < 1e-3,
    `aurora lit fraction ≈ DUR/CYCLE (one window per ten game days) — got ${(litSteps / total).toFixed(4)}, want ${(DUR / CYCLE).toFixed(4)}`);
  ok(auroraWindow(((CYCLE - DUR) + DUR / 2) * 1000) === 1, 'aurora peaks (envelope 1) at the window\'s midpoint');
  ok(auroraWindow(0) === 0, 'aurora dark outside its window (t=0 is between displays)');
}
// [30] rainbowRising — pure rise/decay rule: 1 when rain's DECAYIN' frae a real shower
// toward clear/misty wi' the sun up, else 0. NOTE the weather gate (sky.js:118) treats
// 'clear' AND 'misty' as clearing; 'fog' (and owt else, e.g. 'rain') is NOT clearing → 0.
ok(rainbowRising(0.4, 0.6, 0.3, 'clear') === 1, 'bow rises on a clearin\' shower wi\' the sun up');
ok(rainbowRising(0.6, 0.4, 0.3, 'clear') === 0, 'rising rain (not decayin\') → no bow');
ok(rainbowRising(0.4, 0.6, -0.1, 'clear') === 0, 'sun down (sunY ≤ 0.05) → no bow');
ok(rainbowRising(0.4, 0.6, 0.3, 'fog') === 0, "'fog' is not a clearin' state (only clear/misty are) → no bow");
ok(rainbowRising(0.1, 0.2, 0.3, 'clear') === 0, 'weak prior shower (prevRain ≤ 0.3) → no bow — a drizzle raises nowt');
// DAY_LENGTH honesty: the cadence test hardcodes 1800 — assert the real source agrees
ok(skySrc.includes('const DAY_LENGTH = 1800;'), 'DAY_LENGTH is 1800s in sky.js — the aurora cadence test\'s hardcoded 1800 stays honest');

// ---- S3c [10]+[D14] wind sway + gust fronts, [D8] dew, [14] snow polish (behaviour in verify-sway.mjs) ----
// module uniforms exist, default so a fresh compile is today's look byte-identical
for (const u of ['uSwayAmp', 'uWindAmt', 'uGustPhase', 'uDew', 'uSparkle'])
  ok(mesherSrc.includes(`${u}: { value: 0 }`), `${u} module uniform exists, defaults 0 (Plain/today byte-identical)`);
ok(mesherSrc.includes("uWindDir: { value: new THREE.Vector2(0.83, 0.55) }"),
  'uWindDir baked as the prevailing sou\'wester vec2(0.83,0.55) — period-true, zero feed risk');
// still exactly the addSnow + addWater handlers/keys — no sibling handler snuck in for the slice
ok((mesherSrc.match(/customProgramCacheKey/g) || []).length === 2,
  'S3c added NO new handler: still exactly addSnow + addWater set cache keys (program COUNT unchanged)');
ok(mesherSrc.includes("customProgramCacheKey = () => key + '-cloud-wet'"),
  'the ONE addSnow key still carries every term — sway/dew/sparkle ride the existing program');
// [10]/[D8] aSway + the dew channel bake into the ONE cutout program via GeoBuilder
ok(mesherSrc.includes('attribute float aSway') && mesherSrc.includes('varying float vSway') && mesherSrc.includes('varying float vGust'),
  'aSway attribute + vSway/vGust varyings declared in the addSnow vertex stage');
ok(mesherSrc.includes("g.setAttribute('aSway'") && mesherSrc.includes('if (this.hasSway)'),
  'aSway baked ONLY when a quad carries a non-zero value (missing-attr-defaults-0 idiom, like aGlint/aWet)');
ok(mesherSrc.includes('this.sway.push(sway ? c[4] : 0)'),
  '[10] aSway is PER-CORNER: top verts (c[4]===1) sway 1, rooted base 0 — the plant hinges at its base');
ok(mesherSrc.includes('0, null, null, null, 0.4, 0, 1'),
  '[10]/[D8] chunk plant flora bakes sway=1 + glint=0.4 (dew channel); structural cutouts keep the defaults');
// [D14] DETERMINISM — the single most important correctness point: the gust plane wave rides
// uGustPhase (fed Date.now in main.js), NOT the per-client uGlintTime accumulator
ok(mesherSrc.includes('float gp = dot(wSnowPos.xz, uWindDir)') && mesherSrc.includes('vGust = vn1(gp * 0.045 - uGustPhase * uGustSpeed)'),
  '[D14] gust is a plane wave along uWindDir on uGustPhase (the SHARED wall-clock, NOT uGlintTime)');
ok(mesherSrc.includes('export function setGustPhase(t)'),
  'setGustPhase exported (main.js drives it from the shared Date.now clock — wiring returned to the orchestrator)');
ok((mesherSrc.match(/float vn1\(float x\)/g) || []).length === 1,
  '[D14] vn1 (1-D value noise) defined exactly once — a plane wave is what a gust front is');
// [10]/[D14] anchored after wSnowPos (string-ordering red-team catch): replace 'vSnowExp = aSnowExp;'
ok(mesherSrc.includes(".replace('vSnowExp = aSnowExp;'"),
  'sway/gust anchored on \'vSnowExp = aSnowExp;\' (AFTER wSnowPos) so phase reads the pre-displacement world pos');
ok(mesherSrc.includes('transformed.xz += swayA * vec2(sin(uGlintTime * 1.4'),
  '[10] sway displacement rides the per-blade oscillator (uGlintTime) but the FRONT rides uGustPhase');
// [D8] dew channel split — base forage glint preserved EXACTLY (byte-parity at uDew=0)
ok(mesherSrc.includes('step(0.75, vGlint) * 0.12 * (0.5 + 0.5 * sin(uGlintTime * 2.0 + vGlintH))'),
  '[D8] base forage glint preserved to the bit: step(0.75,vGlint)*0.12 — byte-identical at uDew=0');
ok(mesherSrc.includes('float glDew = vGlint * uDew * 0.18'),
  '[D8] dew is a SEPARATE uDew-gated channel (vGlint*uDew*0.18) — collapses to 0 at uDew=0');
ok(floraLayerSrc.includes('...HOST_FORAGE.map(h => h.tile)') && floraLayerSrc.includes('p.glintTiles.has(tile) ? 1 : 0.4'),
  '[D8] floraLayer: glintTiles superset of HOST_FORAGE (bilberry bug fixed); every other cross gets the 0.4 dew channel');
ok(floraLayerSrc.includes('[0, 0, 1, 1, 0, 0, 1, 1]'),
  '[10] floraLayer crossGeom bakes aSway (top verts 1) — scatter flowers sway with the heather');
// [14] snow polish + the SHARED sparkle-cell helper (landed ONCE, shared with [D8] dew)
ok((mesherSrc.match(/float sparkleCell\(vec2 wxz, float scale, float t\)/g) || []).length === 1,
  '[14] the sparkle-cell helper is defined EXACTLY once — shared by [14] frost + [D8] dew (single-ownership)');
ok(mesherSrc.includes('vec3(0.78, 0.85, 1.0)') && mesherSrc.includes('smoothstep(0.34, 0.5, snowRaw)'),
  '[14] shadow-blue snow (AO cools to blue) + drift edges (smoothstep band sharpens with cover)');
ok(mesherSrc.includes('snow * uSparkle * sparkleCell'),
  '[14] frost sparkle rides uSparkle (Fine-only, Plain 0), fires only where the snow wash is active');

console.log(`verify-graphics: ${n} assertions OK`);
