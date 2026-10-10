// Throw release and glass-break tuning (port of the Godot interaction-fix throw_release.gd).
// Pure, renderer-free. Velocities are [x,y,z] arrays in world metres per second.

/** Normal contact speed (m/s) above which a glass bottle shatters on a hard, non-hand surface.
 * A natural ~3 m/s VR throw breaks on floor and wall; placing (< 1 m/s) and a 2 m/s toss do not;
 * dropped from above ~0.32 m onto a hard floor it breaks (sqrt(2 g 0.32) = 2.5 m/s). */
export const GLASS_BREAK_CONTACT_SPEED = 2.5;
/** Upper bound for the released linear speed (m/s); far above human throws. */
export const RELEASE_SPEED_CAP = 9.0;
/** Upper bound for the released spin (rad/s). */
export const RELEASE_SPIN_CAP = 22.0;
/** Release velocity = peak of a short-smoothed CONTROLLER velocity inside the last RELEASE_WINDOW s.
 * A real throw releases while the hand already decelerates, so the latest sample alone is too slow. */
export const RELEASE_WINDOW = 0.1;
/** Smoothing span per candidate (s): ~3 samples at 72 Hz, suppresses 5 mm jitter. */
export const RELEASE_SMOOTHING = 0.04;
export const SAMPLE_SPEED_CAP = 8.0;
export const SAMPLE_SPIN_CAP = 20.0;
/** Samples kept (s); a little more than window + smoothing. */
export const HISTORY_SPAN = 0.16;

const len = v => Math.hypot(v[0], v[1], v[2]);
const limit = (v, max) => { const l = len(v); return l > max && l > 0 ? v.map(n => n * max / l) : [...v]; };

export function createThrowHistory() { return { samples: [], linear: [0, 0, 0], angular: [0, 0, 0] }; }

/** Add one controller velocity sample (displacement/dt) and recompute the release velocity. */
export function pushSample(history, linear, angular, dt) {
  if (!(dt > 0) || ![...linear, ...angular].every(Number.isFinite)) return history;
  const samples = history.samples;
  samples.push({ dt, linear: limit(linear, SAMPLE_SPEED_CAP), angular: limit(angular, SAMPLE_SPIN_CAP) });
  let span = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    span += samples[i].dt;
    if (span > HISTORY_SPAN) { samples.splice(0, i + 1); break; }
  }
  const result = releaseVelocity(samples);
  history.linear = result.linear; history.angular = result.angular;
  return history;
}

/** Peak-speed smoothed velocity within the last RELEASE_WINDOW seconds. */
export function releaseVelocity(samples) {
  let bestLinear = [0, 0, 0], bestAngular = [0, 0, 0], age = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (age > RELEASE_WINDOW) break;
    const linear = [0, 0, 0], angular = [0, 0, 0]; let covered = 0;
    for (let j = i; j >= 0; j--) {
      const take = Math.min(samples[j].dt, RELEASE_SMOOTHING - covered);
      if (take <= 0) break;
      for (let k = 0; k < 3; k++) { linear[k] += samples[j].linear[k] * take; angular[k] += samples[j].angular[k] * take; }
      covered += take;
    }
    if (covered > 0) for (let k = 0; k < 3; k++) { linear[k] /= covered; angular[k] /= covered; }
    if (len(linear) > len(bestLinear)) { bestLinear = linear; bestAngular = angular; }
    age += samples[i].dt;
  }
  return { linear: limit(bestLinear, RELEASE_SPEED_CAP), angular: limit(bestAngular, RELEASE_SPIN_CAP) };
}

/** Velocity sample from two consecutive controller poses ({pos,quat}) over dt. */
export function sampleFromPoses(previous, current, dt) {
  const linear = [0, 1, 2].map(k => (current.pos[k] - previous.pos[k]) / dt);
  const [ax, ay, az, aw] = previous.quat, [bx, by, bz, bw] = current.quat;
  // delta = current * inverse(previous)
  let x = bw * -ax + bx * aw + by * -az - bz * -ay, y = bw * -ay - bx * -az + by * aw + bz * -ax;
  let z = bw * -az + bx * -ay - by * -ax + bz * aw, w = bw * aw - bx * -ax - by * -ay - bz * -az;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z), angle = 2 * Math.atan2(s, w);
  const angular = s > 1e-9 ? [x / s * angle / dt, y / s * angle / dt, z / s * angle / dt] : [0, 0, 0];
  return { linear, angular };
}
