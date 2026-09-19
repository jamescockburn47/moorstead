import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FreeplayGame } from '../src/freeplay/runtime.js';
import { FreeplayActions } from '../src/freeplay/actions.js';
import { FreeplayConnection } from '../src/freeplay/connection.js';
import { OverrideStore } from '../src/freeplay/terrain-overrides.js';
import { FREEPLAY } from '../src/freeplay/config.js';
import { B } from '../src/defs.js';

function runtime() {
  const game = Object.create(FreeplayGame.prototype);
  Object.assign(game, {
    active: true, ready: true, transactions: [], applying: null, resyncPending: false,
    ui: { message() {}, report() {}, undo: {}, error: {} },
    actions: { cancelled: 0, cancel() { this.cancelled++; } },
    connection: { connected: true, epoch: 1, pending: null, stage: null, history: [],
      socket: {}, reconnects: 0, reconnect() { this.reconnects++; this.connected = false; } },
  });
  return game;
}
function transfer(revision, rows, extra = {}) {
  const edits = new OverrideStore();
  for (const row of rows) edits.setCell(...row);
  return { epoch: 1, revision, kind: 'edit', count: edits.size, edits, ...extra };
}

// A hidden tab receives WebSocket commits while requestAnimationFrame is suspended.
// Alternating one voxel must not retain a fresh 32 KiB array indefinitely.
{
  const game = runtime();
  const net = new FreeplayConnection({ acct: 'test', token: 'synthetic-token', name: 'Henry', room: FREEPLAY.room }, {
    state() {}, error() {}, transaction: value => game.transaction(value),
  });
  net.receive({ type: 'init', protocol: 1, contentVersion: 2, minContentVersion: 2, freeplay: true, room: FREEPLAY.room, seed: FREEPLAY.seed,
    epoch: 1, revision: 0, history: [], players: [], count: 0 });
  net.receive({ type: 'ready', epoch: 1, revision: 0 });
  for (let revision = 1; revision <= 1000; revision++) {
    net.receive({ type: 'begin', epoch: 1, revision, kind: 'edit', replace: false, count: 1 });
    net.receive({ type: 'delta', epoch: 1, revision, edits: [[0, 30, 0, revision % 2]] });
    net.receive({ type: 'commit', epoch: 1, revision, history: [], checkpoint: false });
    assert(game.transactions.length <= 32, 'background commits have a finite retained-operation cap');
  }
  await Promise.resolve();
  assert.equal(game.connection.reconnects, 1, 'one resync request, not one request per dropped commit');
  assert.equal(game.transactions.length, 0); assert.equal(game.applying, null);
  assert.equal(game.ready, false, 'no edits against the incompletely applied old world');
  assert.equal(game.resyncPending, true);
  game.transaction(transfer(1000, [[0, 30, 0, B.PLANKS]], { snapshot: true }));
  assert.equal(game.resyncPending, false); assert.equal(game.transactions.length, 1);
}

// Counting operations alone is insufficient: include every allocated chunk array,
// including the operation currently being applied, not only its remaining cells.
{
  const game = runtime();
  const chunks = count => Array.from({ length: count }, (_, i) => [(i % 32) * 16, 10, Math.floor(i / 32) * 16, B.AIR]);
  game.applying = { transfer: transfer(1, chunks(600)) };
  game.transaction(transfer(2, chunks(500)));
  await Promise.resolve();
  assert.equal(game.connection.reconnects, 1, 'aggregate retained chunk arrays trigger resync');
  assert.equal(game.applying, null); assert.equal(game.transactions.length, 0);
}

