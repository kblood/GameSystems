// Adapter: the bottles extension's `audio` option wants { play(key, minGapMs) } (BottleAudio's interface). This routes those
// keys (shatter, clink, pour, ...; BOTTLE_SOUNDS) into the audio system: voice pool, rate limit, a random variant of each
// sound, and spatial sound.
//
// Position: bottles calls play(key, minGapMs) WITHOUT a position (breakage.js, pour.js, factory.js are not touched). The
// adapter therefore finds one itself, in this order: a position passed as third argument (a future bottles version may do
// that), the current `focus` (set around a call that is known to concern one bottle, e.g. the demo wraps factory.onImpact),
// the `position(key)` option, and the bottle that is held (`bind(host)` follows the host's grab/release events; pouring and
// capping only happen with a bottle in hand). Without any of them the sound sits on the listener, as before.
// BottleAudio itself is untouched and still works without this.
const pos = b => b?.root?.position ?? b?.position ?? null;

export function createBottleAudioAdapter(audio, { volume = { pour: 0.25 }, defaultVolume = 0.6, position = null } = {}) {
  let focus = null; const held = new Set();
  const adapter = {
    play(key, minGapMs = 90, at = null) {
      const where = at ?? (focus ? (typeof focus === 'function' ? focus() : focus) : null) ?? position?.(key) ?? heldPosition();
      return audio.play(key, { gain: volume[key] ?? defaultVolume, minGap: minGapMs / 1000, position: where });
    },
    /** Position (array, {x,y,z} or a bottle/object with .root.position) for play() calls until clearFocus(); a function is read at call time. */
    setFocus(p) { focus = p && typeof p !== 'function' && pos(p) ? pos(p) : p; },
    clearFocus() { focus = null; },
    /** Run fn with the focus on `p`, always cleared afterwards. */
    withFocus(p, fn) { const before = focus; adapter.setFocus(p); try { return fn(); } finally { focus = before; } },
    /** Held bottles (grab/release events carry { bottle }); returns an unsubscribe function. */
    bind(host) {
      const offs = [host.on('grab', e => adapter.hold(e?.bottle)), host.on('release', e => adapter.drop(e?.bottle))];
      return () => { for (const off of offs) off?.(); held.clear(); };
    },
    /** Same as the host events, for games that have their own grab events. */
    hold(bottle) { if (bottle) held.add(bottle); },
    drop(bottle) { held.delete(bottle); },
    get held() { return held.size; },
  };
  function heldPosition() { for (const b of held) { if (b.broken) { held.delete(b); continue; } const p = pos(b); if (p) return p; } return null; }
  return adapter;
}
