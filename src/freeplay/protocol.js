import { FREEPLAY } from './config.js';

export function integer(n, min, max) { return Number.isSafeInteger(n) && n >= min && n <= max; }
export function versioned(m) { return integer(m.epoch, 0, 2 ** 40) && integer(m.revision, 0, 2 ** 40); }
export function validCells(rows, allowNull = false) {
  return Array.isArray(rows) && rows.length <= FREEPLAY.packetCells && rows.every(row =>
    Array.isArray(row) && row.length === 4 && integer(row[0], -200000, 200000)
    && integer(row[1], 1, 63) && integer(row[2], -200000, 200000)
    && (integer(row[3], 0, 255) || (allowNull && row[3] === null)));
}
export function validHistory(rows) {
  return Array.isArray(rows) && rows.length <= 20 && rows.every(row => row && typeof row.kind === 'string'
    && row.kind.length <= 24 && typeof row.actor === 'string' && row.actor.length <= 80);
}
export function validPosition(m) {
  return m && typeof m.pid === 'string' && m.pid.length <= 80 && typeof m.name === 'string' && m.name.length <= 24
    && [m.x, m.y, m.z, m.yaw].every(Number.isFinite) && Math.abs(m.x) <= 200000
    && Math.abs(m.z) <= 200000 && m.y >= -10 && m.y <= 256 && Math.abs(m.yaw) <= 1000;
}
