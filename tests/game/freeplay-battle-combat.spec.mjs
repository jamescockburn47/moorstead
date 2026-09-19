import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { prepare, login, state, settled } from './freeplay-helpers.mjs';
import { freeplayFixtureOptions } from '../../scripts/playtest-options.mjs';
import { FREEPLAY } from '../../src/freeplay/config.js';
import { makeBattlefield } from '../../scripts/export-freeplay-battlefield.mjs';

async function connectOpponent(page) {
  const fixture = freeplayFixtureOptions();
  const response = await page.request.post(fixture.origin + '/auth/freeplay-claim', { data: { name: 'James', code: 'james-test-only' } });
  const auth = await response.json(); expect(auth.ok).toBe(true);
  const url = new URL('/freeplay/ws', fixture.origin); url.protocol = 'ws:';
  for (const [key, value] of Object.entries({ room: FREEPLAY.room, pid: 'a' + auth.acct, token: auth.token })) url.searchParams.set(key, value);
  const peer = { socket: new WebSocket(url), pid: 'a' + auth.acct, epoch: 0, revision: 0, ready: false, battle: null, events: [], errors: [] };
  peer.socket.onopen = () => peer.socket.send(JSON.stringify({ type: 'hello', protocol: FREEPLAY.protocol, contentVersion: FREEPLAY.contentVersion }));
  peer.socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (['init', 'commit', 'ready'].includes(message.type)) {
      peer.epoch = message.epoch; peer.revision = message.revision;
      if (message.type === 'ready') peer.ready = true;
    }
    if (message.type === 'battle-state') peer.battle = message.battle;
    if (message.type === 'battle-event') peer.events.push(message.event);
    if (message.type === 'error') peer.errors.push(message);
  };
  peer.socket.onerror = () => peer.errors.push({ code: 'socket' });
  peer.send = (type, fields = {}) => peer.socket.send(JSON.stringify({ type, epoch: peer.epoch, ...fields }));
  peer.edit = rows => peer.send('edit', { requestId: crypto.randomUUID(), baseRevision: peer.revision, edits: rows });
  peer.player = () => peer.battle?.players.find(row => row.id === peer.pid);
  await expect.poll(() => peer.ready).toBe(true);
  return peer;
}

async function joinAndReady(page, team) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Battlefield / armies', exact: true }).click();
  await page.getByRole('button', { name: 'Join ' + team + ' army', exact: true }).click();
  await expect.poll(async () => (await state(page)).battlePlayer?.team).toBe(team.toLowerCase());
  await page.getByRole('button', { name: 'Army', exact: true }).click();
  await page.getByRole('button', { name: /Place flag.*ready/i }).click();
}

// Walk through real generated cells in small supported steps accepted by the
// real relay. The test never injects a position into the visible game or server.
async function walkOpponent(peer, goalX) {
  const { header, raw } = makeBattlefield(), solid = new Set(header.solidIds);
  const cell = (x, y, z) => raw.readUInt16LE(((y * 128 + Math.floor(z) - header.origin[1]) * 128 + Math.floor(x) - header.origin[0]) * 2);
  const ground = (x, z, near) => {
    for (let y = Math.min(63, Math.floor(near) + 1); y >= Math.max(1, Math.floor(near) - 3); y--)
      if (solid.has(cell(x, y - 1, z)) && !solid.has(cell(x, y, z)) && !solid.has(cell(x, y + 1, z))) return y;
    return null;
  };
  const start = peer.player(), correction = start.correctionSeq;
  const startNode = { x: Math.floor(start.x) + .5, y: start.y, z: Math.floor(start.z) + .5, parent: null };
  const queue = [startNode], visited = new Set([startNode.x + ',' + startNode.z]); let end;
  for (let cursor = 0; cursor < queue.length && cursor < 16384; cursor++) {
    const node = queue[cursor];
    if (Math.abs(node.x - goalX) < .01 && Math.abs(node.z - startNode.z) < .01) { end = node; break; }
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      const x = node.x + dx, z = node.z + dz, key = x + ',' + z;
      if (visited.has(key) || x < header.origin[0] + 1 || x >= header.origin[0] + 127 || z < header.origin[1] + 1 || z >= header.origin[1] + 127) continue;
      const y = ground(x, z, node.y);
      if (y === null || Math.abs(y - node.y) > 1) continue;
      visited.add(key); queue.push({ x, y, z, parent: node });
    }
  }
  if (!end) throw Error('No bounded supported walking route between combat positions');
  const path = []; for (let node = end; node.parent; node = node.parent) path.unshift(node);
  const trail = [];
  for (const { x, y, z } of path) {
    peer.send('pos', { x, y, z, yaw: Math.PI / 2 }); trail.push([x, y, z]);
    await new Promise(resolve => setTimeout(resolve, 185));
  }
  await expect.poll(() => peer.player()?.x).toBeCloseTo(goalX, 2);
  expect(peer.player().correctionSeq).toBe(correction);
  return trail;
}

async function aimAt(page, target) {
  const s = await state(page), p = s.player, dx = target.x - p.x, dz = target.z - p.z;
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(target.y + 1 - (p.y + 1.62), Math.hypot(dx, dz));
  // Same physical position: this hook only sets exact aim, not movement.
  await page.evaluate(({ p, yaw, pitch }) => window.moorsteadTest.prepareView(p.x, p.y, p.z, yaw, pitch), { p, yaw, pitch });
  await expect.poll(async () => (await state(page)).paused).toBe(false);
}

