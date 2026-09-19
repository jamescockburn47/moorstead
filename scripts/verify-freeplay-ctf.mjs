import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { validBattleState } from '../src/freeplay/battle-protocol.js';
import { BATTLE_REGION } from '../src/freeplay/battle-config.js';
import { FreeplayBattle } from '../src/freeplay/battle.js';
import { captureHint, warBombAllowed } from '../src/freeplay/capture-ui.js';

const [x, z] = BATTLE_REGION.origin;
const bases = { blue: [x + 16, 24, z + 64], red: [x + 110, 24, z + 64] };
const actor = { id: 'actf-test', name: 'Henry', team: 'blue', x: bases.blue[0], y: 24, z: bases.blue[2],
  yaw: 0, hp: 100, shield: 100, shieldCooldown: 0, respawn: 0, spawnSeq: 1, correctionSeq: 0 };
const flag = team => ({ team, x: bases[team][0], y: bases[team][1], z: bases[team][2],
  status: 'home', carrier: null, returnIn: 0 });
const baseState = { available: true, revision: 1,
  bounds: { minX: x, minZ: z, maxX: x + 127, maxZ: z + 127 }, camps: bases,
  scores: { blue: 0, red: 0 }, players: [actor], soldiers: [], shields: [] };
const setup = { phase: 'setup', winner: null, bases: { blue: null, red: null }, flags: {} };
const active = { phase: 'active', winner: null, bases, flags: { blue: flag('blue'), red: flag('red') } };
const valid = ctf => validBattleState({ ...baseState, ctf });

assert(valid(setup), 'both teams can begin with no base selected');
assert(valid({ ...setup, bases: { blue: bases.blue, red: null }, flags: { blue: flag('blue') } }),
  'the first selected base is visible while the other team prepares');
assert(valid(active));
assert(valid({ ...active, flags: { ...active.flags, red: { ...flag('red'), status: 'carried', carrier: actor.id } } }));
assert(valid({ ...active, flags: { ...active.flags, red: { ...flag('red'), status: 'dropped', returnIn: 20 } } }));
assert(valid({ ...active, phase: 'won', winner: 'blue' }));

for (const ctf of [
  { ...active, phase: 'unknown' }, { ...active, winner: 'green' },
  { ...active, bases: { ...bases, red: [Infinity, 24, z + 64] } },
  { ...active, flags: { ...active.flags, red: { ...flag('red'), status: 'lost' } } },
  { ...active, flags: { ...active.flags, red: { ...flag('red'), returnIn: 20.01 } } },
  { ...active, flags: { ...active.flags, red: { ...flag('red'), x: NaN } } },
  { ...active, flags: { ...active.flags, red: { ...flag('red'), carrier: 123 } } },
]) assert(!valid(ctf), 'malformed flag state must not enter the live renderer');

for (const id of ['mega', 'atom']) {
  assert(!warBombAllowed(id, true)); assert(warBombAllowed(id, false));
}
for (const id of ['grenade', 'dynamite', 'demolition']) assert(warBombAllowed(id, true));
assert.match(captureHint({ ctf: setup }, actor), /Choose your base/);
assert.match(captureHint({ ctf: { ...active, phase: 'won', winner: 'blue' } }, actor), /wins/);
const sent = [], messages = [];
const controller = Object.assign(Object.create(FreeplayBattle.prototype), {
  me: actor, cooldown: 0, state: { ...baseState, ctf: setup },
  game: { ready: true, camera: new THREE.PerspectiveCamera(), unlockAudio() {},
    ui: { message: value => messages.push(value), panel: { close() {} } },
    connection: { connected: true, battle: (...args) => { sent.push(args); return true; } },
    actions: { direction: new THREE.Vector3(), weapons: { tone() {} } } },
});
assert(controller.fire({ id: 'machinegun' })); assert.equal(sent.length, 0, 'setup cannot fire');
controller.setBase(); assert.deepEqual(sent.pop(), ['battle-base', {}], 'base uses server-accepted position');
controller.ready(); assert.deepEqual(sent.pop(), ['battle-ready', {}], 'ready is one explicit server-owned step');
controller.state.ctf = active;
assert(controller.fire({ id: 'machinegun' })); assert.equal(sent.pop()[0], 'battle-shot');
controller.cooldown = 0; controller.state.ctf = { ...active, phase: 'won', winner: 'blue' };
assert(controller.fire({ id: 'machinegun' })); assert.equal(sent.length, 0, 'a won round cannot fire');

// Cross the actual Python-to-JS protocol boundary, including a death drop and win.
const python = spawnSync('python', ['-c', `
import json,sys
sys.path.insert(0,'deploy/free-play/tests')
from test_battle import flat_arena
from freeplay_battle import Battle
x,z=json.loads(sys.argv[1]); arena=flat_arena();arena.origin=[x,z]
arena.camps={'blue':[x+10,1,z+10],'red':[x+16,1,z+10]}
b=Battle(arena); b.join('ablue','Blue','blue');b.join('ared','Red','red')
states=[]
def save(label): states.append([label,json.loads(json.dumps(b.state()))])
save('setup');b.flags.set_ready('ablue');save('one base')
red=b.players['ared'];red.update(x=x+50,y=1,z=z+10);b.flags.set_ready('ared');save('active')
blue=b.players['ablue'];blue.update(x=x+49,y=1,z=z+10);b.flags.tick();save('carried')
b.damage(blue,999,'red');save('dropped');b.flags.tick();save('returned')
b.spawn(blue);blue.update(x=x+49,y=1,z=z+10);b.flags.tick()
blue.update(x=x+10,z=z+10);b.flags.tick();save('won')
print(json.dumps(states))
`, JSON.stringify(BATTLE_REGION.origin)], { encoding: 'utf8', timeout: 15000 });
assert.equal(python.status, 0, python.stderr);
const emitted = JSON.parse(python.stdout);
assert.deepEqual(emitted.map(([label]) => label), ['setup', 'one base', 'active', 'carried', 'dropped', 'returned', 'won']);
for (const [label, state] of emitted) assert(validBattleState(state), 'actual server state accepted: ' + label);
assert.equal(emitted[3][1].ctf.flags.red.carrier, 'ablue');
assert.equal(emitted[4][1].ctf.flags.red.status, 'dropped');
assert.equal(emitted[5][1].ctf.flags.red.status, 'home');
assert.equal(emitted[6][1].ctf.winner, 'blue');
console.log('Free-play CTF client: PASS (actual Python setup/carry/drop/return/win states, bomb restrictions and combat-phase controls).');
