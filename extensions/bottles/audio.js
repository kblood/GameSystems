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

export class BottleAudio {
  /** assetURL(path) -> url of a GameSystems asset path such as 'audio/ogg/cork_pop_01.ogg'. */
  constructor(assetURL = path => path, { volume = { pour: 0.25 }, defaultVolume = 0.6 } = {}) {
    this.urls = new Map(Object.entries(BOTTLE_SOUNDS).map(([key, file]) => [key, String(assetURL(`audio/ogg/${file}`))]));
    this.volume = volume; this.defaultVolume = defaultVolume;
    this.last = new Map();
  }
  play(key, minGapMs = 90) {
    const url = this.urls.get(key);
    if (!url || typeof Audio === 'undefined') return;
    const now = performance.now();
    if (now - (this.last.get(key) || 0) < minGapMs) return;
    this.last.set(key, now);
    const a = new Audio(url);
    a.volume = this.volume[key] ?? this.defaultVolume;
    a.play().catch(() => {}); // browser audio is unlocked by the first user gesture
  }
}
