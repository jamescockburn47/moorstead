// Where tha can dig deep for free, and how to get a licence — map markers + toasts.
import { B, CHUNK } from './defs.js';

export const PARISH_QUARRY_LABELS = {
  quarry_moorstead: 'Moorstead quarry',
  quarry_goathland: 'Goathland quarry',
  quarry_pickering: 'Pickering quarry',
};

/** Parish quarries from deeds + display names. */
export function parishQuarries(deeds = []) {
  return (deeds || [])
    .filter(d => d && d.kind === 'quarry' && !d.lapsedDay)
    .map(d => ({
      kind: 'quarry',
      id: d.id,
      name: PARISH_QUARRY_LABELS[d.id] || 'Parish quarry',
      cx: d.cx,
      cz: d.cz,
      radius: d.radius || 10,
      free: true,
    }));
}

export function distXZ(x, z, site) {
  return Math.hypot(site.cx - x, site.cz - z);
}

/** Compass label from world offset (north = +x, east = +z). */
export function directionLabel(dx, dz) {
  if (Math.hypot(dx, dz) < 6) return 'hereabouts';
  const ang = Math.atan2(dz, dx) * (180 / Math.PI);
  if (ang >= -22.5 && ang < 22.5) return 'north';
  if (ang >= 22.5 && ang < 67.5) return 'north-east';
  if (ang >= 67.5 && ang < 112.5) return 'east';
  if (ang >= 112.5 && ang < 157.5) return 'south-east';
  if (ang >= 157.5 || ang < -157.5) return 'south';
  if (ang >= -157.5 && ang < -112.5) return 'south-west';
  if (ang >= -112.5 && ang < -67.5) return 'west';
  return 'north-west';
}

export function formatSiteHint(site, x, z) {
  const dx = site.cx - x, dz = site.cz - z;
  const d = Math.round(distXZ(x, z, site));
  return `<b>${site.name}</b> — ${d}m ${directionLabel(dx, dz)}`;
}

/** Nearest free dig sites (parish quarries + scattered moor pits). */
export function nearestFreeDigSites(gen, deeds, x, z, limit = 3) {
  const sites = [...parishQuarries(deeds), ...(gen.listWildQuarries?.() || [])];
  return sites
    .map(s => ({ ...s, dist: distXZ(x, z, s) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

/** Toast + map highlights when a deep dig is refused. */
export function miningDigGuide(reason, player, world, extra = {}) {
  const px = player.pos.x, pz = player.pos.z;
  const highlights = [];
  let message = '';

  if (reason === 'nomine') {
    const nearest = nearestFreeDigSites(world.gen, world.deeds, px, pz, 3);
    const parish = nearest.find(s => s.kind === 'quarry');
    const wild = nearest.find(s => s.kind === 'wild');
    if (parish) highlights.push({ ...parish, pulse: true });
    if (wild) highlights.push({ ...wild, pulse: true });

    const freeLines = [];
    if (parish) freeLines.push(formatSiteHint(parish, px, pz));
    if (wild) freeLines.push(formatSiteHint(wild, px, pz));
    const freeTxt = freeLines.length
      ? ` <b>Free dig:</b> ${freeLines.join('; ')}. Marked on thi map — hold <b>Tab</b>.`
      : ' Seek a parish quarry or an old moor pit.';

    message =
      'Tha can\'t strip-mine open moor. Deep digging needs a <b>licensed mine</b> ' +
      '(craft a <b>Mine Entrance</b>, place it, buy a licence at a <b>notice board</b>) ' +
      'or a <b>free spot</b>.' + freeTxt;
  } else if (reason === 'depthlimit') {
    message = `Tha's hit this mine's licensed depth (${extra.limit || '?'} blocks below grade) — upgrade at a <b>notice board</b>.`;
  } else if (reason === 'pick' || reason === 'fixture') {
    const pickName = extra.pickNeeded === 'wood' ? 'Wooden Pick' : extra.pickNeeded === 'stone' ? 'Gritstone Pick' : 'Iron Pick';
    const fixtureName = extra.fixtureNeeded === B.PIT_PROPS ? 'Pit Props'
      : extra.fixtureNeeded === B.SAFETY_LAMP ? 'Safety Lamp'
      : extra.fixtureNeeded === B.WINCH ? 'Winch' : 'safety gear';
    if (extra.fixtureNeeded) {
      message = `Tha needs an <b>${pickName}</b> an' <b>${fixtureName}</b> installed in thi mine to go deeper. Buy fixtures from thi bench; place them inside thi mine bounds.`;
    } else {
      message = `Tha needs a <b>${pickName}</b> to go deeper in this band.`;
    }
  }

  return { message, highlights };
}

/** Draw a world marker on the HUD minimap (north up, player centred). */
export function drawMinimapMarker(ctx, player, scale, size, wx, wz, color, radius, ring) {
  const sx = (wz - player.pos.z) * scale + size / 2;
  const sy = -(wx - player.pos.x) * scale + size / 2;
  if (sx < -radius || sx > size + radius || sy < -radius || sy > size + radius) return false;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = ring ? 2 : 1;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fill();
  if (ring) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, radius + 3, 0, Math.PI * 2);
    ctx.stroke();
  } else ctx.stroke();
  return true;
}
