// Booked rail journeys: dep-aware waiting (just-in-time platform arrival, no ranked
// lottery) and a 16-passenger rake across the two coaches.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { railWaitMode, RAIL_WAIT_LEAD, rideSlot, slotBack } from '../src/roster.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// dep-aware wait: potter until the lead window, then approach; null dep -> legacy path
ok(railWaitMode(1000, null) === null, 'no booking -> caller falls back to ranked legacy');
ok(railWaitMode(1000, 1000 + RAIL_WAIT_LEAD + 1) === 'potter', 'early -> potter in town');
ok(railWaitMode(1000, 1000 + RAIL_WAIT_LEAD) === 'approach', 'inside the lead -> walk in');
ok(railWaitMode(1000, 900) === 'approach', 'train due/dwelling -> stay on the platform');
ok(RAIL_WAIT_LEAD >= 60 && RAIL_WAIT_LEAD <= 90, 'arrive roughly a minute early, per spec');

// 16 seats: slots 1..16, each with a distinct coach position within the rake envelope
const slots = new Set();
for (let i = 0; i < 400; i++) slots.add(rideSlot('pop-whitby-' + i));
ok(slots.size === 16, `full sixteen distinct slots used (got ${slots.size})`);
for (const s of slots) {
  ok(s >= 1 && s <= 16, 'slot in 1..16');
  const b = slotBack(s);
  ok(b >= 11 && b <= 18, `slot ${s} sits within the two coaches (back=${b})`);
}
ok(new Set([...slots].map(slotBack)).size === 16, 'no two slots share a seat position');

// wiring: _driveRail consults the booking before the ranked lottery
const src = readFileSync(new URL('../src/roster.js', import.meta.url), 'utf8');
// text of the _driveRail method body: everything after its definition (the last
// '_driveRail' token, past the two earlier call sites) — that is where the call lives.
ok(/railWaitMode\(/.test(src.split('_driveRail').at(-1) || ''), '_driveRail uses railWaitMode');
ok(/ride\.dep/.test(src), 'ride carries the booked departure');

console.log(`verify-seats: ${n} assertions OK`);
