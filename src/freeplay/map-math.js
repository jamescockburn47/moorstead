// Moorstead's map convention: north is +x; east is +z. No DOM or shared state.
const TAU = Math.PI * 2;
const DIRECTIONS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const wrap = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;

export function isMapPosition(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.z)
    && (point.y === undefined || Number.isFinite(point.y));
}

export function fitMap(points, { width = 640, height = 420, padding = 36, minSpan = 128 } = {}) {
  if (![width, height, padding, minSpan].every(Number.isFinite) || width <= 0 || height <= 0
    || padding < 0 || padding * 2 >= Math.min(width, height)) return null;
  const positioned = Array.from(points || []).filter(isMapPosition);
  if (!positioned.length) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of positioned) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  const span = Math.max(128, minSpan, x1 - x0, z1 - z0);
  const scale = (Math.min(width, height) - padding * 2) / span;
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, span, scale, width, height, padding };
}

export function projectMap(point, frame) {
  if (!isMapPosition(point) || !frame || ![frame.cx, frame.cz, frame.scale, frame.width, frame.height].every(Number.isFinite)
    || frame.scale <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  return { x: frame.width / 2 + (point.z - frame.cz) * frame.scale,
    y: frame.height / 2 - (point.x - frame.cx) * frame.scale };
}

// Rotation for a triangle initially pointing up, matching the actual player
// forward vector [-sin(yaw), -cos(yaw)] in the world's x/z plane.
export function mapHeading(yaw) {
  return Number.isFinite(yaw) ? wrap(-yaw - Math.PI / 2) : null;
}

export function peerGuidance(player, peer, yaw, { connected = true } = {}) {
  if (connected !== true || player?.connected === false || peer?.connected === false
    || !isMapPosition(player) || !isMapPosition(peer) || !Number.isFinite(yaw)) return null;
  const dx = peer.x - player.x, dz = peer.z - player.z, distance = Math.hypot(dx, dz);
  const heightDifference = Number.isFinite(player.y) && Number.isFinite(peer.y) ? peer.y - player.y : null;
  if (distance < .01) return { distance, compass: 'here', bearing: null, turn: 0, arrow: '●', heightDifference };
  const bearing = Math.atan2(dz, dx), turn = wrap(bearing - mapHeading(yaw));
  const compassIndex = Math.round(((bearing % TAU + TAU) % TAU) / (Math.PI / 4)) % 8;
  const arrowIndex = Math.round(((turn % TAU + TAU) % TAU) / (Math.PI / 4)) % 8;
  return { distance, compass: DIRECTIONS[compassIndex], bearing, turn, arrow: ARROWS[arrowIndex], heightDifference };
}
