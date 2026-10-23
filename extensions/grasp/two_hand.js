// Two-hand grip (extensions plan, "Vaegt og to-haands greb"). Pure: plain arrays, no three.js, no physics engine.
//
// Data model. A prop kind may have a SECONDARY grip: data/two_hand.data.json ITEMS[kind] = { primary, secondary,
// minSeparation, reference }. primary / secondary name grasp groups of the same pose library (baked, procedural or
// recorded: a pose row is the same format for both, recordings carry an optional `role`: 'primary' | 'secondary'); they
// may be the same group (a pole, a ladder: any grip works for either hand). `minSeparation` (m) is the least distance
// between the two grips in item space; `reference` is the hand whose roll the item keeps ('first' = the hand that
// grabbed first). Two hands on one body never occupy the same place: pickSecondary() only returns poses far enough
// from the primary grip, and handsClearance() measures the skin-capsule gap between the two closed hands.
//
// Runtime (the game's grab system owns the state; this module is the maths):
//   one hand      item target T1 = controller1 o offset1   (the existing one-hand drive)
//   second hand   the item's orientation follows the line between the hands: swing from the nominal grip axis (primary
//                 grip -> secondary grip, item space, as T1 has it) to the real one (controller1 -> controller2), about
//                 the primary grip, the primary's roll kept (shortest arc), bounded to maxCorrectionDeg (the same pattern
//                 as the pistol's bounded two-hand correction), blended in/out over blendSeconds so 1 -> 2 -> 1 never jumps;
//                 a hand distance that does not match the grips is shared between the hands (balance, at most maxShift).
//   hold force    holdForce(2) = the sum of the hands, capped (held_drive.js); a heavy item gets lighter to hold.
//   release       one hand lets go: the other carries on alone from the last target (no pop), no throw; both let go
//                 within releaseTogether seconds: a throw from both.
import TWO_DATA from './data/two_hand.data.json' with { type: 'json' };
import { posesFor, nearestPose } from './baked_grasps.js';
import { palmAnchor, fingerChain } from './closure.js';
import { add, sub, scale, cross, length, qmul, qconj, rotate } from './math.js';

export const TWO_HAND = TWO_DATA.TWO_HAND;
export const ITEMS = TWO_DATA.ITEMS;
export { holdForce, holdTorque } from './held_drive.js';

const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const finite = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const normalize = v => { const l = length(v); return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : null; };
const smooth = t => t * t * (3 - 2 * t);
const qnorm = q => { const l = Math.hypot(...q) || 1; return q.map(v => v / l); };

/** The two-hand spec of a kind, or null (the kind is one-handed). */
export function twoHandSpec(kind) { return ITEMS[kind] ?? null; }
export const isTwoHanded = kind => !!ITEMS[kind];

/** Item-space point where a pose's palm sits (the grip point): closure.palmAnchor. */
export function gripPoint(pose) { return palmAnchor(pose); }
/** Distance (m) between the grips of two poses (item space). */
export function gripSeparation(a, b) { return length(sub(gripPoint(a), gripPoint(b))); }

/**
 * The pose for the SECOND hand: the nearest (to `local`, the hand's wrist in item space) pose of the secondary group on
 * this side that is at least minSeparation from the primary pose's grip and not marked role 'primary'.
 * accept(pose): an extra test (the grab system passes the hand-clearance check). Returns the nearestPose() result ({ pose, cost, distance, angle }) or null (no spec, or nothing far enough).
 */
export function pickSecondary(kind, side, local, { primary, previousId = null, spec = twoHandSpec(kind), accept = null } = {}) {
  if (!spec) return null;
  const from = primary ? gripPoint(primary) : null;
  return nearestPose(kind, side, local, { previousId, grasp: spec.secondary,
    filter: p => p.role !== 'primary' && (!from || length(sub(gripPoint(p), from)) >= spec.minSeparation) && (!accept || accept(p)) });
}
/** All poses a hand may use as the secondary grip of `primary` (for tests and tools). */
export function secondaryPoses(kind, side, primary, spec = twoHandSpec(kind)) {
  if (!spec) return [];
  const from = primary ? gripPoint(primary) : null;
  return posesFor(kind, side).filter(p => p.grasp === spec.secondary && p.role !== 'primary' && (!from || length(sub(gripPoint(p), from)) >= spec.minSeparation));
}

