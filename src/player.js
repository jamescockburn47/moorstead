// Player: movement, survival stats, inventory.
import { B, BLOCKS, FOODS, TOOLS, maxStack, isLiquid } from './defs.js';
import { HOT_FOODS } from './temperature.js';
import { STARTING_BRASS } from './economy.js';
import { moveEntity, boxCollides, unstick, SWIM, submersion, swimWish, swimVerticalWish, swimVerticalStep, currentAt } from './physics.js';
import { freezableWater, isFrozen, driftDepth } from './snow.js';
import { validatePlayerLook, DEFAULT_PLAYER_LOOK } from './entities.js';

const GRAVITY = 26;
const JUMP_VEL = 8.6;
const WALK = 4.3, SPRINT = 6.4, SNEAK = 1.6, FLY = 11, FLY_FAST = 22;
const MOUNT_WALK = 8.5; // a pony fair shifts compared to shanks's pony
const SWIM_TIRE = 12;   // seconds treading deep water before tha tires an' starts to go under

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = { x: 0.5, y: 40, z: 0.5 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.hw = 0.3; this.h = 1.8; this.eye = 1.62;
    this.onGround = false;
    this.health = 20; this.hunger = 20; this.temperature = 20;
    this.air = 10;
    this.creative = false;
    this.passGate = true; // a field gate stands open to the farmer, both ways
    this.flying = false;
    this.mounted = false; // up on a moorland pony
    this.dead = false;
    this.deathCause = '';
    this.fallStart = null;
    this.hurtFlash = 0;
    this.hungerTick = 0; this.regenTick = 0; this.exhaustion = 0;
    this.wetness = 0; // soaked through in t' rain; dries under cover or by a fire
    this.slots = new Array(36).fill(null); // {id, n, dur?}
    this.hotbar = 0;
    this.fuelBank = 0;
    this.brass = STARTING_BRASS; // pence in thi purse
    this.shipments = [];     // goods in transit: {goods:[[id,n]], dest, brass, arrivesAt}
    this.vendorPurses = {};  // per-vendor drop-in brass remaining (key: lowercase name)
    this.pursesAt = 0;       // game-time the purses were last refilled
    this.lastJumpPress = 0;
    this.name = ''; // what t' villagers call thee
    this.npcRewards = {}; // charId -> highest friendship tier already rewarded
    this.milestonesDone = []; // bairns'-world first-hour achievements already earned
    this.milestonesSteered = false; // whether t' "go see t' village folk" nudge's fired
    this.bairnFresh = false; // bairns'-world one-time bare-handed reset already done
    this.freeStarter = false; // free-world one-time starter pack already granted
    this.onboarded = false; // first-visit handbook already shown
    this.strongboxHinted = false; // first-strongbox-craft "stash thi goods" nudge already shown
    this.stormLanternHinted = false; // first-storm-lantern-craft "hold it o' nights" nudge already shown
    this.villagerMarkerHinted = false; // ❓ marker hint already shown
    this.home = null; // {x,y,z} of thi planted base flag — where tha respawns if tha falls
    this.stationSellHinted = false; // station sell hint already shown
    this.farmStatus = { registered: false }; // registered-farm status (Slice 2 gate to droving)
    this.knownTimes = {};   // station name -> true, once a local's told her the times
    // necessity-spine ledgers (spec 2026-07-03): all conversation-earned, all game-true
    this.taught = {};                              // skill key -> true (smithing, ironwork)
    this.commissions = [];                         // {id, item, price, giver, readyAtDay, state:'open'|'done'}
    this.vouches = [];                             // {by, day} — who's given their word for thee
    this.promiseLog = { kept: 0, broken: 0 };      // contract record; feeds the facts card
    this.gameRecord = { games: {}, biggestWin: 0 }; // pub-games ledger (D4): gameId -> {w,l,d} lazily, biggest single wager won
    this.look = { ...DEFAULT_PLAYER_LOOK }; // "Dress thissen": chosen appearance (bounded indices) — shown to other players
  }

  eyePos() { return { x: this.pos.x, y: this.pos.y + this.eye, z: this.pos.z }; }

  headBlock() {
    return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + this.eye), Math.floor(this.pos.z));
  }
  feetBlock() {
    return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.3), Math.floor(this.pos.z));
  }

  onFrozenSurface(season) {
    if (!isFrozen(season)) return false;
    const x = Math.floor(this.pos.x), z = Math.floor(this.pos.z), y = Math.floor(this.pos.y - 0.05);
    const b = this.world.getBlock(x, y, z);
    if (b !== B.WATER && b !== B.BOG) return false;
    return freezableWater(b, this.world.gen.geo.coastT(x, z), B);
  }

  heldItem() { return this.slots[this.hotbar]; }

  update(dt, input, audio, season) {
    if (this.dead) return;
    // Hold physics until t' ground under us actually exists — ungenerated
    // chunks read as solid stone and used to wedge t' player fast.
    if (!this.world.isLoaded(this.pos.x, this.pos.z)) return;
    // And if we've somehow ended up inside a block, get free of it.
    unstick(this.world, this);
    const sub = submersion(this.world, this.pos.x, this.pos.y, this.pos.z, this.eye);
    const inWater = sub.feet || sub.head;
    const inBog = this.feetBlock() === B.BOG || this.headBlock() === B.BOG;
    const inLiquid = inWater || inBog;
    const onFrozen = this.onFrozenSurface(season);
    // chest-deep in open watter = SWIMMING (James 2026-07-03): look-direction strokes,
    // tread at t' surface, Space to kick up, Shift to dive. Nobbut feet wet = wading
    // on normal legs; bogs an' a mounted pony fording keep t' owd float.
    const swimming = sub.chest && !inBog && !onFrozen && !this.flying && !this.mounted;
    // t' river current: watter on a river column carries thee downstream, swimming OR
    // wading (client-local movement physics, same class as knockback — deterministic
    // per column via geo.riverFlow). Sea an' tarns have no flow (riverFlow null there);
    // t' stylised world has no riverFlow at all (typeof guard inside currentAt).
    const cur = (inWater && !this.flying && !onFrozen)
      ? currentAt(this.world.gen && this.world.gen.geo, this.pos.x, this.pos.z)
      : null;
    // once t' flow's had thee, tha's "in t' beck" till tha leaves t' watter — slack
    // pockets at t' bank edge are still t' beck (live-observed at Grosmont 2026-07-03:
    // wi'out this, a rider nudged into a flow-null pocket tired an' drowned). Entering
    // still water COLD — t' sea, a tarn — never sets it, so t' tire clock stays real.
    this._beck = cur ? true : (inWater ? !!this._beck : false);
    // ice keeps thee sliding a moment after tha steps off, so even a narrow beck feels slape
    if (onFrozen) this.iceSlip = 0.25; else this.iceSlip = Math.max(0, (this.iceSlip || 0) - dt);
    const slippery = onFrozen || this.iceSlip > 0;
    // treading deep water tires thee — tha can't keep thi head up forever, so the open
    // sea is a real danger to swim (make for shore, the shallows, or a coble). But a
    // FLOWING beck bears thee up (James 2026-07-03): riding t' Esk down to Whitby is
    // meant to be a lark, not a drowning — still water (sea, tarns) is where tha tires.
    const treading = swimming && !this.onGround;
    if (treading && !this._beck) this.swimTime = (this.swimTime || 0) + dt;
    else this.swimTime = Math.max(0, (this.swimTime || 0) - dt * 1.5);
    const tiring = this.swimTime > SWIM_TIRE;

    // ----- movement intent -----
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let fwd = 0, strafe = 0;
    if (input.keys['KeyW']) fwd += 1;
    if (input.keys['KeyS']) fwd -= 1;
    if (input.keys['KeyA']) strafe -= 1;
    if (input.keys['KeyD']) strafe += 1;
    const mag = Math.hypot(fwd, strafe) || 1;
    fwd /= mag; strafe /= mag;

    const sneaking = input.keys['ShiftLeft'] && !this.flying && !swimming; // Shift in deep watter dives, not sneaks
    let sprinting = input.keys['KeyZ'] && fwd > 0 && this.hunger > 6 && !sneaking;
    let speed = this.flying ? (sprinting ? FLY_FAST : FLY)
      : swimming ? (sprinting ? SPRINT : WALK) * SWIM.SPEED_MUL // sprint = a stronger stroke
      : this.mounted ? MOUNT_WALK : sprinting ? SPRINT : sneaking ? SNEAK : WALK;
    if (!swimming) {
      if (inBog && !onFrozen) speed *= 0.3;
      else if (inWater && !onFrozen) speed *= 0.55;
      else if (this.onGround && !this.flying && !onFrozen) {
        // deep-winter drifts: wading a banked drift is heavy going — up on a
        // pony tha ploughs through easier. snowAccum is fed by t' main loop.
        const dd = driftDepth(this.pos.x, this.pos.z, this.pos.y, this.snowAccum || 0);
        if (dd > 0) speed *= 1 - dd * (this.mounted ? 0.3 : 0.55);
      }
    }
    if (!this.creative && !this.god && this.temperature < 6) speed *= 0.75; // cold stiffens t' limbs
    this.sprinting = sprinting;

    let wishX, wishZ, lookY = 0;
    if (swimming) {
      const w = swimWish(this.yaw, this.pitch, fwd, strafe, speed);
      wishX = w.x; wishZ = w.z; lookY = w.y;
    } else {
      wishX = (-sin * fwd + cos * strafe) * speed;
      wishZ = (-cos * fwd - sin * strafe) * speed;
    }
    // t' beck's carry rides on top o' thi own intent: stand still an' tha drifts
    // downstream at t' full current; swim an' it adds to (or fights) thi stroke.
    if (cur) { wishX += cur.x; wishZ += cur.z; }

    const accel = swimming ? SWIM.ACCEL : slippery ? 1.5 : (this.onGround || this.flying ? 18 : 5);
    this.vel.x += (wishX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wishZ - this.vel.z) * Math.min(1, accel * dt);

    // ----- vertical -----
    if (this.flying) {
      let vy = 0;
      if (input.keys['Space']) vy += FLY;
      if (input.keys['ShiftLeft']) vy -= FLY;
      this.vel.y += (vy - this.vel.y) * Math.min(1, 12 * dt);
      this.fallStart = null;
    } else if (swimming) {
      // swim vertical: tread at t' surface by default, Space kicks up, Shift dives,
      // a forward stroke follows t' look. Let go an' tha sinks slow under heavy drag.
      this._bobT = (this._bobT || 0) + dt;
      const wishY = swimVerticalWish({
        lookY,
        space: !!input.keys['Space'],
        shift: !!input.keys['ShiftLeft'],
        stroking: fwd !== 0 || strafe !== 0,
        diving: lookY < -0.5,
        eyeY: this.pos.y + this.eye,
        surfaceY: sub.surfaceY,
        tiring,
        bobT: this._bobT,
      });
      this.vel.y = swimVerticalStep(this.vel.y, wishY, dt);
      this.fallStart = null;
    } else if (inLiquid && (inBog || this.mounted || (sub.head && !sub.chest))) {
      // t' owd float: bogs (a trap by design), a mounted pony fording, an' freak
      // water-overhead columns. Sink, wi' Space to kick up agen it.
      const sink = inBog ? 3 : 5;
      this.vel.y -= sink * dt * 2;
      this.vel.y = Math.max(this.vel.y, inBog ? -0.8 : -2.2);
      if (input.keys['Space']) this.vel.y += (inBog ? 5 : (tiring ? 4.5 : 14)) * dt;
      this.vel.y = Math.min(this.vel.y, inBog ? 1.2 : 3.5);
      this.fallStart = null;
    } else {
      this.vel.y -= GRAVITY * dt;
      this.vel.y = Math.max(this.vel.y, -50);
      if (input.keys['Space'] && this.onGround) {
        this.vel.y = this.mounted ? JUMP_VEL * 1.25 : JUMP_VEL;
        this.onGround = false;
        this.exhaustion += 0.1;
        if (audio) audio.jump();
      }
    }

    // double-tap space toggles fly in creative
    if (input.jumpTapped) {
      input.jumpTapped = false;
      const now = performance.now();
      if (this.creative && now - this.lastJumpPress < 280) {
        this.flying = !this.flying;
        this.vel.y = 0;
      }
      this.lastJumpPress = now;
    }

    // fall tracking
    if (!this.flying && !inLiquid) {
      if (this.vel.y < -1 && this.fallStart === null) this.fallStart = this.pos.y;
    }

    const wasGround = this.onGround;
    moveEntity(this.world, this, dt);

    // frozen beck/bog: stand on top rather than sink in
    if (onFrozen) {
      const top = Math.floor(this.pos.y - 0.05) + 1;
      if (this.pos.y < top) { this.pos.y = top; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; }
    }

    // climbing out o' water: swimming hard at t' bank gives thee a vault ower
    // t' lip (otherwise a one-block shore is unclimbable). Bogs grudge it —
    // tha gets out, but slower.
    if (inLiquid) this.swimGrace = 0.35;
    else this.swimGrace = Math.max(0, (this.swimGrace || 0) - dt);
    const wantsMove = fwd !== 0 || strafe !== 0;
    if (this.swimGrace > 0 && this.hitWall && wantsMove && !this.flying) {
      this.vel.y = Math.max(this.vel.y, inBog ? 5.5 : 7.8);
    }
    // a pony leaps a low step of its own accord — no need to press jump, but
    // only a one-block rise (clear above her head), never a proper cliff
    if (this.mounted && this.hitWall && wantsMove && this.onGround && !this.flying &&
        !boxCollides(this.world, this.pos.x, this.pos.y + 1.25, this.pos.z, this.hw, 0.7)) {
      this.vel.y = Math.max(this.vel.y, JUMP_VEL * 1.1);
    }

    // sneak edge-guard: don't walk off edges while sneaking
    if (sneaking && wasGround && !this.onGround && this.vel.y <= 0) {
      // nudge back if there's no floor beneath
      if (!boxCollides(this.world, this.pos.x, this.pos.y - 0.1, this.pos.z, this.hw, 0.1)) {
        this.pos.x -= this.vel.x * dt * 1.2;
        this.pos.z -= this.vel.z * dt * 1.2;
        this.vel.x = 0; this.vel.z = 0;
        if (boxCollides(this.world, this.pos.x, this.pos.y - 0.1, this.pos.z, this.hw, 0.1)) this.onGround = true;
      }
    }

    // landing in watter: t' beck breaks thi fall ENTIRELY — jumping off t' rail bridge
    // into t' Esk is meant to be fun, not fatal (James 2026-07-03: water absorbs fall
    // damage; afore this, a same-frame touchdown on t' bed o' shallow watter still
    // hurt because only t' PRE-move inLiquid check cleared fallStart).
    if (this.feetBlock() === B.WATER || this.feetBlock() === B.BOG) this.fallStart = null;

    // landing: fall damage
    if (this.onGround && this.fallStart !== null) {
      const d = this.fallStart - this.pos.y - 3;
      if (d > 0 && !this.creative) {
        this.damage(Math.floor(d), 'Tha fell off summat');
        if (audio) audio.thud();
      }
      this.fallStart = null;
    }
    if (inLiquid) this.fallStart = null;

    // ----- survival ticks -----
    if (!this.creative && !this.god) {
      // drowning / bog suffocation
      const headIn = isLiquid(this.headBlock()) || (tiring && inWater); // a tired swimmer slips under
      if (headIn) {
        this.air -= dt;
        if (this.air < 0) {
          this.air = 0;
          this.drownTick = (this.drownTick || 0) + dt;
          if (this.drownTick > 1) {
            this.drownTick = 0;
            this.damage(2, this.headBlock() === B.BOG ? 'T\u2019 bog swallowed thee' : 'Tha drowned');
            if (audio) audio.hurt();
          }
        }
      } else {
        this.air = Math.min(10, this.air + dt * 2);
        this.drownTick = 0;
      }

      // hunger — cold makes thee burn more to keep warm
      const coldHungerMul = this.temperature < 12 ? 1.6 : 1;
      this.exhaustion += dt * (sprinting ? 0.10 : 0.012) * coldHungerMul;
      if (this.exhaustion > 4) {
        this.exhaustion = 0;
        this.hunger = Math.max(0, this.hunger - 1);
      }
      if (this.hunger <= 0) {
        this.starveTick = (this.starveTick || 0) + dt;
        if (this.starveTick > 4) {
          this.starveTick = 0;
          if (this.health > 1) this.damage(1, 'Tha clammed to deeath');
        }
      }
      // freezing: t' cold itself starts to do for thee
      if (this.temperature <= 0) {
        this._freezeT = (this._freezeT || 0) + dt;
        if (this._freezeT >= 4) { this._freezeT = 0; this.damage(1, "Froze to death on t’ moor"); }
      } else this._freezeT = 0;
      // regen when well fed — but not while tha's soaked through an' shiverin', nor chilled below 12
      if (this.hunger >= 16 && this.health < 20 && this.wetness < 0.6 && this.temperature >= 12) {
        this.regenTick += dt;
        if (this.regenTick > 3) {
          this.regenTick = 0;
          this.health = Math.min(20, this.health + 1);
          this.exhaustion += 1.5;
        }
      }
    } else {
      this.health = 20; this.hunger = 20; this.air = 10;
    }

    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    // fell out o' t' world
    if (this.pos.y < -10) this.damage(100, 'Tha fell into t\u2019 abyss');
  }

  damage(n, cause) {
    if (this.creative || this.god || this.dead || n <= 0) return;
    this.health -= n;
    this.hurtFlash = 0.4;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathCause = cause || 'Summat did for thee';
    }
  }

  eat(slotIdx, audio) {
    const s = this.slots[slotIdx];
    if (!s || !FOODS[s.id] || this.hunger >= 20) return false;
    this.hunger = Math.min(20, this.hunger + FOODS[s.id]);
    if (HOT_FOODS.has(s.id)) this.temperature = Math.min(20, this.temperature + 6);
    s.n--;
    if (s.n <= 0) this.slots[slotIdx] = null;
    if (audio) audio.eat();
    return true;
  }

  // add items; returns count that didn't fit
  addItem(id, n = 1, dur) {
    // top up existing stacks first
    if (!TOOLS[id]) {
      for (const s of this.slots) {
        if (s && s.id === id && s.n < maxStack(id)) {
          const take = Math.min(n, maxStack(id) - s.n);
          s.n += take; n -= take;
          if (n <= 0) return 0;
        }
      }
    }
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) {
        const take = Math.min(n, maxStack(id));
        this.slots[i] = { id, n: take };
        if (dur !== undefined) this.slots[i].dur = dur;
        else if (TOOLS[id]) this.slots[i].dur = TOOLS[id].dur;
        n -= take;
        if (n <= 0) return 0;
      }
    }
    return n;
  }

  countItem(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  removeItem(id, n) {
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(n, s.n);
        s.n -= take; n -= take;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
  }

  consumeHeld() {
    const s = this.slots[this.hotbar];
    if (!s) return;
    s.n--;
    if (s.n <= 0) this.slots[this.hotbar] = null;
  }

  // wear t' held tool; returns true if it snapped
  wearTool() {
    const s = this.slots[this.hotbar];
    if (!s || !TOOLS[s.id] || this.creative) return false;
    s.dur--;
    if (s.dur <= 0) {
      this.slots[this.hotbar] = null;
      return true;
    }
    return false;
  }

  respawn(spawn) {
    this.pos = { ...spawn };
    this.vel = { x: 0, y: 0, z: 0 };
    this.health = 20; this.hunger = 20; this.air = 10; this.temperature = 20;
    this.dead = false;
    this.fallStart = null;
    this.hurtFlash = 0;
  }

  serialize() {
    return {
      pos: this.pos, yaw: this.yaw, pitch: this.pitch,
      health: this.health, hunger: this.hunger, temperature: this.temperature,
      creative: this.creative, flying: this.flying,
      slots: this.slots, hotbar: this.hotbar, fuelBank: this.fuelBank, brass: this.brass,
      shipments: this.shipments, vendorPurses: this.vendorPurses, pursesAt: this.pursesAt,
      name: this.name, npcRewards: this.npcRewards,
      milestonesDone: this.milestonesDone, milestonesSteered: this.milestonesSteered,
      bairnFresh: this.bairnFresh, freeStarter: this.freeStarter,
      onboarded: this.onboarded, villagerMarkerHinted: this.villagerMarkerHinted, stationSellHinted: this.stationSellHinted,
      strongboxHinted: this.strongboxHinted,
      stormLanternHinted: this.stormLanternHinted,
      pets: this.pets || [],
      home: this.home,
      farmStatus: this.farmStatus,
      miningSkill: this.miningSkill || 0,
      knownTimes: this.knownTimes || {},
      taught: this.taught || {},
      commissions: this.commissions || [],
      vouches: this.vouches || [],
      promiseLog: this.promiseLog || { kept: 0, broken: 0 },
      gameRecord: this.gameRecord || { games: {}, biggestWin: 0 },
      look: this.look, // "Dress thissen" — additive; old saves lack it an' default to a rambler
    };
  }

  deserialize(d) {
    if (!d) return;
    // Defensive: an incomplete or corrupt save must NEVER NaN-out the player (undefined yaw →
    // NaN velocity → NaN position → black screen; undefined health → NaN hearts). Only apply a
    // saved position if it's finite; otherwise keep the spawn the world already set.
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    if (d.pos && fin(d.pos.x) && fin(d.pos.y) && fin(d.pos.z)) Object.assign(this.pos, d.pos);
    this.yaw = fin(d.yaw) ? d.yaw : 0; this.pitch = fin(d.pitch) ? d.pitch : 0;
    this.health = fin(d.health) ? d.health : 20; this.hunger = fin(d.hunger) ? d.hunger : 20;
    this.temperature = d.temperature ?? 20;
    this.creative = !!d.creative; this.flying = !!d.flying;
    this.slots = d.slots || this.slots;
    this.hotbar = d.hotbar || 0;
    this.fuelBank = d.fuelBank || 0;
    this.brass = d.brass ?? STARTING_BRASS;
    this.shipments = d.shipments || [];
    this.vendorPurses = d.vendorPurses || {};
    this.pursesAt = d.pursesAt || 0;
    this.name = d.name || '';
    this.npcRewards = d.npcRewards || {};
    this.milestonesDone = d.milestonesDone || [];
    this.milestonesSteered = !!d.milestonesSteered;
    this.bairnFresh = !!d.bairnFresh;
    this.freeStarter = !!d.freeStarter;
    this.onboarded = !!d.onboarded;
    this.villagerMarkerHinted = !!d.villagerMarkerHinted;
    this.stationSellHinted = !!d.stationSellHinted;
    this.strongboxHinted = !!d.strongboxHinted;
    this.stormLanternHinted = !!d.stormLanternHinted;
    this.pets = d.pets || [];
    this.home = (d.home && Number.isFinite(d.home.x) && Number.isFinite(d.home.y) && Number.isFinite(d.home.z)) ? d.home : null;
    this.farmStatus = d.farmStatus || { registered: false };
    this.miningSkill = d.miningSkill || 0;
    this.knownTimes = d.knownTimes || {};
    this.taught = d.taught || {};
    this.commissions = d.commissions || [];
    this.vouches = d.vouches || [];
    this.promiseLog = d.promiseLog || { kept: 0, broken: 0 };
    this.gameRecord = d.gameRecord || { games: {}, biggestWin: 0 };
    // additive + untrusted-input safe: an absent/old/junk look coerces to a rambler
    this.look = validatePlayerLook(d.look);
  }
}
