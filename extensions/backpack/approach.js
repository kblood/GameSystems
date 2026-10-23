// Over-shoulder approach policy: a JS port of godot/addons/gs_backpack/gs_backpack_approach.gd (GSBackpackApproach), line for
// line, so JS and Godot give the same answers. All numbers live in data/backpack.data.json (APPROACH), copied from the Godot
// constants. +X is the wearer's right, +Z is behind the wearer (body-local metres). Owns no items, nodes or physics.
import DATA from './data/backpack.data.json' with { type: 'json' };

export const APPROACH = DATA.APPROACH;
const A = APPROACH;
const fin3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sign = side => (side === 'right' ? 1 : -1);
const result = (allowed, reason) => ({ allowed, reason });
const isSide = s => s === 'left' || s === 'right';

export function createApproach() {
  const hands = new Map();
  const reset = side => { if (side === undefined || side === '') hands.clear(); else hands.delete(side); };

  function pathClear(side, previous, current, shoulderY) {
    const lateral = current[0] * sign(side);
    if (lateral < -A.CENTRE_CROSS_TOLERANCE_M || lateral > A.SIDE_MAX_M || current[2] < A.ENTRY_FRONT_M) return false;
    if (current[1] < shoulderY - A.RETRIEVE_BELOW_SHOULDER_M) return false;
    // The hand must cross behind the shoulder while still high: interpolate the sampled segment at that plane.
    if (current[2] < A.RETRIEVE_BACK_MIN_M && current[1] < shoulderY - A.PATH_SHOULDER_CLEARANCE_M) return false;
    if (previous[2] < A.RETRIEVE_BACK_MIN_M && current[2] >= A.RETRIEVE_BACK_MIN_M) {
      const crossing = lerp3(previous, current, (A.RETRIEVE_BACK_MIN_M - previous[2]) / (current[2] - previous[2]));
      if (crossing[1] < shoulderY - A.PATH_SHOULDER_CLEARANCE_M) return false;
    }
    return true;
  }

  return {
    reset,
    /** Feed at tracking cadence. Tracking loss, NaN, hitches (dt > 0.15 s), jumps (> 0.30 m) and body-crossing paths reset the side. */
    observe(side, tracked, localHand, shoulderY, dt) {
      if (!isSide(side)) return;
      if (!tracked || !fin3(localHand) || !Number.isFinite(shoulderY) || !Number.isFinite(dt) || dt <= 0 || dt > A.MAX_SAMPLE_DT + A.BOUNDARY_EPSILON) { reset(side); return; }
      const previous = hands.get(side);
      if (previous && dist(localHand, previous.position) > A.MAX_SAMPLE_JUMP_M + A.BOUNDARY_EPSILON) { reset(side); return; }
      if (previous && previous.age <= A.APPROACH_LIFETIME_S && !pathClear(side, previous.position, localHand, shoulderY)) { reset(side); return; }
      let age = (previous ? previous.age : A.APPROACH_LIFETIME_S + 1) + dt;
      let entry = previous ? previous.entry : localHand;
      const lateral = localHand[0] * sign(side);
      if (lateral >= A.ENTRY_SIDE_MIN_M && lateral <= A.SIDE_MAX_M && localHand[1] >= shoulderY - A.ENTRY_HEIGHT_TOLERANCE_M && localHand[1] <= shoulderY + A.ENTRY_ABOVE_SHOULDER_M
        && localHand[2] >= A.ENTRY_FRONT_M && localHand[2] <= A.ENTRY_BACK_M) { entry = localHand; age = 0; }
      hands.set(side, { position: [...localHand], entry: [...entry], age });
    },
    /** { allowed, reason }; reasons back_approach_invalid|required|jump|path|expired|wrong_side|too_low|not_behind|no_progress, or over_shoulder. */
    check(side, localHand, shoulderY) {
      if (!isSide(side) || !fin3(localHand) || !Number.isFinite(shoulderY)) return result(false, 'back_approach_invalid');
      const hand = hands.get(side);
      if (!hand) return result(false, 'back_approach_required');
      if (dist(localHand, hand.position) > A.MAX_SAMPLE_JUMP_M + A.BOUNDARY_EPSILON) { reset(side); return result(false, 'back_approach_jump'); }
      if (!pathClear(side, hand.position, localHand, shoulderY)) { reset(side); return result(false, 'back_approach_path'); }
      if (hand.age > A.APPROACH_LIFETIME_S) return result(false, 'back_approach_expired');
      const lateral = localHand[0] * sign(side);
      if (lateral < -A.CENTRE_CROSS_TOLERANCE_M || lateral > A.SIDE_MAX_M) return result(false, 'back_approach_wrong_side');
      if (localHand[1] < shoulderY - A.RETRIEVE_BELOW_SHOULDER_M) return result(false, 'back_approach_too_low');
      if (localHand[2] < A.RETRIEVE_BACK_MIN_M) return result(false, 'back_approach_not_behind');
      const entry = hand.entry;
      if (localHand[2] - entry[2] < A.MIN_PROGRESS_M && entry[1] - localHand[1] < A.MIN_PROGRESS_M) return result(false, 'back_approach_no_progress');
      return result(true, 'over_shoulder');
    },
  };
}
