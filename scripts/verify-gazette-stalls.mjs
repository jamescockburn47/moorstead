// Headless: T' Moorstead Gazette panel builder + T' Tradin' Post (market stalls v1)
// offer maths, in the house verify-*.mjs idiom (a counter; a single OK line).
//
//  - buildGazetteHTML: a stubbed brain payload renders masthead/issue/headline/
//    stories/NOTICES; empty and null payloads degrade kindly; EVERY brain-borne
//    string is escaped (`<img` and `<script` never survive).
//  - offer shape validation: items-only [[id,n]] stacks, 1..3 a side, whole
//    counts 1..999 — mirrors the server-side caps in worldsvc/server.py.
//  - escrow/return/complete inventory maths as pure functions: posting escrows
//    the give-goods exactly, withdrawing restores them exactly, a completed swap
//    nets the right delta BOTH sides (goods are conserved across the pair).
//  - stallRowHTML: relay-borne names are escaped (the known-XSS row-builder gate).
//
// With --live it ALSO runs a stallpost/stalllist/stallwithdraw/stallaccept
// two-bot round-trip against the LIVE relay in the token-free verify-harness
// room (the verify-live.mjs bot idiom), cleaning up every offer it pins:
//    node scripts/verify-gazette-stalls.mjs --live
import assert from 'node:assert';
import {
  buildGazetteHTML, offerStacksOk, offerShapeOk, countsFromSlots, hasStacks,
  applyStacks, describeStacks, stallRowHTML,
  STALL_MAX_STACKS, STALL_MAX_QTY, STALL_MAX_MINE, STALL_MAX_ROOM,
} from '../src/ui.js';
import { itemName } from '../src/defs.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- 1. the Gazette sheet builder --------------------------------------------
{
  const gz = {
    issue: 12, date: 'Thursday, the 2nd of July, 1900',
    headline: 'A QUIET WEEK ON THE MOORS',
    stories: [
      { title: 'WOOL AT MARKET', body: 'Fleece fetched a fair price in Pickering.' },
      { title: 'THE 10.15 RAN LATE', body: 'A ewe on the line at Goathland.' },
      { title: 'JET FINDS AT WHITBY', body: 'Two fine seams worked below the cliff.' },
    ],
    notices: ['LOST: one sturdy ewe.', 'NOTICE: tea at the Parish Hall.'],
    generatedAt: 0,
  };
  const html = buildGazetteHTML(gz);
  ok(html.includes('THE MOORSTEAD GAZETTE'), 'masthead is set');
  ok(html.includes('No. 12') && html.includes('2nd of July, 1900'), 'issue number an’ date line render');
  ok(html.includes('A QUIET WEEK ON THE MOORS'), 'headline renders');
  for (const s of gz.stories) ok(html.includes(s.title) && html.includes(s.body), `story "${s.title}" renders title + body`);
  ok(html.includes('NOTICES'), 'the NOTICES column head renders');
  for (const nt of gz.notices) ok(html.includes(nt), `notice "${nt.slice(0, 20)}…" renders`);

  // empty payloads degrade kindly, never throw
  const empty = buildGazetteHTML({ issue: 1, date: 'x', stories: [], notices: [] });
  ok(empty.includes('THE MOORSTEAD GAZETTE') && empty.includes('keeps its own counsel'), 'no stories -> the kind empty line');
  ok(empty.includes('No notices posted'), 'no notices -> the kind empty line');
  ok(typeof buildGazetteHTML(null) === 'string' && buildGazetteHTML(null).includes('GAZETTE'), 'a null payload still builds a sheet');
  ok(typeof buildGazetteHTML({}) === 'string', 'an empty object payload still builds a sheet');

  // hostile prose: EVERY field is escaped — `<img`/`<script` never survive
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const hostile = buildGazetteHTML({
    issue: evil, date: evil, headline: evil,
    stories: [{ title: evil, body: evil }], notices: [evil],
  });
  ok(!hostile.includes('<img') && !hostile.includes('<script'), 'hostile payload: no <img or <script survives anywhere');
  ok(hostile.includes('&lt;img'), 'hostile payload is escaped, not dropped');
}

