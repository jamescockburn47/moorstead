// Freeze the deterministic timetable into brain-sync/ so the EVO brain books NPCs
// onto the SAME train calls every client renders. Rerun after any rail-layout or
// railtime.js change; verify-timetable-parity fails if the committed copy is stale.
// Station names are derived EXACTLY as brain/world.py derives world.LINES, so the
// export and the brain agree on each line's station order by construction.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { MoorsGeography } from '../src/moorsgeo.js';
import { DWELL_T, legTime, nextDeparture } from '../src/railtime.js';

const data = JSON.parse(readFileSync(new URL('../data/moors-data.json', import.meta.url), 'utf8'));
const STATION_SET = new Set(data.stations.map(s => s.name));
// name -> ordered real-station list, mirroring world.py's LINES construction
const stationsByLine = {};
for (const dl of data.lines || []) {
  const stops = (dl.stations || []).filter(n => STATION_SET.has(n));
  if (stops.length >= 2) stationsByLine[dl.name] = stops;   // world.py drops < 2
}

const geo = new MoorsGeography();
const lines = [];
for (const l of geo.railPaths()) {
  const stations = stationsByLine[l.name];
  const S = l.path.stationS;
  if (!stations) continue;                                  // line world.py wouldn't carry — skip in lockstep
  if (!S || S.length !== stations.length) {
    throw new Error(`line ${l.name}: ${stations.length} station names vs ${S && S.length} chainages — alignment broken`);
  }
  const legT = [];
  for (let i = 0; i < S.length - 1; i++) {
    const len = S[i + 1] - S[i];
    if (!(len > 0)) throw new Error(`line ${l.name}: stationS not strictly increasing at ${i} (${S[i]}->${S[i + 1]}) — station order scrambled`);
    legT.push(legTime(len));
  }
  if (legT.some(t => !Number.isFinite(t) || t <= 0)) throw new Error(`line ${l.name}: non-finite/zero leg time — bad chainage`);
  lines.push({ name: l.name, stations, legT, dwell: DWELL_T });
}
if (!lines.length) throw new Error('no lines exported — moors-data.json / railPaths() mismatch');

mkdirSync(new URL('../brain-sync/', import.meta.url), { recursive: true });
writeFileSync(new URL('../brain-sync/timetable.json', import.meta.url),
  JSON.stringify({ epoch: 'unix', lines }, null, 1));

// Fixture: sample departures the Python port must reproduce EXACTLY (same doubles).
const T0 = 1751500800;                       // fixed anchor: 2026-07-03 00:00:00 UTC
const samples = [];
for (const L of lines) {
  const n = L.stations.length;
  for (let i = 0; i < 12; i++) {
    const from = i % n, to = (from + 1 + (i % (n - 1))) % n;
    if (from === to) continue;
    const tMin = T0 + i * 977;
    const { dep, arr, dir } = nextDeparture(L.legT, n, from, to, tMin);
    samples.push({ line: L.name, from, to, tMin, dep, arr, dir });
  }
}
writeFileSync(new URL('../brain-sync/timetable-fixture.json', import.meta.url),
  JSON.stringify(samples, null, 1));
console.log(`exported ${lines.length} lines, ${samples.length} fixture samples`);
