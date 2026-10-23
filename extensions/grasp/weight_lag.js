// Visual weight of a held item (extensions plan, "Vaegt og to-haands greb"): held_drive.js already makes a heavy prop
// lag physically behind the hand, but the avatar's hand follows the REAL hand without delay, so the weight is never
// seen. The weight lag moves the DISPLAYED hand (and, at the higher tiers, an elbow hint) a little toward the item:
//
//   error   = item centre of mass - drive target   (the held-drive error: where the item really is vs where the hand wants it)
//   raw     = error * errorGain  +  down * sag(mass)          sag: a static sink, heavier = lower
//   offset  = soft-limit(raw, maxOffset(mass))                 maxOffset 5 mm (light) .. 30 mm (heavy): |offset| < maxOffset always
//   shown   = exponential smoothing of offset (tau, dt independent) x fade-in after the grab
//
// It never touches the tracked hand, the grasp or the physics: the result is a vector the caller ADDS to the shown wrist
// (and an optional elbow hint); the raw wrist stays available to the caller, so the unmodified hand can always be shown.
// Pure: plain arrays, no three.js. With a physics body the caller passes its centre of mass (`body`); without one
// (studio, the kinematic demo) `simulate: true` runs a virtual body through the real held-drive law (driveAcceleration),
// so the same error appears. Tiers (avatar quality names): minimal = off, low = hand offset, medium / high = hand offset
// + elbow hint. Switch: ?weightlag=off|on (parseWeightLag; the games decide the default: OFF in Contracts, ON in the test
// panels). Not ported to Godot: docs/ikvr_implementation.md "Vaegt og to-haands greb" lists what that needs.
// Every constant is in data/weight_lag.data.json (WEIGHT_LAG).
import DATA from './data/weight_lag.data.json' with { type: 'json' };
import { driveAcceleration, holdForce } from './held_drive.js';

/** Every constant of the weight lag (data/weight_lag.data.json). */
export const WEIGHT_LAG = DATA.WEIGHT_LAG;

const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = t => t * t * (3 - 2 * t);
const finite3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const len = v => Math.hypot(v[0], v[1], v[2]);

/** 'off' | 'on' (also 0/1, false/true) -> true | false; anything else (undefined: the caller's default) -> null. */
export function parseWeightLag(value) {
  if (value == null || value === '') return null;
  const s = String(value).toLowerCase();
  if (['on', '1', 'true', 'yes'].includes(s)) return true;
  if (['off', '0', 'false', 'no'].includes(s)) return false;
  return null;
}
/** What a tier shows: 'off' | 'hand' | 'elbow' (unknown tiers: 'hand'). */
export function weightLagMode(tier) { return WEIGHT_LAG.tiers[tier] ?? 'hand'; }

const share = (mass, hands) => mass * (hands > 1 ? WEIGHT_LAG.handsShare : 1);
/** 0..1 weight of a mass (kg) on a log scale between massRange[0] and massRange[1], eased. */
export function massWeight(mass, range = WEIGHT_LAG.massRange) {
  const m = Math.max(1e-3, Number.isFinite(mass) ? mass : 0);
  return smooth(clamp01(Math.log(m / range[0]) / Math.log(range[1] / range[0])));
}
/** The largest hand offset (m) for a mass: offsetMm[0] .. offsetMm[1]; two hands share the mass. Never reached exactly. */
export function maxOffset(mass, { hands = 1 } = {}) {
  const w = massWeight(share(mass, hands)), [a, b] = WEIGHT_LAG.offsetMm;
  return (a + (b - a) * w) / 1000;
}
/** Static sink (m, downward) of a mass. */
export function sagOf(mass, { hands = 1 } = {}) {
  const w = massWeight(share(mass, hands)), [a, b] = WEIGHT_LAG.sagMm;
  return (a + (b - a) * w) / 1000;
}
/** Soft limit: v scaled so that |result| < limit, ~identity for small vectors (limit * tanh(|v| / limit)). */
export function softLimit(v, limit) {
  const l = len(v);
  if (!(l > 1e-9) || !(limit > 0)) return [0, 0, 0];
  const k = limit * Math.tanh(l / limit) / l;
  return [v[0] * k, v[1] * k, v[2] * k];
}

/**
 * The offset (m) before smoothing, from the held-drive error. error: item centre of mass - drive target (world, m);
 * up: the world up axis (default +Y). Pure.
 */
export function lagTarget({ error = [0, 0, 0], mass, hands = 1, up = [0, 1, 0] }) {
  const cap = WEIGHT_LAG.errorCapMm / 1000, e = finite3(error) ? error : [0, 0, 0], l = len(e);
  const capped = l > cap ? e.map(v => v * cap / l) : e, sag = sagOf(mass, { hands });
  const raw = [0, 1, 2].map(k => capped[k] * WEIGHT_LAG.errorGain - up[k] * sag);
  return softLimit(raw, maxOffset(mass, { hands }));
}

