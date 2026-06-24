// storm.js — the boss-battle storm (Dracula, Slice 2 Task 2.3).
//
// While the Count's fight is live (entities.draculaActive(), or the hunt is up
// and the player is near the East Cliff arena), this drives a storm: heavy rain
// (or snow in winter), lightning flashes that spike the sky lighting + a white
// screen blip, and a thunder clap a beat after each flash. It is SCOPED to the
// fight — it overrides nowt permanently and restores the prior sky state when the
// Count falls or the player leaves.
//
// The pure choices (rain-vs-snow, the next flash interval, the thunder delay) are
// split out as deterministic helpers so they're unit-tested headlessly; the rest
// is the in-game controller (smoke-tested live).

// Season -> the storm's precipitation. Winter brings snow, else rain. The winter
// check mirrors snow.js (winterPrecip/overcastGrey): season.warmth < 0 is the
// canonical "wintry" test the precipitation renderer itself splits snow/rain by,
// so the storm and the renderer always agree.
export function stormPrecip(season) {
  return (season && season.warmth < 0) ? 'snow' : 'rain';
}

// Seconds until the next lightning flash, varied by a running flash index so the
// rhythm wanders (a near, then a far, then a close pair…). ~4–12 s. `rnd` is
// injected for tests; defaults to Math.random (fine in the client runtime).
export function nextFlashInterval(i, rnd = Math.random) {
  const base = 4 + (i % 3) * 1.6;        // 4.0 / 5.6 / 7.2, cycling by index
  return base + rnd() * (12 - base);     // up to ~12 s, never below `base`
}

// Seconds between a flash and its thunder, varied by index: some strikes are near
// (a prompt crack), some far (a late rumble). ~0.2–2.5 s. A close strike (every
// 4th, by index) cracks promptly; the rest rumble later.
export function thunderDelay(i, rnd = Math.random) {
  const near = (i % 4) === 0;
  return near ? 0.2 + rnd() * 0.4        // near: 0.2–0.6 s
              : 0.8 + rnd() * 1.7;       // far:  0.8–2.5 s
}

export class Storm {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.cached = null;        // { stormPrecip, stormIsSnow } captured off the sky on start
    this.flashIndex = 0;
    this.flashTimer = nextFlashInterval(0);
    this.pendingThunder = [];  // [{ t, vol }] thunder claps owed, counting down
  }

  // Is the Count's fight live? True when he's risen (draculaActive), OR the hunt
  // is up and the player stands near the arena (so the sky turns as he's about to
  // rise). Guarded against a half-built world / pre-spawn entities.
  fightLive() {
    const g = this.game;
    const ent = g && g.entities;
    if (!ent) return false;
    if (ent.draculaActive && ent.draculaActive()) return true;
    // anticipation: the hunt accepted, not yet done, and we're at the arena
    const q = g.quests;
    if (q && q.draculaHuntActive && q.draculaHuntActive() && !(q.draculaDone && q.draculaDone())) {
      const geo = g.world && g.world.gen && g.world.gen.geo;
      const arena = geo && geo.draculaArena && geo.draculaArena();
      const p = g.player && g.player.pos;
      if (arena && p && Number.isFinite(arena.x)) {
        const d = Math.hypot(p.x - arena.x, p.z - arena.z);
        if (d < (arena.r || 16) + 24) return true;   // a touch beyond the trigger radius
      }
    }
    return false;
  }

  // Drive the storm one frame. Cheap, and a no-op (bar a one-time restore) when
  // the fight isn't live. Everything is guarded so a mid-init sky/audio/ui is safe.
  update(dt) {
    const g = this.game;
    const sky = g && g.sky;
    if (!sky) return;
    const live = this.fightLive();

    if (live && !this.active) this._begin(sky);
    else if (!live && this.active) this._end(sky);
    if (!this.active) return;

    // keep the precip override asserted on the sky each frame (in case a save/load
    // or weather tick reset it) and follow the season (rain may turn to snow)
    sky.stormPrecip = 1;
    sky.stormIsSnow = stormPrecip(g.season) === 'snow';

    // lightning: count down to the next flash, fire it, schedule its thunder
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) {
      this._strike(sky);
      this.flashIndex++;
      this.flashTimer = nextFlashInterval(this.flashIndex);
    }

    // thunder owed from earlier flashes
    if (this.pendingThunder.length) {
      const audio = g.audio;
      for (const c of this.pendingThunder) {
        c.t -= dt;
        if (c.t <= 0 && !c.fired) {
          c.fired = true;
          if (audio && audio.thunder) audio.thunder(c.vol);
        }
      }
      this.pendingThunder = this.pendingThunder.filter(c => !c.fired);
    }
  }

  _begin(sky) {
    this.active = true;
    // cache whatever the sky's storm-override fields were (normally undefined) so
    // we put them back exactly — we never touch the live-weather model itself.
    this.cached = { stormPrecip: sky.stormPrecip, stormIsSnow: sky.stormIsSnow };
    this.flashIndex = 0;
    this.flashTimer = 1.0 + Math.random() * 1.5; // first strike soon after he rises
    this.pendingThunder = [];
  }

  _end(sky) {
    this.active = false;
    // restore the prior sky precip state (clear our override)
    if (this.cached) {
      sky.stormPrecip = this.cached.stormPrecip;
      sky.stormIsSnow = this.cached.stormIsSnow;
    } else {
      sky.stormPrecip = undefined; sky.stormIsSnow = undefined;
    }
    this.cached = null;
    sky.flash = 0;
    if (this.game && this.game.ui && this.game.ui.setStormFlash) this.game.ui.setStormFlash(0);
    this.pendingThunder = [];
  }

  // one lightning strike: spike the sky's flash term + a white screen blip, and
  // queue a thunder clap a beat later (near strikes crack, far ones rumble late).
  _strike(sky) {
    const g = this.game;
    sky.flash = 1;                                   // sky.update decays this over ~200 ms
    if (g.ui && g.ui.setStormFlash) g.ui.setStormFlash(0.85);
    const delay = thunderDelay(this.flashIndex);
    // nearer strikes (short delay) are louder; distant ones softer
    const vol = delay < 0.7 ? 0.5 : 0.22 + Math.random() * 0.12;
    this.pendingThunder.push({ t: delay, vol, fired: false });
  }
}
