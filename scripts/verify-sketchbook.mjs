// T' Rambler's Sketchbook (P) + T' Roll of Honour — node scripts/verify-sketchbook.mjs
// Headless checks on the pure helpers exported from src/ui.js: the caption/filename
// formatting (place fallback, day flooring), the frame compositor's geometry maths
// (mount/rule nesting — the bit a broken border would show up in), and the honours-row
// builder the parish notice board renders (star flourish, worn marker, empty state).
import {
  sketchCaption, sketchFilename, sketchFrameGeom,
  buildHonoursRows, HONOURS_EMPTY,
} from '../src/ui.js';

let failed = false;
const ok = m => console.log('  ok    ' + m);
const bad = m => { failed = true; console.log('  FAIL  ' + m); };
const is = (c, m) => (c ? ok : bad)(m);

// ---- caption: "<place> · Day <n> · MOORSTEAD" ----
is(sketchCaption('Whitby', 12) === 'Whitby · Day 12 · MOORSTEAD',
  'caption reads "<place> · Day <n> · MOORSTEAD"');
is(sketchCaption('', 3) === 'T’ High Moor · Day 3 · MOORSTEAD',
  'an empty place falls back to T’ High Moor');
is(sketchCaption(null, 3).startsWith('T’ High Moor'), 'a null place falls back an’ all');
is(sketchCaption('   ', 3).startsWith('T’ High Moor'), 'whitespace-only place falls back');
is(sketchCaption('  Goathland  ', 1).startsWith('Goathland'), 'place is trimmed');
is(sketchCaption('Whitby', 0) === 'Whitby · Day 1 · MOORSTEAD', 'day floors at 1 (0 -> Day 1)');
is(sketchCaption('Whitby', -4).includes('Day 1'), 'negative days floor at 1');
is(sketchCaption('Whitby', 'nowt').includes('Day 1'), 'a garbage day reads Day 1, not NaN');
is(sketchCaption('Whitby', 7.6).includes('Day 8'), 'fractional days round');

// ---- filename: moorstead-<place-slug>-day<n>.png ----
is(sketchFilename('Whitby', 12) === 'moorstead-whitby-day12.png',
  'filename is moorstead-<place>-day<n>.png');
is(sketchFilename('T’ Hole of Horcum', 2) === 'moorstead-t-hole-of-horcum-day2.png',
  'curly apostrophes drop clean; spaces slug to dashes');
is(sketchFilename('Robin Hood’s Bay', 4) === 'moorstead-robin-hoods-bay-day4.png',
  'possessives slug cleanly (hoods, not hood-s)');
is(sketchFilename(null, 5) === 'moorstead-t-high-moor-day5.png',
  'the fallback place slugs to t-high-moor');
is(!/[^a-z0-9.-]/.test(sketchFilename('T’ North Sea', 9)), 'the slug is ascii-safe');
is(sketchFilename('★★★', 1) === 'moorstead-moor-day1.png',
  'a place that slugs to nowt falls back to "moor"');

// ---- frame geometry: the compositor's pure maths (border insets / nesting) ----
const inside = (a, b) =>
  a.x > b.x && a.y > b.y && a.x + a.w < b.x + b.w && a.y + a.h < b.y + b.h;
for (const [w, h] of [[1280, 720], [1920, 1080], [64, 48]]) {
  const g = sketchFrameGeom(w, h);
  const t = `${w}x${h}`;
  is(g.W === w + g.border * 2 && g.H === h + g.border * 2 + g.capH,
    `${t}: mount adds a border all round + a caption strip below`);
  is(g.photo.x === g.border && g.photo.y === g.border && g.photo.w === w && g.photo.h === h,
    `${t}: the plate sits square in t' mount, unscaled`);
  is(inside(g.photo, g.ruleInner) && inside(g.ruleInner, g.ruleOuter),
    `${t}: plate inside inner rule inside outer rule (the double rule nests)`);
  is(g.ruleOuter.x > 0 && g.ruleOuter.y > 0 &&
     g.ruleOuter.x + g.ruleOuter.w < g.W && g.ruleOuter.y + g.ruleOuter.h < g.H,
    `${t}: the double rule floats within t' mount, never off t' edge`);
  is(g.caption.y > g.photo.y + g.photo.h && g.caption.y < g.H,
    `${t}: the caption baseline sits in t' strip below t' plate`);
  is(g.caption.x === Math.round(g.W / 2) && g.fontPx > 0,
    `${t}: caption centred an' font sized`);
}

// ---- honours rows from a stubbed quests object ----
const stub = (titles, worn, standing = 'Respected') => ({
  earnedTitleList: () => titles.slice(),
  wornTitle: worn,
  standingLabel: () => standing,
});
{
  const h = buildHonoursRows(stub([], null));
  is(h.rows.length === 0 && h.empty === HONOURS_EMPTY,
    'no titles -> an empty roll wi’ t’ waiting line');
  is(HONOURS_EMPTY.includes('No honours yet') && HONOURS_EMPTY.includes('moor’s waiting'),
    'empty state reads "No honours yet — t’ moor’s waiting"');
}
{
  const h = buildHonoursRows(stub(
    ['Friend o’ t’ Hob', 'Wolf o’ t’ Esk'], 'Friend o’ t’ Hob'));
  is(h.empty === null && h.rows.length === 3,
    'two titles -> two honour rows + the "— none —" row');
  is(h.rows[0].label === '★ Friend o’ t’ Hob',
    'each honour carries t’ star flourish (★ Friend o’ t’ Hob)');
  is(h.rows[0].worn === true && h.rows[1].worn === false,
    'the worn marker sits on the worn title only');
  is(h.rows[2].value === null && h.rows[2].worn === false,
    'the "none" row un-wears (value null, not marked while a title is worn)');
  is(h.standing === 'Respected', 'the standing tier rides along for t’ roll header');
}
{
  const h = buildHonoursRows(stub(['Friend o’ t’ Hob'], null));
  is(h.rows[0].worn === false && h.rows[1].worn === true,
    'wearing nowt -> the "none" row is the worn one');
}
{
  // a quests-shaped duck wi' only the raw field (no earnedTitleList) still builds,
  // and falsy titles are filtered rather than rendered as blank rows
  const h = buildHonoursRows({ earnedTitles: ['X', null, ''], wornTitle: 'X', standingLabel: () => 'Known' });
  is(h.rows.length === 2 && h.rows[0].worn === true && h.standing === 'Known',
    'raw earnedTitles field works; falsy titles are dropped');
}

console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
