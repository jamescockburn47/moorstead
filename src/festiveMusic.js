// festiveMusic.js — plays a recording of "In the Bleak Midwinter" (Holst's
// "Cranham", organ, 5 verses) softly near a town in winter. Streams the MP3 via an
// HTML5 Audio element, loops it, and fades the volume by proximity to the village.
//
// The track lives at /music/in-the-bleak-midwinter.mp3 (served from public/). It's
// lazy-loaded (preload 'none') so the ~12 MB file is only fetched when the carol
// actually starts near a winter village, never on a bare page load.

const TRACK_URL = '/music/in-the-bleak-midwinter.mp3';

export class FestiveMusic {
  // `_ctx` kept for call-site compatibility (constructed with the game's AudioContext);
  // HTML5 Audio handles its own playback, so the context isn't needed here.
  constructor(_ctx) {
    this.el = new Audio(TRACK_URL);
    this.el.loop = true;
    this.el.preload = 'none';   // don't fetch the 12 MB file until it's first played
    this.el.volume = 0;
    this._running = false;
    this._starting = false;
  }

  // Idempotent: safe to call every frame while the carol should be audible.
  start() {
    if (this._running || this._starting) return;
    this._starting = true;
    Promise.resolve(this.el.play())
      .then(() => { this._running = true; this._starting = false; })
      .catch(() => { this._starting = false; }); // e.g. before a user gesture — retried next frame
  }

  stop() {
    this._starting = false;
    if (!this._running) return;
    this._running = false;
    this.el.pause();
  }

  // Distance/season-gated volume in [0,1]. Called every frame from the game loop.
  setVolume(v) {
    this.el.volume = v < 0 ? 0 : v > 1 ? 1 : v;
  }
}