// ---- 2. offer shape validation (mirrors server.py's caps) ---------------------
{
  ok(STALL_MAX_STACKS === 3 && STALL_MAX_QTY === 999 && STALL_MAX_MINE === 2 && STALL_MAX_ROOM === 12,
    'client caps mirror the relay (3 stacks / 999 qty / 2 per pid / 12 per room)');
  ok(offerStacksOk([[5, 12]]), 'a single sane stack passes');
  ok(offerStacksOk([[5, 12], [7, 1], [9, 999]]), 'three stacks (the max) pass');
  ok(!offerStacksOk([]), 'an empty side fails');
  ok(!offerStacksOk([[5, 1], [6, 1], [7, 1], [8, 1]]), 'four stacks fail (cap is 3)');
  ok(!offerStacksOk([[5, 0]]), 'a zero count fails');
  ok(!offerStacksOk([[5, -3]]), 'a negative count fails');
  ok(!offerStacksOk([[5, 1000]]), 'a count over 999 fails');
  ok(!offerStacksOk([[5.5, 1]]), 'a fractional id fails');
  ok(!offerStacksOk([[5, 1.5]]), 'a fractional count fails');
  ok(!offerStacksOk([[-1, 1]]), 'a negative id fails');
  ok(!offerStacksOk([[5000, 1]]), 'an absurd id fails');
  ok(!offerStacksOk([[5]]), 'a short pair fails');
  ok(!offerStacksOk('nowt'), 'a non-list fails');
  ok(offerShapeOk({ give: [[5, 2]], want: [[7, 3]] }), 'a whole offer with both sides sane passes');
  ok(!offerShapeOk({ give: [[5, 2]] }), 'an offer missing a side fails');
  ok(!offerShapeOk(null), 'a null offer fails');
}

// ---- 3. escrow / return / complete inventory maths ----------------------------
{
  // counts from slots: nulls skipped, duplicate stacks summed
  const slots = [{ id: 5, n: 30 }, null, { id: 7, n: 4 }, { id: 5, n: 10 }, { id: 9, n: 0 }];
  const counts = countsFromSlots(slots);
  ok(counts[5] === 40 && counts[7] === 4 && !(9 in counts), 'countsFromSlots sums duplicates an’ skips empties');

  // hasStacks sums duplicated ids in the demand
  ok(hasStacks(counts, [[5, 3], [5, 4]]), 'hasStacks sums duplicate-id stacks (7 of 40)');
  ok(!hasStacks(counts, [[5, 39], [5, 2]]), 'hasStacks refuses when duplicates overrun the pile (41 of 40)');
  ok(!hasStacks(counts, [[7, 5]]), 'hasStacks refuses a plain shortfall');

  // escrow then return restores EXACTLY (the withdraw invariant)
  const give = [[5, 12], [7, 2]];
  const escrowed = applyStacks(counts, give, -1);
  ok(escrowed && escrowed[5] === 28 && escrowed[7] === 2, 'posting escrows the give-goods out of the pile');
  ok(counts[5] === 40, 'applyStacks never mutates its input (pure)');
  const restored = applyStacks(escrowed, give, +1);
  ok(JSON.stringify(restored) === JSON.stringify(counts), 'withdraw restores the pile EXACTLY as it was');

  // insufficiency -> null, never a negative pocket
  ok(applyStacks(counts, [[7, 5]], -1) === null, 'escrowing more than tha holds -> null (never negative)');
  ok(applyStacks(counts, [[99, 1]], -1) === null, 'escrowing an item tha lacks entirely -> null');
  // a stack that DRAINS an id removes the key (empty slots don’t linger)
  const drained = applyStacks(counts, [[7, 4]], -1);
  ok(drained && !(7 in drained), 'draining an id to nowt removes the key');

  // the completed swap nets the right delta BOTH sides, an’ goods are conserved
  const want = [[9, 5]];
  const poster0 = { 5: 40, 7: 4 };            // poster's pockets before posting
  const taker0 = { 9: 8, 3: 1 };              // taker's pockets before accepting
  const posterPosted = applyStacks(poster0, give, -1);            // escrow out at post
  const takerDone = applyStacks(applyStacks(taker0, want, -1), give, +1);  // pay want, pocket give
  const posterDone = applyStacks(posterPosted, want, +1);         // the gift arrives
  ok(takerDone[5] === 12 && takerDone[7] === 2 && takerDone[9] === 3 && takerDone[3] === 1,
    'taker nets +give −want exactly');
  ok(posterDone[5] === 28 && posterDone[7] === 2 && posterDone[9] === 5,
    'poster nets −give +want exactly');
  const total = (a, b) => { const t = { ...a }; for (const k of Object.keys(b)) t[k] = (t[k] || 0) + b[k]; return t; };
  ok(JSON.stringify(total(posterDone, takerDone)) === JSON.stringify(total(poster0, taker0)),
    'goods are conserved across the pair (nowt minted, nowt lost)');
}