/**
 * The elbow part of an update() result as an elbow hint for the avatar (avatar/vrik.js setElbowHint; the avatar plugin reads
 * `record.elbowHints[side] = { vector, weight }`): null unless the lag is active at tier mid / medium / high (mode 'elbow') and
 * the elbow moved at all. The vector is world metres; VRIK clamps it to its own limit (elbowHintMax, 3 cm) and eases it, so
 * this adds no jitter and no NaN (a non-finite result gives null).
 */
export function elbowHintOf(result) {
  const e = result?.elbow;
  if (!result?.active || !finite3(e) || len(e) < 1e-6) return null;
  return { vector: [e[0], e[1], e[2]], weight: 1 };
}

/**
 * A weight-lag follower for one hand. update() returns { offset, elbow, effort, active }:
 *   offset  metres to add to the SHOWN wrist (world), smoothed and soft-limited (|offset| < maxOffset(mass));
 *   elbow   metres to add to an elbow hint (tier medium / high only, else zero): follows the offset and sinks;
 *   effort  0..1 strain (|offset| / maxOffset, times the fade-in): hand tension, haptics, UI;
 *   active  false when switched off / nothing held (offset and elbow are then zero).
 * Options: enabled (the ?weightlag switch), tier ('minimal' | 'low' | 'medium' | 'high') or mode ('off' | 'hand' | 'elbow').
 */
export function createWeightLag({ enabled = true, tier = 'low', mode = null } = {}) {
  const state = { enabled, mode: mode ?? weightLagMode(tier), offset: [0, 0, 0], age: 0, holding: false, body: [0, 0, 0], velocity: [0, 0, 0] };
  const zero = () => ({ offset: [0, 0, 0], elbow: [0, 0, 0], effort: 0, active: false });
  const lag = {
    get enabled() { return state.enabled; },
    get mode() { return state.mode; },
    get active() { return state.enabled && state.mode !== 'off'; },
    setEnabled(on) { state.enabled = !!on; if (!on) lag.reset(); },
    setMode(m) { state.mode = m; if (m === 'off') lag.reset(); },
    setTier(t) { lag.setMode(weightLagMode(t)); },
    /** Forget the held item (release, tracking lost): nothing is carried to the next grab. */
    reset() { state.offset = [0, 0, 0]; state.age = 0; state.holding = false; state.velocity = [0, 0, 0]; },
    /**
     * One frame while an item is held. dt seconds; mass kg (the whole item); hands 1 | 2 (they share the load);
     * target: the drive target of the item's centre of mass (world); body: the item's real centre of mass (physics), or
     * null with simulate = true (a virtual body follows `target` through the held-drive law); up: world up.
     */
    update({ dt, mass, hands = 1, target, body = null, simulate = false, up = [0, 1, 0] }) {
      if (!lag.active || !Number.isFinite(dt) || dt < 0 || !(mass > 0) || !finite3(target)) { if (state.holding) lag.reset(); return zero(); }
      const real = finite3(body);
      if (!real && !simulate) { if (state.holding) lag.reset(); return zero(); }
      if (!state.holding) { state.holding = true; state.age = 0; state.body = [...target]; state.velocity = [0, 0, 0]; }
      let com = body;
      if (!real) {
        // virtual body: the real held-drive law (the drive compensates gravity, so none here), in small fixed steps
        let left = Math.min(dt, 0.1);
        const force = holdForce(hands);
        while (left > 1e-9) {
          const h = Math.min(left, WEIGHT_LAG.simulation.maxStep);
          const a = driveAcceleration({ position: state.body, velocity: state.velocity, targetPosition: target, mass, dt: h, gravity: [0, 0, 0], force });
          for (let k = 0; k < 3; k++) { state.velocity[k] += a[k] * h; state.body[k] += state.velocity[k] * h; }
          left -= h;
        }
        com = state.body;
      }
      const goal = lagTarget({ error: [com[0] - target[0], com[1] - target[1], com[2] - target[2]], mass, hands, up });
      state.age += dt;
      const k = 1 - Math.exp(-dt / WEIGHT_LAG.tau), ramp = smooth(clamp01(state.age / WEIGHT_LAG.rampIn));
      for (let i = 0; i < 3; i++) state.offset[i] += (goal[i] - state.offset[i]) * k;
      const offset = state.offset.map(v => v * ramp), max = maxOffset(mass, { hands }), size = len(offset);
      const elbow = state.mode === 'elbow' ? offset.map((v, i) => v * WEIGHT_LAG.elbow.follow - up[i] * WEIGHT_LAG.elbow.drop * size) : [0, 0, 0];
      return { offset, elbow, effort: clamp01(size / max), active: true };
    },
  };
  return lag;
}