// ---- hand-vs-hand clearance --------------------------------------------------------------------------------------
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
/** Skin capsules of a closed hand in item space: [{ a, b, r }] (finger segments, plus the palm as one short capsule). */
export function handCapsules(hand, closed) {
  const s = hand.scale, place = p => add(closed.wrist, rotate(closed.quat, scale(p, s))), out = [];
  FINGERS.forEach((f, i) => {
    const chain = fingerChain(hand.fingers[f], closed.angles[i]);
    for (let k = 0; k < 3; k++) out.push({ a: place(chain[k]), b: place(chain[k + 1]), r: hand.fingers[f].radius[k] * s });
  });
  const c = hand.palm.center, n = hand.palm.normal, half = 0.5 * (hand.palm.width || 0.08) * 0.6, t = 0.5 * (hand.palm.thickness || 0.03);
  const u = normalize(cross(n, [0, 0, 1])) ?? [1, 0, 0];
  out.push({ a: place(add(c, scale(u, half))), b: place(add(c, scale(u, -half))), r: t * s });
  return out;
}
/** Closest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentDistance(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), EPS = 1e-12;
  let s, t;
  if (a <= EPS && e <= EPS) { s = t = 0; }
  else if (a <= EPS) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= EPS) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > EPS ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return length(sub(add(p1, scale(d1, s)), add(p2, scale(d2, t))));
}
/**
 * Smallest skin gap (m, negative = the hands overlap) between two closed hands on the same item: hand1 / hand2 are
 * closure.handGeometry() hands, closed1 / closed2 closeToContact() results ({ wrist, quat, angles }, item space).
 */
export function handsClearance(hand1, closed1, hand2, closed2) {
  const A = handCapsules(hand1, closed1), B = handCapsules(hand2, closed2);
  let gap = Infinity;
  for (const x of A) for (const y of B) gap = Math.min(gap, segmentDistance(x.a, x.b, y.a, y.b) - x.r - y.r);
  return gap;
}
/** True when two closed hands keep their skin apart (clearance >= 0). */
export const handsClear = (hand1, closed1, hand2, closed2) => handsClearance(hand1, closed1, hand2, closed2) >= 0;

// ---- orientation from two hands ----------------------------------------------------------------------------------
/** Shortest-arc quaternion taking unit a to unit b (a stable axis for the antiparallel case). */
export function arcQuat(a, b) {
  const d = dot(a, b);
  if (d > 1 - 1e-12) return [0, 0, 0, 1];
  if (d < -1 + 1e-9) {
    const ref = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], axis = normalize(cross(a, ref));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(a, b);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}
/** Quaternion angle (rad, 0..pi). */
export const quatAngleOf = q => 2 * Math.acos(Math.min(1, Math.abs(q[3])));
/** q scaled toward identity so its angle is at most max (rad); also scaled by k (0..1, the blend). */
export function limitedSwing(q, max, k = 1) {
  const q2 = q[3] < 0 ? q.map(v => -v) : q, angle = quatAngleOf(q2);
  if (!(angle > 1e-9)) return [0, 0, 0, 1];
  const use = Math.min(angle, max) * k, s = Math.sin(use / 2) / Math.sin(angle / 2);
  return qnorm([q2[0] * s, q2[1] * s, q2[2] * s, Math.cos(use / 2)]);
}
const compose = (a, b) => ({ pos: add(a.pos, rotate(a.quat, b.pos)), quat: qnorm(qmul(a.quat, b.quat)) });
const inverse = a => { const q = qconj(a.quat); return { pos: rotate(q, scale(a.pos, -1)), quat: q }; };
/** Pose of an item in a controller's frame: inverse(controller) o item (the grab system's `offset`). */
export const offsetOf = (controller, item) => compose(inverse(controller), item);
/** Item-space position of the controller whose offset (item in controller) is given: inverse(offset).pos. */
export const controllerPointOf = offset => inverse(offset).pos;

