// Sky owns these objects and their materials/textures. Sprite quad geometry is
// shared internally by Three.js with every other Sprite and must stay alive.
const ROOTS = ['sun', 'ambient', 'sunSprite', 'moonSprite', 'stars', 'dome', 'rain', 'snow'];

export function disposeSky(sky) {
  if (sky._disposed) return;
  sky._disposed = true;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const name of ROOTS) {
    const root = sky[name];
    if (!root) continue;
    root.traverse(object => {
      if (object.geometry && !object.isSprite) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    root.removeFromParent();
  }
  sky.sun?.target.removeFromParent();
  // A shadow render target owns its attachments; dispose the target, not its
  // texture separately. The set also guards a reused map/mapPass reference.
  const shadow = sky.sun?.shadow;
  for (const target of new Set([shadow?.map, shadow?.mapPass])) target?.dispose();
  if (shadow) { shadow.map = null; shadow.mapPass = null; }
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  if (sky.scene.fog === sky._fog) sky.scene.fog = null;
  if (sky.scene.background === sky._bg) sky.scene.background = null;
}
