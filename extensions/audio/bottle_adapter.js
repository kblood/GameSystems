// Adapter: the bottles extension's `audio` option wants { play(key, minGapMs) } (BottleAudio's interface). This routes those
// keys (shatter, clink, pour, ...; BOTTLE_SOUNDS) into the audio system: voice pool, rate limit, a random variant of each
// sound, and spatial sound when the caller passes a position as third argument or `position(key)` returns one.
// BottleAudio itself is untouched and still works without this.
export function createBottleAudioAdapter(audio, { volume = { pour: 0.25 }, defaultVolume = 0.6, position = null } = {}) {
  return {
    play(key, minGapMs = 90, at = null) {
      return audio.play(key, { gain: volume[key] ?? defaultVolume, minGap: minGapMs / 1000, position: at ?? position?.(key) ?? null });
    },
  };
}