/**
 * The item pose with both hands on it.
 *   primary   { pos, quat }  world grip pose of the primary hand's controller
 *   secondary { pos }        world grip position of the secondary controller
 *   offset    { pos, quat }  item in the primary controller (as the one-hand drive has it)
 *   point1 / point2          item-space positions of the primary / secondary controller grips (controllerPointOf(offset) for
 *                            each hand's offset)
 *   weight    0..1           blend of the two-hand solution into the one-hand target (stepBlend; eased here)
 * Returns { pos, quat, base (the one-hand target), angle (swing applied, rad), axisError (rad between the item's axis and the
 * line between the hands, after the swing), shift (m), distanceError (m, hand distance minus grip distance), active }.
 * Never NaN: bad input returns the one-hand target. Independent of dt (a pure function of the poses and the weight).
 */
export function solveTwoHand({ primary, secondary, offset, point1 = null, point2, weight = 1, maxCorrection = TWO_HAND.maxCorrectionDeg * D2R, balance = TWO_HAND.balance, maxShift = TWO_HAND.maxShift, minAxis = TWO_HAND.minAxis }) {
  const base = compose(primary, offset), p1 = point1 ?? controllerPointOf(offset);
  const idle = { ...base, base, angle: 0, axisError: 0, shift: 0, distanceError: 0, active: false };
  if (!(finite(primary?.pos, 3) && finite(primary?.quat, 4) && finite(secondary?.pos, 3) && finite(point2, 3) && finite(p1, 3) && finite(offset?.pos, 3) && finite(offset?.quat, 4))) return idle;
  const a = sub(point2, p1), la = length(a), d = sub(secondary.pos, primary.pos), ld = length(d);
  if (!(la >= minAxis) || !(ld > 1e-6)) return idle;
  const nominal = normalize(rotate(base.quat, a)), desired = normalize(d), w = smooth(Math.max(0, Math.min(1, weight)));
  const swing = arcQuat(nominal, desired), applied = limitedSwing(swing, maxCorrection, w);
  const quat = qnorm(qmul(applied, base.quat));
  // pivot about the primary grip: the primary hand stays where it is, then share the hand-distance mismatch
  let pos = sub(primary.pos, rotate(quat, p1));
  const axis = rotate(quat, a), mismatch = sub(secondary.pos, add(primary.pos, axis));
  let shift = scale(mismatch, balance * w);
  const ls = length(shift);
  if (ls > maxShift) shift = scale(shift, maxShift / ls);
  pos = add(pos, shift);
  const after = normalize(axis);
  return { pos, quat, base, angle: quatAngleOf(applied), axisError: Math.acos(Math.max(-1, Math.min(1, dot(after, desired)))), shift: length(shift), distanceError: ld - la, active: true };
}
/** Move the blend weight toward `target` (0 | 1) at 1 / blendSeconds per second (dt independent in total time). */
export function stepBlend(weight, target, dt, seconds = TWO_HAND.blendSeconds) {
  if (!Number.isFinite(dt) || !(dt > 0)) return weight;
  const step = dt / Math.max(1e-3, seconds);
  return weight < target ? Math.min(target, weight + step) : Math.max(target, weight - step);
}
/** True when the second controller is still close enough to its grip on the item (else the second grip lets go). */
export function secondaryHeld({ item, point2, secondary, breakDistance = TWO_HAND.breakDistance }) {
  if (!finite(secondary?.pos, 3) || !finite(point2, 3)) return false;
  return length(sub(secondary.pos, add(item.pos, rotate(item.quat, point2)))) <= breakDistance;
}
/** Both hands let go within releaseTogether seconds of each other: a throw from both. */
export const releasedTogether = (t1, t2, window = TWO_HAND.releaseTogether) => Math.abs(t1 - t2) <= window;
