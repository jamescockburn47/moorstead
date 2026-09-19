import { FREEPLAY, freeplayCredentials } from './config.js';
import { integer, validCells, validHistory, validPosition, versioned } from './protocol.js';
import { OverrideStore } from './terrain-overrides.js';
import { validVehicle, validPose, MAX_VEHICLES } from './vehicle-data.js';
import { validBattleState, validBattleEvent } from './battle-protocol.js';

export class FreeplayConnection {
  constructor(auth, callbacks, Socket = WebSocket) {
    if (!freeplayCredentials(auth)) throw new Error('A free-play login is required.');
    this.auth = auth; this.callbacks = callbacks; this.Socket = Socket;
    this.epoch = 0; this.revision = 0; this.connected = false; this.pending = null;
    this.active = true; this.attempt = 0; this.stage = null; this.history = []; this.checkpoint = false;
  }
  connect() {
    if (!this.active) return;
    clearTimeout(this.retryTimer); clearInterval(this.watchdog);
    const url = new URL(FREEPLAY.socket);
    for (const [k, v] of Object.entries({ room: this.auth.room, pid: 'a' + this.auth.acct, name: this.auth.name, token: this.auth.token })) url.searchParams.set(k, v);
    const ws = this.socket = new this.Socket(url.href);
    this.connected = false; this.stage = null; this.lastSeen = Date.now();
    this.callbacks.state('connecting');
    const current = () => this.active && this.socket === ws;
    ws.onopen = () => { if (current()) ws.send(JSON.stringify({ type: 'hello', protocol: FREEPLAY.protocol, contentVersion: FREEPLAY.contentVersion })); };
    ws.onmessage = event => {
      if (!current()) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 100000) throw new Error('Oversized world message');
        this.lastSeen = Date.now(); this.receive(JSON.parse(event.data));
      } catch (error) { this.fail(error); }
    };
    ws.onerror = () => { if (current()) this.callbacks.state('offline'); };
    ws.onclose = event => {
      if (!current()) return;
      clearInterval(this.watchdog); this.connected = false; this.stage = null; this.pending = null;
      if(event.code===4004){
        this.callbacks.state('replaced');this.callbacks.error('This login was opened on another device. Use Reconnect here only when you want to move it back.');return;
      }
      if ([4003, 1008, 4002].includes(event.code)) {
        this.callbacks.state('denied'); this.callbacks.error('Login expired or access refused. Enter thi free-play code again.'); return;
      }
      this.callbacks.state('offline');
      if (this.attempt < 5) this.retryTimer = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.attempt++));
      else this.callbacks.error('Connection lost. Use Reconnect to return to the saved world.');
    };
    this.watchdog = setInterval(() => {
      if (!current()) return;
      const age = Date.now() - this.lastSeen;
      if (age > (this.stage ? FREEPLAY.transferTimeout : FREEPLAY.connectTimeout)) ws.close(4001, 'timeout');
      else if (this.connected && ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
    }, FREEPLAY.heartbeat);
  }
  fail(error) {
    this.callbacks.error('World synchronisation failed. Reconnect before making another change.');
    this.callbacks.diagnostic?.(error.message);
    this.connected = false; this.stage = null; this.pending = null;
    this.socket?.close(4002, 'protocol');
  }
  startStage(meta, snapshot = false) {
    if (this.stage || !versioned(meta) || !integer(meta.count, 0, FREEPLAY.maxCells)) throw new Error('Invalid world transfer');
    this.stage = { meta, snapshot, store: new OverrideStore(), received: 0, vehicles: new Map() };
    this.callbacks.state('syncing');
  }
  receive(m) {
    if (!m || typeof m !== 'object') throw new Error('Invalid world message');
    switch (m.type) {
      case 'init': {
        if (m.protocol !== FREEPLAY.protocol || m.contentVersion !== FREEPLAY.contentVersion || m.minContentVersion !== FREEPLAY.contentVersion || m.freeplay !== true || m.room !== FREEPLAY.room || m.seed !== FREEPLAY.seed
          || !validHistory(m.history) || !Array.isArray(m.players) || m.players.length > 16) throw new Error('Wrong world');
        this.epoch = m.epoch; this.revision = m.revision;
        this.startStage(m, true); this.history = m.history; this.checkpoint = m.checkpoint === true;
        this.callbacks.peers?.(m.players.filter(validPosition)); break;
      }
      case 'snapshot': this.append(m.edits, true); break;
      case 'vehicle-snapshot': {
        if(!this.stage||!(this.stage.snapshot||this.stage.meta.replace)||!validVehicle(m.vehicle)
          ||this.stage.vehicles.has(m.vehicle.id)||this.stage.vehicles.size>=MAX_VEHICLES)throw Error('Invalid vehicle snapshot');
        this.stage.vehicles.set(m.vehicle.id,m.vehicle);break;
      }
      case 'vehicle-delta': {
        if(!this.stage||m.epoch!==this.stage.meta.epoch||m.revision!==this.stage.meta.revision
          ||typeof m.vehicleId!=='string'||m.vehicleId.length>80
          ||!(m.vehicle===null||validVehicle(m.vehicle)&&m.vehicle.id===m.vehicleId)
          ||this.stage.vehicles.size>=MAX_VEHICLES)throw Error('Invalid vehicle change');
        this.stage.vehicles.set(m.vehicleId,m.vehicle);break;
      }
      case 'vehicle-lease':
        if(m.epoch===this.epoch&&typeof m.vehicleId==='string'
          &&(m.pilot===null||typeof m.pilot==='string')&&(m.lease==null||typeof m.lease==='string')
          &&(!m.pose||validPose(m.pose)))this.callbacks.vehicle?.(m);
        break;
      case 'vehicle-pos':
        if(m.epoch===this.epoch&&typeof m.vehicleId==='string'&&validPose(m.pose)&&integer(m.seq,0,2**40))this.callbacks.vehicle?.(m);
        break;
      case 'ready': {
        if (!this.stage?.snapshot || !versioned(m) || m.epoch !== this.epoch || m.revision !== this.revision) throw new Error('Invalid ready');
        this.finish(m); this.attempt = 0; break;
      }
      case 'begin': {
        if (!this.connected || !versioned(m) || m.revision !== this.revision + 1
          || (m.replace ? m.epoch !== this.epoch + 1 : m.epoch !== this.epoch)) throw new Error('World sequence gap');
        this.startStage(m); break;
      }
      case 'delta': {
        if (!this.stage || m.epoch !== this.stage.meta.epoch || m.revision !== this.stage.meta.revision) throw new Error('Wrong delta');
        this.append(m.edits, false); break;
      }
      case 'commit': {
        if (!this.stage || !versioned(m) || m.epoch !== this.stage.meta.epoch || m.revision !== this.stage.meta.revision
          || !validHistory(m.history)) throw new Error('Wrong commit');
        this.history = m.history; this.checkpoint = m.checkpoint === true; this.finish(m); break;
      }
      case 'error': {
        if(typeof m.command==='string'&&m.command.startsWith('battle-')){
          // Ordinary packet jitter can bunch automatic-fire requests. The server
          // keeps the cooldown authoritative; a discarded repeat is not a broken world.
          if(m.command==='battle-shot'&&m.code==='battle-rate')break;
          this.callbacks.error(typeof m.message==='string'?m.message.slice(0,240):'Battle action refused.');break;
        }
        if(['vehicle-claim','vehicle-release','vehicle-drive'].includes(m.command)){
          this.callbacks.vehicle?.({...m,type:'vehicle-error'});
          this.callbacks.error(typeof m.message==='string'?m.message.slice(0,240):'Vehicle action could not be saved.');break;
        }
        this.pending = null;
        this.callbacks.error(typeof m.message === 'string' ? m.message.slice(0, 240) : 'The change could not be saved.');
        if (m.code === 'stale') this.socket.close(4001, 'resync');
        else this.callbacks.state(this.connected ? 'ready' : 'offline');
        break;
      }
      case 'ack':
        if (m.duplicate && m.requestId === this.pending) { this.pending = null; this.socket.close(4001, 'resync'); }
        break;
      case 'pos': if (m.epoch === this.epoch && validPosition(m)) this.callbacks.peer?.(m); break;
      case 'battle-state':
        if(m.epoch===this.epoch){if(!validBattleState(m.battle))throw Error('Invalid battlefield state');this.callbacks.battle?.(m);}break;
      case 'battle-event':
        if(m.epoch===this.epoch&&validBattleEvent(m.event))this.callbacks.battle?.(m);break;
      case 'leave': if (typeof m.pid === 'string') this.callbacks.leave?.(m.pid); break;
      case 'join': if (m.epoch === this.epoch && validPosition(m)) this.callbacks.peer?.(m); break;
      case 'pong': break;
      default: throw new Error('Unknown free-play protocol message');
    }
  }
  append(rows, snapshot) {
    const stage = this.stage;
    if (!stage || stage.snapshot !== snapshot || !validCells(rows, !snapshot)) throw new Error('Invalid cells');
    stage.received += rows.length;
    if (stage.received > stage.meta.count) throw new Error('Too many cells');
    for (const [x, y, z, id] of rows) stage.store.setCell(x, y, z, id);
    if (stage.store.chunks.size > FREEPLAY.maxChunks) throw new Error('Too many world regions');
    this.callbacks.progress?.(stage.received, stage.meta.count);
  }
  finish(commit) {
    const stage = this.stage;
    if (stage.received !== stage.meta.count || stage.store.size !== stage.received) throw new Error('Incomplete or duplicate cells');
    if((stage.snapshot||stage.meta.replace)&&stage.vehicles.size!==stage.meta.vehicleCount)throw Error('Incomplete vehicles');
    this.stage = null; this.epoch = commit.epoch; this.revision = commit.revision; this.connected = true;
    if (stage.meta.replace) this.callbacks.peers?.([]);
    if (commit.requestId === this.pending || stage.snapshot) this.pending = null;
    this.callbacks.transaction({ ...stage.meta, ...commit, snapshot: stage.snapshot, edits: stage.store, vehicles:stage.vehicles });
    this.callbacks.state('ready');
  }
  command(type, fields = {}) {
    if (!this.connected || this.stage || this.pending || this.socket?.readyState !== 1) throw new Error('Wait for the shared world to finish saving.');
    const requestId = crypto.randomUUID(); this.pending = requestId;
    try { this.socket.send(JSON.stringify({ ...fields, type, requestId, epoch: this.epoch, baseRevision: this.revision })); }
    catch (error) { this.pending = null; throw error; }
    this.callbacks.state('saving'); return requestId;
  }
  position(point) {
    if (point) this.lastPosition = point;
    if (!point || !this.connected || this.socket?.readyState !== 1) return;
    this.socket.send(JSON.stringify({ type: 'pos', epoch: this.epoch, x: point.x, y: point.y, z: point.z, yaw: point.yaw }));
  }
  vehicle(type,fields){
    if(!this.connected||this.stage||this.socket?.readyState!==1)return false;
    this.socket.send(JSON.stringify({...fields,type,epoch:this.epoch}));return true;
  }
  battle(type,fields={}){return this.vehicle(type,fields);}
  reconnect() { this.attempt = 0; this.socket?.close(); this.connect(); }
  dispose() {
    this.active = false; this.connected = false; clearTimeout(this.retryTimer); clearInterval(this.watchdog);
    this.socket?.close(1000, 'leaving'); this.stage = null; this.pending = null;
  }
}
