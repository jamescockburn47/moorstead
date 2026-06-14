// Landmark protection: the moor's monuments can't be broken, but tha can allus
// dig underneath. A block is protected iff it's built fabric (isBuiltMaterial),
// it sits AT OR ABOVE ground level, and it's within a landmark's radius. The
// radii mirror geo.locationName() so "what counts as the Abbey" is one story.
//
// Enforced client-side in the break path (same as t' creative/warden checks);
// wardens are exempt so they can repair or edit. The server reset is what undoes
// existing damage — this is what stops new damage.
import { ROSEBERRY, WAINSTONES, KILNS } from './geography.js';
import { isBuiltMaterial } from './defs.js';

export function protectedAt(geo, world, x, y, z, id) {
  if (!isBuiltMaterial(id)) return false;
  if (y < geo.height(x, z)) return false; // dig underneath owt tha likes

  // big named landmarks (centres + radii echo locationName)
  if (Math.hypot(x - ROSEBERRY.x, z - ROSEBERRY.z) < 30) return true;   // t' lone peak + its crag
  if (Math.hypot(x - WAINSTONES.x, z - WAINSTONES.z) < 16) return true; // t' gritstone tors
  if (Math.hypot(x - KILNS.x, z - KILNS.z) < 42) return true;           // Rosedale kilns + abbey arch
  const ab = geo.abbeySite();
  if (Math.hypot(x - ab.x, z - ab.z) < 38) return true;                 // Whitby Abbey ruin
  const mu = geo.museumSite && geo.museumSite();
  if (mu && Math.hypot(x - mu.x, z - mu.z) < 12) return true;           // t' Dracula Museum

  // NYMR stations — platforms, buildings, footbridges
  if (geo.nearStation(x, z, 16)) return true;

  // moor crosses (incl. Fat Betty) live on a 96-grid; check t' neighbouring cells
  const cx = Math.floor(x / 96), cz = Math.floor(z / 96);
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const c = geo.crossAt(gx, gz);
      if (c && Math.hypot(x - c.x, z - c.z) < 4) return true;
    }
  }
  return false;
}