// ---- 4. the offer row builder escapes relay-borne strings ---------------------
{
  const offer = { id: 's1', pid: 'p1', name: "Eb's lad", give: [[5, 12]], want: [[7, 4]] };
  const row = stallRowHTML(offer);
  ok(row.includes(itemName(5)) && row.includes(itemName(7)), 'the row names items via the defs itemName helper');
  ok(row.includes('12×') && row.includes('4×'), 'the row shows the counts');
  ok(row.includes('Eb&#39;s lad'), 'a plain name reads through (apostrophe escaped the escHtml way)');
  ok(describeStacks([[5, 12], [7, 4]]) === `12× ${itemName(5)}, 4× ${itemName(7)}`, 'describeStacks reads "12× X, 4× Y"');

  // hostile relay-borne name: `<img` NEVER survives the row builder
  const evil = { ...offer, name: '<img src=x onerror=alert(1)>' };
  const evilRow = stallRowHTML(evil);
  ok(!evilRow.includes('<img'), 'a hostile name never yields a live <img (escHtml on the row)');
  ok(evilRow.includes('&lt;img'), 'the hostile name is escaped, not dropped');
  ok(!stallRowHTML({}).includes('undefined'), 'a bare offer builds a row without "undefined" leaking');
}

console.log(`verify-gazette-stalls: ${n} assertions OK`);

