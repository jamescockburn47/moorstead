// touch.js — touch-screen controls for phones & tablets. An INPUT ADAPTER: it renders a DOM HUD
// over the canvas and writes to the same input bus the keyboard/mouse feed, so the desktop path is
// untouched. The gesture->signal logic lives in these pure helpers (headlessly tested); the class
// below is thin DOM glue. NO module-level DOM access — verify-touch.mjs imports this under Node.

const DEADZONE = 0.18;   // fraction of joystick radius below which we read no movement
const SPRINT_AT = 0.85;  // fraction of radius beyond which a forward push also sprints
export const LOOK_SENS = 0.0042;  // touch look sensitivity (mouse is 0.0023; touch wants more)

// Joystick knob offset (dx,dy screen px; dy<0 = pushed up = forward) -> WASD+sprint booleans.
// 8-way: an octant around the push angle sets one or two of W/A/S/D.
export function joystickToKeys(dx, dy, radius) {
  const out = { KeyW: false, KeyA: false, KeyS: false, KeyD: false, KeyZ: false };
  const mag = Math.hypot(dx, dy);
  if (mag < DEADZONE * radius) return out;
  const ang = Math.atan2(-dy, dx);            // -dy so "up" (negative screen y) is +90deg = forward
  const deg = (ang * 180 / Math.PI + 360) % 360;
  if (deg > 22.5 && deg < 157.5) out.KeyW = true;     // forward arc
  if (deg > 202.5 && deg < 337.5) out.KeyS = true;    // back arc
  if (deg > 112.5 && deg < 247.5) out.KeyA = true;    // left arc
  if (deg < 67.5 || deg > 292.5) out.KeyD = true;     // right arc
  if (mag >= SPRINT_AT * radius && out.KeyW) out.KeyZ = true;
  return out;
}

// Drag delta (screen px) -> yaw/pitch deltas the CALLER subtracts (player.yaw -= dYaw, etc.).
export function lookDelta(dx, dy, sens = LOOK_SENS) {
  return { dYaw: dx * sens, dPitch: dy * sens };
}

// Is touch the PRIMARY pointer? mm = matchMedia fn, nav = navigator-like. Injected for tests.
export function isTouchPrimary(mm, nav) {
  const coarse = mm('(pointer: coarse)').matches;
  const noHover = mm('(hover: none)').matches;
  const fine = mm('(pointer: fine)').matches;
  if (coarse && noHover) return true;
  return (nav.maxTouchPoints || 0) > 0 && !fine;
}

// Resolve the stored mode ('auto'|'on'|'off') against detection.
export function touchMode(stored, isPrimary) {
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return !!isPrimary;
}
