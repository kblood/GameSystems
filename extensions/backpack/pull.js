// Handle pull: a JS port of godot/addons/gs_backpack/gs_backpack_handle_pull.gd (GSBackpackHandlePull). Deterministic,
// bounded, local-space (the bag faces -Z of its own frame). The numbers are data.PULL: deadzone 3.5 cm, cap 20 cm, follow
// rate 14 /s. The follow is an exponential (1 - exp(-rate*dt)), so the result does not depend on how dt is sliced.
import DATA from './data/backpack.data.json' with { type: 'json' };

export const PULL = DATA.PULL;
const fin3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const clampf = (v, a, b) => Math.max(a, Math.min(b, v));

export function createPull() {
  const s = { active: false, side: '', inputKind: 'grip', start: [0, 0, 0], offset: 0, target: 0 };
  function settle(dt) {
    if (Number.isFinite(dt) && dt > 0) {
      s.offset += (s.target - s.offset) * (1 - Math.exp(-PULL.FOLLOW_RATE * dt));
      if (!s.active && s.offset < PULL.SETTLE_EPSILON_M) s.offset = 0;
    }
    return s.offset;
  }
  const api = {
    get active() { return s.active; }, get side() { return s.side; }, get offset() { return s.offset; }, get target() { return s.target; },
    get start() { return [...s.start]; },
    begin(handLocal, side, kind = 'grip') {
      if (s.active || (side !== 'left' && side !== 'right') || !fin3(handLocal)) return false;
      if (kind !== 'grip' && kind !== 'interact') return false;
      s.active = true; s.side = side; s.inputKind = kind; s.start = [...handLocal]; s.target = 0;
      return true;
    },
    /** Advance by dt; returns the (smoothed) offset in metres. Tracking loss cancels the pull. */
    step(handLocal, tracked, dt) {
      if (!s.active) return settle(dt);
      if (!tracked || !fin3(handLocal)) { api.cancel(); return settle(dt); }
      if (!Number.isFinite(dt) || dt <= 0) return s.offset;
      const outward = s.start[2] - handLocal[2]; // only motion away from the body along -Z pulls
      s.target = clampf(outward - PULL.PULL_DEADZONE_M, 0, PULL.MAX_PULL_M);
      return settle(dt);
    },
    cancel() { s.active = false; s.side = ''; s.inputKind = 'grip'; s.target = 0; },
    /** Drop the offset at once (state machine hard resets). */
    clear() { api.cancel(); s.offset = 0; },
  };
  return api;
}
