import assert from 'node:assert/strict';
import { PLAY_GUIDE } from '../src/freeplay/help-content.js';
import { BOMBS } from '../src/freeplay/catalogue.js';
import { WEAPONS } from '../src/freeplay/weapons.js';

assert.equal(new Set(PLAY_GUIDE.map(row => row.id)).size, PLAY_GUIDE.length);
for (const row of PLAY_GUIDE) {
  assert.match(row.id, /^[a-z]+$/);
  for (const key of ['title', 'summary', 'tip']) assert(row[key]?.trim(), `${row.id}: missing ${key}`);
  for (const key of ['steps', 'facts']) assert(row[key]?.length >= 3 && row[key].every(text => typeof text === 'string' && text.trim()));
}
const text = id => JSON.stringify(PLAY_GUIDE.find(row => row.id === id));
// Regression: the old guide falsely required flag carrying and only offered six recruits.
assert.match(text('squads'), /Recruit 10 soldiers/);
assert.match(text('squads'), /25 seconds/);
assert.match(text('capture'), /living, grounded player or soldier/);
assert.match(text('capture'), /ground below/);
assert.match(text('capture'), /no flag pickup or return trip/);
assert.match(text('reset'), /One player pressing twice does not count/);
assert.match(text('reset'), /30 seconds/);
assert.match(text('vehicles'), /decorative gun/);
assert.match(text('equipment'), /does not return with soldier waves/);
for (const row of [...BOMBS, ...WEAPONS]) assert(text('combat').includes(row.description), `Missing catalogue item ${row.id}`);
console.log('Free-play guide: PASS (complete topics, current capture/recruitment/reset rules and live catalogue descriptions).');
