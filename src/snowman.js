// snowman.js — pure snowman customisation model. No DOM, no three.js. Victorian-plausible options.
export const SCARF_COLORS = [0xb23b3b, 0x2f6e4f, 0x2a4d8f, 0x7a4da8, 0xc9a13b]; // red, green, blue, plum, gold
export const HATS = ['none', 'topper', 'bobble'];   // bare, Victorian top hat, bobble cap
export const NOSES = ['carrot', 'coal'];
export const DEFAULT_SNOWMAN = { scarf: 0, hat: 'topper', nose: 'carrot', arms: true, smile: true };

// Return a NEW config with `part` cycled/toggled. parts: scarf|hat|nose|arms|smile.
export function cycleSnowman(cfg, part) {
  const c = { ...cfg };
  if (part === 'scarf') c.scarf = (c.scarf + 1) % SCARF_COLORS.length;
  else if (part === 'hat') c.hat = HATS[(HATS.indexOf(c.hat) + 1) % HATS.length];
  else if (part === 'nose') c.nose = NOSES[(NOSES.indexOf(c.nose) + 1) % NOSES.length];
  else if (part === 'arms') c.arms = !c.arms;
  else if (part === 'smile') c.smile = !c.smile;
  return c;
}
