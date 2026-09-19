import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function assertReleaseSource(source, label = 'release asset') {
  for (const marker of ['moorsteadTest', '_playtestSkipRender', 'Playtest commands are development-only', 'No unprotected shop fixture patch']) {
    assert(!source.includes(marker), `${label} contains a development playtest capability: ${marker}`);
  }
}

export function checkRelease(directory) {
  let checked = 0;
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(js|html|map)$/.test(entry.name)) {
        assertReleaseSource(readFileSync(file, 'utf8'), file); checked++;
      }
    }
  }
  visit(directory);
  assert(checked > 0, 'Production output must exist before checking its isolation');
  console.log(`PASS production isolation: ${checked} assets contain no playtest bridge`);
}
