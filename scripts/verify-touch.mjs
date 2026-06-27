// Headless: the pure gesture->signal helpers. No DOM (touch.js must not touch document at import).
import assert from 'node:assert';
import { joystickToKeys, lookDelta, isTouchPrimary, touchMode } from '../src/touch.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// joystickToKeys: dy<0 is "pushed up" = forward (KeyW). radius 40.
const R = 40;
const center = joystickToKeys(0, 0, R);
ok(!center.KeyW && !center.KeyA && !center.KeyS && !center.KeyD && !center.KeyZ, 'centre/deadzone -> nothing pressed');
ok(!joystickToKeys(0, -5, R).KeyW, 'inside deadzone (5 < 0.18*40) -> not forward');
const up = joystickToKeys(0, -20, R);
ok(up.KeyW && !up.KeyS && !up.KeyA && !up.KeyD && !up.KeyZ, 'half-up -> forward only, no sprint');
const fullUp = joystickToKeys(0, -40, R);
ok(fullUp.KeyW && fullUp.KeyZ, 'full-up (mag >= 0.85*40) -> forward + sprint');
const upRight = joystickToKeys(28, -28, R);
ok(upRight.KeyW && upRight.KeyD && !upRight.KeyA && !upRight.KeyS, 'up-right -> forward + right (diagonal)');
const down = joystickToKeys(0, 30, R);
ok(down.KeyS && !down.KeyW, 'pushed down -> back');
const left = joystickToKeys(-30, 0, R);
ok(left.KeyA && !left.KeyD, 'pushed left -> strafe left');

// lookDelta: yaw/pitch deltas the CALLER subtracts (mirrors mousemove). sens 0.0042.
const ld = lookDelta(100, 50, 0.0042);
ok(Math.abs(ld.dYaw - 0.42) < 1e-9 && Math.abs(ld.dPitch - 0.21) < 1e-9, 'lookDelta scales by sens');

// isTouchPrimary: coarse + no-hover => true; a fine pointer => false.
const mmTrue = (q) => ({ matches: q.includes('coarse') || q.includes('none') });
ok(isTouchPrimary(mmTrue, { maxTouchPoints: 5 }) === true, 'coarse + no-hover -> touch primary');
ok(isTouchPrimary((q) => ({ matches: q.includes('fine') }), { maxTouchPoints: 0 }) === false, 'fine pointer, no touch -> not primary');

// touchMode: a touch device may opt on/off; a computer is auto-detect only (can't force the HUD on).
ok(touchMode('on', true) === true, 'mode on -> touch on a touch device');
ok(touchMode('on', false) === false, 'mode on -> NOT forced on a computer (auto-detect only)');
ok(touchMode('off', true) === false, 'mode off -> never touch');
ok(touchMode('auto', true) === true && touchMode('auto', false) === false, 'mode auto -> follows detection');

console.log(`verify-touch: ${n} assertions OK`);