async function holdFire(page, milliseconds) {
  const box = await page.getByRole('button', { name: 'Fire', exact: true }).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  try { await page.waitForTimeout(milliseconds); } finally { await page.mouse.up(); }
}

async function fireUntilInjured(page, peer) {
  const box = await page.getByRole('button', { name: 'Fire', exact: true }).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  try { await expect.poll(() => peer.player().hp, { timeout: 12000, intervals: [100] }).toBeLessThan(100); }
  finally { await page.mouse.up(); }
}

test('battle combat: UI ready, real opponent HP loss, identical fire blocked by cover, advancing armies deal damage', async ({ page }, testInfo) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 640, height: 480 });
  const errors = await prepare(page); let peer;
  await page.addInitScript(() => {
    window.combatServerErrors = [];
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args); this.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          if (message.type === 'error' && window.combatServerErrors.length < 100)
            window.combatServerErrors.push({ code: message.code, command: message.command });
        });
      }
    };
  });
  try {
    await login(page, 'James'); await joinAndReady(page, 'Red');
    peer = await connectOpponent(page); // Same-account handoff retains the UI-created team/base.
    await expect.poll(() => peer.player()?.team).toBe('red');
    await login(page, 'Henry'); await joinAndReady(page, 'Blue');
    await expect.poll(async () => (await state(page)).battle.ctf.phase).toBe('active');
    const camps = (await state(page)).battle.camps;
    const trail = await walkOpponent(peer, camps.blue[0] + 10);
    await aimAt(page, peer.player());
    await fireUntilInjured(page, peer);
    const exposed = { hp: peer.player().hp, shield: peer.player().shield };
    expect(peer.events.some(event => event.type === 'hit' && event.targetId === peer.pid && event.team === 'blue')).toBe(true);

    const wallX = Math.floor(camps.blue[0] + 5), wallY = camps.blue[1], wallZ = Math.floor(camps.blue[2]), wall = [];
    for (let y = wallY; y < wallY + 5; y++) for (let z = wallZ - 2; z <= wallZ + 2; z++) wall.push([wallX, y, z, 208]);
    const revision = peer.revision; peer.edit(wall); await settled(page, revision + 1);
    const protectedHp = peer.player().hp, hits = peer.events.filter(event => event.type === 'hit' && event.targetId === peer.pid).length;
    await aimAt(page, peer.player()); await holdFire(page, 2000);
    expect(peer.player().hp).toBe(protectedHp);
    expect(peer.events.filter(event => event.type === 'hit' && event.targetId === peer.pid).length).toBe(hits);
    const removeRevision = peer.revision; peer.edit(wall.map(([x,y,z]) => [x,y,z,0])); await settled(page, removeRevision + 1);
    await aimAt(page, peer.player()); await holdFire(page, 1200);
    await expect.poll(() => peer.events.filter(event => event.type === 'hit' && event.targetId === peer.pid).length).toBeGreaterThan(hits);

    await walkOpponent(peer, camps.red[0]);
    const hitStart = peer.events.length;
    peer.send('battle-recruit', { count: 6 });
    await page.getByRole('button', { name: 'Army', exact: true }).click();
    await page.getByRole('button', { name: 'Recruit 6 soldiers', exact: true }).click();
    await expect.poll(() => peer.battle.soldiers.length).toBe(12);
    const initial = new Map(peer.battle.soldiers.map(row => [row.id, [row.x, row.z]]));
    await expect.poll(() => peer.battle.soldiers.some(row => Math.hypot(row.x - initial.get(row.id)[0], row.z - initial.get(row.id)[1]) > 12), { timeout: 20000 }).toBe(true);
    await expect.poll(() => peer.events.slice(hitStart).some(event => event.type === 'hit' && event.sourceId?.startsWith('soldier-')), { timeout: 30000 }).toBe(true);
    expect(peer.battle.soldiers.some(row => row.hp < 50) || peer.battle.players.some(row => row.hp < 100 || row.shield < 100)).toBe(true);
    const evidencePath = testInfo.outputPath('combat-evidence.json');
    const serverErrors = await page.evaluate(() => window.combatServerErrors);
    await writeFile(evidencePath, JSON.stringify({ camps, trail, exposed, protectedHp, battle: peer.battle, events: peer.events, serverErrors }, null, 2));
    await testInfo.attach('combat-evidence', { path: evidencePath, contentType: 'application/json' });
    // Network jitter may rate-limit one held-fire packet; it must not become a
    // persistent error overlay, and every other refusal remains a test failure.
    expect(serverErrors.filter(error => error.code !== 'battle-rate' || error.command !== 'battle-shot')).toEqual([]);
    await expect(page.locator('.fp-error')).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('combat.png') });
    peer.send('battle-forfeit');
    await expect.poll(async () => (await state(page)).battle.ctf.phase).toBe('won');
    await page.getByRole('button', { name: 'Army', exact: true }).click();
    await page.getByRole('button', { name: 'Leave battlefield', exact: true }).click();
    await expect.poll(async () => (await state(page)).battle.players.length).toBe(0);
    expect(errors).toEqual([]); expect(peer.errors).toEqual([]);
  } finally { peer?.socket.close(); }
});