// ---- 5. (--live only) two-bot stall round-trip against the LIVE relay ---------
// The verify-live.mjs bot idiom, in the token-free verify-harness scratch room.
// Exercises post -> broadcast, the per-pid cap (with the give-stacks echoed back),
// withdraw -> stallreturn, accept -> stalldone (payload to the taker, notice to
// the poster) + the gift payment leg, the offline-poster "away" gate, and leaves
// the room's stall board exactly as found (empty of our offers).
if (process.argv.includes('--live')) {
  const WS_URL = 'wss://moorstead.sovren.xyz/ws';
  const run = Math.random().toString(36).slice(2, 8);

  class Bot {
    constructor(tag, label) {
      this.pid = `verify-stall-${tag}-${run}`;
      this.label = label;
      this.inbox = [];
      this.waiters = [];
      this.ws = null;
    }
    connect(timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const url = `${WS_URL}?room=verify-harness&pid=${this.pid}&name=${encodeURIComponent(this.label)}&epoch=0`;
        this.ws = new WebSocket(url);
        let init = false;
        this.ws.onmessage = (e) => {
          let m; try { m = JSON.parse(e.data); } catch { return; }
          if (m.type === 'init' && !init) { init = true; resolve(m); return; }
          this.inbox.push(m);
          for (const w of this.waiters.splice(0)) w();
        };
        this.ws.onclose = (ev) => { if (!init) reject(new Error(`${this.label}: closed before init (code ${ev.code})`)); };
        this.ws.onerror = () => { /* onclose carries the story */ };
        setTimeout(() => { if (!init) reject(new Error(`${this.label}: no init within ${timeoutMs}ms`)); }, timeoutMs);
      });
    }
    send(obj) { this.ws.send(JSON.stringify(obj)); }
    waitFor(pred, what, timeoutMs = 10000) {
      const scan = () => { const i = this.inbox.findIndex(pred); return i === -1 ? null : this.inbox.splice(i, 1)[0]; };
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${this.label}: did not receive ${what} within ${timeoutMs}ms`)), timeoutMs);
        const attempt = () => { const m = scan(); if (m) { clearTimeout(t); resolve(m); } else this.waiters.push(attempt); };
        attempt();
      });
    }
    close() { try { this.ws?.close(1000); } catch { /* already down */ } }
  }

  const A = new Bot('a', 'Stall Poster A');
  const B = new Bot('b', 'Stall Taker B');
  const give = [[5, 12]], want = [[7, 4]];
  const mineOn = (list, pid) => (list || []).filter(o => o.pid === pid);

  const live = async () => {
    const initA = await A.connect();
    ok(Array.isArray(initA.stalls), 'init carries the stalls list (relay speaks the stall protocol)');
    await B.connect();

    // post -> both hear the stalls broadcast with the new offer
    A.send({ type: 'stallpost', give, want });
    const s1 = await B.waitFor(m => m.type === 'stalls' && mineOn(m.offers, A.pid).length === 1, 'stalls broadcast with A’s offer');
    const offer1 = mineOn(s1.offers, A.pid)[0];
    ok(offer1 && offer1.name === 'Stall Poster A' && JSON.stringify(offer1.give) === JSON.stringify(give),
      `the posted offer carries the relay-stamped name an’ the give-stacks (id ${offer1.id})`);

    // the per-pid cap: a third post is refused WITH the give-stacks echoed back
    A.send({ type: 'stallpost', give, want });
    const s2posts = await A.waitFor(m => m.type === 'stalls' && mineOn(m.offers, A.pid).length === 2, 'second offer pinned');
    const second = mineOn(s2posts.offers, A.pid).find(o => o.id !== offer1.id);
    A.send({ type: 'stallpost', give, want });
    const err = await A.waitFor(m => m.type === 'stallerr' && m.reason === 'cap', 'the cap stallerr');
    ok(JSON.stringify(err.give) === JSON.stringify(give), 'the refused post echoes the give-stacks back (escrow undo)');

    // withdraw the second -> stallreturn with the escrowed offer
    A.send({ type: 'stallwithdraw', id: second.id });
    const ret = await A.waitFor(m => m.type === 'stallreturn', 'the withdraw stallreturn');
    ok(ret.offer && ret.offer.id === second.id && JSON.stringify(ret.offer.give) === JSON.stringify(give),
      'withdraw returns the escrowed give-goods to the poster');

    // B accepts offer1 -> B gets the payload copy, A gets the notice; B pays the gift
    B.send({ type: 'stallaccept', id: offer1.id });
    const done = await B.waitFor(m => m.type === 'stalldone' && m.offerId === offer1.id, 'the taker’s stalldone');
    ok(done.offer && JSON.stringify(done.offer.give) === JSON.stringify(give) && done.takerPid === B.pid,
      'the taker’s stalldone carries the escrowed offer payload');
    const notice = await A.waitFor(m => m.type === 'stalldone' && m.offerId === offer1.id, 'the poster’s stalldone notice');
    ok(notice.posterPid === A.pid && !notice.offer, 'the poster’s copy is a notice (no payload)');
    B.send({ type: 'gift', to: done.offer.pid, goods: done.offer.want });        // the payment leg
    const paid = await A.waitFor(m => m.type === 'gift' && m.from === B.pid, 'the want-goods gift');
    ok(JSON.stringify(paid.goods) === JSON.stringify(want), 'the poster receives the want-goods over the existing gift path');

    // a second accept of the same offer -> "gone" (first accept won)
    B.send({ type: 'stallaccept', id: offer1.id });
    const gone = await B.waitFor(m => m.type === 'stallerr' && m.reason === 'gone', 'the second-accept refusal');
    ok(gone.reason === 'gone', 'a raced second accept is refused (relay-authoritative removal)');

    // the offline-poster gate: A pins one, A leaves, B’s accept says "away"
    B.inbox = B.inbox.filter(m => m.type !== 'stalls');   // drop stale board broadcasts afore watching for the fresh one
    A.send({ type: 'stallpost', give, want });
    const s2 = await B.waitFor(m => m.type === 'stalls' && mineOn(m.offers, A.pid).length === 1, 'the away-test offer');
    const offer2 = mineOn(s2.offers, A.pid)[0];
    A.close();
    await B.waitFor(m => m.type === 'leave' && m.pid === A.pid, 'A’s leave broadcast');
    B.send({ type: 'stallaccept', id: offer2.id });
    const away = await B.waitFor(m => m.type === 'stallerr' && m.reason === 'away', 'the away refusal');
    ok(away.reason === 'away', 'accepting an offline poster’s offer is refused (gifts don’t queue)');

    // clean up: A returns (same pid) an’ pulls the offer back; the board is left empty of ours
    const A2 = new Bot('a', 'Stall Poster A');
    A2.pid = A.pid;
    const initA2 = await A2.connect();
    ok(mineOn(initA2.stalls, A.pid).length === 1, 'the offer survived the poster’s absence (persisted server-side)');
    A2.send({ type: 'stallwithdraw', id: offer2.id });
    await A2.waitFor(m => m.type === 'stallreturn' && m.offer.id === offer2.id, 'the cleanup stallreturn');
    A2.send({ type: 'stalllist' });
    const fin = await A2.waitFor(m => m.type === 'stalls' && mineOn(m.offers, A.pid).length === 0, 'the final (empty-of-ours) stalllist');
    ok(mineOn(fin.offers, A.pid).length === 0 && mineOn(fin.offers, B.pid).length === 0,
      'the room’s stall board is left exactly as found (no offers of ours remain)');
    A2.close();
  };

  let guardT;
  const guard = new Promise((_, rej) => { guardT = setTimeout(() => rej(new Error('stall round-trip: 60s guard tripped')), 60000); });
  try {
    await Promise.race([live(), guard]);
    console.log(`verify-gazette-stalls (--live relay round-trip): ${n} total assertions OK`);
  } finally {
    clearTimeout(guardT);
    A.close(); B.close();
  }
}