// A reset or reconnect snapshot supersedes both a partly applied blast and work
// still in the queue. No pre-reset effect or edit can run after the replacement.
for (const extra of [{ snapshot: true }, { replace: true, epoch: 2 }]) {
  const game = runtime(), completed = [];
  game.world = { cells: new Map(), applyEdits(rows) { for (const [x, y, z, id] of rows) this.cells.set(`${x},${y},${z}`, id); },
    replaceOverrides(store) { this.cells = new Map(store); } };
  game.scenery = { invalidate() {} }; game.home = () => {};
  game.complete = value => { completed.push(value.revision); game.ready = true; };
  const rows = Array.from({ length: 5000 }, (_, i) => [i % 100, 10, Math.floor(i / 100), B.AIR]);
  game.transaction(transfer(1, rows)); game.applyTransaction();
  assert(game.applying); assert(game.world.cells.size > 0 && game.world.cells.size < rows.length);
  game.transaction(transfer(2, [[500, 10, 0, B.PLANKS]]));
  game.transaction(transfer(3, [[1, 10, 1, B.STONE]], extra));
  assert.equal(game.applying, null); assert.equal(game.transactions.length, 1);
  game.applyTransaction(); game.applyTransaction();
  assert.deepEqual([...game.world.cells], [['1,10,1', B.STONE]]);
  assert.deepEqual(completed, [3]);
}

function armedGame() {
  const game = runtime(), sent = [], notices = [];
  Object.assign(game, { scene: new THREE.Scene(), player: { pos: { x: 0, y: 40, z: 0 }, eye: 1.62 },
    camera: new THREE.PerspectiveCamera(), paused: false, unlockAudio() {} });
  game.ui.message = text => notices.push(text);
  game.connection.command = (...args) => { sent.push(args); return 'request-id'; };
  game.actions = new FreeplayActions(game);
  game.actions.target = () => ({ x: 0, y: 30, z: 0, face: [0, 1, 0] });
  game.actions.choose({ type: 'bomb', id: 'atom' }); game.actions.use();
  return { game, sent, notices };
}

{
  const { game, sent, notices } = armedGame();
  game.actions.update(3.9); game.applying = { transfer: { kind: 'blast' } }; game.actions.update(.2);
  assert(game.actions.fuse, 'expired fuse survives another player’s in-progress blast');
  assert.equal(sent.length, 0); assert.match(notices.at(-1), /queued/i);
  game.applying = null; game.connection.pending = 'other-edit'; game.actions.update(.1);
  assert(game.actions.fuse); assert.equal(sent.length, 0);
  game.connection.pending = null; game.actions.update(.1); game.actions.update(.1);
  assert.equal(sent.length, 1); assert.equal(sent[0][0], 'blast'); assert.equal(game.actions.fuse, null);
  game.actions.dispose();
}
for (const invalidate of [game => { game.connection.epoch++; }, game => { game.connection.connected = false; },
  game => { game.connection.socket = {}; }]) {
  const { game, sent } = armedGame();
  game.actions.update(3.9); invalidate(game); game.actions.update(.2);
  assert.equal(game.actions.fuse, null); assert.equal(sent.length, 0, 'old throws cannot cross a reset or reconnect');
  game.actions.dispose();
}
{
  const { game, sent } = armedGame(), command = game.connection.command;
  game.connection.command = () => { throw new Error('socket unavailable'); };
  game.actions.update(4.1); assert(game.actions.fuse, 'a failed submission must not consume the queued bomb');
  game.connection.command = command; game.actions.update(.1);
  assert.equal(sent.length, 1); assert.equal(game.actions.fuse, null); game.actions.dispose();
}

// Unloaded columns read as solid for collision safety, but are not editable targets.
{
  const game = runtime();
  Object.assign(game, { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    player: { pos: { x: .5, y: 10, z: .5 }, eye: 1.62 },
    world: { isLoaded: (_x, z) => z >= 0, getBlock: (_x, _y, z) => z < 0 ? B.STONE : B.AIR } });
  const actions = new FreeplayActions(game);
  assert.equal(actions.target(), null, 'do not target the unloaded collision wall');
  game.world.isLoaded = () => true;
  assert(actions.target(), 'the same actual loaded stone is a valid target');
  actions.dispose();
}
console.log('PASS freeplay runtime: bounded queued arrays, authoritative replacement, queued fuses, reset/reconnect cancellation, loaded targets');
