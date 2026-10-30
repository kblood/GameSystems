// Bottle sounds (GameSystems audio/ogg). play(key, minGapMs) rate-limits each key; browser audio unlocks with the first
// user gesture. Without HTMLAudioElement (node, workers) it is silent. Games with their own mixer pass { play(key) }
// as the bottles extension's `audio` option instead.
export const BOTTLE_SOUNDS = Object.freeze({
  shatter: 'glass_shatter_large_01.ogg',
  smallShatter: 'glass_shatter_small_01.ogg',
  clink: 'glass_clink_hard_01.ogg',
  plastic: 'plastic_bottle_bounce_01.ogg',
  glassHit: 'bullet_hit_glass_01.ogg',
  plasticHit: 'bullet_hit_plastic_01.ogg',
  cap: 'cork_pop_01.ogg',
  pour: 'liquid_glug_01.ogg',
  splash: 'liquid_splash_small_01.ogg',
});
const MAX_PLAYERS = 8;
const isBreak = key => key === 'shatter' || key === 'smallShatter';

export class BottleAudio {
  /** assetURL(path) -> url of a GameSystems asset path such as 'audio/ogg/cork_pop_01.ogg'. */
  constructor(assetURL = path => path, { volume = { pour: 0.25 }, defaultVolume = 0.6 } = {}) {
    this.urls = new Map(Object.entries(BOTTLE_SOUNDS).map(([key, file]) => [key, String(assetURL(`audio/ogg/${file}`))]));
    this.volume = volume; this.defaultVolume = defaultVolume;
    this.last = new Map();
    this.players = new Set(); this.playerKeys = new WeakMap(); this.disposed = false;
  }
  _retire(a) {
    if (!this.players.delete(a)) return;
    a.onended = a.onerror = null;
    a.pause();
    a.removeAttribute('src');
    a.load(); // abandon any pending media load/play request
  }
  reset() {
    for (const a of [...this.players]) this._retire(a);
    this.last.clear();
  }
  dispose() {
    this.disposed = true;
    this.reset();
  }
  /** Synchronous admission only: true means play() was requested, not that
   * browser autoplay/network playback will succeed. Rejections remain silent. */
  play(key, minGapMs = 90) {
    const url = this.urls.get(key);
    if (this.disposed || !url || typeof Audio === 'undefined') return false;
    const now = performance.now();
    if (now - (this.last.get(key) || 0) < minGapMs) return false;
    // Reclaim completed elements before deciding capacity. Pending/paused play
    // requests still own a slot: autoplay or slow media must not grow the set.
    for (const player of [...this.players]) if (player.ended) this._retire(player);
    if (this.players.size >= MAX_PLAYERS) {
      if (!isBreak(key)) return false;
      // Oldest nonbreak first; never cut a break tail for another cue.
      const victim = [...this.players].find(player => !isBreak(this.playerKeys.get(player)));
      if (!victim) return false;
      this._retire(victim);
    }
    let a = null;
    try {
      a = new Audio(url);
      this.players.add(a);
      this.playerKeys.set(a, key);
      a.onended = a.onerror = () => this._retire(a);
      a.volume = this.volume[key] ?? this.defaultVolume;
      a.play().catch(() => this._retire(a)); // admission is not async success
      this.last.set(key, now);
      return true;
    } catch {
      if (a) this._retire(a);
      return false; // no cooldown for a synchronously rejected request
    }
  }
}
