// Creaks from moving mechanisms (extensions/mechanics emits 'mechanics:changed' { id, kind, velocity, pose: { position } }).
// A hinge makes `door_hinge_creak`, a slider `drawer_creak`; only while it actually moves (|velocity| above a threshold),
// once per `gap` seconds, louder and higher the faster it moves. One-shots, never loops: a stopped door is silent at once.
// Not opt-in at the mechanism level: nothing happens unless the audio extension is loaded (index.js wires it).
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createCreakTrigger(audio, { sounds = { hinge: 'door_hinge_creak', slider: 'drawer_creak' },
  minSpeed = { hinge: 0.25, slider: 0.08 }, fullSpeed = { hinge: 1.6, slider: 0.6 }, gap = 0.6, gain = 0.5, roomOf = null, soundOf = null } = {}) {
  const last = new Map(); let fired = 0;
  return {
    /** state: a mechanics state; t: seconds on any monotonic clock. Returns true when a creak was started. */
    handle(state, t) {
      const kind = state?.kind, speed = Math.abs(state?.velocity ?? 0);
      const key = soundOf?.(state) ?? sounds[kind];
      if (!key || !(speed >= (minSpeed[kind] ?? 0.1))) return false;
      if (t - (last.get(state.id) ?? -Infinity) < gap) return false;
      last.set(state.id, t);
      const k = clamp01(speed / (fullSpeed[kind] ?? 1));
      const ok = audio.play(key, { gain: gain * (0.35 + 0.65 * k), rate: 0.92 + 0.16 * k, position: state.pose?.position, sourceId: `mech:${state.id}`, room: roomOf?.(state.id) ?? undefined, minGap: gap * 0.5 });
      if (ok) fired++;
      return !!ok;
    },
    get fired() { return fired; },
    forget(id) { last.delete(id); },
  };
}
