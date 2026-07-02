// Headless: the Fine/Plain graphics rig + t' storm lantern.
// Pure checks (quality resolution, wick-flicker determinism, item/recipe validity)
// run against real imports; renderer config (tone mapping, shadow rig, post stack)
// is source-level — headless Node has no GL, so we assert the flags are wired in
// the Fine path and that the Plain path leaves the renderer exactly as it was.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { B, I, CHUNK, RECIPES, CREATIVE_ITEMS, itemName, maxStack } from '../src/defs.js';
import { resolveQuality, lanternFlicker } from '../src/sky.js';
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
ok(skySrc.includes('STREAM_RADIUS = 6 * CHUNK'), 'fog budget mirrors world.renderDist');
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
  const R = Number(mR[1]) * CHUNK;                 // guaranteed meshed radius (96)
  const MAX = Math.floor(R * Number(mM[1]));
  const KNEE = Number(mK[1]);
  const baseFog = 160;                             // clearest open-weather target
  const far = baseFog <= KNEE ? baseFog : KNEE + (baseFog - KNEE) * ((MAX - KNEE) / (160 - KNEE));
  ok(far <= 0.9 * R, `clear-weather fog (far ${far}) fully occludes inside the ${R}-block meshed radius`);
}

// ---- S2a: living water ([15]) + flowing becks ([D0]) — behavioural checks in verify-water.mjs ----
const moorsgeoSrc = src('../src/moorsgeo.js');
for (const u of ['uWaterTime', 'uRippleAmp', 'uFlowAmp', 'uGlitter', 'uFresnel'])
  ok(mesherSrc.includes(`${u}: { value: 0 }`), `${u} module uniform exists, defaults 0 (Plain = today's flat water)`);
ok(mesherSrc.includes("customProgramCacheKey = () => 'liquid-ice-water'"), 'liquid stays ONE compiled program — ice + water share the addWater handler/key');
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

console.log(`verify-graphics: ${n} assertions OK`);
