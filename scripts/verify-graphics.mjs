// Headless: the Fine/Plain graphics rig + t' storm lantern.
// Pure checks (quality resolution, wick-flicker determinism, item/recipe validity)
// run against real imports; renderer config (tone mapping, shadow rig, post stack)
// is source-level — headless Node has no GL, so we assert the flags are wired in
// the Fine path and that the Plain path leaves the renderer exactly as it was.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { B, I, RECIPES, CREATIVE_ITEMS, itemName, maxStack } from '../src/defs.js';
import { resolveQuality, lanternFlicker } from '../src/sky.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const mainSrc = src('../src/main.js');
const skySrc = src('../src/sky.js');
const uiSrc = src('../src/ui.js');
const texSrc = src('../src/textures.js');
const playerSrc = src('../src/player.js');

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

console.log(`verify-graphics: ${n} assertions OK`);
